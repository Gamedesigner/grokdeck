import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {checkRelease,compareVersions} from '../desktop/releases.mjs';
import {REVIEWED_VERSIONS} from '../desktop/compatibility.mjs';
export const TARGETS=Object.freeze([
  {platform:'darwin',arch:'arm64'},
  {platform:'darwin',arch:'x64'},
  {platform:'win32',arch:'x64'},
]);
export async function checkCompatibility({checker=checkRelease,reviewed=REVIEWED_VERSIONS,now=Date.now}={}) {
  const observations=await Promise.all(TARGETS.map(async target=>{
    try {
      const offered=await checker({...target,currentVersion:null});
      if(offered.status==='unavailable'||typeof offered.version!=='string'||!/^\d+\.\d+\.\d+$/.test(offered.version))
        return {...target,status:'unavailable',offeredVersion:null};
      return {...target,status:reviewed.includes(offered.version)?'reviewed':'needs_review',offeredVersion:offered.version};
    } catch{return {...target,status:'unavailable',offeredVersion:null};}
  }));
  const unreviewed=[...new Set(observations.filter(x=>x.status==='needs_review').map(x=>x.offeredVersion))].sort(compareVersions);
  return {schemaVersion:1,checkedAt:new Date(now()).toISOString(),reviewedVersions:[...reviewed],observations,
    unreviewedVersions:unreviewed,complete:observations.every(x=>x.status!=='unavailable'),
    action:unreviewed.length?'review-required':observations.some(x=>x.status==='unavailable')?'retry-check':'none'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const report=await checkCompatibility();console.log(JSON.stringify(report,null,2));
  // Unavailable is distinguishable from success; a new version is normal actionable output.
  if(!report.complete)process.exitCode=2;
}
