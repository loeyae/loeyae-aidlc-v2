/** Engineering scheduling fixtures only; real permissions/observations are covered separately by public CLI integration. */
import assert from 'node:assert/strict';import {driveBatch,prepareDispatchAction} from '../harness/codex/runtime/aidlc-codex-host.mjs';
const candidate={id:'candidate',operation:'candidate-commit',timeout_ms:1000};
const inherited={binding:process.env.AIDLC_SESSION_BINDING,coordinator:process.env.AIDLC_COORDINATOR_BINDING};let count=0;
function fixture(options:any={}){
 const refs=Array.from({length:options.units||1},(_,i)=>({module_id:'project',unit_id:'unit-'+i})),complete=new Set<string>();
 const binding={stage_instance:'workspace-detection',owner:'agent',session_id:'engineering-only',generation:'private-fixture'};
 const context:any={binding,grant:{executor_constraints:{initial_binding:{stage_instance:'workspace-detection'}},resource_limits:{max_equivalent_retries:1}}};
 let c8=false,source='initial',observed='',metadata=0,stages=0,candidates=0,observations=0;
 const deadline=Date.now()+60000,gateway:any={pending:new Set(),unknown:[],budget:{deadline,check(){assert.ok(Date.now()<deadline);}},abort:new AbortController(),async invoke(a:any){await prepareDispatchAction(a,{commands:[candidate]},{budget:gateway.budget,mode:gateway.finalizing?'metadata':'implementation',requireWindow:action=>gateway.requireAdmissionWindow(action)});if(a.action==='read')return {sha256:'f'.repeat(64),content:'engineering receipt'};assert.equal(a.action,'command');assert.equal(a.id,'candidate');candidates++;return {status:'succeeded'};}};
 const core=async(args:string[]):Promise<any>=>{
    if(args[2]==='admission'&&args[3]==='inspect')return {autonomous_admission:{admission_result:'ready',valid_until:new Date(Date.now()+900000).toISOString()}};
  if(args[1]==='next')return options.block||context.binding.stage_instance==='build-and-test'&&!c8?{kind:'run-stage',stage:'build-and-test',stage_instance:'build-and-test',approval:options.block?'block':'notify'}:{kind:'print',preview:true,stage_instance:null,next_stage:null,next_stage_status:'none'};
  if(args[2]==='host'&&args[3]==='context')return {host_context:{binding:context.binding,implementation_units:refs.map(unit_ref=>({unit_ref,review_completed:true})),source_digest:source,c8_completed:c8,progress_digest:source}};
  if(args[2]==='host'&&args[3]==='select')return {host_context:{binding:{...context.binding,stage_instance:args.at(-1)}}};
  if(args[2]==='observe'){if(args[3]==='run'){observed=source;observations++;}return {autonomous_observations:{status:options.observationFailure?'failed':observed===source?'passed':'unverified',receipt_ref:{path:'.aidlc/evidence/engineering.json'},producer:{stage_instance:'build-and-test'}}};}
  if(args[2]==='decisions')return {autonomy_decisions:{completion_blockers:options.rework?['d:human-review-requires-incremental-rework']:refs.filter(r=>!complete.has(r.unit_id)).map(r=>r.unit_id+':implementation-missing'),decisions:refs.map(unit_ref=>({decision_id:unit_ref.unit_id,unit_ref,completion_blockers:complete.has(unit_ref.unit_id)?[]:['implementation-missing']})),write_contract:{schema:'aidlc.decision-write-contract/v1',updates:refs.map(unit_ref=>({decision_id:unit_ref.unit_id,proposal:{unit_ref},runtime_validation_templates:[],required_check_ids:[]}))}}};
  if(args[2]==='batch'&&args[3]==='finalize')return {autonomous_batch_result:{engineering_result:options.observationFailure?'failed':'verified',checks:options.observationFailure?[{check_id:'acceptance',status:'failed'}]:[],batch_completed:!options.observationFailure}};
  throw Error('Unexpected fixture Core command '+JSON.stringify(args));
 };
 const client={async turn(text:string,_signal:any,timeout:number){assert.ok(timeout<=60000);assert.equal(text.includes('"generation":'),false);
  if(gateway.finalizing){metadata++;assert.equal(stages,0);assert.equal(gateway.readyInstance,null);assert.ok(text.startsWith('Complete only the planned delegated decisions'));
   const unit=refs.find(r=>context.binding.stage_instance==='code-review@module:'+r.module_id+'@unit:'+r.unit_id);assert.ok(unit);if(!options.stuck){complete.add(unit.unit_id);source='completed-'+metadata;}
   return {status:options.interrupted?'interrupted':'completed'};
  }
  stages++;assert.equal(complete.size,refs.length);assert.equal(gateway.readyInstance,'build-and-test');c8=true;return {status:'completed'};
 }};
 return {context,core,client,gateway,stats:()=>({metadata,stages,candidates,observations,deadline})};
}
async function test(name:string,options:any,expected:string,metadata:number){const f=fixture(options),deadline=f.gateway.budget.deadline;assert.equal(await driveBatch({commands:[candidate],observation_plan:'frozen-plan',candidate_command:'candidate'},f.context,f.core,f.client,f.gateway),expected);assert.equal(f.stats().metadata,metadata);assert.equal(f.gateway.budget.deadline,deadline);assert.ok(!f.gateway.finalizing);count++;console.log('PASS '+name);return f;}
try{
 const one=await test('planned references complete under exact unit before C8, followed by candidate and observations',{},'batch-verified',1);assert.equal(one.stats().stages,1);assert.equal(one.stats().candidates,2);assert.equal(one.stats().observations,2);
 const many=await test('four units receive separate bounded metadata turns with serial C8', {units:4},'batch-verified',4);assert.equal(many.stats().stages,1);assert.equal(many.stats().candidates,2,'One initial and one final candidate for all units');assert.equal(many.stats().observations,2,'Metadata grouping never removes the final full matrix');
 const stuck=await test('model success without records stops at original per-unit equivalent retry limit',{stuck:true},'delegated-completion-exhausted',2);assert.equal(stuck.stats().stages,0);
 await test('explicit human rework cannot be lowered to automatic metadata repair',{rework:true},'delegated-human-rework-required',0);
 await test('actual observation failure stops before metadata or C8',{observationFailure:true},'batch-failed',0);
 await test('a real block never enters delegated metadata completion',{block:true},'approval-required',0);
 await test('interrupted metadata turn is not resumed',{interrupted:true},'native-turn-interrupted',1);
 console.log('Pre-C8 completion: '+count+' engineering scheduling scenarios passed');
}finally{if(inherited.binding===undefined)delete process.env.AIDLC_SESSION_BINDING;else process.env.AIDLC_SESSION_BINDING=inherited.binding;if(inherited.coordinator===undefined)delete process.env.AIDLC_COORDINATOR_BINDING;else process.env.AIDLC_COORDINATOR_BINDING=inherited.coordinator;}
