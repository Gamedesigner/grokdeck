import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCompatibility,TARGETS} from '../scripts/check-compatibility.mjs';
test('a newer Windows rollout is actionable even when both Mac feeds are reviewed',async()=>{
  const calls=[];
  const report=await checkCompatibility({checker:async options=>{calls.push(options);return {status:'available',version:options.platform==='win32'?'0.76.0':'0.75.8'};}});
  assert.equal(calls.length,TARGETS.length);assert.ok(calls.every(x=>x.currentVersion===null));
  assert.equal(report.action,'review-required');assert.deepEqual(report.unreviewedVersions,['0.76.0']);
});
test('missing or malformed feed results are unavailable, never compatibility success',async()=>{
  for(const result of [{status:'current',version:null},{status:'available',version:'main;run-command'},{status:'unavailable',version:'0.75.8'}]){
    const report=await checkCompatibility({checker:async()=>result});
    assert.equal(report.action,'retry-check');assert.equal(report.complete,false);
    assert.equal(JSON.stringify(report).includes('run-command'),false);
  }
});
test('new versions are deduplicated without modifying the reviewed list or executing fixes',async()=>{
  const reviewed=['0.75.8'];
  const report=await checkCompatibility({reviewed,checker:async()=>({status:'available',version:'0.76.0'})});
  assert.deepEqual(report.unreviewedVersions,['0.76.0']);assert.deepEqual(reviewed,['0.75.8']);
  assert.equal((await checkCompatibility({reviewed,checker:async()=>({status:'available',version:'0.75.8'})})).action,'none');
});
