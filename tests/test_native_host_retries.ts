/** Engineering tool-key regression from orders-r9; no model/business result is fabricated. */
import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname,resolve} from 'node:path';
import {Gateway} from '../harness/codex/runtime/aidlc-codex-host.mjs';
const root=mkdtempSync(join(tmpdir(),'aidlc-core-retries-'));let gateway:any;let count=0;
const binding={stage_instance:'code-review@module:project@unit:default'},deadline=Date.now()+60000,context={binding,grant:{resource_limits:{wall_time_seconds:60,max_equivalent_retries:1,max_active_units:1},request_started_at:new Date().toISOString(),expires_at:new Date(deadline).toISOString()}};
let executions=0,source='initial';const core=async(args:string[])=>{
 if(args[2]==='grant')return {allowed:true};if(args[2]==='host')return {host_context:{source_digest:source}};
 executions++;throw Object.assign(Error('engineering semantic rejection'),{core_reconciled:true});
};
const record=(path:string,expect='a'.repeat(64),reverse=false)=>({action:'core',args:reverse?['orchestrate','autonomy','record','--expect',expect,'--input',path]:['orchestrate','autonomy','record','--input',path,'--expect',expect]});
try{
 mkdirSync(join(root,'.aidlc/proposals/decisions/workflow'),{recursive:true});writeFileSync(join(root,'.aidlc/proposals/decisions/workflow/a.json'),' {"revision":2,"validation_refs":[],"human_review":{"status":"pending"}} ');writeFileSync(join(root,'.aidlc/proposals/decisions/workflow/alias.json'),'{"validation_refs":[],"human_review":{"status":"pending"},"revision":2}');
 gateway=new Gateway({commands:[]},root,context,core);gateway.requireAdmissionWindow=async()=>{gateway.admissionDeadline=Date.now()+900000;}; // Isolated engineering transport fixture; scheduling is tested separately.
 await assert.rejects(()=>gateway.invoke(record('.aidlc/proposals/decisions/workflow/a.json')),/semantic rejection/);
 await assert.rejects(()=>gateway.invoke(record('.aidlc/proposals/decisions/workflow/alias.json','b'.repeat(64),true)),/semantic rejection/);
 await assert.rejects(()=>gateway.invoke(record('.aidlc/proposals/decisions/workflow/a.json')),/RETRIES_EXHAUSTED/);assert.equal(executions,2,'Filename, JSON formatting, CAS spelling and flag order cannot reset equivalent failures');count++;
 writeFileSync(join(root,'.aidlc/proposals/decisions/workflow/a.json'),'{"revision":2,"validation_refs":[{"check_id":"real-check"}],"human_review":{"status":"pending"}}');
 await assert.rejects(()=>gateway.invoke(record('.aidlc/proposals/decisions/workflow/a.json')),/semantic rejection/);assert.equal(executions,3,'A genuinely changed proposal gets its own bounded attempts');assert.equal(gateway.budget.deadline,deadline);count++;
 await assert.rejects(()=>gateway.invoke(record('.git/issuer.json')),/UNSAFE|READ|MISSING|NOT_ISOLATED|semantic rejection/);assert.equal(executions,3,'Private input paths never dispatch to Core');count++;
 gateway.cancel('scenario-end');await gateway.reconcile();
 executions=0;gateway=new Gateway({commands:[]},root,context,core);gateway.requireAdmissionWindow=async()=>{gateway.admissionDeadline=Date.now()+900000;}; // Isolated engineering transport fixture; scheduling is tested separately.
 const evidence=(reversed=false)=>({action:'core',args:reversed?['evidence','run','--sensor','green-test-evidence','--stage','code-generation']:['evidence','run','--stage','code-generation','--sensor','green-test-evidence']});
 await assert.rejects(()=>gateway.invoke(evidence()),/semantic rejection/);await assert.rejects(()=>gateway.invoke(evidence(true)),/semantic rejection/);await assert.rejects(()=>gateway.invoke(evidence()),/RETRIES_EXHAUSTED/);assert.equal(executions,2);count++;
 source='corrected-real-source';await assert.rejects(()=>gateway.invoke(evidence()),/semantic rejection/);assert.equal(executions,3);assert.equal(gateway.budget.deadline,deadline);count++;
 console.log('Core retry equivalence: '+count+' engineering scenarios passed');
}finally{gateway?.cancel('test-end');await gateway?.reconcile();assert.equal(resolve(dirname(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});}
