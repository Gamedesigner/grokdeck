import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import tls from "node:tls";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { X509Certificate, createHash } from "node:crypto";

import { loadLocalIdentity } from "../bridge/local-tls.mjs";
import { createBridge } from "../bridge/server.mjs";
import { privateIPv4, validateLANHost, loadLANIdentity, createLANProxy } from "../bridge/lan.mjs";

test("LAN binding requires an exact assigned private address", () => {
  for (const address of ["10.0.0.3", "172.16.1.2", "172.31.255.254", "192.168.1.3"]) assert.equal(privateIPv4(address), true);
  for (const address of ["0.0.0.0", "127.0.0.1", "8.8.8.8", "172.32.0.1", "10.01.0.2", "10.0.0.256", "10.0.0.1;bad", "192.168.1.2:443", "::"]) assert.equal(privateIPv4(address), false);
  const interfaces = { en0: [{ family: "IPv4", address: "10.0.0.3", internal: false }] };
  assert.equal(validateLANHost("10.0.0.3", interfaces), "10.0.0.3");
  assert.throws(() => validateLANHost("10.0.0.4", interfaces));
  assert.throws(() => validateLANHost("0.0.0.0", interfaces));
});


test("private HTTPS validates its local certificate, rejects unpaired/browser clients and preserves loopback auth", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "grokdeck-lan-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const host = "10.1.2.3", token = "A".repeat(43);
  const identity = await loadLANIdentity(host, directory);
  const parsed = new X509Certificate(identity.cert);
  assert.equal(parsed.checkIP(host), host);
  assert.equal(identity.fingerprint, createHash("sha256").update(parsed.raw).digest("hex"));
  assert.equal((await loadLANIdentity(host, directory)).fingerprint, identity.fingerprint);
  if (process.platform !== "win32") assert.equal((await fs.stat(identity.keyFile)).mode & 0o777, 0o600);
  const localIdentity = await loadLocalIdentity(directory);
  const upstream = createBridge({ token, tlsOptions: localIdentity });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => upstream.close(r)));
  const proxy = createLANProxy({ host, token, ...identity, upstreamCert: localIdentity.cert, upstreamPort: upstream.address().port });
  // Test transport stays on loopback; startLANBridge separately enforces assigned RFC1918 binding.
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => proxy.close(r)));
  const port = proxy.address().port;
  const request = (headers = {}, trusted = true) => new Promise((resolve, reject) => {
    const req = https.get({ host: "127.0.0.1", port, path: "/v1/health", ca: trusted ? identity.cert : undefined,
      checkServerIdentity: (_, cert) => tls.checkServerIdentity(host, cert),
      headers: { Host: `${host}:${port}`, ...headers }, agent: false }, (res) => {
      let body = ""; res.on("data", (data) => body += data); res.on("end", () => resolve({ status: res.statusCode, body }));
    }); req.on("error", reject);
  });
  assert.equal((await request()).status, 401);
  assert.equal((await request({ Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await request({ Authorization: `Bearer ${token}` })).status, 200);
  assert.equal((await request({ Authorization: `Bearer ${token}`, Origin: "https://attacker.test" })).status, 403);
  assert.equal((await request({ Authorization: `Bearer ${token}`, Host: "attacker.test" })).status, 403);
  await assert.rejects(() => request({ Authorization: `Bearer ${token}` }, false));
});

test("TLS identity refuses symlink directories", { skip: process.platform === "win32" }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "grokdeck-lan-link-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.symlink(directory, path.join(directory, "tls-10.1.2.3"));
  await assert.rejects(() => loadLANIdentity("10.1.2.3", directory));
});
