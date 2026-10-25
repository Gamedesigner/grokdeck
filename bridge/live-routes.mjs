import { normalizeEntries } from '../desktop/cache.mjs';
import { loadComputers } from './computers.mjs';
import { loadAvatar } from './avatars.mjs';
const text=v=>typeof v==='string'?v:'';
const idPattern='[A-Za-z0-9_-]{1,128}';
const uuidPattern='[0-9a-fA-F-]{36}';
export async function liveRoute({req,url,respond,gateway}) {
  if(url.pathname==='/v1/health' && req.method==='GET') {
    await gateway.status();
    return respond(200,{apiVersion:1,name:'GrokDeck Bridge',readOnly:false,live:true});
  }
  if(url.pathname==='/v1/computers'){
    if(req.method!=='GET')return respond(405,{error:'Method not allowed.'});
    return respond(200,await loadComputers(gateway));
  }
  const match=url.pathname.match(new RegExp(`^/v1/agents/(${idPattern})/(messages|avatar|send|interrupt|sends/(${uuidPattern}))$`));
  if(url.pathname!=='/v1/agents'&&!match)return respond(404,{error:'Unknown endpoint.'});
  const mutation=match && ['send','interrupt'].includes(match[2]);
  if(req.method!==(mutation?'POST':'GET'))return respond(405,{error:'Method not allowed.'});
  if(match?.[2]==='avatar'){
    const avatar=await loadAvatar(gateway,match[1]);
    return avatar?respond(200,avatar):respond(404,{error:'Avatar unavailable.'});
  }
  const roster=await gateway.roster();
  const metadata={kind:'live-gateway',available:true,checkedAt:Date.now(),version:'0.75.0',cacheUpdatedAt:Date.now(),warning:null};
  const row=match?roster.find(a=>a.id===match[1]):null;
  if(match&&!row)return respond(404,{error:'Agent not found in the signed-in account.'});
  if(!match)return respond(200,{apiVersion:1,agents:roster.filter(a=>!a.isRemovedFromSidebar).map(a=>({
    id:a.id,name:a.name,description:text(a.description),section:'Your agents',hasUnread:a.hasUnread===true,
    awaitingResponse:!!a.awaitingUserResponse,lastActivityAt:typeof a.lastActivityAt==='number'?a.lastActivityAt:0,
    preview:text(a.lastEntry?.text)||text(a.description),messageCount:0,cachedAt:0,
  })),sections:[],source:metadata,warnings:[]});
  if(match[2]==='messages') {
    const page=await gateway.discussion(row.id);
    return respond(200,{apiVersion:1,agentId:row.id,name:row.name,cachedAt:Date.now(),messages:normalizeEntries(page.entries),source:metadata});
  }
  if(match[2].startsWith('sends/')) {
    const result=await gateway.acceptance({agentId:row.id,clientNonce:match[3]});
    const status=result.outcome==='found'?result.record.status:'unknown';
    return respond(200,{apiVersion:1,clientNonce:match[3],accepted:status==='accepted'?true:status==='rejected'?false:null,status});
  }
  const body=await requestJSON(req);
  if(match[2]==='interrupt') {
    if(Object.keys(body).length) return respond(400,{error:'Invalid request.'});
    const result=await gateway.interrupt(row.id);
    return respond(200,{apiVersion:1,hadActiveRun:result.hadActiveRun});
  }
  if(Object.keys(body).some(k=>!['prompt','clientNonce','replyToId'].includes(k)))return respond(400,{error:'Invalid request.'});
  let replyContext={};
  if(body.replyToId!==undefined){
    if(typeof body.replyToId!=='string'||body.replyToId.length<1||body.replyToId.length>256)return respond(400,{error:'Invalid reply target.'});
    const page=await gateway.discussion(row.id);
    const target=normalizeEntries(page.entries).find(entry=>entry.id===body.replyToId);
    if(!target)return respond(409,{error:'Reply target is no longer in the loaded discussion. Refresh and select it again.'});
    replyContext={replyToId:target.id,replyQuote:Array.from(target.content).slice(0,1000).join('')};
  }
  try {
    const result=await gateway.send({agentId:row.id,prompt:body.prompt,clientNonce:body.clientNonce,...replyContext});
    return respond(200,{apiVersion:1,...result,status:result.accepted?'accepted':'rejected'});
  }catch(error){
    if(error.code==='unknown_delivery')return respond(200,{apiVersion:1,clientNonce:error.clientNonce,accepted:null,status:'unknown'});
    throw error;
  }
}
async function requestJSON(req) {
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw Object.assign(new Error('JSON required'),{code:'invalid_request'});
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>256*1024)throw Object.assign(new Error('Request too large'),{code:'invalid_request'});chunks.push(chunk);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{code:'invalid_request'});}
  if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(new Error('Invalid request'),{code:'invalid_request'});
  return body;
}
