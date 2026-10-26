// Host-only mapping of gateway-local VNC addresses to authenticated public routes.
const fail=()=>{throw Object.assign(new Error('Computer viewer unavailable.'),{code:'viewer_unavailable'});};
function remote(value){let u;try{u=new URL(value);}catch{fail();}if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443')||!/(?:^|\.)cursorvm\.com$/i.test(u.hostname))fail();return u;}
export function viewerTarget(raw, route){
  let page;try{page=new URL(raw);}catch{fail();}
  if(['127.0.0.1','localhost','[::1]'].includes(page.hostname)){
    if(page.pathname!=='/vnc.html'||!route)fail();
    if(page.port==='6080')page=remote(route.primaryUrl);
    else if(page.port==='6081'){
      const localPath=page.searchParams.get('path')||'';
      const token=new URLSearchParams(localPath.split('?')[1]||'').get('token');
      page=new URL('vnc.html',remote(route.forkBaseUrl).href.replace(/\/?$/,'/'));
      const path=new URL('websockify',page);
      if(token)path.searchParams.set('token',token);
      const name=route.forkPortToken?'port_token':'network_token',credential=route.forkPortToken||route.networkToken;
      if(typeof credential!=='string'||!credential||credential.length>16384||/[\r\n]/.test(credential))fail();
      path.searchParams.set(name,credential);page.searchParams.set(name,credential);
      page.searchParams.set('path',path.pathname.slice(1)+path.search);
    }else fail();
  }
  page=remote(page.href);
  const ws=new URL(page.searchParams.get('path')||'websockify',page);
  if(ws.origin!==page.origin||!ws.pathname.endsWith('/websockify')||ws.username||ws.password||ws.hash)fail();
  const headers={};
  for(const [name,header] of [['port_token','x-anyrun-port-token'],['network_token','x-anyrun-network-token']]){
    const value=page.searchParams.get(name)||ws.searchParams.get(name);
    if(value){if(value.length>16384||/[\r\n]/.test(value))fail();headers[header]=value;}
  }
  if(!Object.keys(headers).length)fail();
  ws.protocol='wss:';return {url:ws.href,headers};
}
