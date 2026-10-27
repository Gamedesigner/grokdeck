import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  const agents=['alpha','beta','gamma'].map((id,i)=>({id,name:['Alpha','Beta','Gamma'][i],description:'Fixture',color:'#aabbcc',section:'Work',sectionId:'work',pinned:i===0,hasUnread:i===1,unreadCount:0,awaitingResponse:false,lastActivityAt:10-i,cachedAt:0,preview:'Example',messages:[]}));
  const sections=[{id:'work',name:'Work',agentIds:['alpha','beta','gamma']}],source={kind:'live-gateway',available:true,checkedAt:1,cacheUpdatedAt:1,version:'0.75.8',path:'',warning:null};
  let organization={sections,pins:['alpha']};let prefs:any={checkReleases:false},profile={name:'Alpha',title:'Helper',description:'Fixture'};
  (window as any).__writes=[];(window as any).__closed=[];
  const snap=()=>({agents,sections,source,warnings:[]});
  const bytes=(a:number[]|string)=>btoa(typeof a==='string'?a:String.fromCharCode(...a));
  (window as any).grokdeck={organization:async()=>({organization}),updateOrganization:async(o:any)=>{organization=o;return {organization};},snapshot:async()=>snap(),connectLive:async()=>snap(),preferences:async()=>prefs,savePreferences:async(p:any)=>(prefs={...prefs,...p}),info:async()=>({version:'test',platform:'win32',arch:'x64'}),liveMessages:async()=>({messages:[],source}),openAgent:async()=>true,
   agentProfile:async()=>({profile}),updateAgentProfile:async(id:string,p:any)=>{(window as any).__writes.push({id,p});profile=p;return {profile};},setAgentAvatar:async()=>{throw Error('not requested');},
   openViewer:async()=>({id:'v'.repeat(32)}),closeViewer:async(id:string)=>{(window as any).__closed.push(id);},
   exchangeViewer:async(_:string,sequence:number,data:string)=>({sequence,closed:false,data:sequence===0?bytes('RFB 003.008\n'):sequence===1?bytes([1,1]):sequence===2?bytes([0,0,0,0]):sequence===3?bytes([0,2,0,2,32,24,0,1,0,255,0,255,0,255,16,8,0,0,0,0,0,0,0,4,84,101,115,116]):''})};
 });
 await page.goto('/');await expect(page.getByText('Live gateway',{exact:true})).toBeVisible();
});
test('group moves, pinning, deletion and sorting preserve every agent',async({page})=>{
 await expect(page.getByRole('region',{name:'Pinned group'})).toContainText('Alpha');
 await page.getByRole('button',{name:'New group',exact:true}).click();await page.getByLabel('Group name').fill('Play');await page.getByRole('button',{name:'Save group'}).click();
 await page.getByRole('region',{name:'Work group'}).getByText('Beta',{exact:true}).click({button:'right'});
 await page.getByLabel('Move to group').selectOption({label:'Play'});await expect(page.getByRole('region',{name:'Play group'})).toContainText('Beta');
 await page.getByRole('button',{name:'Delete Play',exact:true}).click();await page.getByRole('button',{name:'Delete group only'}).click();await expect(page.getByRole('region',{name:'Ungrouped group'})).toContainText('Beta');
 const work=page.getByRole('region',{name:'Work group'});const gamma=work.locator('.agent-row').filter({hasText:'Gamma'});
 await gamma.dragTo(page.getByRole('region',{name:'Ungrouped group'}));await expect(page.getByRole('region',{name:'Ungrouped group'})).toContainText('Gamma');
 await page.getByRole('button',{name:/^All agents/}).click();await page.getByLabel('Sort agents').selectOption('name');await expect(page.locator('.agent-main strong')).toHaveText(['Alpha','Beta','Gamma']);
 await page.getByLabel('Filter agents').selectOption('unread');await expect(page.locator('.agent-main strong')).toHaveText(['Beta']);
});
test('profile save is explicit and computer viewer connects with control on and closes its session',async({page})=>{
 await page.getByRole('region',{name:'Pinned group'}).getByText('Alpha',{exact:true}).click();
 await page.getByRole('button',{name:'Edit agent',exact:true}).click();await page.getByLabel('Agent name').fill('Alpha renamed');expect(await page.evaluate(()=>(window as any).__writes)).toHaveLength(0);
 await page.getByRole('button',{name:'Save changes'}).click();await expect(page.getByRole('dialog',{name:'Edit agent'})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__writes)).toHaveLength(1);
 await page.getByRole('button',{name:'Open agent computer'}).click();const viewer=page.getByRole('dialog',{name:'Computer for Alpha'});await expect(viewer.getByRole('status')).toHaveText('Connected');await expect(viewer.getByLabel('Control')).toBeChecked();await expect(viewer.locator('canvas')).toBeVisible();await viewer.getByLabel('Control').uncheck();await viewer.getByRole('button',{name:'Close computer'}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__closed.length)).toBeGreaterThan(0);
});
