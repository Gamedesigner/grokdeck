// Opt-in real Mac updater integration test. Only the disposable app is replaced.
// Squirrel drops launch arguments on its automatic restart, so that brief launch
// uses the normal GrokDeck profile. Updater caches are also shared. Run without
// another GrokDeck update in progress; this is not an account-isolated test.
// Signature checks, release lookup, download and native installation stay real.
import {launchHardened} from './hardened-launch.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import semver from 'semver';
import yaml from 'js-yaml';

const exec=promisify(execFile);
const run=(command,args,timeout=30000)=>exec(command,args,{timeout,maxBuffer:1024*1024});
const baseline=process.env.GROKDECK_UPDATE_BASELINE;
const expected=process.env.GROKDECK_UPDATE_EXPECTED;
if(process.platform!=='darwin'||!baseline?.endsWith('.app')||!path.isAbsolute(baseline)||!expected||semver.valid(expected)!==expected) {
  throw new Error('Set GROKDECK_UPDATE_BASELINE to an absolute signed Mac .app path and GROKDECK_UPDATE_EXPECTED to the published version (including any prerelease suffix).');
}
const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function bounded(promise,milliseconds,label) {
  let timer;
  try {
    return await Promise.race([promise,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(`${label} timed out after ${milliseconds/1000}s`)),milliseconds);
    })]);
  } finally {clearTimeout(timer);}
}
const readVersion=async app=>(await run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(app,'Contents','Info.plist')])).stdout.trim();
async function verifySignedApp(app,requirement) {
  await run('/usr/bin/codesign',['--verify','--deep','--strict',...(requirement?['-R','='+requirement]:[]),app],120000);
  const details=await run('/usr/bin/codesign',['-dv','--verbose=4',app]);
  assert.match(details.stderr,/^TeamIdentifier=[A-Z0-9]{10}$/m,'A Developer ID signed baseline is required');
  assert.doesNotMatch(details.stderr,/Signature=adhoc/);
}
await verifySignedApp(baseline);
const updaterConfig=await fs.readFile(path.join(baseline,'Contents','Resources','app-update.yml'),'utf8')
  .catch(()=>{throw new Error('Baseline lacks app-update.yml. Build a signed ZIP target, not only --dir, before running the native update test.');});
assert.ok(typeof yaml.load(updaterConfig)?.updaterCacheDirName==='string','Baseline updater cache configuration is missing');
const baselineVersion=await readVersion(baseline);
assert.ok(semver.valid(baselineVersion)&&semver.lt(baselineVersion,expected),'Baseline must be older than the target version');
const signature=await run('/usr/bin/codesign',['-d','-r-',baseline]);
const requirement=(signature.stdout+'\n'+signature.stderr).match(/^designated => (.+)$/m)?.[1];
assert.ok(requirement,'Baseline must have a designated signing requirement');

const root=await fs.mkdtemp(path.join(os.homedir(),'Library','Caches','grokdeck-update-test-'));
const appPath=path.join(root,'GrokDeck.app');
const executablePath=path.join(appPath,'Contents','MacOS','GrokDeck');
const profile=path.join(root,'profile'),source=path.join(root,'empty-source');
const draft='Preserve this local draft across the real update';
const log=value=>console.log(JSON.stringify({...value,testRoot:root}));
const testProcesses=async()=>{
  const {stdout}=await run('/bin/ps',['-axo','pid=,comm=']);
  return stdout.split('\n').map(line=>line.trim().match(/^(\d+)\s+(.+)$/)).filter(row=>row?.[2]===executablePath).map(row=>Number(row[1]));
};
async function stopTestCopy() {
  for(const pid of await testProcesses()) {
    try {process.kill(pid,'SIGTERM');} catch(error) {if(error.code!=='ESRCH')throw error;}
  }
  const deadline=Date.now()+15000;
  while((await testProcesses()).length&&Date.now()<deadline)await delay(250);
  assert.equal((await testProcesses()).length,0,'Disposable test app did not stop');
}
const launch=()=>launchHardened(executablePath,profile);
let desktop;
try {
  log({stage:'starting',from:baselineVersion,to:expected,nativeRelaunchUsesDefaultProfile:true,updaterCacheShared:true});
  await run('/usr/bin/ditto',[baseline,appPath],120000);
  await verifySignedApp(appPath,requirement);
  await fs.mkdir(profile);await fs.mkdir(source);
  await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({checkReleases:false,sourcePath:source,drafts:{'update-test':draft}}));
  desktop=await launch();
  const page=desktop.page;
  const before=await bounded(page.evaluate(()=>window.grokdeck.info()),30000,'Read baseline version');
  assert.equal(before.version,baselineVersion,'Packaged metadata and Info.plist versions disagree');
  const offer=await bounded(page.evaluate(()=>window.grokdeck.checkAppUpdates(true)),60000,'Release check');
  assert.equal(offer.version,expected);assert.equal(offer.status,'available');assert.equal(offer.canInstall,true);
  log({stage:'offered',from:before.version,fromArch:before.arch,to:offer.version});
  const downloaded=await bounded(page.evaluate(()=>window.grokdeck.downloadUpdate()),20*60*1000,'Update download');
  assert.equal(downloaded.status,'downloaded');assert.equal(downloaded.canInstall,true);
  log({stage:'downloaded',version:expected});
  // launchHardened.waitForEvent has no timeout option; bound it explicitly.
  const closed=bounded(desktop.waitForEvent('close'),180000,'Native updater quit');
  void closed.catch(()=>{});
  try {
    const installing=await bounded(page.evaluate(()=>window.grokdeck.installUpdate()),30000,'Start update');
    assert.equal(installing.status,'installing','Installer did not enter the installing state');
  } catch(error) {
    // The IPC response can lose its page when the native updater quits.
    if(!/Target (?:page, context or browser has been closed|closed)|Execution context was destroyed|Session closed/i.test(error.message))throw error;
  }
  await closed;desktop=null;
  let installed='',relaunchObserved=false,relaunchRetainedProfile=false;
  const deadline=Date.now()+180000;
  while(Date.now()<deadline) {
    // Observe and stop the exact disposable executable before slow signature
    // checks. Never terminate other GrokDeck installations or the ShipIt helper.
    const processes=await testProcesses();
    if(processes.length) {
      relaunchObserved=true;
      for(const pid of processes) {
        try {
          const args=(await run('/bin/ps',['-p',String(pid),'-o','args='])).stdout;
          relaunchRetainedProfile=args.includes(`--user-data-dir=${profile}`);
        } catch {} // A relaunch that exits itself is still an observed relaunch.
      }
      await stopTestCopy();
    }
    try {installed=await readVersion(appPath);} catch {}
    if(installed===expected&&relaunchObserved)break;
    await delay(250);
  }
  assert.equal(installed,expected,'Installer did not replace the disposable app');
  assert.ok(relaunchObserved,'Updated test application did not relaunch');
  await verifySignedApp(appPath,requirement);
  await run('/usr/sbin/spctl',['--assess','--type','execute',appPath],120000);
  desktop=await launch();
  const after=await bounded(desktop.page.evaluate(()=>window.grokdeck.info()),30000,'Read updated version');
  const prefs=await bounded(desktop.page.evaluate(()=>window.grokdeck.preferences()),30000,'Read test preferences');
  assert.equal(after.version,expected);
  assert.equal(prefs.drafts['update-test'],draft);
  assert.equal(prefs.sourcePath,source);
  log({stage:'passed',version:expected,fromArch:before.arch,toArch:after.arch,relaunchObserved,relaunchRetainedProfile,draftPreserved:true,sourcePreserved:true,signatureVerified:true,gatekeeperAccepted:true});
} finally {
  // Keep the disposable copy/profile for diagnosis; never delete updater caches
  // or other app copies. A failed native install may still have a ShipIt job.
  if(desktop)await bounded(desktop.close(),15000,'Close test browser').catch(()=>{});
  await stopTestCopy();
}
