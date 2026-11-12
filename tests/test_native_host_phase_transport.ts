/** Engineering transport boundaries; command completion never attests a Native gate or business delivery. */
import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname,resolve} from 'node:path';
import {coreResponse,Gateway} from '../harness/codex/runtime/aidlc-codex-host.mjs';
const args=(sensor:string)=>['evidence','run','--stage',sensor==='green-test-evidence'?'code-generation':'tdd','--sensor',sensor];
const good={status:'succeeded',exit_code:0,reconciled:true,stdout:'',stderr:''};let count=0;
for(const sensor of ['red-test-evidence','green-test-evidence','baseline-test-evidence']){const r=coreResponse(good,args(sensor));assert.equal(r.execution_status,'command-completed');assert.equal(r.evidence_verified,false);assert.notEqual(r.status,'passed');count++;}
for(const [r,a]of [[{...good,status:'failed',exit_code:2,stderr:'ADMISSION_INPUT_CHANGED: receipt expired/clock invalid'},args('green-test-evidence')],[{...good,status:'unknown',reconciled:false},args('green-test-evidence')],[{...good,exit_code:1},args('green-test-evidence')],[{...good,stdout:'not JSON'},args('green-test-evidence')],[good,['orchestrate','next']],[good,args('test-quality')]] as any[]){assert.throws(()=>coreResponse(r,a));count++;}
try{coreResponse({...good,status:'unknown',reconciled:false,stderr:'ADMISSION_INPUT_CHANGED: receipt expired/clock invalid'},args('green-test-evidence'));assert.fail('Unknown Core process must fail');}catch(e:any){assert.equal(e.core_reconciled,false);count++;}
const root=mkdtempSync(join(tmpdir(),'aidlc-empty-phase-'));let gateway:any;
try{
 const context={binding:{stage_instance:'code-generation@module:project@unit:default'},grant:{resource_limits:{wall_time_seconds:60,max_equivalent_retries:2,max_active_units:1},request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString()}};
 let executions=0;const core=async(a:string[])=>a[2]==='grant'?{allowed:true}:a[2]==='host'?{host_context:{source_digest:'transport-fixture'}}:(executions++,coreResponse(good,a));
 gateway=new Gateway({commands:[]},root,context,core);gateway.requireAdmissionWindow=async()=>{gateway.admissionDeadline=Date.now()+900000;}; // Isolated engineering transport fixture; scheduling is tested separately.
 for(let i=0;i<4;i++)assert.equal((await gateway.invoke({action:'core',args:args('green-test-evidence')})).execution_status,'command-completed');assert.equal(executions,4);assert.equal(gateway.budget.failures.size,0);count++;
 console.log('Phase transport: '+count+' engineering scenarios passed; silent command success does not claim evidence validity');
}finally{gateway?.cancel('test-complete');await gateway?.reconcile();assert.equal(resolve(dirname(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});}
