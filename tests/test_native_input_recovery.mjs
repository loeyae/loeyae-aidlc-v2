/** Captured r14 failure replay; fake clock, real Gateway IO, no model or pilot. */
import assert from 'node:assert/strict';import {test} from 'node:test';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import K from '../harness/codex/runtime/host-kernel.cjs';
import {Gateway,CodexClient} from '../harness/codex/runtime/aidlc-codex-host.mjs';
import {createNativeToolChannel} from '../harness/codex/runtime/native-tool-channel.mjs';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
const captured=JSON.parse(fs.readFileSync(new URL('./fixtures/native-r14-write.json',import.meta.url),'utf8'));
function fixture(overrides={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-input-recovery-')),start=Date.now(),events=[];let time=0,checks=0;
 const context={binding:{stage_instance:'tdd@module:project@unit:default'},grant_ref:{digest:'a'.repeat(64)},grant:{request_started_at:new Date(start).toISOString(),expires_at:new Date(start+3600000).toISOString(),resource_limits:{wall_time_seconds:3600,max_equivalent_retries:2,max_active_units:1}}};
 const g=new Gateway({commands:[],supervision_limits:overrides},root,context,async args=>{checks++;assert.ok(args.includes('check'));return {allowed:true};});
 g.budget.now=()=>start+time;g.progress=new K.ProgressBudget(K.supervisionLimits(overrides),g.budget,{now:()=>time,trace:new K.ExecutionTrace(e=>events.push(e),()=>time),onStop:r=>g.cancel(r)});g.readyInstance=context.binding.stage_instance;
 fs.mkdirSync(path.join(root,'tests'));fs.writeFileSync(path.join(root,'requirements.md'),'approved behavior');
 return {g,root,events,checks:()=>checks,at:t=>time=t,close:async()=>{g.cancel('test-end');await g.reconcile();fs.rmSync(root,{recursive:true,force:true});}};
}
test('actual thread/start advertises action-specific requirements and explicit write classes',async()=>{
 let sent;const client={cwd:'fixture',overrides:{},request:async(method,params)=>{assert.equal(method,'thread/start');sent=params;return {thread:{id:'fixture'}};}};
 await CodexClient.prototype.start.call(client);
 const schema=sent.dynamicTools[0].inputSchema;
 for(const [action,required]of Object.entries({read:['path'],rule:['path'],write:['path','content','operation'],command:['id'],core:['args']})){
  const branch=schema.anyOf.find(b=>b.properties.action.enum[0]===action);assert.deepEqual(branch.required,['action',...required]);assert.equal(branch.additionalProperties,false);
 }
 assert.deepEqual(schema.properties.operation.enum,['code-write','test-write','design-write']);
 const branch=schema.anyOf.find(b=>b.properties.action.enum[0]==='write');assert.equal(branch.required.every(k=>Object.hasOwn(captured.arguments,k)),false);
 assert.deepEqual(Object.keys(captured.arguments),['action','path','content']);
 const validate=new AjvJsonSchemaValidator().getValidator(schema);
 assert.equal(validate(captured.arguments).valid,false);
 assert.equal(validate({...captured.arguments,operation:'test-write'}).valid,true);
 for(const bad of [{...captured.arguments,operation:'deploy'},{...captured.arguments,operation:'test-write',detail:'full'},{action:'read'},{action:'rule',path:'core/x',section:'3',detail:'full'},{action:'core',args:'orchestrate next'},{action:'command',id:'x',argv:['injected']}])assert.equal(validate(bad).valid,false);
 for(const good of [{action:'read',path:'requirements.md'},{action:'rule',path:'core/x',section:'3'},{action:'core',args:['orchestrate','next'],detail:'full'},{action:'command',id:'x'}])assert.equal(validate(good).valid,true);
});
test('captured write is refused without IO; corrected call uses normal grant/path checks',async()=>{
 const f=fixture();try{
  const original=f.g.budget.deadline;
  await assert.rejects(f.g.invoke(captured.arguments),/HOST_WRITE_SCHEMA: write.operation is required; choose code-write, test-write or design-write/);
  assert.equal(fs.existsSync(path.join(f.root,'tests/ucd.cjs')),false);assert.equal(f.checks(),0);assert.equal(f.g.progress.steps,1);assert.equal(f.g.progress.seen.size,0);
  await f.g.invoke({...captured.arguments,operation:'test-write'});
  assert.equal(fs.readFileSync(path.join(f.root,'tests/ucd.cjs'),'utf8'),captured.arguments.content);assert.ok(f.checks()>0);assert.equal(f.g.budget.deadline,original);
 }finally{await f.close();}
});
test('malformed input cannot evade equivalent retries by changing content/path and gets no idle credit',async()=>{
 const f=fixture();try{
  for(let i=0;i<3;i++)await assert.rejects(f.g.invoke({...captured.arguments,path:'tests/'+i,content:String(i)}),/HOST_WRITE_SCHEMA/);
  await assert.rejects(f.g.invoke(captured.arguments),/EQUIVALENT_RETRIES_EXHAUSTED/);
  assert.equal(f.g.progress.steps,4);assert.equal(f.g.progress.withoutProgress,4);assert.equal(f.g.progress.lastProgress,0);assert.equal(f.checks(),0);
 }finally{await f.close();}
});
test('r14 timeline: acquired input permits argument correction without pretending semantic completion',async()=>{
 const f=fixture();try{
  f.g.progress.beginTurn('implementation',f.g.context.binding.stage_instance);
  f.at(44700);await f.g.invoke({action:'read',path:'requirements.md'});
  assert.equal(f.g.progress.seen.size,0);assert.equal(f.g.progress.withoutProgress,1);
  f.at(90510);await assert.rejects(f.g.invoke(captured.arguments),/HOST_WRITE_SCHEMA/);
  f.at(120045);f.g.progress.check(); // The old trace stopped here despite recent input acquisition.
  f.at(125000);await f.g.invoke({...captured.arguments,operation:'test-write'});
  assert.equal(fs.existsSync(path.join(f.root,'tests/ucd.cjs')),true);assert.equal(f.events.filter(e=>e.event==='input-acquired').length,1);
  assert.ok(f.events.some(e=>e.event==='progress'&&e.progress_kind==='work-change'));
 }finally{await f.close();}
});
test('fresh reads remain bounded by existing unproductive steps; duplicates and missing paths do not reset idle',async()=>{
 const f=fixture({max_steps_without_progress:3});try{
  for(let i=0;i<3;i++){fs.writeFileSync(path.join(f.root,`input${i}.md`),'input'+i);f.at(i*100000);await f.g.invoke({action:'read',path:`input${i}.md`});}
  await assert.rejects(f.g.invoke({action:'read',path:'requirements.md'}),/NO_PROGRESS_STEP_LIMIT/);
 }finally{await f.close();}
 const h=fixture();try{
  h.at(1000);await h.g.invoke({action:'read',path:'requirements.md',detail:'full'});
  h.at(110000);await h.g.invoke({action:'read',path:'requirements.md',detail:'full'});
  await assert.rejects(h.g.invoke({action:'read',path:'missing'}),/MISSING_PATH/);
  h.at(121000);assert.throws(()=>h.g.progress.check(),/NO_SEMANTIC_PROGRESS/);
 }finally{await h.close();}
});
test('acquired-input identity survives restore; turn and wall limits still stop fresh input work',async()=>{
 const f=fixture({turn_timeout_ms:100000});try{
  f.g.progress.beginTurn('implementation','tdd');f.at(50000);await f.g.invoke({action:'read',path:'requirements.md'});
  const snapshot=f.g.progress.snapshot(),p=new K.ProgressBudget(K.supervisionLimits(),f.g.budget);p.restore(snapshot);
  assert.equal(p.inputAcquired(snapshot.acquiredInputs[0]),false);assert.equal(p.withoutProgress,1);assert.equal(p.seen.size,0);
  f.at(100000);assert.throws(()=>f.g.progress.check(),/TURN_TIME/);
 }finally{await f.close();}
 const h=fixture();try{h.at(3600000);await assert.rejects(h.g.invoke({action:'read',path:'requirements.md'}),/BUDGET_EXHAUSTED|WALL_TIME/);assert.equal(h.g.progress.acquiredInputs?.size||0,0);}finally{await h.close();}
});
test('native replacement shares missing-field feedback and retry accounting',async()=>{
 const f=fixture();let channel;try{
  channel=createNativeToolChannel(f.g,{currentConfiguration:()=>({}),qualify:()=>({mode:'native-replacement',deadline_at:f.g.budget.deadline,grant_ref:f.g.context.grant_ref})});
  const {action,...args}=captured.arguments;
  await assert.rejects(channel.replaceTool({name:'write_file',arguments:args}),/write.operation is required/);
  assert.equal(f.g.progress.steps,1);assert.equal(f.checks(),0);
  await channel.replaceTool({name:'write_file',arguments:{...args,operation:'test-write'}});assert.ok(f.checks()>0);
 }finally{await channel?.close();await f.close();}
});
test('correction cannot grant permissions or bypass metadata mode and path isolation',async()=>{
 const f=fixture();try{
  f.g.finalizing=true;await assert.rejects(f.g.invoke({...captured.arguments,operation:'test-write'}),/FINALIZATION_ONLY/);
  f.g.finalizing=false;await assert.rejects(f.g.invoke({...captured.arguments,operation:'test-write',path:'../outside'}),/UNSAFE_PATH/);
  await assert.rejects(f.g.invoke({...captured.arguments,operation:'deploy'}),/write.operation must be/);
  assert.equal(fs.existsSync(path.join(f.root,'tests/ucd.cjs')),false);
 }finally{await f.close();}
});
