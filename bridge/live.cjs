// Host-only experimental gateway runner. No vendor code is imported or executed.
const {app,safeStorage}=require('electron');
const os=require('node:os');const path=require('node:path');
app.setName('Grok Bot');
app.setPath('userData',path.join(os.homedir(),'.grokdeck-bridge','live-helper'));
app.whenReady().then(async()=>{
 app.dock?.hide();
 const {readSession,currentAccountScope,sourceVersion}=await import('./session.mjs');
 const {createConnectionResolver}=await import('./backend.mjs');
 const {createGateway}=await import('./gateway.mjs');
 const {startBridge}=await import('./server.mjs');
 const {defaultSource}=await import('../desktop/cache.mjs');
 const decrypt=process.platform==='win32'
   ? (await import('./windows-storage.mjs')).createWindowsDecryptor({sourcePath:defaultSource()})
   : async b=>(await safeStorage.decryptStringAsync(b)).result;
 const session=()=>readSession({decrypt});
 const {accountScope:initialScope,teamId:initialTeam}=await session();
 const guardedScope=async()=>{const scope=await currentAccountScope();if(scope!==initialScope)throw new Error('account-changed');return scope;};
 const guardedSession=async()=>{const value=await session();if(value.accountScope!==initialScope||value.teamId!==initialTeam)throw new Error('account-changed');return value;};
 const resolveConnection=createConnectionResolver({session:guardedSession,currentAccountScope:guardedScope});
 const gateway=createGateway({resolveConnection,getAccountScope:guardedScope});
 gateway.runtimeSettings=(await import('./organization.mjs')).createRuntimeSettings({session:guardedSession});
 gateway.sourceVersion=()=>sourceVersion();
 await resolveConnection();
 await gateway.roster();
 const {server,port}=await startBridge({gateway,port:Number(process.env.GROKDECK_BRIDGE_PORT||43875)});
 console.log(`Experimental live GrokDeck bridge ready on loopback port ${port}. Host credentials remain in memory.`);
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>app.quit()));
 app.on('before-quit',()=>server.close());
}).catch(error=>{
 console.error(`Live bridge could not start (${error.code||'unavailable'}). Check the signed-in Grok Bot app and OS secure-storage access.`);
 app.exit(1);
});
