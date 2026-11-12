/** Stable Core projection boundary, deliberately no workflow or business authority. */
import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Gateway} from '../harness/codex/runtime/aidlc-codex-host.mjs';
const root=mkdtempSync(join(tmpdir(),'aidlc-progress-checkpoint-'));let gateway,answer={kind:'ask',ask_type:'approval'};
try {
 const binding={stage_instance:'code-generation@module:project@unit:default'},grant={request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),resource_limits:{wall_time_seconds:60,max_equivalent_retries:1,max_active_units:1}};
 const core=async args=>args[2]==='grant'?{allowed:true}:args[2]==='host'?{host_context:{input_digest:'a'.repeat(64)}}:answer;
 gateway=new Gateway({commands:[]},root,{binding,grant},core);gateway.requireAdmissionWindow=async()=>{gateway.admissionDeadline=Date.now()+900000;};
 const report={action:'core',args:['orchestrate','report','--stage','code-generation','--result','completed']};
 await gateway.invoke(report);assert.equal(gateway.progress.seen.size,0,'An approval/question response is not an accepted completed report');
 answer={kind:'print'};await gateway.invoke(report);assert.equal(gateway.progress.seen.size,1);await gateway.invoke(report);assert.equal(gateway.progress.seen.size,1,'Identical accepted report cannot manufacture another checkpoint');
 console.log('PASS only accepted print reports establish one stable stage checkpoint; questions do not');
}finally{gateway?.cancel('test-end');await gateway?.reconcile();rmSync(root,{recursive:true,force:true});}
