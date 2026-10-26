import https from "node:https";
import http from "node:http";
import { X509Certificate, createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import selfsigned from "selfsigned";

import { pathToFileURL } from "node:url";
import { authorized, loadPairingToken, DEFAULT_PORT } from "./server.mjs";


export const LAN_PORT = 43873;
export function privateIPv4(value) {
  if (typeof value !== "string" || !/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) return false;
  const octets = value.split(".").map(Number);
  if (octets.some((n, i) => n > 255 || String(n) !== value.split(".")[i])) return false;
  return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
}
export function validateLANHost(host, interfaces = os.networkInterfaces()) {
  if (!privateIPv4(host)) throw new Error("Choose one exact RFC1918 IPv4 address assigned to this Mac.");
  if (!Object.values(interfaces).flat().some((entry) => entry && !entry.internal && entry.family === "IPv4" && entry.address === host))
    throw new Error("The private address is not assigned to a local network interface.");
  return host;
}
async function regularFile(file) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Invalid local TLS file.");
  return info;
}
export async function loadLANIdentity(host, directory = path.join(os.homedir(), ".grokdeck-bridge")) {
  if (!privateIPv4(host)) throw new Error("A private IPv4 address is required.");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const rootInfo = await fs.lstat(directory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Invalid bridge configuration directory.");
  const root = path.join(directory, `tls-${host}`);
  await fs.mkdir(root, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
  const info = await fs.lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid TLS directory.");
  if (process.platform !== "win32") await fs.chmod(root, 0o700);
  const keyFile = path.join(root, "key.pem"), certFile = path.join(root, "cert.pem");
  try {
    await regularFile(keyFile);
    await regularFile(certFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // Never overwrite an existing key/certificate. An incomplete identity needs operator repair.
    const members = await fs.readdir(root);
    if (members.length) throw new Error("Incomplete TLS identity; inspect the local TLS directory.");
    const pems=await selfsigned.generate([{name:'commonName',value:'GrokDeck private bridge'}],{
      keyType:'rsa',keySize:2048,algorithm:'sha256',
      notBeforeDate:new Date(Date.now()-60000),notAfterDate:new Date(Date.now()+30*86400000),
      extensions:[
        {name:'basicConstraints',cA:false,critical:true},
        {name:'keyUsage',digitalSignature:true,keyEncipherment:true,critical:true},
        {name:'extKeyUsage',serverAuth:true},
        {name:'subjectAltName',altNames:[{type:7,ip:host}]}
      ]
    });
    await fs.writeFile(keyFile,pems.private,{flag:'wx',mode:0o600});
    await fs.writeFile(certFile,pems.cert,{flag:'wx',mode:0o600});
  }
  await regularFile(keyFile); await regularFile(certFile);
  if (process.platform !== "win32") { await fs.chmod(keyFile, 0o600); await fs.chmod(certFile, 0o600); }
  const key = await fs.readFile(keyFile), cert = await fs.readFile(certFile), parsed = new X509Certificate(cert);
  if (!parsed.checkIP(host) || Date.parse(parsed.validTo) <= Date.now() || Date.parse(parsed.validFrom) > Date.now())
    throw new Error("The local TLS certificate is expired or does not match this address.");
  const fingerprint = createHash("sha256").update(parsed.raw).digest("hex");
  return { key, cert, fingerprint, keyFile, certFile };
}
export function createLANProxy({ host, token, key, cert, upstreamPort = DEFAULT_PORT, onResponse, enrollment }) {
  if (!privateIPv4(host) || !/^[A-Za-z0-9_-]{43}$/.test(token) || !Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535)
    throw new Error("Invalid private bridge configuration.");
  const server = https.createServer({ key, cert, minVersion: "TLSv1.2" }, (req, res) => {
    res.on("finish", () => onResponse?.({ method: req.method, status: res.statusCode }));
    const reject = (status, error) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", Connection: "close" });
      res.end(JSON.stringify({ error }));
    };
    if (req.headers.host !== `${host}:${server.address().port}` || req.headers.origin)
      return reject(403, "Only native clients using the configured private address are accepted.");
    if(req.url==='/v1/pair'&&req.method==='POST'&&enrollment) {
      const declared=Number(req.headers['content-length']||0);
      if(!Number.isSafeInteger(declared)||declared<0||declared>1024)return reject(413,'Invalid pairing request.');
      let received=0;
      req.on('data',chunk=>{received+=chunk.length;if(received>1024)req.destroy();});
      req.on('end',()=>{
        if(!enrollment.redeem(req.headers.authorization))return reject(401,'Setup expired or already used. Create a new setup on your computer.');
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store',Connection:'close'});
        res.end(JSON.stringify({apiVersion:1,token}));
      });
      return;
    }
    if (!authorized(req.headers.authorization, token)) return reject(401, "Pairing required.");
    if (!req.url.startsWith("/v1/") || req.url.includes("?") || !["GET", "POST"].includes(req.method))
      return reject(400, "Invalid bridge request.");
    const size = Number(req.headers["content-length"] ?? 0);
    if (!Number.isSafeInteger(size) || size < 0 || size > 256 * 1024) return reject(413, "Request too large.");
    const chunks = []; let count = 0;
    req.on("data", (chunk) => { count += chunk.length; if (count <= 256 * 1024) chunks.push(chunk); else req.destroy(); });
    req.on("end", () => {
      const upstream = http.request({ host: "127.0.0.1", port: upstreamPort, method: req.method, path: req.url,
        headers: { Host: `127.0.0.1:${upstreamPort}`, Authorization: req.headers.authorization, "Content-Type": "application/json", "Content-Length": count, Connection: "close" }, timeout: req.method === "POST" ? 30000 : 15000 }, (response) => {
        // Only the local bridge's JSON response is forwarded; redirect destinations are never followed.
        res.writeHead(response.statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Connection: "close" });
        response.pipe(res);
      });
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => { if (!res.headersSent) reject(503, "The Mac bridge is unavailable."); else res.destroy(); });
      res.on("close", () => upstream.destroy());
      upstream.end(Buffer.concat(chunks));
    });
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  return server;
}
export async function startLANBridge({ host, port = LAN_PORT, upstreamPort = DEFAULT_PORT, credentialDirectory, onResponse, enrollment } = {}) {
  validateLANHost(host);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid LAN port.");
  const identity = await loadLANIdentity(host, credentialDirectory);
  const { token, file } = await loadPairingToken(credentialDirectory);
  const server = createLANProxy({ host, token, ...identity, upstreamPort, onResponse, enrollment });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  return { server, endpoint: `https://${host}:${server.address().port}`, fingerprint: identity.fingerprint, tokenFile: file };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startLANBridge({ host: process.env.GROKDECK_LAN_HOST, port: Number(process.env.GROKDECK_LAN_PORT || LAN_PORT), upstreamPort: Number(process.env.GROKDECK_BRIDGE_PORT || DEFAULT_PORT), credentialDirectory: process.env.GROKDECK_BRIDGE_CONFIG,
    onResponse: process.env.GROKDECK_LAN_DIAGNOSTICS === "1" ? ({ method, status }) => console.log(`Native bridge request: ${method} ${status}`) : undefined })
    .then(({ server, endpoint, fingerprint, tokenFile }) => {
      console.log(`Private GrokDeck bridge: ${endpoint}`);
      console.log(`Certificate SHA-256: ${fingerprint}`);
      console.log(`Pairing credential stays in ${tokenFile}; its value is never logged.`);
      console.log("Connect only while on your trusted private network. No public listener, CA installation, or firewall change was created.");
      for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
