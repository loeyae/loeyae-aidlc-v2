/** Restore only the exact Native-authored locked page plan after a cosmetic heading drift. */
import assert from 'node:assert/strict';import { readFileSync, writeFileSync } from 'node:fs';import { join } from 'node:path';import { spawnSync } from 'node:child_process';
import { evaluation, repository, put, hash } from './prepare-pilots';
import { loadWorkflowState } from '../../../../core/tools/aidlc-light-state';import { bindSession, releaseSession, claimToken } from '../../../../core/tools/aidlc-session';
import { modelProjection } from '../../../../harness/codex/runtime/aidlc-codex-host.mjs';
const dir=join(evaluation,'publish-r2'),root=JSON.parse(readFileSync(join(dir,'preparation.json'),'utf8')).root;
const comparison=JSON.parse(readFileSync(join(dir,'ui-lock-drift-1794195526714.json'),'utf8')),change=comparison.changes[0];assert.equal(comparison.changes.length,1);
assert.equal(change.path,'docs/aidlc/modules/project/inception/ui-design/page-plan.md');assert.equal(hash(change.locked_content),change.locked_sha256);
assert.equal(change.current_content,change.locked_content.replace('No missing product fact','## Scope and review boundaries\nNo missing product fact'));
assert.equal(hash(readFileSync(join(root,change.path))),change.current_sha256);assert.equal(Object.keys(loadWorkflowState(root)!.active_instances).length,0);
const instance='ui-page-planning@module:project',binding=bindSession(root,{instance,owner:'agent',session:'01a1be40-8e3b-78e2-ae1d-5583c0e2fe50',expected:claimToken(undefined)}).binding;process.env.AIDLC_SESSION_BINDING=JSON.stringify(binding);
const records:any[]=[];
const cli=(args:string[])=>{const r=spawnSync(process.execPath,[join(repository,'bin/cli.js'),...args],{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,timeout:60000});let result;try{result=modelProjection(JSON.parse(r.stdout));}catch{result=r.stdout;}records.push({argv:args,exit_code:r.status,result,stderr:r.stderr});return r;};
try{
  writeFileSync(join(root,change.path),change.locked_content);assert.equal(hash(readFileSync(join(root,change.path))),change.locked_sha256);
  const next=cli(['orchestrate','next']);assert.equal(next.status,0,next.stderr);
  const producer=cli(['evidence','run','--stage','ui-page-planning','--module','project']);assert.equal(producer.status,0,producer.stderr);
  const report=cli(['orchestrate','report','--stage','ui-page-planning','--module','project','--result','completed']);assert.equal(report.status,0,report.stderr);
  console.log(JSON.stringify({exact_locked_source_restored:true,native_page_planning_completed:true}));
}finally{
  put(dir,'actual-page-plan-restoration.json',{kind:'exact-locked-source-restoration-and-real-Native-gates',change:{path:change.path,before:change.current_sha256,restored:change.locked_sha256,reason:'Only an added Markdown heading; no product behavior or visual decision changed. Immutable lock is unchanged.'},records,business_verified:false});
  const active=loadWorkflowState(root)!.active_instances[instance];if(active)releaseSession(root,instance,claimToken(active));delete process.env.AIDLC_SESSION_BINDING;
}
