import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    const agents=['alpha','beta','gamma'].map((id,index)=>({id,name:['Alpha','Beta','Gamma'][index],description:'Fixture',color:'#aabbcc',section:'System',sectionId:'system',pinned:index===0,hasUnread:false,unreadCount:0,awaitingResponse:false,lastActivityAt:10-index,cachedAt:0,preview:'Example',messages:[]}));
    let organization={sections:[{id:'system',name:'System',agentIds:['alpha','beta','gamma']}],pins:['alpha']};
    const source={kind:'live-gateway',available:true,checkedAt:1,cacheUpdatedAt:1,version:'0.75.8',path:'',warning:null};
    const snapshot=()=>({agents,sections:organization.sections,source,warnings:[]});
    const scope=window as any;
    scope.__organizationWrites=[];scope.__failRename=false;
    scope.grokdeck={
      snapshot:async()=>snapshot(),connectLive:async()=>snapshot(),
      preferences:async()=>({checkReleases:false,recents:['alpha']}),
      savePreferences:async(preferences:any)=>preferences,
      info:async()=>({version:'test',platform:'win32',arch:'x64'}),
      organization:async()=>({organization}),
      updateOrganization:async(next:any,previous:any)=>{
        if(scope.__failRename)throw new Error('Fixture unavailable');
        scope.__organizationWrites.push({next,previous});organization=next;return {organization};
      },
    };
  });
});

test('section counts and all three rename entry points keep Grok Bot organization intact',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Rename System',exact:true})).toBeEnabled();
  await expect(page.getByRole('heading',{name:'System (2 bots)',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Pinned (1 bot)',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Ungrouped (0 bots)',exact:true})).toBeVisible();

  await page.getByRole('button',{name:'Rename System',exact:true}).click();
  await expect(page.getByLabel('Section name',{exact:true})).toBeFocused();
  await page.getByLabel('Section name',{exact:true}).fill('Operations');
  await page.getByRole('button',{name:'Save name',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Operations (2 bots)',exact:true})).toBeVisible();

  const sidebar=page.getByRole('navigation',{name:'Agent sections'});
  await sidebar.getByRole('button',{name:/^Operations/}).click();
  await page.getByRole('button',{name:'Rename Operations',exact:true}).click();
  await page.getByLabel('Section name',{exact:true}).fill('Studio');
  await page.getByRole('button',{name:'Save name',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Studio.',exact:true})).toBeVisible();

  await sidebar.getByRole('button',{name:/^Studio/}).dblclick();
  await page.getByLabel('Section name',{exact:true}).fill('System');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'System.',exact:true})).toBeVisible();
  const writes=await page.evaluate(()=>(window as any).__organizationWrites);
  expect(writes.map((write:any)=>write.previous.sections[0].name)).toEqual(['System','Operations','Studio']);
  expect(writes.map((write:any)=>write.next.sections[0].name)).toEqual(['Operations','Studio','System']);
  for(const write of writes){expect(write.next.sections[0].agentIds).toEqual(['alpha','beta','gamma']);expect(write.next.pins).toEqual(['alpha']);}
});

test('rename cancellation, focus trapping and failure leave confirmed section names unchanged',async({page})=>{
  await page.goto('/');
  const pencil=page.getByRole('button',{name:'Rename System',exact:true});
  await pencil.click();
  const dialog=page.getByRole('dialog',{name:'Rename section'}),input=dialog.getByLabel('Section name');
  await input.fill('   ');await expect(dialog.getByRole('button',{name:'Save name'})).toBeDisabled();
  await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Cancel'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(input).toBeFocused();
  await page.keyboard.press('Control+k');await expect(page.getByRole('textbox',{name:'Find anything',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(pencil).toBeFocused();
  expect(await page.evaluate(()=>(window as any).__organizationWrites)).toHaveLength(0);
  await pencil.click();await page.locator('.editor-backdrop').click({position:{x:8,y:8}});
  await expect(dialog).toHaveCount(0);await expect(pencil).toBeFocused();
  await pencil.click();await input.fill('Never confirmed');await page.evaluate(()=>(window as any).__failRename=true);
  await dialog.getByRole('button',{name:'Save name'}).click();
  await expect(dialog.getByRole('alert')).toContainText('could not be fully confirmed');
  await expect(page.getByRole('heading',{name:'System (2 bots)',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Cancel'}).click();
});

test('cached sections cannot rename and sidebar headings follow the theme accent',async({page})=>{
  await page.addInitScript(()=>{
    const scope=window as any,original=scope.grokdeck.snapshot;
    scope.grokdeck.snapshot=async()=>{const snapshot=await original();snapshot.source.kind='local-cache';return snapshot;};
    delete scope.grokdeck.connectLive;
  });
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Rename System',exact:true})).toBeDisabled();
  await page.getByRole('navigation',{name:'Agent sections'}).getByRole('button',{name:/^System/}).dblclick();
  await expect(page.getByRole('dialog',{name:'Rename section'})).toHaveCount(0);
  await expect(page.getByText('Connect live to rename sections in Grok Bot.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__organizationWrites)).toHaveLength(0);
  for(const theme of ['dark','light']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const colors=await page.locator('.nav-label').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).color));
    expect(colors).toHaveLength(3);expect(new Set(colors).size).toBe(1);
    expect(colors[0]).toBe(theme==='dark'?'rgb(180, 162, 255)':'rgb(119, 85, 209)');
  }
});
