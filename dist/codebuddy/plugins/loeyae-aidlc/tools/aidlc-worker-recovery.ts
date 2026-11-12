/** Trusted outer-worker ledger. Lifecycle receipts confer no stage permission. */
import {randomUUID} from 'node:crypto';
import {loadWorkflowState,sessionBinding} from './aidlc-light-state';
import {readRecoveryState,storeRecoveryState,withGrantControl,readIssuedGrant,auditRecoveryHistory} from './aidlc-grant-store';
import {autonomyDigest as digest,canonicalAutonomyJson as json} from './aidlc-autonomy-files';
import {recoveryAuthority,assertProcessesAbsent} from './aidlc-run-recovery';
type Row=Record<string,any>;type Identity=(pid:number)=>Row;
function own(identity:Identity){const p=identity(process.pid);if(p.status!=='present'||!p.birth_token)throw Error('WORKER_IDENTITY_UNKNOWN');return {pid:process.pid,birth_token:p.birth_token};}
function edit(root:string,token:string,identity:Identity,fn:(s:Row)=>void,live=true){return withGrantControl(root,()=>{
 const global=live?recoveryAuthority(root,false).global:loadWorkflowState(root)!;
 if(!global?.execution_grant_ref)throw Error('WORKER_GRANT_REQUIRED');
 const {grant}=readIssuedGrant(root,global.execution_grant_ref);
 if(json(JSON.parse(process.env.AIDLC_EXECUTION_GRANT||'null'))!==json(global.execution_grant_ref)||json(JSON.parse(process.env.AIDLC_AUTONOMY_HOST||'null'))!==json(grant.executor_constraints.host))throw Error('WORKER_AUTHORITY_CHANGED');
 const state=readRecoveryState(root,global),worker=state?.outer_worker;
 if(!worker||worker.token_digest!==digest(token)||json(worker.process)!==json(own(identity)))throw Error('WORKER_FENCED');
 if(live&&(state.status==='ended'||state.cancel_requested||worker.status==='ended'))throw Error('WORKER_RUN_ENDED');
 fn(state);return storeRecoveryState(root,global,state,state.revision);
});}
export function registerWorker(root:string,expected:number,identity:Identity,adapter:Row){
 const processRef=own(identity),token=randomUUID()+randomUUID();
 return withGrantControl(root,()=>{
   const {global,grant}=recoveryAuthority(root),prior=readRecoveryState(root,global);
   if((prior?.revision||0)!==expected)throw Error('WORKER_CAS_CONFLICT');
   if(typeof adapter.entrypoint!=='string'||!/^[a-f0-9]{64}$/.test(adapter.digest)||Object.keys(adapter).length!==2)throw Error('WORKER_ADAPTER_INVALID');
   const binding=sessionBinding();if(!binding||binding.session_id!==grant.executor_constraints.session_id||binding.owner!==grant.executor_constraints.owner)throw Error('WORKER_SESSION_CHANGED');
   if(!prior&&json(binding)!==json(grant.executor_constraints.initial_binding))throw Error('WORKER_INITIAL_BINDING_CHANGED');
   if(prior){
     auditRecoveryHistory(root,global);if(prior.status==='ended'||prior.cancel_requested)throw Error('WORKER_RUN_ENDED');
     if(!prior.outer_worker||json(prior.outer_worker.adapter)!==json(adapter))throw Error('WORKER_ADAPTER_CHANGED');
     if(prior.outer_worker.replacements>=(grant.successor_policy as any).max_restarts)throw Error('WORKER_RESTART_LIMIT');
     assertProcessesAbsent([prior.outer_worker.process,...(prior.outer_worker.permit?.child?[prior.outer_worker.permit.child]:[]),...Object.values(prior.outer_worker.resources),...(prior.host_process?[prior.host_process]:[]),...Object.values(prior.resources)] as Row[],identity);
   }
   const state=storeRecoveryState(root,global,{...(prior||{run_id:grant.run_id,generation:0,restarts:0,status:'awaiting-worker',operations:{},resources:{},supervisor:null,coordinator:grant.executor_constraints.initial_binding}),outer_worker:{process:processRef,token_digest:digest(token),adapter,status:'preparing',resources:{},epoch:(prior?.outer_worker?.epoch||0)+1,replacements:prior?(prior.outer_worker.replacements+1):0,permit:null}},expected);
   return {token,state};
 });
}
export function workerResource(root:string,token:string,identity:Identity,event:'intent'|'started'|'closed',id:string,kind?:string,processRef?:Row){
 if(!/^[a-f0-9-]{36}$/.test(id))throw Error('WORKER_RESOURCE_ID_INVALID');
 return edit(root,token,identity,s=>{
   const w=s.outer_worker,r=w.resources[id];
   if(event==='intent'){if(r||Object.keys(w.resources).length>=4096||!['service','reload'].includes(kind!))throw Error('WORKER_RESOURCE_INTENT_INVALID');w.resources[id]={id,kind,status:'spawn-intent'};}
   else if(event==='started'){if(!r||r.status!=='spawn-intent'||processRef?.status!=='present'||!processRef.birth_token||json(identity(processRef.pid))!==json(processRef))throw Error('WORKER_RESOURCE_IDENTITY_INVALID');w.resources[id]={...r,...processRef,status:'running'};}
   else {if(!r)throw Error('WORKER_RESOURCE_MISSING');if(r.pid)assertProcessesAbsent([r],identity);else if(r.kind!=='reload')throw Error('WORKER_SPAWN_UNRECONCILED');r.status='closed';}
 },event!=='closed');
}
export function workerReady(root:string,token:string,identity:Identity){return edit(root,token,identity,s=>{
 const w=s.outer_worker;if(w.status==='active'||w.status==='ended')throw Error('WORKER_PHASE_INVALID');
 if(!Object.values(w.resources).some((r:any)=>r.kind==='service'&&r.status==='running')||Object.values(w.resources).some((r:any)=>!['closed','running'].includes(r.status)))throw Error('WORKER_RESOURCE_UNRECONCILED');w.status='ready';
});}
export function issueWorkerPermit(root:string,token:string,identity:Identity,childPid:number,nonce:string){
 const permit=randomUUID()+randomUUID();let expected=0;
 edit(root,token,identity,s=>{const w=s.outer_worker;if(w.status!=='ready'||w.permit&&!w.permit.consumed)throw Error('WORKER_PERMIT_PENDING');
   if(!/^[a-f0-9-]{36}$/.test(nonce))throw Error('WORKER_NONCE_INVALID');const child=identity(childPid);if(child.status!=='present'||!child.birth_token)throw Error('WORKER_CHILD_UNKNOWN');
   const grant=recoveryAuthority(root).grant,deadline=Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000);
   w.permit={nonce,child:{pid:childPid,birth_token:child.birth_token},token_digest:digest(permit),expires_at:Math.min(deadline,Date.now()+10000),consumed:false};expected=s.revision+1;
 });return {permit,expected};
}
export function workerQuiesced(root:string,token:string,identity:Identity){return edit(root,token,identity,s=>{
 if(Object.values(s.outer_worker.resources).some((r:any)=>r.status!=='closed'))throw Error('WORKER_RESOURCE_UNRECONCILED');
 assertProcessesAbsent([...(s.host_process?[s.host_process]:[]),...(s.outer_worker.permit?.child?[s.outer_worker.permit.child]:[]),...Object.values(s.resources)] as Row[],identity);
 s.outer_worker.status='preparing';s.outer_worker.permit=null;s.outer_worker.epoch++;
},false);}
export function finishWorker(root:string,token:string,identity:Identity,cancel=false){return edit(root,token,identity,s=>{
 if(cancel)s.cancel_requested=true;
 if(!cancel&&Object.values(s.outer_worker.resources).some((r:any)=>r.status!=='closed'))throw Error('WORKER_RESOURCE_UNRECONCILED');
 if(!cancel)assertProcessesAbsent([...(s.host_process?[s.host_process]:[]),...(s.outer_worker.permit?.child?[s.outer_worker.permit.child]:[]),...Object.values(s.resources)] as Row[],identity);
 s.outer_worker.status='ended';s.status='ended';
},false);}
