import assert from 'node:assert/strict';
import { nativeEvidenceRepair, driveBatch, Gateway } from '../harness/codex/runtime/aidlc-codex-host.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const stage='code-generation@module:shop@unit:api';
const row={requires_human_approval:false,action:'refresh-evidence',stage_instance:stage,sensor:'test-quality',command:['loeyae-aidlc','evidence','run','--stage','code-generation','--module','shop','--unit','api','--all-sensors','--refresh']};
const first={action:'repair',fingerprint:'same-inputs',unchanged_attempts:1,equivalent_retry_allowed:false};
assert.ok(nativeEvidenceRepair([row],first),'first repair remains allowed; false does not mean first execution is forbidden');
assert.equal(nativeEvidenceRepair([row],{...first,action:'diagnose',unchanged_attempts:2}),null,'Core diagnosis forbids another automatic refresh');
const a=nativeEvidenceRepair([row],first);
const b=nativeEvidenceRepair([{...row,sensor:'traceability-matrix',command:['loeyae-aidlc','evidence','run','--refresh','--all-sensors','--instance',stage]}],first);
assert.equal(a.key,b.key,'same dispatched command shares retry budget despite diagnostic or flag order');
const batch=sensors=>({...row,command:['loeyae-aidlc','evidence','run','--instance',stage,'--sensors',sensors,'--refresh']});
assert.equal(nativeEvidenceRepair([batch('a,b')],first).key,nativeEvidenceRepair([batch('b,a')],first).key);
assert.notEqual(a.key,nativeEvidenceRepair([row],{...first,fingerprint:'changed-real-inputs'}).key);
assert.ok(nativeEvidenceRepair([row]),'older Core remains bounded by existing host budget');
for(const patch of [{requires_human_approval:true},{action:'repair-inputs'},{command:['loeyae-aidlc','evidence','run','--sensor','a','--sensor','b']}])assert.equal(nativeEvidenceRepair([{...row,...patch}],first),null);
console.log('PASS native repair: Core diagnosis, canonical command identity, first repair and approval boundaries');

// Actual driver route and final convergence both respect Core's diagnosis.
for(const finalizing of [false,true]){
  const root=mkdtempSync(join(tmpdir(),'aidlc-native-repair-'));
  const binding={stage_instance:stage},ctx={binding,grant:{request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),resource_limits:{wall_time_seconds:60,max_equivalent_retries:1,max_active_units:1},executor_constraints:{initial_binding:binding}}};
  const frozen=JSON.stringify(ctx.grant),c={commands:[],...(finalizing?{observation_plan:'existing-plan'}:{})};
  let repairs=0,turns=0;
  const diagnostics={repair_diagnostics:[row],repair_guidance:{...first,action:'diagnose',unchanged_attempts:2}};
  const core=async args=>{
    if(args[0]==='evidence'){repairs++;throw Error('must not dispatch repeated evidence');}
    if(args[2]==='grant')return {allowed:true};
    if(args[2]==='admission')return {autonomous_admission:{admission_result:'ready',valid_until:new Date(Date.now()+60000).toISOString()}};
    if(args[2]==='host')return {host_context:{binding,c8_completed:true,implementation_units:[{unit_ref:{module_id:'shop',unit_id:'api'},review_completed:true}]}};
    if(args[2]==='observe')return {autonomous_observations:{status:'passed'}};
    if(args[2]==='batch')return {...diagnostics,autonomous_batch_result:{engineering_result:'blocked',checks:[{check_id:'native:quality',status:'blocked'}]}};
    if(args[1]==='next')return finalizing?{kind:'print',preview:true,stage_instance:null,next_stage:null,next_stage_status:'none'}:{kind:'error',stage_instance:stage,...diagnostics};
    throw Error('Unexpected request '+args.join(' '));
  };
  const gateway=new Gateway(c,root,ctx,core);
  try{
    const reason=await driveBatch(c,ctx,core,{async turn(){turns++;throw Error('not a model repair');}},gateway);
    assert.match(reason,/blocked/);assert.equal(repairs,0);assert.equal(turns,0);assert.equal(JSON.stringify(ctx.grant),frozen);
  }finally{gateway.cancel('test-end');await gateway.reconcile();rmSync(root,{recursive:true,force:true});}
}
console.log('PASS actual driver route/finalize: no refresh or model call after diagnosis, grant unchanged');
