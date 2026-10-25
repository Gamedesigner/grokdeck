import test from 'node:test';
import assert from 'node:assert/strict';
import {loadComputers} from '../bridge/computers.mjs';
import {createGateway} from '../bridge/gateway.mjs';
const connection={baseUrl:'https://fixture.us8.cursorvm.com',token:'fixture',accountScope:'fixture-scope'};
test('computer adapter reads exact status method and validates ownership and windows',async()=>{
  const seen=[];
  const gateway=createGateway({resolveConnection:async()=>connection,getAccountScope:async()=>connection.accountScope,fetchImpl:async(url,options)=>{
    seen.push({url,options});return Response.json({agentId:'agent-one',state:'running',vncUrl:'https://private.test/?credential=never-export',windows:[{windowIndex:0,vncUrl:'private-window'}]});
  }});
  assert.equal((await gateway.computer('agent-one')).state,'running');
  assert.equal(seen[0].url,`${connection.baseUrl}/api/getForeverBoxStatus`);
  assert.deepEqual(JSON.parse(seen[0].options.body),{id:'agent-one'});
  const invalid=createGateway({resolveConnection:async()=>connection,getAccountScope:async()=>connection.accountScope,fetchImpl:async()=>Response.json({agentId:'other',state:'running',vncUrl:null})});
  await assert.rejects(invalid.computer('agent-one'),{code:'invalid_response'});
});
test('computer status accepts absent/null and rejects unknown states or unsafe window shapes',async()=>{
  for(const value of [null,{agentId:'one',state:'absent',vncUrl:null}]){
    const g=createGateway({resolveConnection:async()=>connection,fetchImpl:async()=>Response.json(value)});
    assert.deepEqual(await g.computer('one'),value);
  }
  for(const patch of [{state:'starting'},{windows:[{windowIndex:-1,vncUrl:'secret'}]},{windows:[{windowIndex:0,vncUrl:42}]}]){
    const g=createGateway({resolveConnection:async()=>connection,fetchImpl:async()=>Response.json({agentId:'one',state:'running',vncUrl:null,...patch})});
    await assert.rejects(g.computer('one'),{code:'invalid_response'});
  }
});
test('computer aggregation has bounded concurrency and strips every remote credential field',async()=>{
  let inflight=0,maximum=0;
  const gateway={roster:async()=>Array.from({length:8},(_,i)=>({id:`agent-${i}`,name:`Desk ${i}`})),computer:async id=>{
    maximum=Math.max(maximum,++inflight);await new Promise(r=>setTimeout(r,3));inflight--;
    return {agentId:id,state:'running',vncUrl:'https://secret/?token=credential',gatewayToken:'credential',windows:[{windowIndex:0,vncUrl:'private-window-url',token:'credential'}]};
  }};
  const value=await loadComputers(gateway,{now:()=>123});
  assert.equal(maximum,3);assert.equal(value.complete,true);assert.equal(value.computers.length,8);
  assert.deepEqual(value.computers[0],{agentId:'agent-0',name:'Desk 0',state:'running',windows:[{index:0,label:'Desktop 1'}],checkedAt:123});
  assert.doesNotMatch(JSON.stringify(value),/secret|credential|vnc|token|private-window/i);
});
test('partial failures and unreported null statuses remain unknown; only explicit absence is absent',async()=>{
  const gateway={roster:async()=>[{id:'one',name:'One'},{id:'two',name:'Two'},{id:'three',name:'Three'},{id:'group',name:'Group',isGroup:true}],computer:async id=>{if(id==='one')return null;if(id==='three')return {agentId:id,state:'absent',vncUrl:null};throw new Error('token private URL');}};
  const result=await loadComputers(gateway);
  assert.equal(result.complete,false);assert.equal(result.computers.length,3);
  assert.equal(result.computers[0].state,'unknown');assert.equal(result.computers[0].error,'status-not-reported');assert.equal(result.computers[1].state,'unknown');assert.equal(result.computers[2].state,'absent');
  assert.equal(result.computers[1].error,'status-unavailable');assert.doesNotMatch(JSON.stringify(result),/token|private URL/);
});
test('budget ends status collection, aborts in-flight reads and stops new scheduling',async()=>{
  let started=0,aborted=0;
  const gateway={roster:async()=>Array.from({length:20},(_,i)=>({id:`agent-${i}`,name:'Desk'})),computer:async(_, {signal})=>{
    started++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(new Error('aborted'));},{once:true}));
  }};
  const result=await loadComputers(gateway,{budgetMs:10});
  assert.equal(started,3);assert.equal(aborted,3);assert.equal(result.complete,false);
  assert.ok(result.computers.every(r=>r.state==='unknown'&&r.error==='not-checked'));
});
