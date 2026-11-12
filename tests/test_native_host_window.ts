/** Scheduling fixture: refresh BEFORE a long producer, restore formal binding, preserve original grant. */
import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,dirname} from 'node:path';
import {Gateway,driveBatch,protectedCoreTimeout,requiredAdmissionWindow} from '../harness/codex/runtime/aidlc-codex-host.mjs';
import {nativeProbeValidUntil} from '../core/tools/aidlc-native-host';
const inherited={...process.env},root=mkdtempSync(join(tmpdir(),'aidlc-long-window-'));let gateway:any;
const binding={stage_instance:'workspace-detection',session_id:'engineering-window',owner:'agent'},deadline=Date.now()+3600000;
const context:any={binding,grant:{executor_constraints:{initial_binding:binding},request_started_at:new Date().toISOString(),expires_at:new Date(deadline).toISOString(),resource_limits:{wall_time_seconds:3600,max_equivalent_retries:2,max_active_units:1}}};
let validUntil=Date.now()+90000,renewals=0,executions=0,done=false,formal=0,freshLifetime=900000;
const core=async(args:string[]):Promise<any>=>{
 if(args[2]==='grant')return {allowed:true};
 if(args[2]==='host'&&args[3]==='context')return {host_context:{binding:context.binding,source_digest:'fixture-source',progress_digest:'same',implementation_units:[{unit_ref:{module_id:'project',unit_id:'default'},review_completed:false}]}};
 if(args[2]==='host'&&args[3]==='select')return {host_context:{binding:{...context.binding,stage_instance:args.at(-1)}}};
 if(args[2]==='admission'){if(args[3]==='run'){renewals++;validUntil=Date.now()+freshLifetime;}return {autonomous_admission:{admission_result:'ready',valid_until:new Date(validUntil).toISOString()}};}
 if(args[1]==='next'){if(done)return {kind:'done'};if(!args.includes('--preview'))formal++;return {kind:'run-stage',stage:'tdd',stage_instance:'tdd@module:project@unit:default',approval:'notify'};}
 if(args[0]==='evidence'){
  assert.ok(validUntil-Date.now()>600000,'INSUFFICIENT_WINDOW_DISPATCHED: a ready receipt with only 90 seconds left must not start this producer');
  assert.equal(context.binding.stage_instance,'tdd@module:project@unit:default');assert.equal(gateway.readyInstance,context.binding.stage_instance);executions++;return {execution_status:'command-completed',evidence_verified:false};
 }
 throw Error('Unexpected fixture command '+JSON.stringify(args));
};
try{
 gateway=new Gateway({commands:[],admission_plan:'frozen-admission'},root,context,core);
 let prematureRefresh=0;gateway.requireAdmissionWindow=async()=>{prematureRefresh++;};
 await assert.rejects(()=>gateway.invoke({action:'core',args:['evidence','run','--user-input','approved']}),/CORE_COMMAND_DENIED/);
 await assert.rejects(()=>gateway.invoke({action:'command',id:'unfrozen'}),/COMMAND_NOT_FROZEN/);assert.equal(prematureRefresh,0,'Denied actions must not trigger admission mutation');
 const client={async turn(){await gateway.invoke({action:'core',args:['evidence','run','--stage','tdd','--sensor','red-test-evidence']});done=true;return {status:'completed'};}};
 assert.equal(await driveBatch({admission_plan:'frozen-admission'},context,core,client,gateway),'formal-route-blocked');assert.equal(renewals,1);assert.equal(executions,1);assert.equal(gateway.budget.failures.size,0);assert.equal(gateway.budget.deadline,deadline);assert.ok(formal>=2,'Renewal must restore the exact formal entry before implementation');
 gateway.cancel('scenario-end');await gateway.reconcile();done=false;executions=renewals=0;freshLifetime=90000;validUntil=Date.now()+90000;context.binding=binding;
 gateway=new Gateway({commands:[],admission_plan:'frozen-admission'},root,context,core);
 const short={async turn(){await assert.rejects(()=>gateway.invoke({action:'core',args:['evidence','run','--stage','tdd','--sensor','red-test-evidence']}),/ADMISSION_WINDOW_INSUFFICIENT/);return {status:'interrupted'};}};
 assert.equal(await driveBatch({admission_plan:'frozen-admission'},context,core,short,gateway),'admission-window-insufficient');assert.equal(renewals,1);assert.equal(executions,0);assert.equal(gateway.budget.failures.size,0);assert.equal(gateway.budget.deadline,deadline);
 assert.equal(protectedCoreTimeout(['evidence','run'],100000,50000,0),40000);assert.throws(()=>protectedCoreTimeout(['evidence','run'],100000,9999,0),/WINDOW_EXPIRED/);assert.equal(protectedCoreTimeout(['orchestrate','autonomy','admission','run'],200000,1,0),180000);
 assert.equal(requiredAdmissionWindow({action:'core',args:['evidence','run']},{},60000,1000),49000);assert.throws(()=>requiredAdmissionWindow({action:'core',args:['evidence','run']},{},10000,0),/BUDGET_INSUFFICIENT/);
 const start='2026-01-01T00:00:00.000Z',clock=Date.parse(start);assert.equal(Date.parse(nativeProbeValidUntil(start,clock+3600000,clock+1000)),clock+900000);assert.equal(Date.parse(nativeProbeValidUntil(start,clock+4000,clock+1000)),clock+4000);assert.throws(()=>nativeProbeValidUntil(start,clock+1000,clock+2000),/WINDOW_INVALID/);assert.throws(()=>nativeProbeValidUntil('bad',clock+10000,clock),/WINDOW_INVALID/);
 console.log('PASS a short remaining admission window is renewed before producer dispatch without spending a failed retry or extending the original grant');
}finally{gateway?.cancel('test-end');await gateway?.reconcile();for(const k of Object.keys(process.env))if(!(k in inherited))delete process.env[k];Object.assign(process.env,inherited);assert.equal(resolve(dirname(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});}
