/** IT-01B: Core-owned, bounded rollback in one live attempt. No restart or successor. */
import {existsSync,readFileSync,mkdirSync,writeFileSync,lstatSync} from 'node:fs';
import {join,dirname} from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {loadWorkflowState,saveWorkflowState,sessionBinding,withSessionPublication,type SessionBinding} from './aidlc-light-state';
import {loadWorkflowParts,evidenceScopeForInstance} from './aidlc-workflow-layout';import {sessionRef} from './aidlc-session';
import {checkCurrentExecutionGrant} from './aidlc-execution-grant';
import {readIssuedGrant,readAttemptRepairState,storeAttemptRepairState,storeAttemptPhaseFailure,readAttemptPhaseFailure,assertAdmissionReceipt,readRecoveryState,type GrantOperation} from './aidlc-grant-store';
import {currentObservations} from './aidlc-observation-inputs';import {projectAutonomyScope} from './aidlc-autonomy';
import {safeFile,canonicalAutonomyJson as json,autonomyDigest as digest} from './aidlc-autonomy-files';
import {evidenceRelativePath} from './aidlc-execution-context';import {codexRuntime} from './aidlc-native-host';
import {readSourceRevision} from './aidlc-revision';import {phaseObservationDigest,SEMANTIC_SENSORS} from './aidlc-evidence';
import {nestedSourceRepos} from './aidlc-nested-repos';
type Row=Record<string,any>;
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const graph=()=>JSON.parse(readFileSync(new URL('./data/stage-graph.json',import.meta.url),'utf8')).stages as Row[];
const same=(a:unknown,b:unknown)=>json(a)===json(b);
function fail(reason:string):never {throw Error('ATTEMPT_REPAIR_'+reason);}
export const repairRoute=(kind:string):string|null=>kind==='code-defect'?'code-generation':kind==='test-correction'?'tdd':null;
export function repairCycleLimit(allowance:number):number {if(!Number.isSafeInteger(allowance)||allowance<0)fail('BUDGET_INVALID');return Math.min(2,allowance);}
const phasePath=(unit:Row,stage:string,sensor:string)=>evidenceRelativePath(stage,sensor,'unit',unit).replaceAll('\\','/');
const testPath=(p:string)=>/(^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(p);
const rawRef=(root:string,path:string)=>({path,digest:hash(readFileSync(safeFile(root,path)))});
const ucdIds=(red:Row)=>[...new Set(Array.isArray(red.uc_mapping)?red.uc_mapping.map((r:Row)=>r.use_case):Object.keys(red.uc_mapping||{}))].sort();
/** Used only after the controlled bundle, candidate, raw digests and environment were verified. */
export function repairableObservedFailure(o:Row,raw:Row):boolean {
 if(raw.resource_reconciliation?.reconciled===false)return false;
 if(raw.error||o.dependency_binding?.provider?.external_id)return false;
 const assertion=Array.isArray(raw.assertion_results)&&raw.assertion_results.some((r:Row)=>r.passed===false);
 return o.kind==='command'&&raw.exit_code===0&&assertion||o.kind==='http'&&raw.version_verified===true&&Number.isInteger(raw.actual?.status)&&(assertion||raw.actual.status!==200)||o.kind==='ui'&&raw.version_before?.status===200&&raw.version_after?.status===200&&same(raw.version_before.body,raw.version_after.body)&&(raw.visual?.passed===false||raw.passed===false);
}
function privateRunFile(root:string,run:string,name:string){
 const recovery=readRecoveryState(root,loadWorkflowState(root)!);
 const label=`.aidlc/host-runs/${run}/${recovery?`attempts/${recovery.attempt_id}/`:''}${name}`;
 if(name==='exit.json')return existsSync(join(root,label));
 return JSON.parse(readFileSync(safeFile(root,label),'utf8'));
}
function authority(root:string,operations:GrantOperation[]=['validation-execute']){
 checkCurrentExecutionGrant(root,operations);const global=loadWorkflowState(root)!,binding=sessionBinding()!;
 if(!global.execution_grant_ref||global.autonomy_contract_version!=='1')fail('MANAGED_ATTEMPT_REQUIRED');
 const grant=readIssuedGrant(root,global.execution_grant_ref).grant;
 if(privateRunFile(root,grant.run_id,'exit.json'))fail('ENDED_ATTEMPT');
 const state=readAttemptRepairState(root,global);
 return {global,binding,grant,state};
}
function live(root:string,x:ReturnType<typeof authority>){
 if(!x.state)fail('NOT_STARTED');
 const attempt=privateRunFile(root,x.grant.run_id,'attempt.json');
 if(attempt.thread_id!==x.binding.session_id||attempt.grant_digest!==x.global.execution_grant_ref!.digest)fail('ATTEMPT_IDENTITY_CHANGED');
 const kernel=createRequire(import.meta.url)(join(dirname(codexRuntime()),'host-kernel.cjs'));
 const hostProcess=readRecoveryState(root,x.global)?.host_process||x.state.host_process;
 const actual=kernel.processIdentity(hostProcess.pid);
 if(actual.status!=='present'||!actual.birth_token||actual.birth_token!==hostProcess.birth_token)fail('HOST_NOT_LIVE');
 if(x.state.uncertain)fail('PARTIAL_TRANSITION_UNRECONCILED');
 return x.state;
}
const withoutSignature=(s:Row):Row=>{const {issuer_provenance:_,...body}=s;return {...body,revision:s.revision+1};};
function publish(root:string,x:ReturnType<typeof authority>,state:Row){
 return withSessionPublication(root,sessionRef(root,x.binding.stage_instance),x.binding.stage_instance,()=>storeAttemptRepairState(root,loadWorkflowState(root)!,state),x.binding,'workflow-write');
}
function nativeFailure(root:string,x:ReturnType<typeof authority>,preferred?:Row):Row|undefined {
 const scope=projectAutonomyScope(root),parts=loadWorkflowParts(root),candidates:Row[]=[];
 for(const u of scope.units!.filter(u=>u.role==='implement')){
  const unit=u.unit_ref,instance=`code-generation@module:${unit.module_id}@unit:${unit.unit_id}`,owner=[...parts.parts.values()].find(p=>p.state.workflow_id===unit.workflow_ref.workflow_id)?.state;
  // The global current pointer may belong to a coordinator or another unit.
  // The signed producer receipt binds the exact producing claim; an unresolved
  // code-generation instance and current scoped inputs identify the repair lane.
  if(!owner||(preferred?!same(preferred,unit):owner.completed_stage_instances.includes(instance)))continue;
  const record=readAttemptPhaseFailure(root,x.global,instance);if(!record)continue;
  const path=record.receipt_ref.path,proof={...record.observation,...record};
  if(proof.status!=='failed'||proof.phase!=='GREEN')continue;
  assertAdmissionReceipt(root,x.global);
  if(proof.error||proof.observed_command?.exit_code!==1||proof.compile_status!=='passed'||proof.environment_status!=='passed'||proof.failure_class!=='behavior'||!(proof.tests_failed>0)||proof.producer?.mode!=='controlled'||proof.producer?.name!=='loeyae-aidlc-evidence'||proof.workflow_id!==unit.workflow_ref.workflow_id||proof.stage_instance!==instance||Date.parse(proof.timestamp)<Date.parse(x.state.started_at)||!Number.isFinite(Date.parse(proof.timestamp)))fail('ENVIRONMENT_OR_UNKNOWN_FAILURE');
  const current=readSourceRevision(root,evidenceScopeForInstance(root,instance),nestedSourceRepos(root));
  if(!current.scope_digest||proof.source_revision?.scope_digest!==current.scope_digest||proof.checker?.argv_digest!==phaseObservationDigest('GREEN',proof.observed_command?.argv_digest))fail('NATIVE_FAILURE_CHANGED');
  if(!proof.phase_input_binding?.files?.length)fail('NATIVE_FAILURE_INPUTS_UNAVAILABLE');
  for(const r of proof.phase_input_binding.files)if(hash(readFileSync(safeFile(root,r.path)))!==r.sha256)fail('NATIVE_FAILURE_CHANGED');
  candidates.push({failure_kind:'native-green',unit,failure_ref:rawRef(root,path),failed_checks:[{check_id:'native-green',kind:'native',raw_output_ref:rawRef(root,path)}]});
 }
 if(candidates.length>1)fail('AFFECTED_UNIT_AMBIGUOUS');return candidates[0];
}
function failure(root:string,x:ReturnType<typeof authority>):Row {
 const native=nativeFailure(root,x);if(native)return native;
 const report=currentObservations(root,x.global);
 if(report.coverage!=='matrix'||report.status!=='failed')fail('CONTROLLED_FAILURE_REQUIRED');
 const failed=report.observations.filter((o:Row)=>o.status==='failed');
 for(const o of failed){
  const raw=JSON.parse(readFileSync(safeFile(root,o.raw_output_ref.path),'utf8'));
  if(!repairableObservedFailure(o,raw))fail('ENVIRONMENT_OR_UNKNOWN_FAILURE');
 }
 // Without a frozen per-check unit mapping, a module with several implement units is ambiguous.
 // Reject instead of attributing a failure to an arbitrary sibling.
 const scope=projectAutonomyScope(root),modules=new Set(failed.flatMap((o:Row)=>o.covers.map((r:Row)=>/\/modules\/([^/]+)\//.exec(r.path)?.[1]).filter(Boolean)));
 const candidates=scope.units!.filter(u=>u.role==='implement'&&(modules.size===0||modules.has(u.unit_ref.module_id)));
 if(candidates.length!==1)fail('AFFECTED_UNIT_AMBIGUOUS');
 return {report,failure_kind:'matrix',unit:candidates[0].unit_ref,failure_ref:rawRef(root,report.receipt_ref.path),failed_checks:failed.map((o:Row)=>({check_id:o.check_id,kind:o.kind,raw_output_ref:o.raw_output_ref}))};
}
function steps(root:string,unit:Row,route:string,native=false){
 const suffix=`@module:${unit.module_id}@unit:${unit.unit_id}`,stages=graph();
 const removed=new Set([route,'code-generation','code-review']);
 // Invalidate project consumers transitively, retaining upstream approved design and TDD for code fixes.
 let changed=true;while(changed){changed=false;for(const s of stages)if(s.axis==='project'&&s.requires.some((r:string)=>removed.has(r))&&!removed.has(s.slug)){removed.add(s.slug);changed=true;}}
 removed.add('build-and-test');
 const parts=loadWorkflowParts(root),project=parts.parts.get(parts.split?'integration':'global')!;
 const projectInvalid=project.state.completed_stage_instances.filter(s=>!s.includes('@')&&removed.has(s));
 const owner=[...parts.parts.values()].find(p=>p.state.workflow_id===unit.workflow_ref.workflow_id);if(!owner)fail('UNIT_WORKFLOW_CHANGED');
 if(!owner.state.completed_stage_instances.includes('tdd'+suffix)||!native&&!owner.state.completed_stage_instances.includes('code-review'+suffix))fail('REVIEWED_IMPLEMENTATION_REQUIRED');
 const unitInvalid=[...new Set([...owner.state.completed_stage_instances.filter(s=>s.endsWith(suffix)&&removed.has(s.split('@')[0])),route+suffix,'code-generation'+suffix,'code-review'+suffix])];
 return [...(projectInvalid.length?[{instance:'build-and-test',invalidates:projectInvalid,status:'pending'}]:[]),{instance:route+suffix,invalidates:unitInvalid,status:'pending'}];
}
function archive(root:string,x:ReturnType<typeof authority>,plan:Row){
 const redPath=phasePath(plan.unit_ref,'tdd','red-test-evidence'),red=JSON.parse(readFileSync(safeFile(root,redPath),'utf8'));
 plan.red_ref=rawRef(root,redPath);plan.original_ucd_ids=ucdIds(red);plan.original_tests_total=Number.isFinite(red.tests_total)?red.tests_total:null;
 plan.test_paths=(red.phase_input_binding?.files||[]).map((r:Row)=>r.path).filter((p:string)=>testPath(p)&&!plan.protected_validation_inputs.includes(p)&&!x.grant.inputs.some(r=>r.path===p));
 for(const r of red.phase_input_binding?.files||[])if(testPath(r.path)&&hash(readFileSync(safeFile(root,r.path)))!==r.sha256)fail('ORIGINAL_TEST_INPUT_CHANGED');
 if(plan.classification==='test-correction'&&!plan.test_paths.length)fail('TEST_INPUTS_UNAVAILABLE');
 const refs:Row[]=[],seen=new Set<string>();
 const capture=(p:string)=>{
  if(seen.has(p))return;seen.add(p);if(!existsSync(join(root,p)))return;
  const bytes=readFileSync(safeFile(root,p)),label=`.aidlc/evidence/attempt-repairs/${x.grant.run_id}/${plan.sequence}/archive/${p}`;
  // All components are Core generated; still reject links before creating any directory.
  for(let at=join(root,label);at!==root;at=dirname(at))if(existsSync(at)&&lstatSync(at).isSymbolicLink())fail('LINKED_ARCHIVE');
  mkdirSync(dirname(join(root,label)),{recursive:true});writeFileSync(join(root,label),bytes,{flag:'wx'});refs.push({original_path:p,path:label,digest:hash(bytes)});
 };
 for(const step of plan.steps)for(const instance of step.invalidates){const slug=instance.split('@')[0],s=graph().find(s=>s.slug===slug)!;for(const sensor of s.sensors)capture(evidenceRelativePath(slug,sensor,s.axis,plan.unit_ref).replaceAll('\\','/'));}
 for(const sensor of ['red-test-evidence','baseline-test-evidence'])capture(phasePath(plan.unit_ref,'tdd',sensor));
 capture(evidenceRelativePath('test-case-derivation','test-case-derivation','module',plan.unit_ref).replaceAll('\\','/'));
 for(const r of red.phase_input_binding?.files||[])capture(r.path);
 plan.archives=refs;
}
export function inspectAttemptRepair(root:string):Row {
 const x=authority(root),state=live(root,x),latest=state.requests.at(-1);
 const base={schema:'aidlc.same-attempt-repair/v1',run_id:x.grant.run_id,remaining_cycles:Math.max(0,repairCycleLimit(x.grant.resource_limits.max_equivalent_retries)-state.requests.filter((p:Row)=>p.status==='accepted').length),execution_authorized:false,business_verified:false};
 if(latest?.status==='rejected')return {...base,status:'blocked',reason:latest.reason,request:latest};
 if(latest?.steps?.some((s:Row)=>s.status!=='applied'))return {...base,status:'planned',plan:latest};
 try{const f=failure(root,x);if(state.requests.some((p:Row)=>same(p.source_failure_ref,f.failure_ref)))return {...base,status:'waiting-for-new-validation',plan:latest};
  return {...base,status:base.remaining_cycles?'diagnosis-required':'exhausted',failure_ref:f.failure_ref,failed_checks:f.failed_checks,eligible_units:[f.unit],allowed_classifications:['code-defect','test-correction','scope-change','unknown']};
 }catch(e){return {...base,status:'not-repairable',reason:String(e)};}
}
export function requestAttemptRepair(root:string,kind:string,key:string,failureDigest:string,reason:string):Row {
 const x=authority(root,['validation-execute','workflow-write']),state=live(root,x);
 if(!['code-defect','test-correction','scope-change','expected-red','unknown'].includes(kind)||typeof reason!=='string'||!reason.trim()||reason.length>2048||/[\x00-\x1f]/.test(reason))fail('REQUEST_INVALID');
 if(state.requests.at(-1)?.status==='rejected')fail('CLASSIFICATION_ALREADY_BLOCKED');
 const f=failure(root,x);if(f.failure_ref.digest!==failureDigest)fail('FAILURE_CHANGED');
 if(key!==`${f.unit.module_id}/${f.unit.unit_id}`)fail('OUTSIDE_AFFECTED_IMPLEMENT_UNIT');
 if(state.requests.some((p:Row)=>same(p.source_failure_ref,f.failure_ref)))fail('FAILURE_ALREADY_CLASSIFIED');
 if(state.requests.some((p:Row)=>p.steps?.some((s:Row)=>s.status!=='applied')))fail('TRANSITION_PENDING');
 const route=repairRoute(kind),next=withoutSignature(state),count=state.requests.filter((p:Row)=>p.status==='accepted').length;
 const plan:Row={sequence:state.requests.length+1,classification:kind,rationale:reason,failure_kind:f.failure_kind,source_failure_ref:f.failure_ref,failure_ref:f.failure_ref,failed_checks:f.failed_checks,unit_ref:f.unit,protected_validation_inputs:(f.report?.source_refs||[]).map((r:Row)=>r.path),requested_at:new Date().toISOString(),status:'rejected',reason:kind==='scope-change'?'scope-change-required':kind==='expected-red'?'expected-red-is-normal-execution':'diagnosis-not-proven'};
 if(route){
  if(count>=repairCycleLimit(x.grant.resource_limits.max_equivalent_retries))fail('CYCLE_BUDGET_EXHAUSTED');
  for(const op of ['workflow-write','stage-report','evidence-publish','validation-execute','code-write',...(kind==='test-correction'?['test-write']:[])])if(!x.grant.allowed_operations.includes(op as GrantOperation))fail('ORIGINAL_PERMISSION_INSUFFICIENT');
  plan.steps=steps(root,f.unit,route,f.failure_kind==='native-green');plan.status='accepted';delete plan.reason;archive(root,x,plan);
 }
 const retained=`.aidlc/evidence/attempt-repairs/${x.grant.run_id}/${plan.sequence}/failure.json`;
 mkdirSync(dirname(join(root,retained)),{recursive:true});writeFileSync(join(root,retained),readFileSync(safeFile(root,f.failure_ref.path)),{flag:'wx'});plan.failure_ref=rawRef(root,retained);
 if(f.failure_kind==='native-green')plan.failed_checks=[{...plan.failed_checks[0],raw_output_ref:plan.failure_ref}];
 plan.plan_digest=digest(plan);next.requests.push(plan);publish(root,x,next);return {schema:'aidlc.same-attempt-repair/v1',status:plan.status==='accepted'?'planned':'blocked',plan,execution_authorized:false,business_verified:false};
}
export function applyAttemptRepair(root:string,planDigest:string):Row {
 const x=authority(root,['workflow-write','stage-report']),state=live(root,x),plan=state.requests.at(-1);
 if(!plan||plan.status!=='accepted'||plan.plan_digest!==planDigest)fail('PLAN_CHANGED');
 const step=plan.steps.find((s:Row)=>s.status!=='applied');if(!step||step.instance!==x.binding.stage_instance)fail('EXACT_ROLLBACK_BINDING_REQUIRED');
 const currentFailure=plan.failure_kind==='native-green'?nativeFailure(root,x,plan.unit_ref):failure(root,x);
 if(!currentFailure||!same(currentFailure.failure_ref,plan.source_failure_ref))fail('FAILURE_CHANGED');
 for(const r of plan.archives)if(hash(readFileSync(safeFile(root,r.path)))!==r.digest)fail('ARCHIVE_CHANGED');
 const before=loadWorkflowState(root,sessionRef(root,step.instance))!;if(before.status!=='running')fail('WORKFLOW_NOT_RUNNING');
 for(const instance of step.invalidates)if(before.active_instances[instance]&&instance!==step.instance)fail('OTHER_CLAIM_ACTIVE');
 const next=withoutSignature(state),updated=next.requests.at(-1),index=plan.steps.indexOf(step);updated.steps[index].status='applying';next.uncertain=true;publish(root,x,next);
 // From this point a failed publication is deliberately unreconciled. P1 never guesses/replays it.
 try{
 const ref=sessionRef(root,step.instance);
 let stateRef:Row|undefined;
 withSessionPublication(root,ref,step.instance,()=>{
  const wf=loadWorkflowState(root,ref)!;if(wf.status!=='running')fail('WORKFLOW_NOT_RUNNING');
  for(const instance of step.invalidates){const claim=wf.active_instances[instance];if(claim&&instance!==step.instance)fail('OTHER_CLAIM_ACTIVE');}
  wf.completed_stage_instances=wf.completed_stage_instances.filter(s=>!step.invalidates.includes(s));
  wf.completed_stages=[...new Set(wf.completed_stage_instances.map(s=>s.split('@')[0]))];
  wf.current_stage_instance=step.instance;wf.current_stage=step.instance.split('@')[0];wf.current_phase=graph().find(s=>s.slug===wf.current_stage)!.phase;
  const match=/@module:([^@]+)@unit:([^@]+)$/.exec(step.instance);if(match){wf.current_module=match[1];wf.current_unit=match[2];if(wf.unit_contexts?.[match[1]+':'+match[2]])wf.unit_contexts[match[1]+':'+match[2]]={stage:wf.current_stage,phase:wf.current_phase,stage_instance:step.instance};}else{delete wf.current_module;delete wf.current_unit;}
  wf.history.push({stage:wf.current_stage,instance_id:step.instance,result:'repair-reopened',timestamp:new Date().toISOString(),user_input:undefined});
  const previous=wf.revision;saveWorkflowState(root,wf,ref);stateRef={workflow_id:wf.workflow_id,revision_before:previous,revision_after:wf.revision};
 },x.binding,'workflow-write');
 const latest=readAttemptRepairState(root,loadWorkflowState(root)!)!,done=withoutSignature(latest),p=done.requests.at(-1);p.steps[index].status='applied';p.steps[index].applied_at=new Date().toISOString();p.steps[index].state_ref=stateRef;delete done.uncertain;publish(root,x,done);
 return {schema:'aidlc.same-attempt-repair/v1',status:p.steps.every((s:Row)=>s.status==='applied')?'applied':'planned',plan:p,execution_authorized:false,business_verified:false};
 }catch(error){throw Error('ATTEMPT_REPAIR_PARTIAL_TRANSITION_UNRECONCILED: '+String(error));}
}
/** Called by existing grant checks; does not create an authorization cache or recurse into the grant checker. */
export function assertAttemptRepairWrite(root:string,binding:SessionBinding,operations:readonly GrantOperation[],path?:string){
 if(!path||!operations.some(op=>['code-write','test-write'].includes(op)))return;
 const global=loadWorkflowState(root)!,state=readAttemptRepairState(root,global),plan=state?.requests.filter((p:Row)=>p.status==='accepted').at(-1);if(!plan)return;
 if(state.uncertain||plan.steps.some((s:Row)=>s.status!=='applied'))fail('TRANSITION_PENDING');
 if(!binding.stage_instance.endsWith(`@module:${plan.unit_ref.module_id}@unit:${plan.unit_ref.unit_id}`))return;
 if(plan.protected_validation_inputs.includes(path))fail('INDEPENDENT_VALIDATION_INPUT_IS_IMMUTABLE');
 const isTest=plan.test_paths.includes(path)||testPath(path)||operations.includes('test-write');
 if(isTest&&(plan.classification!=='test-correction'||binding.stage_instance.split('@')[0]!=='tdd'||!plan.test_paths.includes(path)))fail('NEW_TEST_CYCLE_REQUIRED');
 if(!isTest&&binding.stage_instance.split('@')[0]==='tdd')fail('TEST_CORRECTION_MUST_PRESERVE_IMPLEMENTATION');
}
export function assertAttemptRepairEvidence(root:string,instance:string,sensor?:string){
 const global=loadWorkflowState(root);if(!global?.execution_grant_ref)return;const state=readAttemptRepairState(root,global),p=state?.requests.filter((p:Row)=>p.status==='accepted').at(-1);if(!p)return;
 if(state.uncertain||p.steps.some((s:Row)=>s.status!=='applied'))fail('TRANSITION_PENDING');
 if(p.classification==='code-defect'&&instance===`tdd@module:${p.unit_ref.module_id}@unit:${p.unit_ref.unit_id}`&&(!sensor||['red-test-evidence','baseline-test-evidence'].includes(sensor)))fail('ORIGINAL_RED_IS_IMMUTABLE');
}
export function assertAttemptRepairStage(root:string,instance:string){
 const global=loadWorkflowState(root);if(!global?.execution_grant_ref)return;const state=readAttemptRepairState(root,global),p=state?.requests.filter((p:Row)=>p.status==='accepted').at(-1);if(!p)return;
 assertAttemptRepairEvidence(root,instance);
 for(const request of state.requests){
  if(hash(readFileSync(safeFile(root,request.failure_ref.path)))!==request.failure_ref.digest)fail('FAILURE_RECORD_CHANGED');
  for(const r of request.failed_checks||[])if(hash(readFileSync(safeFile(root,r.raw_output_ref.path)))!==r.raw_output_ref.digest)fail('FAILURE_RECORD_CHANGED');
  for(const r of request.archives||[])if(hash(readFileSync(safeFile(root,r.path)))!==r.digest)fail('ARCHIVE_CHANGED');
 }
 const red=JSON.parse(readFileSync(safeFile(root,p.red_ref.path),'utf8'));
 if(p.classification==='code-defect'&&rawRef(root,p.red_ref.path).digest!==p.red_ref.digest)fail('ORIGINAL_RED_CHANGED');
 const step=p.steps.find((s:Row)=>s.invalidates.includes(instance));if(!step)return;
 const node=graph().find(s=>s.slug===instance.split('@')[0])!;
 for(const sensor of node.sensors){
  // Inline checks such as no-todo produce no evidence file; the ordinary Native gate reruns them.
  if(!SEMANTIC_SENSORS.has(sensor)&&sensor!=='build-test-evidence')continue;
  const path=evidenceRelativePath(node.slug,sensor,node.axis,p.unit_ref).replaceAll('\\','/'),proof=JSON.parse(readFileSync(safeFile(root,path),'utf8'));
  if(!Number.isFinite(Date.parse(proof.timestamp))||Date.parse(proof.timestamp)<Date.parse(step.applied_at)||proof.producer?.mode!=='controlled')fail('FRESH_NATIVE_PROOF_REQUIRED');
 }
 if(p.classification==='test-correction'&&instance.split('@')[0]==='tdd'){
  if(rawRef(root,p.red_ref.path).digest===p.red_ref.digest||!same(ucdIds(red),p.original_ucd_ids)||Number.isFinite(p.original_tests_total)&&(!Number.isFinite(red.tests_total)||red.tests_total<p.original_tests_total))fail('NEW_RED_OR_COVERAGE_REQUIRED');
 }
}
export function assertAttemptRepairFinalization(root:string){
 const global=loadWorkflowState(root);if(!global?.execution_grant_ref)return;const state=readAttemptRepairState(root,global),p=state?.requests.at(-1);if(!p)return;
 if(state.uncertain||p.status!=='accepted'||p.steps.some((s:Row)=>s.status!=='applied'))fail('TRANSITION_NOT_COMPLETE');
 for(const step of p.steps)for(const instance of step.invalidates){
  const wf=loadWorkflowState(root,sessionRef(root,instance))!;if(!wf.completed_stage_instances.includes(instance))fail('NATIVE_STAGE_NOT_RECOMPLETED');assertAttemptRepairStage(root,instance);
 }
}
/** Invoked only by the real failed phase producer, before its original rejection. */
export function recordAttemptPhaseFailure(root:string,instance:string,body:Row):Row|undefined {
 const global=loadWorkflowState(root);if(!global?.execution_grant_ref||!readAttemptRepairState(root,global))return undefined;
 const x=authority(root,['evidence-publish','validation-execute']);live(root,x);
 return withSessionPublication(root,sessionRef(root,instance),instance,()=>storeAttemptPhaseFailure(root,loadWorkflowState(root)!,{...body,schema:'aidlc.attempt-phase-failure/v1',grant_ref:global.execution_grant_ref,batch_ref:global.autonomy_batch,workflow_id:x.binding.workflow_id,stage_instance:instance,timestamp:new Date().toISOString(),producer:{name:'loeyae-aidlc-evidence',mode:'controlled'},business_verified:false}),x.binding);
}
export function attemptRepairDirective(root:string,args:string[]):Row {
 if(args.length===3&&args[0]==='start'&&args[1]==='--pid'){
  const x=authority(root,['workflow-write']);if(x.state){const recovery=readRecoveryState(root,x.global);if(!recovery||recovery.status!=='active'||recovery.host_process.pid!==Number(args[2]))fail('EXISTING_ATTEMPT_REQUIRES_P2');live(root,x);return {kind:'print',attempt_repair:{status:'resumed',revision:x.state.revision,requests_preserved:true}};}
  if(x.binding.stage_instance!==x.grant.executor_constraints.initial_binding.stage_instance)fail('INITIAL_COORDINATOR_REQUIRED');
  const attempt=privateRunFile(root,x.grant.run_id,'attempt.json');if(attempt.thread_id!==x.binding.session_id||attempt.grant_digest!==x.global.execution_grant_ref!.digest)fail('ATTEMPT_IDENTITY_CHANGED');
  const pid=Number(args[2]),kernel=createRequire(import.meta.url)(join(dirname(codexRuntime()),'host-kernel.cjs')),host_process=kernel.processIdentity(pid);
  if(host_process.status!=='present'||!host_process.birth_token)fail('HOST_NOT_LIVE');
  const recovery=readRecoveryState(root,x.global);
  const began=Date.parse(attempt.started_at),events=readFileSync(safeFile(root,`.aidlc/host-runs/${x.grant.run_id}/${recovery?`attempts/${recovery.attempt_id}/`:''}lifecycle.jsonl`),'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));
  const start=events.find(e=>e.event==='host-start');
  if(!Number.isFinite(began)||began>Date.now()||Date.now()-began>60000||!start||start.run_id!==x.grant.run_id||start.thread_id!==x.binding.session_id||start.grant_digest!==x.global.execution_grant_ref!.digest||start.process_start?.pid!==pid||start.process_start.birth_token!==host_process.birth_token||events.some(e=>['turn-dispatch','host-exit','host-stop-request'].includes(e.event)))fail('FRESH_FIRST_START_REQUIRED');
  publish(root,x,{schema:'aidlc.attempt-repair-state/v1',revision:1,grant_ref:x.global.execution_grant_ref,batch_ref:x.global.autonomy_batch,host_process,started_at:new Date().toISOString(),requests:[]});
  return {kind:'print',attempt_repair:{schema:'aidlc.same-attempt-repair/v1',status:'started',execution_authorized:false,business_verified:false}};
 }
 if(args.length===1&&args[0]==='inspect')return {kind:'print',attempt_repair:inspectAttemptRepair(root)};
 if(args.length===9&&args[0]==='request'&&args[1]==='--kind'&&args[3]==='--unit'&&args[5]==='--failure'&&args[7]==='--reason')return {kind:'print',attempt_repair:requestAttemptRepair(root,args[2],args[4],args[6],args[8])};
 if(args.length===3&&args[0]==='apply'&&args[1]==='--expect')return {kind:'print',attempt_repair:applyAttemptRepair(root,args[2])};
 throw Error('use autonomy repair start --pid <owned-host>|inspect|request --kind <class> --unit <module/unit> --failure <raw-digest> --reason <diagnosis>|apply --expect <plan-digest>');
}
