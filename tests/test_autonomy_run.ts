import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createAdmissionFixture } from "./helpers/autonomy-admission-fixture";
import { captureRunCheckpoint, checkpointInput, inspectRun, autonomyRunDirective } from "../core/tools/aidlc-autonomy-run";
import { readIssuedGrant, storeRunCheckpoint } from "../core/tools/aidlc-grant-store";
import { autonomyDigest } from "../core/tools/aidlc-autonomy-files";
import K from "../harness/codex/runtime/host-kernel.cjs";
const scratch=mkdtempSync(join(tmpdir(),"aidlc-p2-run-")),env={...process.env};let cases=0;
const input=(steps=1,pending_operations:any[]=[])=>({schema:"aidlc.host-checkpoint-input/v1",reason:"context-boundary",budget_observation:{steps,turns:1,active_elapsed_ms:10},pending_operations});
const check=(name:string,fn:()=>void)=>{fn();cases++;console.log("PASS "+name);};
async function main(){
 try{
  const f=createAdmissionFixture(scratch,"run");
  check("unmanaged checkpoints do not create authorization",()=>{assert.equal(inspectRun(f.root).enabled,false);assert.throws(()=>captureRunCheckpoint(f.root,input(),"absent"));});
  await f.issue();const stateBefore=readFileSync(join(f.root,"aidlc/active/aidlc-state.md"));
  const first=captureRunCheckpoint(f.root,input(),"absent"),grant=readIssuedGrant(f.root,f.current().execution_grant_ref!).grant;
  check("first checkpoint binds real grant, source and attempt without recovery authority",()=>{
   assert.equal(first.checkpoint.run_id,grant.run_id);assert.equal(first.checkpoint.grant_ref.digest,f.current().execution_grant_ref!.digest);
   assert.equal(first.checkpoint.claim_ref.binding_digest,autonomyDigest(JSON.parse(process.env.AIDLC_SESSION_BINDING!)));
   assert(first.checkpoint.state_refs.every((r:any)=>grant.workflow_refs.some(ref=>ref.workflow_id===r.workflow_id)));
   assert.equal(first.checkpoint.deadline_at,grant.expires_at);assert.equal(first.recovery_allowed,false);assert.equal(first.execution_authorized,false);assert.equal(first.checkpoint.successor_policy,"disabled");
   assert(!JSON.stringify(first).includes(JSON.parse(process.env.AIDLC_SESSION_BINDING!).generation));
   assert.deepEqual(readFileSync(join(f.root,"aidlc/active/aidlc-state.md")),stateBefore);
  });
  const op={operation_id:"observed-operation",status:"dispatched",binding_digest:"b".repeat(64)};
  const second=captureRunCheckpoint(f.root,input(2,[op]),first.head_digest);
  check("append preserves attempt and deadline; stale CAS is rejected",()=>{
   assert.deepEqual(second.checkpoint.attempt,first.checkpoint.attempt);assert.equal(second.checkpoint.previous_digest,first.head_digest);assert.equal(second.checkpoint.deadline_at,first.checkpoint.deadline_at);
   assert.throws(()=>captureRunCheckpoint(f.root,input(3,[op]),first.head_digest),/CONFLICT/);
   assert.equal(inspectRun(f.root).head_digest,second.head_digest);
  });
  check("pending operations and budgets cannot be reset by checkpoint author",()=>{
   assert.throws(()=>captureRunCheckpoint(f.root,input(1,[op]),second.head_digest),/BUDGET_REGRESSION/);
   assert.throws(()=>captureRunCheckpoint(f.root,input(3,[]),second.head_digest),/OPERATION_RECONCILIATION_REQUIRED/);
   assert.throws(()=>captureRunCheckpoint(f.root,input(3,[{...op,status:"prepared"}]),second.head_digest),/OPERATION_RECONCILIATION_REQUIRED/);
   assert.throws(()=>captureRunCheckpoint(f.root,{...input(3,[op]),budget_observation:{steps:3,turns:1,active_elapsed_ms:600001}},second.head_digest),/BUDGET_INVALID/);
   assert.throws(()=>captureRunCheckpoint(f.root,{...input(3,[op]),candidate_commit:"f".repeat(40)},second.head_digest),/CANDIDATE_CHANGED/);
  });
  let unknown=captureRunCheckpoint(f.root,input(3,[{...op,status:"unknown"}]),second.head_digest);
  check("unknown remains visible and cannot be downgraded or cleared",()=>{
   assert.equal(unknown.requires_operation_reconciliation,true);
   assert.throws(()=>captureRunCheckpoint(f.root,input(4,[op]),unknown.head_digest),/OPERATION_RECONCILIATION_REQUIRED/);
   assert.throws(()=>storeRunCheckpoint(f.root,f.current(),{},unknown.head_digest),/PUBLICATION_INVALID/);
  });
  check("strict input schema rejects secrets, malformed operations and command shapes",()=>{
   for(const v of [{...input(),binding:process.env.AIDLC_SESSION_BINDING},{...input(),reason:"arbitrary secret"},input(1,[{status:"unknown",binding_digest:"b".repeat(64)}]),input(1,[op,op]),{...input(),budget_observation:{steps:NaN,turns:1,active_elapsed_ms:1}}])assert.throws(()=>checkpointInput(v));
   for(const args of [["resume"],["inspect","--input","a"],["checkpoint","--input","a","--input","b"]])assert.throws(()=>autonomyRunDirective(f.root,args));
  });
  check("CLI inspect is read-only across process boundary",()=>{
   const r=f.cli(["autonomy","run","inspect"]);assert.equal(r.status,0,r.stderr+r.stdout);assert.equal(JSON.parse(r.stdout).autonomy_run.head_digest,unknown.head_digest);
  });
  const checkpointFile=join(f.root,"fixtures/checkpoint.json");writeFileSync(checkpointFile,JSON.stringify(input(4,[{...op,status:"unknown"}])));
  const cliArgs=[join(process.cwd(),"node_modules/tsx/dist/cli.mjs"),join(process.cwd(),"bin/cli.ts"),"orchestrate","autonomy","run","checkpoint","--input","fixtures/checkpoint.json","--expect",unknown.head_digest];
  const race=()=>new Promise<{code:number|null;text:string}>((resolve,reject)=>{const p=spawn(process.execPath,cliArgs,{cwd:f.root,env:{...process.env},windowsHide:true,timeout:30000});let text="";p.stdout.on("data",b=>text+=b);p.stderr.on("data",b=>text+=b);p.on("error",reject);p.on("close",code=>resolve({code,text}));});
  const contenders=await Promise.all([race(),race()]);
  check("two actual CLI publishers with one expected token commit at most once",()=>{
   assert.equal(contenders.filter(r=>r.code===0).length,1,JSON.stringify(contenders));
   assert.equal(inspectRun(f.root).checkpoint.sequence,4);assert.deepEqual(inspectRun(f.root).checkpoint.attempt,first.checkpoint.attempt);
  });
  unknown=inspectRun(f.root);
  const saved=process.env.AIDLC_SESSION_BINDING;
  check("wrong session or generation cannot publish",()=>{const b=JSON.parse(saved!);for(const patch of [{session_id:"other"},{generation:"wrong"}]){process.env.AIDLC_SESSION_BINDING=JSON.stringify({...b,...patch});assert.throws(()=>captureRunCheckpoint(f.root,input(4,[]),unknown.head_digest));}process.env.AIDLC_SESSION_BINDING=saved;});
  check("host action dispatch excludes model checkpoint or resume",()=>{
   const args=["orchestrate","autonomy","run","checkpoint","--input","checkpoint.json","--expect",unknown.head_digest];
   assert.throws(()=>K.describeAction({action:"core",args},{commands:[]}),/DENIED/);
   assert.equal(K.describeAction({action:"core",args},{commands:[]},{origin:"host"}).operation,"workflow-write");
   assert.throws(()=>K.describeAction({action:"core",args:["orchestrate","autonomy","run","resume"]},{commands:[]},{origin:"host"}),/DENIED/);
  });
  const directory=join(f.root,".git/aidlc/autonomy/runs",readdirSync(join(f.root,".git/aidlc/autonomy/runs"))[0]),file=join(directory,"000002.json"),bytes=readFileSync(file);
  check("tampering and torn append fail closed without workflow mutation",()=>{
   const changed=JSON.parse(bytes.toString());changed.sequence=99;writeFileSync(file,JSON.stringify(changed));assert.throws(()=>inspectRun(f.root),/tampered/);writeFileSync(file,bytes);
   writeFileSync(join(directory,"000005.json"),"{");assert.throws(()=>inspectRun(f.root));assert.throws(()=>captureRunCheckpoint(f.root,input(5,[]),unknown.head_digest));rmSync(join(directory,"000005.json"));
   assert.deepEqual(readFileSync(join(f.root,"aidlc/active/aidlc-state.md")),stateBefore);
  });
  const clock=Date.now;
  check("expired grant cannot write; historical inspection remains possible",()=>{Date.now=()=>Date.parse(grant.expires_at)+1;try{assert.throws(()=>captureRunCheckpoint(f.root,input(4,[]),unknown.head_digest));assert.equal(inspectRun(f.root).head_digest,unknown.head_digest);}finally{Date.now=clock;}});
  await f.revoke();
  check("revocation prevents append and never hides prior unknown",()=>{assert.throws(()=>captureRunCheckpoint(f.root,input(4,[]),unknown.head_digest));assert.equal(inspectRun(f.root).requires_operation_reconciliation,true);});
  console.log(`P2-01: ${cases} boundaries passed; no real host restart, successor or business trial`);
 }finally{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);assert.equal(resolve(dirname(scratch)),resolve(tmpdir()));rmSync(scratch,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
