import { promises as fs } from 'node:fs';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {supportsLiveVersion} from '../desktop/compatibility.mjs';
import { defaultSource } from '../desktop/cache.mjs';
export class SessionError extends Error {
  constructor(code) { super(code); this.name='SessionError'; this.code=code; }
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
async function readJSONFile(file, maxSize) {
  const info=await fs.lstat(file);
  if(!info.isFile()||info.isSymbolicLink())throw new SessionError('session-unavailable');
  const handle=await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat=await handle.stat();
    if(!stat.isFile() || stat.size>maxSize)throw new SessionError('session-unavailable');
    const raw=await handle.readFile('utf8');
    if(Buffer.byteLength(raw)>maxSize)throw new SessionError('session-unavailable');
    return JSON.parse(raw);
  } finally {await handle.close();}
}
async function readContainers(sourcePath) {
  const status=await readJSONFile(path.join(sourcePath,'desktop-status.json'),16384);
  const disk=await readJSONFile(path.join(sourcePath,'sand-secrets.json'),131072);
  if(!record(status)||status.version!==1||!record(disk)||disk.version!==1)throw new SessionError('session-unavailable');
  const accounts=JSON.parse(disk['cursor-accounts']);
  if(!record(accounts)||!record(accounts.accounts))throw new SessionError('session-unavailable');
  return {status,disk,accounts};
}
export async function readSession({ decrypt, sourcePath=defaultSource(), now=Date.now }={}) {
  let disk, status, accounts;
  try {
    ({status,disk,accounts}=await readContainers(sourcePath));
  } catch { throw new SessionError('session-unavailable'); }
  if (status.signedIn!==true || !supportsLiveVersion(status.appVersion)) throw new SessionError('unsupported-or-signed-out');
  const scope=accounts.active, values=accounts.accounts?.[scope];
  if (typeof scope!=='string'||!/^[0-9a-f]{64}$/.test(scope)||!record(values)||typeof values['cursor-access-token']!=='string') throw new SessionError('session-unavailable');
  let token, claims, machineId;
  try {
    token=await decrypt(Buffer.from(values['cursor-access-token'],'base64'));
    if(typeof token!=='string'||token.length>16384)throw new Error('Invalid token');
    claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
    machineId=disk['cursor-machine-id'] ? await decrypt(Buffer.from(disk['cursor-machine-id'],'base64')) : '';
    if(typeof machineId!=='string'||machineId.length>1024)throw new Error('Invalid machine identity');
  } catch { throw new SessionError('keychain-unavailable'); }
  if (!record(claims)||typeof claims.sub!=='string'||createHash('sha256').update(claims.sub).digest('hex')!==scope) throw new SessionError('account-mismatch');
  if (!Number.isSafeInteger(claims.exp)||!Number.isFinite(claims.exp*1000)||claims.exp*1000<=now()+30000) throw new SessionError('session-expired');
  let teamId;
  if (values['cursor-selected-team-id']) {
    try { teamId=await decrypt(Buffer.from(values['cursor-selected-team-id'],'base64')); } catch { throw new SessionError('keychain-unavailable'); }
    if (typeof teamId!=='string'||!/^\d{1,32}$/.test(teamId)) throw new SessionError('invalid-team');
  }
  return {token,accountScope:scope,machineId,teamId,appVersion:status.appVersion};
}
export async function currentAccountScope(sourcePath=defaultSource()) {
  try {
    const {status,accounts}=await readContainers(sourcePath);
    return status.signedIn===true&&supportsLiveVersion(status.appVersion)&&typeof accounts.active==='string'&&/^[0-9a-f]{64}$/.test(accounts.active) ? accounts.active : null;
  } catch { return null; }
}

export async function sourceVersion(sourcePath=defaultSource()) {
  const status=await readJSONFile(path.join(sourcePath,'desktop-status.json'),16384);
  return typeof status.appVersion==='string'?status.appVersion:null;
}
