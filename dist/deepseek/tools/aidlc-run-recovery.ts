/** Trusted host API. No model JSON/CLI endpoint issues a successor or a credential. */
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {loadWorkflowState,sessionBinding,bindingFor,type SessionBinding} from './aidlc-light-state';
import {loadWorkflowParts} from './aidlc-workflow-layout';
import {bindSession,claimToken,sessionRef} from './aidlc-session';
import {readIssuedGrant,readRecoveryState,storeRecoveryState,withGrantControl,validateGrantInputs,assertRecoveryExecutor,auditRecoveryHistory} from './aidlc-grant-store';
import {autonomyDigest as digest,canonicalAutonomyJson as json,safeFile} from './aidlc-autonomy-files';
type Row=Record<string,any>;
export function recoveryAuthority(root:string,frozenInputs=true){
 const global=loadWorkflowState(root);if(!global?.execution_grant_ref)throw Error('RECOVERY_GRANT_REQUIRED');
 const {grant,revoked}=readIssuedGrant(root,global.execution_grant_ref),now=Date.now();
 if(revoked||now<Date.parse(grant.issued_at)||now>=Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000))throw Error('RECOVERY_GRANT_INACTIVE');
 if(grant.successor_policy==='disabled')throw Error('RECOVERY_DISABLED');
 if(json(JSON.parse(process.env.AIDLC_AUTONOMY_HOST||'null'))!==json(grant.executor_constraints.host)||json(JSON.parse(process.env.AIDLC_EXECUTION_GRANT||'null'))!==json(global.execution_grant_ref))throw Error('RECOVERY_HOST_OR_GRANT_CHANGED');
 if(global.autonomy_batch?.scope_digest!==grant.baseline_digest||global.status==='parked')throw Error('RECOVERY_BASELINE_CHANGED');
 if(frozenInputs)validateGrantInputs(root,grant.inputs);return {global,grant};
}
const authority=recoveryAuthority;
export function assertProcessesAbsent(refs:Row[],identity:(pid:number)=>Row){
 for(const ref of refs){if(ref.status==='closed')continue;if(!ref.pid||!ref.birth_token)throw Error('RECOVERY_SPAWN_UNRECONCILED');const actual=identity(ref.pid);
 if(actual.status!=='absent'&&!(actual.status==='present'&&actual.birth_token&&actual.birth_token!==ref.birth_token))throw Error('RECOVERY_OLD_EXECUTOR_NOT_ABSENT');}
}
export function inspectRecovery(root:string){const global=loadWorkflowState(root);return global?readRecoveryState(root,global):undefined;}
// Ledger publication grants no business operation. Existing Gateway/Core gates
// still verify frozen inputs at dispatch/publication; do not repeat that producer
// work for each budget increment, PID observation and acknowledgement.
function update(root:string,edit:(s:Row)=>void){return withGrantControl(root,()=>{const {global}=authority(root,false);const s=assertRecoveryExecutor(root,global);if(!s)throw Error('RECOVERY_NOT_STARTED');const before=json(s);edit(s);return before===json(s)?s:storeRecoveryState(root,global,s,s.revision);});}
export function reserveOperation(root:string,action:Row):string {
 const id=randomUUID();update(root,s=>{
   if(s.cancel_requested)throw Error('RECOVERY_CANCELLED');
   if(Object.keys(s.operations).length>=4096)throw Error('RECOVERY_OPERATION_LIMIT');
   const binding=sessionBinding();if(!binding)throw Error('RECOVERY_BINDING_REQUIRED');
   s.operations[id]={id,attempt:s.attempt_id,status:'reserved',action,binding,input_digest:digest(action),operation_ref:digest([s.run_id,id,action,binding])};
 });return id;
}
export function finishOperation(root:string,id:string,status:'committed'|'failed'|'unknown'){
 return update(root,s=>{const op=s.operations[id];if(!op||op.attempt!==s.attempt_id||op.status!=='reserved')throw Error('RECOVERY_OPERATION_CHANGED');op.status=status;});
}
export function operationReceipt(root:string,args:string[]):string|undefined {
 const id=process.env.AIDLC_OPERATION_ID;if(!id)return undefined;
 const {global}=authority(root);assertRecoveryExecutor(root,global);const s=readRecoveryState(root,global),op=s?.operations[id];
 if(!op||op.attempt!==s.attempt_id||op.status!=='reserved'||json(op.action)!==json({kind:'core',args:['orchestrate','report',...args]})||json(op.binding)!==json(sessionBinding()))throw Error('RECOVERY_REPORT_IDENTITY_CHANGED');
 return op.operation_ref;
}
/** Read-only idempotent acknowledgement, checked before a completed claim is
 * required again. It cannot re-run a gate, create evidence or complete a batch. */
export function committedReport(root:string,args:string[]):Row|undefined {
 const id=process.env.AIDLC_OPERATION_ID;if(!id)return;
 const {global}=authority(root);assertRecoveryExecutor(root,global);const s=readRecoveryState(root,global),op=s?.operations[id];
 if(!op||json(op.action)!==json({kind:'core',args:['orchestrate','report',...args]}))throw Error('RECOVERY_REPORT_IDENTITY_CHANGED');
 const binding=sessionBinding();if(!binding||binding.session_id!==op.binding.session_id||binding.owner!==op.binding.owner)throw Error('RECOVERY_REPORT_OWNER_CHANGED');
 const entry=[...loadWorkflowParts(root).parts.values()].find(p=>p.state.workflow_id===op.binding.workflow_id)?.state.history.find(h=>h.operation_ref===op.operation_ref&&h.instance_id===op.binding.stage_instance);
 if(!entry)return;
 return {kind:'print',message:'The exact report was already committed; read the current Core directive.',operation_reconciliation:{status:'committed',operation_id:id,stage_instance:entry.instance_id,result:entry.result},execution_authorized:false,business_verified:false};
}
export function persistSupervisor(root:string,snapshot:Row){return update(root,s=>{
 if(!Number.isSafeInteger(snapshot.steps)||!Number.isSafeInteger(snapshot.turns)||snapshot.steps<(s.supervisor?.steps||0)||snapshot.turns<(s.supervisor?.turns||0))throw Error('RECOVERY_BUDGET_ROLLBACK');
 s.supervisor=snapshot;
});}
export function resourceIntent(root:string,kind:string){const id=randomUUID();update(root,s=>{s.resources[id]={id,kind,status:'spawn-intent'};});return id;}
export function resourceStarted(root:string,id:string,processRef:Row){return update(root,s=>{if(!s.resources[id]||processRef.status!=='present'||!processRef.birth_token)throw Error('RECOVERY_RESOURCE_IDENTITY_REQUIRED');s.resources[id]={...s.resources[id],...processRef,status:'running'};});}
export function resourceClosed(root:string,id:string){return update(root,s=>{if(!s.resources[id])throw Error('RECOVERY_RESOURCE_MISSING');s.resources[id].status='closed';});}
export function finishRecovery(root:string,reason:string){return update(root,s=>{s.status='ended';s.end_reason=reason;});}
export function cancelRecovery(root:string){return update(root,s=>{s.cancel_requested=true;});}
/** Parent cancellation is a one-way downgrade, even if an abrupt OS termination
 * prevents the child from receiving SIGTERM. It never issues an executor token. */
export function cancelRunFromSupervisor(root:string,identity:(pid:number)=>Row){return withGrantControl(root,()=>{
 const {global,grant}=authority(root,false),prior=readRecoveryState(root,global),actual=identity(process.pid);
 if(actual.status!=='present'||!actual.birth_token||prior&&(prior.supervisor_process?.pid!==process.pid||prior.supervisor_process.birth_token!==actual.birth_token))throw Error('RECOVERY_SUPERVISOR_IDENTITY_CHANGED');
 const state=prior||{run_id:grant.run_id,attempt_id:null,generation:0,restarts:0,status:'ended',operations:{},resources:{},supervisor:null};
 return storeRecoveryState(root,global,{...state,cancel_requested:true},prior?.revision||0);
});}
export function interruptRecovery(root:string,snapshot:Row){return update(root,s=>{
 if(snapshot.steps<(s.supervisor?.steps||0)||snapshot.turns<(s.supervisor?.turns||0))throw Error('RECOVERY_BUDGET_ROLLBACK');
 s.supervisor={...snapshot,stopped:null};s.status='interrupted';s.end_reason='native-transport-interrupted';
});}
/** A successor reuses the approved native session. New claims still get fresh
 * generation tokens. The old host AND every recorded child must be absent. */
export function beginRecovery(root:string,expected:number,identity:(pid:number)=>Row,limits:Row,query?:(op:Row,deadline:number)=>Row,workerPermit?:string){
 const owner=identity(process.pid),supervisor=identity(process.ppid);if(owner.status!=='present'||!owner.birth_token||supervisor.status!=='present'||!supervisor.birth_token)throw Error('RECOVERY_OWNER_UNKNOWN');
 const token=randomUUID()+randomUUID();
 let state=withGrantControl(root,()=>{
   const {global,grant}=authority(root),prior=readRecoveryState(root,global);
   if((prior?.revision||0)!==expected)throw Error('RECOVERY_CAS_CONFLICT');
   if(prior){
     auditRecoveryHistory(root,global);
     if(prior.status==='ended'||prior.cancel_requested)throw Error('RECOVERY_RUN_ENDED');
     if(Date.now()<Date.parse(prior.recorded_at))throw Error('RECOVERY_CLOCK_ROLLBACK');
     if(prior.generation&&json(prior.limits)!==json(limits))throw Error('RECOVERY_LIMITS_CHANGED');
     if(prior.generation&&prior.restarts>= (grant.successor_policy as Exclude<typeof grant.successor_policy,string>).max_restarts)throw Error('RECOVERY_RESTART_LIMIT');
     const outer=prior.outer_worker;
     if(outer){
       const permit=outer.permit;
       if(!workerPermit||outer.status!=='ready'||permit?.token_digest!==digest(workerPermit)||permit.child.pid!==process.pid||permit.child.birth_token!==owner.birth_token||outer.process.pid!==process.ppid||outer.process.birth_token!==supervisor.birth_token||Date.now()>=permit.expires_at||permit.consumed)throw Error('RECOVERY_WORKER_PERMIT_INVALID');
       if(!Object.values(outer.resources).some((r:any)=>r.kind==='service'&&r.status==='running')||Object.values(outer.resources).some((r:any)=>!['running','closed'].includes(r.status)))throw Error('RECOVERY_WORKER_RESOURCES_UNKNOWN');
       for(const resource of Object.values(outer.resources) as Row[])if(resource.status==='running'){const actual=identity(resource.pid);if(actual.status!=='present'||actual.birth_token!==resource.birth_token)throw Error('RECOVERY_WORKER_RESOURCE_CHANGED');}
       permit.consumed=true;outer.status='active';
     }else if(workerPermit||process.env.AIDLC_RESOURCE_OWNER)throw Error('RECOVERY_WORKER_NOT_REGISTERED');
     for(const processRef of [...(prior.host_process?[prior.host_process]:[]),...Object.values(prior.resources)] as Row[]){
       if(processRef.status==='closed')continue;
       if(!processRef.pid||!processRef.birth_token)throw Error('RECOVERY_SPAWN_UNRECONCILED');
       const actual=identity(processRef.pid);
       if(actual.status==='unknown'||actual.status==='present'&&actual.birth_token===processRef.birth_token)throw Error('RECOVERY_OLD_EXECUTOR_NOT_ABSENT');
       if(actual.status!=='absent'&&!(actual.status==='present'&&actual.birth_token&&actual.birth_token!==processRef.birth_token))throw Error('RECOVERY_RESOURCE_UNKNOWN');
     }
     const parts=[...loadWorkflowParts(root).parts.values()];
     for(const op of Object.values(prior.operations) as Row[]){
       if(op.status!=='reserved'&&op.status!=='unknown')continue;
       const a=op.action;
       if(a.kind==='core'&&a.args?.[1]==='report'){
         const committed=parts.some(p=>p.state.workflow_id===op.binding.workflow_id&&p.state.history.some(h=>h.operation_ref===op.operation_ref&&h.instance_id===op.binding.stage_instance));
         if(!committed)throw Error('RECOVERY_REPORT_UNCOMMITTED');op.status='committed';
       }else if(a.kind==='write'){
         if(!existsSync(safeFile(root,a.path))||digest(readFileSync(safeFile(root,a.path),'utf8'))!==a.content_digest)throw Error('RECOVERY_WRITE_UNCERTAIN');op.status='committed';
       }else if(a.kind==='read'||a.kind==='core'&&readOnlyCore(a.args)){op.status='not-replayed';}
       else if(a.kind==='command'&&query){
         const observation=query(op,Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000));
         if(observation.schema!=='aidlc.external-reconciliation/v1'||observation.operation_id!==op.id||observation.input_digest!==op.input_digest||!['succeeded','failed','not-executed'].includes(observation.status)||!/^[a-f0-9]{64}$/.test(observation.raw_digest))throw Error('RECOVERY_EXTERNAL_OPERATION_UNKNOWN');
         if(typeof observation.raw_ref!=='string'||!observation.raw_ref.startsWith(`.aidlc/host-runs/${grant.run_id}/reconciliation/`)||createHash('sha256').update(readFileSync(safeFile(root,observation.raw_ref))).digest('hex')!==observation.raw_digest)throw Error('RECOVERY_EXTERNAL_QUERY_EVIDENCE_CHANGED');
         const raw=JSON.parse(readFileSync(safeFile(root,observation.raw_ref),'utf8'));if(['schema','operation_id','input_digest','status'].some(key=>raw[key]!==observation[key]))throw Error('RECOVERY_EXTERNAL_QUERY_EVIDENCE_CHANGED');
         op.status=observation.status==='succeeded'?'committed':'not-replayed';op.reconciliation=observation;
       }else throw Error('RECOVERY_EXTERNAL_OPERATION_UNKNOWN');
     }
   }
   const initial=grant.executor_constraints.initial_binding;
   if(!prior&&json(sessionBinding())!==json(initial))throw Error('RECOVERY_INITIAL_BINDING_CHANGED');
   if(!prior&&(workerPermit||process.env.AIDLC_RESOURCE_OWNER))throw Error('RECOVERY_WORKER_NOT_REGISTERED');
   return storeRecoveryState(root,global,{...prior,run_id:grant.run_id,status:'preparing',attempt_id:randomUUID(),generation:(prior?.generation||0)+1,restarts:prior?.generation?prior.restarts+1:0,token_digest:digest(token),host_process:{pid:process.pid,birth_token:owner.birth_token},supervisor_process:{pid:process.ppid,birth_token:supervisor.birth_token},resources:{},operations:prior?.operations||{},supervisor:prior?.supervisor||null,limits,coordinator:initial},expected);
 });
 // Fencing was committed before any claim change. A partial renewal never yields
 // an active lease; a later, bounded successor can reconcile the current claims.
 const {global,grant}=authority(root);const bindings:SessionBinding[]=[];
 for(const part of loadWorkflowParts(root).parts.values())for(const claim of Object.values(part.state.active_instances)){
   if(claim.session_id!==grant.executor_constraints.session_id||claim.owner!==grant.executor_constraints.owner)continue;
   if(!grant.workflow_refs.some(w=>w.workflow_id===part.state.workflow_id))continue;
   authority(root);const old=bindingFor(root,part.state,claim);process.env.AIDLC_SESSION_BINDING=JSON.stringify(old);
   bindings.push(bindSession(root,{instance:claim.stage_instance,owner:claim.owner,session:claim.session_id!,expected:claimToken(claim),rotateGeneration:true}).binding);
 }
 const stage=state.coordinator.stage_instance;let coordinator=bindings.find(b=>b.stage_instance===stage);
 if(!coordinator){const current=loadWorkflowState(root,sessionRef(root,stage))!;if(current.active_instances[stage])throw Error('RECOVERY_COORDINATOR_OWNERSHIP_CHANGED');coordinator=bindSession(root,{instance:stage,owner:grant.executor_constraints.owner,session:grant.executor_constraints.session_id,expected:claimToken(undefined)}).binding;}
 state=withGrantControl(root,()=>{authority(root);const latest=readRecoveryState(root,global);if(latest?.revision!==state.revision||latest.attempt_id!==state.attempt_id)throw Error('RECOVERY_CAS_CONFLICT');return storeRecoveryState(root,global,{...state,status:'active',coordinator},state.revision);});
 process.env.AIDLC_ATTEMPT_TOKEN=token;process.env.AIDLC_SESSION_BINDING=process.env.AIDLC_COORDINATOR_BINDING=JSON.stringify(coordinator);
 return {state,token,coordinator};
}
export function readOnlyCore(args:string[]):boolean {
 return args[0]==='orchestrate'&&(args[1]==='next'&&args.includes('--preview')||args[1]==='autonomy'&&(['host','grant','batch','run','repair','admission'].includes(args[2])&&['context','check','inspect','prepare'].includes(args[3])));
}
