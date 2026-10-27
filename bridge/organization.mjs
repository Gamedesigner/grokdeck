import {SessionError} from './session.mjs';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const usesCloudOrganization=version=>version==='0.77.0';
export function normalizeOrganization(sections,pins){return {sections:(sections??[]).map(s=>({id:s.id,name:s.name,agentIds:s.agentIds??[]})),pins:pins??[]};}
export function validOrganization(o){
 if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!['sections','pins'].includes(k))||!Array.isArray(o.sections)||o.sections.length>200||!Array.isArray(o.pins)||o.pins.length>2000||!o.pins.every(id)||new Set(o.pins).size!==o.pins.length)return false;
 if(o.sections.some(s=>!s||Object.keys(s).some(k=>!['id','name','agentIds'].includes(k))||!id(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>100||!Array.isArray(s.agentIds)||s.agentIds.length>10000||!s.agentIds.every(id)))return false;
 const ids=o.sections.flatMap(s=>s.agentIds);return new Set(ids).size===ids.length&&new Set(o.sections.map(s=>s.id)).size===o.sections.length;
}
async function readReply(response,limit){
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit)){await response.body?.cancel();throw new SessionError('organization-unavailable');}
 const reader=response.body?.getReader();if(!reader)throw new SessionError('organization-unavailable');
 const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new SessionError('organization-unavailable');}chunks.push(value);}}
 finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SessionError('organization-unavailable');}
}
export function createRuntimeSettings({session,fetchImpl=fetch}){
 // Snapshots carry only host-side routing metadata. Their saved base and account
 // binding stay in this closure; organization responses expose sections and pins.
 const snapshots=new WeakMap();
 const sameAccount=(a,b)=>a.accountScope===b.accountScope&&a.teamId===b.teamId&&a.appVersion===b.appVersion;
 const request=async(patch,baseSnapshot)=>{
  const auth=await session(),base=baseSnapshot===undefined?undefined:snapshots.get(baseSnapshot);
  if(baseSnapshot!==undefined&&(!base||!sameAccount(auth,base)))throw new SessionError('account-changed');
  if(patch!==undefined&&(!validOrganization(patch)||(usesCloudOrganization(auth.appVersion)&&!base)))throw new SessionError('invalid-organization');
  const headers={'content-type':'application/json','connect-protocol-version':'1',authorization:`Bearer ${auth.token}`,'x-cursor-client-type':'sand','x-cursor-client-version':auth.appVersion,'x-cursor-client-os':process.platform};
  if(auth.teamId)headers['x-cursor-team-id']=auth.teamId;
  const body=patch===undefined?{}:{sidebarSections:{sections:patch.sections},pinnedAgents:{agentIds:patch.pins},
   ...(usesCloudOrganization(auth.appVersion)&&base.sectionsPresent?{sidebarSectionsBase:{sections:base.sections}}:{})};
  const response=await fetchImpl('https://api2.cursor.sh/aiserver.v1.GrokBotService/'+(patch===undefined?'GetGrokBotUserRuntimeSettings':'UpdateGrokBotUserRuntimeSettings'),{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!sameAccount(auth,await session())){await response.body?.cancel();throw new SessionError('account-changed');}
  if(response.redirected){await response.body?.cancel();throw new SessionError('organization-unavailable');}
  if(!response.ok){
   if(patch!==undefined&&response.status===409&&/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){
    const error=await readReply(response,16384);
    if(error?.code==='aborted')throw new SessionError('organization-conflict');
   }else await response.body?.cancel();
   throw new SessionError('organization-unavailable');
  }
  const parsed=await readReply(response,2*1024*1024);
  if(!sameAccount(auth,await session()))throw new SessionError('account-changed');
  if(!record(parsed)||(parsed.settings!==undefined&&!record(parsed.settings)))throw new SessionError('organization-unavailable');
  const settings=parsed.settings??{},sectionsPresent=Object.hasOwn(settings,'sidebarSections');
  if(patch!==undefined&&usesCloudOrganization(auth.appVersion)&&(!sectionsPresent||!record(settings.pinnedAgents)))throw new SessionError('organization-unavailable');
  if(sectionsPresent&&(!record(settings.sidebarSections)||(settings.sidebarSections.sections!==undefined&&!Array.isArray(settings.sidebarSections.sections))))throw new SessionError('organization-unavailable');
  let organization;try{organization=normalizeOrganization(settings.sidebarSections?.sections,settings.pinnedAgents?.agentIds);}catch{throw new SessionError('organization-unavailable');}
  if(!validOrganization(organization))throw new SessionError('organization-unavailable');
  const snapshot=Object.freeze({organization,sectionsPresent,appVersion:auth.appVersion});
  snapshots.set(snapshot,{accountScope:auth.accountScope,teamId:auth.teamId,appVersion:auth.appVersion,sectionsPresent,sections:structuredClone(organization.sections)});
  return snapshot;
 };
 const api=async patch=>(await request(patch)).organization;
 api.readSnapshot=()=>request();
 api.writeSnapshot=async(patch,snapshot)=>(await request(patch,snapshot)).organization;
 return api;
}
