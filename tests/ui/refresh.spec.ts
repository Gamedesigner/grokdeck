import {test,expect} from '@playwright/test';

async function setup(page: import('@playwright/test').Page) {
  await page.clock.install();
  await page.addInitScript(() => {
    const source = {kind:'local-cache',available:true,version:'0.75.8',checkedAt:1,cacheUpdatedAt:1,path:'',warning:null};
    const agent = {id:'fixture',name:'Before refresh',description:'Fixture',color:'#aabbcc',section:'Work',sectionId:'work',pinned:false,hasUnread:false,unreadCount:0,awaitingResponse:false,lastActivityAt:1,cachedAt:1,preview:'Saved content',messages:[]};
    const state = (window as any).__refresh = {snapshotCalls:0,connectCalls:0,sends:0,stale:false,fail:false};
    const snapshot = (live = false) => ({agents:[{...agent,name:state.connectCalls > 1 ? 'After refresh' : agent.name}],sections:[{id:'work',name:'Work',agentIds:['fixture']}],source:{...source,kind:live ? 'live-gateway':'local-cache'},warnings:[]});
    (window as any).grokdeck = {
      snapshot:async()=>{state.snapshotCalls++;if(state.stale)throw Error('fixture helper exited');return snapshot();},
      preferences:async()=>({checkReleases:false}),
      info:async()=>({version:'fixture',platform:'win32',arch:'x64',supportedSourceVersion:'0.75.8'}),
      connectLive:async()=>{state.connectCalls++;if(state.fail)throw Error('fixture reconnect failed');state.stale=false;return snapshot(true);},
      send:async()=>{state.sends++;},
    };
  });
  await page.goto('/');
  await expect(page.getByText('Live gateway',{exact:true})).toBeVisible();
  await expect(page.locator('.agent-main').first()).toContainText('Before refresh');
}

test('manual refresh recovers a stopped helper instead of directly reading its stale snapshot',async({page})=>{
  await setup(page);
  const before = await page.evaluate(()=>(window as any).__refresh.snapshotCalls);
  await page.evaluate(()=>{(window as any).__refresh.stale=true;});
  await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
  await expect(page.locator('.agent-main').first()).toContainText('After refresh');
  await expect(page.getByText(/Could not complete that action/)).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__refresh.snapshotCalls)).toBe(before);
  expect(await page.evaluate(()=>(window as any).__refresh.connectCalls)).toBe(2);
  expect(await page.evaluate(()=>(window as any).__refresh.sends)).toBe(0);
});

test('failed manual reconnect keeps loaded agents and gives connection guidance',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{(window as any).__refresh.fail=true;});
  await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
  await expect(page.getByText(/Could not refresh the connection/)).toBeVisible();
  await expect(page.locator('.agent-main').first()).toContainText('Before refresh');
  await expect(page.getByText(/Check the source folder/)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Refresh workspace',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).__refresh.sends)).toBe(0);
});
