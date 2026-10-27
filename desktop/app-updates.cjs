// Main-process only. Never return credentials, download URLs or paths to UI.
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const {API,parseVersion,selectRelease,macManifest} = require('./update-release.cjs');
const transport = require('./update-download.cjs');
const RELEASES_URL = 'https://github.com/Gamedesigner/grokdeck/releases';
async function repositoryToken() {
  const supplied=process.env.GROKDECK_GITHUB_TOKEN;
  if(supplied)return supplied.trim();
  try {return (await run('gh',['auth','token','--hostname','github.com'],{timeout:5000,maxBuffer:16384})).stdout.trim();}
  catch{return null;}
}
async function installationSupport(app,updater) {
  if(!app.isPackaged)return false;
  try {
    if(process.platform==='darwin') {
      const target=app.getPath('exe');
      await run('/usr/bin/codesign',['--verify','--deep','--strict',target],{timeout:15000});
      const result=await run('/usr/bin/codesign',['-dv','--verbose=4',target],{timeout:5000});
      return /^TeamIdentifier=[A-Z0-9]{10}$/m.test(result.stderr)&&!/Signature=adhoc/.test(result.stderr);
    }
    if(process.platform==='win32') {
      const config=await updater.configOnDisk.value;
      if(!config.publisherName)return false;
      return (await updater.verifySignature(app.getPath('exe')))===null;
    }
  } catch {}
  return false;
}
async function readReleaseList(response) {
  if(!response.ok||response.redirected||!response.body)throw new Error('Release unavailable');
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>2*1024*1024)){await response.body.cancel();throw new Error('Oversized release list');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw new Error('Oversized release list');chunks.push(Buffer.from(value));}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function selectedMacProvider(info,asset,url) {
  const {Provider}=require('electron-updater/out/providers/Provider');
  return class SelectedMacRelease extends Provider {
    constructor(_config,_updater,runtime){super({...runtime,isUseMultipleRangeRequest:false});}
    async getLatestVersion(){return info;}
    resolveFiles(value){if(value.version!==info.version)throw new Error('Update metadata mismatch');return [{url,info:{url:asset.name,size:asset.size,sha512:info.sha512}}];}
    get fileExtraDownloadHeaders(){return null;}
  };
}
function createAppUpdates({currentVersion,updater,app=null,platform=process.platform,arch=process.arch,
  tokenProvider=repositoryToken,supported=async()=>false,fetcher=fetch,
  hasPendingSends=()=>false,now=Date.now,io=transport,providerFactory=selectedMacProvider}) {
  let state={status:'idle',currentVersion,version:null,checkedAt:0,canInstall:false,message:'GrokDeck updates have not been checked.'};
  let pending=null,selected=null,token=null,ticket=null,macDownload=null,downloadError=false;
  const set=patch=>(state={...state,...patch});
  const fail=()=>set({status:'unavailable',canInstall:false,message:'Could not verify or prepare the GrokDeck update. Check again or use Open downloads.'});
  updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;
  updater.allowPrerelease=!!parseVersion(currentVersion)?.pre.length;
  updater.disableWebInstaller=true;updater.disableDifferentialDownload=true;updater.logger=null;
  updater.on('error',()=>{downloadError=true;fail();});
  updater.on('download-progress',p=>{if(state.status==='downloading')set({message:`Downloading GrokDeck… ${Math.max(0,Math.min(100,Math.round(p.percent||0)))}%`});});
  // This event does not unlock installation until GitHub's SHA-256 also matches.
  updater.on('update-downloaded',event=>{if(pending&&state.status==='downloading'&&typeof event?.downloadedFile==='string')macDownload=event.downloadedFile;});
  async function check(force=false) {
    if(['downloading','downloaded','installing'].includes(state.status))return state;
    if(pending)return pending;
    if(!force&&state.checkedAt&&now()-state.checkedAt<6*3600000)return state;
    pending=(async()=>{
      set({status:'checking',checkedAt:now(),version:null,canInstall:false,message:'Checking GrokDeck releases…'});
      selected=null;ticket=null;macDownload=null;token=null;
      try {
        const request=auth=>fetcher(`${API}/releases?per_page=100`,{headers:{Accept:'application/vnd.github+json',...(auth?{Authorization:`Bearer ${auth}`}:{})},redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000)});
        let response=await request(null);
        if([401,403,404].includes(response.status)) {
          await response.body?.cancel();token=await tokenProvider();
          if(!token)throw new Error('Release access unavailable');
          response=await request(token);
        }
        selected=selectRelease(await readReleaseList(response),{currentVersion,platform,arch});
        if(!selected)return set({status:'current',message:'No newer GrokDeck download is available for this device and release channel.'});
        const canInstall=platform==='win32'?app?.isPackaged===true:await supported();
        return set({status:'available',version:selected.version,canInstall,installKind:platform==='win32'?'windows-installer':'signed-mac',
          message:canInstall?(platform==='win32'?`GrokDeck ${selected.version} is available. Download and verify its Windows installer; unsigned previews show Unknown publisher.`:`GrokDeck ${selected.version} is available to download and install.`):`GrokDeck ${selected.version} is available. Use Open downloads for this development or unsigned Mac build.`});
      } catch{return fail();}
    })();
    try{return await pending;}finally{pending=null;}
  }
  async function download() {
    if(pending||state.status!=='available'||!state.canInstall||!selected)throw new Error('update-not-ready');
    downloadError=false;set({status:'downloading',message:'Downloading and verifying GrokDeck…'});
    pending=(async()=>{
      try {
        if(platform==='win32') {
          ticket=await io.downloadInstaller(selected.asset,{directory:app.getPath('temp'),fetcher,token,onProgress:fraction=>set({message:`Downloading GrokDeck… ${Math.round(fraction*100)}%`})});
          if(downloadError)throw new Error('Update failed');
          return set({status:'downloaded',message:'Installer downloaded and checked against GitHub. Install when ready; Windows may show Unknown publisher.'});
        }
        if(!await supported())throw new Error('Signed installation unavailable');
        const info=macManifest(await io.readAsset(selected.manifest,{fetcher,token}),selected);
        updater.requestHeaders=null;
        updater.setFeedURL({provider:'custom',updateProvider:providerFactory(info,selected.asset,new URL(selected.asset.downloadUrl))});
        const checked=await updater.checkForUpdates();
        if(checked?.isUpdateAvailable!==true||checked?.updateInfo?.version!==selected.version||downloadError)throw new Error('metadata-mismatch');
        // Keep electron-updater's cache and native signed-install pipeline, but
        // bound the ZIP stream to GitHub's exact asset size and SHA-256 digest.
        const executor=updater.httpExecutor,originalDownload=executor.download;
        executor.download=async(url,destination,options)=>{
          if(url.href!==selected.asset.downloadUrl||options.sha512!==info.sha512)throw new Error('Unexpected update asset');
          const abort=new AbortController(),cancel=()=>abort.abort();
          options.cancellationToken?.onCancel(cancel);
          try{return await io.downloadFile(selected.asset,destination,{fetcher,token,sha512:info.sha512,signal:abort.signal,onProgress:fraction=>set({message:`Downloading GrokDeck… ${Math.round(fraction*100)}%`})});}
          finally{options.cancellationToken?.removeListener('cancel',cancel);}
        };
        let result;try{result=await updater.downloadUpdate();}finally{executor.download=originalDownload;}
        const file=macDownload||(Array.isArray(result)&&result.length===1?result[0]:null);
        if(typeof file!=='string')throw new Error('Missing download');
        await io.verifyFile(file,selected.asset);macDownload=file;
        if(downloadError)throw new Error('Update failed');
        return set({status:'downloaded',message:'Update downloaded and verified. Restart to install; macOS will verify the app signature.'});
      } catch {ticket=null;macDownload=null;return fail();}
    })();
    try{return await pending;}finally{pending=null;}
  }
  async function install() {
    if(pending||state.status!=='downloaded'||!state.canInstall||hasPendingSends())throw new Error('restart-not-ready');
    // Set pending before asynchronous verification so repeated clicks cannot
    // launch two installers, and check message delivery again before quitting.
    pending=(async()=>{
      try {
        if(platform==='win32') {
          if(!ticket)throw new Error('Missing installer');
          await io.verifyFile(ticket.file,ticket.asset);
          if(hasPendingSends())throw new Error('restart-not-ready');
          set({status:'installing',message:'Opening the Windows installer. Follow its steps to update GrokDeck.'});
          await io.launchInstaller(ticket,{app,canQuit:()=>!hasPendingSends()});
        } else {
          if(!macDownload||!await supported())throw new Error('Missing signed update');
          await io.verifyFile(macDownload,selected.asset);
          if(hasPendingSends())throw new Error('restart-not-ready');
          set({status:'installing',message:'Restarting GrokDeck to install the verified update…'});
          updater.quitAndInstall(false,true);
        }
        return state;
      } catch(error){fail();throw new Error('Update installation could not start. Check again.');}
    })();
    try{return await pending;}finally{pending=null;}
  }
  return {check,download,install,status:()=>({...state})};
}
module.exports={createAppUpdates,installationSupport,RELEASES_URL,readReleaseList,selectedMacProvider};
