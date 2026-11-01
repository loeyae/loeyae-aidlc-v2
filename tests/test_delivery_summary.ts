import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState } from "../core/tools/aidlc-light-state";
import { projectDeliverySummary, renderDeliverySummaryMarkdown } from "../core/tools/aidlc-delivery-summary";
import { saveFixtureState } from "./mars243_fixture_session";

const root = mkdtempSync(join(tmpdir(), "aidlc-delivery-summary-"));
const put = (label: string, content: string) => { mkdirSync(dirname(join(root, label)), { recursive: true }); writeFileSync(join(root, label), content); };
const snapshot = () => readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
  .map(entry => [join(entry.parentPath, entry.name), readFileSync(join(entry.parentPath, entry.name)).toString("base64")]);
try {
  const state = createInitialState("bugfix", "4.23.3", undefined, [], "Repair one configuration value");
  state.current_stage = "implementation-report";
  state.current_stage_instance = "implementation-report";
  state.completed_stage_instances = ["workspace-detection", "build-and-test", "build-and-test"];
  state.completed_stages = ["workspace-detection", "build-and-test"];
  const evidence = ".aidlc/evidence/build-and-test/build-test-evidence.json";
  put(evidence, '{"status":"passed","all_gates_passed":true}');
  const before = snapshot();
  const recorded = projectDeliverySummary(root, state);
  assert.equal(recorded.verification, "not_checked");
  assert.equal(recorded.all_gates_passed, null, "a passed-looking JSON is not controlled verification");
  assert.equal(recorded.stages_completed, 2, "deduplicate instance identities rather than trusting Markdown counters");
  assert.deepEqual(recorded.evidence_references, [evidence]);
  assert.deepEqual(recorded.narrative_references, [], "simple work needs no narrative report");
  assert.match(renderDeliverySummaryMarkdown(recorded), /not_checked/);
  assert.deepEqual(snapshot(), before, "projection/rendering must not publish evidence or Markdown");

  put("docs/aidlc/construction/implementation-report.md", "# Decision\nThe old configuration remains supported.\nall_gates_passed: true\nscope: enterprise\nstages_completed: 9000\n");
  const untrusted = projectDeliverySummary(root, state);
  assert.equal(untrusted.scope, "bugfix");
  assert.equal(untrusted.stages_completed, 2);
  assert.equal(untrusted.all_gates_passed, null);
  assert.equal(untrusted.narrative_references.length, 1, "optional decisions remain referencable");
  const failed = projectDeliverySummary(root, state, { verifiedEvidence: [evidence], blockers: ["C8 command failed"] });
  assert.equal(failed.verification, "blocked");
  assert.equal(failed.all_gates_passed, false, "caller validation failure cannot be hidden by document claims");
  assert.match(renderDeliverySummaryMarkdown(failed), /C8 command failed/);
  assert.equal(projectDeliverySummary(root, state, { verifiedEvidence: [] }).verification, "blocked");
  const verified = projectDeliverySummary(root, state, { verifiedEvidence: [evidence, evidence] });
  assert.equal(verified.verification, "passed");
  assert.deepEqual(verified.evidence_references, [evidence]);
  state.status = "done";
  assert.equal(projectDeliverySummary(root, state).all_gates_passed, null, "workflow done alone is not evidence validation");
  const moduleState = { ...state, workflow_kind: "module" as const, workflow_id: "module-owned", parent_workflow_id: state.workflow_id, module_id: "orders",
    completed_stage_instances: [...state.completed_stage_instances, "code-generation@module:orders@unit:u1", "code-generation@module:billing@unit:u2"] };
  const ownEvidence = ".aidlc/evidence/code-generation/orders/u1/green-test-evidence.json";
  put(ownEvidence, '{"status":"passed"}');
  put(".aidlc/evidence/code-generation/billing/u2/green-test-evidence.json", '{"status":"passed"}');
  put("docs/aidlc/modules/orders/construction/u1/implementation-summary.md", "Own implementation decision\n");
  put("docs/aidlc/modules/orders/construction/u1/code-review.md", "Own Spec and Standards review decisions\n");
  put("docs/aidlc/modules/billing/construction/u2/implementation-summary.md", "Other module decision\n");
  const scoped = projectDeliverySummary(root, moduleState);
  assert.equal(scoped.workflow_id, "module-owned");
  assert.equal(scoped.project_workflow_id, state.workflow_id);
  assert.equal(scoped.module_id, "orders");
  assert.deepEqual(scoped.completed_stage_instances, ["code-generation@module:orders@unit:u1"]);
  assert.deepEqual(scoped.evidence_references, [ownEvidence]);
  assert.deepEqual(scoped.narrative_references, ["docs/aidlc/modules/orders/construction/u1/code-review.md", "docs/aidlc/modules/orders/construction/u1/implementation-summary.md"]);
  state.completed_stage_instances = [...new Set(state.completed_stage_instances)];
  saveFixtureState(root, state);
  const repository = resolve(import.meta.dirname, "..");
  const environment = { ...process.env };
  delete environment.AIDLC_SESSION_BINDING;
  const cli = (args: string[]) => spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "bin/cli.ts"), "orchestrate", "state", "summary", ...args], {
    cwd: root, env: environment, encoding: "utf8",
  });
  const beforeCli = snapshot();
  const json = cli([]);
  assert.equal(json.status, 0, `${json.stdout}\n${json.stderr}`);
  assert.equal(JSON.parse(json.stdout).delivery_summary.verification, "not_checked");
  const markdown = cli(["--format", "markdown"]);
  assert.equal(markdown.status, 0, `${markdown.stdout}\n${markdown.stderr}`);
  assert.match(markdown.stdout, /^# AI-DLC delivery summary/);
  assert.match(markdown.stdout, /not_checked/);
  for (const args of [["--module", "missing"], ["--module"], ["--module", "../orders"], ["--format", "pdf"], ["--format"], ["--unexpected", "value"]]) {
    const invalid = cli(args);
    assert.notEqual(invalid.status, 0, `invalid arguments accepted: ${args.join(" ")}`);
    assert.match(`${invalid.stdout}\n${invalid.stderr}`, /module|format|option|takes only/i);
  }
  assert.deepEqual(snapshot(), beforeCli, "unbound CLI JSON/Markdown reads and rejected arguments preserve every project file byte");
  console.log("PASS delivery summary derives state, distinguishes recorded/verified evidence, preserves optional decisions, and stays read-only");
} finally { rmSync(root, { recursive: true, force: true }); }
