import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { adoptAutonomyBatch, autonomyDigest } from "../../core/tools/aidlc-autonomy";
import { autonomyHandoffDigest, recordDelegatedDecision } from "../../core/tools/aidlc-autonomy-policy";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../../core/tools/aidlc-light-state";
import { bindSession, claimToken } from "../../core/tools/aidlc-session";
type Row=Record<string,any>;
const repository=resolve(import.meta.dirname,"../.."),hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const HANDOFF="docs/aidlc/handoff.md",BATCH="docs/aidlc/ideation/scenario-module-mapping.md";
const put=(root:string,label:string,text:string)=>{const path=join(root,label);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);};
const fence=(records:Row[])=>"```aidlc-autonomy\n"+JSON.stringify({schema:"aidlc.autonomy-source/v1",records})+"\n```\n";
export function createAutonomyFixture(scratch: string, name: string, development = false) {
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
  const draft = () => {
    put(root, policyPath, "# Policy authoring source\n\n" + fence([policy, matrix]) + "\nHuman narrative remains here.\n");
    batch.policy_ref = { ...ref(policy), policy_id: policy.policy_id, policy_revision: policy.policy_revision }; batch.validation_matrix_ref = ref(matrix); put(root, BATCH, fence([batch]));
  };
  const freeze = () => {
    draft();
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
  return { root, policy, matrix, batch, common, input, item, authority, unitRef, current, draft, freeze, decision, complete, record, cli, policyPath, ref };
}
