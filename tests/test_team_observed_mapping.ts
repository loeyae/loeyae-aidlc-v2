import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";

const repository = resolve(import.meta.dirname, "..");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || tmpdir(), "aidlc-observed-mapping-"));
const put = (path: string, value: unknown) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
};
function run(args: string[], ok = true) {
  const result = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "bin/cli.ts"), ...args], {
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
put("README.md", "Reuse an existing suite without adding UC-D comments or new tests.\n");
put("src/behavior.cjs", "module.exports=()=>false;\n");
const originalTest = "const assert=require('node:assert/strict');assert.equal(require('../src/behavior.cjs')(),true);\n";
put("tests/behavior.test.cjs", originalTest);
put("scripts/observe.cjs", "const fs=require('node:fs');fs.appendFileSync('.aidlc/observed-phases',process.env.AIDLC_PHASE+'\\n');let failed=0;try{require('../tests/behavior.test.cjs')}catch{failed=1;}console.log(JSON.stringify({phase:process.env.AIDLC_PHASE,status:failed?'failed':'passed',compile_status:'passed',environment_status:'passed',tests_total:1,tests_failed:failed,traceability_complete:true,...failed?{failure_class:'behavior',failure_signature:'approved behavior absent'}:{},uc_mapping:[{use_case:'UC-D-001',test_methods:['tests/behavior.test.cjs']}]}));process.exit(failed);\n");
put("docs/aidlc/modules/project/inception/requirements.md", "REQ-1: Given a caller When checking behavior Then return true.\n");
const cases = "docs/aidlc/modules/project/inception/application-design/test-cases";
put(`${cases}/_index.md`, "UC-D-001 status: ready source_ref: REQ-1\n");
put(`${cases}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\nGiven a caller When checking behavior Then return true.\n");
const construction = "docs/aidlc/modules/project/construction/default";
put(`${construction}/plans/code-generation-plan.md`, "# Plan\nREQ-1 UC-D-001 implement behavior returning true and reuse tests/behavior.test.cjs via scripts/observe.cjs.\n");
put(`${construction}/implementation-summary.md`, "# Summary\nREQ-1 UC-D-001 implemented src/behavior.cjs and verified using existing tests/behavior.test.cjs.\n");
for (const [stage, role] of [["tdd", "red"], ["code-generation", "green"]]) put(`.aidlc/commands/${stage}.json`, { version: "1", stage, commands: [{ id: role, role, argv: ["node", "scripts/observe.cjs"] }] });
for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Regression", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline"]]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr);
}
saveFixtureState(root, createInitialState("express", "4.23.3", undefined, [], "observed mapping reuse"));
active("test-case-derivation"); run(["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation"]);
active("tdd");
for (const sensor of ["red-test-evidence", "baseline-test-evidence"]) run(["evidence", "run", "--stage", "tdd", "--sensor", sensor]);
put("src/behavior.cjs", "// REQ-1 UC-D-001\nmodule.exports=()=>true;\n");
active("code-generation"); run(["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
const greenPath = ".aidlc/evidence/code-generation/project/default/green-test-evidence.json";
const originalGreen = readFileSync(join(root, greenPath), "utf8");
const observations = readFileSync(join(root, ".aidlc/observed-phases"), "utf8");
assert.equal(observations, "RED\nGREEN\n", "RED and GREEN must be separate real observations");
run(["evidence", "run", "--stage", "code-generation", "--sensor", "test-quality"]);
const quality = JSON.parse(readFileSync(join(root, ".aidlc/evidence/code-generation/project/default/test-quality.json"), "utf8"));
assert.deepEqual(quality.uc_mapping, [{ use_case: "UC-D-001", test_methods: ["tests/behavior.test.cjs"] }]);
assert.equal(readFileSync(join(root, "tests/behavior.test.cjs"), "utf8"), originalTest);
assert.equal(readFileSync(join(root, ".aidlc/observed-phases"), "utf8"), observations, "mapping reuse must not rerun tests");
console.log("PASS actual controlled GREEN mapping reuses an unchanged existing suite without source UC-D annotations");
const check = ["check", "--sensor", "test-quality", "--module", "project", "--unit", "default"];
put(`${construction}/code-review.md`, "# Code review\nSpec and Standards passed.\n");
put(`${construction}/audit.md`, "# Audit\nReviewed implementation and existing tests.\n");
put("docs/aidlc/construction/build-test-report.md", "# Build/test report\nExisting observation passed.\n");
put("docs/aidlc/construction/build-and-test/build-and-test-summary.md", "# Summary\nOne existing test passed.\n");
run(check);
console.log("PASS downstream review and execution reports do not require rerunning a valid GREEN mapping");
for (const mutation of ["missing-observation", "missing-coverage"]) {
  const invalid = JSON.parse(originalGreen);
  if (mutation === "missing-observation") delete invalid.observed_command;
  else invalid.uc_mapping = [];
  put(greenPath, invalid); run(check, false); put(greenPath, originalGreen);
}
put("src/behavior.cjs", "// REQ-1 UC-D-001\nmodule.exports=()=>false;\n");
assert.match(run(check, false), /scope_digest|worktree_digest|no longer matches/);
put("src/behavior.cjs", "// REQ-1 UC-D-001\nmodule.exports=()=>true;\n");
put("tests/behavior.test.cjs", originalTest + "// a test changed after observation\n");
assert.match(run(check, false), /scope_digest|worktree_digest|no longer matches|phase_inputs/);
put("tests/behavior.test.cjs", originalTest);
assert.equal(readFileSync(join(root, ".aidlc/observed-phases"), "utf8"), observations);
const phasePaths = [greenPath, ".aidlc/evidence/tdd/project/default/red-test-evidence.json", ".aidlc/evidence/tdd/project/default/baseline-test-evidence.json"];
const savedPhases = phasePaths.map(path => [path, readFileSync(join(root, path), "utf8")] as const);
const qualityPath = ".aidlc/evidence/code-generation/project/default/test-quality.json";
const priorQuality = readFileSync(join(root, qualityPath), "utf8");
for (const [path, bytes] of savedPhases) {
  const stripped = JSON.parse(bytes);
  for (const field of ["producer", "observed_command", "source_revision", "checker", "evidence_version"]) delete stripped[field];
  put(path, stripped);
}
put("tests/behavior.test.cjs", "// UC-D-001\n" + originalTest);
run(["evidence", "run", "--stage", "code-generation", "--sensor", "test-quality"], false);
assert.equal(readFileSync(join(root, qualityPath), "utf8"), priorQuality, "stripping provenance and adding annotations must not downgrade a publishing run");
for (const [path, bytes] of savedPhases) put(path, bytes);
put("tests/behavior.test.cjs", originalTest);
console.log(`PASS unobserved mapping, missing coverage and source/test drift stay blocking (${root})`);
