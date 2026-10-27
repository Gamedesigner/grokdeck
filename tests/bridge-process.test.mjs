import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const {createBridgeProcess}=createRequire(import.meta.url)('../desktop/bridge-process.cjs');
function fixture({initiallyReady=false,start=true}={}) {
  let ready=initiallyReady,spawned=0,killed=0,time=0,pendingSends=false;
  const children=[];
  const manager=createBridgeProcess({app:{getAppPath:()=>'/own/app.asar'},
    client:{health:async()=>{if(!ready)throw new Error('offline');}},
    spawnImpl:(exe,args,options)=>{
      spawned++;assert.equal(exe,process.execPath);assert.deepEqual(args,['/own/app.asar','--grokdeck-live-helper']);
      assert.equal(options.env.GROKDECK_HELPER,'live');assert.equal(options.env.ELECTRON_RUN_AS_NODE,undefined);
      assert.equal(options.stdio,'ignore');if(start)ready=true;
      const child=new EventEmitter();child.kill=()=>{killed++;child.emit('exit',0);return true;};children.push(child);return child;
    },now:()=>time,sleep:async ms=>{time+=ms;},timeout:1000,hasPendingSends:()=>pendingSends});
  return {manager,children,counts:()=>({spawned,killed}),setReady:value=>{ready=value;},setPending:value=>{pendingSends=value;}};
}
test('existing independently running bridge is reused and never killed',async()=>{
  const f=fixture({initiallyReady:true});await f.manager.ensure();f.manager.stop();
  assert.deepEqual(f.counts(),{spawned:0,killed:0});
});
test('concurrent connections spawn one packaged helper and stop only that helper',async()=>{
  const f=fixture();await Promise.all([f.manager.ensure(),f.manager.ensure()]);
  assert.deepEqual(f.counts(),{spawned:1,killed:0});f.manager.stop();assert.equal(f.counts().killed,1);
  await assert.rejects(f.manager.ensure());
});
test('unresponsive startup is bounded, cleaned up, and permits an explicit retry',async()=>{
  const f=fixture({start:false});await assert.rejects(f.manager.ensure());
  assert.deepEqual(f.counts(),{spawned:1,killed:1});
  await assert.rejects(f.manager.ensure());assert.deepEqual(f.counts(),{spawned:2,killed:2});
});
test('an unhealthy owned helper is replaced within the same reconnect attempt',async()=>{
  const f=fixture();await f.manager.ensure();f.setReady(false);
  await Promise.all([f.manager.ensure(),f.manager.ensure()]);
  assert.deepEqual(f.counts(),{spawned:2,killed:1});
  f.manager.stop();assert.deepEqual(f.counts(),{spawned:2,killed:2});
});
test('automatic recovery retains the helper while a send is unsettled',async()=>{
  const f=fixture();await f.manager.ensure();f.setReady(false);f.setPending(true);
  await assert.rejects(f.manager.ensure(),/message is still awaiting confirmation/);
  assert.deepEqual(f.counts(),{spawned:1,killed:0});
  f.setPending(false);await f.manager.ensure();
  assert.deepEqual(f.counts(),{spawned:2,killed:1});
});
test('startup timeout cleanup does not terminate a helper with an unsettled send',async()=>{
  const f=fixture({start:false});f.setPending(true);
  await assert.rejects(f.manager.ensure(),/message is still awaiting confirmation/);
  assert.deepEqual(f.counts(),{spawned:1,killed:0});
});
test('replacement waits for owned process exit and never overlaps helpers',async()=>{
  let ready=false,time=0,spawned=0,killCalls=0,retiring,allowExit=false;
  const manager=createBridgeProcess({app:{getAppPath:()=>'/own/app.asar'},
    client:{health:async()=>{if(!ready)throw Error('offline');}},
    spawnImpl:()=>{assert.equal(retiring,undefined);spawned++;ready=true;const child=new EventEmitter();child.kill=()=>{killCalls++;retiring=child;return true;};return child;},
    now:()=>time,sleep:async ms=>{time+=ms;if(retiring&&allowExit){const child=retiring;retiring=undefined;child.emit('exit',0);}},timeout:1000});
  await manager.ensure();ready=false;
  await assert.rejects(manager.ensure(),/still stopping/);
  assert.equal(spawned,1);assert.equal(killCalls,1);
  allowExit=true;await manager.ensure();
  assert.equal(spawned,2);assert.equal(retiring,undefined);
});
