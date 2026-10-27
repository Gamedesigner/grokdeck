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

function cloudFixture({sectionsPresent=true,sections=original.sections,pins=original.pins,conflict=false,confirmMismatch=false}={}){
 const calls=[],commands=[];
 let settings={...(sectionsPresent?{sidebarSections:{sections:structuredClone(sections)}}:{}),pinnedAgents:{agentIds:[...pins]}};
 const session=async()=>({accountScope:'a',teamId:'123',appVersion:'0.77.0',token:'fixture'});
 const runtime=createRuntimeSettings({session,fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,body});
  if(url.endsWith('/UpdateGrokBotUserRuntimeSettings')){
   if(conflict)return Response.json({code:'aborted',message:'private conflict detail'},{status:409});
   settings={sidebarSections:structuredClone(body.sidebarSections),pinnedAgents:structuredClone(body.pinnedAgents)};
   if(confirmMismatch)settings.sidebarSections.sections[0].name='Concurrent edit';
  }
  return Response.json({settings});
 }});
 const gateway=createGateway({resolveConnection:async()=>({baseUrl:'https://fixture.cursorvm.com',token:'fixture',accountScope:'a',teamId:'123'}),getAccountScope:async()=> 'a',fetchImpl:async(url)=>{
  const method=url.split('/').pop();commands.push(method);
  if(method==='getHostSettings')return Response.json({sidebarSections:original.sections});
  if(method==='listAgents')return Response.json([{id:'agent',name:'A'}]);
  throw Error('Unexpected gateway write');
 }});
 gateway.runtimeSettings=runtime;
 return {gateway,runtime,calls,commands};
}

test('0.77 cloud groups are authoritative, including explicit empty groups',async()=>{
 for(const sections of [[],[{id:'cloud',name:'Cloud',agentIds:['agent']}]] ){
  const {gateway,commands}=cloudFixture({sections});
  assert.deepEqual(await gateway.organization(),{sections,pins:['agent']});
  assert.deepEqual(commands,[]);
  assert.deepEqual(Object.keys(await gateway.organization()).sort(),['pins','sections']);
 }
});

test('0.77 falls back to box groups only when runtime sections are absent',async()=>{
 const {gateway,calls,commands}=cloudFixture({sectionsPresent:false});
 assert.deepEqual(await gateway.organization(),original);
 assert.deepEqual(commands,['getHostSettings']);
 const next={...original,sections:[{...original.sections[0],name:'Migrated'}]};
 assert.deepEqual(await gateway.updateOrganization(next,original),next);
 const writes=calls.filter(x=>x.url.endsWith('/UpdateGrokBotUserRuntimeSettings'));
 assert.equal(writes.length,1);
 assert.deepEqual(writes[0].body,{sidebarSections:{sections:next.sections},pinnedAgents:{agentIds:next.pins}});
 assert.equal(commands.includes('setHostSettings'),false);
});

test('0.77 group writes carry the read base and never write legacy host settings',async()=>{
 const {gateway,calls,commands}=cloudFixture();
 const next={...original,sections:[{...original.sections[0],name:'Renamed'}]};
 assert.deepEqual(await gateway.updateOrganization(next,original),next);
 assert.deepEqual(commands,['listAgents']);
 const writes=calls.filter(x=>x.url.endsWith('/UpdateGrokBotUserRuntimeSettings'));
 assert.equal(writes.length,1);
 assert.deepEqual(writes[0].body,{sidebarSections:{sections:next.sections},pinnedAgents:{agentIds:next.pins},sidebarSectionsBase:{sections:original.sections}});
 await assert.rejects(gateway.updateOrganization(original,original),/Groups changed/);
 await assert.rejects(gateway.updateOrganization({...next,pins:['foreign-agent']},next),/Agent unavailable/);
 assert.equal(calls.filter(x=>x.url.endsWith('/UpdateGrokBotUserRuntimeSettings')).length,1);
});

test('0.77 Connect Aborted conflicts stop without host writes or automatic retries',async()=>{
 const {gateway,calls,commands}=cloudFixture({conflict:true});
 const next={...original,sections:[{...original.sections[0],name:'Renamed'}]};
 await assert.rejects(gateway.updateOrganization(next,original),error=>error.code==='invalid_request'&&error.message.includes('Groups changed')&&!error.message.includes('private'));
 assert.equal(calls.filter(x=>x.url.endsWith('/UpdateGrokBotUserRuntimeSettings')).length,1);
 assert.deepEqual(commands,['listAgents']);
 assert.deepEqual(await gateway.organization(),original);
});

test('0.77 mismatched server confirmation stays uncertain without retrying the mutation',async()=>{
 const {gateway,calls,commands}=cloudFixture({confirmMismatch:true});
 const next={...original,sections:[{...original.sections[0],name:'Renamed'}]};
 await assert.rejects(gateway.updateOrganization(next,original),error=>error.code==='invalid_response');
 assert.equal(calls.filter(x=>x.url.endsWith('/UpdateGrokBotUserRuntimeSettings')).length,1);
 assert.deepEqual(commands,['listAgents']);
});

test('runtime base snapshots cannot cross an account, team, or version change',async()=>{
 for(const change of [{accountScope:'other'},{teamId:'other'},{appVersion:'0.75.8'}]){
  let auth={accountScope:'a',teamId:'123',appVersion:'0.77.0',token:'fixture'},calls=0;
  const runtime=createRuntimeSettings({session:async()=>auth,fetchImpl:async()=>{calls++;return Response.json({settings:{sidebarSections:{sections:original.sections},pinnedAgents:{agentIds:original.pins}}});}});
  const base=await runtime.readSnapshot();auth={...auth,...change};
  await assert.rejects(runtime.writeSnapshot(original,base),error=>error.code==='account-changed');
  assert.equal(calls,1);
 }
});

test('runtime writes require an authentic read snapshot and retain the actual base despite caller mutation',async()=>{
 const {runtime,calls}=cloudFixture();
 await assert.rejects(runtime(original),error=>error.code==='invalid-organization');
 await assert.rejects(runtime.writeSnapshot(original,{organization:original,sectionsPresent:true,appVersion:'0.77.0'}),error=>error.code==='account-changed');
 assert.equal(calls.length,0);
 const base=await runtime.readSnapshot();base.organization.sections[0].name='Tampered';
 await runtime.writeSnapshot(original,base);
 assert.deepEqual(calls[1].body.sidebarSectionsBase,{sections:original.sections});
});

test('malformed cloud sections fail closed instead of selecting potentially stale host data',async()=>{
 for(const sidebarSections of [null,[],{sections:{}},{sections:[{id:'work',name:'Work',agentIds:'agent'}]}]){
  const {gateway,commands}=cloudFixture();
  gateway.runtimeSettings=createRuntimeSettings({session:async()=>({accountScope:'a',appVersion:'0.77.0',token:'fixture'}),fetchImpl:async()=>Response.json({settings:{sidebarSections}})});
  await assert.rejects(gateway.organization(),error=>error.code==='organization-unavailable');
  assert.deepEqual(commands,[]);
 }
});

test('0.77 empty group saves still require explicit server confirmation',async()=>{
 let calls=0;
 const runtime=createRuntimeSettings({session:async()=>({accountScope:'a',appVersion:'0.77.0',token:'fixture'}),fetchImpl:async()=>Response.json({settings:++calls===1?{sidebarSections:{},pinnedAgents:{}}:{}})});
 const base=await runtime.readSnapshot();
 await assert.rejects(runtime.writeSnapshot({sections:[],pins:[]},base),error=>error.code==='organization-unavailable');
 assert.equal(calls,2);
});
