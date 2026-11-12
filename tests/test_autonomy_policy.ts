import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { adoptAutonomyBatch, autonomyDigest, projectAutonomyScope } from "../core/tools/aidlc-autonomy";
import { autonomyHandoffDigest, projectAutonomyDecisions, recordDelegatedDecision } from "../core/tools/aidlc-autonomy-policy";
import { createInitialState, loadWorkflowState, renderLightWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { saveRegistry } from "../core/tools/aidlc-workflow-layout";

type Row = Record<string, any>;
const repository = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "aidlc-autonomy-policy-"));
const inherited = process.env.AIDLC_SESSION_BINDING;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const HANDOFF = "docs/aidlc/handoff.md", BATCH = "docs/aidlc/ideation/scenario-module-mapping.md";
const put = (root: string, label: string, text: string) => { const path = join(root, label); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const fence = (records: Row[]) => "```aidlc-autonomy\n" + JSON.stringify({ schema: "aidlc.autonomy-source/v1", records }) + "\n```\n";
function tree(root: string, prefix = ""): Record<string, string> {
  return Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const label = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? Object.entries(tree(root, label)) : [[label, hash(readFileSync(join(root, label)))]];
  }));
}
let count = 0;
function test(name: string, action: () => void) { action(); count++; console.log(`PASS ${name}`); }
function fixture(name: string, development = false) {
  delete process.env.AIDLC_SESSION_BINDING;
  const root = join(scratch, name); mkdirSync(root);
  const state = createInitialState("feature", undefined, `workflow-${name}`, [], "Policy/decision tests"); saveWorkflowState(root, state);
  const path = "docs/aidlc/modules/orders/inception/requirements.md";
  const text = "# SCENARIO-001 Publish\n\n## REQ-001 No purchase limit, preserve the explicit product answer\n\n## AC-001 Ready publishes and failures remain recoverable\n\n## GAP-001 Error presentation is delegated; unspecified detail\n\n## GAP-002 Compatible internal layout is delegated\n";
  put(root, path, text);
  const input = { repository_id: "project", path, digest: hash(text), digest_mode: "raw-file" };
  const item = (item_id: string) => ({ ...input, item_id });
  const common = (record_type: string, record_id: string): Row => ({ schema: "aidlc.autonomy/v1", record_type, record_id, workflow_id: state.workflow_id, revision: 1, inputs: [input] });
  const unit = { unit_id: "publish", name: "Publish", service_id: "orders", conditional_stages: [], req_refs: ["REQ-001"] };
  put(root, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [{ module_id: "orders", name: "Orders", service_id: "orders", paths: ["src"] }] }));
  put(root, "docs/aidlc/modules/orders/inception/unit-manifest.json", JSON.stringify({ schema_version: 1, module_id: "orders", units: [unit] }));
  const unitRef = { workflow_ref: { workflow_id: state.workflow_id, owner_kind: "global" }, module_id: "orders", unit_id: "publish", definition_digest: autonomyDigest(unit) };
  const authority = { source_kind: "host-user-message", source_locator: "fixture-host://messages/policy", source_digest: "a".repeat(64), scope_summary: "publish/1", actor_locator: "fixture-product-owner" };
  const policy: Row = { ...common("policy", "policy-a"), policy_id: "policy-a", policy_revision: 1, scope_refs: [{ batch_id: "publish", scope_revision: 1 }],
    hard_constraints: [item("REQ-001")], validation_requirements: [item("AC-001")], source_precedence: [],
    delegated_categories: [{ category_id: "layout", when: { kind: "compatible-internal-change", refs: [item("GAP-002")], expected: "compatible" }, allowed_actions: ["choose-compatible-layout"], forbidden_changes: [item("REQ-001")] }],
    fallback_rules: [{ rule_id: "retry", when: { kind: "missing-detail", refs: [item("GAP-001")], expected: "unspecified" }, default_behavior: "Show a recoverable error with Retry", constraints: [item("REQ-001")], required_checks: ["recoverable"] }],
    allowed_change_classes: ["implementation-refinement", "baseline-defect-fix", "behavior-preserving-refactor"], escalation_conditions: [], authority_ref: authority };
  const matrix: Row = { ...common("validation-matrix", "matrix-a"), checks: ["recoverable", "ready"] };
  const policyPath = development ? "docs/aidlc/modules/orders/inception/development-handoff.md" : HANDOFF;
  const ref = (record: Row, label = policyPath): Row => ({ repository_id: "project", path: label, digest: autonomyDigest(record), digest_mode: "json-record-v1", selector: { record_type: record.record_type, record_id: record.record_id } });
  const batch: Row = { ...common("batch", "publish"), batch_id: "publish", scope_revision: 1, goal: "Publish a bounded scope", scenario_refs: [item("SCENARIO-001")], acceptance_refs: [item("AC-001")], ui_refs: [],
    units: [{ unit_ref: unitRef, role: "implement", expected_capabilities: [] }], dependency_refs: [], consumer_closure: [], baseline_inputs: [input], policy_ref: {}, integration_owner: "coordinator", validation_matrix_ref: {}, delivery_artifacts: [{ artifact_id: "candidate", kind: "candidate", required: true, target_path: "delivery/candidate.txt" }] };
  const current = () => loadWorkflowState(root)!;
  const freeze = () => {
    put(root, policyPath, "# Policy authoring source\n\n" + fence([policy, matrix]) + "\nHuman narrative remains here.\n");
    batch.policy_ref = { ...ref(policy), policy_id: policy.policy_id, policy_revision: policy.policy_revision }; batch.validation_matrix_ref = ref(matrix); put(root, BATCH, fence([batch]));
    const binding = bindSession(root, { instance: "workspace-detection", owner: "agent", session: "test-session", expected: claimToken(current().active_instances["workspace-detection"]) }).binding;
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(binding); adoptAutonomyBatch(root, "publish", current().revision);
    return binding;
  };
  const decision = (): Row => ({ ...common("decision", "retry-a"), decision_id: "retry-a", policy_ref: batch.policy_ref, policy_clause: "fallback:retry", question: "How to present recoverable errors?", source_refs: [item("GAP-001"), item("REQ-001"), item("AC-001")],
    chosen_option: policy.fallback_rules[0].default_behavior, action: policy.fallback_rules[0].default_behavior, rationale: "Use the bounded policy default", affected_refs: [item("GAP-001")], effective_revision: 1, implementation_refs: [], validation_refs: [], adjustment_plan: "A later explicit decision may replace the detail through an incremental change", recorded_by: "agent/test-session", human_review: { status: "pending" }, unit_ref: unitRef, change_class: "implementation-refinement" });
  const complete = (d: Row) => {
    const code = "fixture implementation bytes only\n", observation = "fixture observation bytes only; not controlled gate evidence\n";
    put(root, "src/retry.txt", code); put(root, "fixtures/retry-observation.txt", observation);
    d.implementation_refs = [{ repository_id: "project", path: "src/retry.txt", digest: hash(code), digest_mode: "raw-file" }];
    d.validation_refs = [{ check_id: "recoverable", sensor: "build-test-evidence", stage_instance: "build-and-test", path: "fixtures/retry-observation.txt", digest: hash(observation), workflow_id: state.workflow_id, batch_id: "publish" }];
    return d;
  };
  const record = (d: Row, preview = false) => recordDelegatedDecision(root, d, autonomyHandoffDigest(root), preview);
  const cli = (args: string[]) => spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "bin/cli.ts"), "orchestrate", ...args], { cwd: root, encoding: "utf8", timeout: 30_000, env: { ...process.env, AIDLC_SESSION_BINDING: process.env.AIDLC_SESSION_BINDING || "" } });
  return { root, policy, matrix, batch, common, input, item, authority, unitRef, current, freeze, decision, complete, record, cli, policyPath, ref };
}
try {
  test("legacy inspection ignores malformed autonomy sources and writes nothing", () => {
    const f = fixture("legacy"); put(f.root, HANDOFF, "```aidlc-autonomy\ninvalid\n```\n"); const before = tree(f.root);
    assert.equal(projectAutonomyDecisions(f.root).enabled, false); assert.deepEqual(tree(f.root), before);
  });
  test("policy reads a frozen handoff record with all baseline constraints", () => {
    const f = fixture("policy"); f.freeze(); const before = tree(f.root), result = projectAutonomyDecisions(f.root);
    assert.equal(result.policy!.policy_id, "policy-a"); assert.equal(result.execution_authorized, false); assert.equal(result.engineering_verification, "not_evaluated"); assert.deepEqual(tree(f.root), before);
  });
  const invalidPolicies: [string, (f: ReturnType<typeof fixture>) => void, RegExp][] = [
    ["unknown policy field", f => { f.policy.permission = true; }, /unsupported fields/],
    ["empty hard constraints", f => { f.policy.hard_constraints = []; }, /nonempty/],
    ["missing original AC", f => { f.policy.validation_requirements = [f.item("REQ-001")]; }, /every batch AC/],
    ["foreign scope", f => { f.policy.scope_refs[0].batch_id = "foreign"; }, /adopted batch/],
    ["semantic reclassification", f => { f.policy.allowed_change_classes.push("semantic-change"); }, /not delegated/],
    ["document authority", f => { f.policy.authority_ref.source_kind = "document"; }, /host human input/],
    ["foreign authority scope", f => { f.policy.authority_ref.scope_summary = "other/1"; }, /scope_summary/],
    ["unknown predicate", f => { f.policy.fallback_rules[0].when.kind = "javascript"; }, /known kind/],
    ["executable predicate", f => { f.policy.fallback_rules[0].when.expected = { code: "throw Error()" }; }, /JSON scalar/],
    ["missing predicate refs", f => { f.policy.fallback_rules[0].when.refs = []; }, /nonempty/],
    ["duplicate category", f => { f.policy.delegated_categories.push(f.policy.delegated_categories[0]); }, /duplicate category/],
    ["unknown fallback check", f => { f.policy.fallback_rules[0].required_checks = ["unknown"]; }, /unknown validation check/],
    ["incompatible defaults", f => { f.policy.fallback_rules.push({ ...f.policy.fallback_rules[0], rule_id: "other", default_behavior: "Drop the error silently" }); }, /overlapping fallbacks/],
    ["missing precedence authority", f => { f.policy.source_precedence = [{ rule_id: "replace-a", scope_items: [f.item("GAP-001")], preferred: f.input, supersedes: [f.input] }]; }, /AuthorityRef/],
  ];
  for (const [name, change, error] of invalidPolicies) test(`reject ${name}`, () => { const f = fixture(`bad-policy-${count}`); change(f); f.freeze(); const before = tree(f.root); assert.throws(() => projectAutonomyDecisions(f.root), error); assert.deepEqual(tree(f.root), before); });
  test("policy has one canonical location; development handoff does not create duplicate policy state", () => {
    const f = fixture("development", true); f.freeze(); assert.equal(existsSync(join(f.root, HANDOFF)), false);
    const result = f.record(f.decision()); assert.equal(result.decisions.length, 1); assert.equal(projectAutonomyScope(f.root).enabled, true);
    put(f.root, HANDOFF, fence([f.policy])); assert.throws(() => projectAutonomyDecisions(f.root), /one authoritative location/);
  });
  test("preview and pending review preserve state/audit and fixed scope", () => {
    const f = fixture("pending"); f.freeze(); const d = f.decision(), before = tree(f.root), snapshot = f.current().autonomy_batch;
    const preview = f.record(d, true); assert.equal(preview.human_review_summary.pending, 1); assert.deepEqual(tree(f.root), before);
    const result = f.record(d); assert.equal(result.decisions[0].record_status, "incomplete"); assert.ok(result.completion_blockers.includes("retry-a:implementation-missing"));
    assert.ok(!result.completion_blockers.some(reason => reason.includes("pending")));
    const after = tree(f.root); assert.equal(after["aidlc/active/aidlc-state.md"], before["aidlc/active/aidlc-state.md"]); assert.equal(after["aidlc/active/audit.md"], before["aidlc/active/audit.md"]);
    assert.deepEqual(projectAutonomyScope(f.root).snapshot, snapshot); f.record(d); assert.deepEqual(tree(f.root), after);
    assert.ok(readFileSync(join(f.root, HANDOFF), "utf8").endsWith("\nHuman narrative remains here.\n"));
  });
  test("authorized autonomous refinement follows a real category action", () => {
    const f = fixture("category"); f.freeze(); const d = f.decision(); d.policy_clause = "category:layout"; d.action = "choose-compatible-layout"; d.chosen_option = "Use a component-local layout with existing spacing tokens";
    d.source_refs = [f.item("GAP-002"), f.item("REQ-001"), f.item("AC-001")]; d.affected_refs = [f.item("GAP-002")];
    assert.equal(f.record(d).decisions[0].policy_clause, "category:layout");
  });
  const invalidDecisions: [string, (d: Row, f: ReturnType<typeof fixture>) => void, RegExp][] = [
    ["reverse explicit product answer", (d, f) => { d.affected_refs = [f.item("REQ-001")]; d.chosen_option = d.action = "Limit all purchases to one"; }, /fallback outcome|cannot reverse/],
    ["alter a protected item under an otherwise legal clause", (d, f) => { d.affected_refs = [f.item("REQ-001")]; }, /cannot reverse/],
    ["change required acceptance", (d, f) => { d.affected_refs = [f.item("AC-001")]; }, /cannot reverse/],
    ["unregistered affected item", (d, f) => { d.affected_refs = [f.item("GAP-002")]; }, /outside its authorized/],
    ["alter fallback behavior", d => { d.chosen_option = "Ignore the error"; }, /fallback outcome/],
    ["unknown clause", d => { d.policy_clause = "fallback:missing"; }, /real delegated/],
    ["change class escape", d => { d.change_class = "semantic-change"; }, /change class/],
    ["source omission", d => { d.source_refs.pop(); }, /omits governing/],
    ["fake pending reviewer", d => { d.human_review.reviewer = "Agent"; }, /invent a reviewer/],
    ["unapproved new human review", (d, f) => { d.human_review = { status: "accepted", reviewer: "fixture-product-owner", authority_ref: { ...f.authority, source_locator: "fixture-host://messages/review", source_digest: "b".repeat(64) }, reviewed_at: "2026-11-08T13:00:00Z" }; }, /start at revision/],
    ["unknown decision field", d => { d.grant = "fake"; }, /unsupported fields/],
    ["foreign workflow", d => { d.workflow_id = "foreign"; }, /identity/],
    ["foreign unit owner", d => { d.unit_ref = { ...d.unit_ref, workflow_ref: { workflow_id: "foreign", owner_kind: "global" } }; }, /ownership/],
    ["wrong publisher", d => { d.recorded_by = "another/session"; }, /recorded_by/],
    ["missing implementation file", d => { d.implementation_refs = [{ repository_id: "project", path: "missing.txt", digest: "a".repeat(64), digest_mode: "raw-file" }]; }, /missing\/linked input/],
    ["unknown evidence check", (d, f) => { f.complete(d); d.validation_refs[0].check_id = "nonexistent"; }, /real batch check/],
    ["foreign evidence workflow", (d, f) => { f.complete(d); d.validation_refs[0].workflow_id = "foreign"; }, /another workflow/],
    ["foreign evidence batch", (d, f) => { f.complete(d); d.validation_refs[0].batch_id = "foreign"; }, /real batch check/],
    ["evidence drift", (d, f) => { f.complete(d); d.validation_refs[0].digest = "0".repeat(64); }, /content changed/],
  ];
  for (const [name, change, error] of invalidDecisions) test(`reject ${name}`, () => { const f = fixture(`bad-decision-${count}`); f.freeze(); const d = f.decision(); change(d, f); const before = tree(f.root); assert.throws(() => f.record(d), error); assert.deepEqual(tree(f.root), before); });
  test("policy escalation and explicit-conflict clauses cannot delegate core conflicts", () => {
    const f = fixture("escalation"); f.policy.escalation_conditions = [f.policy.fallback_rules[0].when]; f.freeze(); assert.throws(() => f.record(f.decision()), /escalation condition/);
    const g = fixture("explicit-conflict"); g.policy.fallback_rules[0].when.kind = "explicit-conflict"; g.freeze(); assert.throws(() => g.record(g.decision()), /cannot be delegated/);
  });
  test("source precedence validates explicit provenance and rejects conflicting preference", () => {
    const f = fixture("precedence"); put(f.root, "docs/aidlc/older.md", "# Older explicit detail\n");
    const old = { repository_id: "project", path: "docs/aidlc/older.md", digest: hash("# Older explicit detail\n"), digest_mode: "raw-file" };
    f.policy.source_precedence = [{ rule_id: "prefer-current", scope_items: [f.item("GAP-001")], preferred: f.input, supersedes: [old], authority_ref: f.authority }]; f.freeze();
    assert.equal(projectAutonomyDecisions(f.root).policy!.source_precedence instanceof Array, true);
    const g = fixture("precedence-conflict"); put(g.root, "docs/aidlc/older.md", "# Older explicit detail\n");
    g.policy.source_precedence = [{ rule_id: "current", scope_items: [g.item("GAP-001")], preferred: g.input, supersedes: [old], authority_ref: g.authority }, { rule_id: "older", scope_items: [g.item("GAP-001")], preferred: old, supersedes: [g.input], authority_ref: g.authority }]; g.freeze();
    assert.throws(() => projectAutonomyDecisions(g.root), /conflicting source precedence/);
  });
  test("expired claim cannot publish even if the proposal and handoff CAS match", () => {
    const f = fixture("expired"); f.freeze(); const state = f.current(); state.active_instances["workspace-detection"].expires_at = "2020-01-01T00:00:00Z";
    put(f.root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(state)); const before = tree(f.root);
    assert.throws(() => f.record(f.decision()), /claim expired/); assert.deepEqual(tree(f.root), before);
  });
  test("conflicting decisions cannot silently replace an existing slot outcome", () => {
    const f = fixture("decision-conflict"); f.freeze(); const d = f.decision(); d.policy_clause = "category:layout"; d.action = "choose-compatible-layout";
    d.affected_refs = [f.item("GAP-002")]; d.source_refs = [f.item("GAP-002"), f.item("REQ-001"), f.item("AC-001")]; d.chosen_option = "Use a local grid"; f.record(d);
    const next = { ...d, decision_id: "other", record_id: "other", effective_revision: 2, chosen_option: "Use a local flex layout" }, before = tree(f.root);
    assert.throws(() => f.record(next), /incompatible decisions overlap/); assert.deepEqual(tree(f.root), before);
  });
  test("stale handoff CAS, expired/foreign claim and lock contention reject without publication", () => {
    const f = fixture("cas"), binding = f.freeze(), d = f.decision(), before = tree(f.root);
    assert.throws(() => recordDelegatedDecision(f.root, d, "0".repeat(64)), /handoff changed/);
    process.env.AIDLC_SESSION_BINDING = JSON.stringify({ ...binding, generation: "foreign" }); assert.throws(() => f.record(d), /binding conflicts|claim/); assert.deepEqual(tree(f.root), before);
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(binding); put(f.root, HANDOFF + ".lock", "busy"); const locked = tree(f.root); assert.throws(() => f.record(d), /EEXIST/); assert.deepEqual(tree(f.root), locked);
  });
  test("completed references leave human review pending and never claim gate verification", () => {
    const f = fixture("complete"); f.freeze(); const d = f.decision(); f.record(d); f.complete(d); d.revision = 2;
    const result = f.record(d); assert.equal(result.decisions[0].record_status, "recorded-not-verified"); assert.deepEqual(result.completion_blockers, []); assert.equal(result.human_review_summary.pending, 1); assert.equal(result.engineering_verification, "not_evaluated");
    put(f.root, "src/retry.txt", "changed"); assert.throws(() => projectAutonomyDecisions(f.root), /digest changed/);
  });
  test("decision update cannot rewrite a chosen behavior or effective design revision", () => {
    const f = fixture("revision"); f.freeze(); const d = f.decision(); f.record(d); const before = tree(f.root);
    d.revision = 3; assert.throws(() => f.record(d), /next revision/); d.revision = 2; d.effective_revision = 2; assert.throws(() => f.record(d), /cannot change effective_revision/); assert.deepEqual(tree(f.root), before);
  });
  test("actual human review reference is separate from engineering completeness", () => {
    const f = fixture("review"); f.freeze(); const d = f.decision(); f.record(d); d.revision = 2; d.human_review = { status: "accepted", reviewer: f.authority.actor_locator, authority_ref: { ...f.authority, source_locator: "fixture-host://messages/review", source_digest: "b".repeat(64) }, reviewed_at: "2026-11-08T13:00:00Z" };
    const result = f.record(d); assert.equal(result.human_review_summary.accepted, 1); assert.ok(result.completion_blockers.includes("retry-a:implementation-missing"));
    d.revision = 3; d.human_review = { status: "pending" }; assert.throws(() => f.record(d), /cannot be reversed/);
  });
  test("changed/rejected human review requires actual change input and flags incremental rework", () => {
    const f = fixture("rework"); f.freeze(); const d = f.complete(f.decision()); f.record(d); d.revision = 2;
    d.human_review = { status: "change-requested", reviewer: f.authority.actor_locator, authority_ref: { ...f.authority, source_locator: "fixture-host://messages/change", source_digest: "b".repeat(64) }, reviewed_at: "2026-11-08T13:00:00Z" };
    assert.throws(() => f.record(d), /replacement or change/); d.human_review.change_ref = f.input; const result = f.record(d);
    assert.equal(result.decisions[0].record_status, "rework-required"); assert.ok(result.completion_blockers.some(reason => reason.includes("incremental-rework")));
  });
  test("raw-file frozen handoff refuses decision append before any mutation", () => {
    const f = fixture("raw-handoff", true); put(f.root, HANDOFF, "# Frozen legacy handoff\n");
    f.batch.baseline_inputs.push({ repository_id: "project", path: HANDOFF, digest: hash(readFileSync(join(f.root, HANDOFF))), digest_mode: "raw-file" }); f.freeze(); const before = tree(f.root);
    assert.throws(() => f.record(f.decision()), /frozen as raw-file/); assert.deepEqual(tree(f.root), before);
  });
  test("policy approval cannot be reused as a human decision review", () => {
    const f = fixture("copied-review"); f.freeze(); const d = f.decision(); f.record(d); d.revision = 2;
    d.human_review = { status: "accepted", reviewer: f.authority.actor_locator, authority_ref: f.authority, reviewed_at: "2026-11-08T13:00:00Z" }; const before = tree(f.root);
    assert.throws(() => f.record(d), /own actual input/); assert.deepEqual(tree(f.root), before);
    d.human_review.authority_ref = { ...f.authority, source_locator: "fixture-host://review-new", source_digest: "b".repeat(64) }; d.human_review.reviewed_at = "2026-02-31T13:00:00Z";
    assert.throws(() => f.record(d), /actual UTC/);
  });
  test("decision append cannot invalidate its own implementation or observation references", () => {
    const f = fixture("self-reference"); f.freeze(); const d = f.decision();
    d.implementation_refs = [{ repository_id: "project", path: HANDOFF, digest: autonomyHandoffDigest(f.root), digest_mode: "raw-file" }]; const before = tree(f.root);
    assert.throws(() => f.record(d), /cannot invalidate its own/); assert.deepEqual(tree(f.root), before);
  });
  test("oversized authoring output is rejected before preview or publication", () => {
    const f = fixture("oversize"); f.freeze(); const d = f.decision(); d.rationale = "x".repeat(2 * 1024 * 1024); const before = tree(f.root);
    assert.throws(() => f.record(d, true), /bounded handoff size/); assert.throws(() => f.record(d), /bounded handoff size/); assert.deepEqual(tree(f.root), before);
  });
  test("linked decision file cannot redirect authority outside the project", () => {
    const f = fixture("link"); f.freeze(); const outside = join(scratch, "outside"); mkdirSync(outside); put(outside, "proposal.json", JSON.stringify(f.decision()));
    symlinkSync(outside, join(f.root, "linked"), process.platform === "win32" ? "junction" : "dir");
    const result = f.cli(["autonomy", "record", "--input", "linked/proposal.json", "--expect", autonomyHandoffDigest(f.root), "--preview"]); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /linked input/);
  });
  test("split decision publication uses the implement unit's module claim, not a sibling/global claim", () => {
    const f = fixture("split"), global = f.current();
    const module = createInitialState("feature", undefined, "workflow-orders-split", [], "Module implementation"); module.workflow_kind = "module"; module.module_id = "orders"; module.parent_workflow_id = global.workflow_id;
    module.completed_stage_instances.push("units-generation@module:orders");
    const integration = createInitialState("feature", undefined, "workflow-orders-integration", [], "Integration"); integration.workflow_kind = "integration"; integration.parent_workflow_id = global.workflow_id;
    saveWorkflowState(f.root, module, { kind: "module", module_id: "orders" }); saveWorkflowState(f.root, integration, { kind: "integration" });
    saveRegistry(f.root, { version: "1", global_workflow_id: global.workflow_id, split_from_workflow_id: global.workflow_id, split_at: new Date().toISOString(), updated_at: new Date().toISOString(), modules: [{ module_id: "orders", workflow_id: module.workflow_id, state_path: "aidlc/active/modules/orders/aidlc-state.md", status: "running", current_stage: "-", inception_done: false, construction_done: false, owner: "-" }], integration: { workflow_id: integration.workflow_id, state_path: "aidlc/active/integration/aidlc-state.md", status: "running", current_stage: "-", barrier_ready: false, blocking: [] }, shared_contracts: [], cross_module_requires: [] });
    Object.assign(f.unitRef.workflow_ref, { workflow_id: module.workflow_id, owner_kind: "module", module_id: "orders" }); f.freeze(); const d = f.decision();
    assert.throws(() => f.record(d), /does not own the affected unit/);
    const instance = "code-generation@module:orders@unit:publish", binding = bindSession(f.root, { instance, owner: "agent", session: "module-session", expected: claimToken(undefined) }).binding;
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(binding); d.recorded_by = "agent/module-session"; const before = tree(f.root);
    assert.equal(f.record(d).decisions[0].unit_ref.workflow_ref.workflow_id, module.workflow_id);
    const after = tree(f.root); for (const path of Object.keys(before).filter(path => path.startsWith("aidlc/active/"))) assert.equal(after[path], before[path]);
  });
  test("new refinements increment effective_revision without changing the batch denominator", () => {
    const f = fixture("effective"); f.freeze(); const snapshot = f.current().autonomy_batch; f.record(f.decision());
    const d = f.decision(); d.decision_id = d.record_id = "layout-a"; d.policy_clause = "category:layout"; d.action = "choose-compatible-layout"; d.chosen_option = "Use existing layout conventions";
    d.affected_refs = [f.item("GAP-002")]; d.source_refs = [f.item("GAP-002"), f.item("REQ-001"), f.item("AC-001")];
    assert.throws(() => f.record(d), /next effective_revision/); d.effective_revision = 2;
    assert.equal(f.record(d).effective_revision, 2); assert.deepEqual(projectAutonomyScope(f.root).snapshot, snapshot);
  });
  test("CLI preview, publication, handoff and summary expose the same decision projection", () => {
    const f = fixture("cli"); f.freeze(); put(f.root, "proposal.json", JSON.stringify(f.decision())); const before = tree(f.root), args = ["autonomy", "record", "--input", "proposal.json", "--expect", autonomyHandoffDigest(f.root)];
    const preview = f.cli([...args, "--preview"]); assert.equal(preview.status, 0, preview.stdout + preview.stderr); assert.deepEqual(tree(f.root), before);
    const published = f.cli(args); assert.equal(published.status, 0, published.stdout + published.stderr); const after = tree(f.root);
    for (const args of [["autonomy", "policy"], ["autonomy", "decisions"], ["state", "summary"], ["next", "--preview"]]) {
      const result = f.cli(args); assert.equal(result.status, 0, result.stdout + result.stderr); const payload = JSON.parse(result.stdout); assert.equal(payload.autonomy_decisions.human_review_summary.pending, 1);
      if (args[0] === "next") assert.match(payload.handoff_prompt, /Pending review alone does not pause/);
      assert.deepEqual(tree(f.root), after);
    }
    const incomplete = f.cli(["report", "--stage", "build-and-test", "--result", "completed"]); assert.notEqual(incomplete.status, 0); assert.match(incomplete.stdout + incomplete.stderr, /AUTONOMY_DECISION_INCOMPLETE/); assert.deepEqual(tree(f.root), after);
  });
  console.log(`Autonomy policy: ${count} scenarios passed`);
} finally {
  if (inherited === undefined) delete process.env.AIDLC_SESSION_BINDING; else process.env.AIDLC_SESSION_BINDING = inherited;
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir())); assert.ok(scratch.startsWith(join(tmpdir(), "aidlc-autonomy-policy-")));
  rmSync(scratch, { recursive: true, force: true });
}
