import {test,expect} from '@playwright/test';
test('live connection starts automatically and recovers without sending a message',async({page})=>{
 await page.clock.install();
 await page.addInitScript(()=>{
  let attempts=0;
  const source={kind:'local-cache',available:false,version:'0.75.8',checkedAt:0,cacheUpdatedAt:0,warning:null};
  const snapshot={agents:[],sections:[],source,warnings:[]};
  (window as any).__sends=0;
  (window as any).grokdeck={snapshot:async()=>snapshot,preferences:async()=>({checkReleases:false}),info:async()=>({version:'0.2.5',platform:'darwin',arch:'arm64',supportedSourceVersion:'0.75.0'}),
   connectLive:async()=>{if(++attempts===1)throw Error('offline');return {...snapshot,source:{...source,kind:'live-gateway',available:true}};},send:async()=>{(window as any).__sends++;}};
 });
 await page.goto('/');
 await expect(page.getByText(/Live connection unavailable. Showing saved data/)).toBeVisible();
 await page.clock.fastForward(15000);
 await expect(page.getByText('Live gateway',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Connect live',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__sends)).toBe(0);
});
