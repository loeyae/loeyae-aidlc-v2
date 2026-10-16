/**
 * MARS-152 — Provider Resolver core.
 *
 * This module is the deterministic, side-effect-light core that turns a project's
 * locked Provider instances, an Effective Profile and a CapabilityExpression into a
 * frozen, digest-stable {@link ProviderPlanV1_1}. It is the Core-owned resolution
 * layer that sits between project configuration (owned by aidlc-project-provider.ts)
 * and the Controlled Runner. It never fetches from a remote, never executes Provider
 * code, and never widens the Core/Provider authority boundary frozen in
 * aidlc-provider-types.ts.
 *
 * The module is intentionally split into pure APIs (profile composition, selector
 * evaluation, binding matching, plan resolution over explicit candidate instances)
 * and a thin project-level helper that reads only the project lock + verified cache
 * (readProjectProviders + verifyLockedProviderCache) and never refreshes the remote.
 *
 * Fail-closed is the rule, not the exception: a required capability that is missing,
 * unknown (selector could not be decided), in conflict (duplicate satisfying
 * candidate), cyclic, or incompatible produces a plan whose relevant nodes are
 * `blocked`/`unknown` and whose top-level resolvability is false. Callers that need a
 * hard stop use {@link assertPlanResolvable}, which throws a diagnosed
 * {@link ProviderResolutionError}.
 *
 * ── Profile registry file: `.aidlc/provider-profile.json` ──────────────────────────
 * The project-level helper reads a single Core-owned profile registry at
 * `<project>/.aidlc/provider-profile.json`. Its documented shape is:
 *
 *   {
 *     "version": 1,
 *     "active": "<profile_id>",                 // optional; defaults to "default"
 *     "profiles": {
 *       "<profile_id>": {
 *         "extends": ["<parent_profile_id>", ...],   // optional lineage, resolved in order
 *         "facts": { ... JSON object ... },          // optional; defaults to {}
 *         "risk": {                                   // optional; defaults to development/non-protected
 *           "level": "development" | "standard" | "protected",
 *           "protected_gate": boolean
 *         }
 *       }
 *     }
 *   }
 *
 * When the file is absent, a `default` profile with no facts and development risk is
 * synthesized so resolution is always well-defined. When the file exists it is
 * validated strictly (unknown fields rejected, cycles in `extends` rejected). The
 * `active` profile (or `default`) is composed through its `extends` lineage into an
 * {@link EffectiveProviderProfileV1_1} by {@link composeEffectiveProfile}.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  PROVIDER_FALLBACK_POLICY_V1,
  PROVIDER_PROTOCOL_VERSION,
  PROVIDER_SCHEMA,
  RESTRICTED_RUNNER_PROFILE,
  type CapabilityExpression,
  type EffectiveProviderProfileV1_1,
  type JsonObject,
  type JsonValue,
  type ProfileSelector,
  type ProjectProviderIntent,
  type ProjectProviderLockEntry,
  type ProviderCapabilityDeclaration,
  type ProviderDiagnostic,
  type ProviderDiagnosticCode,
  type ProviderManifestV1_1,
  type ProviderPlanNode,
  type ProviderPlanV1_1,
  type ProviderScope,
  type ProviderSourceRevision,
  type SelectorResult,
  type Sha256Digest,
} from "./aidlc-provider-types.js";
import {
  PROJECT_PROVIDERS_LOCK_PATH,
  canonicalProviderJson,
  projectProviderConfigDigest,
  readProjectProviders,
  sha256ProviderDigest,
  type ProjectProviderState,
} from "./aidlc-project-provider.js";
import { verifyLockedProviderCache, type ProviderRepositoryManifestV1_1 } from "./aidlc-provider-git.js";
import { readModuleFacts, matchKnowledgeRequirements } from "./aidlc-module-facts.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PROFILE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PLAN_ID = /^plan-[0-9a-f]{32}$/;

export const PROVIDER_PROFILE_REGISTRY_PATH = ".aidlc/provider-profile.json";
export const PROVIDER_PLANS_PATH = ".aidlc/provider-plans";
export const DEFAULT_PROFILE_ID = "default";

/** Risk level ordering used for the conservative (maximum) merge over a lineage. */
const RISK_ORDER = { development: 0, standard: 1, protected: 2 } as const;
export type ProfileRiskLevel = keyof typeof RISK_ORDER;

/**
 * Resolution-phase policy an owning conductor supplies to the resolver. The Core and
 * stage switches here are AND-ed with the Manifest's own fallback declaration before
 * any fallback edge is admitted (PROVIDER_FALLBACK_POLICY_V1 / PCORE-009).
 */
export interface ProviderResolutionPolicy {
  readonly policy_id: string;
  /** Core-level master switch for fallback admission. */
  readonly core_allows_fallback: boolean;
  /** Stages (or "*") in which fallback is permitted by stage policy. */
  readonly fallback_allowed_stages: readonly string[];
  /** Whether this resolution targets a protected gate (requires verified trust). */
  readonly protected_gate: boolean;
}

/**
 * Optional protocol compatibility range for a candidate. The resolver treats a
 * candidate as compatible when its range admits {@link PROVIDER_PROTOCOL_VERSION}; a
 * candidate that declares a range excluding the active protocol major/minor is
 * explicitly incompatible and blocks with PROVIDER_SCHEMA_INCOMPATIBLE. A candidate
 * that omits the range is assumed compatible (the project helper only ever produces
 * candidates from a validated aidlc.provider/v1.1 Manifest, which is compatible by
 * construction).
 */
export interface ProviderProtocolCompatibility {
  /** Inclusive lower bound, e.g. "1.1". */
  readonly minimum: string;
  /** Exclusive upper bound, e.g. "2.0". */
  readonly maximum_exclusive: string;
}

/**
 * One explicit candidate Provider instance handed to the pure resolver. The project
 * helper derives these from the lock + config + verified cache; a unit test may build
 * them as plain objects. `capabilities` is the Manifest capability metadata used for
 * selector evaluation, risk, stage eligibility and fallback groups.
 *
 * A candidate may be disabled (its `intent.enabled` is false) or carry a Manifest that
 * fails to declare a bound capability — both are still surfaced as candidates so the
 * resolver can emit a blocked node bound to the real project instance instead of
 * silently dropping the binding and passing vacuously.
 */
export interface ProviderCandidateInstance {
  readonly intent: ProjectProviderIntent;
  readonly lock: ProjectProviderLockEntry;
  readonly capabilities: readonly ProviderCapabilityDeclaration[];
  /** Optional declared protocol compatibility; omitted ⇒ assumed compatible. */
  readonly protocol?: ProviderProtocolCompatibility;
  /**
   * An explicit, pre-computed incompatibility reason for this candidate (schema,
   * manifest, lock or revocation). When set the candidate can never match: every node
   * it would contribute is blocked with the carried diagnostic code. The project helper
   * sets this for a revoked trust status, a lock/intent instance/id/config mismatch, or
   * an unsupported Manifest schema; a unit test may set it directly.
   */
  readonly incompatibility?: {
    readonly code: Extract<ProviderDiagnosticCode, "PROVIDER_SCHEMA_INCOMPATIBLE" | "PROVIDER_MANIFEST_INVALID" | "PROVIDER_LOCK_MISMATCH" | "PROVIDER_COMMIT_REVOKED" | "PROVIDER_SOURCE_UNAVAILABLE">;
    readonly message: string;
  };
}

export interface ResolveProviderPlanInput {
  readonly candidates: readonly ProviderCandidateInstance[];
  readonly scope: ProviderScope;
  readonly profile: EffectiveProviderProfileV1_1;
  readonly capability_expression: CapabilityExpression;
  readonly policy: ProviderResolutionPolicy;
  readonly source_revision: ProviderSourceRevision;
  /**
   * The project lock digest the plan binds. The project helper passes the real
   * providers.lock.yaml lock_digest so a frozen plan interoperates with the existing
   * artifact-currency machinery; the pure path omits it and a deterministic aggregate
   * over the candidate locks is derived instead.
   */
  readonly project_lock_digest?: Sha256Digest;
  /**
   * Optional human approval reference. A plan that requires approval (protected
   * profile/gate/capability, or an admitted fallback chain) is `pending` without a ref
   * and `approved` with one; a plan that requires no approval is `not_required`. The
   * ref participates in the plan digest so tampering with it invalidates the plan.
   */
  readonly approval_ref?: string;
}

/** The resolver result: the frozen plan plus the derived resolvability verdict. */
export interface ProviderPlanResolution {
  readonly plan: ProviderPlanV1_1;
  /** True only when the capability expression is satisfied by selected nodes with no blocking/unknown diagnostics. */
  readonly resolvable: boolean;
  /** Aggregated, de-duplicated resolution-phase diagnostics (plan-level + node-level). */
  readonly diagnostics: readonly ProviderDiagnostic[];
}

export type ProviderResolutionDiagnosticCode = Extract<
  ProviderDiagnosticCode,
  | "PROVIDER_CAPABILITY_MISSING"
  | "PROVIDER_SELECTOR_UNKNOWN"
  | "PROVIDER_DEPENDENCY_CYCLE"
  | "PROVIDER_PLAN_CONFLICT"
  | "PROVIDER_PLAN_STALE"
  | "PROVIDER_COMMIT_UNTRUSTED"
  | "PROVIDER_COMMIT_REVOKED"
  | "PROVIDER_SOURCE_UNAVAILABLE"
  | "PROVIDER_FALLBACK_NOT_ALLOWED"
  | "PROVIDER_SCHEMA_INCOMPATIBLE"
  | "PROVIDER_MANIFEST_INVALID"
  | "PROVIDER_LOCK_MISMATCH"
  | "PROVIDER_CONFIG_INVALID"
>;

export class ProviderResolutionError extends Error {
  readonly diagnostic: ProviderResolutionDiagnosticCode;
  readonly diagnostics: readonly ProviderDiagnostic[];

  constructor(diagnostic: ProviderResolutionDiagnosticCode, message: string, diagnostics: readonly ProviderDiagnostic[] = []) {
    super(`${diagnostic}: ${message}`);
    this.name = "ProviderResolutionError";
    this.diagnostic = diagnostic;
    this.diagnostics = diagnostics.length > 0 ? diagnostics : [{ code: diagnostic, message }];
  }
}

function fail(diagnostic: ProviderResolutionDiagnosticCode, message: string): never {
  throw new ProviderResolutionError(diagnostic, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ───────────────────────────────────────────────────────────────────────────────────
// 1) Effective Profile definition, inheritance and conservative composition.
// ───────────────────────────────────────────────────────────────────────────────────

/** A profile definition before composition: a stable id, optional lineage, facts and risk. */
export interface ProviderProfileDefinition {
  readonly profile_id: string;
  readonly extends: readonly string[];
  readonly facts: JsonObject;
  readonly risk: { readonly level: ProfileRiskLevel; readonly protected_gate: boolean };
}

/** Normalize a loose profile definition into a validated {@link ProviderProfileDefinition}. */
export function defineProviderProfile(input: {
  readonly profile_id: string;
  readonly extends?: readonly string[];
  readonly facts?: JsonObject;
  readonly risk?: { readonly level?: ProfileRiskLevel; readonly protected_gate?: boolean };
}): ProviderProfileDefinition {
  if (!PROFILE_ID.test(input.profile_id)) fail("PROVIDER_CONFIG_INVALID", `profile_id ${JSON.stringify(input.profile_id)} is not a valid identifier`);
  const parents = input.extends ?? [];
  for (const parent of parents) {
    if (!PROFILE_ID.test(parent)) fail("PROVIDER_CONFIG_INVALID", `profile ${input.profile_id} extends invalid parent ${JSON.stringify(parent)}`);
    if (parent === input.profile_id) fail("PROVIDER_CONFIG_INVALID", `profile ${input.profile_id} cannot extend itself`);
  }
  if (new Set(parents).size !== parents.length) fail("PROVIDER_CONFIG_INVALID", `profile ${input.profile_id} has duplicate parents`);
  const level = input.risk?.level ?? "development";
  if (!(level in RISK_ORDER)) fail("PROVIDER_CONFIG_INVALID", `profile ${input.profile_id} has invalid risk level ${level}`);
  return {
    profile_id: input.profile_id,
    extends: [...parents],
    facts: normalizeFacts(input.facts ?? {}, `profile ${input.profile_id} facts`),
    risk: { level, protected_gate: input.risk?.protected_gate === true },
  };
}

/** The synthesized default profile: no facts, development risk, no protected gate. */
export function defaultProviderProfile(): ProviderProfileDefinition {
  return defineProviderProfile({ profile_id: DEFAULT_PROFILE_ID });
}

function normalizeFacts(value: unknown, field: string): JsonObject {
  const visit = (candidate: unknown, path: string): JsonValue => {
    if (candidate === null || typeof candidate === "boolean" || typeof candidate === "string") return candidate;
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) fail("PROVIDER_CONFIG_INVALID", `${path} contains a non-finite number`);
      return Object.is(candidate, -0) ? 0 : candidate;
    }
    if (Array.isArray(candidate)) return candidate.map((entry, index) => visit(entry, `${path}[${index}]`));
    if (isRecord(candidate)) {
      const result: Record<string, JsonValue> = {};
      for (const key of Object.keys(candidate)) {
        if (!key || /[\u0000-\u001f\u007f]/.test(key)) fail("PROVIDER_CONFIG_INVALID", `${path} contains an invalid key`);
        result[key] = visit(candidate[key], `${path}.${key}`);
      }
      return result as JsonObject;
    }
    fail("PROVIDER_CONFIG_INVALID", `${path} must contain only JSON values`);
  };
  if (!isRecord(value)) fail("PROVIDER_CONFIG_INVALID", `${field} must be an object`);
  return visit(value, field) as JsonObject;
}

/**
 * Deep-merge two fact objects. Nested objects merge recursively; a non-object override
 * (scalar, null, array) replaces the base entirely. Arrays are replaced, never
 * concatenated, so merges stay deterministic and idempotent.
 */
export function deepMergeFacts(base: JsonObject, override: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(base)) result[key] = base[key];
  for (const key of Object.keys(override)) {
    const incoming = override[key];
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(incoming)) result[key] = deepMergeFacts(existing, incoming);
    else result[key] = incoming;
  }
  return result as JsonObject;
}

/** Conservative (maximum) risk-level merge across a lineage. */
function mergeRiskLevel(left: ProfileRiskLevel, right: ProfileRiskLevel): ProfileRiskLevel {
  return RISK_ORDER[left] >= RISK_ORDER[right] ? left : right;
}

/**
 * Compose a lineage into an {@link EffectiveProviderProfileV1_1}. Parents are applied
 * left-to-right (earliest parent is the weakest base); `child` is applied last and
 * wins on fact conflicts. Risk is conservative: the level is the maximum over the
 * whole lineage and `protected_gate` is true if any member sets it. The lineage,
 * facts_digest and profile_digest are deterministic for a given ordered lineage.
 */
export function composeEffectiveProfile(parents: readonly ProviderProfileDefinition[], child: ProviderProfileDefinition): EffectiveProviderProfileV1_1 {
  const lineageDefs = [...parents, child];
  const seen = new Set<string>();
  for (const def of lineageDefs) {
    if (seen.has(def.profile_id)) fail("PROVIDER_CONFIG_INVALID", `profile lineage repeats ${def.profile_id}`);
    seen.add(def.profile_id);
  }
  let facts: JsonObject = {};
  let level: ProfileRiskLevel = "development";
  let protectedGate = false;
  for (const def of lineageDefs) {
    facts = deepMergeFacts(facts, def.facts);
    level = mergeRiskLevel(level, def.risk.level);
    protectedGate = protectedGate || def.risk.protected_gate;
  }
  const lineage = lineageDefs.map((def) => ({ profile_id: def.profile_id, digest: profileDefinitionDigest(def) }));
  const factsDigest = sha256ProviderDigest(facts);
  const risk: EffectiveProviderProfileV1_1["risk"] = { level, protected_gate: protectedGate, facts_digest: factsDigest };
  const profileCore = { profile_id: child.profile_id, lineage, facts, risk };
  return {
    schema: PROVIDER_SCHEMA.profile,
    profile_id: child.profile_id,
    profile_digest: sha256ProviderDigest(profileCore),
    lineage,
    facts,
    risk,
  };
}

/** Deterministic digest of a single profile definition (lineage link identity). */
export function profileDefinitionDigest(def: ProviderProfileDefinition): Sha256Digest {
  return sha256ProviderDigest({ profile_id: def.profile_id, extends: def.extends, facts: def.facts, risk: def.risk });
}

// ───────────────────────────────────────────────────────────────────────────────────
// 2) ProfileSelector three-valued (Kleene) evaluation. Missing fact ⇒ unknown.
// ───────────────────────────────────────────────────────────────────────────────────

function lookupFact(facts: JsonObject, path: string): { readonly present: boolean; readonly value: JsonValue } {
  // A dotted path walks nested objects; a missing segment is reported as absent.
  const segments = path.split(".");
  let cursor: JsonValue = facts;
  for (const segment of segments) {
    if (!isPlainObject(cursor) || !(segment in cursor)) return { present: false, value: null };
    cursor = cursor[segment];
  }
  return { present: true, value: cursor };
}

function kleeneNot(value: SelectorResult): SelectorResult {
  if (value === "unknown") return "unknown";
  return value === "true" ? "false" : "true";
}

function kleeneAll(results: readonly SelectorResult[]): SelectorResult {
  // Kleene conjunction: false dominates, else unknown if any unknown, else true.
  if (results.includes("false")) return "false";
  if (results.includes("unknown")) return "unknown";
  return "true";
}

function kleeneAny(results: readonly SelectorResult[]): SelectorResult {
  // Kleene disjunction: true dominates, else unknown if any unknown, else false.
  if (results.includes("true")) return "true";
  if (results.includes("unknown")) return "unknown";
  return "false";
}

function compareLeaf(operator: "equals" | "not_equals" | "contains", factValue: JsonValue, operand: JsonValue): SelectorResult {
  if (operator === "equals") return factValue === operand ? "true" : "false";
  if (operator === "not_equals") return factValue !== operand ? "true" : "false";
  // contains: array membership, or substring for strings.
  if (Array.isArray(factValue)) return factValue.includes(operand) ? "true" : "false";
  if (typeof factValue === "string" && typeof operand === "string") return factValue.includes(operand) ? "true" : "false";
  return "false";
}

/**
 * Evaluate a {@link ProfileSelector} against an Effective Profile's facts with Kleene
 * three-valued logic. A leaf whose fact is absent evaluates to `unknown` (never
 * silently false), so a missing fact propagates conservatively up through all_of /
 * any_of / not and ultimately forces a required capability to fail closed.
 */
export function evaluateProfileSelector(selector: ProfileSelector, facts: JsonObject): SelectorResult {
  if ("all_of" in selector) return kleeneAll(selector.all_of.map((entry) => evaluateProfileSelector(entry, facts)));
  if ("any_of" in selector) return kleeneAny(selector.any_of.map((entry) => evaluateProfileSelector(entry, facts)));
  if ("not" in selector) return kleeneNot(evaluateProfileSelector(selector.not, facts));

  const lookup = lookupFact(facts, selector.fact);
  if (selector.operator === "exists") return lookup.present ? "true" : "false";
  if (!lookup.present) return "unknown";
  if (selector.operator === "in") return selector.values.includes(lookup.value as never) ? "true" : "false";
  return compareLeaf(selector.operator, lookup.value, selector.value);
}

// ───────────────────────────────────────────────────────────────────────────────────
// 3) module / unit / stage / capability binding matching.
// ───────────────────────────────────────────────────────────────────────────────────

/**
 * Whether a single binding block covers a scope. `*` is a wildcard in modules, units
 * and stages. An omitted `units` list means "any unit". A scope with no module_id/
 * unit_id matches a binding only through its wildcard, never through a concrete id.
 */
export function bindingBlockMatchesScope(binding: ProjectProviderIntent["bindings"][number], scope: ProviderScope): boolean {
  const moduleMatches = binding.modules.includes("*") || (!!scope.module_id && binding.modules.includes(scope.module_id));
  const unitMatches = binding.units === undefined || binding.units.includes("*") || (!!scope.unit_id && binding.units.includes(scope.unit_id));
  const stageMatches = binding.stages.includes("*") || binding.stages.includes(scope.stage);
  return moduleMatches && unitMatches && stageMatches;
}

/** Whether an intent binds `capability` within `scope` (module/unit/stage all matched). */
export function intentBindsCapability(intent: ProjectProviderIntent, capability: string, scope: ProviderScope): boolean {
  return intent.bindings.some((binding) => bindingBlockMatchesScope(binding, scope) && binding.capabilities.includes(capability));
}

/** The set of capabilities an intent binds within a given scope, sorted and de-duplicated. */
export function scopeBoundCapabilities(intent: ProjectProviderIntent, scope: ProviderScope): string[] {
  const result = new Set<string>();
  for (const binding of intent.bindings) {
    if (!bindingBlockMatchesScope(binding, scope)) continue;
    for (const capability of binding.capabilities) result.add(capability);
  }
  return [...result].sort();
}

/**
 * Match a candidate instance against a capability within a scope. A match requires:
 * the intent to be enabled, to bind the capability in this scope, and the Manifest to
 * declare a capability with that id whose stages include this scope's stage (or "*").
 * Returns the matched declaration or a reason the candidate did not match.
 */
export function matchProviderCapability(
  candidate: ProviderCandidateInstance,
  capability: string,
  scope: ProviderScope,
): { readonly matched: true; readonly declaration: ProviderCapabilityDeclaration } | { readonly matched: false; readonly reason: string } {
  if (!candidate.intent.enabled) return { matched: false, reason: "instance is disabled" };
  if (!intentBindsCapability(candidate.intent, capability, scope)) return { matched: false, reason: "no binding covers this capability and scope" };
  const declaration = candidate.capabilities.find((entry) => entry.id === capability);
  if (!declaration) return { matched: false, reason: `manifest declares no capability ${capability}` };
  const stageEligible = declaration.stages.includes("*") || declaration.stages.includes(scope.stage);
  if (!stageEligible) return { matched: false, reason: `capability ${capability} is not declared for stage ${scope.stage}` };
  return { matched: true, declaration };
}

// ───────────────────────────────────────────────────────────────────────────────────
// 4) resolveProviderPlan — the pure resolver.
// ───────────────────────────────────────────────────────────────────────────────────

interface InternalNode {
  node_id: string;
  provider_instance_id: string;
  capability_id: string;
  state: ProviderPlanNode["state"];
  required: boolean;
  selector_result: SelectorResult;
  dependencies: string[];
  fallback_node_ids: string[];
  entrypoint_id?: string;
  diagnostics: ProviderDiagnostic[];
}

/** The synthetic instance id used for a capability with no real candidate. */
const UNRESOLVED_INSTANCE = "unresolved";

/** Deterministic node id derived from the binding tuple so plans are reproducible. */
function nodeId(scope: ProviderScope, capability: string, instanceId: string): string {
  const digest = sha256ProviderDigest({ scope, capability, instance_id: instanceId });
  return `node-${digest.slice("sha256:".length, "sha256:".length + 24)}`;
}

/** Collect every distinct capability referenced by an expression. */
export function capabilityExpressionLeaves(expression: CapabilityExpression): string[] {
  const result = new Set<string>();
  const visit = (node: CapabilityExpression): void => {
    if ("capability" in node) result.add(node.capability);
    else if ("all_of" in node) node.all_of.forEach(visit);
    else if ("any_of" in node) node.any_of.forEach(visit);
    else if ("at_least" in node) node.at_least.of.forEach(visit);
    else node.exactly_one.forEach(visit);
  };
  visit(expression);
  return [...result].sort();
}

/**
 * Evaluate a {@link CapabilityExpression} given the per-capability satisfaction map.
 * A capability is satisfied only when at least one node for it is `selected`. The map
 * is three-valued because a capability may be unresolved (`unknown`) when its selector
 * could not be decided; unknown propagates with Kleene semantics so a required
 * expression never silently passes on an undecided input.
 */
export function evaluateCapabilityExpression(expression: CapabilityExpression, satisfaction: ReadonlyMap<string, SelectorResult>): SelectorResult {
  const visit = (node: CapabilityExpression): SelectorResult => {
    if ("capability" in node) return satisfaction.get(node.capability) ?? "false";
    if ("all_of" in node) return kleeneAll(node.all_of.map(visit));
    if ("any_of" in node) return kleeneAny(node.any_of.map(visit));
    if ("at_least" in node) {
      const results = node.at_least.of.map(visit);
      const trueCount = results.filter((entry) => entry === "true").length;
      const unknownCount = results.filter((entry) => entry === "unknown").length;
      if (trueCount >= node.at_least.count) return "true";
      if (trueCount + unknownCount >= node.at_least.count) return "unknown";
      return "false";
    }
    // exactly_one: exactly one true, the rest false; unknown anywhere that could flip
    // the count yields unknown.
    const results = node.exactly_one.map(visit);
    const trueCount = results.filter((entry) => entry === "true").length;
    const unknownCount = results.filter((entry) => entry === "unknown").length;
    if (trueCount > 1) return "false";
    if (trueCount === 1) return unknownCount > 0 ? "unknown" : "true";
    if (unknownCount > 0) return "unknown";
    return "false";
  };
  return visit(expression);
}

/**
 * Select which capability leaves are REQUIRED by actually walking the expression and
 * choosing satisfying branches, rather than treating every leaf as mandatory.
 *
 * - all_of: every operand is required.
 * - any_of: deterministically pick ONE satisfying branch (first `true` in operand
 *   order; if none is true, pick the first `unknown`; else the first operand so the
 *   failure is attributed). Only the chosen branch's leaves are required.
 * - at_least{count}: pick enough satisfying branches to reach count (true first, then
 *   unknown, then remaining in order). Only the chosen branches are required.
 * - exactly_one: require the unique satisfying branch; if the count is ambiguous
 *   (more than one true, or any undecidedness that could change the count) require all
 *   so the conflict/unknown blocks.
 *
 * Returns the set of capability ids that are required for the expression to resolve.
 * Leaves NOT in this set are optional: their unknown/blocked state must not fail the
 * whole plan.
 */
function selectRequiredCapabilities(expression: CapabilityExpression, satisfaction: ReadonlyMap<string, SelectorResult>): Set<string> {
  const required = new Set<string>();
  const evalNode = (node: CapabilityExpression): SelectorResult => evaluateCapabilityExpression(node, satisfaction);
  const markAll = (node: CapabilityExpression): void => {
    for (const leaf of capabilityExpressionLeaves(node)) required.add(leaf);
  };
  const visit = (node: CapabilityExpression): void => {
    if ("capability" in node) {
      required.add(node.capability);
      return;
    }
    if ("all_of" in node) {
      node.all_of.forEach(visit);
      return;
    }
    if ("any_of" in node) {
      const operands = node.any_of;
      const chosen = operands.find((entry) => evalNode(entry) === "true")
        ?? operands.find((entry) => evalNode(entry) === "unknown")
        ?? operands[0];
      if (chosen) visit(chosen);
      return;
    }
    if ("at_least" in node) {
      const { count, of } = node.at_least;
      const ranked = [...of]
        .map((entry, index) => ({ entry, index, result: evalNode(entry) }))
        .sort((left, right) => rankSelection(left.result) - rankSelection(right.result) || left.index - right.index);
      for (const picked of ranked.slice(0, count)) visit(picked.entry);
      return;
    }
    // exactly_one
    const operands = node.exactly_one;
    const trues = operands.filter((entry) => evalNode(entry) === "true");
    const unknowns = operands.filter((entry) => evalNode(entry) === "unknown");
    if (trues.length === 1 && unknowns.length === 0) {
      visit(trues[0]);
      return;
    }
    // Ambiguous (conflict or undecided): mark every operand required so the
    // PROVIDER_PLAN_CONFLICT / PROVIDER_SELECTOR_UNKNOWN blocks the plan.
    markAll(node);
  };
  visit(expression);
  return required;
}

function rankSelection(result: SelectorResult): number {
  return result === "true" ? 0 : result === "unknown" ? 1 : 2;
}

function validateCapabilityExpression(expression: CapabilityExpression, path = "capability_expression"): void {
  if ("capability" in expression) {
    if (typeof expression.capability !== "string" || expression.capability.length === 0) fail("PROVIDER_CONFIG_INVALID", `${path}.capability must be a non-empty string`);
    return;
  }
  if ("all_of" in expression) {
    // An empty all_of is a vacuous (trivially true) conjunction — used when a scope
    // binds no capabilities, so a directive with no Provider actions still resolves.
    expression.all_of.forEach((entry, index) => validateCapabilityExpression(entry, `${path}.all_of[${index}]`));
    return;
  }
  if ("any_of" in expression) {
    if (expression.any_of.length === 0) fail("PROVIDER_CONFIG_INVALID", `${path}.any_of must not be empty`);
    expression.any_of.forEach((entry, index) => validateCapabilityExpression(entry, `${path}.any_of[${index}]`));
    return;
  }
  if ("at_least" in expression) {
    const { count, of } = expression.at_least;
    if (!Number.isInteger(count) || count < 1) fail("PROVIDER_CONFIG_INVALID", `${path}.at_least.count must be a positive integer`);
    if (of.length === 0) fail("PROVIDER_CONFIG_INVALID", `${path}.at_least.of must not be empty`);
    if (count > of.length) fail("PROVIDER_CONFIG_INVALID", `${path}.at_least.count ${count} exceeds the ${of.length} available operands`);
    of.forEach((entry, index) => validateCapabilityExpression(entry, `${path}.at_least.of[${index}]`));
    return;
  }
  if ("exactly_one" in expression) {
    if (expression.exactly_one.length === 0) fail("PROVIDER_CONFIG_INVALID", `${path}.exactly_one must not be empty`);
    expression.exactly_one.forEach((entry, index) => validateCapabilityExpression(entry, `${path}.exactly_one[${index}]`));
    return;
  }
  fail("PROVIDER_CONFIG_INVALID", `${path} is not a recognized capability expression`);
}

/** Deterministic policy digest over the resolution policy inputs. */
export function resolutionPolicyDigest(policy: ProviderResolutionPolicy): Sha256Digest {
  return sha256ProviderDigest({
    policy_id: policy.policy_id,
    core_allows_fallback: policy.core_allows_fallback,
    fallback_allowed_stages: [...policy.fallback_allowed_stages].sort(),
    protected_gate: policy.protected_gate,
    fallback_policy: PROVIDER_FALLBACK_POLICY_V1.id,
  });
}

function diagnostic(code: ProviderDiagnosticCode, message: string, details?: JsonObject): ProviderDiagnostic {
  return details ? { code, message, details } : { code, message };
}

/** Whether a candidate's declared protocol range admits the active protocol version. */
function protocolCompatible(candidate: ProviderCandidateInstance): boolean {
  if (!candidate.protocol) return true;
  const active = parseVersionTuple(PROVIDER_PROTOCOL_VERSION);
  const min = parseVersionTuple(candidate.protocol.minimum);
  const maxExclusive = parseVersionTuple(candidate.protocol.maximum_exclusive);
  if (!active || !min || !maxExclusive) return false;
  return compareVersionTuple(active, min) >= 0 && compareVersionTuple(active, maxExclusive) < 0;
}

function parseVersionTuple(value: string): readonly number[] | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length === 0 || parts.some((part) => !Number.isInteger(part) || part < 0)) return undefined;
  return parts;
}

function compareVersionTuple(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * The reason a candidate cannot match for a capability at all, if any. Combines the
 * carried `incompatibility` with the protocol compatibility check. Returns null when the
 * candidate is admissible (its per-capability matching still applies).
 */
function candidateHardBlock(candidate: ProviderCandidateInstance): { readonly code: ProviderDiagnosticCode; readonly message: string } | null {
  if (candidate.incompatibility) return candidate.incompatibility;
  const { intent, lock } = candidate;
  if (lock.instance_id !== intent.instance_id || lock.id !== intent.id) {
    return { code: "PROVIDER_LOCK_MISMATCH", message: `instance ${intent.instance_id} identity does not match its lock entry` };
  }
  if (lock.source.git !== intent.source.git || lock.source.requested_ref !== intent.source.ref || lock.source.subdir !== (intent.source.subdir ?? null)) {
    return { code: "PROVIDER_LOCK_MISMATCH", message: `instance ${intent.instance_id} source intent does not match its lock entry` };
  }
  if (lock.project_config_digest !== projectProviderConfigDigest(intent)) {
    return { code: "PROVIDER_LOCK_MISMATCH", message: `instance ${intent.instance_id} project config digest does not match its lock entry` };
  }
  if (lock.trust.status === "revoked") {
    return { code: "PROVIDER_COMMIT_REVOKED", message: `instance ${intent.instance_id} lock trust is revoked` };
  }
  if (!protocolCompatible(candidate)) {
    return {
      code: "PROVIDER_SCHEMA_INCOMPATIBLE",
      message: `instance ${intent.instance_id} declares protocol range [${candidate.protocol?.minimum}, ${candidate.protocol?.maximum_exclusive}) which excludes active protocol ${PROVIDER_PROTOCOL_VERSION}`,
    };
  }
  return null;
}

/**
 * Resolve an explicit set of candidate instances into a frozen Provider Plan.
 *
 * Behaviour (all deterministic; fail-closed):
 * - For every capability referenced by the expression, each candidate that matches the
 *   binding/scope/manifest contributes a node. Its selector is evaluated against the
 *   Effective Profile facts (Kleene): true ⇒ selectable, false ⇒ not_selected,
 *   unknown ⇒ node `unknown` with PROVIDER_SELECTOR_UNKNOWN.
 * - A candidate that is disabled, Manifest-incompatible, protocol-incompatible, lock-
 *   mismatched or revoked contributes a blocked node bound to the real instance id with
 *   the appropriate diagnostic — it never silently vanishes.
 * - A capability referenced by the expression (or pulled in as a dependency) with no
 *   candidate at all yields a synthetic blocked node carrying PROVIDER_CAPABILITY_MISSING.
 * - Dependencies are closed over: a dependency capability gets a node even when it is not
 *   in the top-level expression; cycles are detected; node.dependencies carry real node
 *   ids.
 * - `required` is computed by walking the expression and selecting satisfying branches,
 *   then transitively including the dependencies of required capabilities. A non-selected
 *   branch's unknown/blocked state does not fail the plan.
 * - Fallback edges are admitted only when EVERY competing selected candidate for a
 *   capability is in a single declared group AND core policy AND stage policy allow it.
 * - Protected-gate trust: a candidate whose lock trust is not `verified` under a
 *   protected policy blocks with PROVIDER_COMMIT_UNTRUSTED.
 *
 * The plan is digest-stable: nodes are sorted canonically. plan_id is derived from the
 * plan core WITHOUT its own id/digest/approval; the final plan_digest then includes the
 * plan_id and the approval so a tampered approval ref is detected as a currency mismatch.
 */
export function resolveProviderPlan(input: ResolveProviderPlanInput, options: { readonly dependencies?: ReadonlyMap<string, readonly string[]> } = {}): ProviderPlanResolution {
  validateCapabilityExpression(input.capability_expression);
  validateProviderScope(input.scope);
  if (input.approval_ref !== undefined && (input.approval_ref.trim() !== input.approval_ref || input.approval_ref.length === 0 || /[\u0000-\u001f\u007f]/.test(input.approval_ref))) {
    fail("PROVIDER_CONFIG_INVALID", "approval_ref must be a non-empty, trimmed string without control characters");
  }
  const projectLockDigest = requireLockDigest(input);
  const policyDigest = resolutionPolicyDigest(input.policy);
  const dependencies = options.dependencies ?? new Map<string, readonly string[]>();
  const planDiagnostics: ProviderDiagnostic[] = [];

  // The capability universe is the closure of the expression leaves under dependencies.
  const universe = closeCapabilityUniverse(capabilityExpressionLeaves(input.capability_expression), dependencies);

  // Build nodes per capability from matching candidates.
  const nodesByCapability = new Map<string, InternalNode[]>();
  for (const capability of universe) {
    nodesByCapability.set(capability, buildCapabilityNodes(input, capability, dependencies.get(capability) ?? []));
  }

  // Admit fallback edges between same-capability nodes under the AND-ed policy.
  applyFallbackEdges(input, nodesByCapability, planDiagnostics);

  // Detect dependency cycles across capabilities and block every participant.
  detectCapabilityCycles(dependencies, universe, nodesByCapability, planDiagnostics);

  // Resolve single-select conflicts and derive the per-capability satisfaction.
  const satisfaction = resolveSelectionAndSatisfaction(input, nodesByCapability);

  // An exactly_one branch satisfied by MORE than one operand is a plan conflict (not a
  // missing capability): detect it at the expression level and block the involved nodes.
  detectExactlyOneConflicts(input.capability_expression, satisfaction, nodesByCapability, planDiagnostics);
  // Re-derive satisfaction after any exactly_one conflict blocked nodes.
  const resolvedSatisfaction = resolveSelectionAndSatisfaction(input, nodesByCapability);

  // Decide which capabilities are REQUIRED by walking the expression's selected
  // branches, then transitively through required capabilities' dependencies.
  const requiredCapabilities = closeCapabilityUniverse([...selectRequiredCapabilities(input.capability_expression, resolvedSatisfaction)], dependencies);
  for (const [capability, nodes] of nodesByCapability) {
    for (const node of nodes) node.required = false;
    if (!requiredCapabilities.has(capability)) continue;
    const primary = nodes
      .filter((node) => node.state === "selected" && !isFallbackAlternateNode(node, nodes))
      .sort((left, right) => left.node_id.localeCompare(right.node_id))[0];
    if (primary) {
      primary.required = true;
      // A competing undecided/incompatible instance for the same required capability is
      // not silently ignored: that would turn an implicit provider switch into an
      // unapproved fallback. Explicitly disabled instances are the sole exception.
      for (const node of nodes) {
        const intentionallyDisabled = node.state === "blocked"
          && node.diagnostics.every((entry) => entry.code === "PROVIDER_CAPABILITY_MISSING" && / is disabled$/.test(entry.message));
        if (node.state === "unknown" || (node.state === "blocked" && !intentionallyDisabled)) node.required = true;
      }
    } else for (const node of nodes) node.required = true;
  }
  wireDependencyNodeIds(nodesByCapability, dependencies);

  const expressionResult = evaluateCapabilityExpression(input.capability_expression, resolvedSatisfaction);
  if (expressionResult === "unknown") {
    planDiagnostics.push(diagnostic("PROVIDER_SELECTOR_UNKNOWN", "capability expression could not be decided; one or more selectors are unknown"));
  } else if (expressionResult === "false") {
    planDiagnostics.push(diagnostic("PROVIDER_CAPABILITY_MISSING", "capability expression is not satisfied by the selected candidates"));
  }

  const allNodes: InternalNode[] = [];
  for (const nodes of nodesByCapability.values()) allNodes.push(...nodes);
  const planNodes = finalizeNodes(allNodes);

  // A plan is resolvable only when the expression is satisfied AND no REQUIRED node is
  // blocked/unknown. A non-required (unselected-branch) blocked/unknown node is tolerated.
  const requiredBlockedOrUnknown = planNodes.some((node) => node.required && (node.state === "blocked" || node.state === "unknown"));
  const resolvable = expressionResult === "true" && !requiredBlockedOrUnknown;

  const approval = computePlanApproval(input, planNodes);

  const planCore = {
    schema: PROVIDER_SCHEMA.plan,
    project_lock_digest: projectLockDigest,
    profile_digest: input.profile.profile_digest,
    policy_digest: policyDigest,
    source_revision: input.source_revision,
    scope: input.scope,
    capability_expression: input.capability_expression,
    nodes: planNodes,
  };
  // Derive identity from every semantic field (including approval), then bind that id in
  // the final digest. Pending and approved plans are distinct immutable objects/files.
  const planId = `plan-${sha256ProviderDigest({ ...planCore, approval }).slice("sha256:".length, "sha256:".length + 32)}`;
  const planDigest = sha256ProviderDigest({ ...planCore, plan_id: planId, approval });
  const plan: ProviderPlanV1_1 = {
    ...planCore,
    plan_id: planId,
    plan_digest: planDigest,
    approval,
  };

  const aggregated = dedupeDiagnostics([...planDiagnostics, ...planNodes.flatMap((node) => node.diagnostics)]);
  return { plan, resolvable, diagnostics: aggregated };
}

/** Close a set of capabilities under the dependency relation (transitive dependencies). */
function closeCapabilityUniverse(seed: readonly string[], dependencies: ReadonlyMap<string, readonly string[]>): Set<string> {
  const result = new Set<string>();
  const stack = [...seed];
  while (stack.length > 0) {
    const capability = stack.pop() as string;
    if (result.has(capability)) continue;
    result.add(capability);
    for (const dependency of dependencies.get(capability) ?? []) {
      if (!result.has(dependency)) stack.push(dependency);
    }
  }
  return result;
}

/** Build every node for one capability from the candidate set. */
function buildCapabilityNodes(input: ResolveProviderPlanInput, capability: string, dependencyCapabilities: readonly string[]): InternalNode[] {
  const nodes: InternalNode[] = [];
  const seenInstances = new Set<string>();
  let duplicateConflict = false;
  const matched: Array<{ candidate: ProviderCandidateInstance; declaration: ProviderCapabilityDeclaration }> = [];
  const hardBlocked: InternalNode[] = [];

  for (const candidate of input.candidates) {
    const hardBlock = candidateHardBlock(candidate);
    if (hardBlock) {
      // Only surface a hard-blocked candidate for capabilities it actually binds, so a
      // revoked/incompatible instance that is irrelevant to this capability is ignored.
      if (!candidate.intent.bindings.some((binding) => binding.capabilities.includes(capability))) continue;
      hardBlocked.push(blockedInstanceNode(input.scope, capability, candidate.intent.instance_id, hardBlock.code, hardBlock.message));
      continue;
    }
    if (!candidate.intent.enabled) {
      // A disabled instance that binds this capability is a blocked node, not a drop.
      if (candidate.intent.bindings.some((binding) => binding.capabilities.includes(capability))) {
        hardBlocked.push(blockedInstanceNode(input.scope, capability, candidate.intent.instance_id, "PROVIDER_CAPABILITY_MISSING", `instance ${candidate.intent.instance_id} binds capability ${capability} but is disabled`));
      }
      continue;
    }
    const match = matchProviderCapability(candidate, capability, input.scope);
    if (!match.matched) {
      // An enabled instance that BINDS the capability in this scope but whose Manifest
      // does not declare it (or declares it for the wrong stage) is a blocked node — a
      // Manifest-under-declaration must not pass vacuously.
      if (intentBindsCapability(candidate.intent, capability, input.scope)) {
        hardBlocked.push(blockedInstanceNode(input.scope, capability, candidate.intent.instance_id, "PROVIDER_MANIFEST_INVALID", `instance ${candidate.intent.instance_id} binds capability ${capability} but its Manifest ${match.reason}`));
      }
      continue;
    }
    if (seenInstances.has(candidate.intent.instance_id)) duplicateConflict = true;
    seenInstances.add(candidate.intent.instance_id);
    matched.push({ candidate, declaration: match.declaration });
  }

  if (matched.length === 0 && hardBlocked.length === 0) {
    nodes.push(blockedCapabilityNode(input.scope, capability, "PROVIDER_CAPABILITY_MISSING", `no enabled, bound, stage-eligible candidate provides capability ${capability}`));
    return nodes;
  }
  for (const { candidate, declaration } of matched) {
    nodes.push(resolveCandidateNode(input, candidate, declaration, capability, dependencyCapabilities));
  }
  nodes.push(...hardBlocked);
  if (duplicateConflict) {
    for (const node of nodes) {
      node.state = "blocked";
      node.diagnostics.push(diagnostic("PROVIDER_PLAN_CONFLICT", `capability ${capability} has duplicate candidate instances in the same plan`));
    }
  }
  return nodes;
}

function requireLockDigest(input: ResolveProviderPlanInput): Sha256Digest {
  // The project helper supplies the real providers.lock.yaml lock_digest; the pure path
  // derives a deterministic aggregate over the candidate locks so plans built from the
  // same candidate set are byte-reproducible.
  if (input.project_lock_digest !== undefined) {
    if (!DIGEST.test(input.project_lock_digest)) fail("PROVIDER_CONFIG_INVALID", `project_lock_digest must be a sha256 digest`);
    return input.project_lock_digest;
  }
  return sha256ProviderDigest({
    locks: input.candidates
      .map((candidate) => ({ instance_id: candidate.lock.instance_id, commit_oid: candidate.lock.source.commit_oid, project_config_digest: candidate.lock.project_config_digest }))
      .sort((left, right) => left.instance_id.localeCompare(right.instance_id)),
  });
}

function validateProviderScope(scope: ProviderScope): void {
  if (typeof scope.stage !== "string" || scope.stage.trim().length === 0) fail("PROVIDER_CONFIG_INVALID", "scope.stage must be a non-empty string");
}

function blockedCapabilityNode(scope: ProviderScope, capability: string, code: ProviderDiagnosticCode, message: string): InternalNode {
  return {
    node_id: nodeId(scope, capability, UNRESOLVED_INSTANCE),
    provider_instance_id: UNRESOLVED_INSTANCE,
    capability_id: capability,
    state: "blocked",
    required: false,
    selector_result: "false",
    dependencies: [],
    fallback_node_ids: [],
    diagnostics: [diagnostic(code, message)],
  };
}

/** A blocked node bound to a REAL project instance id (disabled/incompatible/mismatch). */
function blockedInstanceNode(scope: ProviderScope, capability: string, instanceId: string, code: ProviderDiagnosticCode, message: string): InternalNode {
  return {
    node_id: nodeId(scope, capability, instanceId),
    provider_instance_id: instanceId,
    capability_id: capability,
    state: "blocked",
    required: false,
    selector_result: "false",
    dependencies: [],
    fallback_node_ids: [],
    diagnostics: [diagnostic(code, message)],
  };
}

function resolveCandidateNode(
  input: ResolveProviderPlanInput,
  candidate: ProviderCandidateInstance,
  declaration: ProviderCapabilityDeclaration,
  capability: string,
  dependencyCapabilities: readonly string[],
): InternalNode {
  const diagnostics: ProviderDiagnostic[] = [];
  const selectorResult: SelectorResult = declaration.selector ? evaluateProfileSelector(declaration.selector, effectiveSelectorFacts(input.profile)) : "true";
  let state: ProviderPlanNode["state"];
  if (selectorResult === "unknown") {
    state = "unknown";
    diagnostics.push(diagnostic("PROVIDER_SELECTOR_UNKNOWN", `capability ${capability} selector is undecided for instance ${candidate.intent.instance_id}`, { fact_basis: input.profile.risk.facts_digest }));
  } else if (selectorResult === "false") {
    state = "not_selected";
  } else {
    state = "selected";
  }

  // Protected-gate trust enforcement.
  const requiresVerified = input.policy.protected_gate || input.profile.risk.protected_gate || input.profile.risk.level === "protected"
    || candidate.intent.trust.required_for_protected_gates || declaration.risk === "protected";
  if (requiresVerified && candidate.lock.trust.status !== "verified") {
    state = "blocked";
    diagnostics.push(diagnostic("PROVIDER_COMMIT_UNTRUSTED", `capability ${capability} requires verified trust but instance ${candidate.intent.instance_id} is ${candidate.lock.trust.status}`));
  }

  const entrypointId = Object.keys(candidate.lock.artifacts.entrypoint_digests).sort()[0];
  // Dependencies carry REAL node ids: this instance's dependency node when the same
  // instance provides the dependency, else the synthetic unresolved node id for it.
  const dependencyNodeIds = [...dependencyCapabilities].sort().map((dependency) => {
    const sameInstanceProvides = candidate.intent.bindings.some((binding) => binding.capabilities.includes(dependency))
      && candidate.capabilities.some((entry) => entry.id === dependency);
    return nodeId(input.scope, dependency, sameInstanceProvides ? candidate.intent.instance_id : UNRESOLVED_INSTANCE);
  });
  return {
    node_id: nodeId(input.scope, capability, candidate.intent.instance_id),
    provider_instance_id: candidate.intent.instance_id,
    capability_id: capability,
    state,
    // Expression selection and dependency closure assign required-ness after all
    // candidates have been resolved; optional branches must not become mandatory merely
    // because their declaration is high risk.
    required: false,
    selector_result: selectorResult,
    dependencies: dependencyNodeIds,
    fallback_node_ids: [],
    entrypoint_id: entrypointId,
    diagnostics,
  };
}

/** Build a selector view with deterministic scalar/plural aliases and profile lineage. */
function effectiveSelectorFacts(profile: EffectiveProviderProfileV1_1): JsonObject {
  const facts: Record<string, JsonValue> = { ...profile.facts };
  const alias = (singular: string, plural: string): void => {
    const singularValue = facts[singular];
    const pluralValue = facts[plural];
    if (pluralValue === undefined && singularValue !== undefined) facts[plural] = [singularValue];
    if (singularValue === undefined && Array.isArray(pluralValue)) facts[singular] = pluralValue[0] ?? null;
  };
  alias("language", "languages");
  alias("framework", "frameworks");
  const declaredProfiles = Array.isArray(facts.profiles) ? facts.profiles : [];
  facts.profiles = [...new Set([...declaredProfiles.filter((value): value is string => typeof value === "string"), ...profile.lineage.map((entry) => entry.profile_id)])];
  return facts as JsonObject;
}

/** Whether a node is a fallback alternate (listed as a fallback of another node). */
function isFallbackAlternateNode(node: InternalNode, siblings: readonly InternalNode[]): boolean {
  return siblings.some((other) => other !== node && other.fallback_node_ids.includes(node.node_id));
}

/** Replace capability placeholders with node ids that actually exist in this Plan. */
function wireDependencyNodeIds(
  nodesByCapability: ReadonlyMap<string, InternalNode[]>,
  dependencies: ReadonlyMap<string, readonly string[]>,
): void {
  for (const [capability, nodes] of nodesByCapability) {
    const targets = [...(dependencies.get(capability) ?? [])].sort().map((dependency) => {
      const candidates = nodesByCapability.get(dependency) ?? [];
      return candidates
        .filter((node) => node.state === "selected" && !isFallbackAlternateNode(node, candidates))
        .sort((left, right) => left.node_id.localeCompare(right.node_id))[0]
        ?? [...candidates].sort((left, right) => left.node_id.localeCompare(right.node_id))[0];
    }).filter((node): node is InternalNode => node !== undefined);
    for (const node of nodes) node.dependencies = targets.map((target) => target.node_id);
  }
}

/**
 * Admit fallback edges for a capability only when EVERY competing selected candidate is
 * in a single declared fallback group (and core + stage policy allow it). A capability
 * with a third selected candidate outside the group is NOT admitted — the conflict
 * stands — so a partial chain cannot mask an un-grouped third candidate.
 */
function applyFallbackEdges(input: ResolveProviderPlanInput, nodesByCapability: Map<string, InternalNode[]>, planDiagnostics: ProviderDiagnostic[]): void {
  const stageAllowsFallback = input.policy.fallback_allowed_stages.includes("*") || input.policy.fallback_allowed_stages.includes(input.scope.stage);
  for (const [capability, nodes] of nodesByCapability) {
    const competitors = nodes.filter((node) => node.provider_instance_id !== UNRESOLVED_INSTANCE && node.state === "selected");
    if (competitors.length < 2) continue;

    // The declared group of each competing selected candidate.
    const groups = new Map<string, number>();
    let ungrouped = 0;
    for (const node of competitors) {
      const candidate = input.candidates.find((entry) => entry.intent.instance_id === node.provider_instance_id);
      const declaration = candidate?.capabilities.find((entry) => entry.id === capability);
      const group = declaration?.fallback_group;
      if (group) groups.set(group, (groups.get(group) ?? 0) + 1);
      else ungrouped += 1;
    }

    // Admit ONLY when all competitors are in exactly one declared group.
    const allInOneGroup = ungrouped === 0 && groups.size === 1 && [...groups.values()][0] === competitors.length;
    if (!allInOneGroup) {
      // A group was declared but membership is partial/mixed ⇒ fallback not allowed.
      if (groups.size > 0) {
        planDiagnostics.push(diagnostic("PROVIDER_FALLBACK_NOT_ALLOWED", `capability ${capability} has competing candidates that are not all members of one declared fallback group`));
      }
      continue;
    }
    const admitted = input.policy.core_allows_fallback && stageAllowsFallback;
    if (!admitted) {
      const [group] = [...groups.keys()];
      planDiagnostics.push(diagnostic("PROVIDER_FALLBACK_NOT_ALLOWED", `fallback group ${group} for capability ${capability} is declared but not permitted by core/stage policy`));
      continue;
    }
    // Deterministic order: primary is the lexicographically smallest instance id.
    const ordered = [...competitors].sort((left, right) => left.provider_instance_id.localeCompare(right.provider_instance_id));
    const [primary, ...alternates] = ordered;
    primary.fallback_node_ids = alternates.map((node) => node.node_id).sort();
  }
}

function detectCapabilityCycles(
  dependencies: ReadonlyMap<string, readonly string[]>,
  universe: ReadonlySet<string>,
  nodesByCapability: Map<string, InternalNode[]>,
  planDiagnostics: ProviderDiagnostic[],
): void {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const onCycle = new Set<string>();
  const stack: string[] = [];

  const visit = (capability: string): void => {
    color.set(capability, GRAY);
    stack.push(capability);
    for (const dependency of dependencies.get(capability) ?? []) {
      const dependencyColor = color.get(dependency) ?? WHITE;
      if (dependencyColor === GRAY) {
        // Mark the whole back-edge span as on-cycle.
        const start = stack.indexOf(dependency);
        for (const member of stack.slice(start)) onCycle.add(member);
      } else if (dependencyColor === WHITE) {
        visit(dependency);
      }
    }
    stack.pop();
    color.set(capability, BLACK);
  };

  for (const capability of [...universe, ...dependencies.keys()].sort()) {
    if ((color.get(capability) ?? WHITE) === WHITE) visit(capability);
  }
  if (onCycle.size === 0) return;
  const cycleList = [...onCycle].sort();
  planDiagnostics.push(diagnostic("PROVIDER_DEPENDENCY_CYCLE", `capability dependency cycle detected: ${cycleList.join(" -> ")}`, { cycle: cycleList }));
  for (const capability of cycleList) {
    for (const node of nodesByCapability.get(capability) ?? []) {
      node.state = "blocked";
      node.diagnostics.push(diagnostic("PROVIDER_DEPENDENCY_CYCLE", `node is part of dependency cycle ${cycleList.join(" -> ")}`));
    }
  }
}

function resolveSelectionAndSatisfaction(input: ResolveProviderPlanInput, nodesByCapability: Map<string, InternalNode[]>): Map<string, SelectorResult> {
  const satisfaction = new Map<string, SelectorResult>();
  for (const [capability, nodes] of nodesByCapability) {
    const selected = nodes.filter((node) => node.state === "selected");
    const unknown = nodes.filter((node) => node.state === "unknown");
    const blocked = nodes.filter((node) => node.state === "blocked");

    if (selected.length > 1) {
      // Multiple satisfying candidates for one capability are a conflict unless an
      // admitted fallback chain covers EVERY competing candidate (one primary carrying
      // the rest as alternates). A partial chain (an un-grouped third candidate) stays a
      // conflict.
      const primaries = selected.filter((node) => node.fallback_node_ids.length > 0);
      const alternates = new Set(primaries.flatMap((node) => node.fallback_node_ids));
      const covered = selected.every((node) => node.fallback_node_ids.length > 0 || alternates.has(node.node_id));
      if (!(primaries.length === 1 && covered)) {
        const distinctInstances = new Set(selected.map((node) => node.provider_instance_id));
        for (const node of selected) {
          node.state = "blocked";
          node.diagnostics.push(diagnostic("PROVIDER_PLAN_CONFLICT", `capability ${capability} is satisfied by ${distinctInstances.size} competing candidates without a single admitted fallback chain`));
        }
        satisfaction.set(capability, "false");
        continue;
      }
    }
    if (nodes.some((node) => node.state === "selected" && node.diagnostics.every((entry) => entry.code !== "PROVIDER_PLAN_CONFLICT" && entry.code !== "PROVIDER_DEPENDENCY_CYCLE" && entry.code !== "PROVIDER_COMMIT_UNTRUSTED"))) {
      satisfaction.set(capability, "true");
    } else if (unknown.length > 0 && selected.length === 0) {
      satisfaction.set(capability, "unknown");
    } else if (blocked.length > 0 && selected.length === 0) {
      satisfaction.set(capability, "false");
    } else {
      satisfaction.set(capability, "false");
    }
  }
  return satisfaction;
}

/**
 * Walk the expression for `exactly_one` branches that are satisfied by MORE than one
 * operand (true count > 1). That is a plan conflict (PROVIDER_PLAN_CONFLICT), never a
 * missing capability: block every selected node of the competing operands so the
 * conflict is the reported diagnostic.
 */
function detectExactlyOneConflicts(
  expression: CapabilityExpression,
  satisfaction: ReadonlyMap<string, SelectorResult>,
  nodesByCapability: Map<string, InternalNode[]>,
  planDiagnostics: ProviderDiagnostic[],
): void {
  const visit = (node: CapabilityExpression): void => {
    if ("capability" in node) return;
    if ("all_of" in node) { node.all_of.forEach(visit); return; }
    if ("any_of" in node) { node.any_of.forEach(visit); return; }
    if ("at_least" in node) { node.at_least.of.forEach(visit); return; }
    // exactly_one
    const satisfiedOperands = node.exactly_one.filter((operand) => evaluateCapabilityExpression(operand, satisfaction) === "true");
    if (satisfiedOperands.length > 1) {
      const capabilities = satisfiedOperands.flatMap((operand) => capabilityExpressionLeaves(operand));
      planDiagnostics.push(diagnostic("PROVIDER_PLAN_CONFLICT", `exactly_one is satisfied by ${satisfiedOperands.length} branches: ${capabilities.sort().join(", ")}`, { capabilities: [...capabilities].sort() }));
      for (const capability of capabilities) {
        for (const target of nodesByCapability.get(capability) ?? []) {
          if (target.state === "selected") {
            target.state = "blocked";
            target.diagnostics.push(diagnostic("PROVIDER_PLAN_CONFLICT", `capability ${capability} participates in an over-satisfied exactly_one`));
          }
        }
      }
    }
    node.exactly_one.forEach(visit);
  };
  visit(expression);
}

/**
 * Compute the plan's approval block. A plan needs approval when it targets a protected
 * gate, a protected profile, carries any protected-risk required node, or admits a
 * fallback chain. With a ref ⇒ approved; without ⇒ pending. Otherwise not_required.
 */
function computePlanApproval(input: ResolveProviderPlanInput, nodes: readonly ProviderPlanNode[]): ProviderPlanV1_1["approval"] {
  const protectedProfile = input.profile.risk.level === "protected" || input.profile.risk.protected_gate;
  const protectedCapability = nodes.some((node) => node.required && node.state === "selected" && node.selector_result === "true" && node.capability_id.length > 0 && isProtectedRiskNode(input, node));
  const hasFallback = nodes.some((node) => node.fallback_node_ids.length > 0);
  const needsApproval = input.policy.protected_gate || protectedProfile || protectedCapability || hasFallback;
  if (!needsApproval) return { status: "not_required" };
  if (input.approval_ref !== undefined && input.approval_ref.length > 0) return { status: "approved", approval_ref: input.approval_ref };
  return { status: "pending" };
}

function isProtectedRiskNode(input: ResolveProviderPlanInput, node: ProviderPlanNode): boolean {
  const candidate = input.candidates.find((entry) => entry.intent.instance_id === node.provider_instance_id);
  const declaration = candidate?.capabilities.find((entry) => entry.id === node.capability_id);
  return declaration?.risk === "protected";
}

function finalizeNodes(nodes: readonly InternalNode[]): ProviderPlanNode[] {
  return [...nodes]
    .map((node) => {
      const planNode: ProviderPlanNode = {
        node_id: node.node_id,
        provider_instance_id: node.provider_instance_id,
        capability_id: node.capability_id,
        state: node.state,
        required: node.required,
        selector_result: node.selector_result,
        dependencies: [...node.dependencies].sort(),
        fallback_node_ids: [...node.fallback_node_ids].sort(),
        ...(node.entrypoint_id ? { entrypoint_id: node.entrypoint_id } : {}),
        diagnostics: dedupeDiagnostics(node.diagnostics),
      };
      return planNode;
    })
    .sort((left, right) => (left.capability_id === right.capability_id
      ? left.node_id.localeCompare(right.node_id)
      : left.capability_id.localeCompare(right.capability_id)));
}

function dedupeDiagnostics(diagnostics: readonly ProviderDiagnostic[]): ProviderDiagnostic[] {
  const seen = new Map<string, ProviderDiagnostic>();
  for (const entry of diagnostics) {
    const key = canonicalProviderJson(entry as unknown as JsonValue);
    if (!seen.has(key)) seen.set(key, entry);
  }
  return [...seen.values()].sort((left, right) => canonicalProviderJson(left as unknown as JsonValue).localeCompare(canonicalProviderJson(right as unknown as JsonValue)));
}

/**
 * Assert a resolution is usable, throwing a diagnosed {@link ProviderResolutionError}
 * otherwise. Picks the most specific resolution diagnostic present so callers that want
 * a hard stop (rather than inspecting the blocked/unknown plan) get a precise code.
 */
export function assertPlanResolvable(resolution: ProviderPlanResolution): ProviderPlanV1_1 {
  if (resolution.resolvable) return resolution.plan;
  const priority: ProviderResolutionDiagnosticCode[] = [
    "PROVIDER_COMMIT_REVOKED",
    "PROVIDER_SOURCE_UNAVAILABLE",
    "PROVIDER_SCHEMA_INCOMPATIBLE",
    "PROVIDER_MANIFEST_INVALID",
    "PROVIDER_LOCK_MISMATCH",
    "PROVIDER_COMMIT_UNTRUSTED",
    "PROVIDER_DEPENDENCY_CYCLE",
    "PROVIDER_PLAN_CONFLICT",
    "PROVIDER_FALLBACK_NOT_ALLOWED",
    "PROVIDER_CAPABILITY_MISSING",
    "PROVIDER_SELECTOR_UNKNOWN",
  ];
  for (const code of priority) {
    const hit = resolution.diagnostics.find((entry) => entry.code === code);
    if (hit) throw new ProviderResolutionError(code, hit.message, resolution.diagnostics);
  }
  throw new ProviderResolutionError("PROVIDER_CAPABILITY_MISSING", "plan is not resolvable", resolution.diagnostics);
}

// ───────────────────────────────────────────────────────────────────────────────────
// 5) Project-level helper: lock/cache-only, profile registry, directive context.
// ───────────────────────────────────────────────────────────────────────────────────

/** The provider_context block a directive consumes to understand its Provider plan. */
export interface ProviderDirectiveContext {
  readonly project_provider_lock: typeof PROJECT_PROVIDERS_LOCK_PATH;
  readonly lock_digest: Sha256Digest;
  readonly plan: {
    readonly id: string;
    readonly digest: Sha256Digest;
    readonly status: "pending" | "approved";
    readonly path?: string;
  };
  readonly plan_id: string;
  readonly plan_digest: Sha256Digest;
  readonly project_lock_digest: Sha256Digest;
  readonly profile_id: string;
  readonly profile_digest: Sha256Digest;
  readonly policy_digest: Sha256Digest;
  readonly scope: ProviderScope;
  readonly capability_expression: CapabilityExpression;
  readonly resolvable: boolean;
  readonly diagnostics: readonly ProviderDiagnostic[];
}

/**
 * One directive-ready Provider action. Every action binds the provider instance, the
 * project lock digest, the plan triple (plan_id/plan_digest/plan_node_id) and the
 * commit/tree/manifest/config digests so a downstream request cannot be re-pointed at a
 * different lock, plan or revision.
 */
export interface ProviderDirectiveAction {
  readonly id: string;
  readonly node: string;
  readonly plan_node_id: string;
  readonly capability_id: string;
  readonly provider_id: string;
  readonly type: ProviderCapabilityDeclaration["kind"];
  readonly required: boolean;
  readonly role: "primary" | "fallback";
  readonly required_before?: "stage-execution";
  readonly required_after?: "stage-execution";
  readonly binding: {
    readonly provider_instance_id: string;
    readonly project_lock_digest: Sha256Digest;
    readonly plan_id: string;
    readonly plan_digest: Sha256Digest;
    readonly plan_node_id: string;
    readonly commit_oid: string;
    readonly tree_oid: string;
    readonly manifest_digest: Sha256Digest;
    readonly config_digest: Sha256Digest;
  };
  readonly provider_instance_id: string;
  readonly project_lock_digest: Sha256Digest;
  readonly plan_id: string;
  readonly plan_digest: Sha256Digest;
  readonly commit_oid: string;
  readonly tree_oid: string;
  readonly manifest_digest: Sha256Digest;
  readonly config_digest: Sha256Digest;
  readonly entrypoint_id?: string;
  readonly fallback_node_ids: readonly string[];
}

export interface ProjectProviderPlanResult {
  readonly provider_context: ProviderDirectiveContext;
  readonly provider_actions: readonly ProviderDirectiveAction[];
  readonly plan: ProviderPlanV1_1;
  readonly resolution: ProviderPlanResolution;
  readonly profile: EffectiveProviderProfileV1_1;
}

interface ProfileRegistryEntry {
  readonly extends: readonly string[];
  readonly facts: JsonObject;
  readonly risk: { readonly level: ProfileRiskLevel; readonly protected_gate: boolean };
}

interface ProfileRegistry {
  readonly active: string;
  readonly profiles: ReadonlyMap<string, ProfileRegistryEntry>;
}

function resolvedProjectRoot(projectRoot: string): string {
  const candidate = resolve(projectRoot);
  if (!existsSync(candidate)) fail("PROVIDER_CONFIG_INVALID", `project root does not exist: ${candidate}`);
  const stat = lstatSync(candidate);
  if (!stat.isDirectory()) fail("PROVIDER_CONFIG_INVALID", `project root must be a directory: ${candidate}`);
  return candidate;
}

/**
 * Read and validate the `.aidlc/provider-profile.json` registry (see the file header
 * for the documented shape). When the file is absent a `default` registry with a single
 * empty-facts profile is synthesized. Unknown fields and `extends` cycles are rejected.
 */
export function readProviderProfileRegistry(projectRoot: string): ProfileRegistry {
  const root = resolvedProjectRoot(projectRoot);
  const path = resolve(root, PROVIDER_PROFILE_REGISTRY_PATH);
  if (!existsSync(path)) {
    return { active: DEFAULT_PROFILE_ID, profiles: new Map([[DEFAULT_PROFILE_ID, { extends: [], facts: {}, risk: { level: "development", protected_gate: false } }]]) };
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} must be a regular non-symlink file`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} must contain an object`);
  for (const key of Object.keys(value)) {
    if (!["version", "active", "profiles"].includes(key)) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} has unknown field ${key}`);
  }
  if (value.version !== undefined && value.version !== 1) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} version must be 1`);
  if (!isRecord(value.profiles)) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} profiles must be an object`);
  const profiles = new Map<string, ProfileRegistryEntry>();
  for (const [profileId, candidate] of Object.entries(value.profiles)) {
    if (!PROFILE_ID.test(profileId)) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} profile id ${JSON.stringify(profileId)} is invalid`);
    if (!isRecord(candidate)) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} profile ${profileId} must be an object`);
    for (const key of Object.keys(candidate)) {
      if (!["extends", "facts", "risk"].includes(key)) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} profile ${profileId} has unknown field ${key}`);
    }
    const parents = candidate.extends === undefined ? [] : asStringArray(candidate.extends, `${PROVIDER_PROFILE_REGISTRY_PATH} profile ${profileId} extends`);
    const facts = candidate.facts === undefined ? {} : normalizeFacts(candidate.facts, `${PROVIDER_PROFILE_REGISTRY_PATH} profile ${profileId} facts`);
    let risk: ProfileRegistryEntry["risk"] = { level: "development", protected_gate: false };
    if (candidate.risk !== undefined) {
      if (!isRecord(candidate.risk)) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} profile ${profileId} risk must be an object`);
      for (const key of Object.keys(candidate.risk)) {
        if (!["level", "protected_gate"].includes(key)) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} profile ${profileId} risk has unknown field ${key}`);
      }
      const level = candidate.risk.level === undefined ? "development" : candidate.risk.level;
      if (level !== "development" && level !== "standard" && level !== "protected") fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} profile ${profileId} risk.level is invalid`);
      if (candidate.risk.protected_gate !== undefined && typeof candidate.risk.protected_gate !== "boolean") fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} profile ${profileId} risk.protected_gate must be a boolean`);
      risk = { level, protected_gate: candidate.risk.protected_gate === true };
    }
    profiles.set(profileId, { extends: parents, facts, risk });
  }
  if (profiles.size === 0) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} must declare at least one profile`);
  const active = value.active === undefined ? DEFAULT_PROFILE_ID : value.active;
  if (typeof active !== "string" || !PROFILE_ID.test(active)) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} active must be a valid profile id`);
  if (!profiles.has(active)) {
    if (active === DEFAULT_PROFILE_ID) profiles.set(DEFAULT_PROFILE_ID, { extends: [], facts: {}, risk: { level: "development", protected_gate: false } });
    else fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PROFILE_REGISTRY_PATH} active profile ${active} is not declared`);
  }
  return { active, profiles };
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) fail("PROVIDER_CONFIG_INVALID", `${field} must be an array`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !PROFILE_ID.test(entry)) fail("PROVIDER_CONFIG_INVALID", `${field}[${index}] must be a valid profile id`);
    return entry;
  });
}

/** Compose an Effective Profile for a profile id from a validated registry. */
export function composeProfileFromRegistry(registry: ProfileRegistry, profileId: string = registry.active): EffectiveProviderProfileV1_1 {
  const resolveLineage = (id: string, trail: readonly string[]): ProviderProfileDefinition[] => {
    if (trail.includes(id)) fail("PROVIDER_CONFIG_INVALID", `profile registry has an extends cycle: ${[...trail, id].join(" -> ")}`);
    const entry = registry.profiles.get(id);
    if (!entry) fail("PROVIDER_CONFIG_INVALID", `profile registry references undefined profile ${id}`);
    const definitions: ProviderProfileDefinition[] = [];
    for (const parent of entry.extends) {
      for (const ancestor of resolveLineage(parent, [...trail, id])) {
        if (!definitions.some((existing) => existing.profile_id === ancestor.profile_id)) definitions.push(ancestor);
      }
    }
    definitions.push(defineProviderProfile({ profile_id: id, extends: entry.extends, facts: entry.facts, risk: entry.risk }));
    return definitions;
  };
  const lineage = resolveLineage(profileId, []);
  const child = lineage[lineage.length - 1];
  const parents = lineage.slice(0, -1);
  return composeEffectiveProfile(parents, child);
}

/**
 * Build candidate instances from the project lock + config + verified cache without any
 * remote refresh. Reads providers through readProjectProviders (lock-backed) and the
 * Manifest capability metadata through verifyLockedProviderCache (cache-backed).
 *
 * EVERY provider the project config declares that binds a capability in this scope
 * becomes a candidate — including a disabled instance and one whose Manifest under-
 * declares — so the resolver can bind a blocked node to the real instance instead of
 * dropping the binding and passing vacuously. A verified-cache integrity failure
 * (lock/digest mismatch) or a revoked trust status is carried as an `incompatibility`
 * so the candidate fails closed rather than being silently omitted.
 */
export function readProjectProviderCandidates(projectRoot: string, scope: ProviderScope, state?: ProjectProviderState): ProviderCandidateInstance[] {
  const root = resolvedProjectRoot(projectRoot);
  const providerState: ProjectProviderState = state ?? readProjectProviders(root, false);
  const locks = new Map(providerState.lock.providers.map((entry) => [entry.instance_id, entry]));
  const candidates: ProviderCandidateInstance[] = [];
  for (const intent of providerState.config.providers) {
    // Only consider providers that bind at least one capability in this scope.
    if (!intent.bindings.some((binding) => bindingBlockMatchesScope(binding, scope))) continue;
    const lock = locks.get(intent.instance_id);
    if (!lock) {
      // A disabled provider with no lock cannot form a resolvable node; surface it only
      // when enabled so an enabled-but-unlocked instance fails closed.
      if (!intent.enabled) continue;
      fail("PROVIDER_CONFIG_INVALID", `enabled provider ${intent.instance_id} has no lock entry`);
    }
    // Basic intent/lock consistency: instance id, provider id and config digest must agree.
    const consistency = checkIntentLockConsistency(intent, lock);
    if (consistency) {
      candidates.push({ intent, lock, capabilities: [], incompatibility: consistency });
      continue;
    }
    if (lock.trust.status === "revoked") {
      candidates.push({ intent, lock, capabilities: [], incompatibility: { code: "PROVIDER_COMMIT_REVOKED", message: `instance ${intent.instance_id} lock trust is revoked` } });
      continue;
    }
    if (!intent.enabled) {
      // A disabled instance is a candidate with no derived capabilities so the resolver
      // emits a blocked node bound to the real instance for any capability it binds.
      candidates.push({ intent, lock, capabilities: [] });
      continue;
    }
    // An enabled instance verifies its cache; a lock/digest mismatch fails closed.
    let manifest: Awaited<ReturnType<typeof verifyLockedProviderCache>>["manifest"];
    try {
      manifest = verifyLockedProviderCache(root, lock).manifest;
    } catch (error) {
      candidates.push({ intent, lock, capabilities: [], incompatibility: mapCacheVerificationError(intent.instance_id, error) });
      continue;
    }
    const capabilities = deriveCapabilityDeclarations(intent, manifest, scope);
    // v2 knowledge is optional by installed module facts, never by a platform/name.
    // An explicit requested capability still fails as missing if no chapter applies.
    const knowledge = manifest.extensions?.["aidlc.knowledge"] as any;
    if (manifest.kind === "knowledge" && knowledge?.schema === "aidlc.knowledge-package/v2") {
      const facts = readModuleFacts(root, scope.module_id);
      if (!Array.isArray(knowledge.topics)) fail("PROVIDER_MANIFEST_INVALID", "missing knowledge topics");
      const relevant = knowledge.topics.filter((topic: any) => capabilities.some(cap => cap.id === topic.capability_id));
      const results = relevant.flatMap((topic: any) => {
        if (!Array.isArray(topic.sections) || !topic.sections.length) fail("PROVIDER_MANIFEST_INVALID", "missing knowledge sections");
        return topic.sections.map((section: any) => matchKnowledgeRequirements(facts, section.requires));
      });
      if (!results.includes("match")) {
        if (results.includes("unknown") || results.includes("conflict")) {
          candidates.push({ intent, lock, capabilities: [], incompatibility: { code: "PROVIDER_MANIFEST_INVALID", message: `module ${scope.module_id ?? "(unbound)"}: knowledge dependency versions ${results.includes("conflict") ? "conflict" : "unknown"}; supply verified module facts` } });
        }
        continue;
      }
    }
    // A validated v1.1 Manifest is compatible by construction (no protocol range needed).
    candidates.push({ intent, lock, capabilities });
  }
  return candidates;
}

/** Verify an intent and its lock entry agree on identity and config digest. */
function checkIntentLockConsistency(intent: ProjectProviderIntent, lock: ProjectProviderLockEntry): ProviderCandidateInstance["incompatibility"] | undefined {
  if (lock.instance_id !== intent.instance_id) {
    return { code: "PROVIDER_LOCK_MISMATCH", message: `lock instance_id ${lock.instance_id} does not match intent ${intent.instance_id}` };
  }
  if (lock.id !== intent.id) {
    return { code: "PROVIDER_LOCK_MISMATCH", message: `lock provider id ${lock.id} does not match intent id ${intent.id} for ${intent.instance_id}` };
  }
  if (lock.source.git !== intent.source.git || lock.source.requested_ref !== intent.source.ref || lock.source.subdir !== (intent.source.subdir ?? null)) {
    return { code: "PROVIDER_LOCK_MISMATCH", message: `instance ${intent.instance_id} source intent does not match its lock entry` };
  }
  if (lock.project_config_digest !== projectProviderConfigDigest(intent)) {
    return { code: "PROVIDER_LOCK_MISMATCH", message: `instance ${intent.instance_id} lock project_config_digest does not match the current intent` };
  }
  return undefined;
}

/** Map a verified-cache verification error to a candidate incompatibility. */
function mapCacheVerificationError(instanceId: string, error: unknown): NonNullable<ProviderCandidateInstance["incompatibility"]> {
  const message = error instanceof Error ? error.message : String(error);
  if (/PROVIDER_SCHEMA_INCOMPATIBLE/.test(message)) return { code: "PROVIDER_SCHEMA_INCOMPATIBLE", message: `instance ${instanceId}: ${message}` };
  if (/PROVIDER_LOCK_MISMATCH/.test(message)) return { code: "PROVIDER_LOCK_MISMATCH", message: `instance ${instanceId}: ${message}` };
  if (/PROVIDER_SOURCE_UNAVAILABLE/.test(message)) return { code: "PROVIDER_SOURCE_UNAVAILABLE", message: `instance ${instanceId}: ${message}` };
  return { code: "PROVIDER_MANIFEST_INVALID", message: `instance ${instanceId}: ${message}` };
}

/**
 * Derive the capability declarations the resolver needs from the repository Manifest
 * and the intent bindings. The repository Manifest (aidlc.provider/v1.1) lists the
 * capabilities a Provider offers, plus optional `selectors` (languages/frameworks/
 * profiles) that gate where a capability applies. Stage eligibility and risk are taken
 * from the intent's scope bindings so a project can constrain where a capability
 * applies.
 *
 * The Manifest's `selectors` are compiled into a {@link ProfileSelector} so profile
 * facts actually gate selection (otherwise a capability would always select):
 * - languages ⇒ OR over `language` ∈ {…} (profile fact `language` or `languages[]`).
 * - frameworks ⇒ OR over `framework`/`frameworks[]` membership.
 * - profiles ⇒ OR over `profiles[]` membership (plural array fact by convention).
 * Different dimensions are AND-ed together; within a dimension the list is OR-ed. A
 * fact absent from the profile evaluates to `unknown` (Kleene), failing closed.
 *
 * Capabilities the intent binds in this scope but the Manifest does not declare are
 * skipped here (they surface as a blocked node in {@link readProjectProviderCandidates}
 * via the enabled-but-under-declared path); capabilities the Manifest declares are
 * surfaced with the stages the intent binds them to.
 */
function deriveCapabilityDeclarations(
  intent: ProjectProviderIntent,
  manifest: ProviderRepositoryManifestV1_1,
  scope: ProviderScope,
): ProviderCapabilityDeclaration[] {
  const declarations: ProviderCapabilityDeclaration[] = [];
  const selector = compileManifestSelector(manifest.selectors);
  for (const capability of manifest.capabilities) {
    const stages = new Set<string>();
    let bound = false;
    for (const binding of intent.bindings) {
      if (!binding.capabilities.includes(capability)) continue;
      bound = true;
      for (const stage of binding.stages) stages.add(stage);
    }
    if (!bound) continue;
    const risk = intent.trust.required_for_protected_gates ? "protected" : "standard";
    declarations.push({
      id: capability,
      kind: manifest.kind,
      risk,
      stages: [...stages].sort(),
      ...(selector ? { selector } : {}),
    });
  }
  void scope;
  return declarations;
}

/**
 * Compile a simple Manifest `selectors` block into a three-valued {@link ProfileSelector}.
 * Same-dimension entries are OR-ed; different dimensions are AND-ed. By convention,
 * language/framework match either a scalar fact or a plural array fact, and profiles
 * match the plural `profiles[]` array fact. Returns undefined when no selectors are
 * declared (capability selects unconditionally).
 */
function compileManifestSelector(selectors: ProviderRepositoryManifestV1_1["selectors"]): ProfileSelector | undefined {
  if (!selectors) return undefined;
  const dimensions: ProfileSelector[] = [];
  const languageDim = compileSelectorDimension(["language", "languages"], selectors.languages);
  if (languageDim) dimensions.push(languageDim);
  const frameworkDim = compileSelectorDimension(["framework", "frameworks"], selectors.frameworks);
  if (frameworkDim) dimensions.push(frameworkDim);
  const profileDim = compileSelectorDimension(["profiles"], selectors.profiles);
  if (profileDim) dimensions.push(profileDim);
  if (dimensions.length === 0) return undefined;
  if (dimensions.length === 1) return dimensions[0];
  return { all_of: dimensions };
}

/**
 * Compile one selector dimension. `facts` names the profile fact(s) that may carry the
 * value: a scalar fact matched with `equals`, and a plural (array) fact matched with
 * `contains`. The dimension is the OR over (every value × every candidate fact). A fact
 * whose name ends in `s` is treated as a plural array fact (`contains`), otherwise as a
 * scalar fact (`equals`).
 */
function compileSelectorDimension(facts: readonly string[], values: readonly string[] | undefined): ProfileSelector | undefined {
  if (!values || values.length === 0) return undefined;
  const alternatives: ProfileSelector[] = [];
  for (const value of values) {
    for (const fact of facts) {
      alternatives.push(fact.endsWith("s")
        ? { fact, operator: "contains", value }
        : { fact, operator: "equals", value });
    }
  }
  if (alternatives.length === 1) return alternatives[0];
  return { any_of: alternatives };
}

/**
 * Resolve a Provider plan for a project directly from its lock/cache and profile
 * registry, producing the directive `provider_context` and `provider_actions`. Never
 * refreshes a remote. The capability expression defaults to requiring every capability
 * the enabled providers bind in this scope (all_of over the derived scope capabilities).
 */
export function resolveProjectProviderPlan(
  projectRoot: string,
  input: {
    readonly scope: ProviderScope;
    readonly source_revision: ProviderSourceRevision;
    readonly policy: ProviderResolutionPolicy;
    readonly capability_expression?: CapabilityExpression;
    readonly profile_id?: string;
    readonly dependencies?: ReadonlyMap<string, readonly string[]>;
    readonly approval_ref?: string;
    readonly freeze?: boolean;
  },
): ProjectProviderPlanResult {
  const root = resolvedProjectRoot(projectRoot);
  const registry = readProviderProfileRegistry(root);
  const profile = composeProfileFromRegistry(registry, input.profile_id ?? registry.active);
  const state = readProjectProviders(root, false);
  const candidates = readProjectProviderCandidates(root, input.scope, state);

  const derivedCapabilities = deriveScopeCapabilities(candidates, input.scope);
  const expression = input.capability_expression ?? defaultCapabilityExpression(derivedCapabilities);

  const resolution = resolveProviderPlan(
    { candidates, scope: input.scope, profile, capability_expression: expression, policy: input.policy, source_revision: input.source_revision, project_lock_digest: state.lock.lock_digest, approval_ref: input.approval_ref },
    { dependencies: input.dependencies },
  );

  const planPath = input.freeze ? freezeProviderPlan(root, resolution.plan) : undefined;
  const actions = buildDirectiveActions(resolution.plan, candidates);
  const providerContext: ProviderDirectiveContext = {
    project_provider_lock: PROJECT_PROVIDERS_LOCK_PATH,
    lock_digest: resolution.plan.project_lock_digest,
    plan: {
      id: resolution.plan.plan_id,
      digest: resolution.plan.plan_digest,
      status: resolution.plan.approval?.status === "pending" ? "pending" : "approved",
      ...(planPath ? { path: planPath } : {}),
    },
    plan_id: resolution.plan.plan_id,
    plan_digest: resolution.plan.plan_digest,
    project_lock_digest: resolution.plan.project_lock_digest,
    profile_id: profile.profile_id,
    profile_digest: profile.profile_digest,
    policy_digest: resolution.plan.policy_digest,
    scope: input.scope,
    capability_expression: expression,
    resolvable: resolution.resolvable,
    diagnostics: resolution.diagnostics,
  };

  return { provider_context: providerContext, provider_actions: actions, plan: resolution.plan, resolution, profile };
}

/**
 * The union of capabilities every candidate binds in this scope — INCLUDING disabled,
 * under-declared and incompatible candidates. The default capability expression is
 * derived from this set so a required capability whose only provider is disabled/
 * incompatible still appears in the plan and forces a blocked node (never a vacuous
 * empty all_of that passes).
 */
export function deriveScopeCapabilities(candidates: readonly ProviderCandidateInstance[], scope: ProviderScope): string[] {
  const result = new Set<string>();
  for (const candidate of candidates) {
    for (const capability of scopeBoundCapabilities(candidate.intent, scope)) result.add(capability);
  }
  return [...result].sort();
}

function defaultCapabilityExpression(capabilities: readonly string[]): CapabilityExpression {
  if (capabilities.length === 1) return { capability: capabilities[0] };
  // Zero capabilities ⇒ vacuous all_of (trivially satisfied); many ⇒ all_of over them.
  return { all_of: capabilities.map((capability) => ({ capability })) };
}

function buildDirectiveActions(plan: ProviderPlanV1_1, candidates: readonly ProviderCandidateInstance[]): ProviderDirectiveAction[] {
  const byInstance = new Map(candidates.map((candidate) => [candidate.intent.instance_id, candidate]));
  const fallbackNodeIds = new Set(plan.nodes.filter((node) => node.required).flatMap((node) => node.fallback_node_ids));
  const actions: ProviderDirectiveAction[] = [];
  for (const node of plan.nodes) {
    if (node.state !== "selected" || (!node.required && !fallbackNodeIds.has(node.node_id))) continue;
    const candidate = byInstance.get(node.provider_instance_id);
    const declaration = candidate?.capabilities.find((entry) => entry.id === node.capability_id);
    if (!candidate || !declaration) continue;
    actions.push({
      id: node.node_id,
      node: node.node_id,
      plan_node_id: node.node_id,
      capability_id: node.capability_id,
      provider_id: candidate.intent.id,
      type: declaration.kind,
      required: node.required,
      role: fallbackNodeIds.has(node.node_id) ? "fallback" : "primary",
      ...(declaration.kind === "knowledge" ? { required_before: "stage-execution" as const } : { required_after: "stage-execution" as const }),
      binding: {
        provider_instance_id: node.provider_instance_id,
        project_lock_digest: plan.project_lock_digest,
        plan_id: plan.plan_id,
        plan_digest: plan.plan_digest,
        plan_node_id: node.node_id,
        commit_oid: candidate.lock.source.commit_oid,
        tree_oid: candidate.lock.source.tree_oid,
        manifest_digest: candidate.lock.manifest.digest,
        config_digest: candidate.lock.project_config_digest,
      },
      provider_instance_id: node.provider_instance_id,
      project_lock_digest: plan.project_lock_digest,
      plan_id: plan.plan_id,
      plan_digest: plan.plan_digest,
      commit_oid: candidate.lock.source.commit_oid,
      tree_oid: candidate.lock.source.tree_oid,
      manifest_digest: candidate.lock.manifest.digest,
      config_digest: candidate.lock.project_config_digest,
      ...(node.entrypoint_id ? { entrypoint_id: node.entrypoint_id } : {}),
      fallback_node_ids: node.fallback_node_ids,
    });
  }
  return actions.sort((left, right) => left.plan_node_id.localeCompare(right.plan_node_id));
}

/**
 * Freeze a plan to `.aidlc/provider-plans/<plan-id>.json`, atomically. The written file
 * is the canonical plan JSON so a re-resolution with identical inputs is byte-identical.
 * Idempotent: an existing identical plan file is left untouched.
 */
export function freezeProviderPlan(projectRoot: string, plan: ProviderPlanV1_1): string {
  if (!PLAN_ID.test(plan.plan_id)) fail("PROVIDER_CONFIG_INVALID", `plan_id ${plan.plan_id} is not a valid plan id`);
  if (recomputePlanId(plan) !== plan.plan_id || recomputePlanDigest(plan) !== plan.plan_digest) {
    fail("PROVIDER_PLAN_STALE", `Provider plan ${plan.plan_id} identity or digest does not match its canonical content`);
  }
  const root = resolvedProjectRoot(projectRoot);
  const directory = resolve(root, PROVIDER_PLANS_PATH);
  const rel = relative(root, directory);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("PROVIDER_CONFIG_INVALID", "provider-plans directory escapes project root");
  if (existsSync(directory)) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PROVIDER_CONFIG_INVALID", `${PROVIDER_PLANS_PATH} must be a regular non-symlink directory`);
  } else {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const path = resolve(directory, `${plan.plan_id}.json`);
  const content = `${canonicalProviderJson(plan as unknown as JsonValue)}\n`;
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("PROVIDER_CONFIG_INVALID", `frozen plan path must be a regular non-symlink file: ${path}`);
    if (readFileSync(path, "utf8") === content) return relative(root, path).replace(/\\/g, "/");
    fail("PROVIDER_PLAN_STALE", `immutable Provider plan id ${plan.plan_id} already exists with different content`);
  }
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
  return relative(root, path).replace(/\\/g, "/");
}

// ───────────────────────────────────────────────────────────────────────────────────
// 6) Prior-plan currency check — lock / profile / policy / revision drift fails closed.
// ───────────────────────────────────────────────────────────────────────────────────

export interface PlanCurrencyExpectation {
  readonly project_lock_digest: Sha256Digest;
  readonly profile_digest: Sha256Digest;
  readonly policy_digest: Sha256Digest;
  readonly source_revision: ProviderSourceRevision;
}

export interface PlanCurrencyResult {
  readonly current: boolean;
  readonly drift: readonly string[];
}

/**
 * Compare a previously frozen plan against the current lock/profile/policy/revision. Any
 * drift renders the plan stale (PCORE-012): a stale plan must be re-resolved, never
 * reused. Returns the drift reasons; {@link assertPlanCurrent} turns drift into a
 * PROVIDER_PLAN_STALE error.
 */
export function checkPlanCurrency(plan: ProviderPlanV1_1, expectation: PlanCurrencyExpectation): PlanCurrencyResult {
  const drift: string[] = [];
  // The plan's own digest must still verify, or the stored plan was tampered with.
  const recomputed = recomputePlanDigest(plan);
  if (recomputed !== plan.plan_digest) drift.push(`plan_digest mismatch: stored ${plan.plan_digest}, recomputed ${recomputed}`);
  if (plan.project_lock_digest !== expectation.project_lock_digest) drift.push(`project_lock_digest drift: plan ${plan.project_lock_digest}, current ${expectation.project_lock_digest}`);
  if (plan.profile_digest !== expectation.profile_digest) drift.push(`profile_digest drift: plan ${plan.profile_digest}, current ${expectation.profile_digest}`);
  if (plan.policy_digest !== expectation.policy_digest) drift.push(`policy_digest drift: plan ${plan.policy_digest}, current ${expectation.policy_digest}`);
  if (canonicalProviderJson(plan.source_revision as unknown as JsonValue) !== canonicalProviderJson(expectation.source_revision as unknown as JsonValue)) {
    drift.push("source_revision drift");
  }
  return { current: drift.length === 0, drift };
}

/** Throw PROVIDER_PLAN_STALE when a prior plan has drifted; otherwise return the plan. */
export function assertPlanCurrent(plan: ProviderPlanV1_1, expectation: PlanCurrencyExpectation): ProviderPlanV1_1 {
  const result = checkPlanCurrency(plan, expectation);
  if (!result.current) fail("PROVIDER_PLAN_STALE", `prior Provider plan ${plan.plan_id} is stale: ${result.drift.join("; ")}`);
  return plan;
}

/** Recompute the content-addressed Plan identity (all semantic fields except id/digest). */
export function recomputePlanId(plan: ProviderPlanV1_1): string {
  const { plan_id: _planId, plan_digest: _planDigest, ...core } = plan;
  void _planId;
  void _planDigest;
  return `plan-${sha256ProviderDigest(core).slice("sha256:".length, "sha256:".length + 32)}`;
}

/**
 * Recompute a plan's digest over its canonical content, excluding ONLY `plan_digest`
 * itself. The plan_id and the approval block DO participate, so tampering with the
 * approval ref (or the plan_id) is detected as a plan_digest mismatch — i.e. a currency
 * mismatch in {@link checkPlanCurrency}.
 */
export function recomputePlanDigest(plan: ProviderPlanV1_1): Sha256Digest {
  const { plan_digest: _planDigest, ...rest } = plan;
  void _planDigest;
  return sha256ProviderDigest(rest);
}

/** Validate a stored plan object is a syntactically well-formed ProviderPlanV1_1. */
export function parseFrozenProviderPlan(value: unknown): ProviderPlanV1_1 {
  if (!isRecord(value)) fail("PROVIDER_CONFIG_INVALID", "frozen plan must be an object");
  if (value.schema !== PROVIDER_SCHEMA.plan) fail("PROVIDER_SCHEMA_INCOMPATIBLE", `frozen plan schema must be ${PROVIDER_SCHEMA.plan}`);
  for (const field of ["plan_id", "plan_digest", "project_lock_digest", "profile_digest", "policy_digest"] as const) {
    if (typeof value[field] !== "string") fail("PROVIDER_CONFIG_INVALID", `frozen plan ${field} must be a string`);
  }
  if (!PLAN_ID.test(value.plan_id as string)) fail("PROVIDER_CONFIG_INVALID", `frozen plan plan_id is invalid`);
  for (const field of ["plan_digest", "project_lock_digest", "profile_digest", "policy_digest"] as const) {
    if (!DIGEST.test(value[field] as string)) fail("PROVIDER_CONFIG_INVALID", `frozen plan ${field} must be a sha256 digest`);
  }
  if (!Array.isArray(value.nodes)) fail("PROVIDER_CONFIG_INVALID", "frozen plan nodes must be an array");
  return value as unknown as ProviderPlanV1_1;
}

/** Default resolution policy used by the restricted runner profile (no fallback, non-protected). */
export function defaultResolutionPolicy(overrides: Partial<ProviderResolutionPolicy> = {}): ProviderResolutionPolicy {
  return {
    policy_id: `aidlc.resolution-policy/${RESTRICTED_RUNNER_PROFILE}`,
    core_allows_fallback: false,
    fallback_allowed_stages: [],
    protected_gate: false,
    ...overrides,
  };
}
