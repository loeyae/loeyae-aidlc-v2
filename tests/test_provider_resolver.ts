/**
 * MARS-152 — Provider Resolver core tests.
 *
 * Covers: Effective Profile inheritance + conservative risk, Kleene selector
 * true/false/unknown, module/unit/stage binding matching, every CapabilityExpression
 * operator (all_of / any_of / at_least / exactly_one), plan determinism, fallback vs
 * default conflict, dependency cycles, unknown-required fail-closed, and prior-plan
 * lock/profile/policy/revision drift. Project-level helper tests build a real temporary
 * project with a local `file:` Git fixture (no network) so readProjectProviders +
 * verifyLockedProviderCache run against a genuine locked cache.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PROVIDER_SCHEMA,
  type CapabilityExpression,
  type JsonObject,
  type ProfileSelector,
  type ProjectProviderIntent,
  type ProjectProviderLockEntry,
  type ProviderCapabilityDeclaration,
  type ProviderScope,
  type ProviderSourceRevision,
  type SelectorResult,
  type Sha256Digest,
} from "../core/tools/aidlc-provider-types.js";
import { projectProviderConfigDigest } from "../core/tools/aidlc-project-provider.js";
import {
  DEFAULT_PROFILE_ID,
  PROVIDER_PLANS_PATH,
  PROVIDER_PROFILE_REGISTRY_PATH,
  type ProviderCandidateInstance,
  type ProviderResolutionPolicy,
  assertPlanCurrent,
  assertPlanResolvable,
  bindingBlockMatchesScope,
  capabilityExpressionLeaves,
  checkPlanCurrency,
  composeEffectiveProfile,
  composeProfileFromRegistry,
  deepMergeFacts,
  defaultResolutionPolicy,
  defineProviderProfile,
  deriveScopeCapabilities,
  evaluateCapabilityExpression,
  evaluateProfileSelector,
  freezeProviderPlan,
  intentBindsCapability,
  matchProviderCapability,
  parseFrozenProviderPlan,
  readProviderProfileRegistry,
  recomputePlanDigest,
  recomputePlanId,
  resolveProjectProviderPlan,
  resolveProviderPlan,
  resolutionPolicyDigest,
  scopeBoundCapabilities,
  ProviderResolutionError,
} from "../core/tools/aidlc-provider-resolver.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SOURCE_REVISION: ProviderSourceRevision = {
  commit: "a".repeat(40),
  worktree_digest: `sha256:${"b".repeat(64)}` as Sha256Digest,
};
const NO_FALLBACK: ProviderResolutionPolicy = {
  policy_id: "aidlc.resolution-policy/test",
  core_allows_fallback: false,
  fallback_allowed_stages: [],
  protected_gate: false,
};

function fakeLock(instanceId: string, intent: ProjectProviderIntent, overrides: Partial<ProjectProviderLockEntry> = {}): ProjectProviderLockEntry {
  return {
    instance_id: instanceId,
    id: `framework.${instanceId}`,
    source: {
      git: "https://example.test/org/provider.git",
      requested_ref: "main",
      commit_oid: "c".repeat(40),
      object_format: "sha1",
      tree_oid: "d".repeat(40),
      subdir: null,
    },
    manifest: {
      version: "0.1.0",
      digest: `sha256:${"1".repeat(64)}` as Sha256Digest,
      rulesets: [{ id: "baseline", version: "0.1.0", digest: `sha256:${"2".repeat(64)}` as Sha256Digest }],
    },
    artifacts: {
      provider_lock_digest: `sha256:${"3".repeat(64)}` as Sha256Digest,
      sbom_digest: `sha256:${"4".repeat(64)}` as Sha256Digest,
      entrypoint_digests: { "bin/validate.js": `sha256:${"5".repeat(64)}` as Sha256Digest },
    },
    project_config_digest: projectProviderConfigDigest(intent),
    trust: { status: "untrusted" },
    ...overrides,
  };
}

function fakeIntent(instanceId: string, bindings: ProjectProviderIntent["bindings"], overrides: Partial<ProjectProviderIntent> = {}): ProjectProviderIntent {
  return {
    instance_id: instanceId,
    id: `framework.${instanceId}`,
    source: { git: "https://example.test/org/provider.git", ref: "main" },
    enabled: true,
    config: {},
    bindings,
    trust: { mode: "untrusted-development", required_for_protected_gates: false },
    ...overrides,
  };
}

function candidate(
  instanceId: string,
  bindings: ProjectProviderIntent["bindings"],
  capabilities: readonly ProviderCapabilityDeclaration[],
  overrides: { intent?: Partial<ProjectProviderIntent>; lock?: Partial<ProjectProviderLockEntry> } = {},
): ProviderCandidateInstance {
  const intent = fakeIntent(instanceId, bindings, overrides.intent);
  return {
    intent,
    lock: fakeLock(instanceId, intent, overrides.lock),
    capabilities,
  };
}

function cap(id: string, overrides: Partial<ProviderCapabilityDeclaration> = {}): ProviderCapabilityDeclaration {
  return { id, kind: "validation", risk: "standard", stages: ["*"], ...overrides };
}

// ── 1) Effective Profile inheritance + conservative risk + deterministic digests ────
{
  const base = defineProviderProfile({
    profile_id: "base",
    facts: { language: "typescript", features: { strict: true, legacy: false }, tags: ["a", "b"] },
    risk: { level: "development", protected_gate: false },
  });
  const standard = defineProviderProfile({
    profile_id: "standard",
    extends: ["base"],
    facts: { framework: "fixture", features: { legacy: true } },
    risk: { level: "standard", protected_gate: false },
  });
  const child = defineProviderProfile({
    profile_id: "child",
    extends: ["standard"],
    facts: { tags: ["c"], features: { extra: 1 } },
    risk: { level: "development", protected_gate: true },
  });

  const effective = composeEffectiveProfile([base, standard], child);
  assert.equal(effective.schema, PROVIDER_SCHEMA.profile);
  assert.equal(effective.profile_id, "child");
  // Deep-merge: nested objects merge, arrays replace, child wins.
  assert.deepEqual(effective.facts, {
    language: "typescript",
    framework: "fixture",
    features: { strict: true, legacy: true, extra: 1 },
    tags: ["c"],
  });
  // Conservative risk: max level over lineage (standard), protected_gate OR'd to true.
  assert.equal(effective.risk.level, "standard");
  assert.equal(effective.risk.protected_gate, true);
  assert.match(effective.profile_digest, DIGEST);
  assert.match(effective.risk.facts_digest, DIGEST);
  assert.deepEqual(effective.lineage.map((entry) => entry.profile_id), ["base", "standard", "child"]);
  for (const entry of effective.lineage) assert.match(entry.digest, DIGEST);

  // Determinism: identical lineage ⇒ identical digests.
  const again = composeEffectiveProfile([base, standard], child);
  assert.equal(again.profile_digest, effective.profile_digest);
  assert.equal(again.risk.facts_digest, effective.risk.facts_digest);

  // deepMergeFacts is idempotent and array-replacing.
  assert.deepEqual(deepMergeFacts({ a: { x: 1 } }, { a: { y: 2 } }), { a: { x: 1, y: 2 } });
  assert.deepEqual(deepMergeFacts({ list: [1, 2] }, { list: [3] }), { list: [3] });
  assert.deepEqual(deepMergeFacts({ a: { x: 1 } }, { a: 5 }), { a: 5 });

  // A no-facts default profile composes to an empty-facts development profile.
  const def = composeEffectiveProfile([], defineProviderProfile({ profile_id: DEFAULT_PROFILE_ID }));
  assert.deepEqual(def.facts, {});
  assert.equal(def.risk.level, "development");
  assert.equal(def.risk.protected_gate, false);

  // Self-extension and lineage repeats are rejected.
  assert.throws(() => defineProviderProfile({ profile_id: "x", extends: ["x"] }), /cannot extend itself/);
  assert.throws(() => composeEffectiveProfile([base], base), /repeats base/);
}

// ── 2) ProfileSelector Kleene three-valued evaluation (true / false / unknown) ───────
{
  const facts: JsonObject = { language: "typescript", strict: true, frameworks: ["react", "vue"], nested: { kind: "web" } };

  const exists: ProfileSelector = { fact: "language", operator: "exists" };
  assert.equal(evaluateProfileSelector(exists, facts), "true");
  assert.equal(evaluateProfileSelector({ fact: "missing", operator: "exists" }, facts), "false");

  // Missing fact ⇒ unknown for value operators.
  assert.equal(evaluateProfileSelector({ fact: "missing", operator: "equals", value: "x" }, facts), "unknown");
  assert.equal(evaluateProfileSelector({ fact: "language", operator: "equals", value: "typescript" }, facts), "true");
  assert.equal(evaluateProfileSelector({ fact: "language", operator: "equals", value: "python" }, facts), "false");
  assert.equal(evaluateProfileSelector({ fact: "language", operator: "not_equals", value: "python" }, facts), "true");
  assert.equal(evaluateProfileSelector({ fact: "frameworks", operator: "contains", value: "react" }, facts), "true");
  assert.equal(evaluateProfileSelector({ fact: "frameworks", operator: "contains", value: "svelte" }, facts), "false");
  assert.equal(evaluateProfileSelector({ fact: "language", operator: "in", values: ["typescript", "go"] }, facts), "true");
  assert.equal(evaluateProfileSelector({ fact: "nested.kind", operator: "equals", value: "web" }, facts), "true");

  // Kleene combinators: unknown propagates.
  assert.equal(evaluateProfileSelector({ all_of: [exists, { fact: "missing", operator: "equals", value: "x" }] }, facts), "unknown");
  assert.equal(evaluateProfileSelector({ all_of: [exists, { fact: "language", operator: "equals", value: "python" }] }, facts), "false");
  assert.equal(evaluateProfileSelector({ any_of: [{ fact: "language", operator: "equals", value: "python" }, { fact: "missing", operator: "equals", value: "x" }] }, facts), "unknown");
  assert.equal(evaluateProfileSelector({ any_of: [exists, { fact: "missing", operator: "equals", value: "x" }] }, facts), "true");
  assert.equal(evaluateProfileSelector({ not: { fact: "missing", operator: "equals", value: "x" } }, facts), "unknown");
  assert.equal(evaluateProfileSelector({ not: exists }, facts), "false");
}

// ── 3) module / unit / stage / capability binding matching ───────────────────────────
{
  const scope: ProviderScope = { module_id: "mod-a", unit_id: "unit-1", stage: "code-generation" };
  const intent = fakeIntent("p", [
    { modules: ["mod-a"], units: ["unit-1"], stages: ["code-generation"], capabilities: ["c.validate"] },
    { modules: ["*"], stages: ["*"], capabilities: ["c.knowledge"] },
  ]);

  assert.equal(bindingBlockMatchesScope(intent.bindings[0], scope), true);
  assert.equal(bindingBlockMatchesScope(intent.bindings[0], { module_id: "mod-b", unit_id: "unit-1", stage: "code-generation" }), false);
  assert.equal(bindingBlockMatchesScope(intent.bindings[0], { module_id: "mod-a", unit_id: "unit-2", stage: "code-generation" }), false);
  assert.equal(bindingBlockMatchesScope(intent.bindings[0], { module_id: "mod-a", unit_id: "unit-1", stage: "design" }), false);
  assert.equal(bindingBlockMatchesScope(intent.bindings[1], { stage: "anything" }), true);

  assert.equal(intentBindsCapability(intent, "c.validate", scope), true);
  assert.equal(intentBindsCapability(intent, "c.knowledge", scope), true);
  assert.equal(intentBindsCapability(intent, "c.validate", { stage: "design" }), false);
  assert.deepEqual(scopeBoundCapabilities(intent, scope), ["c.knowledge", "c.validate"]);
  assert.deepEqual(scopeBoundCapabilities(intent, { stage: "design" }), ["c.knowledge"]);

  // matchProviderCapability needs a stage-eligible manifest declaration.
  const matched = matchProviderCapability(
    candidate("p", intent.bindings, [cap("c.validate", { stages: ["code-generation"] })]),
    "c.validate",
    scope,
  );
  assert.equal(matched.matched, true);
  const noDecl = matchProviderCapability(candidate("p", intent.bindings, []), "c.validate", scope);
  assert.equal(noDecl.matched, false);
  const wrongStage = matchProviderCapability(
    candidate("p", intent.bindings, [cap("c.validate", { stages: ["design"] })]),
    "c.validate",
    scope,
  );
  assert.equal(wrongStage.matched, false);
  const disabled = matchProviderCapability(
    candidate("p", intent.bindings, [cap("c.validate")], { intent: { enabled: false } }),
    "c.validate",
    scope,
  );
  assert.equal(disabled.matched, false);
}

// ── 4) Capability expression operators + leaf collection + evaluation ────────────────
{
  const expr: CapabilityExpression = {
    all_of: [
      { capability: "a" },
      { any_of: [{ capability: "b" }, { capability: "c" }] },
      { at_least: { count: 2, of: [{ capability: "d" }, { capability: "e" }, { capability: "f" }] } },
      { exactly_one: [{ capability: "g" }, { capability: "h" }] },
    ],
  };
  assert.deepEqual(capabilityExpressionLeaves(expr), ["a", "b", "c", "d", "e", "f", "g", "h"]);

  const sat = (entries: Record<string, SelectorResult>): ReadonlyMap<string, SelectorResult> => new Map(Object.entries(entries));
  assert.equal(evaluateCapabilityExpression({ capability: "a" }, sat({ a: "true" })), "true");
  assert.equal(evaluateCapabilityExpression({ capability: "a" }, sat({})), "false");
  assert.equal(evaluateCapabilityExpression({ all_of: [{ capability: "a" }, { capability: "b" }] }, sat({ a: "true", b: "false" })), "false");
  assert.equal(evaluateCapabilityExpression({ all_of: [{ capability: "a" }, { capability: "b" }] }, sat({ a: "true", b: "unknown" })), "unknown");
  assert.equal(evaluateCapabilityExpression({ any_of: [{ capability: "a" }, { capability: "b" }] }, sat({ a: "false", b: "true" })), "true");
  assert.equal(evaluateCapabilityExpression({ at_least: { count: 2, of: [{ capability: "a" }, { capability: "b" }, { capability: "c" }] } }, sat({ a: "true", b: "true", c: "false" })), "true");
  assert.equal(evaluateCapabilityExpression({ at_least: { count: 2, of: [{ capability: "a" }, { capability: "b" }, { capability: "c" }] } }, sat({ a: "true", b: "unknown", c: "false" })), "unknown");
  assert.equal(evaluateCapabilityExpression({ exactly_one: [{ capability: "a" }, { capability: "b" }] }, sat({ a: "true", b: "false" })), "true");
  assert.equal(evaluateCapabilityExpression({ exactly_one: [{ capability: "a" }, { capability: "b" }] }, sat({ a: "true", b: "true" })), "false");
  assert.equal(evaluateCapabilityExpression({ exactly_one: [{ capability: "a" }, { capability: "b" }] }, sat({ a: "true", b: "unknown" })), "unknown");
  // Vacuous all_of is trivially true.
  assert.equal(evaluateCapabilityExpression({ all_of: [] }, sat({})), "true");
}

// ── 5a) Plan determinism + happy path ────────────────────────────────────────────────
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p", facts: { language: "typescript" } }));
  const candidates = [
    candidate("alpha", [{ modules: ["*"], stages: ["*"], capabilities: ["c.validate"] }], [cap("c.validate", { selector: { fact: "language", operator: "equals", value: "typescript" } })]),
  ];
  const input = { candidates, scope, profile, capability_expression: { capability: "c.validate" } as CapabilityExpression, policy: NO_FALLBACK, source_revision: SOURCE_REVISION };
  const first = resolveProviderPlan(input);
  const second = resolveProviderPlan(input);
  assert.equal(first.resolvable, true);
  assert.equal(first.plan.plan_digest, second.plan.plan_digest);
  assert.equal(first.plan.plan_id, second.plan.plan_id);
  assert.match(first.plan.plan_id, /^plan-[0-9a-f]{32}$/);
  assert.equal(first.plan.nodes.length, 1);
  assert.equal(first.plan.nodes[0].state, "selected");
  assert.equal(first.plan.nodes[0].selector_result, "true");
  assert.equal(recomputePlanDigest(first.plan), first.plan.plan_digest);
  // assertPlanResolvable returns the plan on success.
  assert.equal(assertPlanResolvable(first).plan_id, first.plan.plan_id);
}

// ── 5b) Unknown-required selector fails closed ───────────────────────────────────────
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p", facts: {} }));
  const candidates = [
    candidate("alpha", [{ modules: ["*"], stages: ["*"], capabilities: ["c.validate"] }], [cap("c.validate", { selector: { fact: "language", operator: "equals", value: "typescript" } })]),
  ];
  const resolution = resolveProviderPlan({ candidates, scope, profile, capability_expression: { capability: "c.validate" }, policy: NO_FALLBACK, source_revision: SOURCE_REVISION });
  assert.equal(resolution.resolvable, false);
  assert.equal(resolution.plan.nodes[0].state, "unknown");
  assert.equal(resolution.plan.nodes[0].selector_result, "unknown");
  assert.ok(resolution.diagnostics.some((entry) => entry.code === "PROVIDER_SELECTOR_UNKNOWN"));
  assert.throws(() => assertPlanResolvable(resolution), (error: unknown) => error instanceof ProviderResolutionError && error.diagnostic === "PROVIDER_SELECTOR_UNKNOWN");

  const competingUnknown = resolveProviderPlan({
    candidates: [
      candidate("alpha", [{ modules: ["*"], stages: ["*"], capabilities: ["c.validate"] }], [cap("c.validate")]),
      candidate("beta", [{ modules: ["*"], stages: ["*"], capabilities: ["c.validate"] }], [cap("c.validate", { selector: { fact: "language", operator: "equals", value: "typescript" } })]),
    ],
    scope,
    profile,
    capability_expression: { capability: "c.validate" },
    policy: NO_FALLBACK,
    source_revision: SOURCE_REVISION,
  });
  assert.equal(competingUnknown.resolvable, false, "a required capability cannot silently ignore an unknown competing candidate");
  assert.equal(competingUnknown.plan.nodes.find((node) => node.provider_instance_id === "beta")?.required, true);
}

// ── 5c) Missing required capability fails closed ─────────────────────────────────────
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p" }));
  const resolution = resolveProviderPlan({ candidates: [], scope, profile, capability_expression: { capability: "c.absent" }, policy: NO_FALLBACK, source_revision: SOURCE_REVISION });
  assert.equal(resolution.resolvable, false);
  assert.equal(resolution.plan.nodes[0].state, "blocked");
  assert.ok(resolution.diagnostics.some((entry) => entry.code === "PROVIDER_CAPABILITY_MISSING"));
  assert.throws(() => assertPlanResolvable(resolution), /PROVIDER_CAPABILITY_MISSING/);
}

// ── 5d) Default (competing candidate) conflict fails closed ──────────────────────────
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p" }));
  const binding = [{ modules: ["*"], stages: ["*"], capabilities: ["c.validate"] }];
  const candidates = [
    candidate("alpha", binding, [cap("c.validate")]),
    candidate("beta", binding, [cap("c.validate")]),
  ];
  const resolution = resolveProviderPlan({ candidates, scope, profile, capability_expression: { capability: "c.validate" }, policy: NO_FALLBACK, source_revision: SOURCE_REVISION });
  assert.equal(resolution.resolvable, false);
  assert.ok(resolution.diagnostics.some((entry) => entry.code === "PROVIDER_PLAN_CONFLICT"));
  assert.ok(resolution.plan.nodes.every((node) => node.state === "blocked"));
}

// ── 5e) Fallback: declared group admitted only under core + stage policy ─────────────
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p" }));
  const binding = [{ modules: ["*"], stages: ["*"], capabilities: ["c.validate"] }];
  const candidates = [
    candidate("alpha", binding, [cap("c.validate", { fallback_group: "g1" })]),
    candidate("beta", binding, [cap("c.validate", { fallback_group: "g1" })]),
  ];
  // Denied by policy ⇒ fallback not allowed diagnostic (and conflict stays).
  const denied = resolveProviderPlan({ candidates, scope, profile, capability_expression: { capability: "c.validate" }, policy: NO_FALLBACK, source_revision: SOURCE_REVISION });
  assert.ok(denied.diagnostics.some((entry) => entry.code === "PROVIDER_FALLBACK_NOT_ALLOWED"));
  assert.equal(denied.resolvable, false);

  // Admitted by core + stage policy ⇒ primary carries a fallback chain and resolves.
  const allowPolicy: ProviderResolutionPolicy = { policy_id: "p", core_allows_fallback: true, fallback_allowed_stages: ["code-generation"], protected_gate: false };
  const allowed = resolveProviderPlan({ candidates, scope, profile, capability_expression: { capability: "c.validate" }, policy: allowPolicy, source_revision: SOURCE_REVISION });
  const primary = allowed.plan.nodes.find((node) => node.provider_instance_id === "alpha");
  assert.ok(primary && primary.fallback_node_ids.length === 1, "primary must carry one fallback alternate");
  assert.equal(allowed.resolvable, true);
}

// ── 5f) Dependency cycle fails closed ────────────────────────────────────────────────
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p" }));
  const candidates = [
    candidate("alpha", [{ modules: ["*"], stages: ["*"], capabilities: ["c.a"] }], [cap("c.a")]),
    candidate("beta", [{ modules: ["*"], stages: ["*"], capabilities: ["c.b"] }], [cap("c.b")]),
  ];
  const dependencies = new Map<string, readonly string[]>([["c.a", ["c.b"]], ["c.b", ["c.a"]]]);
  const resolution = resolveProviderPlan(
    { candidates, scope, profile, capability_expression: { all_of: [{ capability: "c.a" }, { capability: "c.b" }] }, policy: NO_FALLBACK, source_revision: SOURCE_REVISION },
    { dependencies },
  );
  assert.equal(resolution.resolvable, false);
  assert.ok(resolution.diagnostics.some((entry) => entry.code === "PROVIDER_DEPENDENCY_CYCLE"));
  assert.ok(resolution.plan.nodes.every((node) => node.state === "blocked"));

  // Acyclic dependencies resolve.
  const acyclic = resolveProviderPlan(
    { candidates, scope, profile, capability_expression: { all_of: [{ capability: "c.a" }, { capability: "c.b" }] }, policy: NO_FALLBACK, source_revision: SOURCE_REVISION },
    { dependencies: new Map([["c.a", ["c.b"]]]) },
  );
  assert.equal(acyclic.resolvable, true);
}

// ── 5g) Protected-gate trust fails closed for untrusted candidates ───────────────────
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p" }));
  const binding = [{ modules: ["*"], stages: ["*"], capabilities: ["c.validate"] }];
  const untrusted = resolveProviderPlan({
    candidates: [candidate("alpha", binding, [cap("c.validate")])],
    scope,
    profile,
    capability_expression: { capability: "c.validate" },
    policy: { policy_id: "p", core_allows_fallback: false, fallback_allowed_stages: [], protected_gate: true },
    source_revision: SOURCE_REVISION,
  });
  assert.equal(untrusted.resolvable, false);
  assert.ok(untrusted.diagnostics.some((entry) => entry.code === "PROVIDER_COMMIT_UNTRUSTED"));

  const verified = resolveProviderPlan({
    candidates: [candidate("alpha", binding, [cap("c.validate")], { lock: { trust: { status: "verified", verification_digest: `sha256:${"7".repeat(64)}` as Sha256Digest } } })],
    scope,
    profile,
    capability_expression: { capability: "c.validate" },
    policy: { policy_id: "p", core_allows_fallback: false, fallback_allowed_stages: [], protected_gate: true },
    source_revision: SOURCE_REVISION,
  });
  assert.equal(verified.resolvable, true);
  assert.equal(verified.plan.approval?.status, "pending");
}

// ── 6) Prior-plan currency: lock / profile / policy / revision drift fails closed ────
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p", facts: { language: "typescript" } }));
  const candidates = [candidate("alpha", [{ modules: ["*"], stages: ["*"], capabilities: ["c.validate"] }], [cap("c.validate")])];
  const policy = NO_FALLBACK;
  const lockDigest = `sha256:${"a".repeat(64)}` as Sha256Digest;
  const { plan } = resolveProviderPlan({ candidates, scope, profile, capability_expression: { capability: "c.validate" }, policy, source_revision: SOURCE_REVISION, project_lock_digest: lockDigest });

  const good = { project_lock_digest: lockDigest, profile_digest: profile.profile_digest, policy_digest: resolutionPolicyDigest(policy), source_revision: SOURCE_REVISION };
  assert.equal(checkPlanCurrency(plan, good).current, true);
  assert.equal(assertPlanCurrent(plan, good).plan_id, plan.plan_id);

  assert.equal(checkPlanCurrency(plan, { ...good, project_lock_digest: `sha256:${"9".repeat(64)}` as Sha256Digest }).current, false);
  assert.equal(checkPlanCurrency(plan, { ...good, profile_digest: `sha256:${"8".repeat(64)}` as Sha256Digest }).current, false);
  assert.equal(checkPlanCurrency(plan, { ...good, policy_digest: `sha256:${"8".repeat(64)}` as Sha256Digest }).current, false);
  assert.equal(checkPlanCurrency(plan, { ...good, source_revision: { ...SOURCE_REVISION, commit: "f".repeat(40) } }).current, false);
  assert.throws(() => assertPlanCurrent(plan, { ...good, project_lock_digest: `sha256:${"9".repeat(64)}` as Sha256Digest }), /PROVIDER_PLAN_STALE/);

  // A tampered stored plan (digest no longer verifies) is stale.
  const tampered = { ...plan, nodes: [] };
  assert.equal(checkPlanCurrency(tampered, good).current, false);
}

// ── 7) Profile registry parsing + default synthesis ─────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), "aidlc-resolver-registry-"));
  try {
    // Absent file ⇒ synthesized default profile with no facts.
    const absent = readProviderProfileRegistry(root);
    assert.equal(absent.active, DEFAULT_PROFILE_ID);
    const defaultProfile = composeProfileFromRegistry(absent);
    assert.deepEqual(defaultProfile.facts, {});

    // A real registry with an extends lineage composes correctly.
    mkdirSync(join(root, ".aidlc"), { recursive: true });
    writeFileSync(join(root, PROVIDER_PROFILE_REGISTRY_PATH), JSON.stringify({
      version: 1,
      active: "web",
      profiles: {
        base: { facts: { org: "loeyae" }, risk: { level: "standard" } },
        web: { extends: ["base"], facts: { language: "typescript" }, risk: { level: "development", protected_gate: true } },
      },
    }) + "\n", "utf8");
    const registry = readProviderProfileRegistry(root);
    const composed = composeProfileFromRegistry(registry);
    assert.deepEqual(composed.facts, { org: "loeyae", language: "typescript" });
    assert.equal(composed.risk.level, "standard");
    assert.equal(composed.risk.protected_gate, true);

    // extends cycle rejected.
    writeFileSync(join(root, PROVIDER_PROFILE_REGISTRY_PATH), JSON.stringify({
      profiles: { a: { extends: ["b"] }, b: { extends: ["a"] } },
      active: "a",
    }) + "\n", "utf8");
    const cyclic = readProviderProfileRegistry(root);
    assert.throws(() => composeProfileFromRegistry(cyclic), /extends cycle/);

    // unknown field rejected.
    writeFileSync(join(root, PROVIDER_PROFILE_REGISTRY_PATH), JSON.stringify({ profiles: {}, bogus: true }) + "\n", "utf8");
    assert.throws(() => readProviderProfileRegistry(root), /unknown field bogus/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── 8) Project-level helper against a real local Git fixture (no network) ────────────
{
  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stderr}\n${result.stdout}`);
    return result.stdout.trim();
  }
  function write(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  function providerManifest(): string {
    return `schema: aidlc.provider/v1.1
provider_id: framework.resolver-fixture
name: Resolver Fixture Provider
version: 0.1.0
kind: validation
capabilities:
  - framework.resolver.validation
  - framework.resolver.knowledge
entrypoint:
  path: bin/validate.js
  args: [--request]
ruleset:
  id: resolver-baseline
  version: 0.1.0
  catalog: rules/catalog.json
artifacts:
  lock: provider.lock
  sbom: sbom.spdx.json
policies:
  network: none
  writes: []
`;
  }

  const root = mkdtempSync(join(tmpdir(), "aidlc-resolver-project-"));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  try {
    const source = join(root, "provider-source");
    const remote = join(root, "provider-remote.git");
    const providerRoot = join(source, "providers", "fixture");
    mkdirSync(source, { recursive: true });
    git(source, "init", "-b", "main");
    git(source, "config", "user.email", "fixture@example.test");
    git(source, "config", "user.name", "Resolver Fixture");
    write(join(providerRoot, "provider.yaml"), providerManifest());
    write(join(providerRoot, "rules", "catalog.json"), JSON.stringify({ rules: [{ id: "resolver.rule", title: "Fixture", severity: "error", appliesTo: ["source"] }] }, null, 2) + "\n");
    write(join(providerRoot, "provider.lock"), JSON.stringify({ lockfileVersion: 1, packages: {} }) + "\n");
    write(join(providerRoot, "sbom.spdx.json"), JSON.stringify({ spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT", name: "fixture", documentNamespace: "https://example.test/sbom/fixture/0.1.0" }) + "\n");
    write(join(providerRoot, "bin", "validate.js"), "#!/usr/bin/env node\n");
    git(source, "add", ".");
    git(source, "commit", "-m", "fixture v1");
    mkdirSync(remote, { recursive: true });
    git(remote, "init", "--bare");
    git(source, "remote", "add", "origin", remote);
    git(source, "push", "-u", "origin", "main");
    const sourceUrl = pathToFileURL(remote).href;

    const project = join(root, "project");
    mkdirSync(join(project, ".aidlc"), { recursive: true });
    write(join(project, ".aidlc", "provider-git-policy.json"), JSON.stringify({ version: 1, allow_file_fixtures: true }) + "\n");

    // Install the provider through the real CLI-equivalent path.
    const { addProjectProvider } = await import("../core/tools/aidlc-provider-cli.js");
    addProjectProvider(project, {
      source: sourceUrl,
      ref: "main",
      subdir: "providers/fixture",
      instance: "resolver-fixture",
      id: "framework.resolver-fixture",
      allowFile: true,
    });

    const scope: ProviderScope = { module_id: "mod-a", stage: "code-generation" };
    const result = resolveProjectProviderPlan(project, { scope, source_revision: SOURCE_REVISION, policy: defaultResolutionPolicy(), freeze: true });

    assert.equal(result.resolution.resolvable, true, JSON.stringify(result.resolution.diagnostics));
    assert.deepEqual(deriveScopeCapabilities(await import("../core/tools/aidlc-provider-resolver.js").then((mod) => mod.readProjectProviderCandidates(project, scope)), scope), ["framework.resolver.knowledge", "framework.resolver.validation"]);
    assert.equal(result.provider_context.profile_id, DEFAULT_PROFILE_ID);
    assert.match(result.provider_context.plan_id, /^plan-[0-9a-f]{32}$/);
    assert.ok(result.provider_actions.length >= 1);
    for (const action of result.provider_actions) {
      // Each action binds instance, lock, plan triple and commit/tree/manifest/config digests.
      assert.equal(action.provider_instance_id, "resolver-fixture");
      assert.equal(action.provider_id, "framework.resolver-fixture");
      assert.equal(action.required_after, "stage-execution");
      assert.deepEqual(action.binding, {
        provider_instance_id: action.provider_instance_id,
        project_lock_digest: action.project_lock_digest,
        plan_id: action.plan_id,
        plan_digest: action.plan_digest,
        plan_node_id: action.plan_node_id,
        commit_oid: action.commit_oid,
        tree_oid: action.tree_oid,
        manifest_digest: action.manifest_digest,
        config_digest: action.config_digest,
      });
      assert.equal(action.plan_id, result.plan.plan_id);
      assert.equal(action.plan_digest, result.plan.plan_digest);
      assert.equal(action.project_lock_digest, result.plan.project_lock_digest);
      assert.match(action.project_lock_digest, DIGEST);
      assert.match(action.commit_oid, /^[0-9a-f]{40}$/);
      assert.match(action.tree_oid, /^[0-9a-f]{40}$/);
      assert.match(action.manifest_digest, DIGEST);
      assert.match(action.config_digest, DIGEST);
      assert.ok(action.plan_node_id.startsWith("node-"));
    }

    // Freeze wrote the plan file and it round-trips to the same plan.
    const planPath = join(project, PROVIDER_PLANS_PATH, `${result.plan.plan_id}.json`);
    const frozen = parseFrozenProviderPlan(JSON.parse(readFileSync(planPath, "utf8")));
    assert.equal(frozen.plan_digest, result.plan.plan_digest);
    assert.equal(recomputePlanDigest(frozen), result.plan.plan_digest);
    // Freezing is idempotent.
    const again = freezeProviderPlan(project, result.plan);
    assert.ok(again.endsWith(`${result.plan.plan_id}.json`));

    // Re-resolution is deterministic (lock/profile unchanged ⇒ same plan).
    const second = resolveProjectProviderPlan(project, { scope, source_revision: SOURCE_REVISION, policy: defaultResolutionPolicy() });
    assert.equal(second.plan.plan_digest, result.plan.plan_digest);

    // The project helper never refreshed the remote: delete the remote and re-resolve
    // from the cache; it still works.
    rmSync(remote, { recursive: true, force: true });
    const offline = resolveProjectProviderPlan(project, { scope, source_revision: SOURCE_REVISION, policy: defaultResolutionPolicy() });
    assert.equal(offline.plan.plan_digest, result.plan.plan_digest);

    console.log("Provider Resolver project-helper + fixture tests passed");
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    rmSync(root, { recursive: true, force: true });
  }
}

// ── 9) any_of required-branch selection: one true branch, one unknown ⇒ resolves ────
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p", facts: { language: "typescript" } }));
  const candidates = [
    candidate("alpha", [{ modules: ["*"], stages: ["*"], capabilities: ["c.a"] }], [cap("c.a", { selector: { fact: "language", operator: "equals", value: "typescript" } })]),
    candidate("beta", [{ modules: ["*"], stages: ["*"], capabilities: ["c.b"] }], [cap("c.b", { selector: { fact: "missing", operator: "equals", value: "x" } })]),
  ];
  const expr: CapabilityExpression = { any_of: [{ capability: "c.a" }, { capability: "c.b" }] };
  const resolution = resolveProviderPlan({ candidates, scope, profile, capability_expression: expr, policy: NO_FALLBACK, source_revision: SOURCE_REVISION });
  assert.equal(resolution.resolvable, true, JSON.stringify(resolution.diagnostics));
  const aNode = resolution.plan.nodes.find((node) => node.capability_id === "c.a");
  const bNode = resolution.plan.nodes.find((node) => node.capability_id === "c.b");
  assert.ok(aNode && aNode.required === true, "satisfied any_of branch is required");
  assert.ok(bNode && bNode.required === false, "the unknown, unselected any_of branch must NOT be required");
  assert.equal(bNode?.state, "unknown");
  // The unknown non-required branch must not drag the plan to false.
  assert.ok(!resolution.diagnostics.some((entry) => entry.code === "PROVIDER_SELECTOR_UNKNOWN" && entry.message.includes("expression")));
}

// ── 10) Dependency closure: top-level needs only A, A depends on B ───────────────────
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p" }));
  const base = [
    candidate("alpha", [{ modules: ["*"], stages: ["*"], capabilities: ["c.a"] }], [cap("c.a")]),
    candidate("beta", [{ modules: ["*"], stages: ["*"], capabilities: ["c.b"] }], [cap("c.b")]),
  ];
  const dependencies = new Map<string, readonly string[]>([["c.a", ["c.b"]]]);
  const ok = resolveProviderPlan({ candidates: base, scope, profile, capability_expression: { capability: "c.a" }, policy: NO_FALLBACK, source_revision: SOURCE_REVISION }, { dependencies });
  assert.equal(ok.resolvable, true, JSON.stringify(ok.diagnostics));
  const bNode = ok.plan.nodes.find((node) => node.capability_id === "c.b");
  assert.ok(bNode, "dependency B must have a node even though it is not in the top-level expression");
  assert.equal(bNode?.required, true, "the dependency of a required capability is required");
  const aNode = ok.plan.nodes.find((node) => node.capability_id === "c.a")!;
  assert.equal(aNode.dependencies.length, 1);
  assert.ok(aNode.dependencies[0].startsWith("node-") && !aNode.dependencies[0].startsWith("cap:"), "dependencies carry real node ids, not cap:<id>");
  assert.ok(ok.plan.nodes.some((node) => node.node_id === aNode.dependencies[0]), "dependency references an existing Plan node");

  // B missing ⇒ blocks (closure validates the dependency even off the top level).
  const bMissing = resolveProviderPlan({ candidates: [base[0]], scope, profile, capability_expression: { capability: "c.a" }, policy: NO_FALLBACK, source_revision: SOURCE_REVISION }, { dependencies });
  assert.equal(bMissing.resolvable, false);
  assert.ok(bMissing.diagnostics.some((entry) => entry.code === "PROVIDER_CAPABILITY_MISSING"));
}

// ── 11) exactly_one over-satisfied ⇒ PROVIDER_PLAN_CONFLICT (never CAPABILITY_MISSING) ─
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p" }));
  const candidates = [
    candidate("alpha", [{ modules: ["*"], stages: ["*"], capabilities: ["c.a"] }], [cap("c.a")]),
    candidate("beta", [{ modules: ["*"], stages: ["*"], capabilities: ["c.b"] }], [cap("c.b")]),
  ];
  const expr: CapabilityExpression = { exactly_one: [{ capability: "c.a" }, { capability: "c.b" }] };
  const resolution = resolveProviderPlan({ candidates, scope, profile, capability_expression: expr, policy: NO_FALLBACK, source_revision: SOURCE_REVISION });
  assert.equal(resolution.resolvable, false);
  assert.ok(resolution.diagnostics.some((entry) => entry.code === "PROVIDER_PLAN_CONFLICT"), "two satisfying exactly_one branches is a conflict");
  assert.throws(() => assertPlanResolvable(resolution), (error: unknown) => error instanceof ProviderResolutionError && error.diagnostic === "PROVIDER_PLAN_CONFLICT");
}

// ── 12) Fallback: third ungrouped candidate must not be let through ──────────────────
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p" }));
  const binding = [{ modules: ["*"], stages: ["*"], capabilities: ["c.validate"] }];
  const allowPolicy: ProviderResolutionPolicy = { policy_id: "p", core_allows_fallback: true, fallback_allowed_stages: ["code-generation"], protected_gate: false };

  // alpha + beta in group g1, gamma with NO group ⇒ the chain cannot cover gamma.
  const threeWay = resolveProviderPlan({
    candidates: [
      candidate("alpha", binding, [cap("c.validate", { fallback_group: "g1" })]),
      candidate("beta", binding, [cap("c.validate", { fallback_group: "g1" })]),
      candidate("gamma", binding, [cap("c.validate")]),
    ],
    scope,
    profile,
    capability_expression: { capability: "c.validate" },
    policy: allowPolicy,
    source_revision: SOURCE_REVISION,
  });
  assert.equal(threeWay.resolvable, false, "a partial group chain must not pass an un-grouped third candidate");
  assert.ok(threeWay.diagnostics.some((entry) => entry.code === "PROVIDER_FALLBACK_NOT_ALLOWED" || entry.code === "PROVIDER_PLAN_CONFLICT"));

  // Two members fully in one group ⇒ primary required, alternate not required.
  const paired = resolveProviderPlan({
    candidates: [
      candidate("alpha", binding, [cap("c.validate", { fallback_group: "g1" })]),
      candidate("beta", binding, [cap("c.validate", { fallback_group: "g1" })]),
    ],
    scope,
    profile,
    capability_expression: { capability: "c.validate" },
    policy: allowPolicy,
    source_revision: SOURCE_REVISION,
  });
  assert.equal(paired.resolvable, true, JSON.stringify(paired.diagnostics));
  const primary = paired.plan.nodes.find((node) => node.provider_instance_id === "alpha")!;
  const alternate = paired.plan.nodes.find((node) => node.provider_instance_id === "beta")!;
  assert.equal(primary.fallback_node_ids.length, 1, "primary carries the alternate");
  assert.equal(primary.required, true, "the main (primary) node is required");
  assert.equal(alternate.required, false, "the fallback alternate node is NOT required");
}

// ── 13) Plan approval: pending / approved / not_required + approval tamper currency ──
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p" }));
  const binding = [{ modules: ["*"], stages: ["*"], capabilities: ["c.validate"] }];
  const protectedPolicy: ProviderResolutionPolicy = { policy_id: "p", core_allows_fallback: false, fallback_allowed_stages: [], protected_gate: true };
  const verifiedLock = { lock: { trust: { status: "verified", verification_digest: `sha256:${"7".repeat(64)}` as Sha256Digest } } };

  // Protected gate, no approval_ref ⇒ pending.
  const pending = resolveProviderPlan({ candidates: [candidate("alpha", binding, [cap("c.validate")], verifiedLock)], scope, profile, capability_expression: { capability: "c.validate" }, policy: protectedPolicy, source_revision: SOURCE_REVISION });
  assert.equal(pending.plan.approval?.status, "pending");

  // Protected gate, with approval_ref ⇒ approved; digest verifies.
  const approved = resolveProviderPlan({ candidates: [candidate("alpha", binding, [cap("c.validate")], verifiedLock)], scope, profile, capability_expression: { capability: "c.validate" }, policy: protectedPolicy, source_revision: SOURCE_REVISION, approval_ref: "approval:tkt-1" });
  assert.equal(approved.plan.approval?.status, "approved");
  assert.equal(approved.plan.approval?.approval_ref, "approval:tkt-1");
  assert.notEqual(approved.plan.plan_id, pending.plan.plan_id, "pending and approved plans are distinct immutable objects");
  assert.equal(recomputePlanDigest(approved.plan), approved.plan.plan_digest, "approval participates and the digest still verifies");
  assert.equal(recomputePlanId(approved.plan), approved.plan.plan_id, "approval participates in the immutable plan identity");

  // Plain plan ⇒ not_required.
  const plain = resolveProviderPlan({ candidates: [candidate("alpha", binding, [cap("c.validate")])], scope, profile, capability_expression: { capability: "c.validate" }, policy: NO_FALLBACK, source_revision: SOURCE_REVISION });
  assert.equal(plain.plan.approval?.status, "not_required");

  // Tampering with the approval ref invalidates the plan digest (currency mismatch).
  const tampered = { ...approved.plan, approval: { status: "approved" as const, approval_ref: "approval:forged" } };
  assert.notEqual(recomputePlanDigest(tampered), tampered.plan_digest, "a tampered approval ref must not verify");
  const good = { project_lock_digest: approved.plan.project_lock_digest, profile_digest: approved.plan.profile_digest, policy_digest: approved.plan.policy_digest, source_revision: SOURCE_REVISION };
  assert.equal(checkPlanCurrency(tampered, good).current, false, "tampered-approval plan is stale");
  // recomputePlanDigest excludes ONLY plan_digest: a plan with a different plan_id does not verify.
  const reId = { ...approved.plan, plan_id: "plan-" + "0".repeat(32) };
  assert.notEqual(recomputePlanDigest(reId), reId.plan_digest, "plan_id participates in the final digest");
  assert.notEqual(recomputePlanId(reId), reId.plan_id, "a forged plan_id is not content-addressed");
}

// ── 14) Candidate protocol compatibility: explicit incompatible ⇒ SCHEMA_INCOMPATIBLE ─
{
  const scope: ProviderScope = { stage: "code-generation" };
  const profile = composeEffectiveProfile([], defineProviderProfile({ profile_id: "p" }));
  const binding = [{ modules: ["*"], stages: ["*"], capabilities: ["c.validate"] }];
  const incompatible: ProviderCandidateInstance = {
    ...candidate("alpha", binding, []),
    protocol: { minimum: "2.0", maximum_exclusive: "3.0" },
  };
  const resolution = resolveProviderPlan({ candidates: [incompatible], scope, profile, capability_expression: { capability: "c.validate" }, policy: NO_FALLBACK, source_revision: SOURCE_REVISION });
  assert.equal(resolution.resolvable, false);
  assert.ok(resolution.diagnostics.some((entry) => entry.code === "PROVIDER_SCHEMA_INCOMPATIBLE"));
  assert.throws(() => assertPlanResolvable(resolution), (error: unknown) => error instanceof ProviderResolutionError && error.diagnostic === "PROVIDER_SCHEMA_INCOMPATIBLE");

  // A compatible range (admits 1.1) resolves.
  const compatible: ProviderCandidateInstance = {
    ...candidate("alpha", binding, [cap("c.validate")]),
    protocol: { minimum: "1.0", maximum_exclusive: "2.0" },
  };
  const okResolution = resolveProviderPlan({ candidates: [compatible], scope, profile, capability_expression: { capability: "c.validate" }, policy: NO_FALLBACK, source_revision: SOURCE_REVISION });
  assert.equal(okResolution.resolvable, true, JSON.stringify(okResolution.diagnostics));

  // A revoked candidate fails closed with PROVIDER_COMMIT_REVOKED.
  const revoked: ProviderCandidateInstance = {
    ...candidate("alpha", binding, []),
    incompatibility: { code: "PROVIDER_COMMIT_REVOKED", message: "revoked" },
  };
  const revokedResolution = resolveProviderPlan({ candidates: [revoked], scope, profile, capability_expression: { capability: "c.validate" }, policy: NO_FALLBACK, source_revision: SOURCE_REVISION });
  assert.equal(revokedResolution.resolvable, false);
  assert.ok(revokedResolution.diagnostics.some((entry) => entry.code === "PROVIDER_COMMIT_REVOKED"));
}

// ── 15) Project helper: disabled-only provider blocks (no vacuous pass) + selectors ──
{
  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stderr}\n${result.stdout}`);
    return result.stdout.trim();
  }
  function write(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  // A provider Manifest that declares `selectors` so profile facts gate selection.
  function selectorManifest(): string {
    return `schema: aidlc.provider/v1.1
provider_id: framework.selector-fixture
name: Selector Fixture Provider
version: 0.1.0
kind: validation
capabilities:
  - framework.selector.validation
selectors:
  languages: [typescript]
  profiles: [strict]
entrypoint:
  path: bin/validate.js
  args: [--request]
ruleset:
  id: selector-baseline
  version: 0.1.0
  catalog: rules/catalog.json
artifacts:
  lock: provider.lock
  sbom: sbom.spdx.json
policies:
  network: none
  writes: []
`;
  }

  function buildFixture(root: string, manifest: string, providerId: string): string {
    const source = join(root, "provider-source");
    const remote = join(root, "provider-remote.git");
    const providerRoot = join(source, "providers", "fixture");
    mkdirSync(source, { recursive: true });
    git(source, "init", "-b", "main");
    git(source, "config", "user.email", "fixture@example.test");
    git(source, "config", "user.name", "Selector Fixture");
    write(join(providerRoot, "provider.yaml"), manifest);
    write(join(providerRoot, "rules", "catalog.json"), JSON.stringify({ rules: [{ id: "selector.rule", title: "Fixture", severity: "error", appliesTo: ["source"] }] }, null, 2) + "\n");
    write(join(providerRoot, "provider.lock"), JSON.stringify({ lockfileVersion: 1, packages: {} }) + "\n");
    write(join(providerRoot, "sbom.spdx.json"), JSON.stringify({ spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT", name: "fixture", documentNamespace: `https://example.test/sbom/${providerId}/0.1.0` }) + "\n");
    write(join(providerRoot, "bin", "validate.js"), "#!/usr/bin/env node\n");
    git(source, "add", ".");
    git(source, "commit", "-m", "fixture v1");
    mkdirSync(remote, { recursive: true });
    git(remote, "init", "--bare");
    git(source, "remote", "add", "origin", remote);
    git(source, "push", "-u", "origin", "main");
    return pathToFileURL(remote).href;
  }

  const root = mkdtempSync(join(tmpdir(), "aidlc-resolver-selectors-"));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  try {
    const sourceUrl = buildFixture(root, selectorManifest(), "framework.selector-fixture");
    const project = join(root, "project");
    mkdirSync(join(project, ".aidlc"), { recursive: true });
    write(join(project, ".aidlc", "provider-git-policy.json"), JSON.stringify({ version: 1, allow_file_fixtures: true }) + "\n");

    const { addProjectProvider, getProjectProviderStatus, setProjectProviderEnabled } = await import("../core/tools/aidlc-provider-cli.js");
    addProjectProvider(project, {
      source: sourceUrl,
      ref: "main",
      subdir: "providers/fixture",
      instance: "selector-fixture",
      id: "framework.selector-fixture",
      allowFile: true,
    });

    const scope: ProviderScope = { module_id: "mod-a", stage: "code-generation" };

    // ── item 2: Manifest selectors gate selection via profile facts. ──
    // Matching profile (language typescript + profiles contains strict) ⇒ selected.
    write(join(project, PROVIDER_PROFILE_REGISTRY_PATH), JSON.stringify({
      version: 1,
      active: "web",
      profiles: { web: { facts: { language: "typescript", profiles: ["strict", "fast"] } } },
    }) + "\n", "utf8");
    const matched = resolveProjectProviderPlan(project, { scope, source_revision: SOURCE_REVISION, policy: defaultResolutionPolicy() });
    assert.equal(matched.resolution.resolvable, true, "matching selector facts should resolve: " + JSON.stringify(matched.resolution.diagnostics));
    const selNode = matched.plan.nodes.find((node) => node.capability_id === "framework.selector.validation")!;
    assert.equal(selNode.state, "selected");
    assert.equal(selNode.selector_result, "true");

    // profiles[] missing the required value ⇒ selector false ⇒ not_selected ⇒ unsatisfied.
    write(join(project, PROVIDER_PROFILE_REGISTRY_PATH), JSON.stringify({
      version: 1,
      active: "web",
      profiles: { web: { facts: { language: "typescript", profiles: ["lax"] } } },
    }) + "\n", "utf8");
    const wrongProfile = resolveProjectProviderPlan(project, { scope, source_revision: SOURCE_REVISION, policy: defaultResolutionPolicy() });
    assert.equal(wrongProfile.resolution.resolvable, false, "a mismatched profiles[] fact must not resolve");

    // Required profile matches, but language facts are absent ⇒ unknown and fail closed.
    write(join(project, PROVIDER_PROFILE_REGISTRY_PATH), JSON.stringify({
      version: 1,
      active: "web",
      profiles: { web: { facts: { profiles: ["strict"] } } },
    }) + "\n", "utf8");
    const unknownProfile = resolveProjectProviderPlan(project, { scope, source_revision: SOURCE_REVISION, policy: defaultResolutionPolicy() });
    assert.equal(unknownProfile.resolution.resolvable, false, "an absent language fact is unknown and fails closed");
    const unkNode = unknownProfile.plan.nodes.find((node) => node.capability_id === "framework.selector.validation")!;
    assert.equal(unkNode.selector_result, "unknown");
    assert.ok(unknownProfile.resolution.diagnostics.some((entry) => entry.code === "PROVIDER_SELECTOR_UNKNOWN"));

    // ── item 1: the ONLY provider disabled leaves resolution instead of blocking it. ──
    // Restore a matching profile so selection is not the thing under test here.
    write(join(project, PROVIDER_PROFILE_REGISTRY_PATH), JSON.stringify({
      version: 1,
      active: "web",
      profiles: { web: { facts: { language: "typescript", profiles: ["strict"] } } },
    }) + "\n", "utf8");
    setProjectProviderEnabled(project, "selector-fixture", false);
    // A disabled instance does not participate: its binding leaves the default expression.
    const candidatesAfterDisable = await import("../core/tools/aidlc-provider-resolver.js").then((mod) => mod.readProjectProviderCandidates(project, scope));
    assert.deepEqual(deriveScopeCapabilities(candidatesAfterDisable, scope), [], "a disabled provider's bound capability must not be derived");
    const disabled = resolveProjectProviderPlan(project, { scope, source_revision: SOURCE_REVISION, policy: defaultResolutionPolicy() });
    assert.equal(disabled.resolution.resolvable, true, "a disabled sole provider must not block the plan");
    assert.equal(disabled.plan.nodes.find((node) => node.capability_id === "framework.selector.validation"), undefined, "a disabled provider's capability produces no node");
    assert.ok(disabled.provider_context.diagnostics.every((entry) => entry.code !== "PROVIDER_CAPABILITY_MISSING"), "no PROVIDER_CAPABILITY_MISSING diagnostic for a disabled instance");
    // provider status still lists the disabled instance's bound capabilities.
    const disabledStatus = getProjectProviderStatus(project, "selector-fixture");
    assert.equal(disabledStatus.enabled, false);
    assert.deepEqual(disabledStatus.disabled_bound_capabilities, ["framework.selector.validation"]);
    setProjectProviderEnabled(project, "selector-fixture", true);
    const reenabled = resolveProjectProviderPlan(project, { scope, source_revision: SOURCE_REVISION, policy: defaultResolutionPolicy() });
    assert.equal(reenabled.resolution.resolvable, true, "re-enable restores resolution");
    assert.equal(reenabled.plan.nodes.find((node) => node.capability_id === "framework.selector.validation")?.state, "selected", "re-enabled provider is selected again");

    console.log("Provider Resolver selectors + disable-semantics tests passed");
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("Provider Resolver core tests passed");
