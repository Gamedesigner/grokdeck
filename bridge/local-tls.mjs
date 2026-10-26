import https from 'node:https';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import selfsigned from 'selfsigned';

export const LOCAL_PORT = 43875;
export const credentialDirectory = path.join(os.homedir(), '.grokdeck-bridge');
export async function protectDirectory(directory = credentialDirectory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) throw new Error('Invalid bridge directory');
  if (process.platform === 'win32') {
    // A protected DACL grants only this Windows identity access, including inherited files.
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; $p=$env:GROKDECK_ACL_DIRECTORY; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $p -AclObject $acl"],
      { env: { ...process.env, GROKDECK_ACL_DIRECTORY: path.resolve(directory) }, windowsHide: true });
  } else await fs.chmod(directory, 0o700);
}
export async function readPrivateFile(file, maxBytes = 32768) {
  const entry = await fs.lstat(file);
  if (entry.isSymbolicLink()) throw new Error('Invalid bridge identity file');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes || (process.getuid && info.uid !== process.getuid())) throw new Error('Invalid bridge identity file');
    if (process.platform !== 'win32') await handle.chmod(0o600);
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}
export async function loadLocalIdentity(directory = credentialDirectory) {
  await protectDirectory(directory);
  const file = path.join(directory, 'local-tls-v2.json');
  try { await fs.lstat(file); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const pems = await selfsigned.generate([{name:'commonName',value:'GrokDeck local bridge'}], {
      keyType:'rsa',keySize:2048,algorithm:'sha256',notBeforeDate:new Date(Date.now()-60000),notAfterDate:new Date(Date.now()+365*86400000),
      extensions:[{name:'basicConstraints',cA:false,critical:true},{name:'keyUsage',digitalSignature:true,keyEncipherment:true,critical:true},{name:'extKeyUsage',serverAuth:true},{name:'subjectAltName',altNames:[{type:7,ip:'127.0.0.1'}]}]
    });
    // Exclusive creation never replaces an established pin. Partial files fail closed.
    await fs.writeFile(file, JSON.stringify({key:pems.private,cert:pems.cert}), {flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  }
  const identity = JSON.parse(await readPrivateFile(file));
  localTLSOptions(identity.cert);
  return identity;
}
export async function readLocalCertificate(directory = credentialDirectory) {
  return JSON.parse(await readPrivateFile(path.join(directory, 'local-tls-v2.json'))).cert;
}
export function localTLSOptions(cert) {
  const parsed = new X509Certificate(cert);
  if (!parsed.checkIP('127.0.0.1') || Date.parse(parsed.validTo) <= Date.now() || Date.parse(parsed.validFrom) > Date.now()) throw new Error('Invalid local bridge certificate');
  return {ca:cert, minVersion:'TLSv1.2', rejectUnauthorized:true, agent:false,
    checkServerIdentity: (host, peer) => tls.checkServerIdentity('127.0.0.1', peer) ||
      (peer.fingerprint256 !== parsed.fingerprint256 ? new Error('Local bridge identity changed') : undefined)};
}
export async function localFetch(url, options, directory = credentialDirectory) {
  const target = new URL(url);
  if ((target.protocol !== "https:" || target.hostname !== "127.0.0.1") || !target.pathname.startsWith('/v1/') || target.search || target.username || target.password) throw new Error('Invalid bridge destination');
  const secure = localTLSOptions(await readLocalCertificate(directory));
  return new Promise((resolve, reject) => {
    const request = https.request(target, {...secure, method:options.method,headers:options.headers,signal:options.signal}, response=>{
      const chunks=[];let count=0;
      response.on('data',chunk=>{count+=chunk.length;if(count>8*1024*1024)request.destroy(new Error('Bridge reply too large'));else chunks.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
    });
    request.on('error',reject);
    request.end(options.body);
  });
}
