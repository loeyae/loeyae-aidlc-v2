import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  P0_PROVIDER_DIAGNOSTICS,
  PROVIDER_SCHEMA,
  RESTRICTED_RUNNER_POLICY_V1,
  type EvidenceStatus,
  type JsonObject,
  type JsonValue,
  type ProviderDiagnostic,
  type ProviderDiagnosticCode,
  type ProviderEvidenceV1_1,
  type ProviderRequestV1_1,
  type ProviderResultCheck,
  type ProviderResultV1_1,
  type ProviderScope,
  type ProviderSourceRevision,
  type Sha256Digest,
} from "./aidlc-provider-types.js";
import {
  canonicalProviderJson,
  sha256ProviderDigest,
} from "./aidlc-project-provider.js";
import { runSync } from "./aidlc-spawn.js";

export const PROVIDER_EVIDENCE_ROOT = ".aidlc/evidence/providers";
const SIGNING_KEY_RELATIVE_PATH = "aidlc/provider-signing-key.json";
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const EVIDENCE_ID = /^evidence-[0-9a-f]{32}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const EXTENSION_NAMESPACE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const DEFAULT_VALIDITY_SECONDS = 24 * 60 * 60;

export class ProviderEvidenceError extends Error {
  readonly diagnostic: ProviderDiagnosticCode;

  constructor(diagnostic: ProviderDiagnosticCode, message: string) {
    super(`${diagnostic}: ${message}`);
    this.name = "ProviderEvidenceError";
    this.diagnostic = diagnostic;
  }
}

function fail(diagnostic: ProviderDiagnosticCode, message: string): never {
  throw new ProviderEvidenceError(diagnostic, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) fail("PROVIDER_EVIDENCE_REVOKED", `${label} has unknown field ${field}`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) fail("PROVIDER_EVIDENCE_REVOKED", `${label} must be an object`);
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("PROVIDER_EVIDENCE_REVOKED", `${label} must be a non-empty string without control characters`);
  }
  return value;
}

function requireDigest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("PROVIDER_EVIDENCE_REVOKED", `${label} must be sha256:<64 lowercase hex>`);
  return value as Sha256Digest;
}

function requireTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    fail("PROVIDER_EVIDENCE_REVOKED", `${label} must be a UTC RFC 3339 timestamp`);
  }
  return value;
}

function requireInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail("PROVIDER_EVIDENCE_REVOKED", `${label} must be an integer >= ${minimum}`);
  return value as number;
}

function validateExtensions(value: unknown, label: string): void {
  if (value === undefined) return;
  const extensions = requireRecord(value, label);
  for (const [namespace, extension] of Object.entries(extensions)) {
    if (!EXTENSION_NAMESPACE.test(namespace) || !isRecord(extension)) {
      fail("PROVIDER_EVIDENCE_REVOKED", `${label}.${namespace} must be a namespaced JSON object`);
    }
  }
}

function validateScope(value: unknown, label: string): void {
  const scope = requireRecord(value, label);
  exact(scope, ["project_id", "module_id", "unit_id", "stage"], label);
  requireText(scope.stage, `${label}.stage`);
  for (const field of ["project_id", "module_id", "unit_id"] as const) {
    if (scope[field] !== undefined) requireText(scope[field], `${label}.${field}`);
  }
}

function validateSourceRevision(value: unknown, label: string): void {
  const revision = requireRecord(value, label);
  exact(revision, ["commit", "worktree_digest", "repos"], label);
  requireText(revision.commit, `${label}.commit`);
  requireDigest(revision.worktree_digest, `${label}.worktree_digest`);
  if (revision.repos !== undefined) {
    const repos = requireRecord(revision.repos, `${label}.repos`);
    for (const [key, candidate] of Object.entries(repos)) {
      requireText(key, `${label}.repos key`);
      const repo = requireRecord(candidate, `${label}.repos.${key}`);
      exact(repo, ["commit", "worktree_digest"], `${label}.repos.${key}`);
      requireText(repo.commit, `${label}.repos.${key}.commit`);
      requireDigest(repo.worktree_digest, `${label}.repos.${key}.worktree_digest`);
    }
  }
}

function validateCheck(value: unknown, index: number): void {
  const label = `Provider Evidence checks[${index}]`;
  const check = requireRecord(value, label);
  exact(check, ["rule_id", "status", "severity", "message", "locations", "artifact_refs", "applicability_reason", "extensions"], label);
  requireText(check.rule_id, `${label}.rule_id`);
  if (check.status !== "passed" && check.status !== "failed" && check.status !== "not_applicable") {
    fail("PROVIDER_EVIDENCE_REVOKED", `${label}.status is invalid`);
  }
  if (!(["info", "warning", "error", "critical"] as const).includes(check.severity as never)) {
    fail("PROVIDER_EVIDENCE_REVOKED", `${label}.severity is invalid`);
  }
  requireText(check.message, `${label}.message`);
  if (check.status === "not_applicable") requireText(check.applicability_reason, `${label}.applicability_reason`);
  else if (check.applicability_reason !== undefined) fail("PROVIDER_EVIDENCE_REVOKED", `${label}.applicability_reason is only valid for not_applicable`);
  if (check.locations !== undefined) {
    if (!Array.isArray(check.locations)) fail("PROVIDER_EVIDENCE_REVOKED", `${label}.locations must be an array`);
    check.locations.forEach((candidate, locationIndex) => {
      const location = requireRecord(candidate, `${label}.locations[${locationIndex}]`);
      exact(location, ["path", "line", "column"], `${label}.locations[${locationIndex}]`);
      requireText(location.path, `${label}.locations[${locationIndex}].path`);
      if (location.line !== undefined) requireInteger(location.line, `${label}.locations[${locationIndex}].line`, 1);
      if (location.column !== undefined) requireInteger(location.column, `${label}.locations[${locationIndex}].column`, 1);
    });
  }
  if (check.artifact_refs !== undefined) {
    if (!Array.isArray(check.artifact_refs)) fail("PROVIDER_EVIDENCE_REVOKED", `${label}.artifact_refs must be an array`);
    check.artifact_refs.forEach((candidate, artifactIndex) => requireText(candidate, `${label}.artifact_refs[${artifactIndex}]`));
  }
  validateExtensions(check.extensions, `${label}.extensions`);
}

function validateDiagnostic(value: unknown, index: number): void {
  const label = `Provider Evidence diagnostics[${index}]`;
  const diagnostic = requireRecord(value, label);
  exact(diagnostic, ["code", "message", "details"], label);
  const code = requireText(diagnostic.code, `${label}.code`);
  if (!P0_PROVIDER_DIAGNOSTICS.some((entry) => entry.code === code)) fail("PROVIDER_EVIDENCE_REVOKED", `${label}.code is unknown`);
  requireText(diagnostic.message, `${label}.message`);
  if (diagnostic.details !== undefined && !isRecord(diagnostic.details)) fail("PROVIDER_EVIDENCE_REVOKED", `${label}.details must be a JSON object`);
}

/** A small synchronous signing adapter; a deployment can replace the local HMAC implementation. */
export interface ProviderArtifactSigner {
  readonly algorithm: string;
  readonly keyId: string;
  sign(payload: string): string;
  verify(payload: string, signature: { readonly algorithm: string; readonly key_id: string; readonly value: string }): boolean;
}

class LocalHmacProviderSigner implements ProviderArtifactSigner {
  readonly algorithm = "hmac-sha256";
  readonly keyId: string;

  constructor(private readonly secret: Buffer) {
    this.keyId = `local-${createHash("sha256").update(secret).digest("hex").slice(0, 32)}`;
  }

  sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload, "utf8").digest("base64url");
  }

  verify(payload: string, signature: { readonly algorithm: string; readonly key_id: string; readonly value: string }): boolean {
    if (signature.algorithm !== this.algorithm || signature.key_id !== this.keyId || typeof signature.value !== "string") return false;
    const expected = Buffer.from(this.sign(payload), "utf8");
    const actual = Buffer.from(signature.value, "utf8");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

function projectRoot(projectRoot: string): string {
  const root = realpathSync(resolve(projectRoot));
  if (!lstatSync(root).isDirectory()) fail("PROVIDER_CONFIG_INVALID", `project root must be a directory: ${root}`);
  return root;
}

function gitCommonDirectory(root: string): string {
  const result = runSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    env: process.env,
  });
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    fail("PROVIDER_CONFIG_INVALID", `Provider signing requires a Git repository: ${result.error?.message || result.stderr || result.stdout}`);
  }
  const candidate = resolve(root, result.stdout.trim());
  if (!existsSync(candidate) || !lstatSync(candidate).isDirectory() || lstatSync(candidate).isSymbolicLink()) {
    fail("PROVIDER_CONFIG_INVALID", `Git common directory is not a regular directory: ${candidate}`);
  }
  return realpathSync(candidate);
}

function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

/** Load the project-local Core signing key from the Git common directory, creating it only for a signer/issuer. */
export function localProviderArtifactSigner(project: string, create = false): ProviderArtifactSigner {
  const root = projectRoot(project);
  const common = gitCommonDirectory(root);
  const keyPath = resolve(common, SIGNING_KEY_RELATIVE_PATH);
  const keyParent = resolve(keyPath, "..");
  const containment = relative(common, keyPath);
  if (isAbsolute(containment) || containment === ".." || containment.startsWith(`..${sep}`)) {
    fail("PROVIDER_CONFIG_INVALID", "Provider signing key path escapes the Git common directory");
  }
  if (!existsSync(keyParent)) mkdirSync(keyParent, { recursive: true, mode: 0o700 });
  if (lstatSync(keyParent).isSymbolicLink() || !lstatSync(keyParent).isDirectory()) fail("PROVIDER_CONFIG_INVALID", "Provider signing key directory is unsafe");
  if (!existsSync(keyPath)) {
    if (!create) fail("PROVIDER_EVIDENCE_REVOKED", "Core Provider signing key is missing");
    const secret = randomBytes(32);
    const record = {
      version: 1,
      algorithm: "hmac-sha256",
      key_id: `local-${createHash("sha256").update(secret).digest("hex").slice(0, 32)}`,
      secret: secret.toString("base64url"),
    };
    atomicWrite(keyPath, `${JSON.stringify(record)}\n`);
  }
  const stat = lstatSync(keyPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) fail("PROVIDER_EVIDENCE_REVOKED", "Core Provider signing key is not a small regular file");
  let value: unknown;
  try { value = JSON.parse(readFileSync(keyPath, "utf8")) as unknown; } catch { fail("PROVIDER_EVIDENCE_REVOKED", "Core Provider signing key is invalid JSON"); }
  const record = requireRecord(value, "Core Provider signing key");
  exact(record, ["version", "algorithm", "key_id", "secret"], "Core Provider signing key");
  if (record.version !== 1 || record.algorithm !== "hmac-sha256") fail("PROVIDER_EVIDENCE_REVOKED", "Core Provider signing key version or algorithm is unsupported");
  const secret = typeof record.secret === "string" ? Buffer.from(record.secret, "base64url") : Buffer.alloc(0);
  if (secret.length !== 32) fail("PROVIDER_EVIDENCE_REVOKED", "Core Provider signing key secret is invalid");
  const signer = new LocalHmacProviderSigner(secret);
  if (record.key_id !== signer.keyId) fail("PROVIDER_EVIDENCE_REVOKED", "Core Provider signing key identifier is inconsistent");
  return signer;
}

export function providerEvidenceSigningPayload(evidence: Omit<ProviderEvidenceV1_1, "signature"> | ProviderEvidenceV1_1): string {
  const { signature: _signature, ...unsigned } = evidence as ProviderEvidenceV1_1;
  void _signature;
  return canonicalProviderJson(unsigned as unknown as JsonValue);
}

export function providerEvidenceDigest(evidence: ProviderEvidenceV1_1): Sha256Digest {
  return sha256ProviderDigest(evidence);
}

export function providerEvidenceInvalidationKey(input: {
  readonly request: ProviderRequestV1_1;
  readonly runnerPolicyDigest: Sha256Digest;
}): Sha256Digest {
  return sha256ProviderDigest({
    plan: input.request.plan,
    provider_instance: input.request.provider_instance,
    scope: input.request.scope,
    source_revision: input.request.source_revision,
    runner_policy_digest: input.runnerPolicyDigest,
  });
}

export interface CreateProviderEvidenceOptions {
  readonly signer: ProviderArtifactSigner;
  readonly now?: Date;
  readonly validitySeconds?: number;
  readonly runnerId?: string;
  readonly runnerVersion?: string;
  readonly additionalDiagnostics?: readonly ProviderDiagnostic[];
}

/** Create an immutable accepted envelope. The caller must have fully validated Result and reports first. */
export function createAcceptedProviderEvidence(
  request: ProviderRequestV1_1,
  result: ProviderResultV1_1,
  options: CreateProviderEvidenceOptions,
): ProviderEvidenceV1_1 {
  const now = options.now ?? new Date();
  const issuedAt = now.toISOString();
  const validitySeconds = options.validitySeconds ?? DEFAULT_VALIDITY_SECONDS;
  if (!Number.isSafeInteger(validitySeconds) || validitySeconds <= 0 || validitySeconds > DEFAULT_VALIDITY_SECONDS) {
    fail("PROVIDER_RESULT_INVALID", `Evidence validitySeconds must be an integer from 1 to ${DEFAULT_VALIDITY_SECONDS}`);
  }
  const expiresAt = new Date(now.getTime() + validitySeconds * 1000).toISOString();
  const runnerPolicyDigest = sha256ProviderDigest(RESTRICTED_RUNNER_POLICY_V1);
  const summary = result.checks.reduce((counts, check) => {
    counts[check.status]++;
    return counts;
  }, { passed: 0, failed: 0, not_applicable: 0 });
  const diagnostics: ProviderDiagnostic[] = [
    ...result.diagnostics.map((entry) => ({ code: entry.code, message: entry.message, ...(entry.details ? { details: entry.details } : {}) })),
    ...(options.additionalDiagnostics ?? []),
  ];
  const base = {
    schema: PROVIDER_SCHEMA.evidence,
    state: "accepted" as const,
    invocation: {
      invocation_id: request.invocation_id,
      request_digest: sha256ProviderDigest(request),
      result_digest: sha256ProviderDigest(result),
      result_status: result.status,
    },
    plan: request.plan,
    provider_instance: request.provider_instance,
    scope: request.scope,
    source_revision: request.source_revision,
    checks: result.checks,
    summary,
    diagnostics,
    validity: {
      issued_at: issuedAt,
      expires_at: expiresAt,
      invalidation_key: providerEvidenceInvalidationKey({ request, runnerPolicyDigest }),
    },
    runner: {
      id: options.runnerId ?? "aidlc-controlled-runner",
      version: options.runnerVersion ?? "1.0.0",
      sandbox: "restricted-v1" as const,
      policy_digest: runnerPolicyDigest,
    },
  };
  const evidenceId = `evidence-${sha256ProviderDigest(base).slice("sha256:".length, "sha256:".length + 32)}`;
  const unsigned: Omit<ProviderEvidenceV1_1, "signature"> = { evidence_id: evidenceId, ...base };
  return {
    ...unsigned,
    signature: {
      algorithm: options.signer.algorithm,
      key_id: options.signer.keyId,
      value: options.signer.sign(providerEvidenceSigningPayload(unsigned)),
    },
  };
}

/** Strictly parse the Core-owned envelope boundary; unknown fields fail closed. */
export function parseProviderEvidence(value: unknown): ProviderEvidenceV1_1 {
  const evidence = requireRecord(value, "Provider Evidence");
  exact(evidence, ["schema", "evidence_id", "state", "invocation", "plan", "provider_instance", "scope", "source_revision", "checks", "summary", "diagnostics", "validity", "runner", "signature", "extensions"], "Provider Evidence");
  if (evidence.schema !== PROVIDER_SCHEMA.evidence) fail("PROVIDER_SCHEMA_INCOMPATIBLE", `Provider Evidence schema must be ${PROVIDER_SCHEMA.evidence}`);
  if (typeof evidence.evidence_id !== "string" || !EVIDENCE_ID.test(evidence.evidence_id)) fail("PROVIDER_EVIDENCE_REVOKED", "Provider Evidence evidence_id is invalid");
  if (!(["accepted", "stale", "expired", "revoked"] as const).includes(evidence.state as never)) fail("PROVIDER_EVIDENCE_REVOKED", "Provider Evidence state is invalid");

  const invocation = requireRecord(evidence.invocation, "Provider Evidence invocation");
  exact(invocation, ["invocation_id", "request_digest", "result_digest", "result_status"], "Provider Evidence invocation");
  requireText(invocation.invocation_id, "Provider Evidence invocation.invocation_id");
  requireDigest(invocation.request_digest, "Provider Evidence invocation.request_digest");
  requireDigest(invocation.result_digest, "Provider Evidence invocation.result_digest");
  if (!(["passed", "failed", "deferred", "error", "cancelled"] as const).includes(invocation.result_status as never)) fail("PROVIDER_EVIDENCE_REVOKED", "Provider Evidence invocation.result_status is invalid");

  const plan = requireRecord(evidence.plan, "Provider Evidence plan");
  exact(plan, ["plan_id", "plan_digest", "node_id"], "Provider Evidence plan");
  requireText(plan.plan_id, "Provider Evidence plan.plan_id");
  requireDigest(plan.plan_digest, "Provider Evidence plan.plan_digest");
  requireText(plan.node_id, "Provider Evidence plan.node_id");

  const provider = requireRecord(evidence.provider_instance, "Provider Evidence provider_instance");
  exact(provider, ["instance_id", "provider_id", "project_lock_digest", "commit_oid", "tree_oid", "manifest_digest", "config_digest"], "Provider Evidence provider_instance");
  for (const field of ["instance_id", "provider_id", "commit_oid", "tree_oid"] as const) requireText(provider[field], `Provider Evidence provider_instance.${field}`);
  for (const field of ["project_lock_digest", "manifest_digest", "config_digest"] as const) requireDigest(provider[field], `Provider Evidence provider_instance.${field}`);

  validateScope(evidence.scope, "Provider Evidence scope");
  validateSourceRevision(evidence.source_revision, "Provider Evidence source_revision");
  if (!Array.isArray(evidence.checks)) fail("PROVIDER_EVIDENCE_REVOKED", "Provider Evidence checks must be an array");
  evidence.checks.forEach(validateCheck);
  if (new Set(evidence.checks.map((check) => isRecord(check) ? check.rule_id : undefined)).size !== evidence.checks.length) fail("PROVIDER_EVIDENCE_REVOKED", "Provider Evidence checks contain duplicate rule_id values");

  const summary = requireRecord(evidence.summary, "Provider Evidence summary");
  exact(summary, ["passed", "failed", "not_applicable"], "Provider Evidence summary");
  const expectedSummary = { passed: 0, failed: 0, not_applicable: 0 };
  for (const check of evidence.checks as unknown as ProviderResultCheck[]) expectedSummary[check.status]++;
  for (const status of ["passed", "failed", "not_applicable"] as const) {
    requireInteger(summary[status], `Provider Evidence summary.${status}`);
    if (summary[status] !== expectedSummary[status]) fail("PROVIDER_EVIDENCE_REVOKED", `Provider Evidence summary.${status} was not recomputed by Runner`);
  }

  if (!Array.isArray(evidence.diagnostics)) fail("PROVIDER_EVIDENCE_REVOKED", "Provider Evidence diagnostics must be an array");
  evidence.diagnostics.forEach(validateDiagnostic);
  const validity = requireRecord(evidence.validity, "Provider Evidence validity");
  exact(validity, ["issued_at", "expires_at", "invalidation_key"], "Provider Evidence validity");
  const issuedAt = requireTimestamp(validity.issued_at, "Provider Evidence validity.issued_at");
  const expiresAt = requireTimestamp(validity.expires_at, "Provider Evidence validity.expires_at");
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) fail("PROVIDER_EVIDENCE_REVOKED", "Provider Evidence expiry must be after issue time");
  requireDigest(validity.invalidation_key, "Provider Evidence validity.invalidation_key");

  const runner = requireRecord(evidence.runner, "Provider Evidence runner");
  exact(runner, ["id", "version", "sandbox", "policy_digest"], "Provider Evidence runner");
  requireText(runner.id, "Provider Evidence runner.id");
  requireText(runner.version, "Provider Evidence runner.version");
  if (runner.sandbox !== "restricted-v1") fail("PROVIDER_EVIDENCE_REVOKED", "Provider Evidence runner.sandbox must be restricted-v1");
  requireDigest(runner.policy_digest, "Provider Evidence runner.policy_digest");

  const signature = requireRecord(evidence.signature, "Provider Evidence signature");
  exact(signature, ["algorithm", "key_id", "value"], "Provider Evidence signature");
  for (const field of ["algorithm", "key_id", "value"] as const) requireText(signature[field], `Provider Evidence signature.${field}`);
  validateExtensions(evidence.extensions, "Provider Evidence extensions");
  return evidence as unknown as ProviderEvidenceV1_1;
}

export function verifyProviderEvidenceSignature(evidence: ProviderEvidenceV1_1, signer: ProviderArtifactSigner): void {
  if (!signer.verify(providerEvidenceSigningPayload(evidence), evidence.signature)) {
    fail("PROVIDER_EVIDENCE_REVOKED", `Provider Evidence ${evidence.evidence_id} signature is invalid or not issued by this Core`);
  }
}

export interface ProviderEvidenceExpectation {
  readonly plan?: { readonly plan_id: string; readonly plan_digest: Sha256Digest; readonly node_id?: string };
  readonly projectLockDigest?: Sha256Digest;
  readonly scope?: ProviderScope;
  readonly sourceRevision?: ProviderSourceRevision;
  readonly now?: Date;
  readonly revokedEvidenceIds?: ReadonlySet<string>;
  readonly revokedCommitOids?: ReadonlySet<string>;
}

export interface ProviderEvidenceAssessment {
  readonly evidence: ProviderEvidenceV1_1;
  readonly digest: Sha256Digest;
  readonly state: EvidenceStatus;
  readonly diagnostic?: Extract<ProviderDiagnosticCode, "PROVIDER_EVIDENCE_STALE" | "PROVIDER_EVIDENCE_EXPIRED" | "PROVIDER_EVIDENCE_REVOKED">;
  readonly reason?: string;
}

/** Verify signature and calculate the effective validity state without mutating historical Evidence. */
export function assessProviderEvidence(
  candidate: unknown,
  signer: ProviderArtifactSigner,
  expectation: ProviderEvidenceExpectation = {},
): ProviderEvidenceAssessment {
  const evidence = parseProviderEvidence(candidate);
  verifyProviderEvidenceSignature(evidence, signer);
  const digest = providerEvidenceDigest(evidence);
  const revoked = evidence.state === "revoked"
    || expectation.revokedEvidenceIds?.has(evidence.evidence_id)
    || expectation.revokedCommitOids?.has(evidence.provider_instance.commit_oid);
  if (revoked) return { evidence, digest, state: "revoked", diagnostic: "PROVIDER_EVIDENCE_REVOKED", reason: "Evidence or its locked Provider commit is revoked" };
  const now = (expectation.now ?? new Date()).getTime();
  if (evidence.state === "expired" || Date.parse(evidence.validity.expires_at) <= now) {
    return { evidence, digest, state: "expired", diagnostic: "PROVIDER_EVIDENCE_EXPIRED", reason: `Evidence expired at ${evidence.validity.expires_at}` };
  }
  const staleReasons: string[] = [];
  if (evidence.state === "stale") staleReasons.push("stored state is stale");
  if (expectation.plan) {
    if (evidence.plan.plan_id !== expectation.plan.plan_id) staleReasons.push("plan_id changed");
    if (evidence.plan.plan_digest !== expectation.plan.plan_digest) staleReasons.push("plan_digest changed");
    if (expectation.plan.node_id && evidence.plan.node_id !== expectation.plan.node_id) staleReasons.push("plan node changed");
  }
  if (expectation.projectLockDigest && evidence.provider_instance.project_lock_digest !== expectation.projectLockDigest) staleReasons.push("project lock changed");
  if (expectation.scope && canonicalProviderJson(evidence.scope) !== canonicalProviderJson(expectation.scope)) staleReasons.push("scope changed");
  if (expectation.sourceRevision && canonicalProviderJson(evidence.source_revision) !== canonicalProviderJson(expectation.sourceRevision)) staleReasons.push("source revision changed");
  const expectedInvalidationKey = sha256ProviderDigest({
    plan: evidence.plan,
    provider_instance: evidence.provider_instance,
    scope: evidence.scope,
    source_revision: evidence.source_revision,
    runner_policy_digest: evidence.runner.policy_digest,
  });
  if (evidence.validity.invalidation_key !== expectedInvalidationKey) staleReasons.push("validity key mismatch");
  if (evidence.runner.policy_digest !== sha256ProviderDigest(RESTRICTED_RUNNER_POLICY_V1)) staleReasons.push("Runner policy changed");
  if (staleReasons.length > 0) {
    return { evidence, digest, state: "stale", diagnostic: "PROVIDER_EVIDENCE_STALE", reason: staleReasons.join("; ") };
  }
  if (evidence.state !== "accepted") return { evidence, digest, state: evidence.state };
  return { evidence, digest, state: "accepted" };
}

/** Storage adapter for immutable accepted Evidence. */
export interface ProviderEvidenceStore {
  put(evidence: ProviderEvidenceV1_1): string;
  get(reference: string): ProviderEvidenceV1_1;
}

export class LocalProviderEvidenceStore implements ProviderEvidenceStore {
  private readonly root: string;
  private readonly directory: string;

  constructor(project: string) {
    this.root = projectRoot(project);
    this.directory = resolve(this.root, PROVIDER_EVIDENCE_ROOT);
    const rel = relative(this.root, this.directory);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("PROVIDER_PERMISSION_DENIED", "Provider Evidence store escapes project root");
    const aidlc = resolve(this.root, ".aidlc");
    if (!existsSync(aidlc)) mkdirSync(aidlc, { mode: 0o700 });
    if (!lstatSync(aidlc).isDirectory() || lstatSync(aidlc).isSymbolicLink()) fail("PROVIDER_PERMISSION_DENIED", ".aidlc must be a regular directory");
    if (!existsSync(this.directory)) mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(this.directory).isDirectory() || lstatSync(this.directory).isSymbolicLink()) fail("PROVIDER_PERMISSION_DENIED", "Provider Evidence store must be a regular directory");
  }

  put(evidence: ProviderEvidenceV1_1): string {
    const parsed = parseProviderEvidence(evidence);
    if (parsed.state !== "accepted") fail("PROVIDER_PERMISSION_DENIED", "Only an accepted Runner-issued Evidence can be published");
    const path = resolve(this.directory, `${parsed.evidence_id}.json`);
    const content = `${canonicalProviderJson(parsed as unknown as JsonValue)}\n`;
    if (existsSync(path)) {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || readFileSync(path, "utf8") !== content) {
        fail("PROVIDER_EVIDENCE_REVOKED", `immutable Evidence id ${parsed.evidence_id} already exists with different content`);
      }
    } else {
      atomicWrite(path, content);
    }
    return relative(this.root, path).replace(/\\/g, "/");
  }

  get(reference: string): ProviderEvidenceV1_1 {
    const normalized = reference.trim().replace(/\\/g, "/");
    let path: string;
    if (EVIDENCE_ID.test(normalized)) path = resolve(this.directory, `${normalized}.json`);
    else {
      if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.includes("\0")) fail("PROVIDER_PERMISSION_DENIED", "Evidence reference must be an id or project-relative store path");
      path = resolve(this.root, normalized);
    }
    const rel = relative(this.directory, path);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("PROVIDER_PERMISSION_DENIED", "Evidence reference escapes the Core Evidence store");
    if (!existsSync(path)) fail("PROVIDER_GATE_EVIDENCE_MISSING", `Provider Evidence does not exist: ${reference}`);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARTIFACT_BYTES) fail("PROVIDER_EVIDENCE_REVOKED", `Provider Evidence is not a small regular file: ${reference}`);
    let value: unknown;
    try { value = JSON.parse(readFileSync(path, "utf8")) as unknown; } catch { fail("PROVIDER_EVIDENCE_REVOKED", `Provider Evidence is invalid JSON: ${reference}`); }
    return parseProviderEvidence(value);
  }
}
