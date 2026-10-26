import {randomBytes,timingSafeEqual} from 'node:crypto';
export function createEnrollment({now=Date.now}={}) {
  let pending=null;
  return {
    issue(){const code=randomBytes(32).toString('base64url');pending={code,expiresAt:now()+5*60000};return {...pending};},
    redeem(header){
      if(!pending||now()>=pending.expiresAt){pending=null;return false;}
      const actual=typeof header==='string'?header.replace(/^Bearer /,''):'';
      if(typeof header!=='string'||!header.startsWith('Bearer ')||!/^[A-Za-z0-9_-]{43}$/.test(actual))return false;
      if(!timingSafeEqual(Buffer.from(actual),Buffer.from(pending.code)))return false;
      pending=null;return true;
    },
    cancel(){pending=null;}
  };
}
