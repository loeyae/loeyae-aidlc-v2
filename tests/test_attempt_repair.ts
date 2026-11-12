/** Seeded prework, real grant/admission/HTTP/command observations and Core rollback. No human H5/model. */
import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,dirname} from 'node:path';import {createHash} from 'node:crypto';
import {observationFixture,put} from './helpers/observation-fixture';import {runObservations} from '../core/tools/aidlc-observations';
import {attemptRepairDirective,assertAttemptRepairStage,assertAttemptRepairFinalization,assertAttemptRepairEvidence} from '../core/tools/aidlc-attempt-repair';
import {nativeHostDirective} from '../core/tools/aidlc-native-host';import {renderLightWorkflowState} from '../core/tools/aidlc-light-state';import {checkCurrentExecutionGrant} from '../core/tools/aidlc-execution-grant';
import K from '../harness/codex/runtime/host-kernel.cjs';
const scratch=mkdtempSync(join(tmpdir(),'aidlc-attempt-repair-')),inherited={...process.env},hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex'),suffix='@module:orders@unit:publish';let passed=0;
async function fixture(name:string,allowance=2){
 const f=observationFixture(scratch,name),state=f.current();
 state.completed_stage_instances.push('workspace-detection','units-generation@module:orders','tdd'+suffix,'code-generation'+suffix,'code-review'+suffix,'build-and-test');state.completed_stages=[...new Set(state.completed_stage_instances.map(s=>s.split('@')[0]))];
 put(f.root,'aidlc/active/aidlc-state.md',renderLightWorkflowState(state));
 put(f.root,'tests/native.cjs','// UC-D-001 seed executable test\n');
 put(f.root,'.aidlc/evidence/tdd/orders/publish/red-test-evidence.json',{phase:'RED',status:'passed',tests_total:1,uc_mapping:{'UC-D-001':['tests/native.cjs#pagination']},phase_input_binding:{files:[{path:'tests/native.cjs',sha256:hash(readFileSync(join(f.root,'tests/native.cjs')))}]},producer:{mode:'controlled',execution_id:'seeded-prework-red'},timestamp:'2026-01-01T00:00:00Z'});
 put(f.root,'src/orders.cjs',"exports.exportOrders=async()=>[];\n");f.commit();f.request.resource_limits.max_equivalent_retries=allowance;await f.issue();const child=await f.start();const admission=await f.run();assert.equal(admission.admission_result,'ready',JSON.stringify(admission.checks.filter((c:any)=>c.status==='failed')));
 const coordinator=process.env.AIDLC_SESSION_BINDING!,observed=await runObservations(f.root,'fixtures/observation-plan.json');assert.equal(observed.status,'failed');
 const grant=f.current().execution_grant_ref!;put(f.root,`.aidlc/host-runs/${grant.run_id}/attempt.json`,{thread_id:'test-session',grant_digest:grant.digest,started_at:new Date().toISOString()});
 put(f.root,`.aidlc/host-runs/${grant.run_id}/lifecycle.jsonl`,JSON.stringify({event:'host-start',run_id:grant.run_id,thread_id:'test-session',grant_digest:grant.digest,process_start:K.processIdentity(process.pid)})+'\n');
 const start=()=>attemptRepairDirective(f.root,['start','--pid',String(process.pid)]);
 const select=(instance:string)=>{const result=nativeHostDirective(f.root,['select','--instance',instance]);process.env.AIDLC_SESSION_BINDING=JSON.stringify(result.host_context.binding);if(instance==='workspace-detection')process.env.AIDLC_COORDINATOR_BINDING=process.env.AIDLC_SESSION_BINDING;return result;};
 process.env.AIDLC_COORDINATOR_BINDING=coordinator;
 return {...f,child,observed,start,select,inspect:()=>attemptRepairDirective(f.root,['inspect']).attempt_repair,request:(kind:string,key='orders/publish',failureDigest?:string)=>attemptRepairDirective(f.root,['request','--kind',kind,'--unit',key,'--failure',failureDigest||hash(readFileSync(join(f.root,observed.receipt_ref.path))),'--reason','Seeded diagnosis from actual failed full-matrix assertions']).attempt_repair};
}
const check=async(name:string,fn:(f:Awaited<ReturnType<typeof fixture>>)=>Promise<void>|void,allowance=2)=>{const f=await fixture('case-'+passed,allowance);try{await fn(f);passed++;console.log('PASS '+name);}finally{if(f.child.exitCode===null){const closed=new Promise(r=>f.child.once('close',r));f.child.kill();await closed;}}};
try{
 await check('code repair uses exact live bindings, preserves original RED/history, and reopens downstream gates',async f=>{
  // Optional phase statistics (e.g. not-required RED) must round-trip through the signed journal.
  const redPath='.aidlc/evidence/tdd/orders/publish/red-test-evidence.json',optional=JSON.parse(readFileSync(join(f.root,redPath),'utf8'));delete optional.tests_total;put(f.root,redPath,optional);
  const attemptPath=`.aidlc/host-runs/${f.current().execution_grant_ref!.run_id}/attempt.json`,fresh=readFileSync(join(f.root,attemptPath),'utf8');put(f.root,attemptPath,{...JSON.parse(fresh),started_at:'2026-01-01T00:00:00Z'});assert.throws(f.start,/FRESH_FIRST_START_REQUIRED/);put(f.root,attemptPath,fresh);
  f.start();assert.throws(f.start,/EXISTING_ATTEMPT_REQUIRES_P2/);const diagnosed=f.inspect();assert.equal(diagnosed.status,'diagnosis-required');
  assert.throws(()=>f.request('code-defect','orders/foreign'),/OUTSIDE_AFFECTED/);assert.throws(()=>f.request('code-defect','orders/publish','f'.repeat(64)),/FAILURE_CHANGED/);
  const oldHistory=f.current().history.length,red=readFileSync(join(f.root,'.aidlc/evidence/tdd/orders/publish/red-test-evidence.json'));
  const request=f.request('code-defect'),plan=request.plan;assert.equal(plan.steps.at(-1).instance,'code-generation'+suffix);
  assert.throws(()=>f.request('test-correction'),/ALREADY_CLASSIFIED/);assert.throws(()=>attemptRepairDirective(f.root,['apply','--expect',plan.plan_digest]),/EXACT_ROLLBACK_BINDING/);
  assert.throws(()=>assertAttemptRepairFinalization(f.root),/TRANSITION_NOT_COMPLETE/);
  for(const step of plan.steps){f.select(step.instance);attemptRepairDirective(f.root,['apply','--expect',plan.plan_digest]);}
  assert.ok(f.current().completed_stage_instances.includes('tdd'+suffix));for(const stage of ['code-generation'+suffix,'code-review'+suffix,'build-and-test'])assert.ok(!f.current().completed_stage_instances.includes(stage));
  assert.ok(f.current().history.length>oldHistory);assert.deepEqual(readFileSync(join(f.root,plan.red_ref.path)),red);
  assert.throws(()=>checkCurrentExecutionGrant(f.root,['test-write'],'tests/native.cjs'),/NEW_TEST_CYCLE_REQUIRED/);
  assert.throws(()=>checkCurrentExecutionGrant(f.root,['code-write'],'tests/native.cjs'),/NEW_TEST_CYCLE_REQUIRED/);
  assert.throws(()=>assertAttemptRepairEvidence(f.root,'tdd'+suffix,'red-test-evidence'),/ORIGINAL_RED_IS_IMMUTABLE/);
  assert.throws(()=>assertAttemptRepairStage(f.root,'code-generation'+suffix),/missing|FRESH_NATIVE_PROOF/);
  assert.throws(()=>assertAttemptRepairFinalization(f.root),/NATIVE_STAGE_NOT_RECOMPLETED/);
  for(const ref of plan.archives)assert.equal(hash(readFileSync(join(f.root,ref.path))),ref.digest);
  // A later rejected scope request cannot erase the accepted cycle's test/RED protections.
  f.select('workspace-detection');const again=await runObservations(f.root,'fixtures/observation-plan.json');assert.equal(again.status,'failed');
  f.request('scope-change','orders/publish',hash(readFileSync(join(f.root,again.receipt_ref.path))));f.select('code-generation'+suffix);
  assert.throws(()=>checkCurrentExecutionGrant(f.root,['test-write'],'tests/native.cjs'),/NEW_TEST_CYCLE_REQUIRED/);
  assert.throws(()=>assertAttemptRepairEvidence(f.root,'tdd'+suffix,'red-test-evidence'),/ORIGINAL_RED_IS_IMMUTABLE/);
  assert.throws(()=>f.request('code-defect','orders/publish',hash(readFileSync(join(f.root,again.receipt_ref.path)))),/CLASSIFICATION_ALREADY_BLOCKED/);
 });
 await check('test correction reopens TDD, permits only declared tests, retains original RED, and requires a new full cycle',async f=>{
  f.start();const plan=f.request('test-correction').plan;assert.equal(plan.steps.at(-1).instance,'tdd'+suffix);
  for(const step of plan.steps){f.select(step.instance);attemptRepairDirective(f.root,['apply','--expect',plan.plan_digest]);}
  checkCurrentExecutionGrant(f.root,['test-write'],'tests/native.cjs');assert.throws(()=>checkCurrentExecutionGrant(f.root,['test-write'],'tests/new.cjs'),/NEW_TEST_CYCLE_REQUIRED/);
  assert.throws(()=>checkCurrentExecutionGrant(f.root,['code-write'],'src/orders.cjs'),/PRESERVE_IMPLEMENTATION/);
  assert.ok(!f.current().completed_stage_instances.includes('tdd'+suffix));assert.throws(()=>assertAttemptRepairStage(f.root,'tdd'+suffix),/FRESH_NATIVE_PROOF|missing/);
  const original=plan.archives.find((r:any)=>r.original_path===plan.red_ref.path);assert.equal(hash(readFileSync(join(f.root,original.path))),plan.red_ref.digest);
 });
 await check('scope change is retained as a refused decision and cannot become a rollback',async f=>{
  f.start();const before=readFileSync(join(f.root,'aidlc/active/aidlc-state.md'));const request=f.request('scope-change');assert.equal(request.status,'blocked');assert.equal(f.inspect().status,'blocked');
  assert.throws(()=>attemptRepairDirective(f.root,['apply','--expect',request.plan.plan_digest]),/PLAN_CHANGED/);assert.deepEqual(readFileSync(join(f.root,'aidlc/active/aidlc-state.md')),before);
 });
 await check('ended attempt and binding drift reject without reopening stages',async f=>{
  f.start();assert.equal(f.inspect().status,'exhausted');assert.throws(()=>f.request('code-defect'),/CYCLE_BUDGET_EXHAUSTED/);const old=process.env.AIDLC_SESSION_BINDING!;process.env.AIDLC_SESSION_BINDING=JSON.stringify({...JSON.parse(old),generation:'foreign'});assert.throws(f.inspect);process.env.AIDLC_SESSION_BINDING=old;
  put(f.root,`.aidlc/host-runs/${f.current().execution_grant_ref!.run_id}/exit.json`,{engineering_result:'incomplete'});assert.throws(f.inspect,/ENDED_ATTEMPT/);
 },0);
 console.log('Attempt repair: '+passed+' real Core boundary groups passed; prework is seeded, observations and rollback are actual, no business pilot');
}finally{for(const k of Object.keys(process.env))if(!(k in inherited))delete process.env[k];Object.assign(process.env,inherited);assert.equal(resolve(dirname(scratch)),resolve(tmpdir()));rmSync(scratch,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
