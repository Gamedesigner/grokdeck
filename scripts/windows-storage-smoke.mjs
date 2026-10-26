import {promises as fs} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import electron from 'electron';
import {createWindowsDecryptor} from '../bridge/windows-storage.mjs';
if(process.platform==='win32'){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'grokdeck-profile-smoke-'));
  try{
    const env={...process.env,GROKDECK_STORAGE_FIXTURE:root};delete env.ELECTRON_RUN_AS_NODE;
    await promisify(execFile)(electron,[path.resolve('scripts/windows-storage-fixture.cjs')],{env,timeout:30000});
    const file=path.join(root,'Local State'),before=await fs.readFile(file);
    assert.equal(await createWindowsDecryptor({sourcePath:root})(await fs.readFile(path.join(root,'fixture.bin'))),'GrokDeck Windows synthetic fixture 🔒');
    assert.deepEqual(await fs.readFile(file),before);
    console.log('Windows separate-profile Electron / DPAPI decryption passed. Vendor profile remains unchanged.');
  }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
}
