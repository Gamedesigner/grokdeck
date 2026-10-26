import {test,expect} from '@playwright/test';
test('live composer requires explicit send and preserves an uncertain send until checked',async({page})=>{
 await page.addInitScript(()=>{
  const messages=Array.from({length:30},(_,i)=>({id:`m-${i}`,role:'assistant',content:`Live message ${i} `+'context '.repeat(20),timestamp:Date.now()+i,type:'text',streaming:false}));
  const agent={id:'agent-one',name:'Test agent',description:'Fixture',color:'#aabbcc',section:'Tests',sectionId:'tests',pinned:false,hasUnread:false,unreadCount:0,awaitingResponse:false,lastActivityAt:Date.now(),preview:'Latest result',cachedAt:Date.now(),messages};
  const source={kind:'local-cache',path:'/fixture',available:true,version:'0.75.0',checkedAt:Date.now(),cacheUpdatedAt:Date.now(),warning:null};
  let live=false,prefs={checkReleases:false,theme:'dark',accent:'violet',density:'comfortable',fontSize:14,pins:[],recents:[],notes:{},seen:{},drafts:{}};
  (window as any).__sends=[];
  const snapshot=()=>({agents:[agent],sections:[{id:'tests',name:'Tests',agentIds:[agent.id]}],source:{...source,kind:live?'live-gateway':'local-cache'},warnings:[]});
  (window as any).grokdeck={snapshot:async()=>snapshot(),preferences:async()=>prefs,savePreferences:async(p:any)=>(prefs={...prefs,...p}),info:async()=>({version:'0.1.0',platform:'darwin',arch:'arm64',supportedSourceVersion:'0.75.0'}),
   connectLive:async()=>{live=true;return snapshot();},disconnectLive:async()=>{live=false;return snapshot();},liveMessages:async()=>({messages,source:{...source,kind:'live-gateway'}}),
   send:async(id:string,prompt:string,nonce:string,replyToId?:string)=>{(window as any).__sends.push({id,prompt,nonce,replyToId});return{apiVersion:1,clientNonce:nonce,accepted:null,status:'unknown'};},
   acceptance:async(_:string,nonce:string)=>({apiVersion:1,clientNonce:nonce,accepted:true,status:'accepted'}),interrupt:async()=>({hadActiveRun:false}),openAgent:async()=>true,copy:async()=>true,exportConversation:async()=>false};
 });
 await page.goto('/');await expect(page.getByText('Live gateway',{exact:true})).toBeVisible();await page.locator('.agent-main').first().click();
 await expect(page.getByText('Live gateway',{exact:true})).toBeVisible();
 await expect.poll(()=>page.locator('.transcript').evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(10);
 await expect(page.getByLabel('Search agents and discussions')).toHaveCount(0);
 await expect(page.getByLabel('Search this discussion')).toHaveCount(0);
 await page.getByRole('button',{name:'Search discussion',exact:true}).click();
 await page.getByLabel('Search this discussion').fill('Live message 29');
 await expect(page.locator('.message')).toHaveCount(1);
 await page.getByRole('button',{name:'Close discussion search',exact:true}).click();
 await expect(page.getByLabel('Search this discussion')).toHaveCount(0);
 await page.getByRole('button',{name:'Reply to message',exact:true}).last().click();
 await expect(page.getByRole('region',{name:'Reply context'})).toContainText('Live message 29');
 await page.getByRole('button',{name:'Cancel reply',exact:true}).click();
 await expect(page.getByRole('region',{name:'Reply context'})).toHaveCount(0);
 await page.getByRole('button',{name:'Reply to message',exact:true}).last().click();
 await page.getByLabel('Draft follow-up').fill('An explicit message 🌍 ');
 await page.getByRole('button',{name:'Emoji',exact:true}).click();
 await page.getByRole('button',{name:'Insert ❤️',exact:true}).click();
 await expect(page.getByLabel('Draft follow-up')).toHaveValue('An explicit message 🌍 ❤️');
 expect(await page.evaluate(()=>(window as any).__sends.length)).toBe(0);
 await page.getByRole('button',{name:'Send message',exact:true}).click();expect(await page.evaluate(()=>(window as any).__sends[0].replyToId)).toBe('m-29');expect(await page.evaluate(()=>(window as any).__sends[0].prompt)).toBe('An explicit message 🌍 ❤️');await expect(page.getByText('Delivery is uncertain. Do not resend.')).toBeVisible();await expect(page.getByLabel('Draft follow-up')).toBeDisabled();await expect(page.getByRole('button',{name:'Cancel reply',exact:true})).toBeDisabled();
 await page.waitForTimeout(2200);expect(await page.evaluate(()=>(window as any).__sends.length)).toBe(1);
 await page.getByRole('button',{name:'Check status',exact:true}).click();await expect(page.getByLabel('Draft follow-up')).toBeEnabled();await expect(page.getByLabel('Draft follow-up')).toHaveValue('');await expect(page.getByRole('region',{name:'Reply context'})).toHaveCount(0);
});
