// Main-process only. Never return repository credentials or download URLs to the renderer.
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
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
      // Uses electron-updater's publisher and Authenticode checks for the current executable too.
      return (await updater.verifySignature(app.getPath('exe')))===null;
    }
  } catch {}
  return false;
}
function createAppUpdates({currentVersion,updater,tokenProvider=repositoryToken,
  supported=async()=>false,fetcher=fetch,hasPendingSends=()=>false,now=Date.now}) {
  let state={status:'idle',currentVersion,version:null,checkedAt:0,canInstall:false,message:'GrokDeck updates have not been checked.'};
  let pending=null;
  const set=(patch)=>(state={...state,...patch});
  const fail=()=>set({status:'unavailable',canInstall:false,message:'Could not check or prepare the GrokDeck update. Check GitHub access and try again; manual downloads remain available.'});
  updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;
  updater.allowPrerelease=false;updater.disableWebInstaller=true;updater.logger=null;
  updater.on('error',()=>fail());
  updater.on('download-progress',p=>{if(state.status==='downloading')set({message:`Downloading GrokDeck… ${Math.max(0,Math.min(100,Math.round(p.percent||0)))}%`});});
  updater.on('update-downloaded',()=>set({status:'downloaded',message:'Update downloaded. Restart GrokDeck when you are ready.'}));
  async function check(force=false) {
    if(['downloading','downloaded','installing'].includes(state.status))return state;
    if(pending)return pending;
    if(!force&&state.checkedAt&&now()-state.checkedAt<6*3600000)return state;
    pending=(async()=>{
      set({status:'checking',checkedAt:now(),version:null,canInstall:false,message:'Checking GrokDeck releases…'});
      try {
        const token=await tokenProvider();
        const response=await fetcher('https://api.github.com/repos/Gamedesigner/grokdeck/releases/latest',{
          headers:{...(token?{Authorization:`Bearer ${token}`} : {}),Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(12000)});
        if(response.status===404)return set({status:'unavailable',message:token
          ?'No published GrokDeck release is accessible yet. Preview builds are installed manually.'
          :'No public GrokDeck release is accessible. Private previews need GitHub CLI sign-in (gh auth login) or manual downloads.'});
        if(!response.ok)throw new Error('release-unavailable');
        const raw=await response.text();if(raw.length>1024*1024)throw new Error('oversize');
        const release=JSON.parse(raw),version=String(release.tag_name||'').replace(/^v/,'');
        const {compareVersions}=await import('./releases.mjs');
        if(release.draft||release.prerelease||!/^v?\d+\.\d+\.\d+$/.test(release.tag_name))throw new Error('invalid-release');
        if(compareVersions(version,currentVersion)<=0)return set({status:'current',version,message:'GrokDeck is up to date with the latest published release.'});
        if(!await supported())return set({status:'available',version,message:`GrokDeck ${version} is available. This preview requires manual installation; signed installed builds support in-app updates.`});
        updater.setFeedURL({provider:'github',owner:'Gamedesigner',repo:'grokdeck',private:!!token,...(token?{token}:{})});
        const result=await updater.checkForUpdates();
        if(result?.updateInfo?.version!==version)throw new Error('metadata-mismatch');
        return set({status:'available',version,canInstall:true,message:`GrokDeck ${version} is available to download.`});
      } catch{return fail();}
    })();
    try{return await pending;}finally{pending=null;}
  }
  async function download() {
    if(pending||state.status!=='available'||!state.canInstall)throw new Error('update-not-ready');
    set({status:'downloading',message:'Downloading and verifying GrokDeck…'});
    pending=updater.downloadUpdate().catch(()=>fail());
    try{await pending;return state;}finally{pending=null;}
  }
  function install() {
    if(pending||state.status!=='downloaded'||!state.canInstall||hasPendingSends())throw new Error('restart-not-ready');
    set({status:'installing',message:'Restarting GrokDeck to install the verified update…'});
    updater.quitAndInstall(false,true);
    return state;
  }
  return {check,download,install,status:()=>({...state})};
}
module.exports={createAppUpdates,installationSupport,RELEASES_URL};
