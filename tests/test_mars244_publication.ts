import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { hostname } from "node:os";
import { spawnSync } from "node:child_process";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { generateSlices, type SliceContext } from "../core/tools/aidlc-document-slices";
import { createUiGenerationLock, rebaselineUiDesignResource, uiGenerationLockPath, uiGenerationAcceptancePath, uiGenerationCheckpointsPath } from "../core/tools/aidlc-ui-governance";
import { DESIGN_POLICY } from "../core/tools/aidlc-design-resource";
import { withSessionPublication, lightStatePath, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { fixture, write, snapshot } from "./mars244_fixture";
// Trigger a real handoff after each writer captured its session but before it
// reaches publication. File reads are the computation boundary, not a fake gate.
for (const writer of ["ui", "slices"]) {
  const f = fixture();
  try {
    const instance = f.state.current_stage_instance!;
    const a = bindSession(f.root, { instance, owner: "same-owner", session: "A", expected: claimToken(undefined) });
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(a.binding);
    const read = fs.readFileSync;
    let transferred = false;
    let b: ReturnType<typeof bindSession> | undefined;
    fs.readFileSync = ((p: any, ...args: any[]) => {
      if (!transferred && String(p).replace(/\\/g, "/").endsWith(`${f.base}/requirements.md`)) {
        transferred = true;
        b = bindSession(f.root, { instance, owner: "same-owner", session: "B", expected: claimToken(a.claim), humanInstructionRef: "user:during-computation" });
      }
      return (read as any)(p, ...args);
    }) as typeof fs.readFileSync;
    syncBuiltinESMExports();
    const ctx: SliceContext = { root: f.root, workflow_id: f.state.workflow_id, module_id: "shop", stage: "units-generation", scope: "feature", ui_route: "not-selected" };
    try {
      assert.throws(() => writer === "ui" ? createUiGenerationLock(f.root, { moduleId: "shop", route: "html-mock" }) : generateSlices(ctx), /transferred|conflicts/);
    } finally { fs.readFileSync = read; syncBuiltinESMExports(); }
    assert.equal(transferred, true);
    assert.equal(fs.existsSync(join(f.root, uiGenerationLockPath("shop"))), false);
    assert.equal(fs.existsSync(join(f.root, `${f.base}/document-slices/manifest.json`)), false);
    assert.equal(fs.existsSync(join(f.root, `${f.base}/document-slices/writer.lock`)), false);
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(b!.binding);
    if(writer === "ui") createUiGenerationLock(f.root, { moduleId:"shop", route:"html-mock" }); else generateSlices(ctx);
  } finally { delete process.env.AIDLC_SESSION_BINDING; fs.rmSync(f.root, { recursive:true, force:true }); }
}
// A failed multi-file rebaseline restores all original managed bytes, cleans its
// temporary file and releases the workflow lock so the current session can retry.
const f = fixture();
try {
  const a = bindSession(f.root, { instance: f.state.current_stage_instance!, owner:"owner", session:"A", expected:claimToken(undefined) });
  process.env.AIDLC_SESSION_BINDING = JSON.stringify(a.binding);
  createUiGenerationLock(f.root, {moduleId:"shop",route:"html-mock"});
  const acceptance = uiGenerationAcceptancePath("shop"), checkpoints = uiGenerationCheckpointsPath("shop");
  write(f.root,acceptance,{ full_acceptance:{run_id:"old-review",section_sha256:"a".repeat(64)} });
  write(f.root,checkpoints,"old checkpoint bytes");
  write(f.root,DESIGN_POLICY,{schema:"aidlc.ui-design-policy/v1",project_id:"offline",modules:{shop:{required:false,style:"new-style",platform:"web",team:null,approval_ref:"user:new-style",instance_id:null,contract_digest:null,resource:"offline",arguments:{}}}});
  const before=snapshot(f.root), rename=fs.renameSync;
  fs.renameSync=((from:any,to:any)=>{
    if(String(from).includes(".tmp-")&&String(to).endsWith("ui-generation-lock.json")) throw new Error("injected publish failure");
    return rename(from,to);
  }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  try {assert.throws(()=>rebaselineUiDesignResource(f.root,"shop"),/injected publish failure/);}
  finally{fs.renameSync=rename;syncBuiltinESMExports();}
  assert.deepEqual(snapshot(f.root),before,"rollback preserves old lock, acceptance and checkpoints without temporary leftovers");
  assert.equal(rebaselineUiDesignResource(f.root,"shop").design_resource!.approval_ref,"user:new-style");
} finally{delete process.env.AIDLC_SESSION_BINDING;fs.rmSync(f.root,{recursive:true,force:true});}
console.log("MARS-244 in-flight UI/slice handoff and atomic multi-file UI rebaseline rollback/retry passed");
const slow = fixture();
try {
  const instance = slow.state.current_stage_instance!;
  const a = bindSession(slow.root,{instance,owner:"owner",session:"A",expected:claimToken(undefined)});
  process.env.AIDLC_SESSION_BINDING=JSON.stringify(a.binding);
  withSessionPublication(slow.root,{kind:"global"},instance,()=>{
    const old = new Date(Date.now()-60_000);
    fs.utimesSync(lightStatePath(slow.root)+".lock",old,old);
    assert.throws(()=>bindSession(slow.root,{instance,owner:"owner",session:"B",expected:claimToken(a.claim),humanInstructionRef:"user:slow-publication"}),/timed out waiting for workflow lock/);
    assert.equal(loadWorkflowState(slow.root)!.active_instances[instance].session_id,"A","a live publication cannot lose its lock merely because it is old");
  });
  const b=bindSession(slow.root,{instance,owner:"owner",session:"B",expected:claimToken(a.claim),humanInstructionRef:"user:after-publication"});
  assert.equal(b.claim.session_id,"B","handoff succeeds once publication releases the lock");
  const dead=spawnSync(process.execPath,["-e",""]);
  assert.equal(dead.status,0);
  const lock=lightStatePath(slow.root)+".lock", old=new Date(Date.now()-60_000);
  fs.writeFileSync(lock,JSON.stringify({version:1,hostname:hostname(),pid:dead.pid,lock_id:"confirmed-dead-fixture"}));fs.utimesSync(lock,old,old);
  const c=bindSession(slow.root,{instance,owner:"owner",session:"C",expected:claimToken(b.claim),humanInstructionRef:"user:dead-owner-recovery"});
  assert.equal(c.claim.session_id,"C");assert.equal(fs.existsSync(lock+".recovery"),false);
  fs.writeFileSync(lock,"");fs.utimesSync(lock,old,old);
  assert.throws(()=>bindSession(slow.root,{instance,owner:"owner",session:"D",expected:claimToken(c.claim),humanInstructionRef:"user:unknown-owner"}),/live\/unknown ownership/);
  assert.equal(loadWorkflowState(slow.root)!.active_instances[instance].session_id,"C");
  fs.unlinkSync(lock); // Fixture-only remediation of a known synthetic legacy lock.
}finally{delete process.env.AIDLC_SESSION_BINDING;fs.rmSync(slow.root,{recursive:true,force:true});}
console.log("MARS-244 slow/live and unknown locks cannot be stolen; confirmed dead local owner recovery is serialized");
