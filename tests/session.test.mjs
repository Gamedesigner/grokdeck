import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {readSession,currentAccountScope} from '../bridge/session.mjs';
import {createConnectionResolver} from '../bridge/backend.mjs';

const now=1700000000000;
const sub='test-user-local-fixture';
const scope=createHash('sha256').update(sub).digest('hex');
const cipher=value=>Buffer.from(value).toString('base64');
const jwt=claims=>`fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const decrypt=async buffer=>buffer.toString();
async function fixture(t,{claims={sub,exp:now/1000+3600},active=scope,status={},disk={},values={}}={}) {
  const sourcePath=await fs.mkdtemp(path.join(os.tmpdir(),'grokdeck-session-'));
  t.after(()=>fs.rm(sourcePath,{recursive:true,force:true}));
  const statusValue={version:1,signedIn:true,appVersion:'0.75.0',...status};
  const diskValue={version:1,'cursor-machine-id':cipher('test-machine'),
    'cursor-accounts':JSON.stringify({active,accounts:{[active]:{'cursor-access-token':cipher(jwt(claims)),...values}}}),...disk};
  await fs.writeFile(path.join(sourcePath,'desktop-status.json'),JSON.stringify(statusValue));
  await fs.writeFile(path.join(sourcePath,'sand-secrets.json'),JSON.stringify(diskValue));
  return {sourcePath,decrypt,now:()=>now};
}

test('session selects only the active account and verifies its token principal',async t=>{
  const options=await fixture(t);
  const auth=await readSession(options);
  assert.equal(auth.accountScope,scope);
  assert.equal(auth.machineId,'test-machine');
  assert.equal(await currentAccountScope(options.sourcePath),scope);
  const mismatch=await fixture(t,{active:'b'.repeat(64)});
  await assert.rejects(readSession(mismatch),{code:'account-mismatch'});
});
test('signed-out, unknown app and container versions fail closed',async t=>{
  for(const options of [{status:{signedIn:false}},{status:{appVersion:'0.76.0'}},{status:{version:2}},{disk:{version:2}}]){
    const f=await fixture(t,options);
    await assert.rejects(readSession(f));
    assert.equal(await currentAccountScope(f.sourcePath),null);
  }
});
test('expiry and malformed JWT claims cannot establish a session',async t=>{
  for(const exp of [undefined,now/1000,now/1000+30,1e100,'9999999999',null]){
    const f=await fixture(t,{claims:{sub,exp}});
    await assert.rejects(readSession(f),{code:'session-expired'});
  }
  const f=await fixture(t,{values:{'cursor-access-token':cipher('not-a-jwt')}});
  await assert.rejects(readSession(f),{code:'keychain-unavailable'});
});
test('missing active account never falls back and rejected Keychain errors stay generic',async t=>{
  const f=await fixture(t,{disk:{'cursor-accounts':JSON.stringify({active:null,accounts:{[scope]:{'cursor-access-token':cipher('another-account')}}})}});
  await assert.rejects(readSession(f),{code:'session-unavailable'});
  const locked=await fixture(t);
  await assert.rejects(readSession({...locked,decrypt:async()=>{throw new Error('/private/secret-token');}}),error=>error.code==='keychain-unavailable'&&!error.message.includes('/private'));
});
test('session files reject symlinks and oversized data',async t=>{
  const f=await fixture(t),file=path.join(f.sourcePath,'sand-secrets.json');
  if(process.platform!=='win32'){
    await fs.rename(file,`${file}.original`);await fs.symlink(`${file}.original`,file);
    await assert.rejects(readSession(f),{code:'session-unavailable'});
    assert.equal(await currentAccountScope(f.sourcePath),null);
    await fs.unlink(file);
  }
  await fs.writeFile(file,' '.repeat(131073));
  await assert.rejects(readSession(f),{code:'session-unavailable'});
});
test('selected team must decrypt to a bounded numeric identifier',async t=>{
  const f=await fixture(t,{values:{'cursor-selected-team-id':cipher('123')}});
  assert.equal((await readSession(f)).teamId,'123');
  for(const team of ['not-a-team','1'.repeat(33)])await assert.rejects(readSession(await fixture(t,{values:{'cursor-selected-team-id':cipher(team)}})),{code:'invalid-team'});
});

const auth={appVersion:'0.75.0',token:'local-fixture-token',accountScope:scope,machineId:'fixture-machine',teamId:'123'};
const discovery={gatewayUrl:'https://fixture.us8.cursorvm.com',gatewayToken:'fixture-gateway-token',gatewayPortToken:'fixture-port-token'};
function resolver(fetchImpl,extra={}){
  return createConnectionResolver({session:async()=>auth,currentAccountScope:async()=>scope,fetchImpl,...extra});
}
test('backend discovery uses fixed JSON RPC and scopes cached routes to account and team',async()=>{
  let calls=0,team='123';
  const resolve=resolver(async(url,options)=>{
    calls++;
    assert.equal(url,'https://api2.cursor.sh/aiserver.v1.GrokBotService/EnsureSandBox');
    assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
    assert.equal(options.headers.authorization,`Bearer ${auth.token}`);
    assert.equal(options.headers['x-cursor-team-id'],team);
    assert.deepEqual(JSON.parse(options.body),{wake:true});
    return Response.json(discovery);
  },{session:async()=>({...auth,teamId:team})});
  const first=await resolve();assert.equal(first.accountScope,scope);
  assert.deepEqual(first.headers,{'x-anyrun-port-token':'fixture-port-token'});
  await resolve();assert.equal(calls,1);
  team='456';await resolve();assert.equal(calls,2);
});
test('account changes prevent cached route reuse and discard discovery result',async()=>{
  let current=scope,calls=0;
  const resolve=resolver(async()=>{calls++;return Response.json(discovery);},{currentAccountScope:async()=>current});
  await resolve();current='b'.repeat(64);
  await assert.rejects(resolve(),{code:'account-changed'});assert.equal(calls,1);
  current=scope;
  const during=resolver(async()=>{current='b'.repeat(64);return Response.json(discovery);},{currentAccountScope:async()=>current});
  await assert.rejects(during(),{code:'account-changed'});
});
test('team switching while discovery is in flight discards the old team route',async()=>{
  let team='123';
  const resolve=resolver(async()=>{team='456';return Response.json(discovery);},{session:async()=>({...auth,teamId:team})});
  await assert.rejects(resolve(),{code:'account-changed'});
  // An old route was not cached after the rejected discovery.
  const next=await resolve();assert.equal(next.baseUrl,discovery.gatewayUrl);
});
test('discovery never follows or accepts redirects, and does not leak server error bodies',async()=>{
  for(const make of [()=>new Response('secret',{status:302,headers:{location:'https://evil.test'}}),()=>new Response('secret',{status:401}),()=>new Response('secret',{status:500})]){
    await assert.rejects(resolver(async(_,options)=>{assert.equal(options.redirect,'error');return make();})(),error=>!error.message.includes('secret')&&!error.message.includes('evil.test'));
  }
  const response=Response.json(discovery);Object.defineProperty(response,'redirected',{value:true});
  await assert.rejects(resolver(async()=>response)(),{code:'gateway-discovery-failed'});
});
test('discovery enforces response size, JSON shape and gateway credential destination',async()=>{
  const responses=[
    ()=>new Response('{}',{headers:{'content-length':'65537'}}),
    ()=>new Response(' '.repeat(65537)),()=>new Response('bad-json'),()=>Response.json(null),
    ()=>Response.json({...discovery,gatewayUrl:'https://evil.test'}),
    ()=>Response.json({...discovery,gatewayUrl:'https://fixture.us8.cursorvm.com/path'}),
    ()=>Response.json({...discovery,gatewayToken:'bad\r\nheader'}),
  ];
  for(const response of responses)await assert.rejects(resolver(async()=>response)());
  // The observed client omits an empty gateway bearer token when a port token is supplied.
  const portOnly=await resolver(async()=>Response.json({...discovery,gatewayToken:''}))();
  assert.equal(portOnly.token,undefined);
  assert.equal(portOnly.headers['x-anyrun-port-token'],'fixture-port-token');
});

test('reviewed 0.75.8 preserves session isolation and reports its detected version',async t=>{
  const f=await fixture(t,{status:{appVersion:'0.75.8'}});
  assert.equal((await readSession(f)).appVersion,'0.75.8');
  assert.equal(await currentAccountScope(f.sourcePath),scope);
});
test('version changes invalidate discovery cache and use the detected protocol version',async()=>{
  let version='0.75.0',calls=0;
  const resolve=resolver(async(_,options)=>{
    calls++;assert.equal(options.headers['x-cursor-client-version'],version);return Response.json(discovery);
  },{session:async()=>({...auth,appVersion:version})});
  await resolve();version='0.75.8';await resolve();assert.equal(calls,2);
  version='0.75.9';await assert.rejects(resolve(),{code:'unsupported-or-signed-out'});assert.equal(calls,2);
});
