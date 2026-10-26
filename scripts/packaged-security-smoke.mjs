import {getCurrentFuseWire,FuseV1Options as F} from '@electron/fuses';
import {launchHardened} from './hardened-launch.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const executable=process.env.GROKDECK_EXECUTABLE;
assert.ok(executable,'Set GROKDECK_EXECUTABLE');
const wire=await getCurrentFuseWire(executable);
for(const key of [F.RunAsNode,F.EnableNodeOptionsEnvironmentVariable,F.EnableNodeCliInspectArguments])assert.equal(wire[key],48);
for(const key of [F.EnableEmbeddedAsarIntegrityValidation,F.OnlyLoadAppFromAsar])assert.equal(wire[key],49);
const root=await fs.mkdtemp(path.join(os.tmpdir(),'deck-packaged-'));let app;
try {
  const profile=path.join(root,'profile'),source=path.join(root,'empty-source');await fs.mkdir(profile);await fs.mkdir(source);
  await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({checkReleases:false,sourcePath:source,drafts:{fixture:'Keep my draft'}}));
  app=await launchHardened(executable,profile);const page=app.page;
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  assert.equal((await page.evaluate(()=>window.grokdeck.preferences())).drafts.fixture,'Keep my draft');
  await page.getByLabel('Open settings').click();await page.getByLabel('Close settings').click();
  const info=await page.evaluate(()=>window.grokdeck.info());
  assert.ok(info.version);await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:`test-results/hardened-${process.platform}-${process.arch}.png`});
  console.log(JSON.stringify({status:'passed',info,fusesVerified:true,rendererIsolation:true,preferences:true}));
} finally {if(app)await app.close();await fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
