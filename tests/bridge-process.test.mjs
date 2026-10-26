import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const {createBridgeProcess}=createRequire(import.meta.url)('../desktop/bridge-process.cjs');
function fixture({initiallyReady=false,start=true}={}) {
  let ready=initiallyReady,spawned=0,killed=0,time=0;
  const child=new EventEmitter();child.kill=()=>{killed++;child.emit('exit',0);};
  const manager=createBridgeProcess({app:{getAppPath:()=>'/own/app.asar'},
    client:{health:async()=>{if(!ready)throw new Error('offline');}},
    spawnImpl:(exe,args,options)=>{
      spawned++;assert.equal(exe,process.execPath);assert.deepEqual(args,['/own/app.asar','--grokdeck-live-helper']);
      assert.equal(options.env.GROKDECK_HELPER,'live');assert.equal(options.env.ELECTRON_RUN_AS_NODE,undefined);
      assert.equal(options.stdio,'ignore');if(start)ready=true;return child;
    },now:()=>time,sleep:async()=>{time+=300;},timeout:1000});
  return {manager,child,counts:()=>({spawned,killed})};
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
