import {SessionError} from './session.mjs';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
export function normalizeOrganization(sections,pins){return {sections:(sections??[]).map(s=>({id:s.id,name:s.name,agentIds:s.agentIds??[]})),pins:pins??[]};}
export function validOrganization(o){
 if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!['sections','pins'].includes(k))||!Array.isArray(o.sections)||o.sections.length>200||!Array.isArray(o.pins)||o.pins.length>2000||!o.pins.every(id)||new Set(o.pins).size!==o.pins.length)return false;
 if(o.sections.some(s=>!s||Object.keys(s).some(k=>!['id','name','agentIds'].includes(k))||!id(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>100||!Array.isArray(s.agentIds)||s.agentIds.length>10000||!s.agentIds.every(id)))return false;
 const ids=o.sections.flatMap(s=>s.agentIds);return new Set(ids).size===ids.length&&new Set(o.sections.map(s=>s.id)).size===o.sections.length;
}
export function createRuntimeSettings({session,fetchImpl=fetch}){
 return async patch=>{
  const auth=await session();
  const headers={'content-type':'application/json','connect-protocol-version':'1',authorization:`Bearer ${auth.token}`,'x-cursor-client-type':'sand','x-cursor-client-version':auth.appVersion,'x-cursor-client-os':process.platform};
  if(auth.teamId)headers['x-cursor-team-id']=auth.teamId;
  if(patch!==undefined&&!validOrganization(patch))throw new SessionError('invalid-organization');
  const body=patch===undefined?{}:{sidebarSections:{sections:patch.sections},pinnedAgents:{agentIds:patch.pins}};
  const response=await fetchImpl('https://api2.cursor.sh/aiserver.v1.GrokBotService/'+(patch===undefined?'GetGrokBotUserRuntimeSettings':'UpdateGrokBotUserRuntimeSettings'),{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok||response.redirected){await response.body?.cancel();throw new SessionError('organization-unavailable');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw new SessionError('organization-unavailable');}chunks.push(value);}}finally{reader.releaseLock();}
  const current=await session();if(current.accountScope!==auth.accountScope||current.teamId!==auth.teamId)throw new SessionError('account-changed');
  const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const o=normalizeOrganization(parsed.settings?.sidebarSections?.sections,parsed.settings?.pinnedAgents?.agentIds);
  if(!validOrganization(o))throw new SessionError('organization-unavailable');return o;
 };
}
