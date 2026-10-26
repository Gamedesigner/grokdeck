import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadLocalIdentity,localFetch,localTLSOptions} from '../bridge/local-tls.mjs';
import {loadPairingToken,startBridge} from '../bridge/server.mjs';
import {createLANProxy,loadLANIdentity,startLANBridge,privateIPv4} from '../bridge/lan.mjs';
async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'deck-security-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function listen(t,server){await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return server.address().port;}
const token='Z'.repeat(43);
const options=()=>({method:'GET',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(3000)});
test('real local TLS bridge accepts v2 credential and rejects legacy token',async t=>{
  const dir=await directory(t);await fs.writeFile(path.join(dir,'pairing-token'),token);
  const {server,port}=await startBridge({port:0,credentialDirectory:dir});t.after(()=>new Promise(r=>server.close(r)));
  const {token:newToken}=await loadPairingToken(dir);assert.notEqual(newToken,token);
  const url=`https://127.0.0.1:${port}/v1/health`;
  assert.equal((await localFetch(url,options(),dir)).status,401);
  const response=await localFetch(url,{...options(),headers:{Authorization:`Bearer ${newToken}`}},dir);
  assert.equal(response.status,200);assert.equal((await response.json()).apiVersion,1);
});
test('plaintext listener receives no bearer credential',async t=>{
  const dir=await directory(t);await loadLocalIdentity(dir);const seen=[];
  const port=await listen(t,net.createServer(socket=>socket.on('data',bytes=>{seen.push(bytes);socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');})));
  await assert.rejects(localFetch(`https://127.0.0.1:${port}/v1/health`,options(),dir));
  assert.ok(seen.length);assert.equal(Buffer.concat(seen).includes(Buffer.from(token)),false);
});
test('untrusted TLS listener cannot capture desktop or LAN upstream credentials',async t=>{
  const dir=await directory(t),evil=await directory(t);await loadLocalIdentity(dir);const attacker=await loadLocalIdentity(evil);let requests=0;
  const port=await listen(t,https.createServer(attacker,(_req,res)=>{requests++;res.end('{}');}));
  await assert.rejects(localFetch(`https://127.0.0.1:${port}/v1/health`,options(),dir));
  const host='10.0.0.8',identity=await loadLANIdentity(host,dir),trusted=await loadLocalIdentity(dir);
  const proxy=createLANProxy({host,token,...identity,upstreamPort:port,upstreamCert:trusted.cert});const proxyPort=await listen(t,proxy);
  const status=await new Promise((resolve,reject)=>{
    const req=https.get({hostname:'127.0.0.1',port:proxyPort,path:'/v1/health',ca:identity.cert,checkServerIdentity:(_,cert)=>tls.checkServerIdentity(host,cert),headers:{Host:`${host}:${proxyPort}`,Authorization:`Bearer ${token}`}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);
  });
  assert.equal(status,503);assert.equal(requests,0);
});
test('same CA trust does not allow a different pinned leaf',async t=>{
  const dir=await directory(t),other=await directory(t);const identity=await loadLocalIdentity(dir),alien=await loadLocalIdentity(other);
  const {X509Certificate}=await import('node:crypto');const parsed=new X509Certificate(alien.cert);
  assert.ok(localTLSOptions(identity.cert).checkServerIdentity('127.0.0.1',{subjectaltname:'IP Address:127.0.0.1',fingerprint256:parsed.fingerprint256}));
});
test('local identity fails closed on symlink or unsafe directory', {skip:process.platform==='win32'},async t=>{
  const dir=await directory(t);await loadLocalIdentity(dir);await fs.unlink(path.join(dir,'local-tls-v3.json'));await fs.symlink('/dev/null',path.join(dir,'local-tls-v3.json'));
  await assert.rejects(loadLocalIdentity(dir));const link=dir+'-link';await fs.symlink(dir,link);t.after(()=>fs.unlink(link));await assert.rejects(loadLocalIdentity(link));
});

test('production LAN startup loads the authenticated upstream identity',async t=>{
  const host=Object.values(os.networkInterfaces()).flat().find(entry=>entry&&!entry.internal&&entry.family==='IPv4'&&privateIPv4(entry.address))?.address;
  if(!host)return t.skip('No private interface on this runner');
  const dir=await directory(t);
  const upstream=await startBridge({port:0,credentialDirectory:dir});t.after(()=>new Promise(r=>upstream.server.close(r)));
  const lan=await startLANBridge({host,port:0,credentialDirectory:dir,upstreamPort:upstream.port});t.after(()=>new Promise(r=>lan.server.close(r)));
  const identity=await loadLANIdentity(host,dir),credential=await loadPairingToken(dir);
  const status=await new Promise((resolve,reject)=>{
    const req=https.get(lan.endpoint+'/v1/health',{ca:identity.cert,headers:{Authorization:`Bearer ${credential.token}`}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);
  });
  assert.equal(status,200);
});
