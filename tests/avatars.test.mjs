import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {decodeAvatarDataUrl,rasterAvatar,loadAvatar} from '../bridge/avatars.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvZkAAAAASUVORK5CYII=','base64');
const dataUrl=`data:image/png;base64,${png.toString('base64')}`;
const key='a'.repeat(32);
test('avatars require bounded raster signatures and reject SVG, MIME confusion and huge dimensions',()=>{
  assert.equal(decodeAvatarDataUrl(dataUrl).mimeType,'image/png');
  for(const value of ['data:image/svg+xml;base64,PHN2Zy8+','data:text/html;base64,PGgxLz4=',dataUrl.replace('image/png','image/jpeg'),dataUrl+'!',`data:image/png;base64,${Buffer.alloc(262145).toString('base64')}`])assert.equal(decodeAvatarDataUrl(value),null);
  const giant=Buffer.from(png);giant.writeUInt32BE(99999,16);assert.equal(rasterAvatar(giant),null);
  assert.equal(rasterAvatar(Buffer.from('<html>not an image</html>')),null);
});
test('current-roster inline avatars are reused without any URL fetch',async()=>{
  const g={roster:async()=>[{id:'one',avatarDataUrl:dataUrl}],avatar:async()=>{throw new Error('No fallback expected');}};
  assert.equal((await loadAvatar(g,'one')).dataBase64,png.toString('base64'));
  assert.equal(await loadAvatar(g,'not-in-account'),null);
});
test('avatar cache accepts only exact current-roster hash references and regular files',async t=>{
  const sourcePath=await fs.mkdtemp(path.join(os.tmpdir(),'grokdeck-avatar-'));t.after(()=>fs.rm(sourcePath,{recursive:true,force:true}));
  const directory=path.join(sourcePath,'roster-avatars');await fs.mkdir(directory);await fs.writeFile(path.join(directory,key),png);
  const make=ref=>({roster:async()=>[{id:'one',avatarPhoto:{kind:'file',key:ref}}]});
  assert.equal((await loadAvatar(make(key),'one',{sourcePath})).mimeType,'image/png');
  assert.equal(await loadAvatar(make('../outside'),'one',{sourcePath}),null);
  if(process.platform==='win32')return; // Symlink creation needs separate Windows privileges.
  await fs.unlink(path.join(directory,key));await fs.writeFile(path.join(sourcePath,'outside'),png);await fs.symlink(path.join(sourcePath,'outside'),path.join(directory,key));
  assert.equal(await loadAvatar(make(key),'one',{sourcePath}),null);
});
test('missing or uncached photos use only the observed avatar read command',async()=>{
  const calls=[];
  const g={roster:async()=>[{id:'one',avatarPhoto:{kind:'protocol',key:'bad-key'}}],avatar:async id=>{calls.push(id);return {dataUrl,version:'1'};}};
  assert.equal((await loadAvatar(g,'one')).mimeType,'image/png');assert.deepEqual(calls,['one']);
});
