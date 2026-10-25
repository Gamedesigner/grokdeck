import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridge} from '../bridge/server.mjs';
const token='a'.repeat(43),nonce='00000000-0000-4000-8000-000000000001';
async function fixture(t,overrides={}){
 const calls=[];
 const gateway={status:async()=>({available:true}),roster:async()=>[{id:'agent-one',name:'Test',lastActivityAt:1}],
 discussion:async()=>({entries:[{kind:'message',id:'one',role:'assistant',content:'Live reply',timestampMs:5}]}),
 send:async args=>{calls.push(args);return{accepted:true,clientNonce:args.clientNonce};},
 acceptance:async()=>({outcome:'found',record:{status:'accepted'}}),interrupt:async()=>({hadActiveRun:true}),...overrides};
 const server=createBridge({token,gateway});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const request=(p,body)=>fetch(`http://127.0.0.1:${server.address().port}${p}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {request,calls};
}
test('live bridge declares live capability and returns current normalized discussion',async t=>{
 const {request}=await fixture(t);const health=await(await request('/v1/health')).json();assert.equal(health.live,true);assert.equal(health.readOnly,false);
 const j=await(await request('/v1/agents/agent-one/messages')).json();assert.equal(j.source.kind,'live-gateway');assert.equal(j.messages[0].content,'Live reply');assert.equal(j.messages[0].role,'assistant');
});
test('live bridge scopes writes to current roster and validates mutations',async t=>{
 const {request,calls}=await fixture(t);
 assert.equal((await request('/v1/agents/missing/send',{prompt:'hello',clientNonce:nonce})).status,404);
 assert.equal((await request('/v1/agents/agent-one/send',{prompt:'hello',clientNonce:nonce,approval:'yes'})).status,400);
 const sent=await(await request('/v1/agents/agent-one/send',{prompt:'hello',clientNonce:nonce})).json();assert.equal(sent.status,'accepted');assert.equal(calls.length,1);
 assert.equal((await(await request('/v1/agents/agent-one/sends/'+nonce)).json()).status,'accepted');
 assert.equal((await(await request('/v1/agents/agent-one/interrupt',{})).json()).hadActiveRun,true);
});
test('ambiguous send is explicit unknown, never reported as failed or accepted',async t=>{
 const {request}=await fixture(t,{send:async()=>{throw Object.assign(new Error('secret remote body'),{code:'unknown_delivery',clientNonce:nonce});}});
 const result=await request('/v1/agents/agent-one/send',{prompt:'hello',clientNonce:nonce});const data=await result.json();assert.equal(data.status,'unknown');assert.equal(data.accepted,null);assert.equal(JSON.stringify(data).includes('secret'),false);
});
test('reply context is resolved from the actual discussion and Unicode survives',async t=>{
 const {request,calls}=await fixture(t);
 const sent=await request('/v1/agents/agent-one/send',{prompt:'👍🙂❤️',clientNonce:nonce,replyToId:'one'});
 assert.equal(sent.status,200);assert.equal(calls[0].prompt,'👍🙂❤️');assert.equal(calls[0].replyToId,'one');assert.equal(calls[0].replyQuote,'Live reply');
 assert.equal((await request('/v1/agents/agent-one/send',{prompt:'reply',clientNonce:nonce,replyToId:'missing'})).status,409);
 assert.equal(calls.length,1);
 assert.equal((await request('/v1/agents/agent-one/send',{prompt:'reply',clientNonce:nonce,replyToId:'one',replyQuote:'forged'})).status,400);
});
test('computer and avatar routes are paired read-only views without remote credentials',async t=>{
 const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvZkAAAAASUVORK5CYII=';
 const {request}=await fixture(t,{roster:async()=>[{id:'agent-one',name:'Test',avatarDataUrl:`data:image/png;base64,${image}`}],computer:async id=>({agentId:id,state:'running',vncUrl:'https://secret/?token=credential',windows:[{windowIndex:0,vncUrl:'https://secret-window'}]})});
 const computers=await(await request('/v1/computers')).json();assert.equal(computers.complete,true);assert.equal(computers.computers[0].state,'running');assert.doesNotMatch(JSON.stringify(computers),/secret|credential|vnc|token/i);
 const avatar=await(await request('/v1/agents/agent-one/avatar')).json();assert.equal(avatar.mimeType,'image/png');assert.equal(avatar.dataBase64,image);
 assert.equal((await request('/v1/agents/not-in-account/avatar')).status,404);
 assert.equal((await request('/v1/computers',{})).status,405);
 assert.equal((await request('/v1/agents/agent-one/avatar',{})).status,405);
});
