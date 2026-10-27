const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
// Launch only our packaged helper; never execute commands received from the UI or server.
function createBridgeProcess({app,client,spawnImpl=spawn,sleep=delay,now=Date.now,timeout=45000,hasPendingSends=()=>false}) {
  let owned=null,pending=null,stopped=false;
  async function retireForRecovery(child) {
    if(!child||owned!==child)return;
    // The helper holds delivery receipts in memory. An uncertain send must be
    // resolved before an automatic restart can discard those receipts.
    if(hasPendingSends())throw new Error('A message is still awaiting confirmation. Check its status before reconnecting.');
    let exited=child.exitCode!=null||child.signalCode!=null;
    const onExit=()=>{exited=true;};
    child.once('exit',onExit);
    try {
      if(!exited&&child.kill()===false)throw new Error('Could not stop the previous live helper. Try again after it exits.');
      const deadline=now()+Math.min(timeout,5000);
      while(!exited&&!stopped&&now()<deadline)await sleep(50);
      if(!exited)throw new Error('The previous live helper is still stopping. Try reconnecting again.');
      if(owned===child)owned=null;
    } finally {child.removeListener('exit',onExit);}
  }
  async function ensure() {
    if(stopped)throw new Error('Bridge manager stopped');
    if(pending)return pending;
    pending=(async()=>{
      try {await client.health();return {owned:false};}catch{}
      if(stopped)throw new Error('Bridge manager stopped');
      // A process left over from a previously healthy connection will not
      // recover by waiting through another full startup timeout. Replace only
      // our own helper, and wait for its exit so both cannot compete for a port.
      if(owned)await retireForRecovery(owned);
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
        // A spawn failure has no PID. Errors on an already running child must
        // not lose ownership before its exit (for example, a failed kill).
        child.once('error',()=>{if(owned===child&&child.pid==null)owned=null;});
        child.once('exit',()=>{if(owned===child)owned=null;});
      }
      const deadline=now()+timeout;
      while(owned&&!stopped&&now()<deadline) {
        await sleep(300);
        try{await client.health();return {owned:true};}catch{}
      }
      if(owned)await retireForRecovery(owned);
      throw new Error('Could not start live bridge. Check Grok Bot sign-in, version and secure-storage access.');
    })();
    try{return await pending;}finally{pending=null;}
  }
  function stop(){stopped=true;if(owned){owned.kill();owned=null;}}
  return {ensure,stop};
}
module.exports={createBridgeProcess};
