// Exercise the real desktop TLS client inside Electron, whose verifier differs from Node.
const {app}=require('electron');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const https=require('node:https');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
app.whenReady().then(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'grokdeck-electron-tls-'));
 const servers=[];
 try {
  const {loadLocalIdentity,localFetch}=await import(pathToFileURL(path.resolve(__dirname,'../bridge/local-tls.mjs')).href);
  const identity=await loadLocalIdentity(root),credentialFile=path.join(root,'pairing-token-v2');
  const token='A'.repeat(43);await fs.writeFile(credentialFile,token,{mode:0o600});
  let validRequests=0,impostorRequests=0;
  const listen=async(identity,callback)=>{const s=https.createServer(identity,callback);servers.push(s);await new Promise(r=>s.listen(0,'127.0.0.1',r));return s.address().port;};
  const port=await listen(identity,(req,res)=>{assert.equal(req.headers.authorization,'Bearer '+token);validRequests++;res.setHeader('content-type','application/json');res.end(JSON.stringify({apiVersion:1,live:true,readOnly:false}));});
  const {createLiveClient}=require('../desktop/live.cjs');
  const clientFor=port=>createLiveClient({credentialFile,fetchImpl:(url,options)=>localFetch(url.replace(':43875',':'+port),options,root)});
  assert.deepEqual(await clientFor(port).health(),{live:true});assert.equal(validRequests,1);
  const other=await loadLocalIdentity(path.join(root,'impostor'));
  const badPort=await listen(other,(_req,res)=>{impostorRequests++;res.end('{}');});
  await assert.rejects(clientFor(badPort).health());assert.equal(impostorRequests,0);
  console.log(JSON.stringify({status:'passed',electron:process.versions.electron,secureBridge:true,impostorCredentialDisclosure:false}));
 } finally {for(const server of servers)await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
 app.exit(0);
}).catch(error=>{console.error(error.stack);app.exit(1);});
