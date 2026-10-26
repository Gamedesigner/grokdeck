// Synthetic secrets only. Run by windows-storage-smoke.mjs in a fresh profile.
const {app,safeStorage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
app.setPath('userData',process.env.GROKDECK_STORAGE_FIXTURE);
app.whenReady().then(()=>{
  fs.writeFileSync(path.join(app.getPath('userData'),'fixture.bin'),safeStorage.encryptString('GrokDeck Windows synthetic fixture 🔒'));
  app.quit();
}).catch(()=>app.exit(1));
