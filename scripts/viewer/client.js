import RFBModule from '@novnc/novnc/lib/rfb.js';
const RFB = RFBModule.default || RFBModule;
let rfb, channel;
const post=value=>window.webkit.messageHandlers.viewer.postMessage(value);
window.deckStart=()=>{
 channel={readyState:1,protocol:'binary',binaryType:'arraybuffer',onerror:null,onmessage:null,onopen:null,onclose:null,
 send(data){const bytes=new Uint8Array(data.buffer||data,data.byteOffset||0,data.byteLength);let text='';for(const b of bytes)text+=String.fromCharCode(b);post({kind:'send',data:btoa(text)});},
 close(){this.readyState=3;post({kind:'close'});}};
 rfb=new RFB(document.getElementById('screen'),channel,{shared:true});rfb.viewOnly=true;rfb.scaleViewport=true;rfb.resizeSession=false;rfb.qualityLevel=5;
 rfb.addEventListener('connect',()=>post({kind:'connected'}));
 rfb.addEventListener('disconnect',()=>post({kind:'disconnected'}));
 rfb.addEventListener('credentialsrequired',()=>{post({kind:'failed'});rfb.disconnect();});
 rfb.addEventListener('securityfailure',()=>post({kind:'failed'}));
};
window.deckReceive=data=>{const raw=atob(data);const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));channel?.onmessage?.({data:bytes.buffer});};
window.deckControl=enabled=>{if(rfb)rfb.viewOnly=!enabled;};
window.deckKey=(key)=>{if(rfb&&!rfb.viewOnly)rfb.sendKey(key);};
window.deckText=text=>{if(rfb&&!rfb.viewOnly)for(const c of text){const n=c.codePointAt(0);rfb.sendKey(n<=255?n:0x01000000|n);}};
window.deckStop=()=>rfb?.disconnect();
post({kind:'ready'});
