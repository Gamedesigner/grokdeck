import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// Explicit release path: ordinary CI previews remain unsigned. Credentials stay
// in the host Keychain and are never copied into the app or updater metadata.
const identity=process.env.GROKDECK_SIGNING_IDENTITY;
// Documents can be File Provider managed; Finder metadata added during signing
// makes otherwise valid Electron helpers fail codesign's resource-fork check.
const output=path.join(os.homedir(),'Library','Caches','GrokDeck','signed-release');
if(process.platform!=='darwin'||!identity?.startsWith('Developer ID Application: ')||!process.env.APPLE_KEYCHAIN_PROFILE) {
  console.error('Signed packaging requires macOS, GROKDECK_SIGNING_IDENTITY (Developer ID Application), and APPLE_KEYCHAIN_PROFILE.');
  process.exit(1);
}
for(const [command,args] of [
  ['npm',['run','build']],
  [process.execPath,['node_modules/electron-builder/cli.js','--mac','zip','dmg','--arm64','--x64',
    '--publish','never',`--config.mac.identity=${identity.replace(/^Developer ID Application: /,'')}`,'--config.mac.notarize=true',
    '--config.forceCodeSigning=true',`--config.directories.output=${output}`]],
]) {
  const result=spawnSync(command,args,{stdio:'inherit',env:process.env});
  if(result.error||result.status!==0)process.exit(result.status||1);
}
