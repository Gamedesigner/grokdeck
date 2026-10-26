const STATES=new Set(['absent','hibernated','running']);
// This module only invokes the observed status command. It never invokes ensure,
// start, update, hand-back or a VNC connection, and never returns VNC credentials.
export async function loadComputers(gateway,{concurrency=3,budgetMs=8000,now=Date.now}={}) {
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>3||!Number.isInteger(budgetMs)||budgetMs<1||budgetMs>10000)throw new TypeError('Invalid computer status limits.');
  const controller=new AbortController();
  const roster=await gateway.roster({signal:controller.signal,timeoutMs:2000});
  const agents=roster.filter(a=>!a.isRemovedFromSidebar&&!a.isGroup);
  const results=agents.map(a=>({agentId:a.id,name:a.name,state:'unknown',windows:[],checkedAt:0,error:'not-checked'}));
  let next=0,closed=false,timer;
  async function worker(){
    while(!closed){
      const index=next++;if(index>=agents.length)return;
      const agent=agents[index];
      try{
        const status=await gateway.computer(agent.id,{signal:controller.signal});
        if(closed)return;
        if(status===null){results[index]={agentId:agent.id,name:agent.name,state:'unknown',windows:[],checkedAt:now(),error:'status-not-reported'};continue;}
        if(status!==null&&(!status||status.agentId!==agent.id||!STATES.has(status.state)))throw new Error('Malformed status');
        results[index]={agentId:agent.id,name:agent.name,state:status.state,
          windows:(status.windows??[]).filter(w=>Number.isSafeInteger(w.windowIndex)&&w.windowIndex>=0&&w.windowIndex<=63).map(w=>({index:w.windowIndex,label:`Desktop ${w.windowIndex+1}`})),checkedAt:now()};
      }catch{
        if(closed)return;
        results[index]={agentId:agent.id,name:agent.name,state:'unknown',windows:[],checkedAt:now(),error:'status-unavailable'};
      }
    }
  }
  try{
    await Promise.race([Promise.all(Array.from({length:Math.min(concurrency,agents.length)},worker)),new Promise(resolve=>{timer=setTimeout(resolve,budgetMs);})]);
  }finally{closed=true;controller.abort();clearTimeout(timer);}
  // Create a detached result: late in-flight reads cannot mutate an HTTP response.
  return {apiVersion:1,checkedAt:now(),computers:results.map(r=>({...r,windows:r.windows.map(w=>({...w}))})),complete:results.every(r=>r.state!=='unknown')};
}
