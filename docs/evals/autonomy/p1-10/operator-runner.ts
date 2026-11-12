/** Real operator entry: collect both exact H5 grants before starting either independent native run. */
import assert from 'node:assert/strict';import tty from 'node:tty';import {readFileSync,existsSync,appendFileSync,writeFileSync,mkdirSync,lstatSync} from 'node:fs';import {join} from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {createRequire} from 'node:module';
import {requireIntegrationGo} from './integration-review-gate.mjs';
import {inspectUnstartedGrant} from './operator-prestart';
import {launchAuthorizedWorker} from './pilot-worker';
import {repository,evaluation,put,git,startService,stopService} from './prepare-pilots';import {loadWorkflowState} from '../../../../core/tools/aidlc-light-state';import {bindSession,releaseSession,claimToken} from '../../../../core/tools/aidlc-session';import {projectAutonomyScope} from '../../../../core/tools/aidlc-autonomy';import {projectAutonomyDecisions} from '../../../../core/tools/aidlc-autonomy-policy';import {projectAutonomyDependencies} from '../../../../core/tools/aidlc-autonomy-dependencies';import {bindExecutionGrant} from '../../../../core/tools/aidlc-execution-grant';
const integrationReview=requireIntegrationGo(repository);
const K=createRequire(import.meta.url)(join(repository,'harness/codex/runtime/host-kernel.cjs'));
const authority=['AIDLC_SESSION_BINDING','AIDLC_EXECUTION_GRANT','AIDLC_AUTONOMY_HOST','AIDLC_COORDINATOR_BINDING'];for(const key of authority)delete process.env[key];
function inspect(key:string){
 assert.match(key,/^(orders|publish)-r(?:[3-9]|[1-9][0-9]+)$/);const directory=join(evaluation,key),root=JSON.parse(readFileSync(join(directory,'preparation.json'),'utf8')).root,h4=JSON.parse(readFileSync(join(directory,'h4-sealed.json'),'utf8'));
 const scope=projectAutonomyScope(root),decisions=projectAutonomyDecisions(root),dependencies=projectAutonomyDependencies(root),state=loadWorkflowState(root)!;
 assert.equal(scope.snapshot!.scope_digest,h4.scope.snapshot.scope_digest);assert.equal(dependencies.admission_ready,true);assert.ok(!state.execution_grant_version||process.argv.includes('--retry-unstarted'),'Existing authorization requires an explicitly requested first-start retry');assert.equal(Object.keys(state.active_instances).length,0,'Never take over a live or stale claim');assert.equal(existsSync(join(root,'tests/ucd.cjs')),false,'Implementation tests must follow H5');assert.equal(decisions.decisions.length,1,'Actual planned delegated decision is required before this trial');
 const request={...JSON.parse(readFileSync(join(root,'pilot/grant-request.json'),'utf8')),host:K.identity(join(root,'pilot/host.json')),write_paths:['src','tests','docs/aidlc/modules/project/construction','delivery','.runtime']};
 const existing=state.execution_grant_version?inspectUnstartedGrant(root,directory,request,h4.thread_id,scope.snapshot!.scope_digest):undefined;
 return {key,directory,root,h4,scope,request,decisions,existing};
}
const keys=process.argv.slice(2).filter(s=>!s.startsWith('--'));if(!keys.length)keys.push('orders-r10','publish-r14');const checked=keys.map(inspect);
for(const field of ['root','thread_id','run_id','workflow_id']){const values=checked.map(c=>field==='root'?c.root:field==='thread_id'?c.h4.thread_id:field==='run_id'?c.request.run_id:c.h4.workflow_id);assert.equal(new Set(values).size,values.length,'Independent pilots must not share '+field);}
if(process.argv.includes('--check')){console.log(JSON.stringify({kind:'pilot-entry-check',integration_review:integrationReview,ready_for_actual_terminal_review:true,execution_authorized:false,business_verified:false,pilots:checked.map(c=>({key:c.key,workflow_id:c.h4.workflow_id,thread_id:c.h4.thread_id,scope_digest:c.scope.snapshot!.scope_digest,host:c.request.host,resource_limits:c.request.resource_limits,operations:c.request.allowed_operations,planned_decisions:c.decisions.decisions,grant_issued:!!c.existing,existing_unstarted:c.existing,business_verified:false}))}));process.exit(0);}
assert.ok(tty.isatty(0)&&tty.isatty(1),'Use the real local operator console; no pipe, simulated TTY or agent-entered challenge');
type Context=ReturnType<typeof inspect>&{binding:any,env:NodeJS.ProcessEnv,output:string,service:Awaited<ReturnType<typeof startService>>,started:boolean,issued:boolean,handedOff?:boolean,handoffUncertain?:boolean,log:(v:any)=>void};
const contexts:Context[]=[];
function withAuthority<T>(env:NodeJS.ProcessEnv,fn:()=>T):T{const before=Object.fromEntries(authority.map(k=>[k,process.env[k]]));try{for(const k of authority){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}return fn();}finally{for(const k of authority){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}}
let allVerified=true,summary:any;
try{
 // Only the actual Core child reads stdin. Both grants precede any implementation.
 for(const item of checked){
  requireIntegrationGo(repository);
  const binding=bindSession(item.root,{instance:'workspace-detection',owner:'agent',session:item.h4.thread_id,expected:claimToken(undefined)}).binding;
  const env:NodeJS.ProcessEnv={...process.env,AIDLC_SESSION_BINDING:JSON.stringify(binding),AIDLC_AUTONOMY_HOST:JSON.stringify(item.request.host),PILOT_PORT:'0'};
  const output=join(item.directory,'operator-'+item.request.run_id+'-'+Date.now());const log=(v:any)=>appendFileSync(join(output,'controller.jsonl'),JSON.stringify({at:new Date().toISOString(),...v})+'\n');
  let service;try{mkdirSync(output);service=await startService(item.root,K.businessEnv(env),{owner:item.request.run_id,log});}catch(e:any){if(e.resource_reconciliation?.reconciled!==false)withAuthority(env,()=>releaseSession(item.root,binding.stage_instance,claimToken(loadWorkflowState(item.root)!.active_instances[binding.stage_instance])));else log({event:'prestart-resource-unknown',resource_reconciliation:e.resource_reconciliation});throw e;}
  env.PILOT_PORT=String(service.port);env.PILOT_ORIGIN=service.origin;const c:Context={...item,binding,env,output,service,started:false,issued:false,log};contexts.push(c);log({event:'owned-service-start',pid:service.child.pid,origin:service.origin,candidate_commit:service.candidate_commit});
  const control=join(item.root,'.runtime');if(existsSync(control))assert.equal(lstatSync(control).isSymbolicLink(),false);else mkdirSync(control);
  if(item.existing){
    env.AIDLC_EXECUTION_GRANT=withAuthority(env,()=>JSON.stringify(bindExecutionGrant(item.root).ref));c.issued=true;
    log({event:'existing-real-terminal-grant-used-for-first-start',run_id:item.request.run_id,original_approval:item.existing.original_approval,expires_at:item.existing.expires_at,request_started_at:item.existing.request_started_at,scope_digest:item.scope.snapshot!.scope_digest,host:item.request.host});
    console.log('\n'+item.key+': original terminal grant remains valid for its FIRST Native start in the same prepared session. No new grant, restored binding or deadline extension. Original expiry: '+item.existing.expires_at);continue;
  }
  const requestPath='.runtime/h5-request-'+item.request.host.config_digest+'-'+Date.now()+'.json';put(item.root,requestPath,item.request);
  console.log('\nP1-10 '+item.key+': review the exact request. Single session, 3600 seconds, local candidate commit only. No push, deploy, protected branch or successor.');console.log('Enter the exact challenge yourself. Both independent requests are collected before either implementation starts.');
  requireIntegrationGo(repository);
  const r=spawnSync(process.execPath,[join(repository,'node_modules/tsx/dist/cli.mjs'),join(repository,'bin/cli.ts'),'orchestrate','autonomy','grant','issue','--input',requestPath],{cwd:item.root,env,stdio:['inherit','inherit','pipe'],encoding:'utf8',windowsHide:false,timeout:300000});if(r.stderr){appendFileSync(join(output,'grant.stderr.log'),r.stderr);process.stderr.write(r.stderr);}log({event:'grant-command-exit',exit_code:r.status,error:r.error?.message??null});assert.equal(r.status,0,'Actual operator did not issue this exact grant; no implementation starts');c.issued=true;env.AIDLC_EXECUTION_GRANT=withAuthority(env,()=>JSON.stringify(bindExecutionGrant(item.root).ref));log({event:'real-terminal-grant-issued',run_id:item.request.run_id,scope_digest:item.scope.snapshot!.scope_digest,host:item.request.host});
 }
 // Separate processes, environments, roots and grants; each batch remains serial
 // with max_active_units=1. Transfer fresh live ownership before either first dispatch.
 for(const c of contexts){await stopService(c.service.child);c.log({event:'owned-service-close',pid:c.service.child.pid,reason:'before-private-handoff'});}
 requireIntegrationGo(repository);
 const worker=await launchAuthorizedWorker(contexts);summary={kind:'authorized-independent-pilots-dispatched',business_verified:false,worker,outputs:contexts.map(c=>c.output)};
}finally{
 for(const c of contexts){let closed=true;if(!c.handedOff){try{await stopService(c.service.child);c.log({event:'owned-service-close',pid:c.service.child.pid});}catch(error:any){closed=false;c.log({event:'owned-service-unknown',resource_reconciliation:error.resource_reconciliation});}}if(closed&&!c.started&&!c.handedOff&&!c.handoffUncertain){const claim=loadWorkflowState(c.root)!.active_instances[c.binding.stage_instance];if(claim&&claim.generation===c.binding.generation)withAuthority(c.env,()=>releaseSession(c.root,c.binding.stage_instance,claimToken(claim)));}}
 for(const key of authority)delete process.env[key];
}
// A selected console may block output after handoff. The independent worker owns
// actual execution, reconciliation and service closure; this summary is no business verdict.
if(summary)console.log(JSON.stringify(summary));
