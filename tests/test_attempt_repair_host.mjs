/** Scripted model/Core responses exercise the actual driver/Gateway. No business verdict. */
import assert from 'node:assert/strict';import {test} from 'node:test';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,dirname} from 'node:path';
import {driveBatch,Gateway} from '../harness/codex/runtime/aidlc-codex-host.mjs';import K from '../harness/codex/runtime/host-kernel.cjs';
const root=mkdtempSync(join(tmpdir(),'aidlc-repair-host-'));
test('diagnosis cannot write, validate, advance, approve or apply its own rollback',async()=>{
 let calls=0;const context={binding:{stage_instance:'workspace-detection'},grant:{request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),resource_limits:{wall_time_seconds:3600,max_equivalent_retries:2,max_active_units:1}}};
 const g=new Gateway({commands:[{id:'q',operation:'validation-execute',timeout_ms:1000}]},root,context,async()=>{calls++;return {};});g.diagnosing=true;
 for(const action of [{action:'write',path:'delivery/test.md',operation:'design-write',content:'bad'},{action:'command',id:'q'},...[
 ['orchestrate','next'],['evidence','run'],['orchestrate','report'],['orchestrate','autonomy','observe','run'],['orchestrate','autonomy','batch','finalize'],['orchestrate','autonomy','repair','apply','--expect','a'],['orchestrate','autonomy','repair','start','--pid','1']
 ].map(args=>({action:'core',args}))])await assert.rejects(()=>g.invoke(action),/DIAGNOSIS_ONLY|CORE_COMMAND_DENIED/);
 assert.equal(calls,0);assert.equal(g.budget.failures.size,0);g.cancel('test-end');await g.reconcile();
 assert.equal(K.describeAction({action:'core',args:['orchestrate','autonomy','repair','apply']},{commands:[]},{origin:'host'}).needs_window,true);
});
test('same driver performs Core-owned exact rollback then returns to formal implementation without changing grant or deadline',async()=>{
 const old={...process.env};try{for(const variant of ['accepted','rejected','partial','interrupted','exhausted']){const rejected=variant==='rejected';
  const binding={stage_instance:'workspace-detection',session_id:'scripted-session',owner:'agent'},deadline=Date.now()+3600000,ctx={binding,grant:{request_started_at:new Date().toISOString(),expires_at:new Date(deadline).toISOString(),resource_limits:{wall_time_seconds:3600,max_equivalent_retries:2,max_active_units:1},executor_constraints:{initial_binding:binding}}},frozen=JSON.stringify(ctx.grant);
  let planned=false,applied=0,diagnoses=0,implementation=0;const plan={sequence:1,plan_digest:'p',classification:'code-defect',steps:[{instance:'build-and-test',status:'pending'},{instance:'code-generation@module:p@unit:u',status:'pending'}]};
  const c={commands:[],observation_plan:'plan'},core=async args=>{
   if(args[2]==='grant')return {allowed:true};
   if(args[2]==='admission')return {autonomous_admission:{admission_result:'ready',valid_until:new Date(Date.now()+900000).toISOString()}};
   if(args[2]==='host'&&args[3]==='select')return {host_context:{binding:{...binding,stage_instance:args.at(-1)}}};
   if(args[2]==='host')return {host_context:{binding:ctx.binding,c8_completed:applied===0,implementation_units:[{unit_ref:{module_id:'p',unit_id:'u'},review_completed:applied===0}],source_digest:'same',progress_digest:String(implementation),same_attempt_repair:{supported:true}}};
   if(args[1]==='next')return applied?{kind:'run-stage',stage:'code-generation',stage_instance:ctx.binding.stage_instance,approval:implementation?'block':'notify'}:{kind:'print',preview:true,stage_instance:null,next_stage:null,next_stage_status:'none'};
   if(args[2]==='observe')return {autonomous_observations:{status:'failed'}};
   if(args[2]==='batch')return {autonomous_batch_result:{engineering_result:'failed',checks:[{check_id:'business',status:'failed'}]}};
   if(args[2]==='repair'){
    if(args[3]==='request'){planned=true;return {attempt_repair:{status:rejected?'blocked':'planned',plan}};}
    if(args[3]==='apply'){if(variant==='partial')throw Error('ATTEMPT_REPAIR_PARTIAL_TRANSITION_UNRECONCILED: injected publication failure');assert.equal(ctx.binding.stage_instance,plan.steps[applied].instance);assert.equal(args.at(-1),'p');plan.steps[applied].status='applied';applied++;return {attempt_repair:{status:applied===2?'applied':'planned',plan}};}
    return {attempt_repair:{status:variant==='exhausted'?'exhausted':applied===2?'waiting-for-new-validation':planned?rejected?'blocked':'planned':'diagnosis-required',plan,failure_ref:{digest:'failed'},eligible_units:[{module_id:'p',unit_id:'u'}]}};
   }throw Error('Unexpected scripted request '+args);
  };
  const g=new Gateway(c,root,ctx,core),client={async turn(){if(g.diagnosing){diagnoses++;if(variant==='interrupted')return {status:'interrupted'};await g.invoke({action:'core',args:['orchestrate','autonomy','repair','request','--kind',rejected?'scope-change':'code-defect','--unit','p/u','--failure','failed','--reason','scripted diagnosis']});}else{assert.equal(g.readyInstance,ctx.binding.stage_instance);implementation++;}return {status:'completed'};}};
  try{if(variant==='partial'){await assert.rejects(()=>driveBatch(c,ctx,core,client,g),/PARTIAL_TRANSITION_UNRECONCILED/);assert.equal(g.unknown.length,1);assert.equal(g.budget.stopped,'repair-transition-unreconciled');assert.equal(implementation,0);}else{
    assert.equal(await driveBatch(c,ctx,core,client,g),variant==='exhausted'?'same-attempt-repair-exhausted':variant==='interrupted'?'native-turn-interrupted':rejected?'batch-failed':'approval-required');assert.equal(applied,variant==='accepted'?2:0);assert.equal(diagnoses,variant==='exhausted'?0:1);assert.equal(implementation,variant==='accepted'?1:0);
   }assert.equal(JSON.stringify(ctx.grant),frozen);assert.equal(g.budget.deadline,deadline);assert.equal(!!g.diagnosing,false);}finally{g.cancel('test-end');await g.reconcile();}
 }}finally{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});
test.after(()=>{assert.equal(resolve(dirname(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});});
