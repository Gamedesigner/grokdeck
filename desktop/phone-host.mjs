import os from 'node:os';
import {startLANBridge,privateIPv4} from '../bridge/lan.mjs';
import {createEnrollment} from '../bridge/pairing.mjs';
export function createPhoneHost({ensureLive,start=startLANBridge,interfaces=os.networkInterfaces}={}) {
  const enrollment=createEnrollment();let host=null,active=null,pending=null;
  const hosts=()=>Object.entries(interfaces()).flatMap(([name,rows])=>rows.filter(r=>!r.internal&&r.family==='IPv4'&&privateIPv4(r.address)).map(r=>({name,address:r.address})));
  const status=()=>({active:!!active,endpoint:active?.endpoint||null,host});
  async function enable(address) {
    if(!hosts().some(row=>row.address===address))throw new Error('Choose a local private address');
    if(pending)throw new Error('Phone connection is starting');
    if(active){if(host!==address)throw new Error('Stop the current phone connection first');return status();}
    pending=(async()=>{await ensureLive();active=await start({host:address,port:43874,enrollment});host=address;return status();})();
    try{return await pending;}finally{pending=null;}
  }
  function setup() {
    if(!active)throw new Error('Start phone connection first');
    const invitation=enrollment.issue();
    return {text:JSON.stringify({grokdeck:1,endpoint:active.endpoint,pin:active.fingerprint,code:invitation.code}),expiresAt:invitation.expiresAt};
  }
  async function stop(){if(pending)await pending.catch(()=>{});enrollment.cancel();const old=active;active=null;host=null;if(old)await new Promise(r=>{old.server.close(r);old.server.closeAllConnections();});return status();}
  return {hosts,status,enable,setup,stop};
}
