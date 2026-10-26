import { randomUUID } from 'node:crypto';
import { supportsLiveVersion } from '../desktop/compatibility.mjs';
import { SessionError } from './session.mjs';
import { validateGatewayConnection } from './gateway.mjs';
const BACKEND='https://api2.cursor.sh/aiserver.v1.GrokBotService/EnsureSandBox';
export function createConnectionResolver({session,currentAccountScope,fetchImpl=fetch}) {
  let cached;
  return async () => {
    const auth=await session();
    if(!supportsLiveVersion(auth.appVersion))throw new SessionError('unsupported-or-signed-out');
    if(await currentAccountScope()!==auth.accountScope)throw new SessionError('account-changed');
    if(cached?.accountScope===auth.accountScope && cached.teamId===auth.teamId && cached.appVersion===auth.appVersion && Date.now()<cached.until) return cached.connection;
    const headers={'content-type':'application/json','connect-protocol-version':'1',authorization:`Bearer ${auth.token}`,
      'user-agent':'GrokDeck/0.2.0','x-cursor-client-type':'sand','x-cursor-client-version':auth.appVersion,
      'x-sand-box-namespace':'prod','x-cursor-client-os':process.platform,'x-ghost-mode':'true','x-request-id':randomUUID()};
    if(auth.teamId)headers['x-cursor-team-id']=auth.teamId;
    const response=await fetchImpl(BACKEND,{method:'POST',headers,body:JSON.stringify({wake:true}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(response.redirected||response.status>=300&&response.status<400){await response.body?.cancel().catch(()=>{});throw new SessionError('gateway-discovery-failed');}
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw new SessionError(response.status===401||response.status===403?'session-rejected':'gateway-discovery-failed');}
    const declared=response.headers.get('content-length');
    if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>65536)){await response.body?.cancel().catch(()=>{});throw new SessionError('invalid-discovery');}
    const chunks=[];let size=0;const reader=response.body?.getReader();
    if(!reader)throw new SessionError('invalid-discovery');
    try {for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw new SessionError('invalid-discovery');}chunks.push(Buffer.from(value));}}
    finally {reader.releaseLock();}
    const raw=Buffer.concat(chunks).toString('utf8');
    let box;try{box=JSON.parse(raw);}catch{throw new SessionError('invalid-discovery');}
    if(await currentAccountScope()!==auth.accountScope)throw new SessionError('account-changed');
    const latest=await session();
    if(latest.accountScope!==auth.accountScope||latest.teamId!==auth.teamId||latest.appVersion!==auth.appVersion)throw new SessionError('account-changed');
    if(!box||typeof box!=='object'||Array.isArray(box)||typeof box.gatewayUrl!=='string'||!box.gatewayUrl)throw new SessionError('gateway-asleep-or-unavailable');
    if(box.gatewayToken!==undefined&&typeof box.gatewayToken!=='string')throw new SessionError('invalid-discovery');
    const connection={baseUrl:box.gatewayUrl,...box.gatewayToken?{token:box.gatewayToken}:{},headers:{},accountScope:auth.accountScope,teamId:auth.teamId};
    if(box.networkToken)connection.headers['x-anyrun-network-token']=box.networkToken;
    else if(box.gatewayPortToken)connection.headers['x-anyrun-port-token']=box.gatewayPortToken;
    connection.viewerRoute={primaryUrl:box.vncUrl,forkBaseUrl:box.forkVncBaseUrl,networkToken:box.networkToken,forkPortToken:box.forkVncPortToken};
    try{validateGatewayConnection(connection);}catch{throw new SessionError('invalid-discovery');}
    cached={appVersion:auth.appVersion,accountScope:auth.accountScope,teamId:auth.teamId,until:Date.now()+60000,connection};
    return connection;
  };
}
