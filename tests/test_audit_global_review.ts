import assert from "node:assert/strict";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { fixture, write, cli, snapshot } from "./mars244_fixture";
import { spawnSync } from "node:child_process";
import { repository } from "./mars244_fixture";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
const f = fixture("build-and-test");
delete f.state.current_module; delete f.state.current_unit; f.state.current_phase = "construction"; f.persist();
for (const [moduleId, units] of [["shop", ["api", "web"]], ["other", ["default"]]] as const) for (const unit of units) {
  write(f.root, `docs/aidlc/modules/${moduleId}/construction/${unit}/code-review.md`, "Spec: passed\nStandards: passed\nreviewer: fixture\n");
}
const binding = JSON.stringify(bindSession(f.root, { instance: "build-and-test", owner: "auditor", session: "global-review", expected: claimToken(undefined) }).binding);
const args = ["evidence", "run", "--stage", "build-and-test", "--sensor", "global-review-evidence"];
const consumes = () => {
  const result = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "tests/gate_probe.ts"), "build-and-test", "consumes"], { cwd: f.root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).failures as string[];
};
assert.notEqual(cli(f.root, args, binding).status, 0, "missing global review fails");
assert(consumes().some(failure => failure.includes("FINAL_GLOBAL before C8")), "C8 entry rejects missing global observation");
const projection = cli(f.root, ["orchestrate", "state", "review-inputs"]);
assert.equal(projection.status, 0, projection.stderr);
const plan = JSON.parse(projection.stdout).global_review;
assert.equal(plan.required, true); assert.equal(plan.covered_instances.length, 3);
const record = { mode: "FINAL_GLOBAL", status: "passed", spec_axis: "passed", standards_axis: "passed", reviewer: "fixture", issues_found: 0, issues_resolved: 0, issues_open: 0, covered_instances: plan.covered_instances, inputs: plan.inputs };
const save = (value: unknown) => write(f.root, "docs/aidlc/construction/global-code-review.md", "# Global review\n```aidlc-global-review\n" + JSON.stringify(value) + "\n```\n");
save({ ...record, covered_instances: plan.covered_instances.slice(1) });
assert.notEqual(cli(f.root, args, binding).status, 0, "omitted unit fails");
save({ ...record, spec_axis: "failed" });
assert.notEqual(cli(f.root, args, binding).status, 0, "failed global axis fails");
save(record); const accepted = cli(f.root, args, binding); assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
const gate = () => spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "tests/gate_probe.ts"), "build-and-test", "sensors", "global-review-evidence"], { cwd: f.root, encoding: "utf8" });
const passing = gate(); assert.equal(passing.status, 0, passing.stderr); assert.deepEqual(JSON.parse(passing.stdout).failures, []);
assert(!consumes().some(failure => failure.includes("FINAL_GLOBAL before C8")), "valid global observation satisfies the C8 entry requirement");
assert(plan.inputs.some((input: {path:string}) => input.path === "shared/api.json"), "global review binds the actual shared contract, including paths outside source roots");
write(f.root, "shared/api.json", "changed shared contract");
assert.ok(JSON.parse(gate().stdout).failures.length, "shared contract drift invalidates global review");
assert(consumes().some(failure => failure.includes("FINAL_GLOBAL before C8")), "C8 entry rechecks shared-contract freshness");
assert.notEqual(cli(f.root, args, binding).status, 0, "shared contract change requires actual global review refresh");
write(f.root, "shared/api.json", "{}");
write(f.root, "src/shop/api/code.ts", "changed after global review");
assert.ok(JSON.parse(gate().stdout).failures.length, "gate revalidates input bindings");
assert.notEqual(cli(f.root, args, binding).status, 0, "changed source requires actual global review refresh");
const split = fixture("code-review@module:shop@unit:api", true);
const integration = bindSession(split.root, { instance: "build-and-test", owner: "auditor", session: "integration", expected: claimToken(undefined) }).binding;
for (const [moduleId, units] of [["shop", ["api", "web"]], ["other", ["default"]]] as const) for (const unit of units) {
  write(split.root, `docs/aidlc/modules/${moduleId}/construction/${unit}/code-review.md`, "Spec: passed\nStandards: passed\nreviewer: split-fixture\n");
}
const splitProjection = cli(split.root, ["orchestrate", "state", "review-inputs"], "");
assert.equal(splitProjection.status, 0, splitProjection.stdout + splitProjection.stderr);
const splitPlan = JSON.parse(splitProjection.stdout).global_review;
write(split.root, "docs/aidlc/construction/global-code-review.md", "# Split review\n```aidlc-global-review\n" + JSON.stringify({ ...record, covered_instances: splitPlan.covered_instances, inputs: splitPlan.inputs }) + "\n```\n");
const preAdmission = cli(split.root, [...args, "--instance", "build-and-test", "--refresh"], JSON.stringify(integration));
assert.equal(preAdmission.status, 0, preAdmission.stdout + preAdmission.stderr);
const canonical = join(split.root, ".aidlc/evidence/build-and-test/global-review-evidence.json");
assert(existsSync(canonical), "pre-admission project evidence uses the canonical project path");
assert.equal(existsSync(join(split.root, ".aidlc/evidence/build-and-test/integration/global-review-evidence.json")), false, "project claim metadata is not a module axis");
const preAdmissionEvidence = JSON.parse(readFileSync(canonical, "utf8"));
assert.equal(preAdmissionEvidence.module_id, null);
assert.equal(preAdmissionEvidence.unit_id, null);
assert.equal(preAdmissionEvidence.stage_instance, "build-and-test");
const before = snapshot(split.root);
const rejected = cli(split.root, ["orchestrate", "next"], JSON.stringify(integration));
assert.notEqual(rejected.status, 0, "binding integration cannot bypass the integration barrier");
assert.match(rejected.stdout + rejected.stderr, /integration barrier is not ready/);
const directReport = cli(split.root, ["orchestrate", "report", "--stage", "build-and-test", "--result", "completed"], JSON.stringify(integration));
assert.notEqual(directReport.status, 0, "report cannot waive the integration barrier by skipping next");
assert.match(directReport.stdout + directReport.stderr, /integration barrier is not ready/);
assert.deepEqual(snapshot(split.root), before, "failed integration admission preserves every workflow and artifact");
console.log("PASS controlled FINAL_GLOBAL: required, every unit, independent results and input freshness");

// Empty consumes lists still bind the actual worktree. Refresh may reuse only
// unchanged content, and must run the real checker after an unconsumed change.
const reuse = fixture("build-and-test-templates");
delete reuse.state.current_module; delete reuse.state.current_unit; reuse.persist();
for (const name of ["build-instructions.md", "unit-test-instructions.md"]) {
  write(reuse.root, `docs/aidlc/construction/build-and-test/${name}`, "# Instructions\nREQ-001: Run the project command and inspect its actual result before delivery.\n");
}
const reuseBinding = JSON.stringify(bindSession(reuse.root, { instance: "build-and-test-templates", owner: "reviewer", session: "worktree-refresh", expected: claimToken(undefined) }).binding);
const templateArgs = ["evidence", "run", "--stage", "build-and-test-templates", "--instance", "build-and-test-templates", "--sensor", "template-completeness"];
const initialTemplate = cli(reuse.root, templateArgs, reuseBinding);
assert.equal(initialTemplate.status, 0, initialTemplate.stdout + initialTemplate.stderr);
const templatePath = join(reuse.root, ".aidlc/evidence/build-and-test-templates/template-completeness.json");
const initialTemplateEvidence = JSON.parse(readFileSync(templatePath, "utf8"));
const completedTemplate = loadWorkflowState(reuse.root)!;
completedTemplate.completed_stage_instances.push("build-and-test-templates");
completedTemplate.completed_stages.push("build-and-test-templates");
delete completedTemplate.current_stage_instance; completedTemplate.current_stage = "";
reuse.persist(completedTemplate);
const reuseResult = cli(reuse.root, [...templateArgs, "--refresh"], reuseBinding);
assert.equal(reuseResult.status, 0, reuseResult.stdout + reuseResult.stderr);
assert.match(reuseResult.stdout, /"action": "reused"/);
write(reuse.root, "docs/additional-fact.txt", "A real worktree input changed outside the empty consumes list.\n");
const regeneratedTemplate = cli(reuse.root, [...templateArgs, "--refresh"], reuseBinding);
assert.equal(regeneratedTemplate.status, 0, regeneratedTemplate.stdout + regeneratedTemplate.stderr);
assert.match(regeneratedTemplate.stdout, /"action": "regenerated"/);
const refreshedTemplateEvidence = JSON.parse(readFileSync(templatePath, "utf8"));
assert.notEqual(refreshedTemplateEvidence.producer.execution_id, initialTemplateEvidence.producer.execution_id);
assert.notEqual(refreshedTemplateEvidence.source_revision.worktree_digest, initialTemplateEvidence.source_revision.worktree_digest);
write(reuse.root, "docs/aidlc/construction/build-and-test/build-instructions.md", "TODO\n");
assert.notEqual(cli(reuse.root, [...templateArgs, "--refresh"], reuseBinding).status, 0, "stale passing evidence cannot conceal a now-failing template checker");
console.log("PASS project evidence reuse: unchanged reuses, real worktree drift regenerates, failing checker rejects");
