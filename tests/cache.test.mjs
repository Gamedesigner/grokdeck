import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {readCache,encodeKey,decodeKey,normalizeEntries,conversationURL,defaultSource} from '../desktop/cache.mjs';
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'grokdeck-test-')); const folder=path.join(root,'sand-client-persistence');await fs.mkdir(folder);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const put=async(key,value,version=1)=>fs.writeFile(path.join(folder,encodeKey(key)),JSON.stringify({schemaVersion:version,value}));
  const prefix='sand.client.slice.account.google-oauth2%7Ctest.';
  await put('sand.client.slice.client-meta.account-slot','google-oauth2|test');
  return {root,folder,put,prefix};
}
test('base32 keys round trip and reject unrelated filenames',()=>{for(const key of ['sand.client.slice.client-meta.account-slot','sand.client.slice.account.google-oauth2%7Ctest.roster.last-roster','test.é'])assert.equal(decodeKey(encodeKey(key)),key);assert.equal(decodeKey('../secrets.json'),null);});
test('reads active account only, maps sections and transcript roles, leaves source unchanged',async t=>{
  const {root,folder,put,prefix}=await fixture(t);
  await put(prefix+'roster.last-roster',{rows:[{id:'alpha',name:'Alpha',lastActivityAt:100,hasUnread:true,unreadCount:2,lastEntry:{text:'Latest'},avatarColor:'#abc'}, {id:'removed',isRemovedFromSidebar:true}]});
  await put(prefix+'sidebar.last-sections',{sections:[{id:'project',name:'Projects',agentIds:['alpha']}]});
  await put(prefix+'ui-agent-refs',{pinnedAgentIds:['alpha']});
  await put(prefix+'transcript.replicas.alpha',{entries:[{id:'one',kind:'message',role:'user',content:'Question',timestampMs:1},{id:'two',kind:'send-message',message:{type:'text',content:'Answer'},timestampMs:2}],persistedAt:5});
  await put('sand.client.slice.account.other.roster.last-roster',{rows:[{id:'secret',name:'Other account'}]});
  const before=await Promise.all((await fs.readdir(folder)).map(async n=>[n,await fs.readFile(path.join(folder,n),'utf8')]));
  const s=await readCache(root);assert.equal(s.agents.length,1);assert.equal(s.agents[0].name,'Alpha');assert.equal(s.agents[0].section,'Projects');assert.equal(s.agents[0].pinned,true);assert.equal(s.agents[0].messages[0].role,'user');assert.equal(s.agents[0].messages[1].role,'assistant');assert.equal(s.source.available,true);assert.equal(s.warnings.length,0);
  for(const [n,content] of before)assert.equal(await fs.readFile(path.join(folder,n),'utf8'),content);
});
test('missing source gives actionable empty state',async t=>{const {root}=await fixture(t);const s=await readCache(path.join(root,'missing'));assert.equal(s.source.available,false);assert.match(s.source.warning,/not found/);});
test('no active account never falls back to another account',async t=>{const {root,folder,put}=await fixture(t);await fs.unlink(path.join(folder,encodeKey('sand.client.slice.client-meta.account-slot')));await put('sand.client.slice.account.other.roster.last-roster',{rows:[{id:'other'}]});const s=await readCache(root);assert.equal(s.agents.length,0);assert.match(s.source.warning,/No active/);});
test('unknown schemas, corrupt cache, and symlinks fail closed',async t=>{
 const {root,folder,put,prefix}=await fixture(t);await put(prefix+'roster.last-roster',{rows:[{id:'alpha'}]},99);const s=await readCache(root);assert.equal(s.agents.length,0);assert.ok(s.warnings.length);
 await fs.writeFile(path.join(folder,encodeKey(prefix+'roster.last-roster')),'{');const corrupt=await readCache(root);assert.equal(corrupt.agents.length,0);assert.match(corrupt.warnings[0],/Could not read/);
 if(process.platform!=='win32'){const outside=path.join(root,'outside');await fs.writeFile(outside,JSON.stringify({schemaVersion:1,value:{rows:[{id:'outside'}]}}));await fs.unlink(path.join(folder,encodeKey(prefix+'roster.last-roster')));await fs.symlink(outside,path.join(folder,encodeKey(prefix+'roster.last-roster')));assert.equal((await readCache(root)).agents.length,0);}
});
test('version changes are visible and cached status is never presented as running',async t=>{const {root,put,prefix}=await fixture(t);await put(prefix+'roster.last-roster',{rows:[{id:'alpha',awaitingUserResponse:{kind:'question'}}]});await fs.writeFile(path.join(root,'desktop-status.json'),JSON.stringify({appVersion:'0.99.0'}));const s=await readCache(root);assert.match(s.source.warning,/0.99.0/);assert.equal(s.agents[0].awaitingResponse,true);assert.equal(s.agents[0].running,undefined);});
test('transcripts preserve unsupported-entry placeholders and deduplicate',()=>{const result=normalizeEntries([{id:'a',kind:'message',role:'user',content:'Hi',timestampMs:10},{id:'b',kind:'send-message',message:{type:'attachment'},timestampMs:20},{id:'a',kind:'message',role:'user',content:'Duplicate'},{id:'c',kind:'tool-call',timestampMs:30}]);assert.equal(result.length,3);assert.equal(result[0].content,'Hi');assert.match(result[1].content,/attachment/);assert.match(result[2].content,/tool-call/);});
test('conversation links are constrained to observed agent route',()=>{assert.equal(conversationURL('agent-123'),'grokbot://app/v1/agent?id=agent-123');for(const id of ['../../secret','x&code=bad','https://example.com',''])assert.throws(()=>conversationURL(id));});
test('platform-specific data directories',()=>{assert.ok(defaultSource('win32','C:/Users/Test','C:/AppData').endsWith(path.join('C:/AppData','Grok Bot')));assert.equal(defaultSource('darwin','/Users/test'),'/Users/test/Library/Application Support/Grok Bot');});
test('observed schema-4 roster works with schema-1 transcript replicas',async t=>{const {root,put,prefix}=await fixture(t);await put(prefix+'roster.last-roster',{rows:[{id:'current',name:'Current agent',lastEntry:{text:'Result'},hasUnread:true}]},4);await put(prefix+'transcript.replicas.current',{entries:[{kind:'send-message',id:'reply',message:{type:'text',content:'Real format'},timestampMs:100}],persistedAt:100},1);const s=await readCache(root);assert.equal(s.agents.length,1);assert.equal(s.agents[0].messages[0].content,'Real format');assert.deepEqual(s.warnings,[]);});
