/** Read-only completion-time proof. Does not renew observations, grants or sessions. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, writeFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { evaluation, hash } from './prepare-pilots';
import { readBatchResult, readIssuedGrant, readObservationAt } from '../../../../core/tools/aidlc-grant-store';
import { assertCandidate } from '../../../../core/tools/aidlc-observation-inputs';
import { projectAutonomyScope, ScopeReader } from '../../../../core/tools/aidlc-autonomy';
import { loadWorkflowState } from '../../../../core/tools/aidlc-light-state';
const keys=process.argv.slice(2);assert.equal(keys.length,2,'Explicit independent order and UI pilot keys required');
const proofs:any[]=[];
for(const key of keys){
  assert.match(key,/^(orders|publish)-r[0-9]+$/);
  const dir=join(evaluation,key),archive=join(dir,'actual-run'),manifest=JSON.parse(readFileSync(join(archive,'manifest.json'),'utf8')),root=manifest.original_root;
  assert.equal(manifest.business_verified,true,'A raw incomplete run cannot become a positive proof');
  const exit=manifest.actual_exit;assert.equal(exit.engineering_result,'verified');assert.equal(exit.operations_reconciled,true);assert.equal(exit.claims_reconciled,true);assert.deepEqual(exit.pending_unknown,[]);
  for(const file of manifest.files)assert.equal(hash(readFileSync(join(archive,file.saved_path))),file.sha256,'Raw archive changed: '+file.saved_path);
  const body=readBatchResult(root,exit.batch_result_ref),grant=readIssuedGrant(root,body.grant_ref).grant;
  assert.equal(body.engineering_result,'verified');assert.equal(body.business_verified,true);assert.equal(body.batch_completed,true);assert.equal(body.workflow_completed,false);
  assert.equal(body.workflow_id,manifest.workflow_id);assert.equal(grant.run_id,exit.run_id);assert.equal(exit.thread_id,grant.executor_constraints.initial_binding.session_id);
  assert.ok(Date.parse(body.ended_at)<=Date.parse(body.valid_until),'Observation was already expired at completion');
  assert.ok(Date.parse(body.ended_at)<=Date.parse(grant.expires_at),'Grant was already expired at completion');
  assertCandidate(root,body.candidate_ref);
  assert.equal(body.native.status,'passed');assert.ok(body.native.checked.length>=5);assert.ok(body.native.checked.every((c:any)=>c.status==='passed'));
  assert.ok(body.checks.every((c:any)=>['passed','not-required','not-applicable'].includes(c.status)));
  const observation=readObservationAt(root,body.observation_ref.path,body.observation_ref.digest);
  assert.ok(isDeepStrictEqual(observation.candidate_ref,body.candidate_ref));assert.equal(observation.coverage,'matrix');
  assert.ok(Date.parse(body.ended_at)<=Date.parse(observation.valid_until));
  const scope=projectAutonomyScope(root),reader=new ScopeReader(root,loadWorkflowState(root)!);
  const matrix=reader.resolve(scope.validation_matrix_ref!).record!;
  const ids=(matrix.checks as any[]).map(c=>typeof c==='string'?c:c.check_id);
  assert.equal(body.acceptance_observations.length,ids.length);
  for(const id of ids)assert.equal(body.acceptance_observations.filter((o:any)=>o.check_id===id&&o.status==='passed').length,1);
  assert.equal(body.decision_refs.length,1);
  for(const decision of body.decision_refs){assert.equal(decision.record_status,'verified');assert.equal(decision.human_review.status,'pending');assert.ok(decision.implementation_refs.length);assert.ok(decision.current_validation.length);for(const validation of decision.current_validation)assert.ok(isDeepStrictEqual(validation.receipt_ref,body.observation_ref));}
  for(const ref of body.source_refs){assert.equal(ref.repository_id,'project');assert.equal(ref.digest_mode,'raw-file');const file=join(root,ref.path);assert.equal(lstatSync(file).isSymbolicLink(),false);assert.equal(hash(readFileSync(file)),ref.digest,'Signed completion source changed: '+ref.path);}
  const operator=manifest.files.find((f:any)=>f.saved_path.startsWith('operator/')&&f.saved_path.endsWith('/controller.jsonl'));
  const events=readFileSync(join(archive,operator.saved_path),'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const approvalEvents=manifest.files.filter((f:any)=>(f.saved_path.startsWith('operator/')||f.saved_path.startsWith('prior-operator/'))&&f.saved_path.endsWith('/controller.jsonl')).flatMap((f:any)=>readFileSync(join(archive,f.saved_path),'utf8').trim().split(/\r?\n/).map(JSON.parse));
  assert.equal(approvalEvents.filter((e:any)=>e.event==='real-terminal-grant-issued').length,1);
  assert.equal(events.at(-1).event,'owned-service-close');
  const messages=readFileSync(join(archive,'host/native-events.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const success=new Set(messages.filter((m:any)=>m.event.method==='aidlc/tool/result'&&m.event.params.success).map((m:any)=>m.event.params.callId));
  const acceptedHumanInputs=messages.filter((m:any)=>m.event.method==='item/tool/call'&&success.has(m.event.id)&&m.event.params.arguments.action==='core'&&m.event.params.arguments.args.includes('--user-input'));
  assert.equal(acceptedHumanInputs.length,0,'Implementation must not fill human choices or approvals');
  if(key.startsWith('publish-')){assert.equal(scope.acceptance_refs!.length,13);assert.equal(body.ui_observations.length,10);assert.equal(new Set(body.ui_observations.map((o:any)=>o.combination_id)).size,10);}
  else assert.equal(body.ui_observations.length,0);
  proofs.push({key,workflow_id:body.workflow_id,thread_id:exit.thread_id,run_id:exit.run_id,result_ref:exit.batch_result_ref,candidate_ref:body.candidate_ref,ended_at:body.ended_at,valid_until_at_completion:body.valid_until,engineering_result:'verified',business_verified:true,batch_completed:true,workflow_completed:false,native_checked:body.native.checked,acceptance_observations:body.acceptance_observations.length,ui_combinations:body.ui_observations.length,decision_refs:body.decision_refs,human_review_summary:body.human_review_summary,real_terminal_grants:1,accepted_model_human_inputs:0,raw_files_verified:manifest.files.length,services_closed:true});
}
assert.ok(keys.some(k=>k.startsWith('orders-'))&&keys.some(k=>k.startsWith('publish-')));
assert.equal(new Set(proofs.map(p=>p.workflow_id)).size,2);assert.equal(new Set(proofs.map(p=>p.thread_id)).size,2);
const output=join(evaluation,'verification.json');assert.equal(existsSync(output),false,'Never overwrite a final proof');
writeFileSync(output,JSON.stringify({kind:'actual-independent-codex-completion-time-verification',verified_at:new Date().toISOString(),proof_semantics:'Verified signed results at their actual completion times; later elapsed observation validity does not authorize a new run',status:'completed',business_verified:true,pilots:proofs,limitations:['Two independent single-unit local pilots; no real multi-unit delivery proof','Human review of delegated details remains pending','No push, production deployment, successor or P2 recovery proof']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,status:'completed',business_verified:true,pilots:proofs.map(p=>({key:p.key,candidate_id:p.candidate_ref.candidate_id}))}));
