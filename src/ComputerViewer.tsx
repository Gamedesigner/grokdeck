import {useEffect,useRef,useState} from 'react';
import RFBModule from '@novnc/novnc/lib/rfb.js';
import type {Bridge} from './types';
const RFB=RFBModule.default||RFBModule;
export function ComputerViewer({bridge,id,name,windowIndex=null,onClose}:{bridge:Bridge;id:string;name:string;windowIndex?:number|null;onClose:()=>void}){
 const screen=useRef<HTMLDivElement>(null),panel=useRef<HTMLDivElement>(null),rfbRef=useRef<any>(null);
 const controlRef=useRef(true);
 const [control,setControl]=useState(true),[status,setStatus]=useState('Connecting…');
 useEffect(()=>{
  let stopped=false,session='',sequence=0,timer:ReturnType<typeof setTimeout>,startupTimer:ReturnType<typeof setTimeout>,rfb:any;
  let queued:Uint8Array[]=[],size=0;
  const close=()=>{if(stopped)return;stopped=true;clearTimeout(timer);clearTimeout(startupTimer);rfb?.disconnect();if(session)void bridge.closeViewer?.(session).catch(()=>{});};
  const fail=()=>{setStatus('Computer connection ended. Close and reopen it, or open this agent in Grok Bot.');close();};
  const channel:any={readyState:1,protocol:'binary',binaryType:'arraybuffer',onmessage:null,onclose:null,onerror:null,onopen:null,
   send(data:ArrayBuffer|ArrayBufferView){const bytes=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);if(size+bytes.length>512*1024){fail();return;}queued.push(bytes.slice());size+=bytes.length;},close(){this.readyState=3;}};
  const poll=async()=>{
   if(stopped)return;
   try{
    const outgoing=new Uint8Array(Math.min(size,64000));let offset=0;
    while(queued.length&&offset<outgoing.length){const part=queued[0],take=Math.min(part.length,outgoing.length-offset);outgoing.set(part.subarray(0,take),offset);offset+=take;size-=take;if(take===part.length)queued.shift();else queued[0]=part.subarray(take);}
    let raw='';for(const b of outgoing)raw+=String.fromCharCode(b);
    const reply=await bridge.exchangeViewer!(session,sequence,btoa(raw));
    if(stopped)return;
    if(reply.sequence!==sequence||typeof reply.data!=='string'||reply.data.length>3*1024*1024||reply.closed)throw Error('closed');
    sequence++;
    if(reply.data)channel.onmessage?.({data:Uint8Array.from(atob(reply.data),c=>c.charCodeAt(0)).buffer});
    if(!stopped)timer=setTimeout(poll,60);
   }catch{if(!stopped)fail();}
  };
  void (async()=>{
   try{
    const opened=await bridge.openViewer!(id,windowIndex);session=opened.id;
    if(stopped){void bridge.closeViewer?.(session);return;}
    rfb=new RFB(screen.current,channel,{shared:true});rfbRef.current=rfb;rfb.scaleViewport=true;rfb.resizeSession=false;rfb.viewOnly=!controlRef.current;rfb.qualityLevel=5;
    startupTimer=setTimeout(fail,20000);
    rfb.addEventListener('connect',()=>{clearTimeout(startupTimer);if(!stopped)setStatus('Connected');});
    for(const event of ['disconnect','securityfailure','credentialsrequired'])rfb.addEventListener(event,()=>{if(!stopped)fail();});
    void poll();
   }catch{if(!stopped)fail();}
  })();
  const hide=()=>{if(document.hidden){setStatus('Viewer paused. Close and reopen to reconnect.');close();}};
  document.addEventListener('visibilitychange',hide);
  return ()=>{close();document.removeEventListener('visibilitychange',hide);};
 },[bridge,id,windowIndex]);
 return <div className="desktop-overlay" role="dialog" aria-modal="true" aria-label={`Computer for ${name}`} ref={panel}>
  <header><strong>{name} · Computer</strong><span role="status">{status}</span>
   <label><input type="checkbox" checked={control} onChange={e=>{controlRef.current=e.target.checked;setControl(e.target.checked);if(rfbRef.current)rfbRef.current.viewOnly=!e.target.checked;}}/> Control</label>
   <button className="button" onClick={()=>void panel.current?.requestFullscreen().catch(()=>{})}>Full screen</button>
   <button className="button" onClick={()=>void bridge.openAgent(id)}>Open in Grok Bot</button>
   <button className="button" onClick={onClose}>Close computer</button>
  </header><div className="computer-screen" ref={screen}/>
 </div>;
}
