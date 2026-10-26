import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {createLiveClient}=createRequire(import.meta.url)('../desktop/live.cjs');
const nonce='00000000-0000-4000-8000-000000000001';
async function fixture(t,fetchImpl){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'grokdeck-desktop-live-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const credentialFile=path.join(directory,'key');await fs.writeFile(credentialFile,'a'.repeat(43),{mode:0o600});return {client:createLiveClient({credentialFile,fetchImpl}),credentialFile,directory};}
const reply=j=>new Response(JSON.stringify({apiVersion:1,...j}),{headers:{'content-type':'application/json'}});
test('desktop live transport keeps credentials on fixed loopback requests and returns only data',async t=>{
 let observed;
 const {client}=await fixture(t,async(url,options)=>{observed={url,options};return reply({live:true,readOnly:false});});
 assert.deepEqual(await client.health(),{live:true});assert.equal(observed.url,'https://127.0.0.1:43875/v1/health');assert.equal(observed.options.redirect,'error');assert.equal(observed.options.headers.Authorization,'Bearer '+'a'.repeat(43));
 await assert.rejects(client.messages('../secret'));await assert.rejects(client.send('agent','hello','not-a-uuid'));
});
test('desktop sends never retry ambiguous or mismatched receipts',async t=>{
 let calls=0;
 const {client}=await fixture(t,async()=>{calls++;throw new Error('network failed after dispatch');});
 const result=await client.send('agent','hello',nonce);assert.equal(result.status,'unknown');assert.equal(result.clientNonce,nonce);assert.equal(calls,1);
 const other=await fixture(t,async()=>reply({clientNonce:'wrong',accepted:true,status:'accepted'}));assert.equal((await other.client.send('agent','hello',nonce)).status,'unknown');
});
test('desktop live transport rejects cached capability and symlinked credentials',async t=>{
 const {client,credentialFile,directory}=await fixture(t,async()=>reply({readOnly:true}));await assert.rejects(client.health());
 if(process.platform==='win32')return; // File symlink creation requires extra Windows privileges.
 const link=path.join(directory,'link');await fs.symlink(credentialFile,link);const linked=createLiveClient({credentialFile:link,fetchImpl:async()=>{assert.fail('credentials must not be read via symlink');}});await assert.rejects(linked.health());
});

test('desktop preserves Unicode text and validates the optional reply identifier',async t=>{
 let sent;
 const {client}=await fixture(t,async(_,options)=>{sent=JSON.parse(options.body);return reply({clientNonce:nonce,accepted:true,status:'accepted'});});
 await assert.rejects(client.send('agent','🙂',nonce,''));
 assert.equal((await client.send('agent','Reply 🌍 ❤️',nonce,'entry:one')).status,'accepted');
 assert.deepEqual(sent,{prompt:'Reply 🌍 ❤️',clientNonce:nonce,replyToId:'entry:one'});
});

test('avatar replies become bounded local image data only, never arbitrary URLs or SVG',async t=>{
 const encoded=Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64');
 const {client}=await fixture(t,async url=>{assert.equal(url,'https://127.0.0.1:43875/v1/agents/agent/avatar');return reply({mimeType:'image/png',dataBase64:encoded});});
 assert.equal(await client.avatar('agent'),'data:image/png;base64,'+encoded);
 const svg=await fixture(t,async()=>reply({mimeType:'image/svg+xml',dataBase64:Buffer.from('<svg/>').toString('base64')}));await assert.rejects(svg.client.avatar('agent'));
 const corrupt=await fixture(t,async()=>reply({mimeType:'image/png',dataBase64:Buffer.from('<html/>').toString('base64')}));await assert.rejects(corrupt.client.avatar('agent'));
});
test('computer status is fetched read-only and unsupported states are rejected',async t=>{
 const computer={agentId:'agent',name:'Computer',state:'running',windows:[{index:0,label:'Desktop'}],checkedAt:1};
 const {client}=await fixture(t,async(url,options)=>{assert.equal(url,'https://127.0.0.1:43875/v1/computers');assert.equal(options.method,'GET');assert.equal(options.body,undefined);return reply({checkedAt:1,complete:true,computers:[computer]});});
 assert.equal((await client.computers()).computers[0].state,'running');
 const invalid=await fixture(t,async()=>reply({checkedAt:1,complete:true,computers:[{...computer,state:'starting'}]}));await assert.rejects(invalid.client.computers());
});
