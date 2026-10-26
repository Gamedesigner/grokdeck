import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseNames,verifyManifest,verifyRemoteAssets} from '../scripts/verify-release.mjs';
const file={name:'app.zip',size:42,sha512:'fixture512',sha256:'fixture256'};
const manifest={version:'0.2.2',files:[{url:file.name,size:file.size,sha512:file.sha512}],path:file.name,sha512:file.sha512};
test('release verification rejects altered manifests, missing architectures and unexpected paths',()=>{
  verifyManifest(manifest,'0.2.2',[file],['app.zip']);
  for(const bad of [{...manifest,version:'0.2.3'},{...manifest,sha512:'wrong'},{...manifest,files:[{...manifest.files[0],size:41}]},{...manifest,files:[{...manifest.files[0],url:'../app.zip'}]}])assert.throws(()=>verifyManifest(bad,'0.2.2',[file],['app.zip']));
  assert.throws(()=>verifyManifest(manifest,'0.2.2',[file],['app.zip','arm64.zip']));
  assert.throws(()=>releaseNames('../escape'));
  assert.equal(releaseNames('0.2.2').mac.length+releaseNames('0.2.2').windows.length,13);
});
test('remote upload is proven only by the complete uploaded set with matching digests and sizes',()=>{
  const asset={name:file.name,size:file.size,digest:`sha256:${file.sha256}`,state:'uploaded'};
  verifyRemoteAssets([file],[asset]);
  for(const assets of [[],[asset,asset],[{...asset,state:'starter'}],[{...asset,digest:'sha256:wrong'}],[{...asset,size:41}]])assert.throws(()=>verifyRemoteAssets([file],assets));
});
