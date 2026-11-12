/** Focused real observation producer/HTTP/candidate integration, seeded preparation only.
 * No Native phase chain, model, UI pilot, human H5 or batch-completion claim. */
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {observationFixture,ref,put,saveObservationEvidence} from './helpers/observation-fixture';
import {runObservations} from '../core/tools/aidlc-observations';
import {currentObservations,observationHash} from '../core/tools/aidlc-observation-inputs';
import {projectAutonomyDecisions,recordDelegatedDecision,autonomyHandoffDigest} from '../core/tools/aidlc-autonomy-policy';
const scratch=mkdtempSync(join(tmpdir(),'aidlc-it02-candidate-')),inherited={...process.env};let child:any;
async function stop(){if(!child||child.exitCode!==null)return;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('engineering service close timeout')),5000);child.once('close',()=>{clearTimeout(timer);resolve();});child.kill();});}
try {
  const f=observationFixture(scratch,'candidate',{mutate(plan:any,fixture:any){
    // The shared default fixture has command-only checks. Freeze an explicit HTTP
    // check here so this test actually exercises the serving-version contract.
    plan.checks[1]={check_id:'ready',kind:'http',covers:[fixture.item('AC-001')],endpoint:'app',path:'/publish',method:'POST',body:{state:'ready'},expected_status:200,assertions:[{assertion_id:'published',pointer:'/state',op:'equal',expected:'published'}]};
  }});f.record(f.decision());f.commit();
  child=await f.start();await f.issue();assert.ok(['ready','ready-with-delegated-decisions'].includes(f.run().admission_result));
  const coordinator=process.env.AIDLC_SESSION_BINDING!;
  const first=await runObservations(f.root,'fixtures/observation-plan.json');assert.equal(first.status,'passed');
  assert.equal(first.timing.clock,'monotonic');assert.ok(first.timing.duration_ms>=0);
  for(const observation of first.observations){assert.equal(observation.timing.clock,'monotonic');assert.ok(observation.timing.offset_ms>=0);assert.ok(observation.timing.offset_ms+observation.timing.duration_ms<=first.timing.duration_ms+1);}
  if(process.env.AIDLC_EVAL_DIR)saveObservationEvidence(f,first,join(process.env.AIDLC_EVAL_DIR,'initial'));
  const raw=readFileSync(join(f.root,first.receipt_ref.path)),beforeCandidate=first.candidate_ref;
  const binding=f.bindUnit('code-review'),update=(projectAutonomyDecisions(f.root).write_contract as any).updates[0];
  const proposal={...update.proposal,recorded_by:`${binding.owner}/${binding.session_id}`,implementation_refs:[ref(f.root,'src/orders.cjs')],validation_refs:[{check_id:'recoverable',sensor:'runtime-observation',stage_instance:first.producer.stage_instance,path:first.receipt_ref.path,digest:observationHash(raw),workflow_id:f.current().workflow_id,batch_id:'publish'}]};
  recordDelegatedDecision(f.root,proposal,autonomyHandoffDigest(f.root));
  assert.throws(()=>currentObservations(f.root,f.current()),/CANDIDATE_DIRTY|CANDIDATE_CHANGED/,'Pre-metadata matrix is historical context, never final verification');
  f.commit();process.env.AIDLC_SESSION_BINDING=coordinator;
  const staleService=await runObservations(f.root,'fixtures/observation-plan.json');
  assert.equal(staleService.status,'failed','A clean commit alone cannot claim the service runs the new candidate');
  assert.notEqual(staleService.candidate_ref.candidate_id,beforeCandidate.candidate_id);
  if(process.env.AIDLC_EVAL_DIR)saveObservationEvidence(f,staleService,join(process.env.AIDLC_EVAL_DIR,'stale-service'));
  const failedRaw=readFileSync(join(f.root,staleService.receipt_ref.path));
  await stop();child=await f.start();assert.ok(['ready','ready-with-delegated-decisions'].includes(f.run().admission_result),'Changed service origin requires new admission');
  const final=await runObservations(f.root,'fixtures/observation-plan.json');assert.equal(final.status,'passed');
  assert.equal(final.candidate_ref.candidate_id,staleService.candidate_ref.candidate_id);
  assert.deepEqual(final.observations.map((o:any)=>o.check_id).sort(),first.observations.map((o:any)=>o.check_id).sort(),'The final matrix retains every original check');
  assert.deepEqual(readFileSync(join(f.root,first.receipt_ref.path)),raw,'Original successful receipt is immutable');
  assert.deepEqual(readFileSync(join(f.root,staleService.receipt_ref.path)),failedRaw,'Failed serving-version receipt is immutable');
  assert.equal(currentObservations(f.root,f.current()).status,'passed');
  if(process.env.AIDLC_EVAL_DIR){saveObservationEvidence(f,final,join(process.env.AIDLC_EVAL_DIR,'final'));put(process.env.AIDLC_EVAL_DIR,'candidate-integration.json',{kind:'engineering-candidate-integration',business_verified:false,initial_candidate:beforeCandidate,stale_service_status:staleService.status,final_candidate:final.candidate_ref,final_status:final.status,check_ids:final.observations.map((o:any)=>o.check_id),retained_receipts:[first.receipt_ref,staleService.receipt_ref,final.receipt_ref]});}
  const origin=process.env.OBS_ORIGIN;process.env.OBS_ORIGIN=origin+'/changed';
  assert.throws(()=>currentObservations(f.root,f.current()),/ENVIRONMENT_CHANGED/);process.env.OBS_ORIGIN=origin;
  put(f.root,'src/orders.cjs',readFileSync(join(f.root,'src/orders.cjs'),'utf8')+'\n// subsequent source revision\n');
  assert.throws(()=>currentObservations(f.root,f.current()),/CANDIDATE_DIRTY|CANDIDATE_CHANGED/);
  console.log('PASS actual metadata publication, historical-matrix refusal, stale serving candidate failure, final complete matrix and environment/source invalidation');
} finally {
  await stop();for(const key of Object.keys(process.env))if(!(key in inherited))delete process.env[key];Object.assign(process.env,inherited);rmSync(scratch,{recursive:true,force:true});
}
