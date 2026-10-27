import {test,expect} from '@playwright/test';
test('update availability is visible and unsupported installations offer manual downloads',async({page})=>{
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
  await page.getByRole('button',{name:'Open downloads'}).click();
  expect(await page.evaluate(()=>(window as any).__downloadsOpened)).toBe(1);
});

test('Windows preview offers a separate verified download and installer action',async({page})=>{
  await page.addInitScript(()=>{
    const prefs={checkReleases:true,theme:'dark',accent:'violet',density:'comfortable',fontSize:14,pins:[],recents:[],notes:{},seen:{},drafts:{}};
    const offer={status:'available',currentVersion:'0.3.0-rc.5',version:'0.3.0-rc.6',checkedAt:Date.now(),canInstall:true,installKind:'windows-installer',message:'A new Windows preview is available.'};
    (window as any).__updateCalls={download:0,install:0};
    (window as any).grokdeck={
      preferences:async()=>prefs,savePreferences:async()=>prefs,
      snapshot:async()=>({agents:[],sections:[],warnings:[],source:{kind:'local-cache',path:'',available:false,version:'0.77.0',checkedAt:0,cacheUpdatedAt:0,warning:null}}),
      info:async()=>({version:offer.currentVersion,platform:'win32',arch:'x64',supportedSourceVersion:'0.77.0'}),
      checkAppUpdates:async()=>offer,
      downloadUpdate:async()=>{(window as any).__updateCalls.download++;return {...offer,status:'downloaded',message:'Installer downloaded and checked against GitHub.'};},
      installUpdate:async()=>{(window as any).__updateCalls.install++;return {...offer,status:'installing',message:'Opening the Windows installer.'};},
    };
  });
  await page.goto('/');await page.getByRole('button',{name:'Review update'}).click();
  await expect(page.getByText(/Windows previews are unsigned/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Install update',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Download GrokDeck 0.3.0-rc.6',exact:true}).click();
  await expect(page.getByRole('button',{name:'Install update',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).__updateCalls)).toEqual({download:1,install:0});
  await page.getByRole('button',{name:'Install update',exact:true}).click();
  await expect(page.getByText('Opening the Windows installer.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__updateCalls)).toEqual({download:1,install:1});
});
