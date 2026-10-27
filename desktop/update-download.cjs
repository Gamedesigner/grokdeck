const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawn} = require('node:child_process');
const {API,MAX_ASSET} = require('./update-release.cjs');
const CDN = new Set(['release-assets.githubusercontent.com','objects.githubusercontent.com']);
const failure = () => new Error('Update download could not be verified');
async function responseForAsset(asset,{fetcher=fetch,token=null,signal}={}) {
  let url = token ? asset.url : asset.downloadUrl;
  for (let redirects=0;redirects<=3;redirects++) {
    const parsed=new URL(url);
    if (parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.port || parsed.hash ||
        (redirects>0&&!CDN.has(parsed.hostname)) ||
        (redirects===0&&(token ? url!==`${API}/releases/assets/${asset.id}` : parsed.origin!=='https://github.com'||!parsed.pathname.startsWith('/Gamedesigner/grokdeck/releases/download/')||parsed.search))) throw failure();
    const response=await fetcher(url,{headers:{Accept:'application/octet-stream',...(redirects===0&&token?{Authorization:`Bearer ${token}`}:{})},redirect:'manual',signal,credentials:'omit'});
    if(response.redirected){await response.body?.cancel();throw failure();}
    if([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location');await response.body?.cancel();
      if(!location||redirects===3)throw failure();
      url=new URL(location,url).href;continue;
    }
    if(!response.ok||response.status!==200||!response.body){await response.body?.cancel();throw failure();}
    const length=response.headers.get('content-length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==asset.size)){await response.body.cancel();throw failure();}
    return response;
  }
  throw failure();
}
async function consumeAsset(asset, options, consume) {
  if(!asset||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>MAX_ASSET||!/^[a-f0-9]{64}$/.test(asset.sha256))throw failure();
  options.signal?.throwIfAborted();
  const response=await responseForAsset(asset,options),reader=response.body.getReader(),hash=createHash('sha256');let size=0;
  try {
    for(;;){options.signal?.throwIfAborted();const {done,value}=await reader.read();options.signal?.throwIfAborted();if(done)break;size+=value.byteLength;if(size>asset.size)throw failure();hash.update(value);await consume(value);options.onProgress?.(size/asset.size);}
    if(size!==asset.size||hash.digest('hex')!==asset.sha256)throw failure();
  } catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
async function readAsset(asset,options={}) {
  if(asset.size>64*1024)throw failure();const chunks=[];
  await consumeAsset(asset,{...options,signal:AbortSignal.timeout(15000)},async bytes=>chunks.push(Buffer.from(bytes)));
  return Buffer.concat(chunks).toString('utf8');
}
async function verifyFile(file,asset) {
  const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size!==asset.size)throw failure();
  const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try {
    const openStat=await handle.stat();
    if(!openStat.isFile()||openStat.size!==asset.size||openStat.ino!==stat.ino||openStat.dev!==stat.dev)throw failure();
    const hash=createHash('sha256');let size=0;
    for await(const chunk of handle.createReadStream({autoClose:false})){size+=chunk.length;if(size>asset.size)throw failure();hash.update(chunk);}
    const after=await handle.stat(),current=await fs.lstat(file);
    if(size!==asset.size||hash.digest('hex')!==asset.sha256||after.mtimeMs!==openStat.mtimeMs||after.ctimeMs!==openStat.ctimeMs||current.isSymbolicLink()||current.ino!==stat.ino||current.dev!==stat.dev)throw failure();
    return {size,ino:stat.ino,dev:stat.dev};
  } finally {await handle.close();}
}
async function downloadFile(asset,file,{fetcher=fetch,token=null,onProgress,sha512,signal}={}) {
  // electron-updater supplies this fresh cache path in the main process. 'wx'
  // prevents overwriting existing files or following a substituted symlink.
  const handle=await fs.open(file,'wx',0o600),hash=sha512?createHash('sha512'):null;
  try {
    await consumeAsset(asset,{fetcher,token,onProgress,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20*60*1000)]):AbortSignal.timeout(20*60*1000)},async bytes=>{
      hash?.update(bytes);let offset=0;
      while(offset<bytes.length){const {bytesWritten}=await handle.write(bytes,offset,bytes.length-offset);if(!bytesWritten)throw failure();offset+=bytesWritten;}
    });
    if(hash&&hash.digest('base64')!==sha512)throw failure();
    await handle.sync();
  } catch(error){await handle.close().catch(()=>{});await fs.unlink(file).catch(()=>{});throw error;}
  await handle.close();
}
async function downloadInstaller(asset,{directory,fetcher=fetch,token=null,onProgress}={}) {
  if(!/^GrokDeck-[0-9A-Za-z.-]+-win-(?:x64|arm64)\.exe$/.test(asset.name))throw failure();
  const base=await fs.realpath(directory),root=await fs.mkdtemp(path.join(base,'grokdeck-update-'));
  const file=path.join(root,asset.name),partial=path.join(root,'download.partial');let handle;
  try {
    await fs.chmod(root,0o700);handle=await fs.open(partial,'wx',0o600);
    await consumeAsset(asset,{fetcher,token,onProgress,signal:AbortSignal.timeout(20*60*1000)},async bytes=>{
      let offset=0;while(offset<bytes.length){const {bytesWritten}=await handle.write(bytes,offset,bytes.length-offset);if(!bytesWritten)throw failure();offset+=bytesWritten;}
    });
    await handle.sync();await handle.close();handle=null;
    await fs.rename(partial,file);await fs.chmod(file,0o500);await verifyFile(file,asset);
    return Object.freeze({file,root,asset});
  } catch(error){await handle?.close().catch(()=>{});await fs.rm(root,{recursive:true,force:true}).catch(()=>{});throw error;}
}
async function launchInstaller(ticket,{app,spawnImpl=spawn,canQuit=()=>true}={}) {
  const root=await fs.lstat(ticket.root);
  if(!root.isDirectory()||root.isSymbolicLink()||path.dirname(ticket.file)!==ticket.root||path.basename(ticket.file)!==ticket.asset.name)throw failure();
  await verifyFile(ticket.file,ticket.asset);
  if(!canQuit())throw new Error('restart-not-ready');
  // No shell, arbitrary arguments, elevation override, or silent installation.
  await new Promise((resolve,reject)=>{
    const child=spawnImpl(ticket.file,['/currentuser'],{detached:true,stdio:'ignore',windowsHide:false,shell:false});
    child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
  });
  app.quit();
}
module.exports={responseForAsset,consumeAsset,readAsset,verifyFile,downloadFile,downloadInstaller,launchInstaller};
