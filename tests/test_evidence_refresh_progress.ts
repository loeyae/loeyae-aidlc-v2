// Real CLI/checker/publication -> Gateway. Small isolated producer fixture, no
// pilot, model call, grant issuance, historical recovery or full stage prefix.
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fixture, repository, write, git } from "./mars244_fixture";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
import { Gateway } from "../harness/codex/runtime/aidlc-codex-host.mjs";

async function main() {
 const stage="build-and-test-templates",sensor="template-completeness",f=fixture(stage);
 delete f.state.current_module;delete f.state.current_unit;f.persist();
 const input="docs/aidlc/construction/build-and-test/build-instructions.md";
 for(const name of ["build-instructions.md","unit-test-instructions.md"])write(f.root,`docs/aidlc/construction/build-and-test/${name}`,"# Instructions\nREQ-001: Run the actual project command and inspect the result before delivery.\n");
 write(f.root,`.aidlc/commands/${stage}.json`,{version:"1",stage,commands:[],freshness:{kind:"external",reason:"fixture explicit environment window",max_age_ms:60000}});
 const binding=bindSession(f.root,{instance:stage,owner:"fixture",session:"refresh-progress",expected:claimToken(undefined)}).binding;
 const args=["evidence","run","--stage",stage,"--instance",stage,"--sensors",sensor],refresh=[...args,"--refresh"];
 const calls: Array<{duration_ms:number;status:number|null}>=[];
 function core(command:string[],ok=true,session=JSON.stringify(binding)){
  const start=performance.now(),r=spawnSync(process.execPath,[join(repository,"node_modules/tsx/dist/cli.mjs"),join(repository,"bin/cli.ts"),...command],{cwd:f.root,encoding:"utf8",timeout:30000,env:{...process.env,AIDLC_SESSION_BINDING:session,AIDLC_PROGRESS:"0"}});
  calls.push({duration_ms:performance.now()-start,status:r.status});
  assert.equal(r.status===0,ok,r.stdout+r.stderr);return ok?JSON.parse(r.stdout):r;
 }
 let gateway:any;
 try{
  const initial=core(args);assert.equal(initial.actions[0].evidence_progress,undefined);
  const state=loadWorkflowState(f.root)!;state.completed_stage_instances.push(stage);state.completed_stages.push(stage);delete state.current_stage_instance;state.current_stage="";f.persist(state);
  write(f.root,input,readFileSync(join(f.root,input),"utf8")+"\nREQ-002: Check actual exit code and output.\n");
  // A real content change and candidate commit: no fake receipt-only progress.
  git(f.root,"add","docs");git(f.root,"commit","-qm","candidate");
  const repaired=core(refresh),p=repaired.actions[0].evidence_progress;
  assert.equal(p?.transition,"invalid-to-current");assert.equal(p.workflow_id,state.workflow_id);assert.equal(p.stage_instance,stage);
  const reused=core(refresh);assert.equal(reused.actions[0].action,"reused");assert.equal(reused.actions[0].evidence_progress,undefined);
  const output=join(f.root,".aidlc/evidence",stage,sensor+".json"),prior=JSON.parse(readFileSync(output,"utf8"));
  prior.timestamp="2000-01-01T00:00:00.000Z";writeFileSync(output,JSON.stringify(prior));
  const expired=core(refresh);assert.equal(expired.actions[0].action,"regenerated");assert.equal(expired.actions[0].evidence_progress?.identity,p.identity,"expiry cannot invent a new target");
  rmSync(output);
  const missing=core(refresh);assert.equal(missing.actions[0].evidence_progress?.identity,p.identity,"deleting a receipt cannot invent a new target");
  const grant={request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),resource_limits:{wall_time_seconds:60,max_equivalent_retries:1,max_active_units:1}};
  gateway=new Gateway({commands:[]},f.root,{binding,grant},async()=>({}));
  for(const result of [repaired,reused,expired,missing])await gateway.runCore(refresh,async()=>result);
  assert.equal(gateway.progress.seen.size,1,"actual Core single-target results establish exactly one Gateway checkpoint");
  const before=readFileSync(output);
  core(refresh,false,"invalid-binding");assert.deepEqual(readFileSync(output),before);
  write(f.root,input,"");const failed=core(refresh,false);assert(!failed.stdout.includes('"evidence_progress"'));assert.deepEqual(readFileSync(output),before);
  console.log(JSON.stringify({real_cli_calls:calls,stable_transition:p.transition,checkpoints:gateway.progress.seen.size,real_trial:false}));
 }finally{gateway?.cancel("test-end");await gateway?.reconcile();rmSync(f.root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
