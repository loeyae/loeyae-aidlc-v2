/** Engineering scope regression: seeded design/model, real Core, Native producers and signed observation.
 * Demonstrates the C8 metadata boundary; never a genuine Codex business result. */
import assert from 'node:assert/strict';import { mkdtempSync,readFileSync,existsSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';import { join,dirname,resolve } from 'node:path';import { createRequire } from 'node:module';
import { batchFixture } from './helpers/batch-fixture';import { ref } from './helpers/observation-fixture';
import { observationHash } from '../core/tools/aidlc-observation-inputs';
import { runObservations } from '../core/tools/aidlc-observations';import { releaseSession,claimToken } from '../core/tools/aidlc-session';
import { Gateway,coreResponse,decisionCompletionGuidance } from '../harness/codex/runtime/aidlc-codex-host.mjs';
const repo=resolve(import.meta.dirname,'..'),K=createRequire(import.meta.url)('../harness/codex/runtime/host-kernel.cjs');
const scratch=mkdtempSync(join(tmpdir(),'aidlc-delegated-scope-')),env={...process.env};let f:any,gateway:any,context:any;
try{
 f=await batchFixture(scratch,'planned-delegation',{beforeC8:true,writePaths:['src','tests','docs/aidlc','delivery']});process.env.AIDLC_SESSION_BINDING=f.coordinator;process.env.AIDLC_COORDINATOR_BINDING=f.coordinator;
 // Reproduce the actual public CLI's silent successful phase transport with a real Native producer.
 const originalCoordinator=process.env.AIDLC_SESSION_BINDING!;
 const invokeCore=async(args:string[])=>await K.command([process.execPath,join(repo,'node_modules/tsx/dist/cli.mjs'),join(repo,'bin/cli.ts'),...args],{cwd:f.root,env:process.env,timeout_ms:120000});
 const selected=coreResponse(await invokeCore(['orchestrate','autonomy','host','select','--instance','code-generation@module:orders@unit:publish']),['orchestrate','autonomy','host','select']).host_context.binding;
 process.env.AIDLC_SESSION_BINDING=JSON.stringify(selected);
 const greenArgs=['evidence','run','--stage','code-generation','--module','orders','--unit','publish','--sensor','green-test-evidence','--refresh'];
 const phase=await invokeCore(greenArgs);assert.equal(phase.exit_code,0,phase.stderr);assert.equal(phase.reconciled,true);assert.equal(phase.stdout.trim(),'');
 const transported=coreResponse(phase,greenArgs);assert.equal(transported.execution_status,'command-completed');assert.equal(transported.evidence_verified,false);
 releaseSession(f.root,selected.stage_instance,claimToken(f.current().active_instances[selected.stage_instance]));process.env.AIDLC_SESSION_BINDING=originalCoordinator;
 console.log('PASS actual public CLI single GREEN producer succeeds silently and is transported as command completion only');
 const planned=f.decision();Object.assign(planned,{policy_clause:'category:layout',question:'Preserve the public async exportOrders signature?',chosen_option:'Keep the existing async exportOrders API',action:'choose-compatible-layout',source_refs:[f.item('GAP-002'),f.item('REQ-001'),f.item('AC-001')],affected_refs:[f.item('GAP-002')]});
 const initial=f.record(planned);assert.ok(initial.completion_blockers.length);
 f.commit();await f.restart();assert.notEqual(f.run().admission_result,'not-ready');
 const observed=await runObservations(f.root,'fixtures/observation-plan.json');assert.equal(observed.status,'passed');
 // The engineering helper retained its actual C7 binding; release it normally.
 const held=f.bind('code-review@module:orders@unit:publish');releaseSession(f.root,held.stage_instance,claimToken(f.current().active_instances[held.stage_instance]));process.env.AIDLC_SESSION_BINDING=f.coordinator;
 const core=async(args:string[])=>coreResponse(await K.command([process.execPath,join(repo,'node_modules/tsx/dist/cli.mjs'),join(repo,'bin/cli.ts'),...args],{cwd:f.root,env:process.env,timeout_ms:120000}),args);
 context=(await core(['orchestrate','autonomy','host','context'])).host_context;context.coordinator_binding=context.binding;
 const select=async(instance:string)=>{context.binding=(await core(['orchestrate','autonomy','host','select','--instance',instance])).host_context.binding;process.env.AIDLC_SESSION_BINDING=JSON.stringify(context.binding);};
 gateway=new Gateway({core_cli:join(repo,'bin/cli.ts'),commands:[]},f.root,context,core);gateway.finalizing=true;
 const projected=(await core(['orchestrate','autonomy','decisions'])).autonomy_decisions;
 const guidance=decisionCompletionGuidance(projected,observed,observationHash(readFileSync(join(f.root,observed.receipt_ref.path))),context.binding.owner+'/'+context.binding.session_id,{module_id:'orders',unit_id:'publish'});
 const proposal=guidance.updates[0].proposal_path;
 const completed={...guidance.updates[0].proposal,implementation_refs:[ref(f.root,'src/orders.cjs'),ref(f.root,'tests/orders-native.cjs')]};
 assert.equal(completed.validation_refs[0].check_id,'ready');
 const payload={action:'write',path:proposal,operation:'design-write',content:JSON.stringify(completed,null,2)+'\n'};
 await select('build-and-test');
 await assert.rejects(()=>gateway.invoke(payload),/business writes require an exact implement unit|proposal target must belong/);assert.equal(existsSync(join(f.root,proposal)),false);
 console.log('PASS real project C8 binding refuses delegated proposal file writes before mutation');
 await select('code-review@module:orders@unit:publish');assert.equal(gateway.readyInstance,undefined);
 const testBytes=readFileSync(join(f.root,'tests/orders-native.cjs')),redBytes=readFileSync(join(f.root,'.aidlc/evidence/tdd/orders/publish/red-test-evidence.json'));
 await gateway.invoke(payload);
 const handoff=await gateway.invoke({action:'read',path:'docs/aidlc/handoff.md'});
 const result=await gateway.invoke({action:'core',args:['orchestrate','autonomy','record','--input',proposal,'--expect',handoff.sha256]});
 assert.equal(result.autonomy_decisions.completion_blockers.length,0);assert.equal(result.autonomy_decisions.decisions[0].human_review.status,'pending');
 assert.deepEqual(readFileSync(join(f.root,'tests/orders-native.cjs')),testBytes);assert.deepEqual(readFileSync(join(f.root,'.aidlc/evidence/tdd/orders/publish/red-test-evidence.json')),redBytes);
 await assert.rejects(()=>gateway.invoke({action:'write',path:'src/forbidden.cjs',operation:'code-write',content:'bad'}),/FINALIZATION_ONLY/);
 console.log('PASS exact completed unit accepts lawful delegated implementation/observation refs while code, RED and human review remain protected');
}finally{
 gateway?.cancel('engineering-complete');await gateway?.reconcile();
 if(context)for(const b of [context.binding,context.coordinator_binding]){const claim=f.current().active_instances[b.stage_instance];if(claim?.generation===b.generation){process.env.AIDLC_SESSION_BINDING=JSON.stringify(b);releaseSession(f.root,b.stage_instance,claimToken(claim));}}
 if(f?.child?.exitCode===null){const close=new Promise(r=>f.child.once('close',r));f.child.kill();await close;}
 for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);
 assert.equal(resolve(dirname(scratch)),resolve(tmpdir()));rmSync(scratch,{recursive:true,force:true});
}
