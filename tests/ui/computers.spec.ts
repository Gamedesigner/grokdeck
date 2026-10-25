import {test,expect} from '@playwright/test';
test('bot images load once as local data and computer list is read-only with an active filter',async({page})=>{
 await page.addInitScript(()=>{
  const agents=['running','sleeping'].map((id,i)=>({id,name:i?'Sleeping bot':'Running bot',description:'Fixture',color:'#aabbcc',section:'Tests',sectionId:'tests',pinned:false,hasUnread:false,unreadCount:0,awaitingResponse:false,lastActivityAt:Date.now()-i,cachedAt:0,preview:'Latest result',messages:[]}));
  let live=false;
  const source={kind:'local-cache',path:'/fixture',available:true,version:'0.75.0',checkedAt:Date.now(),cacheUpdatedAt:Date.now(),warning:null};
  const snapshot=()=>({agents,sections:[],source:{...source,kind:live?'live-gateway':'local-cache'},warnings:[]});
  let prefs={checkReleases:false,theme:'dark',accent:'violet',density:'comfortable',fontSize:14,pins:[],recents:[],notes:{},seen:{},drafts:{}};
  (window as any).__avatarReads={};(window as any).__computerReads=0;
  (window as any).grokdeck={snapshot:async()=>snapshot(),preferences:async()=>prefs,savePreferences:async(p:any)=>(prefs={...prefs,...p}),info:async()=>({version:'0.1.0',platform:'darwin',arch:'arm64',supportedSourceVersion:'0.75.0'}),connectLive:async()=>{live=true;return snapshot();},disconnectLive:async()=>{live=false;return snapshot();},
    getAvatar:async(id:string)=>{(window as any).__avatarReads[id]=((window as any).__avatarReads[id]||0)+1;return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=';},
    computers:async()=>{(window as any).__computerReads++;return {apiVersion:1,checkedAt:Date.now(),complete:false,computers:[{agentId:'running',name:'Running bot',state:'running',windows:[{index:0,label:'Desktop'}],checkedAt:Date.now()},{agentId:'sleeping',name:'Sleeping bot',state:'hibernated',windows:[],checkedAt:Date.now()},{agentId:'unknown',name:'Unavailable bot',state:'unknown',windows:[],checkedAt:Date.now(),error:'unavailable'}]};},
    liveMessages:async()=>({messages:[],source:{...source,kind:'live-gateway'}}),openAgent:async()=>true,copy:async()=>true,exportConversation:async()=>false};
 });
 await page.goto('/');await page.getByRole('button',{name:'Connect live',exact:true}).click();
 await expect(page.getByRole('img',{name:'Running bot avatar'}).first()).toBeVisible();
 await expect(page.getByRole('img',{name:'Running bot avatar'}).first()).toHaveAttribute('src',/^data:image\/png;base64,/);
 await page.getByRole('button',{name:'Computers',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Computers.'})).toBeVisible();
 await expect(page.getByText(/Bots with running computers: 1 · Bots checked: 3 · Status unavailable: 1 · Partial result/)).toBeVisible();await expect(page.locator('.computer-row')).toHaveCount(1);await expect(page.locator('.computer-row')).toContainText('Running bot');
 await expect(page.getByRole('button',{name:/Start computer|Open screen/})).toHaveCount(0);
 await page.getByLabel('Active only').uncheck();await expect(page.locator('.computer-row')).toHaveCount(3);await expect(page.locator('.computer-row').last()).toContainText('Status unavailable');
 await page.getByRole('button',{name:'Refresh computers',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__computerReads)).toBe(2);
 await page.locator('.computer-row').first().getByRole('button',{name:'Open chat'}).click();await expect(page.getByLabel('Discussion with Running bot')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__avatarReads.running)).toBe(1);
});
