import {test,expect} from '@playwright/test';
test('empty workspace is honest and demo is explicitly labeled',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:/Bring your conversations/})).toBeVisible();
 await page.getByRole('button',{name:/Explore an example workspace/}).click();await expect(page.getByText('EXAMPLE DATA',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/Research desk/}).first()).toBeVisible();
 await page.getByRole('button',{name:/Return to real workspace/}).click();await expect(page.getByRole('heading',{name:/Bring your conversations/})).toBeVisible();
});
test('search, discussion history, private notes, drafts and appearance persist',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/Explore an example workspace/}).click();
 await page.getByLabel('Search agents and discussions').fill('A little context');await expect(page.locator('.agent-row')).toHaveCount(6);
 await page.getByLabel('Search agents and discussions').fill('Research desk');await expect(page.locator('.agent-row')).toHaveCount(1);
 await page.locator('.agent-main').first().click();await expect(page.getByLabel('Discussion with Research desk')).toBeVisible();await expect(page.getByRole('heading',{name:'A little context goes a long way'})).toBeVisible();
 await page.getByLabel('Toggle private notes').click();await page.getByLabel('YOUR PRIVATE NOTES').fill('Remember the important idea');await page.getByLabel('Draft follow-up').fill('Explore a new direction');
 await page.getByLabel('Open settings').click();await page.getByRole('button',{name:'Light',exact:true}).click();await page.getByLabel('mint accent').click();await page.getByLabel('Density',{exact:true}).selectOption('compact');await page.getByLabel('Text size').selectOption('16');await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByLabel('Close settings').click();
 await page.reload();await page.getByRole('button',{name:/Explore an example workspace/}).click();await page.locator('.agent-main').first().click();await expect(page.getByLabel('Draft follow-up')).toHaveValue('Explore a new direction');await page.getByLabel('Toggle private notes').click();await expect(page.getByLabel('YOUR PRIVATE NOTES')).toHaveValue('Remember the important idea');await expect(page.locator('html')).toHaveAttribute('data-density','compact');
});
test('command search works from the keyboard and returns to discussion',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/Explore an example workspace/}).click();await page.keyboard.press('Control+k');await page.getByRole('textbox',{name:'Find anything',exact:true}).fill('Studio');await page.keyboard.press('Enter');await expect(page.getByLabel('Discussion with Studio assistant')).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('100-agent cache fixture stays searchable and untrusted HTML does not execute',async({page})=>{
 await page.addInitScript(()=>{
 const agents=Array.from({length:120},(_,i)=>({id:`agent-${i}`,name:`Agent ${i}`,description:'Test fixture',color:'#aabbcc',section:'Tests',sectionId:'tests',pinned:false,hasUnread:i<4,unreadCount:1,awaitingResponse:false,lastActivityAt:Date.now()-i*1000,preview:'Latest result',cachedAt:Date.now(),messages:[{id:`m-${i}`,role:'assistant',content:i===119?'needle deep in history <script>window.injected=true</script>':'Hello',timestamp:Date.now(),type:'text',streaming:false}]}));
 const prefs={theme:'dark',accent:'violet',density:'comfortable',fontSize:14,pins:[],recents:[],notes:{},seen:{},drafts:{}};
 (window as any).grokdeck={snapshot:async()=>({agents,sections:[{id:'tests',name:'Tests',agentIds:agents.map(a=>a.id)}],source:{kind:'local-cache',path:'/fixture',available:true,version:'0.75.0',cacheUpdatedAt:Date.now(),checkedAt:Date.now(),warning:null},warnings:[]}),preferences:async()=>prefs,savePreferences:async(p:any)=>Object.assign(prefs,p),info:async()=>({version:'0.1.0',platform:'test',arch:'x64',supportedSourceVersion:'0.75.0'}),copy:async()=>true};
 });
 await page.goto('/');await expect(page.locator('.agent-row')).toHaveCount(120);await page.getByLabel('Search agents and discussions').fill('needle deep');await expect(page.locator('.agent-row')).toHaveCount(1);await page.locator('.agent-main').click();await expect(page.getByLabel('Discussion with Agent 119')).toBeVisible();expect(await page.evaluate(()=>(window as any).injected)).toBeUndefined();
 await page.setViewportSize({width:900,height:650});await expect(page.getByLabel('Discussion with Agent 119')).toBeVisible();await expect(page.getByLabel('Draft follow-up')).toBeVisible();
});
