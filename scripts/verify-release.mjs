import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import yaml from 'js-yaml';

export function releaseNames(version) {
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid release version');
  const mac=['x64','arm64'].flatMap(arch=>['zip','dmg'].map(ext=>`GrokDeck-${version}-mac-${arch}.${ext}`));
  const win=`GrokDeck-${version}-win-x64`;
  return {mac:[...mac,...mac.map(name=>`${name}.blockmap`),'latest-mac.yml'],windows:[`${win}.exe`,`${win}.exe.blockmap`,`${win}.zip`,'latest.yml']};
}
export function verifyManifest(manifest,version,files,expected) {
  if(manifest?.version!==version||!Array.isArray(manifest.files))throw Error('Wrong manifest version or shape');
  const names=manifest.files.map(entry=>entry.url);
  if(names.length!==expected.length||new Set(names).size!==names.length||names.some(name=>!expected.includes(name)))throw Error('Unexpected manifest artifacts');
  for(const entry of manifest.files) {
    const file=files.find(file=>file.name===entry.url);
    if(!file||file.size!==entry.size||file.sha512!==entry.sha512)throw Error(`Manifest mismatch: ${entry.url}`);
  }
  const legacy=manifest.files.find(entry=>entry.url===manifest.path);
  if(!legacy||legacy.sha512!==manifest.sha512)throw Error('Legacy manifest reference mismatch');
}
export function verifyRemoteAssets(files,assets) {
  if(!Array.isArray(assets)||assets.length!==files.length||new Set(assets.map(a=>a.name)).size!==assets.length)throw Error('Remote asset set incomplete or duplicated');
  for(const file of files) {
    const asset=assets.find(asset=>asset.name===file.name);
    if(!asset||asset.state!=='uploaded'||asset.size!==file.size||asset.digest!==`sha256:${file.sha256}`)throw Error(`Remote mismatch: ${file.name}`);
  }
}
export async function verifyRelease({version,macDir,windowsDir,remoteAssets}) {
  const names=releaseNames(version),files=[];
  for(const [platform,root] of [['mac',macDir],['windows',windowsDir]]) {
    for(const name of names[platform]) {
      const file=path.join(root,name),stat=await fs.lstat(file);
      if(!stat.isFile()||stat.size===0)throw Error(`Missing regular artifact: ${name}`);
      const sha256=createHash('sha256'),sha512=createHash('sha512');let size=0;
      for await(const chunk of createReadStream(file)){size+=chunk.length;sha256.update(chunk);sha512.update(chunk);}
      if(size!==stat.size)throw Error(`Artifact changed during verification: ${name}`);
      files.push({name,size,sha256:sha256.digest('hex'),sha512:sha512.digest('base64')});
    }
  }
  for(const [root,name,expected] of [
    [macDir,'latest-mac.yml',names.mac.filter(name=>/\.(zip|dmg)$/.test(name))],
    [windowsDir,'latest.yml',names.windows.filter(name=>name.endsWith('.exe'))],
  ]) {
    const raw=await fs.readFile(path.join(root,name),'utf8');
    if(raw.length>65536)throw Error('Oversized manifest');
    verifyManifest(yaml.load(raw),version,files,expected);
  }
  if(remoteAssets)verifyRemoteAssets(files,remoteAssets);
  return {version,artifactCount:files.length,localMetadataVerified:true,remoteVerified:!!remoteAssets,files};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [version,macDir,windowsDir,remoteFile]=process.argv.slice(2);
  if(!version||!macDir||!windowsDir)throw Error('Usage: node scripts/verify-release.mjs VERSION MAC_DIR WINDOWS_DIR [REMOTE_ASSETS_JSON]');
  const remote=remoteFile?JSON.parse(await fs.readFile(remoteFile,'utf8')):undefined;
  console.log(JSON.stringify(await verifyRelease({version,macDir,windowsDir,remoteAssets:remote?.assets??remote}),null,2));
}
