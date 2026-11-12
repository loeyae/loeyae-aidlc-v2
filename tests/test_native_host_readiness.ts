/** Host adapter engineering boundaries; no human authentication, model run or business acceptance is simulated. */
import assert from 'node:assert/strict';import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,linkSync } from 'node:fs';import { join,dirname,resolve } from 'node:path';import { tmpdir } from 'node:os';import {createRequire} from 'node:module';
import { Gateway,coreResponse,completionOnly,coreCommandTimeout,emptyLocalPreview } from '../harness/codex/runtime/aidlc-codex-host.mjs';
import {businessCommandEnvironment} from '../core/tools/aidlc-spawn';
import {parseUiPagePlanContent} from '../core/tools/aidlc-ui-governance';
const K=createRequire(import.meta.url)('../harness/codex/runtime/host-kernel.cjs'),root=mkdtempSync(join(tmpdir(),'aidlc-native-readiness-'));let count=0;
const inherited={...process.env},binding={stage_instance:'tdd@module:project@unit:default',owner:'agent',session_id:'engineering-only',workflow_id:'engineering-only'};
let answer:any={kind:'run-stage',stage_instance:binding.stage_instance,approval:'notify',choices:[]};const calls:any[]=[];
const core=async(args:string[])=>{calls.push(args);return args[2]==='grant'?{operation:'allowed-in-this-transport-test-only'}:answer;};
const context={binding,grant:{resource_limits:{wall_time_seconds:60,max_equivalent_retries:1,max_active_units:1},request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString()}};
const gateway=new Gateway({commands:[]},root,context,core,()=>{});
async function test(name:string,fn:()=>unknown){await fn();count++;console.log('PASS '+name);}
try{
  await test('Native phase commands keep their existing ten-minute bound inside the original remaining wall time',()=>{
    assert.equal(coreCommandTimeout(['evidence','run'],undefined,0),600000);assert.equal(coreCommandTimeout(['orchestrate','next'],undefined,0),180000);assert.equal(coreCommandTimeout(['evidence','run'],2500,1000),1500);assert.equal(coreCommandTimeout(['evidence','run'],1000,2000),1);assert.equal(coreCommandTimeout(['module','release'],undefined,2000),180000);
  });
  for(const p of ['.aidlc/evidence/tdd/project/default','.aidlc/commands','.aidlc/autonomy','.git','docs/aidlc','delivery','src'])mkdirSync(join(root,p),{recursive:true});
  const evidence='.aidlc/evidence/tdd/project/default/red-test-evidence.json';writeFileSync(join(root,evidence),JSON.stringify({phase:'RED',binding:{generation:'never-model-visible'},status:'failed'}));writeFileSync(join(root,'.aidlc/commands/tdd.json'),'{"commands":[]}');writeFileSync(join(root,'.git/private-key'),'private-fixture');writeFileSync(join(root,'.aidlc/autonomy/private'),'private-fixture');
  await test('public Native evidence is readable with a raw digest while binding fields remain private',async()=>{
    const r=await gateway.invoke({action:'read',path:evidence});assert.equal(JSON.parse(r.content).phase,'RED');assert.doesNotMatch(r.content,/never-model-visible/);assert.equal(r.sha256,K.hash(readFileSync(join(root,evidence))));
    assert.equal(JSON.parse((await gateway.invoke({action:'read',path:'.aidlc/commands/tdd.json'})).content).commands.length,0);
    assert.deepEqual((await gateway.invoke({action:'read',path:'docs'})).entries.map((e:any)=>e.path),['docs/aidlc']);
  });
  await test('read-only public namespaces never make evidence writable or expose controls, links or Windows aliases',async()=>{
    for(const path of ['.git/private-key','.git./private-key','.aidlc/autonomy/private','.aidlc./autonomy/private','.aidlc/evidence/../../autonomy/private','aidlc/active/aidlc-state.md'])await assert.rejects(()=>gateway.invoke({action:'read',path}));
    await assert.rejects(()=>gateway.invoke({action:'write',path:'.aidlc/evidence/fake.json',content:'{}',operation:'design-write'}));assert.equal(existsSync(join(root,'.aidlc/evidence/fake.json')),false);
    linkSync(join(root,evidence),join(root,'.aidlc/evidence/linked.json'));await assert.rejects(()=>gateway.invoke({action:'read',path:'.aidlc/evidence/linked.json'}),/LINKED/);
  });
  await test('real public print/preview envelopes remain previews in the private adapter',()=>{
    const actual=JSON.parse(readFileSync(resolve('docs/evals/autonomy/p1-10/orders-r2/actual-public-preview.json'),'utf8')).response;
    const r=coreResponse({reconciled:true,status:'succeeded',exit_code:0,stdout:JSON.stringify(actual)},['orchestrate','next','--preview']);assert.equal(r.kind,'run-stage');assert.equal(r.preview,true);assert.equal(r.stage_instance,actual.stage_instance);assert.equal(r.autonomous_admission.admission_result,'not-ready');
  });
  await test('only the exact actual empty preview shape is local exhaustion, never a success verdict',()=>{
    const actual=JSON.parse(readFileSync(resolve('docs/evals/autonomy/p1-10/actual-public-empty-preview.json'),'utf8')).response;
    assert.equal(emptyLocalPreview(actual),true);
    for(const change of [{preview:false},{kind:'ask'},{stage_instance:'build-and-test'},{next_stage:{}},{next_stage_status:'planned'}])assert.equal(emptyLocalPreview({...actual,...change}),false);
    assert.equal(emptyLocalPreview({kind:'print'}),false);
    assert.notEqual(actual.business_verified,true);
  });
  await test('only a fresh exact formal next opens source writes; previews, other instances and choices do not',async()=>{
    answer={kind:'run-stage',preview:true,stage_instance:binding.stage_instance,approval:'notify'};await gateway.invoke({action:'core',args:['orchestrate','next','--preview']});assert.equal(gateway.readyInstance,undefined);
    await gateway.invoke({action:'core',args:['orchestrate','next']});assert.equal(gateway.readyInstance,null);
    for(const next of [{stage_instance:'code-generation@module:other@unit:x'},{stage_instance:binding.stage_instance,approval:'block'},{stage_instance:binding.stage_instance,choices:['human-choice']}]){answer={kind:'run-stage',...next};await gateway.invoke({action:'core',args:['orchestrate','next']});assert.equal(gateway.readyInstance,null);}
    answer={kind:'run-stage',stage_instance:binding.stage_instance,approval:'notify',choices:[]};await gateway.invoke({action:'core',args:['orchestrate','next']});assert.equal(gateway.readyInstance,binding.stage_instance);
    await gateway.invoke({action:'core',args:['orchestrate','autonomy','inspect']});assert.ok(calls.some(args=>args.join(' ')==='orchestrate autonomy inspect'));
  });
  await test('completion repairs are limited to missing artifacts/delegated references, preserving failed Native and human gates',()=>{
    assert.equal(completionOnly({checks:[{check_id:'artifact:run',status:'incomplete'},{check_id:'decision-evidence',status:'blocked'}]}),true);
    for(const check of [{check_id:'complete-acceptance',status:'failed'},{check_id:'native:review',status:'blocked'},{check_id:'delegated-completeness',status:'blocked'},{check_id:'scope-policy',status:'blocked'}])assert.equal(completionOnly({checks:[check]}),false);
    assert.equal(completionOnly({checks:[{check_id:'artifact:run',status:'passed'}]}),false);
  });
  await test('completion mode cannot change code/tests or advance stages and cannot invent a human review',async()=>{
    gateway.finalizing=true;for(const operation of ['code-write','test-write'])await assert.rejects(()=>gateway.invoke({action:'write',operation,path:'src/blocked.cjs',content:'bad'}),/FINALIZATION_ONLY/);
    for(const path of ['src/blocked.html','tests/data.json','delivery/blocked.cjs','docs/aidlc/blocked.ts'])await assert.rejects(()=>gateway.invoke({action:'write',operation:'design-write',path,content:'bad'}),/DESIGN_PATH_REQUIRES/);
    gateway.c.commands=[{id:'mislabelled-write',argv:[process.execPath,'--version'],operation:'validation-execute',timeout_ms:1000,input_paths:[],write_paths:[{path:'src/blocked.html',operation:'design-write'}]}];await assert.rejects(()=>gateway.invoke({action:'command',id:'mislabelled-write'}),/FINALIZATION_ONLY/);
    await assert.rejects(()=>gateway.invoke({action:'core',args:['orchestrate','next']}),/FINALIZATION_ONLY/);assert.equal(existsSync(join(root,'src/blocked.cjs')),false);
    const staged='.aidlc/proposals/decisions/fixture/decision.json';mkdirSync(join(root,'.aidlc/proposals/decisions/fixture'),{recursive:true});writeFileSync(join(root,staged),JSON.stringify({human_review:{status:'approved'}}));await assert.rejects(()=>gateway.invoke({action:'core',args:['orchestrate','autonomy','record','--input',staged,'--expect','absent']}),/CANNOT_ATTEST_HUMAN_REVIEW/);
    gateway.finalizing=false;
  });
  await test('business/model children retain execution data but not any case variant of the four Core authority variables',()=>{
    const source={PILOT_ORIGIN:'http://127.0.0.1:1234',AIDLC_PHASE:'GREEN',AIDLC_SESSION_BINDING:'secret',Aidlc_Coordinator_Binding:'secret',AIDLC_EXECUTION_GRANT:'secret',AIDLC_AUTONOMY_HOST:'secret'};
    const expected={PILOT_ORIGIN:source.PILOT_ORIGIN,AIDLC_PHASE:'GREEN'};assert.deepEqual(K.businessEnv(source),expected);assert.deepEqual(businessCommandEnvironment(source),expected);assert.equal(source.AIDLC_SESSION_BINDING,'secret');
  });
  await test('a Core stage slug in actual page-plan provenance cannot create a phantom page',()=>{
    const actual=readFileSync(resolve('docs/evals/autonomy/p1-10/actual-page-plan-source.md'),'utf8');assert.ok(actual.includes('ui-page-planning'));assert.deepEqual(parseUiPagePlanContent(actual).map(p=>p.page_id),['PAGE-001']);
    assert.deepEqual(parseUiPagePlanContent('ui-page-planning@module:project\n| PAGE-home | REQ-001 | US-001 | AC-001 |').map(p=>p.page_id),['PAGE-HOME']);
  });
  console.log(`Native readiness: ${count} engineering scenarios passed; actual business runs require real H5`);
}finally{gateway.cancel('engineering-test-complete');await gateway.reconcile();for(const k of ['AIDLC_SESSION_BINDING','AIDLC_COORDINATOR_BINDING','AIDLC_EXECUTION_GRANT','AIDLC_AUTONOMY_HOST'])if(inherited[k]===undefined)delete process.env[k];else process.env[k]=inherited[k];assert.equal(resolve(dirname(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});}
