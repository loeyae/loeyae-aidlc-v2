import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";

const repo = resolve(import.meta.dirname, ".."), tsx = join(repo, "node_modules/tsx/dist/cli.mjs");
const root = mkdtempSync(join(tmpdir(), "aidlc-semantic-phase-"));
const put = (path: string, value: unknown) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
};
function run(args: string[], ok = true) {
  const result = spawnSync(process.execPath, [tsx, join(repo, "bin/cli.ts"), ...args], {
    cwd: root, encoding: "utf8", env: fixtureEnvironment(root, args),
  });
  assert.equal(result.status === 0, ok, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout + result.stderr;
}
function active(stage: string) {
  const state = loadWorkflowState(root)!;
  Object.assign(state, { current_stage: stage, current_stage_instance: `${stage}@module:project${stage === "test-case-derivation" ? "" : "@unit:default"}`,
    current_module: "project", current_unit: stage === "test-case-derivation" ? undefined : "default", current_phase: stage === "test-case-derivation" ? "inception" : "construction" });
  saveFixtureState(root, state);
}
const green = ".aidlc/evidence/code-generation/project/default/green-test-evidence.json";
const count = () => readFileSync(join(root, ".aidlc/phase-executions"), "utf8");
try {
  put("README.md", "Semantic evidence repair regression\n");
  put("src/behavior.cjs", "module.exports=()=>false;\n");
  put("tests/behavior.test.cjs", "const fs=require('node:fs'),assert=require('node:assert/strict');fs.appendFileSync('.aidlc/phase-executions',process.env.AIDLC_PHASE+'\\n');let failed=0;try{assert.equal(require('../src/behavior.cjs')(),true);}catch{failed=1;}console.log(JSON.stringify({phase:process.env.AIDLC_PHASE,status:failed?'failed':'passed',compile_status:'passed',environment_status:'passed',tests_total:1,tests_failed:failed,traceability_complete:true,...failed?{failure_class:'behavior',failure_signature:'approved behavior absent'}:{},uc_mapping:[{use_case:'UC-D-001',test_methods:['tests/behavior.test.cjs']}]}));process.exit(failed);\n");
  put("docs/aidlc/modules/project/inception/requirements.md", "REQ-1: Given a caller When checking behavior Then return true.\n");
  const cases = "docs/aidlc/modules/project/inception/application-design/test-cases";
  put(`${cases}/_index.md`, "UC-D-001 status: ready source_ref: REQ-1\n");
  put(`${cases}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\nGiven a caller When checking behavior Then return true.\n");
  const construction = "docs/aidlc/modules/project/construction/default";
  put(`${construction}/plans/code-generation-plan.md`, "# Plan\nREQ-1 UC-D-001 implement behavior returning true and verify tests/behavior.test.cjs.\n");
  put(`${construction}/implementation-summary.md`, "# Summary\nREQ-1 UC-D-001 implemented in src/behavior.cjs and verified by tests/behavior.test.cjs.\n");
  for (const [stage, role] of [["tdd", "red"], ["code-generation", "green"]]) {
    put(`.aidlc/commands/${stage}.json`, { version: "1", stage, commands: [{ id: role, role, argv: ["node", "tests/behavior.test.cjs"] }] });
  }
  for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Regression", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline"]]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr);
  }
  saveFixtureState(root, createInitialState("express", "4.23.2", undefined, [], "semantic repair must preserve valid phase evidence"));
  active("test-case-derivation"); run(["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation"]);
  active("tdd");
  for (const sensor of ["red-test-evidence", "baseline-test-evidence"]) run(["evidence", "run", "--stage", "tdd", "--sensor", sensor]);
  put("src/behavior.cjs", "// REQ-1 UC-D-001\nmodule.exports=()=>true;\n");
  active("code-generation"); run(["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
  const ready = loadWorkflowState(root)!;
  ready.completed_stages = ["workspace-detection", "test-case-derivation", "tdd"];
  ready.completed_stage_instances = ["workspace-detection", "test-case-derivation@module:project", "tdd@module:project@unit:default"];
  saveFixtureState(root, ready);
  for (const sensor of ["test-quality", "traceability-matrix", "structural-invariants"]) {
    run(["evidence", "run", "--stage", "code-generation", "--sensor", sensor]);
  }
  run(["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  const original = readFileSync(join(root, green), "utf8"), before = count();
  rmSync(join(root, ".aidlc/evidence/code-generation/project/default/test-quality.json"));
  run(["orchestrate", "report", "--stage", "code-generation", "--instance", "code-generation@module:project@unit:default", "--result", "completed"]);
  assert.equal(count(), before, "automatic semantic repair must not rerun successful GREEN commands");
  assert.equal(readFileSync(join(root, green), "utf8"), original, "valid GREEN evidence stays byte-identical");
  assert.ok(loadWorkflowState(root)!.completed_stage_instances.includes("code-generation@module:project@unit:default"));
  console.log("PASS actual re-attestation fills missing semantic evidence and preserves real GREEN observation");
  const historyLength = loadWorkflowState(root)!.history.length;
  const semantic = ".aidlc/evidence/code-generation/project/default/test-quality.json";
  for (const invalid of ["failed", "missing"]) {
    if (invalid === "failed") put(green, { ...JSON.parse(original), status: "failed", tests_failed: 1 });
    else rmSync(join(root, green));
    rmSync(join(root, semantic), { force: true });
    run(["orchestrate", "report", "--stage", "code-generation", "--instance", "code-generation@module:project@unit:default", "--result", "completed"], false);
    assert.equal(count(), before, `${invalid} GREEN remains blocking without implicit test execution`);
    assert.equal(loadWorkflowState(root)!.history.length, historyLength, "failed re-attestation cannot add completion history");
  }
  console.log("PASS failed or missing GREEN remains blocking and cannot be silently regenerated by semantic repair");
  const upgrade = JSON.parse(run(["orchestrate", "upgrade", "--dry-run"]));
  assert.ok(upgrade.pending.some((item: { instance_id: string; missing_sensors: string[] }) =>
    item.instance_id === "code-generation@module:project@unit:default" && item.missing_sensors.includes("green-test-evidence")),
  "upgrade diagnostics must still report missing phase evidence for explicit recovery");
  console.log("PASS upgrade diagnostics retain missing phase evidence in the recovery inventory");
} finally {
  rmSync(root, { recursive: true, force: true });
}
