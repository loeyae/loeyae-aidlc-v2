import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { loadGraph } from "../core/tools/aidlc-orchestrate";
import { buildEvidenceReusePlan } from "../core/tools/aidlc-evidence-reuse-plan";
import { evidenceSourceRevision } from "../core/tools/aidlc-workflow-layout";
import { fixture, write, cli, repository, git } from "./mars244_fixture";
const instance = "code-review@module:shop@unit:api", f = fixture(instance);
try {
  const binding = bindSession(f.root, { instance, owner:"owner",session:"single-session",expected:claimToken(undefined) }).binding;
  process.env.AIDLC_SESSION_BINDING = JSON.stringify(binding);
  const reviewPath = "docs/aidlc/modules/shop/construction/api/code-review.md";
  const record = "# Review\nreviewer: single-session\nSpec result: passed\nStandards result: passed\nissues_found: 0\nissues_resolved: 0\nissues_open: 0\n审查文件: src/shop/api/code.ts\n";
  write(f.root,reviewPath,record);
  const produced=cli(f.root,["evidence","run","--stage","code-review","--module","shop","--unit","api","--sensor","review-evidence"]);
  assert.equal(produced.status,0,produced.stdout+produced.stderr);
  const evidencePath=".aidlc/evidence/code-review/shop/api/review-evidence.json";
  const payload=JSON.parse(readFileSync(join(f.root,evidencePath),"utf8"));
  assert.equal(payload.reviewer,"single-session");
  for(const field of ["reviewer_agent","execution_context","review_only"])assert.equal(field in payload,false);
  function gate() {
    const r=spawnSync(process.execPath,[join(repository,"node_modules/tsx/dist/cli.mjs"),join(repository,"tests/gate_probe.ts"),instance,"sensors","review-evidence"],{cwd:f.root,encoding:"utf8"});
    assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout).failures as string[];
  }
  assert.deepEqual(gate(),[]);
  write(f.root,"src/other/code.ts","unrelated implementation");
  git(f.root,"add",".");git(f.root,"commit","-qm","unrelated module commit");
  assert.deepEqual(gate(),[],"controlled review survives an unrelated module commit and dirty-state change");
  const target={stage_slug:"code-review",instance_id:instance,axis:"unit" as const,module_id:"shop",unit_id:"api"};
  function planned() {
    const expected=evidenceSourceRevision(f.root,instance);
    return buildEvidenceReusePlan(loadGraph(),{projectRoot:f.root,scope:"feature",now:new Date().toISOString(),target,evidenceScope:expected.scope,expectedSourceRevision:expected}).entries.find(e=>e.stage_slug==="code-review"&&e.sensor==="review-evidence")!;
  }
  assert.equal(planned().reason,"mandatory_gate_verification","reusable provenance never replaces mandatory report verification");
  write(f.root,"shared/api.json","shared contract changed");
  assert.match(gate().join("\n"),/scope_digest/);
  assert.equal(planned().reason,"invalid_evidence");
  write(f.root,"shared/api.json","{}");
  const legacy={...payload,source_revision:{...payload.source_revision,scope:"module:shop"}};
  write(f.root,evidencePath,legacy);assert.match(gate().join("\n"),/does not match.*scope/);
  write(f.root,evidencePath,payload);
  for(const invalid of [record.replace("reviewer: single-session\n",""),record.replace("Spec result: passed","Spec result: blocked"),record.replace("issues_open: 0","issues_open: 1")]) {
    write(f.root,reviewPath,invalid);
    const r=cli(f.root,["evidence","run","--stage","code-review","--module","shop","--unit","api","--sensor","review-evidence"]);
    assert.notEqual(r.status,0,"missing or failed real review must still reject");
  }
}finally{delete process.env.AIDLC_SESSION_BINDING;rmSync(f.root,{recursive:true,force:true});}
console.log("MARS-244 controlled dual-axis review, reviewer-required, scoped reuse across commits, shared invalidation and legacy scope rejection passed");
