// Opt-in real updater integration test. Uses a disposable signed app copy and
// profile; never mocks the release API, updater, signature checks, or installer.
import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
const run=promisify(execFile);
const baseline=process.env.GROKDECK_UPDATE_BASELINE;
const expected=process.env.GROKDECK_UPDATE_EXPECTED;
if(process.platform!=='darwin'||!baseline?.endsWith('.app')||!/^\d+\.\d+\.\d+$/.test(expected||'')) {
  throw new Error('Set GROKDECK_UPDATE_BASELINE to a signed Mac app and GROKDECK_UPDATE_EXPECTED to the published target version.');
}
const root=await fs.mkdtemp(path.join(os.homedir(),'Library','Caches','grokdeck-update-test-'));
const appPath=path.join(root,'GrokDeck.app');
const executablePath=path.join(appPath,'Contents','MacOS','GrokDeck');
const profile=path.join(root,'profile'),source=path.join(root,'empty-source');
await run('/usr/bin/ditto',[baseline,appPath]);
await run('/usr/bin/codesign',['--verify','--deep','--strict',appPath]);
await fs.mkdir(profile);await fs.mkdir(source);
const draft='Preserve this local draft across the real update';
await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({checkReleases:false,sourcePath:source,drafts:{'update-test':draft}}));
const launch=()=>electron.launch({executablePath,args:[`--user-data-dir=${profile}`],env:{...process.env,GROKDECK_DEV_URL:'',GROKDECK_SCREENSHOT:''},timeout:60000});
let desktop;
try {
  desktop=await launch();
  const page=await desktop.firstWindow();
  await page.waitForSelector('h1');
  const before=await page.evaluate(()=>window.grokdeck.info());
  assert.notEqual(before.version,expected,'Baseline already has the target version');
  const offer=await page.evaluate(()=>window.grokdeck.checkAppUpdates(true));
  assert.equal(offer.version,expected);assert.equal(offer.status,'available');assert.equal(offer.canInstall,true);
  console.log(JSON.stringify({stage:'offered',from:before.version,to:offer.version,testRoot:root}));
  const downloaded=await page.evaluate(()=>window.grokdeck.downloadUpdate());
  assert.equal(downloaded.status,'downloaded');assert.equal(downloaded.canInstall,true);
  console.log(JSON.stringify({stage:'downloaded',version:expected}));
  const closed=desktop.waitForEvent('close',{timeout:60000});
  // Electron can close the IPC channel while this request is resolving.
  await page.evaluate(()=>window.grokdeck.installUpdate()).catch(()=>{});
  await closed;desktop=null;
  const deadline=Date.now()+180000;
  let installed='';
  while(Date.now()<deadline) {
    try{installed=(await run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(appPath,'Contents','Info.plist')])).stdout.trim();}catch{}
    if(installed===expected)break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.equal(installed,expected,'Installer did not replace the app');
  await run('/usr/bin/codesign',['--verify','--deep','--strict',appPath]);
  await run('/usr/sbin/spctl',['--assess','--type','execute',appPath]);
  // Stop only a relaunched test copy, never another GrokDeck installation.
  let relaunched=[];
  const relaunchDeadline=Date.now()+30000;
  while(Date.now()<relaunchDeadline) {
    const processes=(await run('/bin/ps',['-axo','pid=,comm='])).stdout;
    relaunched=processes.split('\n').map(line=>line.trim().match(/^(\d+)\s+(.+)$/)).filter(row=>row?.[2]===executablePath);
    if(relaunched.length)break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(relaunched.length,'Updated test application did not relaunch');
  for(const row of relaunched)process.kill(Number(row[1]),'SIGTERM');
  desktop=await launch();
  const updated=await desktop.firstWindow();await updated.waitForSelector('h1');
  assert.equal((await updated.evaluate(()=>window.grokdeck.info())).version,expected);
  assert.equal((await updated.evaluate(()=>window.grokdeck.preferences())).drafts['update-test'],draft);
  console.log(JSON.stringify({stage:'passed',version:expected,relaunchObserved:relaunched.length>0,draftPreserved:true,testRoot:root}));
} finally {if(desktop)await desktop.close();}
