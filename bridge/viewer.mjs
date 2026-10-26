import WebSocket from 'ws';
import {randomBytes} from 'node:crypto';
const LIMIT=2*1024*1024;
const fail=()=>{throw Object.assign(new Error('Viewer session unavailable.'),{code:'viewer_unavailable'});};
export function createViewers({Socket=WebSocket,now=Date.now}={}){
 const sessions=new Map();
 function close(id){const s=sessions.get(id);if(s){s.ws.terminate();sessions.delete(id);}}
 const timer=setInterval(()=>{for(const [id,s] of sessions)if(now()-s.touched>30000||now()>s.expires)close(id);},5000);timer.unref();
 return {
 async open(target){
  if(sessions.size>=4)fail();
  const ws=new Socket(target.url,['binary'],{headers:target.headers,followRedirects:false,handshakeTimeout:8000,maxPayload:LIMIT,perMessageDeflate:false});
  const id=randomBytes(24).toString('base64url');
  const s={ws,scope:target.scope,queue:[],bytes:0,closed:false,touched:now(),expires:now()+10*60*1000,seq:0,last:null};sessions.set(id,s);
  ws.on('message',(data,binary)=>{if(!binary||s.bytes+data.length>LIMIT){s.closed=true;ws.terminate();return;}s.queue.push(Buffer.from(data));s.bytes+=data.length;});
  ws.on('close',()=>{s.closed=true;});ws.on('error',()=>{s.closed=true;});
  try{await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);ws.once('close',()=>reject(new Error('closed')));});}
  catch{close(id);fail();}
  return {apiVersion:1,id};
 },
 exchange(id,scope,{sequence,data}){
  const s=sessions.get(id);if(!s||s.scope!==scope)fail();
  if(now()>s.expires||now()-s.touched>30000){close(id);fail();}
  if(!Number.isSafeInteger(sequence)||typeof data!=='string'||data.length>128*1024||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))fail();
  if(sequence===s.seq-1&&s.last)return s.last;
  if(sequence!==s.seq)fail();
  s.touched=now();if(data&& !s.closed){if(s.ws.bufferedAmount>LIMIT){close(id);fail();}s.ws.send(Buffer.from(data,'base64'));}
  const result={apiVersion:1,sequence,data:Buffer.concat(s.queue).toString('base64'),closed:s.closed};
  s.queue=[];s.bytes=0;s.seq++;s.last=result;return result;
 },
 close(id,scope){const s=sessions.get(id);if(s&&s.scope!==scope)fail();close(id);return {apiVersion:1};},
 dispose(){clearInterval(timer);for(const id of sessions.keys())close(id);}
 };
}
