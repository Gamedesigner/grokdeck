import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeSettings,validOrganization} from '../bridge/organization.mjs';
import {createGateway} from '../bridge/gateway.mjs';
const original={sections:[{id:'work',name:'Work',agentIds:['agent']}],pins:['agent']};
test('runtime settings normalize empty groups and send only scoped organization fields',async()=>{
 const calls=[];let scope='a';const api=createRuntimeSettings({session:async()=>({accountScope:scope,token:'fixture',teamId:'123',appVersion:'0.75.8'}),fetchImpl:async(url,o)=>{calls.push({url,o});return Response.json({settings:{sidebarSections:{sections:[{id:'empty',name:'Empty'}]},pinnedAgents:{},privateSetting:'must not leave host'}});}});
 assert.deepEqual(await api(),{sections:[{id:'empty',name:'Empty',agentIds:[]}],pins:[]});
 await api(original);assert.deepEqual(JSON.parse(calls[1].o.body),{sidebarSections:{sections:original.sections},pinnedAgents:{agentIds:['agent']}});assert.equal(calls[1].o.headers['x-cursor-team-id'],'123');
 await assert.rejects(api({...original,arbitrary:true}));assert.equal(calls.length,2);
 assert.equal(validOrganization({sections:[...original.sections,...original.sections],pins:[]}),false);
});
test('group sync rejects stale edits and confirms both host and server after a mutation',async()=>{
 let host=structuredClone(original.sections),runtime=structuredClone(original);const writes=[];
 const gateway=createGateway({resolveConnection:async()=>({baseUrl:'https://fixture.cursorvm.com',token:'fixture',accountScope:'a'}),getAccountScope:async()=> 'a',fetchImpl:async(url,o)=>{
  const method=url.split('/').pop();if(method==='getHostSettings')return Response.json({sidebarSections:host});if(method==='listAgents')return Response.json([{id:'agent',name:'A'}]);if(method==='setHostSettings'){host=JSON.parse(o.body).sidebarSections;writes.push(method);return Response.json({sidebarSections:host});}throw Error('Unexpected method');
 }});
 gateway.runtimeSettings=async patch=>{if(patch){writes.push('runtime');runtime=structuredClone(patch);}return runtime;};
 assert.deepEqual(await gateway.organization(),original);
 const next={...original,sections:[{...original.sections[0],name:'Renamed'}]};
 assert.deepEqual(await gateway.updateOrganization(next,original),next);assert.deepEqual(writes,['setHostSettings','runtime']);
 await assert.rejects(gateway.updateOrganization(original,original));
 await assert.rejects(gateway.updateOrganization({...next,pins:['foreign-agent']},next));assert.equal(writes.length,2);
});
