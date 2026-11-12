import {requireIntegrationGo} from './integration-review-gate.mjs';
/** Private worker Supervisor. P2 successors retain the original grant, budget and native session. */
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {readFileSync,appendFileSync,existsSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
import {repository,evaluation,put,git,startService,stopService} from './prepare-pilots';
import {bindExecutionGrant} from '../../../../core/tools/aidlc-execution-grant';
import {readIssuedGrant} from '../../../../core/tools/aidlc-grant-store';
import {loadWorkflowState,assertSessionClaim} from '../../../../core/tools/aidlc-light-state';
import {releaseSession,claimToken,sessionRef} from '../../../../core/tools/aidlc-session';
import {projectBatchResult} from '../../../../core/tools/aidlc-batch-result';import {OwnedReload} from './owned-reload';
import {createWorkerRecovery} from '../../../../harness/codex/runtime/host-worker-recovery.mjs';
import {loadRecoveryCore} from '../../../../harness/codex/runtime/host-recovery.mjs';
import {assertProcessesAbsent} from '../../../../core/tools/aidlc-run-recovery';
const K=createRequire(import.meta.url)(join(repository,'harness/codex/runtime/host-kernel.cjs')),R=K.resources;
const authority=['AIDLC_SESSION_BINDING','AIDLC_EXECUTION_GRANT','AIDLC_AUTONOMY_HOST','AIDLC_COORDINATOR_BINDING','AIDLC_ATTEMPT_TOKEN'];
function withAuthority<T>(env:NodeJS.ProcessEnv,fn:()=>T):T{const old=Object.fromEntries(authority.map(k=>[k,process.env[k]]));try{for(const k of authority){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}return fn();}finally{for(const k of authority){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}}
/** Synchronous read-only projection uses the exact pilot's observation context.
 * Two project runs share this worker; never persist or broadly copy business env. */
export function withWorkerProjectionEnvironment<T>(env:NodeJS.ProcessEnv,fn:()=>T):T{
  const prior=process.env.PILOT_ORIGIN;
  try{if(env.PILOT_ORIGIN===undefined)delete process.env.PILOT_ORIGIN;else process.env.PILOT_ORIGIN=env.PILOT_ORIGIN;return withAuthority(env,fn);}
  finally{if(prior===undefined)delete process.env.PILOT_ORIGIN;else process.env.PILOT_ORIGIN=prior;}
}
function runtimeForWorker(overrides:any={}){
  const runtime={repository,evaluation,requireGo:requireIntegrationGo,startService,stopService,git,businessEnv:K.businessEnv,processIdentity:K.processIdentity,
    spawnNative:(c:any)=>spawn(process.execPath,[join(repository,'harness/codex/runtime/aidlc-codex-host.mjs'),'run',join(c.root,'pilot/host.json'),c.h4.thread_id],{cwd:c.root,env:c.env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe','ipc']}),...overrides};
  return {...runtime,limits:R.resourceLimits(overrides.limits)};
}
export async function launchAuthorizedWorker(contexts:any[],options:{outputBase?:string;workerEntry?:string;limits?:any;replacement?:number}={}){
  const limits=R.resourceLimits(options.limits),output=join(options.outputBase||evaluation,'operator-supervision-'+Date.now());mkdirSync(output);
  const log=(event:any)=>appendFileSync(join(output,'parent.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n');
  const stdout=openSync(join(output,'worker.stdout.log'),'wx'),stderr=openSync(join(output,'worker.stderr.log'),'wx');let child:any;
  try{child=spawn(process.execPath,['--import','tsx',options.workerEntry||join(evaluation,'pilot-worker.ts'),'--worker'],{cwd:repository,env:K.businessEnv(process.env),detached:true,windowsHide:true,stdio:['ignore',stdout,stderr,'ipc']});}finally{closeSync(stdout);closeSync(stderr);}
  const resource=R.ownChild(child,{kind:'worker',owner:'authorization-parent',tree:true,limits,log}),handoffId=randomUUID();let committed=false,initializedSent=false,startedAck=false,failed=false;
  const payload=contexts.map(c=>({key:c.key,root:c.root,directory:c.directory,output:c.output,h4:c.h4,request:c.request,binding:c.binding,environment:Object.fromEntries(authority.map(k=>[k,c.env[k]]))}));
  log({event:'worker-spawned',pid:child.pid||null,process_start:Number.isSafeInteger(child.pid)?K.processIdentity(child.pid):null,detached:true,private_ipc_persisted:false});
  await new Promise<void>((resolveReady,reject)=>{
    const fail=(error:Error)=>{if(failed||startedAck)return;failed=true;clearTimeout(timer);log({event:'handoff-failed',ownership_transferred:committed,private_context_dispatched:initializedSent,reason:String(error)});
      if(initializedSent&&child.connected)try{child.send({kind:'abort',handoff_id:handoffId},()=>{});}catch{}
      void resource.close().then((result:any)=>{log({event:'worker-abort-reconciliation',reconciled:result.reconciled});reject(Object.assign(error,{resource_reconciliation:{reconciled:result.reconciled,resources:[result]}}));});};
    const timer=setTimeout(()=>fail(Error('WORKER_HANDOFF_TIMEOUT')),limits.ipc_ms);
    child.once('error',fail);child.once('close',(code:number,signal:string)=>{log({event:'worker-process-close',exit_code:code,signal});if(!startedAck)fail(Error('WORKER_EXIT_BEFORE_START_ACK: '+code+'/'+signal));else void restartWorker().catch(error=>log({event:'worker-replacement-refused',reason:String(error)}));});
    async function restartWorker(){
      const eligible=[];
      for(const c of contexts){
        const global=loadWorkflowState(c.root);if(!global?.execution_grant_ref)continue;
        const {grant,revoked}=readIssuedGrant(c.root,global.execution_grant_ref),policy=grant.successor_policy;
        if(policy==='disabled'||revoked||Date.now()>=Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000)||(options.replacement||0)>=policy.max_restarts||existsSync(join(c.output,'result.json')))continue;
        const config=K.config(join(c.root,'pilot/host.json')),state=loadRecoveryCore(config).api.inspectRecovery(c.root);
        if(!state?.outer_worker||state.status==='ended'||state.cancel_requested||state.outer_worker.replacements>=policy.max_restarts)continue;
        assert.ok(K.canonical(K.identity(join(c.root,'pilot/host.json')))===K.canonical(grant.executor_constraints.host),'WORKER_HOST_CHANGED');
        assertProcessesAbsent([state.outer_worker.process,...(state.outer_worker.permit?.child?[state.outer_worker.permit.child]:[]),...Object.values(state.outer_worker.resources),...(state.host_process?[state.host_process]:[]),...Object.values(state.resources)] as any[],K.processIdentity);
        const nextOutput=join(c.directory,'successor-'+randomUUID());mkdirSync(nextOutput);eligible.push({...c,output:nextOutput});
      }
      if(!eligible.length)return;
      log({event:'worker-replacement-dispatch',run_ids:eligible.map(c=>c.request.run_id),original_authority:true});
      await launchAuthorizedWorker(eligible,{...options,replacement:(options.replacement||0)+1});
    }
    child.on('message',(message:any)=>{
      if(failed)return;
      if(message?.kind==='boot-ready'&&!initializedSent){initializedSent=true;for(const c of contexts)c.handoffUncertain=true;child.send({kind:'initialize',handoff_id:handoffId,output,contexts:payload},(error:Error|null)=>{if(error)fail(error);});return;}
      if(message?.handoff_id!==handoffId)return;
      if(message.kind==='ready'&&!committed){committed=true;for(const c of contexts){c.handedOff=true;c.handoffUncertain=false;}log({event:'live-credentials-handoff-accepted',worker_pid:child.pid,run_ids:contexts.map(c=>c.request.run_id),first_dispatch_only:true});child.send({kind:'start',handoff_id:handoffId},(error:Error|null)=>{if(error)fail(error);});}
      if(message.kind==='started'&&committed&&!startedAck){startedAck=true;clearTimeout(timer);log({event:'independent-execution-started',worker_pid:child.pid});if(!contexts.some(c=>c.request.successor_policy&&c.request.successor_policy!=='disabled'))child.unref();resolveReady();}
    });
  });
  return {output,worker_pid:child.pid,detached:true,private_ipc_persisted:false};
}
function acceptCleanup(c:any,message:any){
  assert.ok(message.schema==='aidlc.cleanup-delegation/v1'&&message.run_id===c.request.run_id&&message.thread_id===c.h4.thread_id&&message.grant_digest===c.grantRef.digest,'INVALID_CLEANUP_IDENTITY');
  assert.ok(Array.isArray(message.private_bindings)&&message.private_bindings.length>0&&message.private_bindings.length<=2,'INVALID_CLEANUP_BINDINGS');
  for(const binding of message.private_bindings)assert.ok(binding&&binding.session_id===c.h4.thread_id&&binding.owner===c.grant.executor_constraints.owner&&c.grant.workflow_refs.some((w:any)=>w.workflow_id===binding.workflow_id),'INVALID_CLEANUP_SCOPE');
  assert.ok(!c.cleanupBindings,'DUPLICATE_CLEANUP_DELEGATION');c.cleanupBindings=message.private_bindings;
}
function releaseDelegated(c:any){
  const released:string[]=[],failures:any[]=[],seen=new Set();
  for(const binding of c.cleanupBindings||[]){const key=binding.workflow_id+'/'+binding.stage_instance;if(seen.has(key))continue;seen.add(key);
    try{withAuthority({...c.env,AIDLC_SESSION_BINDING:JSON.stringify(binding)},()=>{
      const state=loadWorkflowState(c.root,sessionRef(c.root,binding.stage_instance))!;const claim=state.active_instances[binding.stage_instance];if(!claim)return;
      assertSessionClaim(c.root,state,binding.stage_instance,binding);releaseSession(c.root,binding.stage_instance,claimToken(claim));released.push(binding.stage_instance);
    });}catch{failures.push({stage_instance:binding.stage_instance,error:'EXACT_CLAIM_RELEASE_REFUSED'});}
  }
  return {released,failures,reconciled:!!c.cleanupBindings&&failures.length===0};
}
async function closeService(c:any,r:any){
  if(!c.service)return {reconciled:true};try{const result=await r.stopService(c.service.child);if(!result.reconciled)throw Object.assign(Error('SERVICE_CLOSE_UNKNOWN'),{resource_reconciliation:result});c.serviceClosed=true;c.log({event:'owned-service-close',pid:c.service.child.pid,reconciled:result.reconciled});return result;}
  catch(error:any){const facts=error.resource_reconciliation||{reconciled:false,resources:[{kind:'service',owner:c.request.run_id,status:'unknown'}]};c.resourceIssues.push(facts);c.log({event:'owned-service-unknown',pid:c.service.child.pid});return facts;}
}
async function runAttempt(c:any,r:any){
  const reload=new OwnedReload(c,r);let native:any,nativeResult:any,runtime:any,code:number|null=null,timer:any,deadlineTimer:any,verified=false;
  try{
    c.started=true;c.log({event:'native-run-starting',run_id:c.request.run_id,thread_id:c.h4.thread_id});
    const child=r.spawnNative(c);native=R.ownChild(child,{kind:'native',owner:c.request.run_id,tree:true,limits:r.limits,deadline_at:c.deadline,log:c.log});
    c.closeNative=()=>void native.close();
    child.once('spawn',()=>c.log({event:'native-host-process-start',pid:child.pid,process_start:r.processIdentity(child.pid)}));
    child.stdout?.on('data',(b:any)=>appendFileSync(join(c.output,'runtime.stdout.log'),b));child.stderr?.on('data',(b:any)=>appendFileSync(join(c.output,'runtime.stderr.log'),b));
    deadlineTimer=setTimeout(()=>{c.stop_reason='original-deadline';void native.close();},Math.max(1,c.deadline-Date.now()));
    child.on('message',(message:any)=>{
      try{if(c.recovery?.handle(child,message))return;if(message?.kind!=='cleanup-delegation')return;acceptCleanup(c,message);clearTimeout(deadlineTimer);deadlineTimer=setTimeout(()=>{c.stop_reason='cleanup-exit-deadline';void native.close();},r.limits.ipc_ms);child.send({kind:'cleanup-accepted',run_id:c.request.run_id,grant_digest:c.grantRef.digest},(error:Error|null)=>{if(error)c.resourceIssues.push({reconciled:false,resources:[{kind:'cleanup-ipc',status:'unknown',owner:c.request.run_id}]});});}
      catch{c.resourceIssues.push({reconciled:false,resources:[{kind:'cleanup-delegation',status:'unknown',owner:c.request.run_id}]});void native.close();}
    });
    timer=setInterval(()=>{if(c.recovery&&!c.recoveryReady)return;void reload.tick().then(()=>{if(c.resourceIssues.length)void native.close();}).catch(()=>{c.resourceIssues.push({reconciled:false,resources:[{kind:'reload',status:'unknown',owner:c.request.run_id}]});void native.close();});},100);
    await native.wait(R.deadlineAfter(Math.max(0,c.deadline-Date.now())+r.limits.ipc_ms));nativeResult=await native.close();code=nativeResult.exit_code;
    c.log({event:'native-host-process-close',pid:child.pid,exit_code:code,reconciled:nativeResult.reconciled});
    const lease=c.recovery?.state(),exitPath=join(c.root,'.aidlc/host-runs',c.request.run_id,...(lease?.attempt_id?['attempts',lease.attempt_id]:[]),'exit.json');runtime=existsSync(exitPath)?JSON.parse(readFileSync(exitPath,'utf8')):null;
    if(runtime)assert.ok(runtime.run_id===c.request.run_id&&runtime.thread_id===c.h4.thread_id,'NATIVE_EXIT_IDENTITY_CHANGED');
  }catch(error:any){c.resourceIssues.push(error.resource_reconciliation||{reconciled:false,resources:[{kind:'native',owner:c.request.run_id,status:'unknown',reason:'NATIVE_RUN_FAILED'}]});}
  finally{
    clearInterval(timer);clearTimeout(deadlineTimer);const reloadResult=await reload.close();if(!reloadResult.reconciled)c.resourceIssues.push(reloadResult);
    await closeService(c,r);if(native)nativeResult=await native.close();
  }
  const resourcesKnown=nativeResult?.reconciled===true&&c.resourceIssues.length===0&&runtime?.resource_reconciliation?.reconciled!==false&&runtime?.native_process_reconciled===true&&runtime?.native_turn_reconciled===true&&runtime?.operations_reconciled===true;
  let claims={released:[],failures:[{error:'UNRECONCILED_RESOURCES_OR_MISSING_CLEANUP_DELEGATION'}],reconciled:false} as any,coreResult:any=null,projectionError=false;
  if(resourcesKnown&&c.cleanupBindings&&runtime?.cleanup_delegated===true){
    try{const binding=c.cleanupBindings.find((b:any)=>b.stage_instance===c.grant.executor_constraints.initial_binding.stage_instance)||c.cleanupBindings[0];coreResult=withWorkerProjectionEnvironment({...c.env,AIDLC_SESSION_BINDING:JSON.stringify(binding)},()=>projectBatchResult(c.root));}catch{projectionError=true;}
    claims=releaseDelegated(c);verified=code===0&&runtime.candidate_business_verified===true&&coreResult?.engineering_result==='verified'&&coreResult.batch_completed===true&&claims.reconciled;
  }
  c.log({event:'native-run-ended',exit_code:code,engineering_result:runtime?.engineering_result||'interrupted-unreconciled',business_verified:verified,resources_reconciled:!!resourcesKnown,claims_reconciled:claims.reconciled});
  const result={kind:'actual-operator-native-run',exit_code:code,runtime,classification:verified?'verified':resourcesKnown?(runtime?.engineering_result||'incomplete'):'interrupted-unreconciled',resource_reconciliation:{reconciled:!!resourcesKnown,resources:[nativeResult,...c.resourceIssues]},claim_cleanup:claims,core_result_ref:coreResult?.result_ref||null,core_result_projection:{current_status:coreResult?.current_status||'unknown',current_blockers:coreResult?.current_blockers||[],projection_error:projectionError},lifecycle_observation:K.inspectRun(c.root,c.request.run_id,undefined,c.recovery?.state()?.attempt_id),business_verified:verified};
  return {verified,result,runtime,nativeResult};
}
/** Outer resources are registered before effects, and closed only after actual exit. */
function recoveryRuntime(c:any,r:any){
  if(!c.recovery)return r;
  const resources=new Map<any,string>();
  return {...r,
    async startService(root:string,env:any,options:any={}){
      const id=c.recovery.intent('service');let child:any;
      try{return await r.startService(root,env,{...options,onSpawn:(value:any)=>{child=value;resources.set(value,id);c.recovery.started(id,value.pid);},onClosed:()=>{if(child)c.recovery.closed(id);}});}
      catch(error){throw error;}
    },
    async stopService(child:any,options:any={}){const result=await r.stopService(child,options);if(result.reconciled&&resources.has(child))c.recovery.closed(resources.get(child));return result;},
    reloadStarted:()=>c.recovery.intent('reload'),reloadClosed:(id:string)=>c.recovery.closed(id)
  };
}
async function startOwnedService(c:any,r:any){
  c.service=await r.startService(c.root,r.businessEnv(c.env),{owner:c.request.run_id,limits:r.limits,deadline_at:c.deadline,log:c.log});c.serviceClosed=false;
  c.env.PILOT_PORT=String(c.service.port);c.env.PILOT_ORIGIN=c.service.origin;
  c.recovery?.ready();c.log({event:'owned-service-start',pid:c.service.child.pid,origin:c.service.origin,owner:'detached-worker'});
}
async function run(c:any,r:any){
 const attempts:any[]=[],maximum=c.grant.successor_policy==='disabled'?0:c.grant.successor_policy.max_restarts;
 let final:any;
 for(let n=0;n<=maximum;n++){
  const beforeGeneration=c.recovery?.state()?.generation;const outcome=await runAttempt(c,r);final=outcome.result;attempts.push({attempt_id:c.recovery?.state()?.attempt_id||null,classification:final.classification});
  if(!c.recovery)break;
  const state=c.recovery.state();put(c.output,'attempt-results/'+randomUUID()+'.json',final);
  const interrupted=state?.status==='interrupted'||!outcome.runtime&&!!state?.generation;
  if(state?.generation===beforeGeneration||!interrupted||outcome.verified||state?.cancel_requested||state?.status==='ended'||c.stop_reason||c.resourceIssues.length||!outcome.nativeResult?.reconciled||Date.now()>=c.deadline||state.restarts>=maximum||n===maximum){
    if(final.resource_reconciliation.reconciled&&final.claim_cleanup.reconciled)c.recovery.finish();break;
  }
  try{c.recovery.quiesced();c.cleanupBindings=undefined;await startOwnedService(c,r);c.log({event:'worker-successor-ready',original_deadline:c.deadline,next_generation:state.generation+1});}
  catch(error){c.log({event:'worker-successor-refused',reason:String(error)});final.recovery_refused=String(error);break;}
 }
 put(c.output,'result.json',{...final,attempts});return final?.business_verified===true;
}
/** Dependency injection is library-only for isolated engineering tests; the CLI has no bypass flags. */
export async function workerMain(overrides:any={}){
  const r=runtimeForWorker(overrides);r.requireGo(r.repository);assert.equal(typeof process.send,'function','Fresh private IPC is required');
  const contexts:any[]=[];const cancel=()=>{for(const c of contexts){c.stop_reason='user-cancelled';try{c.recovery?.finish(true);}catch{c.log({event:'worker-cancellation-unreconciled'});}c.closeNative?.();}};process.once('SIGINT',cancel);process.once('SIGTERM',cancel);let started=false,parentLost=false,token:string|undefined,output:string|undefined,heartbeat:any;
  const send=(message:any)=>R.bounded(new Promise<void>((res,rej)=>{if(!process.connected)return rej(Error('WORKER_PARENT_LOST'));process.send!({...message,handoff_id:token},(error:Error|null)=>error?rej(error):res());}),R.deadlineAfter(r.limits.ipc_ms),'WORKER_SEND_TIMEOUT');
  const stopBeforeStart=()=>{parentLost=true;if(!started)process.emit('worker-parent-lost' as any);};process.on('disconnect',stopBeforeStart);
  const receive=()=>{let message:any,lost:any;const cleanup=()=>{process.off('message',message);process.off('worker-parent-lost' as any,lost);};const promise=new Promise<any>((res,rej)=>{message=(value:any)=>res(value);lost=()=>rej(Error('WORKER_PARENT_LOST_BEFORE_START'));process.once('message',message);process.once('worker-parent-lost' as any,lost);if(parentLost||!process.connected)lost();});return R.bounded(promise,R.deadlineAfter(r.limits.ipc_ms),'WORKER_RECEIVE_TIMEOUT').finally(cleanup);};
  try{
    const initialPromise=receive();initialPromise.catch(()=>{});await send({kind:'boot-ready'});const initial=await initialPromise;
    assert.equal(initial.kind,'initialize');assert.ok(Array.isArray(initial.contexts)&&initial.contexts.length>0&&initial.contexts.length<=2);token=initial.handoff_id;output=initial.output;assert.equal(resolve(output!,'..'),resolve(r.evaluation));
    const workerLog=(event:any)=>appendFileSync(join(output!,'worker.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n');workerLog({event:'worker-start',pid:process.pid,ppid:process.ppid,process_start:r.processIdentity(process.pid)});heartbeat=setInterval(()=>workerLog({event:'heartbeat',started}),5000);heartbeat.unref();
    assert.equal(new Set(initial.contexts.map((c:any)=>c.root)).size,initial.contexts.length);assert.equal(new Set(initial.contexts.map((c:any)=>c.request.run_id)).size,initial.contexts.length);
    for(const item of initial.contexts){
      r.requireGo(r.repository);assert.match(item.key,/^(orders|publish)-r[0-9]+$/);const prep=JSON.parse(readFileSync(join(r.evaluation,item.key,'preparation.json'),'utf8'));assert.ok(item.root===prep.root&&item.directory===join(r.evaluation,item.key)&&resolve(item.output,'..')===resolve(item.directory),'WORKER_PREPARATION_IDENTITY_CHANGED');
      const env={...r.businessEnv(process.env),...item.environment,PILOT_PORT:'0',AIDLC_RESOURCE_OWNER:item.request.run_id};assert.ok(env.AIDLC_SESSION_BINDING===JSON.stringify(item.binding),'Private binding does not match handed-over credential');assert.equal(item.binding.session_id,item.h4.thread_id);
      const reference=loadWorkflowState(item.root)?.execution_grant_ref;assert.ok(reference,'WORKER_GRANT_REQUIRED');const issued=readIssuedGrant(item.root,reference as any);const enabled=issued.grant.successor_policy!=='disabled';if(!enabled)assert.equal(existsSync(join(item.root,'.aidlc/host-runs',item.request.run_id)),false,'P1 never resumes an existing attempt');
      const bound=enabled?{ref:reference}:withAuthority(env,()=>bindExecutionGrant(item.root));assert.ok(JSON.stringify(bound.ref)===env.AIDLC_EXECUTION_GRANT,'WORKER_GRANT_REF_CHANGED');assert.ok(JSON.stringify(K.identity(join(item.root,'pilot/host.json')))===JSON.stringify(item.request.host),'WORKER_HOST_CHANGED');
      const grant=readIssuedGrant(item.root,bound.ref as any).grant,deadline=Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000);assert.ok(deadline>Date.now(),'WORKER_GRANT_EXPIRED');
      const hostConfig=K.config(join(item.root,'pilot/host.json'));if(hostConfig.admission_plan){const plan=JSON.parse(readFileSync(join(item.root,hostConfig.admission_plan),'utf8'));K.executionWindowCompatibility(hostConfig,{plan_lifetime_seconds:plan.lifetime_seconds,grant_window_ms:deadline-Date.now(),allowed_operations:grant.allowed_operations});}
      const c={...item,env,grant,grantRef:bound.ref,deadline,started:false,service:null,resourceIssues:[],log:(event:any)=>appendFileSync(join(item.output,'controller.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n')} as any;contexts.push(c);
      if(enabled)c.recovery=createWorkerRecovery(c,hostConfig,loadRecoveryCore(hostConfig).api,r.processIdentity);
      c.runtime=recoveryRuntime(c,r);await startOwnedService(c,c.runtime);
    }
    const startPromise=receive();startPromise.catch(()=>{});await send({kind:'ready'});const start=await startPromise;assert.ok(start.kind==='start'&&start.handoff_id===token,'WORKER_START_CANCELLED');r.requireGo(r.repository);started=true;
    const running=contexts.map(c=>run(c,c.runtime));try{await send({kind:'started'});}catch{workerLog({event:'parent-start-ack-lost',started:true,original_supervisor_continues:true});}if(process.connected)process.disconnect();const outcomes=await Promise.allSettled(running);
    workerLog({event:'runs-ended',business_verified:outcomes.every(v=>v.status==='fulfilled'&&v.value===true)});put(output!,'result.json',{kind:'detached-independent-pilot-runs',worker_pid:process.pid,business_verified:outcomes.every(v=>v.status==='fulfilled'&&v.value===true),outcomes:outcomes.map(v=>v.status==='fulfilled'?{status:v.status,verified:v.value}:{status:v.status,error:'WORKER_RUN_FAILED'})});
  }finally{
    process.off('SIGINT',cancel);process.off('SIGTERM',cancel);clearInterval(heartbeat);for(const c of contexts){if(c.service&&!c.serviceClosed)await closeService(c,c.runtime||r);if(!c.started&&c.resourceIssues.length===0&&(!c.recovery||!c.recovery.state()?.generation)){try{c.recovery?.finish();withAuthority(c.env,()=>{const state=loadWorkflowState(c.root)!;assertSessionClaim(c.root,state,c.binding.stage_instance,c.binding);releaseSession(c.root,c.binding.stage_instance,claimToken(state.active_instances[c.binding.stage_instance]));});}catch{c.log({event:'prestart-claim-retained'});}}}
    if(process.connected)process.disconnect();process.off('disconnect',stopBeforeStart);for(const key of authority)delete process.env[key];
  }
}
if(process.argv.includes('--worker')&&resolve(process.argv[1])===resolve(import.meta.filename))await workerMain();
