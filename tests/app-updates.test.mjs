import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {createAppUpdates,readReleaseList,selectedMacProvider}=require('../desktop/app-updates.cjs');
const {API,parseVersion,compareVersions,selectRelease,macManifest}=require('../desktop/update-release.cjs');
const bytes=Buffer.from('fixture update'),sha512=createHash('sha512').update(bytes).digest('base64');
function release(version='0.3.0-rc.5',platform='win32',arch='x64') {
  const name=`GrokDeck-${version}-${platform==='darwin'?'mac':'win'}-${arch}.${platform==='darwin'?'zip':'exe'}`;
  const body={tag_name:`v${version}`,draft:false,prerelease:version.includes('-'),assets:[]};
  function add(name,data){body.assets.push({id:body.assets.length+1,name,state:'uploaded',size:data.length,digest:`sha256:${createHash('sha256').update(data).digest('hex')}`,url:`${API}/releases/assets/${body.assets.length+1}`,browser_download_url:`https://github.com/Gamedesigner/grokdeck/releases/download/v${version}/${name}`});}
  add(name,bytes);
  let manifest;
  if(platform==='darwin'){manifest=JSON.stringify({version,files:[{url:name,size:bytes.length,sha512}],path:name,sha512,minimumSystemVersion:'20.0.0'});add('latest-mac.yml',Buffer.from(manifest));}
  return {body,manifest};
}
function fixture(extra={}) {
  const platform=extra.platform||'win32',r=release('0.3.0-rc.5',platform);
  const updater=new EventEmitter();let checks=0,downloads=0,installs=0,verifications=0,requests=0;
  updater.httpExecutor={download:()=>{throw new Error('Unbounded download was used');}};
  const original=updater.httpExecutor.download;
  updater.setFeedURL=options=>{updater.feed=options;};
  updater.checkForUpdates=async()=>{checks++;return {isUpdateAvailable:true,updateInfo:{version:'0.3.0-rc.5'}};};
  updater.downloadUpdate=async()=>{downloads++;await updater.httpExecutor.download(new URL(r.body.assets[0].browser_download_url),'/fixture/update.zip',{sha512});updater.emit('update-downloaded',{downloadedFile:'/fixture/update.zip'});return ['/fixture/update.zip'];};
  updater.quitAndInstall=()=>installs++;
  const io={readAsset:async()=>r.manifest,downloadFile:async()=>{},verifyFile:async()=>{verifications++;},
    downloadInstaller:async asset=>{downloads++;return {file:'/fixture/update.exe',root:'/fixture',asset};},
    launchInstaller:async(_ticket,{canQuit})=>{assert.equal(canQuit(),true);installs++;}};
  const app={isPackaged:true,getPath:()=>'/fixture/temp',quit:()=>{}};
  const controller=createAppUpdates({currentVersion:'0.3.0-rc.4',updater,app,platform,arch:'x64',io,tokenProvider:async()=>{throw new Error('Public checks should not request a token');},supported:async()=>true,
    fetcher:async(url,options)=>{requests++;assert.equal(url,`${API}/releases?per_page=100`);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);return Response.json([r.body]);},...extra});
  return {controller,updater,io,app,r,original,counts:()=>({checks,downloads,installs,verifications,requests})};
}
test('preview semver orders numeric identifiers; stable never follows preview or downgrades',()=>{
  const ordered=['0.3.0-alpha','0.3.0-alpha.1','0.3.0-beta','0.3.0-rc.2','0.3.0-rc.10','0.3.0','0.3.1'];
  for(let i=1;i<ordered.length;i++)assert.equal(compareVersions(ordered[i-1],ordered[i]),-1);
  for(const bad of ['0.03.0','0.3','0.3.0-rc.01','0.3.0+build','https://evil.test/0.3.0'])assert.equal(parseVersion(bad),null);
  const releases=['0.2.5','0.3.0-rc.5','0.3.0-rc.10'].map(v=>release(v).body);
  assert.equal(selectRelease(releases,{currentVersion:'0.3.0-rc.4',platform:'win32',arch:'x64'}).version,'0.3.0-rc.10');
  assert.equal(selectRelease(releases,{currentVersion:'0.2.5',platform:'win32',arch:'x64'}),null);
  assert.equal(selectRelease(releases,{currentVersion:'0.3.0-rc.10',platform:'win32',arch:'x64'}),null);
});
test('release selection is specific to device; duplicate or malformed matching assets fail closed',()=>{
  const mac=release('0.3.0-rc.5','darwin','arm64').body,win=release('0.3.0-rc.6').body;
  const options={currentVersion:'0.3.0-rc.4',platform:'darwin',arch:'arm64'};
  assert.equal(selectRelease([win,mac],options).version,'0.3.0-rc.5');assert.equal(selectRelease([win],options),null);
  for(const mutate of [r=>r.assets.push({...r.assets[0]}),r=>r.assets[0].digest=null,r=>r.assets[0].size=2**40,r=>r.assets[0].url='https://evil.test',r=>r.assets[0].browser_download_url+='?token=secret']){
    const bad=structuredClone(mac);mutate(bad);assert.throws(()=>selectRelease([bad],options));
  }
  assert.throws(()=>selectRelease([mac,mac],options));
});
test('Mac manifests pin exact release assets and preserve the OS floor',()=>{
  const r=release('0.3.0-rc.5','darwin'),candidate=selectRelease([r.body],{currentVersion:'0.3.0-rc.4',platform:'darwin',arch:'x64'});
  const info=macManifest(r.manifest,candidate);assert.equal(info.minimumSystemVersion,'20.0.0');
  for(const mutate of [m=>m.version='0.9.0',m=>m.files[0].url='https://evil.test/app.zip',m=>m.files[0].size++,m=>m.files.push(m.files[0]),m=>m.sha512='bad',m=>m.minimumSystemVersion='invalid']){
    const bad=JSON.parse(r.manifest);mutate(bad);assert.throws(()=>macManifest(JSON.stringify(bad),candidate));
  }
  const Provider=selectedMacProvider(info,candidate.asset,new URL(candidate.asset.downloadUrl));
  const provider=new Provider({},null,{executor:{},platform:'darwin'});
  assert.equal(provider.resolveFiles(info)[0].url.href,candidate.asset.downloadUrl);assert.equal(provider.fileExtraDownloadHeaders,null);assert.throws(()=>provider.resolveFiles({version:'9.9.9'}));
});
test('public unsigned Windows update has separate verified download and explicit install steps',async()=>{
  const f=fixture(),state=await f.controller.check();
  assert.equal(state.status,'available');assert.equal(state.canInstall,true);assert.equal(state.installKind,'windows-installer');assert.match(state.message,/Unknown publisher/);
  assert.equal(f.updater.autoDownload,false);assert.equal(f.updater.autoInstallOnAppQuit,false);assert.equal(f.updater.allowDowngrade,false);
  await assert.rejects(f.controller.install());assert.equal(f.counts().downloads,0);
  await f.controller.download();assert.equal(f.controller.status().status,'downloaded');assert.equal(f.counts().installs,0);
  await f.controller.install();assert.equal(f.counts().installs,1);assert.equal(f.counts().verifications,1);
  const serialized=JSON.stringify(f.controller.status());assert.equal(serialized.includes('/fixture'),false);assert.equal(serialized.includes('https://'),false);
});
test('Mac download keeps native updater, uses bounded transport, and verifies before restart',async()=>{
  const f=fixture({platform:'darwin'});let bounded=0;
  f.io.downloadFile=async(asset,file,options)=>{bounded++;assert.equal(asset.name,'GrokDeck-0.3.0-rc.5-mac-x64.zip');assert.equal(options.sha512,sha512);};
  await f.controller.check();await f.controller.download();
  assert.equal(f.controller.status().status,'downloaded');assert.equal(bounded,1);assert.equal(f.updater.feed.provider,'custom');assert.equal(f.updater.requestHeaders,null);assert.equal(f.updater.httpExecutor.download,f.original);
  assert.equal(f.counts().installs,0);await f.controller.install();assert.equal(f.counts().installs,1);assert.equal(f.counts().verifications,2);
});
test('Mac download accepts the updater string-array result and restores its executor after cancellation or failure',async()=>{
  const f=fixture({platform:'darwin'});f.updater.downloadUpdate=async()=>['/fixture/update.zip'];
  await f.controller.check();await f.controller.download();assert.equal(f.controller.status().status,'downloaded');assert.equal(f.updater.httpExecutor.download,f.original);
  for(const cancel of [false,true]){
    const g=fixture({platform:'darwin'}),token=new EventEmitter();token.onCancel=listener=>token.once('cancel',listener);
    g.io.downloadFile=async(_asset,_path,{signal})=>{if(cancel){token.emit('cancel');assert.equal(signal.aborted,true);}throw new Error('fixture download failure');};
    g.updater.downloadUpdate=async()=>g.updater.httpExecutor.download(new URL(g.r.body.assets[0].browser_download_url),'/fixture/update.zip',{sha512,cancellationToken:token});
    await g.controller.check();await g.controller.download();assert.equal(g.controller.status().status,'unavailable');assert.equal(g.updater.httpExecutor.download,g.original);assert.equal(token.listenerCount('cancel'),0);
  }
});
test('private credentials are retrieved only after access failure and never enter renderer status',async()=>{
  let calls=0,tokens=0;
  const f=fixture({tokenProvider:async()=>{tokens++;return 'fixture-secret';},fetcher:async(url,options)=>{
    calls++;assert.equal(options.headers.Authorization,calls===1?undefined:'Bearer fixture-secret');return calls===1?new Response('',{status:404}):Response.json([release().body]);}});
  assert.equal((await f.controller.check()).status,'available');assert.equal(tokens,1);
  f.io.downloadInstaller=async(asset,options)=>{assert.equal(options.token,'fixture-secret');throw new Error(`fixture-secret ${asset.downloadUrl}`);};
  await f.controller.download();assert.equal(f.controller.status().status,'unavailable');assert.equal(JSON.stringify(f.controller.status()).includes('fixture-secret'),false);
});
test('development Windows, unsigned Mac, and inaccessible releases cannot install',async()=>{
  for(const extra of [{app:{isPackaged:false}},{platform:'darwin',supported:async()=>false},{tokenProvider:async()=>null,fetcher:async()=>new Response('',{status:404})}]){
    const f=fixture(extra),state=await f.controller.check();assert.equal(state.canInstall,false);assert.notEqual(state.status,'current');
    await assert.rejects(f.controller.download());await assert.rejects(f.controller.install());assert.equal(f.counts().downloads,0);
  }
});
test('unresolved sends block install both before and after verification, and duplicate clicks cannot install twice',async()=>{
  let waiting=true;const f=fixture({hasPendingSends:()=>waiting});await f.controller.check();await f.controller.download();
  await assert.rejects(f.controller.install());assert.equal(f.counts().installs,0);assert.equal(f.controller.status().status,'downloaded');
  waiting=false;let finish;f.io.verifyFile=()=>new Promise(resolve=>finish=resolve);
  const installing=f.controller.install();await assert.rejects(f.controller.install());waiting=true;finish();await assert.rejects(installing);assert.equal(f.counts().installs,0);
});
test('Mac OS floor, version mismatch, hash failure, and updater error events prevent installation',async()=>{
  for(const alter of [f=>f.updater.checkForUpdates=async()=>({isUpdateAvailable:false,updateInfo:{version:'0.3.0-rc.5'}}),f=>f.updater.checkForUpdates=async()=>({isUpdateAvailable:true,updateInfo:{version:'9.9.9'}}),f=>f.io.verifyFile=async()=>{throw new Error('Digest mismatch');},f=>f.io.downloadFile=async()=>f.updater.emit('error',new Error('fixture-secret'))]){
    const f=fixture({platform:'darwin'});alter(f);await f.controller.check();await f.controller.download();assert.equal(f.controller.status().status,'unavailable');
    await assert.rejects(f.controller.install());assert.equal(f.counts().installs,0);assert.equal(f.updater.httpExecutor.download,f.original);
  }
});
test('checks coalesce and cannot reset a download or a prepared update',async()=>{
  const f=fixture();await Promise.all([f.controller.check(),f.controller.check()]);assert.equal(f.counts().requests,1);
  let finish;f.io.downloadInstaller=asset=>new Promise(resolve=>finish=()=>resolve({file:'/fixture/update.exe',asset}));
  const download=f.controller.download();assert.equal((await f.controller.check(true)).status,'downloading');await assert.rejects(f.controller.download());finish();await download;
  assert.equal((await f.controller.check(true)).status,'downloaded');assert.equal(f.counts().requests,1);
});
test('release metadata is bounded even when chunked without Content-Length',async()=>{
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(2*1024*1024+1));c.close();}});await assert.rejects(readReleaseList(new Response(stream)));
  await assert.rejects(readReleaseList(new Response('[]',{headers:{'content-length':2*1024*1024+1}})));
});
test('actual electron-updater Mac cache pipeline uses the bounded transport with auto-install disabled',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'grokdeck-mac-update-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const native=new EventEmitter();let nativeChecks=0;native.checkForUpdates=()=>nativeChecks++;
  const electronPath=require.resolve('electron'),previous=require.cache[electronPath];
  require.cache[electronPath]={exports:{autoUpdater:native}};
  let updater;
  try{
    const {MacUpdater}=require('electron-updater/out/MacUpdater');
    updater=new MacUpdater(null,{version:'0.3.0-rc.4',name:'GrokDeckFixture',isPackaged:true,userDataPath:directory,baseCachePath:directory,whenReady:async()=>{}});
  }finally{if(previous)require.cache[electronPath]=previous;else delete require.cache[electronPath];}
  updater.configOnDisk={value:Promise.resolve({updaterCacheDirName:'grokdeck-fixture-cache'})};
  updater.stagingUserIdPromise={value:Promise.resolve('00000000-0000-4000-8000-000000000000')};
  const original=()=>{throw new Error('Unbounded updater HTTP download');};updater.httpExecutor={download:original};
  // Exercise the installed library's provider/cache/download code, while
  // replacing only the final native Squirrel handoff so this test cannot install.
  updater.updateDownloaded=async(_info,event)=>updater.dispatchUpdateDownloaded(event);
  const r=release('0.3.0-rc.5','darwin',process.arch),manifest=JSON.parse(r.manifest);delete manifest.minimumSystemVersion;
  r.manifest=JSON.stringify(manifest);r.body.assets[1].size=Buffer.byteLength(r.manifest);r.body.assets[1].digest=`sha256:${createHash('sha256').update(r.manifest).digest('hex')}`;
  const controller=createAppUpdates({currentVersion:'0.3.0-rc.4',updater,platform:'darwin',arch:process.arch,supported:async()=>true,
    fetcher:async url=>url===`${API}/releases?per_page=100`?Response.json([r.body]):new Response(url.endsWith('latest-mac.yml')?r.manifest:bytes)});
  assert.equal((await controller.check()).status,'available');assert.equal((await controller.download()).status,'downloaded');
  assert.equal(updater.httpExecutor.download,original);assert.equal(nativeChecks,0);assert.equal(updater.autoInstallOnAppQuit,false);
  const cached=path.join(directory,'grokdeck-fixture-cache','pending',r.body.assets[0].name);assert.equal((await fs.readFile(cached)).equals(bytes),true);
});
