/** Engineering model/reviewer and H4 fixture; real CLI, Native phases, signed observations and convergence.
 * Never a real Codex pilot or human approval. The planned decision exists BEFORE fixture grant issuance. */
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';import { dirname,join,resolve } from 'node:path';import { createRequire } from 'node:module';
import { batchFixture } from './helpers/batch-fixture';import { ref } from './helpers/observation-fixture';
import { coreResponse,driveBatch,Gateway,modelProjection } from '../harness/codex/runtime/aidlc-codex-host.mjs';
const repository=resolve(import.meta.dirname,'..'),inherited={...process.env},K=createRequire(import.meta.url)('../harness/codex/runtime/host-kernel.cjs');
const scratch=mkdtempSync(join(tmpdir(),'aidlc-host-delegated-convergence-'));let f:any,gateway:any;
const packets:any[]=[];let verdict:string|undefined;
try{
 f=await batchFixture(scratch,'planned-h4',{beforeC8:true,plannedDecision:true,writePaths:['src','tests','docs/aidlc','delivery']});
 process.env.AIDLC_COORDINATOR_BINDING=f.coordinator;f.bind('code-review@module:orders@unit:publish');
 const core=async(args:string[])=>{
  const response=coreResponse(await K.command([process.execPath,join(repository,'node_modules/tsx/dist/cli.mjs'),join(repository,'bin/cli.ts'),...args],{cwd:f.root,env:process.env,timeout_ms:120000}),args);
  packets.push({args,response:modelProjection(response)});return response;
 };
 const context=(await core(['orchestrate','autonomy','host','context'])).host_context;context.coordinator_binding=JSON.parse(f.coordinator);
 const config={core_cli:join(repository,'bin/cli.ts'),commands:[],observation_plan:'fixtures/observation-plan.json'};
 gateway=new Gateway(config,f.root,context,core);
 const red=readFileSync(join(f.root,'.aidlc/evidence/tdd/orders/publish/red-test-evidence.json')),tests=readFileSync(join(f.root,'tests/orders-native.cjs'));
 let metadataTurns=0,c8Turns=0;
 const client={event(){},async turn(_text:string){
  if(gateway.finalizing){
   metadataTurns++;assert.equal(metadataTurns,1,_text);assert.equal(c8Turns,0,'planned decision must complete BEFORE C8');
   assert.equal(context.binding.stage_instance,'code-review@module:orders@unit:publish');assert.equal(gateway.readyInstance,null);
   assert.equal(f.current().completed_stage_instances.includes('build-and-test'),false);
   await assert.rejects(()=>gateway.invoke({action:'write',path:'src/forbidden.cjs',content:'bad',operation:'code-write'}),/FINALIZATION_ONLY/);
   await assert.rejects(()=>gateway.invoke({action:'core',args:['orchestrate','report','--stage','build-and-test','--result','completed']}),/FINALIZATION_ONLY/);
   const observed=(await gateway.invoke({action:'core',args:['orchestrate','autonomy','observe','inspect']})).autonomous_observations;
   assert.equal(observed.status,'passed');const evidence=await gateway.invoke({action:'read',path:observed.receipt_ref.path});
   const guidance=JSON.parse(_text.slice(_text.lastIndexOf('\n')+1)).write_contract;assert.equal(guidance.template_only,true);
   const proposal=guidance.updates[0].proposal_path,complete={...guidance.updates[0].proposal,implementation_refs:[ref(f.root,'src/orders.cjs'),ref(f.root,'tests/orders-native.cjs')]};
   assert.equal(complete.validation_refs[0].digest,evidence.sha256);assert.equal(complete.validation_refs[0].path,observed.receipt_ref.path);
   await gateway.invoke({action:'write',path:proposal,content:JSON.stringify(complete,null,2)+'\n',operation:'design-write'});
   const handoff=await gateway.invoke({action:'read',path:'docs/aidlc/handoff.md'});
   const record=await gateway.invoke({action:'core',args:['orchestrate','autonomy','record','--input',proposal,'--expect',handoff.sha256]});
   assert.equal(record.autonomy_decisions.completion_blockers.length,0);assert.equal(record.autonomy_decisions.decisions[0].human_review.status,'pending');
   // Engineering candidate command arrangement: real local commit/restart, no runtime delivery implementation.
   f.commit();await f.restart();process.env.AIDLC_SESSION_BINDING=JSON.stringify(context.coordinator_binding);const admission=f.run();assert.notEqual(admission.admission_result,'not-ready',JSON.stringify(admission.checks.filter((c:any)=>!['passed','not-applicable'].includes(c.status))));process.env.AIDLC_SESSION_BINDING=JSON.stringify(context.binding);
  }else{
   c8Turns++;assert.equal(metadataTurns,1,'host must complete H4 decision before first C8 model turn');assert.equal(c8Turns,1);assert.equal(gateway.readyInstance,'build-and-test');
   await gateway.invoke({action:'core',args:['evidence','run','--stage','build-and-test','--all-sensors']});
   await gateway.invoke({action:'core',args:['orchestrate','report','--stage','build-and-test','--result','completed','--instruction-ack','build-and-test']});
  }
  return {status:'completed'};
 }};
 verdict=await driveBatch(config,context,core,client,gateway);assert.equal(verdict,'batch-verified',JSON.stringify(packets.slice(-2)));
 assert.equal(metadataTurns,1);assert.equal(c8Turns,1);assert.deepEqual(readFileSync(join(f.root,'tests/orders-native.cjs')),tests);assert.deepEqual(readFileSync(join(f.root,'.aidlc/evidence/tdd/orders/publish/red-test-evidence.json')),red);
 const final=packets.findLast(p=>p.response.autonomous_batch_result?.engineering_result==='verified').response.autonomous_batch_result;
 assert.equal(final.decision_refs.length,1);assert.equal(final.decision_refs[0].record_status,'verified');assert.equal(final.decision_refs[0].human_review.status,'pending');
 assert.notEqual(final.decision_refs[0].validation_refs[0].path,final.decision_refs[0].current_validation[0].receipt_ref.path,'current candidate must be observed again after metadata commit');
 console.log('PASS actual public CLI: planned H4 decision -> exact-unit metadata -> new candidate observation -> formal C8 -> Native -> signed engineering convergence');
}finally{
 if(process.env.AIDLC_EVAL_DIR)writeFileSync(join(process.env.AIDLC_EVAL_DIR,'native-host-delegated-core-packets.json'),JSON.stringify({kind:'engineering-planned-decision-integration',business_verified:false,verdict:verdict??null,packets},null,2)+'\n');
 gateway?.cancel('engineering-complete');await gateway?.reconcile();
 if(f?.child?.exitCode===null){const closed=new Promise(r=>f.child.once('close',r));f.child.kill();await closed;}
 for(const key of Object.keys(process.env))if(!(key in inherited))delete process.env[key];Object.assign(process.env,inherited);
 assert.equal(resolve(dirname(scratch)),resolve(tmpdir()));rmSync(scratch,{recursive:true,force:true});
}
