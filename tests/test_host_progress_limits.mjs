/** Fake-clock production budgets/trace; no model, subprocess or workflow. */
import assert from 'node:assert/strict';import {test} from 'node:test';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import K from '../harness/codex/runtime/host-kernel.cjs';
const limits=K.supervisionLimits();
function fixture(overrides={}){
 let mono=0,wall=1000;const events=[],stops=[];
 const budget=new K.Budget({wall_time_seconds:1000,max_equivalent_retries:2,max_active_units:1},1000001,()=>wall);
 const trace=new K.ExecutionTrace(row=>events.push(row),()=>mono,()=>new Date(1700000000000+wall).toISOString());
 const progress=new K.ProgressBudget(K.supervisionLimits(overrides),budget,{now:()=>mono,trace,onStop:r=>stops.push(r)});
 return {progress,budget,trace,events,stops,tick(ms){mono+=ms;wall+=ms;},wall(value){wall=value;}};
}
test('supervision is frozen and can only tighten known positive limits',()=>{
 assert.ok(Object.isFrozen(limits));for(const change of [{max_steps:0},{max_turns:65},{idle_timeout_ms:NaN},{resume:true},[]])assert.throws(()=>K.supervisionLimits(change),/CONFIG_INVALID/);
 assert.equal(K.supervisionLimits({max_steps:4}).max_steps,4);
});
test('actual host configuration validates limits and pins their changes into HostRef',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-supervision-config-')),file=path.join(root,'host.json');
 try{const base={schema:'aidlc.codex-host/v1',codex_entrypoint:process.execPath,core_cli:process.execPath,commands:[]};fs.writeFileSync(file,JSON.stringify(base));const before=K.identity(file);assert.equal(K.config(file).supervision_limits.max_steps,limits.max_steps);
  fs.writeFileSync(file,JSON.stringify({...base,supervision_limits:{max_steps:16}}));assert.equal(K.config(file).supervision_limits.max_steps,16);assert.notEqual(K.identity(file).config_digest,before.config_digest);
  fs.writeFileSync(file,JSON.stringify({...base,supervision_limits:{max_steps:513}}));assert.throws(()=>K.config(file),/SUPERVISION_CONFIG_INVALID/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('interleaved identical outcomes stop; genuinely new observed inputs are not equivalent',()=>{
 const f=fixture({max_repeated_actions:2});
 for(const pair of [['a','v1'],['b','v1'],['a','v2'],['a','v1'],['b','v2']])f.progress.observation(...pair);
 assert.throws(()=>f.progress.observation('a','v1'),/REPEATED_ACTION/);assert.deepEqual(f.stops,['repeated-action']);assert.equal(f.budget.failures.size,0);
});
test('raw observations and heartbeats do not reset idle or unproductive steps',()=>{
 const f=fixture({max_steps_without_progress:3,idle_timeout_ms:20});
 for(let i=0;i<3;i++){f.progress.beginStep('read','tdd',String(i).padStart(64,'0'));f.progress.endStep('succeeded');f.progress.observation('read-'+i,'new');}
 assert.throws(()=>f.progress.beginStep('read','tdd','a'.repeat(64)),/NO_PROGRESS_STEP_LIMIT/);
 const g=fixture({idle_timeout_ms:20});g.tick(19);g.trace.emit('heartbeat');g.progress.observation('fresh','new');g.tick(1);assert.throws(()=>g.progress.check(),/NO_SEMANTIC_PROGRESS/);
});
test('actual novel work resets idle, oscillation and duplicate checkpoints do not',()=>{
 const f=fixture({idle_timeout_ms:20});f.tick(19);assert.ok(f.progress.checkpoint('work-change','first'));f.tick(19);assert.equal(f.progress.checkpoint('work-change','first'),false);f.tick(1);assert.throws(()=>f.progress.check(),/NO_SEMANTIC_PROGRESS/);
});
test('step/turn/run limits remain separate and survive new turns or input changes',()=>{
 const f=fixture({max_steps_per_turn:1,max_turns:2,max_steps:2});f.progress.beginTurn('implementation','tdd');f.progress.beginStep('read','tdd','a'.repeat(64));f.progress.endStep('succeeded');
 assert.throws(()=>f.progress.beginStep('read','tdd','b'.repeat(64)),/TURN_STEP_LIMIT/);
 const g=fixture({max_turns:2});for(let i=0;i<2;i++){g.progress.beginTurn('metadata','code-review');g.progress.checkpoint('decision-publication',String(i));g.progress.endTurn('completed');}
 assert.throws(()=>g.progress.beginTurn('repair-diagnosis','code-review'),/TURN_LIMIT/);
 const h=fixture({max_steps:2});for(let i=0;i<2;i++){h.progress.beginStep('read','tdd','a'.repeat(64));h.progress.endStep('succeeded');h.progress.checkpoint('work-change',String(i));}assert.throws(()=>h.progress.beginStep('read','tdd','a'.repeat(64)),/STEP_LIMIT/);
});
test('step time and turn time are independently enforced',()=>{
 const f=fixture({step_timeout_ms:10});f.progress.beginStep('read','tdd','a'.repeat(64));f.tick(10);assert.throws(()=>f.progress.check(),/STEP_TIME/);
 const g=fixture({turn_timeout_ms:20});g.progress.beginTurn('implementation','tdd');g.tick(19);g.progress.checkpoint('work-change','actual');g.tick(1);assert.throws(()=>g.progress.check(),/TURN_TIME/);
});
test('known bounded work pauses idle/model time, never the original wall or its own deadline',()=>{
 const f=fixture({idle_timeout_ms:20,turn_timeout_ms:30,step_timeout_ms:10});const original=f.budget.deadline;
 f.progress.beginTurn('implementation','code-generation');f.progress.beginStep('command','code-generation','a'.repeat(64));f.tick(9);const outer=f.progress.beginBounded(100),inner=f.progress.beginBounded(80);
 f.tick(70);f.progress.check();f.progress.endBounded(inner);f.progress.endBounded(outer);f.progress.endStep('succeeded');f.tick(10);f.progress.check();f.tick(1);assert.throws(()=>f.progress.check(),/NO_SEMANTIC_PROGRESS/);assert.equal(f.budget.deadline,original);
 const g=fixture({idle_timeout_ms:10});g.progress.beginBounded(100);g.tick(100);assert.throws(()=>g.progress.check(),/STEP_TIME/);
 const h=fixture();h.progress.beginBounded(10000000);h.tick(999001);h.wall(0);assert.throws(()=>h.progress.check(),/WALL_TIME/,'Wall-clock rollback never extends the grant budget');
});
test('nested and overlapping intervals produce a single additive phase partition',()=>{
 const f=fixture(),model=f.trace.start('model-rpc',{family:'turn'});f.tick(10);const queue=f.trace.start('queue',{family:'tool-queue'},model);f.tick(10);const step=f.trace.start('host-control',{family:'read'},model);f.tick(10);f.trace.end(queue);f.tick(10);const producer=f.trace.start('producer',{family:'command'},step);f.tick(20);f.trace.end(producer);f.tick(10);f.trace.end(step);f.tick(10);f.trace.end(model);
 const result=f.trace.summary();assert.equal(result.wall_duration_ms,80);assert.equal(Object.values(result.phases_ms).reduce((a,b)=>a+b,0),80);assert.equal(result.phases_ms.producer,20);assert.equal(result.phases_ms.queue,10);assert.equal(result.active_spans,0);
});
test('trace accepts only safe structured fields, never private bindings or arbitrary payloads',()=>{
 const f=fixture();for(const data of [{generation:'x'},{env:'secret'},{input_digest:'secret'},{family:'token=secret value'},{count:-1},{private_key:'secret'}])assert.throws(()=>f.trace.emit('activity',data),/TRACE_/);
 assert.doesNotMatch(JSON.stringify(f.events),/secret|private_key|generation/);
});
