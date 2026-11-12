import assert from 'node:assert/strict';import {test} from 'node:test';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import K from '../harness/codex/runtime/host-kernel.cjs';import {Gateway,requiredAdmissionWindow,prepareDispatchAction,driveBatch} from '../harness/codex/runtime/aidlc-codex-host.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-action-policy-')),context={binding:{stage_instance:'code-review@module:p@unit:u'},grant:{resource_limits:{wall_time_seconds:3600,max_equivalent_retries:2,max_active_units:1},request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()}};
fs.mkdirSync(path.join(root,'delivery'));fs.mkdirSync(path.join(root,'.aidlc/proposals/decisions/fixture'),{recursive:true});fs.writeFileSync(path.join(root,'source.md'),'source');fs.writeFileSync(path.join(root,'.aidlc/proposals/decisions/fixture/proposal.json'),'{"human_review":{"status":"pending"}}');
const command={id:'verify',argv:[process.execPath,'--version'],operation:'validation-execute',timeout_ms:1000,input_paths:['source.md'],write_paths:[]};
test('metadata denies long validation and workflow actions before any dispatch',async()=>{
 for(const action of [
  {action:'core',args:['orchestrate','autonomy','observe','run','--input','plan']},
  {action:'core',args:['orchestrate','autonomy','observe','run','--dependency-preflight','--input','plan']},
  {action:'core',args:['orchestrate','autonomy','batch','finalize']},
  {action:'core',args:['evidence','run','--stage','tdd']},
  {action:'core',args:['orchestrate','report','--stage','build-and-test','--result','completed']},
  {action:'core',args:['orchestrate','next','--preview']},{action:'command',id:'verify'},
  {action:'write',path:'new.cjs',operation:'code-write',content:'bad'},
 ]){let calls=0,windows=0;const g=new Gateway({commands:[command]},root,context,async()=>{calls++;return {kind:'print'};});g.finalizing=true;g.requireAdmissionWindow=async()=>{windows++;};await assert.rejects(()=>g.invoke(action),/FINALIZATION_ONLY/);assert.equal(calls,0);assert.equal(windows,0);assert.equal(g.pending.size,0);assert.equal(g.budget.failures.size,0);g.cancel('test-end');await g.reconcile();}
 assert.equal(fs.existsSync(path.join(root,'new.cjs')),false);
});
test('metadata permits bounded reads, design and decision API with live Core checks',async()=>{
 let checks=0,records=0;const g=new Gateway({commands:[]},root,context,async args=>{if(args[2]==='grant'){checks++;return {allowed:true};}if(args[2]==='record')records++;return {kind:'print'};});g.finalizing=true;
 await g.invoke({action:'read',path:'source.md'});assert.equal(checks,0,'Public reads already use local path/budget checks, not a Core grant round trip');await g.invoke({action:'write',path:'delivery/note.md',operation:'design-write',content:'implementation refs'});assert.equal(checks,1);
 for(const args of [['orchestrate','autonomy','decisions'],['orchestrate','autonomy','observe','inspect'],['orchestrate','autonomy','batch','inspect'],['orchestrate','autonomy','record','--input','.aidlc/proposals/decisions/fixture/proposal.json','--expect','absent']]){const before=checks;await g.invoke({action:'core',args});assert.equal(checks,before+1,'Each Core operation retains its live authorization check');}
 assert.equal(records,1);assert.equal(checks,5);g.cancel('test-end');await g.reconcile();
});
test('denied flags and actor spoofing cannot reach refresh or Core',async()=>{
 let calls=0,windows=0;const g=new Gateway({commands:[]},root,context,async()=>{calls++;return {};});g.requireAdmissionWindow=async()=>{windows++;};
 for(const args of [['orchestrate','report','--user-input=Approve'],['orchestrate','next','--scope=feature'],['orchestrate','autonomy','observe','unknown'],['orchestrate','autonomy','host','select','--instance','workspace-detection']])await assert.rejects(()=>g.invoke({action:'core',args}),/CORE_COMMAND_DENIED/);
 await assert.rejects(()=>g.invoke({action:'core',args:['orchestrate','next'],origin:'host'}),/TOOL_SCHEMA/);assert.equal(calls,0);assert.equal(windows,0);g.cancel('test-end');await g.reconcile();
});
test('configuration rejects impossible and exact-ceiling command windows before execution',()=>{
 const file=path.join(root,'host.json'),config={schema:'aidlc.codex-host/v1',codex_entrypoint:process.execPath,core_cli:process.execPath,commands:[{...command}]};
 for(const timeout of [900000,890000]){config.commands[0].timeout_ms=timeout;fs.writeFileSync(file,JSON.stringify(config));assert.throws(()=>K.config(file),/WINDOW_INFEASIBLE/);}
 config.commands[0].timeout_ms=889999;fs.writeFileSync(file,JSON.stringify(config));assert.equal(K.config(file).commands[0].timeout_ms,889999);
 assert.throws(()=>requiredAdmissionWindow({action:'command',id:'verify'},{commands:[{...command,timeout_ms:900000}]},3600000,0),/WINDOW_INFEASIBLE/);
});
test('one descriptor covers model and host roles without exposing host commands to the model',()=>{
 assert.equal(typeof K.describeAction,'function');
 const action={action:'core',args:['orchestrate','autonomy','admission','run','--input','plan']};assert.throws(()=>K.describeAction(action,{commands:[]}),/CORE_COMMAND_DENIED/);
 const host=K.describeAction(action,{commands:[]},{origin:'host'});assert.equal(host.needs_window,false);assert.equal(host.family,'core.admission.run');
 assert.equal(K.describeAction({action:'core',args:['evidence','run']},{commands:[]}).timeout_ms,600000);
});

test('every long model and host family fails before transport when its window is denied',async()=>{
 const actions=[{action:'command',id:'verify'},...[
  ['evidence','run'],['orchestrate','report'],['orchestrate','autonomy','observe','run'],['orchestrate','autonomy','batch','finalize']
 ].map(args=>({action:'core',args}))];
 for(const origin of ['model','host'])for(const action of actions){let transport=0,windows=0;const budget=new K.Budget(context.grant.resource_limits,Date.now()+3600000);
  const dispatch=async()=>{await prepareDispatchAction(action,{commands:[command]},{origin,budget,requireWindow:async()=>{windows++;throw Error('WINDOW_DENIED');}});transport++;};
  await assert.rejects(dispatch,/WINDOW_DENIED/);assert.equal(transport,0);assert.equal(windows,1);assert.equal(budget.failures.size,0);
 }
});

test('actual driver renews before host full observation and again before finalization, or dispatches neither',async()=>{
 const inherited={binding:process.env.AIDLC_SESSION_BINDING,coordinator:process.env.AIDLC_COORDINATOR_BINDING};
 try{for(const mode of ['ready','not-ready','too-short']){
  const binding={stage_instance:'workspace-detection',owner:'agent',session_id:'local-action-fixture'},ctx={binding,grant:{...context.grant,executor_constraints:{initial_binding:binding}}};
  let until=Date.now()+90000,renewals=0,observations=0,finals=0;
  const c={commands:[],admission_plan:'plan',observation_plan:'plan'};
  const core=async args=>{
   if(args[2]==='host'&&args[3]==='select')return {host_context:{binding:{...binding,stage_instance:args.at(-1)}}};
   if(args[2]==='host')return {host_context:{binding:ctx.binding,c8_completed:true,implementation_units:[{unit_ref:{module_id:'p',unit_id:'u'},review_completed:true}],source_digest:'unchanged'}};
   if(args[1]==='next')return {kind:'print',preview:true,stage_instance:null,next_stage:null,next_stage_status:'none'};
   if(args[2]==='admission'){if(args[3]==='run'){renewals++;until=Date.now()+(mode==='too-short'?90000:900000);}return {autonomous_admission:{admission_result:args[3]==='run'&&mode==='not-ready'?'not-ready':'ready',valid_until:new Date(until).toISOString(),checks:mode==='not-ready'?[{check_id:'host-capabilities',status:'failed'}]:[]}};}
   if(args[2]==='observe'){if(args.includes('--dependency-preflight'))return {};if(args[3]==='inspect')return {autonomous_observations:{status:'unverified'}};assert.ok(until-Date.now()>180000);observations++;until=Date.now()+90000;return {autonomous_observations:{status:'passed'}};}
   if(args[2]==='batch'){assert.ok(until-Date.now()>180000);finals++;return {autonomous_batch_result:{engineering_result:'verified',checks:[]}};}
   throw Error('Unexpected local Core call');
  };
  const g=new Gateway(c,root,ctx,core);try{
   const result=await driveBatch(c,ctx,core,{turn(){throw Error('No model turn in this fixture');}},g);
   assert.equal(result,mode==='ready'?'batch-verified':mode==='not-ready'?'admission-not-ready':'admission-window-insufficient');
   assert.equal(observations,mode==='ready'?1:0);assert.equal(finals,mode==='ready'?1:0);assert.equal(renewals,mode==='ready'?2:1);assert.equal(g.budget.failures.size,0);
  }finally{g.cancel('test-end');await g.reconcile();}
 }}finally{for(const [k,v]of Object.entries({AIDLC_SESSION_BINDING:inherited.binding,AIDLC_COORDINATOR_BINDING:inherited.coordinator})){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test('a missing dispatcher and concurrent requests fail closed without spending equivalent retries',async()=>{
 let calls=0;const g=new Gateway({commands:[command]},root,context,async()=>{calls++;return {};});
 await assert.rejects(()=>g.invoke({action:'command',id:'verify'}),/WINDOW_REQUIRED/);assert.equal(calls,0);assert.equal(g.budget.failures.size,0);
 let release;const waiting=new Promise(res=>release=res);g.requireAdmissionWindow=async()=>{await waiting;throw Error('LOCAL_WINDOW_DENIED');};
 const first=g.invoke({action:'command',id:'verify'});await assert.rejects(()=>g.invoke({action:'read',path:'source.md'}),/OPERATIONS_UNRECONCILED/);release();await assert.rejects(()=>first,/LOCAL_WINDOW_DENIED/);assert.equal(calls,0);assert.equal(g.pending.size,0);g.cancel('test-end');
});

test('a command whose window expires during Core authorization never spawns a child',async()=>{
 const rows=[];let g;g=new Gateway({commands:[command]},root,context,async args=>{if(args[2]==='host')return {host_context:{execution_inputs:{schema:'aidlc.execution-input-identity/v1',command_digest:'a'.repeat(64)}}};g.admissionDeadline=Date.now();return {allowed:true};},row=>rows.push(row));
 g.requireAdmissionWindow=async()=>{g.admissionDeadline=Date.now()+900000;};await assert.rejects(()=>g.invoke({action:'command',id:'verify'}),error=>error.message==='HOST_ADMISSION_WINDOW_INSUFFICIENT'&&error.continuation?.decision==='stop'&&error.continuation.available_ms===0&&error.operation_not_dispatched===true);
 assert.equal(g.budget.failures.size,0,'A rejected predispatch window is not a failed business execution');
 assert.equal(rows.some(r=>r.status==='dispatched'||r.pid),false);g.cancel('test-end');await g.reconcile();
});
test.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
