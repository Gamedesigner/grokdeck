// Read-only interoperability with Chromium's Windows v10 storage format.
// The profile key is protected by Windows DPAPI for the current Windows user.
// Never point Electron's writable userData directory at the vendor profile.
import {createDecipheriv} from 'node:crypto';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {readJSONFile} from './session.mjs';

const failure = () => new Error('Windows secure storage unavailable');
export function unprotectWindowsKey(blob) {
  if(process.platform!=='win32')return Promise.reject(failure());
  return new Promise((resolve,reject)=>{
    const script = "$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $k=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($k)); [Array]::Clear($k,0,$k.Length) } catch { exit 1 }";
    const env={...process.env};delete env.PSModulePath;
    const child=execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoProfile','-NonInteractive','-Command',script],
      {env,windowsHide:true,timeout:10000,maxBuffer:4096},(error,stdout)=>{
        if(error||!/^[A-Za-z0-9+/]{43}=$/.test(stdout)){reject(failure());return;}
        const key=Buffer.from(stdout,'base64');
        if(key.length!==32){key.fill(0);reject(failure());return;}
        resolve(key);
      });
    child.stdin.on('error',()=>{});
    child.stdin.end(blob.toString('base64'));
  });
}
export function createWindowsDecryptor({sourcePath,unprotect=unprotectWindowsKey}) {
  let cached;
  return async encrypted=>{
    // Unknown/app-bound formats must fail closed rather than bypass their protection.
    if(!Buffer.isBuffer(encrypted)||encrypted.length<31||encrypted.length>32768||encrypted.toString('ascii',0,3)!=='v10')throw failure();
    const state=await readJSONFile(path.join(sourcePath,'Local State'),1024*1024);
    const encoded=state?.os_crypt?.encrypted_key;
    if(typeof encoded!=='string'||encoded.length>16384||! /^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw failure();
    if(cached?.encoded!==encoded){
      cached?.key.fill(0);cached=undefined;
      const wrapped=Buffer.from(encoded,'base64');
      if(wrapped.length<=5||wrapped.toString('ascii',0,5)!=='DPAPI')throw failure();
      const key=await unprotect(wrapped.subarray(5));
      if(!Buffer.isBuffer(key)||key.length!==32)throw failure();
      cached={encoded,key};
    }
    const decipher=createDecipheriv('aes-256-gcm',cached.key,encrypted.subarray(3,15));
    decipher.setAuthTag(encrypted.subarray(-16));
    const partial=decipher.update(encrypted.subarray(15,-16));
    let plain;
    try{plain=Buffer.concat([partial,decipher.final()]);return new TextDecoder('utf-8',{fatal:true}).decode(plain);}
    finally{partial.fill(0);plain?.fill(0);}
  };
}
