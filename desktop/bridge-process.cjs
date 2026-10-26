const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
// Launch only our packaged helper; never execute commands received from the UI or server.
function createBridgeProcess({app,client,spawnImpl=spawn,sleep=delay,now=Date.now,timeout=45000}) {
  let owned=null,pending=null,stopped=false;
  async function ensure() {
    if(stopped)throw new Error('Bridge manager stopped');
    if(pending)return pending;
    pending=(async()=>{
      try {await client.health();return {owned:false};}catch{}
      if(stopped)throw new Error('Bridge manager stopped');
      if(!owned) {
        const env={...process.env,GROKDECK_HELPER:'live'};
        delete env.ELECTRON_RUN_AS_NODE;
        delete env.GROKDECK_DEV_URL;
        delete env.GROKDECK_SCREENSHOT;
        delete env.GROKDECK_BRIDGE_PORT;
        const child=spawnImpl(process.execPath,[app.getAppPath(),'--grokdeck-live-helper'],{
          env,stdio:'ignore',windowsHide:true,detached:false,
        });
        owned=child;
        child.once('error',()=>{if(owned===child)owned=null;});
        child.once('exit',()=>{if(owned===child)owned=null;});
      }
      const deadline=now()+timeout;
      while(owned&&!stopped&&now()<deadline) {
        await sleep(300);
        try{await client.health();return {owned:true};}catch{}
      }
      if(owned){owned.kill();owned=null;}
      throw new Error('Could not start live bridge. Check Grok Bot sign-in, version and secure-storage access.');
    })();
    try{return await pending;}finally{pending=null;}
  }
  function stop(){stopped=true;if(owned){owned.kill();owned=null;}}
  return {ensure,stop};
}
module.exports={createBridgeProcess};
