import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const {createAppUpdates}=createRequire(import.meta.url)('../desktop/app-updates.cjs');
function fixture(extra={}) {
  const updater=new EventEmitter();let checks=0,downloads=0,installs=0;
  updater.setFeedURL=options=>{assert.equal(options.repo,'grokdeck');updater.feed=options;};
  updater.checkForUpdates=async()=>{checks++;return {updateInfo:{version:'0.3.0'}};};
  updater.downloadUpdate=async()=>{downloads++;updater.emit('update-downloaded');};
  updater.quitAndInstall=()=>installs++;
  const controller=createAppUpdates({currentVersion:'0.2.0',updater,tokenProvider:async()=>'fixture-secret',supported:async()=>true,
    fetcher:async(url,options)=>{assert.equal(url,'https://api.github.com/repos/Gamedesigner/grokdeck/releases/latest');assert.equal(options.redirect,'error');return Response.json({tag_name:'v0.3.0',draft:false,prerelease:false});},...extra});
  return {controller,updater,counts:()=>({checks,downloads,installs})};
}
test('private update check never downloads or leaks token; download and restart are separate',async()=>{
  const f=fixture();const status=await f.controller.check();
  assert.equal(status.status,'available');assert.equal(status.canInstall,true);
  assert.equal(JSON.stringify(status).includes('fixture-secret'),false);
  assert.equal(f.updater.feed.private,true);
  assert.equal(f.updater.autoDownload,false);assert.equal(f.updater.autoInstallOnAppQuit,false);
  assert.throws(()=>f.controller.install());
  assert.deepEqual(f.counts(),{checks:1,downloads:0,installs:0});
  await f.controller.download();assert.equal(f.controller.status().status,'downloaded');
  f.controller.install();assert.equal(f.counts().installs,1);
});
test('unsigned builds and missing private access cannot install, and 404 is not current',async()=>{
  for(const extra of [{supported:async()=>false},{tokenProvider:async()=>null,fetcher:async()=>new Response('',{status:404})},{fetcher:async()=>new Response('',{status:404})}]){
    const f=fixture(extra);const state=await f.controller.check();
    assert.equal(state.canInstall,false);assert.notEqual(state.status,'current');
    await assert.rejects(f.controller.download());assert.throws(()=>f.controller.install());
    assert.equal(f.counts().downloads,0);
  }
});
test('future public releases can update without GitHub credentials or a bundled token',async()=>{
  const f=fixture({tokenProvider:async()=>null,fetcher:async(url,options)=>{
    assert.equal(options.headers.Authorization,undefined);
    return Response.json({tag_name:'v0.3.0',draft:false,prerelease:false});
  }});
  assert.equal((await f.controller.check()).canInstall,true);
  assert.equal(f.updater.feed.private,false);
  assert.equal('token' in f.updater.feed,false);
  await f.controller.download();f.controller.install();
  assert.equal(f.counts().installs,1);
});
test('restart is blocked while any message delivery is unresolved',async()=>{
  const f=fixture({hasPendingSends:()=>true});await f.controller.check();await f.controller.download();
  assert.throws(()=>f.controller.install());assert.equal(f.counts().installs,0);
});
test('release mismatch, malformed versions, prereleases and failures fail closed',async()=>{
  for(const body of [{tag_name:'garbage'},{tag_name:'v0.3.0',draft:true},{tag_name:'v0.3.0',prerelease:true},{tag_name:'v0.4.0'}]){
    const f=fixture({fetcher:async()=>Response.json(body)});
    assert.equal((await f.controller.check()).status,'unavailable');await assert.rejects(f.controller.download());
  }
  const f=fixture({fetcher:async()=>{throw new Error('fixture-secret');}});
  assert.equal(JSON.stringify(await f.controller.check()).includes('fixture-secret'),false);
});
test('checks coalesce and cannot reset an in-progress download',async()=>{
  const f=fixture();await Promise.all([f.controller.check(),f.controller.check()]);assert.equal(f.counts().checks,1);
  let finish;f.updater.downloadUpdate=()=>new Promise(resolve=>finish=resolve);
  const download=f.controller.download();assert.equal(f.controller.status().status,'downloading');
  assert.equal((await f.controller.check(true)).status,'downloading');
  await assert.rejects(f.controller.download());finish();await download;
  assert.throws(()=>f.controller.install());
});
