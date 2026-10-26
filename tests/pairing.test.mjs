import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createEnrollment} from '../bridge/pairing.mjs';
import {loadLANIdentity,createLANProxy} from '../bridge/lan.mjs';
import {createPhoneHost} from '../desktop/phone-host.mjs';
test('enrollment expires, replaces prior codes, and can only be redeemed once',()=>{
  let time=0;const e=createEnrollment({now:()=>time});const first=e.issue();const second=e.issue();
  assert.equal(e.redeem(`Bearer ${first.code}`),false);
  assert.equal(e.redeem(null),false);assert.equal(e.redeem([]),false);
  assert.equal(e.redeem(`Bearer ${second.code}`),true);
  assert.equal(e.redeem(`Bearer ${second.code}`),false);
  const third=e.issue();time=third.expiresAt;assert.equal(e.redeem(`Bearer ${third.code}`),false);
});
test('TLS enrollment rejects browsers and wrong codes, returns credential only once',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'deck-enroll-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const host='10.0.0.8',token='C'.repeat(43),identity=await loadLANIdentity(host,dir),enrollment=createEnrollment();
  const proxy=createLANProxy({host,token,...identity,enrollment});
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>proxy.close(r)));
  const request=(code,extra={})=>new Promise((resolve,reject)=>{
    const port=proxy.address().port;
    const req=https.request({host:'127.0.0.1',port,path:'/v1/pair',method:'POST',ca:identity.cert,
      checkServerIdentity:(_,cert)=>tls.checkServerIdentity(host,cert),headers:{Host:`${host}:${port}`,Authorization:`Bearer ${code}`,...extra},agent:false},res=>{
      let body='';res.on('data',data=>body+=data);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
    });req.on('error',reject);req.end('{}');
  });
  const {code}=enrollment.issue();
  assert.equal((await request(code,{Origin:'https://evil.example'})).status,403);
  assert.equal((await request('wrong')).status,401);
  assert.deepEqual((await request(code)).body,{apiVersion:1,token});
  assert.equal((await request(code)).status,401);
});
test('phone host binds only selected local network and setup has a disposable enrollment secret',async()=>{
  let options,closed=false;
  const controller=createPhoneHost({ensureLive:async()=>{},interfaces:()=>({wifi:[{family:'IPv4',address:'10.0.0.8',internal:false}]}),
    start:async value=>{options=value;return {endpoint:'https://10.0.0.8:43874',fingerprint:'a'.repeat(64),server:{close:cb=>{closed=true;cb();},closeAllConnections(){}}};}});
  await assert.rejects(controller.enable('0.0.0.0'));
  await controller.enable('10.0.0.8');assert.equal(options.port,43874);
  const setup=JSON.parse(controller.setup().text);
  assert.equal(setup.grokdeck,1);assert.equal(setup.token,undefined);assert.match(setup.code,/^[A-Za-z0-9_-]{43}$/);
  await controller.stop();assert.equal(closed,true);assert.equal(options.enrollment.redeem(`Bearer ${setup.code}`),false);
});
