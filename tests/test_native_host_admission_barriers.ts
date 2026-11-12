/** Scheduling regression from real orders-r8; seeded Core/model responses are engineering proof only. */
import assert from 'node:assert/strict';
import {driveBatch,prepareDispatchAction} from '../harness/codex/runtime/aidlc-codex-host.mjs';
const candidate={id:'candidate',operation:'candidate-commit',timeout_ms:1000};
const inherited={binding:process.env.AIDLC_SESSION_BINDING,coordinator:process.env.AIDLC_COORDINATOR_BINDING};let count=0;
function fixture(options:any={}){
 const binding={stage_instance:'workspace-detection',owner:'agent',session_id:'expiry-engineering',generation:'private-fixture'};
 const deadline=Date.now()+60000,context:any={binding,grant:{executor_constraints:{initial_binding:binding},expires_at:new Date(deadline).toISOString(),resource_limits:{max_equivalent_retries:2}}};
 let admission=!options.initialExpired,source='initial',observed='',c8=!!options.afterC8,metadata=!options.metadata,commits=0,renewals=0,observations=0,finals=0,turns=0,inspections=0,races=options.races||0;
 const expired=()=>Object.assign(Error('ADMISSION_INPUT_CHANGED: receipt expired/clock invalid'),{core_reconciled:!options.unknownRace});
 const gateway:any={pending:new Set(options.pending?[Promise.resolve()]:[]),unknown:options.unknown?[{}]:[],abort:new AbortController(),budget:{deadline,check(){if(options.expiredGrant)throw Error('GRANT_EXPIRED');assert.ok(Date.now()<deadline);}},async invoke(a:any){await prepareDispatchAction(a,{commands:[candidate]},{budget:gateway.budget,mode:gateway.finalizing?'metadata':'implementation',requireWindow:action=>gateway.requireAdmissionWindow(action)});if(a.action==='read')return {sha256:'f'.repeat(64),content:'engineering observation'};assert.equal(a.id,'candidate');commits++;if(options.expireCandidate)admission=false;return {status:'succeeded'};}};
 const core=async(args:string[]):Promise<any>=>{
  if(args[1]==='next')return context.binding.stage_instance==='build-and-test'&&!c8?{kind:'run-stage',stage:'build-and-test',stage_instance:'build-and-test',approval:'notify'}:{kind:'print',preview:true,stage_instance:null,next_stage:null,next_stage_status:'none'};
  if(args[2]==='host'&&args[3]==='context')return {host_context:{binding:context.binding,implementation_units:[{unit_ref:{module_id:'project',unit_id:'default'},review_completed:true}],c8_completed:c8,source_digest:source,progress_digest:String(c8)}};
  if(args[2]==='host'&&args[3]==='select')return {host_context:{binding:{...context.binding,stage_instance:args.at(-1)}}};
  if(args[2]==='admission'){
   if(args[3]==='inspect'){inspections++;if(options.malformed)return {};return {autonomous_admission:{admission_result:admission?'ready':'not-ready',valid_until:new Date(Date.now()+900000).toISOString()}};}
   assert.equal(args[3],'run');assert.equal(context.binding.stage_instance,'workspace-detection');assert.ok(args.includes('frozen-admission'));renewals++;admission=!options.notReady;
   return {autonomous_admission:{admission_result:admission?'ready-with-delegated-decisions':'not-ready',valid_until:new Date(Date.now()+900000).toISOString(),checks:options.notReady?[{check_id:'host-capabilities',status:'failed',reason:'HOST_UNSUPPORTED'}]:[]}};
  }
  if(args[2]==='observe'){
   if(args.includes('--dependency-preflight'))return {autonomous_observations:{status:'not-applicable'}};
   if(args[3]==='run'){
    if(races-->0){admission=false;throw expired();}
    if(!admission)throw expired();observations++;observed=source;if(options.expireObservation)admission=false;
   }
   return {autonomous_observations:{status:observed===source?'passed':'unverified',receipt_ref:{path:'.aidlc/evidence/engineering.json'},producer:{stage_instance:'build-and-test'}}};
  }
  if(args[2]==='decisions')return {autonomy_decisions:{completion_blockers:[],decisions:metadata?[]:[{unit_ref:{module_id:'project',unit_id:'default'},completion_blockers:['implementation-missing']}],write_contract:{schema:'aidlc.decision-write-contract/v1',updates:[{decision_id:'engineering',proposal:{unit_ref:{module_id:'project',unit_id:'default'}},runtime_validation_templates:[],required_check_ids:[]}]}}};
  if(args[2]==='batch'){if(!admission)throw expired();finals++;return {autonomous_batch_result:{engineering_result:c8&&observed===source?'verified':'incomplete',batch_completed:c8&&observed===source,checks:[]}};}
  throw Error('Unexpected engineering Core command '+JSON.stringify(args));
 };
 const client={async turn(){turns++;if(gateway.finalizing){assert.equal(gateway.readyInstance,null);metadata=true;source='metadata-final';if(options.expireMetadata)admission=false;}else{assert.ok(metadata);assert.equal(gateway.readyInstance,'build-and-test');c8=true;}return {status:'completed'};}};
 const config={commands:[candidate],observation_plan:'frozen-plan',admission_plan:options.noPlan?undefined:'frozen-admission',candidate_command:'candidate'};
 return {context,gateway,core,client,config,run:()=>driveBatch(config,context,core,client,gateway),stats:()=>({commits,renewals,observations,finals,turns,inspections}),deadline};
}
async function check(name:string,options:any,expected:string,verify?:(f:ReturnType<typeof fixture>)=>void){const f=fixture(options);assert.equal(await f.run(),expected);assert.equal(f.gateway.budget.deadline,f.deadline);assert.equal(Date.parse(f.context.grant.expires_at),f.deadline);verify?.(f);count++;console.log('PASS '+name);}
try{
 await check('candidate completion followed by expired admission renews before first full observation',{expireCandidate:true},'batch-verified',f=>{assert.equal(f.stats().commits,1);assert.equal(f.stats().renewals,1);});
 await check('metadata mutation gets one new candidate and renewed admission before observation',{metadata:true,expireMetadata:true},'batch-verified',f=>{assert.equal(f.stats().commits,2);assert.equal(f.stats().renewals,1);assert.equal(f.stats().observations,2);});
 await check('receipt expiring during full observation renews before final convergence',{afterC8:true,expireObservation:true},'batch-verified',f=>{assert.equal(f.stats().commits,1);assert.equal(f.stats().renewals,1);assert.equal(f.stats().observations,1);assert.equal(f.stats().finals,1);});
 await check('reconciled admission race retries without repeating an already completed commit',{races:1},'batch-verified',f=>{assert.equal(f.stats().commits,1);assert.equal(f.stats().renewals,1);});
 await check('unsupported fresh admission stops before any candidate or model turn',{initialExpired:true,notReady:true},'admission-not-ready',f=>{assert.equal(f.stats().renewals,1);assert.equal(f.stats().commits,0);assert.equal(f.stats().turns,0);});
 await check('expired receipt without a frozen reception plan fails closed',{initialExpired:true,noPlan:true},'admission-plan-required',f=>assert.equal(f.stats().commits,0));
 for(const option of ['pending','unknown'])await check(option+' operations prevent inspection, commit and renewal',{[option]:true},'operations-unreconciled',f=>{assert.equal(f.stats().commits,0);assert.equal(f.stats().renewals,0);assert.equal(f.stats().inspections,0);});
 for(const [name,options,pattern]of [
  ['original grant expiry',{expiredGrant:true},/GRANT_EXPIRED/],
  ['malformed inspect',{malformed:true},/HOST_ADMISSION_INSPECT_INVALID/],
  ['unreconciled Core admission error',{races:1,unknownRace:true},/ADMISSION_INPUT_CHANGED/],
  ['repeated races exhaust original equivalent retry budget',{races:4},/ADMISSION_INPUT_CHANGED/],
 ] as [string,any,RegExp][]){const f=fixture(options);await assert.rejects(f.run,pattern);assert.equal(f.gateway.budget.deadline,f.deadline);assert.ok(f.stats().renewals<=2);assert.ok(f.stats().commits<=1);if(options.unknownRace)assert.equal(f.stats().renewals,0);count++;console.log('PASS '+name);}
 console.log('Admission barriers: '+count+' engineering scenarios passed; no authority, deadline or business verdict is fabricated');
}finally{for(const [name,value]of Object.entries({AIDLC_SESSION_BINDING:inherited.binding,AIDLC_COORDINATOR_BINDING:inherited.coordinator})){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
