import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
const {responseForAsset,readAsset,verifyFile,downloadFile,downloadInstaller,launchInstaller}=createRequire(import.meta.url)('../desktop/update-download.cjs');
const data=Buffer.from('inert fixture installer, never executed');
const asset={id:123,name:'GrokDeck-0.3.0-rc.5-win-x64.exe',size:data.length,sha256:createHash('sha256').update(data).digest('hex'),url:'https://api.github.com/repos/Gamedesigner/grokdeck/releases/assets/123',downloadUrl:'https://github.com/Gamedesigner/grokdeck/releases/download/v0.3.0-rc.5/GrokDeck-0.3.0-rc.5-win-x64.exe'};
const response=()=>new Response(data,{headers:{'content-length':String(data.length)}});
async function temporary(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'grokdeck-test-update-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}
test('authenticated asset redirect strips credentials at exact allowlisted CDN host',async()=>{
  let calls=0;
  const fetcher=async(url,options)=>{calls++;assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
    if(calls===1){assert.equal(url,asset.url);assert.equal(options.headers.Authorization,'Bearer fixture-secret');return new Response('',{status:302,headers:{location:'https://release-assets.githubusercontent.com/fixed-id?signature=opaque'}});}
    assert.equal(options.headers.Authorization,undefined);assert.equal(url,'https://release-assets.githubusercontent.com/fixed-id?signature=opaque');return response();};
  assert.equal(await readAsset(asset,{fetcher,token:'fixture-secret'}),data.toString());assert.equal(calls,2);
});
test('redirects to an arbitrary host, credentials, HTTP, or original API fail before forwarding',async()=>{
  for(const target of ['https://evil.test/payload','http://release-assets.githubusercontent.com/a','https://user:pass@release-assets.githubusercontent.com/a','https://api.github.com/repos/Gamedesigner/grokdeck/releases/assets/123','https://release-assets.githubusercontent.com.evil.test/a']){
    let calls=0;await assert.rejects(readAsset(asset,{token:'secret',fetcher:async()=>{calls++;return new Response('',{status:302,headers:{location:target}});}}));assert.equal(calls,1);
  }
  let calls=0;await assert.rejects(responseForAsset({...asset,downloadUrl:'https://evil.test/a'},{fetcher:async()=>{calls++;return response();}}));assert.equal(calls,0);
});
test('size, chunked overflow, truncated body, digest, and redirect loops are rejected',async()=>{
  for(const fetcher of [async()=>new Response(data,{headers:{'content-length':String(data.length+1)}}),async()=>new Response(Buffer.concat([data,Buffer.from('extra')])),async()=>new Response(data.subarray(1)),async()=>new Response(Buffer.alloc(data.length)),async()=>new Response('',{status:302,headers:{location:'https://release-assets.githubusercontent.com/loop'}})])await assert.rejects(readAsset(asset,{fetcher}));
});
test('Windows download is private, exclusive and verified; errors clean partial downloads',async t=>{
  const directory=await temporary(t),ticket=await downloadInstaller(asset,{directory,fetcher:async()=>response()});
  assert.equal(path.basename(ticket.file),asset.name);assert.equal((await fs.readFile(ticket.file)).equals(data),true);await verifyFile(ticket.file,asset);
  if(process.platform!=='win32'){assert.equal((await fs.stat(ticket.root)).mode&0o777,0o700);assert.equal((await fs.stat(ticket.file)).mode&0o777,0o500);}
  await assert.rejects(downloadInstaller(asset,{directory,fetcher:async()=>new Response('invalid')}));assert.deepEqual(await fs.readdir(directory),[path.basename(ticket.root)]);
});
test('Mac cache download enforces SHA256, SHA512 and size while streaming',async t=>{
  const directory=await temporary(t),file=path.join(directory,'update.zip'),sha512=createHash('sha512').update(data).digest('base64');
  await downloadFile(asset,file,{fetcher:async()=>response(),sha512});assert.equal((await fs.readFile(file)).equals(data),true);
  await assert.rejects(downloadFile(asset,file,{fetcher:async()=>response(),sha512}));
  const bad=path.join(directory,'bad.zip');await assert.rejects(downloadFile(asset,bad,{fetcher:async()=>response(),sha512:'bad'}));await assert.rejects(fs.stat(bad));
  await assert.rejects(downloadFile(asset,bad,{fetcher:async()=>new Response(Buffer.concat([data,data])),sha512}));await assert.rejects(fs.stat(bad));
  const abort=new AbortController();abort.abort();let fetched=false;
  await assert.rejects(downloadFile(asset,bad,{signal:abort.signal,fetcher:async()=>{fetched=true;return response();}}));assert.equal(fetched,false);await assert.rejects(fs.stat(bad));
});
test('tampered files, symlinks and hard links cannot be launched',async t=>{
  const directory=await temporary(t),ticket=await downloadInstaller(asset,{directory,fetcher:async()=>response()});let launched=0;
  await fs.chmod(ticket.file,0o600);await fs.writeFile(ticket.file,Buffer.alloc(data.length));
  await assert.rejects(launchInstaller(ticket,{app:{quit:()=>{}},spawnImpl:()=>{launched++;}}));assert.equal(launched,0);
  await fs.writeFile(ticket.file,data);const alias=path.join(directory,'alias');await fs.link(ticket.file,alias);await assert.rejects(verifyFile(ticket.file,asset));await fs.unlink(alias);
  if(process.platform!=='win32'){await fs.rename(ticket.file,alias);await fs.symlink(alias,ticket.file);await assert.rejects(verifyFile(ticket.file,asset));}
});
test('launcher uses literal verified path without shell; quits only after spawn succeeds',async t=>{
  const directory=await temporary(t),ticket=await downloadInstaller(asset,{directory,fetcher:async()=>response()});let quit=0,unref=0,launched=0;
  const spawnImpl=(file,args,options)=>{launched++;assert.equal(file,ticket.file);assert.deepEqual(args,['/currentuser']);assert.equal(options.shell,false);assert.equal(options.detached,true);const child=new EventEmitter();child.unref=()=>unref++;queueMicrotask(()=>child.emit('spawn'));return child;};
  const app={quit:()=>quit++};await launchInstaller(ticket,{app,spawnImpl});assert.equal(quit,1);assert.equal(unref,1);
  await assert.rejects(launchInstaller(ticket,{app,spawnImpl,canQuit:()=>false}));assert.equal(launched,1);
  await assert.rejects(launchInstaller(ticket,{app,spawnImpl:()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',new Error('fixture failure')));return child;}}));assert.equal(quit,1);
});
