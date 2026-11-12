// Read-only replay of the captured orders-r12 budget tail. Transport responses
// are explicit contract fixtures, not a new real run or a proof of C8 delivery.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Gateway} from '../harness/codex/runtime/aidlc-codex-host.mjs';
const K=createRequire(import.meta.url)('../harness/codex/runtime/host-kernel.cjs');
const repo=resolve(import.meta.dirname,'..'),base=join(repo,'docs/evals/autonomy/p1-10');
const diagnosis=JSON.parse(fs.readFileSync(join(base,'fresh-run-2026-11-11/diagnosis.json')));
const actual=JSON.parse(fs.readFileSync(join(base,'orders-r12/it08-result.json')));
const archive=join(base,'orders-r12/it08-actual-1794330230300');
const manifest=JSON.parse(fs.readFileSync(join(archive,'manifest.json')));
for(const [path,digest]of Object.entries(manifest.files))assert.equal(createHash('sha256').update(fs.readFileSync(join(archive,path))).digest('hex'),digest,path);
const tail=diagnosis.root_cause_evidence.subsequent_control_steps;
const repairs=diagnosis.root_cause_evidence.distinct_successful_refreshes.filter(r=>r.args.includes('code-review'));
assert.equal(tail.length,32);assert.equal(repairs.length,3);
const root=fs.mkdtempSync(join(tmpdir(),'aidlc-refresh-tail-'));
const workflow='tail-contract-fixture',binding={workflow_id:workflow,stage_instance:'code-review@module:project@unit:default'};
const grant={request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),resource_limits:{wall_time_seconds:3600,max_equivalent_retries:1,max_active_units:1}};
let gateway;
const resultFor=(sensor,identity)=>({status:'passed',action:'regenerated',sensor,evidence_progress:{version:'1',transition:'invalid-to-current',workflow_id:workflow,stage_instance:binding.stage_instance,sensor,identity:identity||createHash('sha256').update(sensor).digest('hex')}});
try{
 for(const recognized of [false,true]){
  gateway=new Gateway({commands:[],supervision_limits:actual.supervision.limits},root,{binding,grant},async()=>({}));
  // No new limits: replay the recorded control slots and inject each newly
  // specified Core result at the original producer completion boundary.
  let time=0,index=0;
  gateway.progress=new K.ProgressBudget(actual.supervision.limits,gateway.budget,{now:()=>time,trace:gateway.trace});
  for(const step of tail){
   time++;
   gateway.progress.beginStep(step.family,step.stage_instance,step.input_digest);
   gateway.progress.endStep('succeeded');
   while(index<repairs.length&&Date.parse(repairs[index].at)<=Date.parse(step.at)){
    const repair=repairs[index++],sensor=repair.args[repair.args.indexOf('--sensor')+1];
    // runCore is nested within an already-counted recorded step, avoiding a
    // fictitious extra step. This exercises the actual Gateway consumer.
    gateway.progress.step={};
    await gateway.runCore(repair.args,async()=>recognized?resultFor(sensor):{status:'passed',sensor,action:'regenerated'});
    gateway.progress.step=null;
   }
  }
  assert.equal(index,3);
  if(!recognized)assert.throws(()=>gateway.progress.beginStep('core.next',binding.stage_instance,'a'.repeat(64)),/NO_PROGRESS_STEP_LIMIT/);
  else{
   gateway.progress.beginStep('core.next',binding.stage_instance,'a'.repeat(64));gateway.progress.endStep('succeeded');
   assert.equal(gateway.progress.seen.size,3);
   const args=repairs[0].args,sensor='review-evidence',valid=resultFor(sensor);
   for(const response of [valid,{...valid,action:'reused'},{...valid,status:'failed'}, {...valid,evidence_progress:{...valid.evidence_progress,workflow_id:'wrong',identity:'b'.repeat(64)}}, {...valid,evidence_progress:{...valid.evidence_progress,stage_instance:'code-review@module:other@unit:default',identity:'c'.repeat(64)}}, {...valid,evidence_progress:{...valid.evidence_progress,sensor:'unknown',identity:'d'.repeat(64)}}]){
    gateway.progress.step={};await gateway.runCore(args,async()=>({...response,timestamp:new Date().toISOString(),execution_id:randomUUID()}));gateway.progress.step=null;
   }
   assert.equal(gateway.progress.seen.size,3,'success/reuse/receipt churn or wrong bindings cannot create progress');
   while(gateway.progress.withoutProgress<actual.supervision.limits.max_steps_without_progress){gateway.progress.beginStep('core.next',binding.stage_instance,'e'.repeat(64));gateway.progress.endStep('succeeded');}
   assert.throws(()=>gateway.progress.beginStep('core.next',binding.stage_instance,'f'.repeat(64)),/NO_PROGRESS_STEP_LIMIT/);
  }
  gateway.cancel('test-end');await gateway.reconcile();gateway=null;
 }
 console.log(JSON.stringify({captured_steps:32,manifest_files:Object.keys(manifest.files).length,distinct_refreshes:3,old_stop:'no-progress-step-limit',new_tail:'continues',repeated_receipt:'still stops',limits:actual.supervision.limits,real_trial:false}));
}finally{gateway?.cancel('test-end');await gateway?.reconcile();fs.rmSync(root,{recursive:true,force:true});}
