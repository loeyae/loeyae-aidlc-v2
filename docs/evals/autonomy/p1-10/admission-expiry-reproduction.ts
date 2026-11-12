/** Engineering scheduling regression derived from orders-r8, never a real model/business proof.
 * Candidate succeeds, then admission expires before the first full observation.
 * Expected behavior: renew within the original grant, observe, C8, converge; never repeat the commit. */
import assert from 'node:assert/strict';import {driveBatch} from '../../../../harness/codex/runtime/aidlc-codex-host.mjs';
const inherited={binding:process.env.AIDLC_SESSION_BINDING,coordinator:process.env.AIDLC_COORDINATOR_BINDING};
const initial={stage_instance:'workspace-detection',owner:'agent',session_id:'engineering-expiry-only',generation:'fixture-private'};
const context:any={binding:initial,grant:{executor_constraints:{initial_binding:initial},resource_limits:{max_equivalent_retries:2}}};
let admission=true,candidate=false,observed=false,c8=false,commits=0,renewals=0;const deadline=Date.now()+60000;
const gateway:any={budget:{deadline,check(){assert.ok(Date.now()<deadline);}},abort:new AbortController(),pending:new Set(),unknown:[],async invoke(a:any){assert.equal(a.action,'command');assert.equal(a.id,'candidate');commits++;candidate=true;admission=false;return {status:'succeeded'};}};
const core=async(args:string[]):Promise<any>=>{
 if(args[1]==='next')return context.binding.stage_instance==='build-and-test'&&!c8?{kind:'run-stage',stage:'build-and-test',stage_instance:'build-and-test',approval:'notify'}:{kind:'print',preview:true,stage_instance:null,next_stage:null,next_stage_status:'none'};
 if(args[2]==='host'&&args[3]==='context')return {host_context:{binding:context.binding,implementation_units:[{unit_ref:{module_id:'project',unit_id:'default'},review_completed:true}],c8_completed:c8,source_digest:candidate?'candidate':'baseline',progress_digest:String(c8)}};
 if(args[2]==='host'&&args[3]==='select')return {host_context:{binding:{...context.binding,stage_instance:args.at(-1)}}};
 if(args[2]==='admission'){if(args[3]==='run'){renewals++;admission=true;}return {autonomous_admission:{admission_result:admission?'ready':'not-ready',reason:admission?undefined:'ADMISSION_INPUT_CHANGED: receipt expired/clock invalid'}};}
 if(args[2]==='observe'){
  if(args.includes('--dependency-preflight'))return {autonomous_observations:{status:'not-applicable'}};
  if(args[3]==='run'){if(!admission)throw Error('ADMISSION_INPUT_CHANGED: receipt expired/clock invalid');observed=true;}
  return {autonomous_observations:{status:observed?'passed':'unverified'}};
 }
 if(args[2]==='decisions')return {autonomy_decisions:{decisions:[],completion_blockers:[]}};
 if(args[2]==='batch')return {autonomous_batch_result:{engineering_result:c8&&observed&&admission?'verified':'incomplete',checks:[],batch_completed:c8&&observed&&admission}};
 throw Error('Unexpected engineering command '+JSON.stringify(args));
};
const client={async turn(){assert.equal(gateway.readyInstance,'build-and-test');c8=true;return {status:'completed'};}};
try{
 assert.equal(await driveBatch({observation_plan:'frozen-plan',admission_plan:'frozen-admission',candidate_command:'candidate'},context,core,client,gateway),'batch-verified');
 assert.equal(commits,1,'A completed commit is not replayed for admission renewal');assert.equal(renewals,1);assert.equal(gateway.budget.deadline,deadline);
 console.log('PASS expired admission after completed candidate is renewed before observation without extending the grant or repeating commit');
}finally{if(inherited.binding===undefined)delete process.env.AIDLC_SESSION_BINDING;else process.env.AIDLC_SESSION_BINDING=inherited.binding;if(inherited.coordinator===undefined)delete process.env.AIDLC_COORDINATOR_BINDING;else process.env.AIDLC_COORDINATOR_BINDING=inherited.coordinator;}
