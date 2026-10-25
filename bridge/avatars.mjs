import {promises as fs,constants} from 'node:fs';
import path from 'node:path';
import {defaultSource} from '../desktop/cache.mjs';
const MAX_BYTES=256*1024;
function dimensions(width,height){return Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=2048&&height<=2048&&width*height<=4194304;}
function mimeOf(bytes){
  if(bytes.length<12||bytes.length>MAX_BYTES)return null;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
    if(bytes.length<33||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'||!dimensions(bytes.readUInt32BE(16),bytes.readUInt32BE(20)))return null;
    return 'image/png';
  }
  if(bytes[0]===255&&bytes[1]===216){
    let p=2;
    while(p+4<=bytes.length){
      if(bytes[p++]!==255)return null;
      while(bytes[p]===255)p++;
      const marker=bytes[p++];
      if(marker===217||marker===218)return null;
      if(marker===1||marker>=208&&marker<=215)continue;
      if(p+2>bytes.length)return null;
      const length=bytes.readUInt16BE(p);if(length<2||p+length>bytes.length)return null;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
        if(length<7||!dimensions(bytes.readUInt16BE(p+5),bytes.readUInt16BE(p+3)))return null;
        return 'image/jpeg';
      }
      p+=length;
    }
    return null;
  }
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length){
    const kind=bytes.toString('ascii',12,16);let w,h;
    if(kind==='VP8X'&&bytes.length>=30){w=bytes.readUIntLE(24,3)+1;h=bytes.readUIntLE(27,3)+1;}
    else if(kind==='VP8 '&&bytes.length>=30&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){w=bytes.readUInt16LE(26)&16383;h=bytes.readUInt16LE(28)&16383;}
    else if(kind==='VP8L'&&bytes.length>=25&&bytes[20]===47){const bits=bytes.readUInt32LE(21);w=(bits&16383)+1;h=((bits>>>14)&16383)+1;}
    if(dimensions(w,h))return 'image/webp';
  }
  return null;
}
export function rasterAvatar(bytes,expectedMime){
  if(!Buffer.isBuffer(bytes))return null;
  const mimeType=mimeOf(bytes);
  if(!mimeType||expectedMime&&mimeType!==expectedMime)return null;
  return {apiVersion:1,mimeType,dataBase64:bytes.toString('base64')};
}
export function decodeAvatarDataUrl(value){
  if(typeof value!=='string'||value.length>350000)return null;
  const match=value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/);
  if(!match||!match[2].length||match[2].length%4)return null;
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.toString('base64')!==match[2])return null;
  return rasterAvatar(bytes,match[1]);
}
async function cachedPhoto(key,sourcePath){
  if(typeof key!=='string'||!/^[a-f0-9]{32}$/.test(key))return null;
  const root=path.join(sourcePath,'roster-avatars');let handle;
  try{
    const rootInfo=await fs.lstat(root);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())return null;
    const file=path.join(root,key),fileInfo=await fs.lstat(file);
    if(!fileInfo.isFile()||fileInfo.isSymbolicLink()||fileInfo.size>MAX_BYTES)return null;
    handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_BYTES)return null;
    const bytes=await handle.readFile();return rasterAvatar(bytes);
  }catch{return null;}finally{await handle?.close();}
}
export async function loadAvatar(gateway,id,{sourcePath=defaultSource()}={}){
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))return null;
  const agent=(await gateway.roster()).find(a=>a.id===id&&!a.isRemovedFromSidebar);
  if(!agent)return null;
  const inline=decodeAvatarDataUrl(agent.avatarDataUrl);if(inline)return inline;
  if(agent.avatarPhoto&&['file','protocol'].includes(agent.avatarPhoto.kind)){
    const photo=await cachedPhoto(agent.avatarPhoto.key,sourcePath);if(photo)return photo;
  }
  if(typeof gateway.avatar!=='function')return null;
  const result=await gateway.avatar(id);
  return decodeAvatarDataUrl(result?.dataUrl);
}
