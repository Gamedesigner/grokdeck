import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
// Renderer-only CDP; production main-process inspection remains fused off.
export async function launchHardened(executablePath, profile) {
  const child=spawn(executablePath,[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env:{...process.env,GROKDECK_DEV_URL:'',GROKDECK_SCREENSHOT:''},stdio:['ignore','ignore','pipe']});
  try {
    const endpoint=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error('Packaged browser did not start: '+output.slice(-2000))),45000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`Packaged app exited: ${code} ${signal}: ${output.slice(-2000)}`));});
      child.stderr.on('data',data=>{output+=data;const match=output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    });
    const browser=await chromium.connectOverCDP(endpoint);
    const context=browser.contexts()[0];
    const page=context.pages()[0]||await context.waitForEvent('page');
    await page.waitForSelector('h1',{timeout:30000});
    return {page,firstWindow:async()=>page,waitForEvent:async(event)=>{if(event!=='close')throw new Error('Unsupported event');if(child.exitCode===null)await once(child,'exit');},close:async()=>{await browser.close();if(child.exitCode===null){child.kill();await once(child,'exit');}}};
  } catch(error){child.kill();throw error;}
}
