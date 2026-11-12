// Real C7 review producer and its Native gate after candidate + metadata
// commits. This isolates the captured continuation boundary without TDD/model
// prefixes; other C7 sensors and C8/batch completion are outside this fixture.
import assert from "node:assert/strict";
import { readFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fixture, write, git, repository } from "./mars244_fixture";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
import { sensorRepairDiagnostics } from "../core/tools/aidlc-repair-guidance";
import { Gateway } from "../harness/codex/runtime/aidlc-codex-host.mjs";
async function main(){
 const instance="code-review@module:shop@unit:api",f=fixture(instance),sensors=["review-evidence"],timings:any[]=[];let gateway:any;
 try{
  const binding=bindSession(f.root,{instance,owner:"fixture",session:"native-review-refresh",expected:claimToken(undefined)}).binding;
  write(f.root,"docs/aidlc/modules/shop/construction/api/code-review.md","# Review\nreviewer: fixture\nSpec result: passed\nStandards result: passed\nissues_found: 0\nissues_resolved: 0\nissues_open: 0\nReviewed files: src/shop/api/code.ts\n");
  function run(file:string,args:string[]){const start=performance.now(),r=spawnSync(process.execPath,[join(repository,"node_modules/tsx/dist/cli.mjs"),join(repository,file),...args],{cwd:f.root,encoding:"utf8",timeout:30000,env:{...process.env,AIDLC_SESSION_BINDING:JSON.stringify(binding),AIDLC_PROGRESS:"0"}});timings.push({entry:file,duration_ms:performance.now()-start,status:r.status});assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(r.stdout);}
  const initial=run("bin/cli.ts",["evidence","run","--stage","code-review","--module","shop","--unit","api","--sensors",sensors.join(",")]);
  assert(initial.actions.every((a:any)=>!a.evidence_progress));
  const state=loadWorkflowState(f.root)!;state.completed_stage_instances.push(instance);state.completed_stages.push("code-review");delete state.current_stage_instance;state.current_stage="";f.persist(state);
  write(f.root,"src/shop/api/code.ts",readFileSync(join(f.root,"src/shop/api/code.ts"),"utf8")+"\n// Candidate reviewed input.\n");
  git(f.root,"add","src","docs");git(f.root,"commit","-qm","candidate");
  write(f.root,"docs/aidlc/handoff.md","# Final candidate handoff\n");git(f.root,"add","docs/aidlc/handoff.md");git(f.root,"commit","-qm","metadata");
  const probe=()=>run("tests/gate_probe.ts",[instance,"sensors"]).failures.filter((m:string)=>sensors.some(s=>m.startsWith(`[${s}]`)));
  const failures:string[]=probe();assert.equal(failures.length,1,JSON.stringify(failures));
  const diagnostics=sensorRepairDiagnostics(failures.map(message=>({message,sensor:/^\[([^\]]+)\]/.exec(message)![1],stage_instance:instance})),{completed_stage_instances:[instance]});
  const args=diagnostics[0].command!.slice(1);assert(args.includes("--sensor"));
  const repaired=run("bin/cli.ts",args);assert.equal(repaired.evidence_progress?.transition,"invalid-to-current");
  assert.deepEqual(probe(),[],"actual Native review gate accepts the repaired derivation");
  const grant={request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),resource_limits:{wall_time_seconds:60,max_equivalent_retries:1,max_active_units:1}};
  gateway=new Gateway({commands:[]},f.root,{binding,grant},async()=>({}));await gateway.runCore(args,async()=>repaired);
  assert.equal(gateway.progress.seen.size,1);
  const reused=run("bin/cli.ts",args);assert.equal(reused.action,"reused");assert.equal(reused.evidence_progress,undefined);await gateway.runCore(args,async()=>reused);assert.equal(gateway.progress.seen.size,1);
  // Legacy stageInputs fingerprints mtimes. Rewriting identical input bytes
  // can force regeneration, but must not create another semantic target.
  const unchanged=join(f.root,"src/shop/api/code.ts"),later=new Date(Date.now()+60000);utimesSync(unchanged,later,later);
  const touched=run("bin/cli.ts",args);assert.equal(touched.action,"regenerated");assert.equal(touched.evidence_progress?.identity,repaired.evidence_progress.identity);
  await gateway.runCore(args,async()=>touched);assert.equal(gateway.progress.seen.size,1,"indirect mtime/receipt churn is not progress");
  console.log(JSON.stringify({sensors,before:failures.length,after:0,checkpoints:1,timings,real_trial:false,c8_verified:false}));
 }finally{gateway?.cancel("test-end");await gateway?.reconcile();rmSync(f.root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
