/** Host lifecycle adapter; Core alone owns the durable lease and ledger. */
import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import K from './host-kernel.cjs';
import {requestWorkerPermit,acknowledgeWorker} from './host-worker-recovery.mjs';
export function loadRecoveryCore(c){
 const require=createRequire(c.core_cli),{require:load}=require('tsx/cjs/api');
 const candidates=[path.resolve(path.dirname(c.core_cli),'../core/tools/aidlc-run-recovery.ts'),path.resolve(path.dirname(c.core_cli),'../tools/aidlc-run-recovery.ts'),path.resolve(path.dirname(c.core_cli),'aidlc-run-recovery.ts')];
 const file=candidates.find(fs.existsSync);if(!file)throw Error('HOST_RECOVERY_CORE_UNAVAILABLE');
 return {api:load(file,c.core_cli),state:load(path.join(path.dirname(file),'aidlc-light-state.ts'),c.core_cli),grants:load(path.join(path.dirname(file),'aidlc-grant-store.ts'),c.core_cli)};
}
export async function openRecovery(c,root,file){
 const {api,state,grants}=loadRecoveryCore(c),global=state.loadWorkflowState(root);
 if(!global?.execution_grant_ref)return null;
 const grant=grants.readIssuedGrant(root,global.execution_grant_ref).grant;
 if(grant.successor_policy==='disabled')return null;
 if(K.canonical(grant.executor_constraints.host)!==K.canonical(K.identity(file)))throw Error('HOST_RECOVERY_CONFIG_CHANGED');
 const query=(op,deadline)=>{
   const q=c.commands.find(command=>command.id===op.action.id)?.recovery_query;
   if(!q||!grant.allowed_operations.includes('validation-execute'))throw Error('HOST_EXTERNAL_QUERY_NOT_AUTHORIZED');
   const remaining=deadline-Date.now();if(remaining<=0)throw Error('HOST_RECOVERY_EXPIRED');
   const request={schema:'aidlc.external-reconciliation-request/v1',operation_id:op.id,input_digest:op.input_digest};
   const result=spawnSync(q.argv[0],q.argv.slice(1),{cwd:root,env:K.businessEnv(process.env),input:JSON.stringify(request),encoding:'utf8',windowsHide:true,shell:false,timeout:Math.min(q.timeout_ms,remaining),maxBuffer:1048576});
   if(result.error||result.signal||result.status!==0)throw Error('HOST_EXTERNAL_QUERY_UNKNOWN');
   const observation=JSON.parse(result.stdout),label=`.aidlc/host-runs/${grant.run_id}/reconciliation/${op.id}-${randomUUID()}.json`,target=path.join(root,label);
   for(let p=target;p!==root;p=path.dirname(p)){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('HOST_LINKED_CONTROL_DIRECTORY');}
   fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,result.stdout,{flag:'wx',mode:0o600});
   return {...observation,raw_digest:K.hash(result.stdout),raw_ref:label,query_digest:K.hash(K.canonical(q))};
 };
 const outer=process.env.AIDLC_RESOURCE_OWNER?await requestWorkerPermit(root,grant,global.execution_grant_ref,c):null;
 const prior=api.inspectRecovery(root),lease=api.beginRecovery(root,outer?.expected??prior?.revision??0,K.processIdentity,K.supervisionLimits(c.supervision_limits),query,outer?.permit);
 if(outer)await acknowledgeWorker(lease,global.execution_grant_ref,Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000));
 const adapter={api,root,lease,deadline:Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000),
   attach(gateway){gateway.progress.restore(lease.state.supervisor);gateway.progress.onPersist=s=>api.persistSupervisor(root,s);gateway.recovery=adapter;},
   intent(kind){return api.resourceIntent(root,kind);},
   started(id,pid){api.resourceStarted(root,id,K.processIdentity(pid));},
   closed(id){api.resourceClosed(root,id);},
   async operation(action,execute){const id=api.reserveOperation(root,action);let result;try{result=await execute(id);}catch(e){api.finishOperation(root,id,e.core_reconciled===true?'failed':'unknown');throw e;}api.finishOperation(root,id,result?.reconciled===false?'unknown':'committed');return result;},
   end(reason){api.finishRecovery(root,reason);}
 };
 return adapter;
}
export function recoverableTransport(reason,budgetReason,resourcesReconciled){
 return resourcesReconciled===true&&/HOST_(?:DISCONNECTED|RPC_TIMEOUT|TURN_CANCEL_UNRECONCILED)/.test(String(reason))&&!['user-cancelled','wall-time','step-limit','turn-limit','no-progress-step-limit','no-semantic-progress','repeated-action','step-time','turn-time'].includes(budgetReason);
}
export async function supervise(c,root,file,thread){
 const {api,state,grants}=loadRecoveryCore(c),global=state.loadWorkflowState(root);
 if(!global?.execution_grant_ref)throw Error('HOST_RECOVERY_GRANT_REQUIRED');
 const {grant,revoked}=grants.readIssuedGrant(root,global.execution_grant_ref);
 if(revoked||grant.successor_policy==='disabled'||thread!==grant.executor_constraints.session_id)throw Error('HOST_SUCCESSOR_NOT_AUTHORIZED');
 const deadline=Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000),attempts=[];
 let cancellationError;
 const abort=new AbortController(),cancel=()=>{try{api.cancelRunFromSupervisor(root,K.processIdentity);}catch(error){cancellationError=String(error);}finally{abort.abort();}};process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 try{for(let n=0;n<=grant.successor_policy.max_restarts;n++){
   if(abort.signal.aborted||Date.now()>=deadline)break;
   const before=api.inspectRecovery(root);if(before?.status==='ended')break;
   const result=await K.command([process.execPath,K.identity(file).entrypoint,'run',file,thread],{cwd:root,env:process.env,signal:abort.signal,timeout_ms:deadline-Date.now(),max_output_bytes:1048576});
   attempts.push({exit_code:result.exit_code,status:result.status,reconciled:result.reconciled});
   // A failed recovery preflight is not a reason to launch the same attempt again.
   const after=api.inspectRecovery(root);
   if(!result.reconciled||abort.signal.aborted||after?.status==='ended'||after?.revision===before?.revision||!after)break;
 }}finally{process.off('SIGINT',cancel);process.off('SIGTERM',cancel);}
 if(cancellationError){try{api.cancelRunFromSupervisor(root,K.processIdentity);cancellationError=undefined;}catch(error){cancellationError=String(error);}}
 const current=api.inspectRecovery(root);return {schema:'aidlc.supervision-recovery/v1',run_id:grant.run_id,attempts,status:current?.status||'not-started',business_verified:false,original_deadline:deadline,...(cancellationError?{cancellation_unreconciled:cancellationError}:{})};
}
