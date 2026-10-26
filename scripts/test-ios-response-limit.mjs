// Compiles the actual Swift model/client, then uses isolated TLS fixtures and dummy credentials.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {X509Certificate,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {loadLocalIdentity} from '../bridge/local-tls.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'deck-ios-limit-'));
function run(command,args){return new Promise((resolve,reject)=>{const child=spawn(command,args,{env:process.env});let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(new Error(out)));});}
try {
  const identity=await loadLocalIdentity(root),pin=createHash('sha256').update(new X509Certificate(identity.cert).raw).digest('hex');
  const swift=path.join(root,'Probe.swift'),exe=path.join(root,'probe');
  await fs.writeFile(swift,`import Foundation
@main struct Probe {
 static func main() async {
  let client=BridgeClient(baseURL:URL(string:CommandLine.arguments[1])!,token:String(repeating:"A",count:43),certificatePin:CommandLine.arguments[2])
  do { let _:BridgeHealth=try await client.get("v1/health",as:BridgeHealth.self); print("ok") }
  catch BridgeError.invalidResponse { print("size-rejected") }
  catch BridgeError.unauthorized { print("unauthorized") }
  catch BridgeError.untrustedBridge { print("untrusted") }
  catch BridgeError.http(302) { print("redirect-rejected") }
  catch { print("unexpected: \\(error)"); exit(1) }
 }
}`);
  await run('xcrun',['swiftc','-parse-as-library','ios/GrokDeck/Models.swift',swift,'-o',exe]);
  for(const mode of ['normal','wrong-pin','redirect','declared','chunked','error']) {
    let sent=0,closed=false;
    const total=32*1024*1024;
    const server=https.createServer(identity,(_req,res)=>{
      if(mode==='redirect'){res.writeHead(302,{Location:'https://127.0.0.1:1/never'});res.end();return;}
      if(mode==='normal'||mode==='wrong-pin'){res.end('{"apiVersion":1,"readOnly":false,"live":true}');return;}
      res.writeHead(mode==='error'?401:200,{'Content-Type':'application/json',...(mode==='declared'?{'Content-Length':total}:{})});res.flushHeaders();
      const timer=setInterval(()=>{if(sent>=total){clearInterval(timer);res.end();return;} const chunk=Buffer.alloc(16384,32);sent+=chunk.length;res.write(chunk);},2);
      res.on('close',()=>{closed=true;clearInterval(timer);});
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try {
      const result=(await run(exe,[`https://127.0.0.1:${server.address().port}`,mode==='wrong-pin'?'0'.repeat(64):pin])).trim();
      assert.equal(result,mode==='normal'?'ok':mode==='wrong-pin'?'untrusted':mode==='redirect'?'redirect-rejected':mode==='error'?'unauthorized':'size-rejected');
      if(['declared','chunked','error'].includes(mode)){for(let i=0;i<20&&!closed;i++)await new Promise(r=>setTimeout(r,50));assert.ok(closed);assert.ok(sent<total,`Downloaded whole ${mode} body`);}
      if(mode==='declared'||mode==='error')assert.ok(sent<1024*1024);
      console.log(JSON.stringify({mode,result,serverBytesSent:sent,fullBodyBytes:mode==='normal'?null:total}));
    } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
  }
} finally {await fs.rm(root,{recursive:true,force:true});}
