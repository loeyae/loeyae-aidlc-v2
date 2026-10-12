import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXTENSION_PROVIDER_PERMISSION_MATRIX,
  GIT_SOURCE_POLICY_V1,
  P0_PROVIDER_DIAGNOSTICS,
  PROVIDER_CORE_INVARIANTS,
  PROVIDER_FALLBACK_POLICY_V1,
  PROVIDER_PROTOCOL_VERSION,
  PROVIDER_SCHEMA,
  PROVIDER_SCHEMA_OWNERSHIP,
  PROVIDER_WAIVER_POLICY_V1,
  PROVIDER_WIRE_CONVENTIONS,
  RESTRICTED_RUNNER_POLICY_V1,
  canProviderStateTransition,
  isPortableProviderPath,
  isSupportedProviderSchema,
  providerResultAuthorityViolations,
  providerSchemaMajor,
  schemaOwnership,
} from "../core/tools/aidlc-provider-types.js";

const repository = resolve(import.meta.dirname, "..");
const ownershipPath = resolve(repository, "core", "tools", "data", "provider-schema-ownership.json");
const ownershipFile = JSON.parse(readFileSync(ownershipPath, "utf8")) as {
  protocol_version: string;
  wire_conventions: Record<string, unknown>;
  contracts: unknown[];
};

assert.equal(ownershipFile.protocol_version, PROVIDER_PROTOCOL_VERSION);
assert.deepEqual(ownershipFile.wire_conventions, PROVIDER_WIRE_CONVENTIONS);
assert.deepEqual(ownershipFile.contracts, PROVIDER_SCHEMA_OWNERSHIP);
assert.equal(new Set(PROVIDER_SCHEMA_OWNERSHIP.map((entry) => entry.discriminator)).size, PROVIDER_SCHEMA_OWNERSHIP.length);
assert.equal(new Set(PROVIDER_SCHEMA_OWNERSHIP.map((entry) => entry.schema_id)).size, PROVIDER_SCHEMA_OWNERSHIP.length);
assert.equal(new Set(PROVIDER_SCHEMA_OWNERSHIP.map((entry) => entry.canonical_path)).size, PROVIDER_SCHEMA_OWNERSHIP.length);
assert.equal(schemaOwnership(PROVIDER_SCHEMA.result)?.owner_repository, "loeyae-aidlc-provider");
assert.equal(schemaOwnership(PROVIDER_SCHEMA.plan)?.owner_repository, "loeyae-aidlc-v2");
assert.equal(schemaOwnership(PROVIDER_SCHEMA.gateDecision)?.producer, "core");
assert.equal(providerSchemaMajor(PROVIDER_SCHEMA.result), 1);
assert.equal(providerSchemaMajor("not-a-schema"), undefined);
assert.equal(isSupportedProviderSchema(PROVIDER_SCHEMA.evidence), true);
assert.equal(isSupportedProviderSchema("aidlc.provider-result/v2.0"), false);

const deliveredCoreSchemas = new Set(["projectProviders", "projectProvidersLock", "profile", "plan", "gateDecision"]);
for (const contract of PROVIDER_SCHEMA_OWNERSHIP.filter((entry) => deliveredCoreSchemas.has(entry.key))) {
  const schemaPath = resolve(repository, contract.canonical_path);
  assert.equal(existsSync(schemaPath), true, `missing Core-owned Provider schema: ${contract.canonical_path}`);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as { $id?: string };
  assert.equal(schema.$id, contract.schema_id, `schema $id mismatch: ${contract.canonical_path}`);
}

const diagnosticCodes = P0_PROVIDER_DIAGNOSTICS.map((entry) => entry.code);
assert.equal(new Set(diagnosticCodes).size, diagnosticCodes.length);
assert.equal(P0_PROVIDER_DIAGNOSTICS.find((entry) => entry.code === "CHECK_FAILED")?.emitter, "provider");
assert.equal(P0_PROVIDER_DIAGNOSTICS.find((entry) => entry.code === "PROVIDER_EVIDENCE_REVOKED")?.emitter, "core");
assert.equal(P0_PROVIDER_DIAGNOSTICS.find((entry) => entry.code === "PROVIDER_PATH_ESCAPE")?.default_effect, "blocked");

assert.equal(canProviderStateTransition("plan_node", "unresolved", "selected"), true);
assert.equal(canProviderStateTransition("plan_node", "selected", "blocked"), true);
assert.equal(canProviderStateTransition("plan_node", "selected", "not_selected"), false);
assert.equal(canProviderStateTransition("invocation_result", "running", "failed"), true);
assert.equal(canProviderStateTransition("invocation_result", "failed", "passed"), false);
assert.equal(canProviderStateTransition("rule_check", "pending", "waived"), false);
assert.equal(canProviderStateTransition("rule_check", "failed", "waived"), true);
assert.equal(canProviderStateTransition("evidence", "accepted", "stale"), true);
assert.equal(canProviderStateTransition("evidence", "revoked", "accepted"), false);
assert.equal(canProviderStateTransition("gate_decision", "evaluating", "passed_with_waiver"), true);
assert.equal(canProviderStateTransition("gate_decision", "blocked", "passed"), false);

const validBoundaryResult = {
  schema: PROVIDER_SCHEMA.result,
  invocation_id: "inv-1",
  status: "failed",
  checks: [{ rule_id: "RULE-1", status: "failed", severity: "error", message: "violation" }],
  diagnostics: [{ code: "CHECK_FAILED", message: "RULE-1 failed" }],
  reports: [{ path: "reports/result.md", media_type: "text/markdown", digest: `sha256:${"0".repeat(64)}` }],
};
assert.deepEqual(providerResultAuthorityViolations(validBoundaryResult), []);

const forgedResult = {
  ...validBoundaryResult,
  plan_digest: `sha256:${"1".repeat(64)}`,
  source_revision: { commit: "forged" },
  evidence: { state: "accepted" },
  gate_decision: { status: "passed" },
  checks: [{ rule_id: "RULE-1", status: "waived", approval_ref: "self-approved" }],
  diagnostics: [{ code: "PROVIDER_EVIDENCE_STALE", message: "self-issued Core diagnostic", retryable: false }],
  reports: [{ path: "../evidence.json", media_type: "application/json", digest: `sha256:${"0".repeat(64)}` }],
};
const forgedViolations = providerResultAuthorityViolations(forgedResult).join("\n");
assert.match(forgedViolations, /plan_digest/);
assert.match(forgedViolations, /source_revision/);
assert.match(forgedViolations, /evidence/);
assert.match(forgedViolations, /gate_decision/);
assert.match(forgedViolations, /cannot self-declare waived/);
assert.match(forgedViolations, /approval_ref/);
assert.match(forgedViolations, /Provider-emitted diagnostic/);
assert.match(forgedViolations, /cannot override catalog retryable policy/);
assert.match(forgedViolations, /under reports\//);
assert.match(providerResultAuthorityViolations({ ...validBoundaryResult, status: "not_applicable" }).join("\n"), /Core owns selector outcomes/);
assert.match(providerResultAuthorityViolations({ ...validBoundaryResult, status: "deferred" }).join("\n"), /must declare deferred/);
assert.match(providerResultAuthorityViolations({
  ...validBoundaryResult,
  status: "passed",
  checks: [{ rule_id: "RULE-1", status: "failed", severity: "error", message: "hidden failure" }],
}).join("\n"), /Passed Provider Result cannot contain failed/);
assert.match(providerResultAuthorityViolations({
  ...validBoundaryResult,
  checks: [{ rule_id: "RULE-1", status: "not_applicable", severity: "info", message: "skipped" }],
}).join("\n"), /requires applicability_reason/);
assert.deepEqual(providerResultAuthorityViolations({
  ...validBoundaryResult,
  status: "deferred",
  checks: [],
  diagnostics: [{ code: "CHECK_DEFERRED", message: "dependency unavailable" }],
  deferred: { reason: "dependency unavailable", retry_after: "2026-10-12T11:00:00Z", deadline: "2026-10-12T12:00:00Z" },
}), []);
assert.match(providerResultAuthorityViolations({
  ...validBoundaryResult,
  reports: [{ path: "reports/result.md", media_type: "", digest: "sha256:ABC" }],
}).join("\n"), /media_type.*non-empty[\s\S]*digest.*lowercase hex/);

assert.equal(isPortableProviderPath("inputs/source/file.ts"), true);
assert.equal(isPortableProviderPath("../aidlc/active/audit.md"), false);
assert.equal(isPortableProviderPath("C:/project/file.ts"), false);
assert.equal(isPortableProviderPath("inputs\\source\\file.ts"), false);

assert.equal(PROVIDER_FALLBACK_POLICY_V1.default, "deny");
assert.equal(PROVIDER_FALLBACK_POLICY_V1.failure_result_may_fallback, false);
assert.equal(PROVIDER_FALLBACK_POLICY_V1.deferred_may_pass_directly, false);
assert.ok(PROVIDER_FALLBACK_POLICY_V1.eligible_diagnostics.includes("PROVIDER_TIMEOUT"));
assert.ok(PROVIDER_FALLBACK_POLICY_V1.eligible_diagnostics.includes("PROVIDER_SOURCE_UNAVAILABLE"));
assert.ok(PROVIDER_FALLBACK_POLICY_V1.never_for_diagnostics.includes("PROVIDER_REF_UNRESOLVED"));
assert.ok(PROVIDER_FALLBACK_POLICY_V1.never_for_diagnostics.includes("CHECK_FAILED"));
assert.ok(PROVIDER_FALLBACK_POLICY_V1.never_for_diagnostics.includes("PROVIDER_PATH_ESCAPE"));
assert.equal(PROVIDER_WAIVER_POLICY_V1.approval_actor, "human");
assert.equal(PROVIDER_WAIVER_POLICY_V1.allowed_original_rule_status, "failed");
assert.equal(PROVIDER_WAIVER_POLICY_V1.requires_expiry, true);
assert.equal(PROVIDER_WAIVER_POLICY_V1.passing_status_with_any_waiver, "passed_with_waiver");

assert.deepEqual(GIT_SOURCE_POLICY_V1.production_protocols, ["https", "ssh"]);
assert.deepEqual(GIT_SOURCE_POLICY_V1.test_fixture_protocols, ["file"]);
assert.equal(GIT_SOURCE_POLICY_V1.execution_source, "locked-commit-oid-only");
assert.equal(GIT_SOURCE_POLICY_V1.install_executes_provider_code, false);
assert.equal(GIT_SOURCE_POLICY_V1.implicit_remote_refresh, false);
assert.equal(GIT_SOURCE_POLICY_V1.protected_gate_trust.untrusted_allowed, false);
assert.equal(GIT_SOURCE_POLICY_V1.protected_gate_trust.revoked_always_blocked, true);

assert.equal(RESTRICTED_RUNNER_POLICY_V1.fail_if_os_isolation_unavailable, true);
assert.equal(RESTRICTED_RUNNER_POLICY_V1.filesystem.final_evidence_path_writable, false);
assert.equal(RESTRICTED_RUNNER_POLICY_V1.filesystem.state_and_audit_paths_writable, false);
assert.deepEqual(RESTRICTED_RUNNER_POLICY_V1.filesystem.writable_roots, ["output", "tmp"]);
assert.equal(RESTRICTED_RUNNER_POLICY_V1.process.shell, false);
assert.equal(RESTRICTED_RUNNER_POLICY_V1.network.default, "deny");
assert.equal(RESTRICTED_RUNNER_POLICY_V1.environment.inheritance, "deny");
assert.equal(RESTRICTED_RUNNER_POLICY_V1.environment.git_credentials, "fetch-only-never-provider");
assert.equal(RESTRICTED_RUNNER_POLICY_V1.limits.finite_plan_values_required, true);

const providerPermissions = new Map(EXTENSION_PROVIDER_PERMISSION_MATRIX.map((entry) => [entry.capability, entry.provider]));
const extensionPermissions = new Map(EXTENSION_PROVIDER_PERMISSION_MATRIX.map((entry) => [entry.capability, entry.restricted_extension]));
for (const capability of ["activate_canonical_stage", "write_state_or_audit", "issue_accepted_evidence", "issue_gate_decision", "report_or_approve", "merge_or_push"]) {
  assert.equal(providerPermissions.get(capability), false, `Provider must not gain ${capability}`);
  assert.equal(extensionPermissions.get(capability), false, `Restricted Extension must not gain ${capability}`);
}
assert.equal(extensionPermissions.get("execute_code"), false);
assert.equal(providerPermissions.get("write_invocation_result"), true);

assert.equal(new Set(PROVIDER_CORE_INVARIANTS.map((entry) => entry.id)).size, PROVIDER_CORE_INVARIANTS.length);
assert.deepEqual(PROVIDER_CORE_INVARIANTS.map((entry) => entry.id), Array.from({ length: 15 }, (_, index) => `PCORE-${String(index + 1).padStart(3, "0")}`));
assert.match(PROVIDER_CORE_INVARIANTS.find((entry) => entry.id === "PCORE-015")?.statement || "", /Knowledge Receipt.*never satisfy.*Gate/);

console.log("Provider Core contract and governance invariants passed");
