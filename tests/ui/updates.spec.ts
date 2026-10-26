import {test,expect} from '@playwright/test';
test('update availability is visible and unsigned previews offer manual downloads',async({page})=>{
  await page.addInitScript(()=>{
    const prefs={checkReleases:true,theme:'dark',accent:'violet',density:'comfortable',fontSize:14,pins:[],recents:[],notes:{},seen:{},drafts:{}};
    (window as any).__downloadsOpened=0;
    (window as any).grokdeck={
      preferences:async()=>prefs,savePreferences:async()=>prefs,
      snapshot:async()=>({agents:[],sections:[],warnings:[],source:{kind:'local-cache',path:'',available:false,version:'0.75.8',checkedAt:0,cacheUpdatedAt:0,warning:null}}),
      info:async()=>({version:'0.2.0',platform:'win32',arch:'x64',supportedSourceVersion:'0.75.0'}),
      checkAppUpdates:async()=>({status:'available',currentVersion:'0.2.0',version:'0.3.0',checkedAt:Date.now(),canInstall:false,message:'GrokDeck 0.3.0 requires manual installation.'}),
      openDownloads:async()=>{(window as any).__downloadsOpened++;}
    };
  });
  await page.goto('/');await page.getByRole('button',{name:'Review update'}).click();
  await expect(page.getByRole('heading',{name:'GrokDeck updates'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Restart and install|Download GrokDeck/})).toHaveCount(0);
  await page.getByRole('button',{name:'Open private downloads'}).click();
  expect(await page.evaluate(()=>(window as any).__downloadsOpened)).toBe(1);
});
