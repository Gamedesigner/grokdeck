const path = require('node:path');
const os = require('node:os');
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validId(id){if(typeof id!=='string'||!ID.test(id))throw new Error('Invalid agent');return id;}
function validNonce(nonce){if(typeof nonce!=='string'||!UUID.test(nonce))throw new Error('Invalid message identifier');return nonce;}
function createLiveClient({fetchImpl,credentialFile=path.join(os.homedir(),'.grokdeck-bridge','pairing-token-v2')}={}){
 let protection;
 async function request(route,body,timeout=20000){
  if(!protection)protection=import('../bridge/local-tls.mjs').then(m=>m.protectDirectory(path.dirname(credentialFile))).catch(error=>{protection=null;throw error;});
  await protection;
  const {readPrivateFile}=await import('../bridge/local-tls.mjs');
  const token=(await readPrivateFile(credentialFile,128)).trim();
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Pairing unavailable');
  const transport=fetchImpl || ((url,options)=>import('../bridge/local-tls.mjs').then(m=>m.localFetch(url,options,path.dirname(credentialFile))));
  const response=await transport('https://127.0.0.1:43875/v1/'+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(timeout)});
  if(!response.ok||response.redirected)throw new Error('Live bridge unavailable');
  const reader=response.body?.getReader();if(!reader)throw new Error('Invalid bridge reply');
  let bytes=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8*1024*1024){await reader.cancel();throw new Error('Bridge reply too large');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  const reply=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(reply.apiVersion!==1)throw new Error('Unsupported bridge');return reply;
 }
 function receipt(reply,nonce){if(reply.clientNonce!==nonce||!['accepted','rejected','unknown','pending'].includes(reply.status)||![true,false,null].includes(reply.accepted))throw new Error('Invalid send receipt');return reply;}
 return {
  async health(){const reply=await request('health',undefined,2000);if(reply.live!==true||reply.readOnly!==false)throw new Error('Live bridge is not enabled');return {live:true};},
  async avatar(id){
    const reply=await request(`agents/${validId(id)}/avatar`);
    const mime=reply.mimeType,encoded=reply.dataBase64;
    if(!['image/png','image/jpeg','image/webp'].includes(mime)||typeof encoded!=='string'||encoded.length>4*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new Error('Invalid avatar');
    const data=Buffer.from(encoded,'base64');
    const valid=mime==='image/png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?data[0]===255&&data[1]===216&&data[2]===255:data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
    if(!valid)throw new Error('Invalid avatar');return `data:${mime};base64,${encoded}`;
  },
  async computers(){
    const reply=await request('computers');
    if(!Array.isArray(reply.computers)||typeof reply.complete!=='boolean'||typeof reply.checkedAt!=='number'||reply.computers.some(c=>!c||typeof c.agentId!=='string'||!ID.test(c.agentId)||typeof c.name!=='string'||typeof c.checkedAt!=='number'||!['absent','hibernated','running','unknown'].includes(c.state)||!Array.isArray(c.windows)||c.windows.some(w=>!Number.isInteger(w.index)||typeof w.label!=='string')))throw new Error('Invalid computers reply');
    return reply;
  },
  async roster(){const reply=await request('agents');if(!Array.isArray(reply.agents)||reply.source?.kind!=='live-gateway')throw new Error('Invalid live roster');return reply;},
  async messages(id){const reply=await request(`agents/${validId(id)}/messages`);if(reply.agentId!==id||!Array.isArray(reply.messages)||reply.source?.kind!=='live-gateway')throw new Error('Invalid live discussion');return reply;},
  async send(id,prompt,nonce,replyToId){validId(id);validNonce(nonce);if(replyToId!==undefined&&(typeof replyToId!=='string'||!replyToId.length||replyToId.length>256))throw new Error('Invalid reply identifier');if(typeof prompt!=='string'||!prompt.trim()||prompt.length>50000)throw new Error('Invalid message');try{return receipt(await request(`agents/${id}/send`,{prompt,clientNonce:nonce,...(replyToId===undefined?{}:{replyToId})}),nonce);}catch{return {apiVersion:1,clientNonce:nonce,accepted:null,status:'unknown'};}},
  async acceptance(id,nonce){validId(id);validNonce(nonce);return receipt(await request(`agents/${id}/sends/${nonce}`),nonce);},
  async interrupt(id){const reply=await request(`agents/${validId(id)}/interrupt`,{});if(typeof reply.hadActiveRun!=='boolean')throw new Error('Invalid stop response');return reply;},
 };
}
module.exports={createLiveClient};
