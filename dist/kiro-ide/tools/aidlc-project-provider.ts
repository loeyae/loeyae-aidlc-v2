import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  PROJECT_PROVIDER_CONFIG_VERSION,
  PROVIDER_SCHEMA,
  type JsonObject,
  type JsonValue,
  type ProjectProviderIntent,
  type ProjectProviderLockEntry,
  type ProjectProvidersLockV1,
  type ProjectProvidersV1,
  type ProviderScope,
  type Sha256Digest,
  isPortableProviderPath,
} from "./aidlc-provider-types";
import { appendAuditEvent, GLOBAL_WORKFLOW, lightStatePath } from "./aidlc-light-state";

export const PROJECT_PROVIDERS_PATH = ".aidlc/providers.yaml";
export const PROJECT_PROVIDERS_LOCK_PATH = ".aidlc/providers.lock.yaml";
export const PROJECT_PROVIDER_AUDIT_PATH = ".aidlc/providers.audit.md";
export const PROJECT_PROVIDER_HISTORY_PATH = ".aidlc/providers.lock.history";
export const PROJECT_PROVIDER_INVALIDATIONS_PATH = ".aidlc/provider-invalidations";

const PROVIDER_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const EXTENSION_NAMESPACE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const LOCK_WAIT_MS = 3_000;
const LOCK_STALE_MS = 30_000;
const MAX_AUDIT_VALUE = 2_000;
const MAX_INVALIDATION_SCAN_BYTES = 8 * 1024 * 1024;

export type ProviderConfigurationDiagnostic =
  | "PROVIDER_CONFIG_INVALID"
  | "PROVIDER_LOCK_MISSING"
  | "PROVIDER_LOCK_MISMATCH"
  | "PROVIDER_SOURCE_DISALLOWED"
  | "PROVIDER_COMMIT_UNTRUSTED"
  | "PROVIDER_COMMIT_REVOKED"
  | "PROVIDER_SOURCE_UNAVAILABLE"
  | "PROVIDER_CAPABILITY_MISSING"
  | "PROVIDER_PLAN_STALE"
  | "PROVIDER_EVIDENCE_STALE";

export class ProviderConfigurationError extends Error {
  readonly diagnostic: ProviderConfigurationDiagnostic;

  constructor(diagnostic: ProviderConfigurationDiagnostic, message: string) {
    super(`${diagnostic}: ${message}`);
    this.name = "ProviderConfigurationError";
    this.diagnostic = diagnostic;
  }
}

export interface ProjectProviderState {
  readonly config: ProjectProvidersV1;
  readonly lock: ProjectProvidersLockV1;
  readonly config_path: string;
  readonly lock_path: string;
  readonly persisted: boolean;
}

export interface ProviderInvalidationRecord {
  readonly schema: "aidlc.provider-invalidation/v1";
  readonly invalidation_id: string;
  readonly instance_id: string;
  readonly action: "add" | "update" | "enable" | "disable" | "remove";
  readonly reason: string;
  readonly old_lock_digest: Sha256Digest | null;
  readonly new_lock_digest: Sha256Digest;
  readonly invalidated_at: string;
  readonly state: "stale";
  readonly affected_artifacts: readonly string[];
}

function fail(diagnostic: ProviderConfigurationDiagnostic, message: string): never {
  throw new ProviderConfigurationError(diagnostic, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) fail("PROVIDER_CONFIG_INVALID", `${field} has unknown field ${key}`);
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail("PROVIDER_CONFIG_INVALID", `${field} must be a non-empty string`);
  if (/[\u0000-\u001f\u007f]/.test(value)) fail("PROVIDER_CONFIG_INVALID", `${field} cannot contain control characters`);
  return value.trim();
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field);
  if (!PROVIDER_ID.test(result)) fail("PROVIDER_CONFIG_INVALID", `${field} must match ${PROVIDER_ID.source}`);
  return result;
}

function stringList(value: unknown, field: string, options: { allowStar?: boolean; allowEmpty?: boolean } = {}): string[] {
  if (!Array.isArray(value)) fail("PROVIDER_CONFIG_INVALID", `${field} must be an array`);
  if (!options.allowEmpty && value.length === 0) fail("PROVIDER_CONFIG_INVALID", `${field} must not be empty`);
  const result = value.map((item, index) => {
    const parsed = text(item, `${field}[${index}]`);
    if (parsed === "*" && options.allowStar) return parsed;
    if (!PROVIDER_ID.test(parsed)) fail("PROVIDER_CONFIG_INVALID", `${field}[${index}] must be a provider identifier${options.allowStar ? " or *" : ""}`);
    return parsed;
  });
  if (new Set(result).size !== result.length) fail("PROVIDER_CONFIG_INVALID", `${field} contains duplicates`);
  return result;
}

function extensions(value: unknown, field: string): Record<string, JsonObject> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail("PROVIDER_CONFIG_INVALID", `${field} must be an object`);
  const result: Record<string, JsonObject> = {};
  for (const [namespace, candidate] of Object.entries(value)) {
    if (!EXTENSION_NAMESPACE.test(namespace)) fail("PROVIDER_CONFIG_INVALID", `${field} namespace ${namespace} is invalid`);
    result[namespace] = jsonObject(candidate, `${field}.${namespace}`);
  }
  return result;
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("PROVIDER_CONFIG_INVALID", `${field} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => jsonValue(entry, `${field}[${index}]`));
  if (isRecord(value)) {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!key || /[\u0000-\u001f\u007f]/.test(key)) fail("PROVIDER_CONFIG_INVALID", `${field} contains an invalid object key`);
      result[key] = jsonValue(entry, `${field}.${key}`);
    }
    return result as JsonObject;
  }
  fail("PROVIDER_CONFIG_INVALID", `${field} must contain only JSON values`);
}

function jsonObject(value: unknown, field: string): JsonObject {
  if (!isRecord(value)) fail("PROVIDER_CONFIG_INVALID", `${field} must be an object`);
  return jsonValue(value, field) as JsonObject;
}

function digest(value: unknown, field: string): Sha256Digest {
  const result = text(value, field);
  if (!DIGEST.test(result)) fail("PROVIDER_CONFIG_INVALID", `${field} must be sha256:<64 lowercase hex>`);
  return result as Sha256Digest;
}

function portablePath(value: unknown, field: string): string {
  const result = text(value, field);
  if (!isPortableProviderPath(result) || result.includes(":")) fail("PROVIDER_CONFIG_INVALID", `${field} must be a portable relative path`);
  return result;
}

function gitSource(value: unknown, field: string): string {
  const source = text(value, field);
  const scp = !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(source) && /^(?:[A-Za-z0-9._-]+@)?[^:/\\\s]+:[^\s]+$/.test(source);
  if (scp) return source;
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    fail("PROVIDER_SOURCE_DISALLOWED", `${field} must be an https, ssh, or canonical file URL`);
  }
  if (url.search || url.hash) fail("PROVIDER_SOURCE_DISALLOWED", `${field} cannot contain query parameters or fragments`);
  if (url.protocol === "https:") {
    if (url.username || url.password) fail("PROVIDER_SOURCE_DISALLOWED", `${field} cannot embed credentials`);
  } else if (url.protocol === "ssh:") {
    if (url.password) fail("PROVIDER_SOURCE_DISALLOWED", `${field} cannot embed an SSH password`);
  } else if (url.protocol === "file:") {
    if (url.username || url.password || url.host) fail("PROVIDER_SOURCE_DISALLOWED", `${field} file fixture must be local and credential-free`);
  } else {
    fail("PROVIDER_SOURCE_DISALLOWED", `${field} protocol ${url.protocol || "unknown"} is not allowed`);
  }
  return source;
}

function gitRef(value: unknown, field: string): string {
  const ref = text(value, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(ref) || ref.includes("..") || ref.includes("//") || ref.includes("@{")
    || ref.endsWith("/") || ref.endsWith(".") || ref.split("/").some((segment) => segment === "." || segment === ".." || segment.endsWith(".lock"))) {
    fail("PROVIDER_CONFIG_INVALID", `${field} is not a safe Git ref`);
  }
  return ref;
}

function parseIntent(value: unknown, index: number): ProjectProviderIntent {
  const field = `providers[${index}]`;
  if (!isRecord(value)) fail("PROVIDER_CONFIG_INVALID", `${field} must be an object`);
  exact(value, ["instance_id", "id", "source", "enabled", "config", "bindings", "trust", "extensions"], field);
  if (!isRecord(value.source)) fail("PROVIDER_CONFIG_INVALID", `${field}.source must be an object`);
  exact(value.source, ["git", "ref", "subdir"], `${field}.source`);
  const source = {
    git: gitSource(value.source.git, `${field}.source.git`),
    ref: gitRef(value.source.ref, `${field}.source.ref`),
    ...(value.source.subdir === undefined || value.source.subdir === null || value.source.subdir === ""
      ? {}
      : { subdir: portablePath(value.source.subdir, `${field}.source.subdir`) }),
  };
  if (typeof value.enabled !== "boolean") fail("PROVIDER_CONFIG_INVALID", `${field}.enabled must be a boolean`);
  if (!Array.isArray(value.bindings)) fail("PROVIDER_CONFIG_INVALID", `${field}.bindings must be an array`);
  const bindings = value.bindings.map((candidate, bindingIndex) => {
    const bindingField = `${field}.bindings[${bindingIndex}]`;
    if (!isRecord(candidate)) fail("PROVIDER_CONFIG_INVALID", `${bindingField} must be an object`);
    exact(candidate, ["modules", "units", "stages", "capabilities"], bindingField);
    return {
      modules: stringList(candidate.modules, `${bindingField}.modules`, { allowStar: true }),
      ...(candidate.units === undefined ? {} : { units: stringList(candidate.units, `${bindingField}.units`, { allowStar: true }) }),
      stages: stringList(candidate.stages, `${bindingField}.stages`, { allowStar: true }),
      capabilities: stringList(candidate.capabilities, `${bindingField}.capabilities`),
    };
  });
  if (!isRecord(value.trust)) fail("PROVIDER_CONFIG_INVALID", `${field}.trust must be an object`);
  exact(value.trust, ["mode", "required_for_protected_gates"], `${field}.trust`);
  const mode = text(value.trust.mode, `${field}.trust.mode`);
  if (!["untrusted-development", "signed-commit-or-tag", "allowlisted-commit"].includes(mode)) {
    fail("PROVIDER_CONFIG_INVALID", `${field}.trust.mode is invalid`);
  }
  if (typeof value.trust.required_for_protected_gates !== "boolean") {
    fail("PROVIDER_CONFIG_INVALID", `${field}.trust.required_for_protected_gates must be a boolean`);
  }
  return {
    instance_id: identifier(value.instance_id, `${field}.instance_id`),
    id: identifier(value.id, `${field}.id`),
    source,
    enabled: value.enabled,
    config: jsonObject(value.config, `${field}.config`),
    bindings,
    trust: {
      mode: mode as ProjectProviderIntent["trust"]["mode"],
      required_for_protected_gates: value.trust.required_for_protected_gates,
    },
    ...(extensions(value.extensions, `${field}.extensions`) ? { extensions: extensions(value.extensions, `${field}.extensions`)! } : {}),
  };
}

export function validateProjectProviders(value: unknown): ProjectProvidersV1 {
  if (!isRecord(value)) fail("PROVIDER_CONFIG_INVALID", "providers.yaml must contain an object");
  exact(value, ["apiVersion", "specVersion", "providers", "extensions"], "providers.yaml");
  if (value.apiVersion !== PROVIDER_SCHEMA.projectProviders) {
    fail("PROVIDER_CONFIG_INVALID", `providers.yaml apiVersion must be ${PROVIDER_SCHEMA.projectProviders}`);
  }
  if (value.specVersion !== PROJECT_PROVIDER_CONFIG_VERSION) {
    fail("PROVIDER_CONFIG_INVALID", `providers.yaml specVersion must be ${PROJECT_PROVIDER_CONFIG_VERSION}`);
  }
  if (!Array.isArray(value.providers)) fail("PROVIDER_CONFIG_INVALID", "providers.yaml providers must be an array");
  const providers = value.providers.map(parseIntent).sort((left, right) => left.instance_id.localeCompare(right.instance_id));
  if (new Set(providers.map((provider) => provider.instance_id)).size !== providers.length) {
    fail("PROVIDER_CONFIG_INVALID", "providers.yaml instance_id values must be unique");
  }
  return {
    apiVersion: PROVIDER_SCHEMA.projectProviders,
    specVersion: PROJECT_PROVIDER_CONFIG_VERSION,
    providers,
    ...(extensions(value.extensions, "providers.yaml.extensions") ? { extensions: extensions(value.extensions, "providers.yaml.extensions")! } : {}),
  };
}

function parseLockEntry(value: unknown, index: number): ProjectProviderLockEntry {
  const field = `lock.providers[${index}]`;
  if (!isRecord(value)) fail("PROVIDER_CONFIG_INVALID", `${field} must be an object`);
  exact(value, ["instance_id", "id", "source", "manifest", "artifacts", "project_config_digest", "trust", "extensions"], field);
  if (!isRecord(value.source)) fail("PROVIDER_CONFIG_INVALID", `${field}.source must be an object`);
  exact(value.source, ["git", "requested_ref", "commit_oid", "object_format", "tree_oid", "subdir"], `${field}.source`);
  const objectFormat = text(value.source.object_format, `${field}.source.object_format`);
  if (objectFormat !== "sha1" && objectFormat !== "sha256") fail("PROVIDER_CONFIG_INVALID", `${field}.source.object_format must be sha1 or sha256`);
  const oidPattern = objectFormat === "sha1" ? SHA1 : SHA256;
  const commitOid = text(value.source.commit_oid, `${field}.source.commit_oid`);
  const treeOid = text(value.source.tree_oid, `${field}.source.tree_oid`);
  if (!oidPattern.test(commitOid)) fail("PROVIDER_CONFIG_INVALID", `${field}.source.commit_oid is not a ${objectFormat} object ID`);
  if (!oidPattern.test(treeOid)) fail("PROVIDER_CONFIG_INVALID", `${field}.source.tree_oid is not a ${objectFormat} object ID`);
  if (!(value.source.subdir === null || typeof value.source.subdir === "string")) {
    fail("PROVIDER_CONFIG_INVALID", `${field}.source.subdir must be null or a portable relative path`);
  }
  const subdir = value.source.subdir === null ? null : portablePath(value.source.subdir, `${field}.source.subdir`);

  if (!isRecord(value.manifest)) fail("PROVIDER_CONFIG_INVALID", `${field}.manifest must be an object`);
  exact(value.manifest, ["version", "digest", "rulesets"], `${field}.manifest`);
  if (!Array.isArray(value.manifest.rulesets) || value.manifest.rulesets.length === 0) {
    fail("PROVIDER_CONFIG_INVALID", `${field}.manifest.rulesets must be a non-empty array`);
  }
  const rulesets = value.manifest.rulesets.map((candidate, rulesetIndex) => {
    const rulesetField = `${field}.manifest.rulesets[${rulesetIndex}]`;
    if (!isRecord(candidate)) fail("PROVIDER_CONFIG_INVALID", `${rulesetField} must be an object`);
    exact(candidate, ["id", "version", "digest"], rulesetField);
    return {
      id: identifier(candidate.id, `${rulesetField}.id`),
      version: text(candidate.version, `${rulesetField}.version`),
      digest: digest(candidate.digest, `${rulesetField}.digest`),
    };
  });
  if (new Set(rulesets.map((ruleset) => ruleset.id)).size !== rulesets.length) fail("PROVIDER_CONFIG_INVALID", `${field}.manifest.rulesets contains duplicate ids`);

  if (!isRecord(value.artifacts)) fail("PROVIDER_CONFIG_INVALID", `${field}.artifacts must be an object`);
  exact(value.artifacts, ["provider_lock_digest", "sbom_digest", "entrypoint_digests"], `${field}.artifacts`);
  if (!isRecord(value.artifacts.entrypoint_digests) || Object.keys(value.artifacts.entrypoint_digests).length === 0) {
    fail("PROVIDER_CONFIG_INVALID", `${field}.artifacts.entrypoint_digests must be a non-empty object`);
  }
  const entrypointDigests: Record<string, Sha256Digest> = {};
  for (const [entrypoint, candidate] of Object.entries(value.artifacts.entrypoint_digests)) {
    portablePath(entrypoint, `${field}.artifacts.entrypoint_digests key`);
    entrypointDigests[entrypoint] = digest(candidate, `${field}.artifacts.entrypoint_digests.${entrypoint}`);
  }

  if (!isRecord(value.trust)) fail("PROVIDER_CONFIG_INVALID", `${field}.trust must be an object`);
  exact(value.trust, ["status", "verification_digest"], `${field}.trust`);
  const trustStatus = text(value.trust.status, `${field}.trust.status`);
  if (!["untrusted", "verified", "revoked"].includes(trustStatus)) fail("PROVIDER_CONFIG_INVALID", `${field}.trust.status is invalid`);
  const verificationDigest = value.trust.verification_digest === undefined
    ? undefined
    : digest(value.trust.verification_digest, `${field}.trust.verification_digest`);
  if (trustStatus === "verified" && !verificationDigest) fail("PROVIDER_CONFIG_INVALID", `${field}.trust.verified requires verification_digest`);

  return {
    instance_id: identifier(value.instance_id, `${field}.instance_id`),
    id: identifier(value.id, `${field}.id`),
    source: {
      git: gitSource(value.source.git, `${field}.source.git`),
      requested_ref: gitRef(value.source.requested_ref, `${field}.source.requested_ref`),
      commit_oid: commitOid,
      object_format: objectFormat,
      tree_oid: treeOid,
      subdir,
    },
    manifest: {
      version: text(value.manifest.version, `${field}.manifest.version`),
      digest: digest(value.manifest.digest, `${field}.manifest.digest`),
      rulesets,
    },
    artifacts: {
      provider_lock_digest: digest(value.artifacts.provider_lock_digest, `${field}.artifacts.provider_lock_digest`),
      sbom_digest: digest(value.artifacts.sbom_digest, `${field}.artifacts.sbom_digest`),
      entrypoint_digests: entrypointDigests,
    },
    project_config_digest: digest(value.project_config_digest, `${field}.project_config_digest`),
    trust: {
      status: trustStatus as ProjectProviderLockEntry["trust"]["status"],
      ...(verificationDigest ? { verification_digest: verificationDigest } : {}),
    },
    ...(extensions(value.extensions, `${field}.extensions`) ? { extensions: extensions(value.extensions, `${field}.extensions`)! } : {}),
  };
}

export function canonicalProviderJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("PROVIDER_CONFIG_INVALID", "canonical JSON cannot contain a non-finite number");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalProviderJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalProviderJson(value[key])}`).join(",")}}`;
  }
  fail("PROVIDER_CONFIG_INVALID", `canonical JSON cannot contain ${typeof value}`);
}

export function sha256ProviderDigest(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256").update(canonicalProviderJson(value), "utf8").digest("hex")}` as Sha256Digest;
}

export function sha256FileDigest(value: Buffer | string): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as Sha256Digest;
}

export function projectProviderConfigDigest(intent: ProjectProviderIntent): Sha256Digest {
  return sha256ProviderDigest(intent);
}

export function projectProvidersLockDigest(value: Omit<ProjectProvidersLockV1, "lock_digest"> | ProjectProvidersLockV1): Sha256Digest {
  const { lock_digest: _ignored, ...projection } = value as ProjectProvidersLockV1;
  return sha256ProviderDigest(projection);
}

export function validateProjectProvidersLock(value: unknown): ProjectProvidersLockV1 {
  if (!isRecord(value)) fail("PROVIDER_CONFIG_INVALID", "providers.lock.yaml must contain an object");
  exact(value, ["apiVersion", "specVersion", "lock_digest", "providers", "extensions"], "providers.lock.yaml");
  if (value.apiVersion !== PROVIDER_SCHEMA.projectProvidersLock) {
    fail("PROVIDER_CONFIG_INVALID", `providers.lock.yaml apiVersion must be ${PROVIDER_SCHEMA.projectProvidersLock}`);
  }
  if (value.specVersion !== PROJECT_PROVIDER_CONFIG_VERSION) {
    fail("PROVIDER_CONFIG_INVALID", `providers.lock.yaml specVersion must be ${PROJECT_PROVIDER_CONFIG_VERSION}`);
  }
  if (!Array.isArray(value.providers)) fail("PROVIDER_CONFIG_INVALID", "providers.lock.yaml providers must be an array");
  const providers = value.providers.map(parseLockEntry).sort((left, right) => left.instance_id.localeCompare(right.instance_id));
  if (new Set(providers.map((provider) => provider.instance_id)).size !== providers.length) {
    fail("PROVIDER_CONFIG_INVALID", "providers.lock.yaml instance_id values must be unique");
  }
  const lock: ProjectProvidersLockV1 = {
    apiVersion: PROVIDER_SCHEMA.projectProvidersLock,
    specVersion: PROJECT_PROVIDER_CONFIG_VERSION,
    lock_digest: digest(value.lock_digest, "providers.lock.yaml.lock_digest"),
    providers,
    ...(extensions(value.extensions, "providers.lock.yaml.extensions") ? { extensions: extensions(value.extensions, "providers.lock.yaml.extensions")! } : {}),
  };
  const expected = projectProvidersLockDigest(lock);
  if (lock.lock_digest !== expected) fail("PROVIDER_LOCK_MISMATCH", `providers.lock.yaml lock_digest is ${lock.lock_digest}, expected ${expected}`);
  return lock;
}

export function createProjectProviders(providers: readonly ProjectProviderIntent[] = []): ProjectProvidersV1 {
  return validateProjectProviders({
    apiVersion: PROVIDER_SCHEMA.projectProviders,
    specVersion: PROJECT_PROVIDER_CONFIG_VERSION,
    providers,
  });
}

export function createProjectProvidersLock(config: ProjectProvidersV1, entries: readonly ProjectProviderLockEntry[] = []): ProjectProvidersLockV1 {
  const byInstance = new Map(config.providers.map((provider) => [provider.instance_id, provider]));
  const providers = entries.map((entry) => {
    const intent = byInstance.get(entry.instance_id);
    if (!intent) fail("PROVIDER_LOCK_MISMATCH", `lock contains instance ${entry.instance_id} that is not in providers.yaml`);
    return { ...entry, project_config_digest: projectProviderConfigDigest(intent) };
  }).sort((left, right) => left.instance_id.localeCompare(right.instance_id));
  const draft = {
    apiVersion: PROVIDER_SCHEMA.projectProvidersLock,
    specVersion: PROJECT_PROVIDER_CONFIG_VERSION,
    providers,
  } as const;
  return validateProjectProvidersLock({ ...draft, lock_digest: projectProvidersLockDigest(draft) });
}

export function assertProjectProvidersConsistent(config: ProjectProvidersV1, lock: ProjectProvidersLockV1): void {
  const configIds = config.providers.map((provider) => provider.instance_id).sort();
  const lockIds = lock.providers.map((provider) => provider.instance_id).sort();
  if (JSON.stringify(configIds) !== JSON.stringify(lockIds)) {
    const missing = configIds.filter((id) => !lockIds.includes(id));
    const orphaned = lockIds.filter((id) => !configIds.includes(id));
    if (missing.length > 0) fail("PROVIDER_LOCK_MISSING", `lock is missing provider instances: ${missing.join(", ")}`);
    fail("PROVIDER_LOCK_MISMATCH", `lock has instances absent from config: ${orphaned.join(", ")}`);
  }
  const locks = new Map(lock.providers.map((entry) => [entry.instance_id, entry]));
  for (const intent of config.providers) {
    const entry = locks.get(intent.instance_id)!;
    const expectedSubdir = intent.source.subdir ?? null;
    const mismatches: string[] = [];
    if (entry.id !== intent.id) mismatches.push("id");
    if (entry.source.git !== intent.source.git) mismatches.push("source.git");
    if (entry.source.requested_ref !== intent.source.ref) mismatches.push("source.ref");
    if (entry.source.subdir !== expectedSubdir) mismatches.push("source.subdir");
    if (entry.project_config_digest !== projectProviderConfigDigest(intent)) mismatches.push("project_config_digest");
    if (mismatches.length > 0) {
      fail("PROVIDER_LOCK_MISMATCH", `provider ${intent.instance_id} config/lock mismatch: ${mismatches.join(", ")}`);
    }
    if (entry.trust.status === "revoked") fail("PROVIDER_COMMIT_REVOKED", `provider ${intent.instance_id} lock is revoked`);
  }
}

function resolvedProjectRoot(projectRoot: string): string {
  const candidate = resolve(projectRoot);
  if (!existsSync(candidate)) fail("PROVIDER_CONFIG_INVALID", `project root does not exist: ${candidate}`);
  const stat = lstatSync(candidate);
  if (!stat.isDirectory()) fail("PROVIDER_CONFIG_INVALID", `project root must be a directory: ${candidate}`);
  return realpathSync(candidate);
}

function safeAidlcDirectory(projectRoot: string): string {
  const root = resolvedProjectRoot(projectRoot);
  const directory = resolve(root, ".aidlc");
  const rel = relative(root, directory);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("PROVIDER_CONFIG_INVALID", ".aidlc directory escapes project root");
  if (existsSync(directory)) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PROVIDER_CONFIG_INVALID", `.aidlc must be a regular non-symlink directory: ${directory}`);
  } else {
    mkdirSync(directory, { recursive: false, mode: 0o700 });
  }
  return directory;
}

function safeProviderSubdirectory(projectRoot: string, relativePath: string): string {
  const root = resolvedProjectRoot(projectRoot);
  safeAidlcDirectory(root);
  const segments = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments[0] !== ".aidlc" || segments.some((segment) => segment === "." || segment === "..")) {
    fail("PROVIDER_CONFIG_INVALID", `managed Provider directory must stay under .aidlc: ${relativePath}`);
  }
  let cursor = root;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    if (existsSync(cursor)) {
      const stat = lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PROVIDER_CONFIG_INVALID", `managed Provider path must be a regular non-symlink directory: ${cursor}`);
    } else {
      mkdirSync(cursor, { mode: 0o700 });
    }
  }
  return cursor;
}

export function parseProviderYaml(content: string, label = "YAML document"): unknown {
  try {
    const value = parseYaml(content, { maxAliasCount: 0, merge: false, schema: "core", uniqueKeys: true });
    return jsonValue(value, label);
  } catch (error) {
    fail("PROVIDER_CONFIG_INVALID", `${label} is invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function serializeProviderYaml(value: unknown): string {
  const checked = jsonValue(value, "YAML document");
  return stringifyYaml(checked, { lineWidth: 0 }).replace(/\s*$/, "\n");
}

function readYamlFile(path: string, label: string): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("PROVIDER_CONFIG_INVALID", `${label} must be a regular non-symlink file: ${path}`);
  return parseProviderYaml(readFileSync(path, "utf8"), label);
}

export function readProjectProviders(projectRoot = process.cwd(), allowMissing = true): ProjectProviderState {
  const root = resolvedProjectRoot(projectRoot);
  const aidlcDirectory = resolve(root, ".aidlc");
  if (existsSync(aidlcDirectory)) {
    const stat = lstatSync(aidlcDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PROVIDER_CONFIG_INVALID", `.aidlc must be a regular non-symlink directory: ${aidlcDirectory}`);
  }
  const configPath = resolve(root, PROJECT_PROVIDERS_PATH);
  const lockPath = resolve(root, PROJECT_PROVIDERS_LOCK_PATH);
  const hasConfig = existsSync(configPath);
  const hasLock = existsSync(lockPath);
  if (!hasConfig && !hasLock && allowMissing) {
    const config = createProjectProviders();
    return { config, lock: createProjectProvidersLock(config), config_path: configPath, lock_path: lockPath, persisted: false };
  }
  if (!hasConfig) fail("PROVIDER_CONFIG_INVALID", `${PROJECT_PROVIDERS_PATH} is missing while ${PROJECT_PROVIDERS_LOCK_PATH} exists`);
  if (!hasLock) fail("PROVIDER_LOCK_MISSING", `${PROJECT_PROVIDERS_LOCK_PATH} is missing`);
  const config = validateProjectProviders(readYamlFile(configPath, PROJECT_PROVIDERS_PATH));
  const lock = validateProjectProvidersLock(readYamlFile(lockPath, PROJECT_PROVIDERS_LOCK_PATH));
  assertProjectProvidersConsistent(config, lock);
  return { config, lock, config_path: configPath, lock_path: lockPath, persisted: true };
}

function acquireFileLock(directory: string): { path: string; descriptor: number } {
  const path = join(directory, ".providers.lock");
  const started = Date.now();
  while (true) {
    try {
      return { path, descriptor: openSync(path, "wx", 0o600) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(path);
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() - started > LOCK_WAIT_MS) fail("PROVIDER_CONFIG_INVALID", `timed out waiting for Provider configuration lock: ${path}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

function releaseFileLock(lock: { path: string; descriptor: number }): void {
  closeSync(lock.descriptor);
  if (existsSync(lock.path)) unlinkSync(lock.path);
}

export function writeProjectProviders(
  projectRoot: string,
  configValue: ProjectProvidersV1,
  lockValue: ProjectProvidersLockV1,
  options: { expectedLockDigest?: Sha256Digest | null } = {},
): ProjectProviderState {
  const root = resolvedProjectRoot(projectRoot);
  const config = validateProjectProviders(configValue);
  const lock = validateProjectProvidersLock(lockValue);
  assertProjectProvidersConsistent(config, lock);
  const directory = safeAidlcDirectory(root);
  const configPath = resolve(root, PROJECT_PROVIDERS_PATH);
  const lockPath = resolve(root, PROJECT_PROVIDERS_LOCK_PATH);
  const token = `${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const configTemp = `${configPath}.tmp-${token}`;
  const lockTemp = `${lockPath}.tmp-${token}`;
  const configBackup = `${configPath}.bak-${token}`;
  const lockBackup = `${lockPath}.bak-${token}`;
  const guard = acquireFileLock(directory);
  let configPublished = false;
  let lockPublished = false;
  try {
    if ("expectedLockDigest" in options) {
      const configExists = existsSync(configPath);
      const lockExists = existsSync(lockPath);
      if (options.expectedLockDigest === null) {
        if (configExists || lockExists) fail("PROVIDER_LOCK_MISMATCH", "Provider configuration changed concurrently before initial publication");
      } else {
        if (!configExists || !lockExists) fail("PROVIDER_LOCK_MISMATCH", "Provider configuration changed concurrently and is now incomplete");
        const current = readProjectProviders(root, false);
        if (current.lock.lock_digest !== options.expectedLockDigest) {
          fail("PROVIDER_LOCK_MISMATCH", `Provider configuration changed concurrently from ${options.expectedLockDigest} to ${current.lock.lock_digest}`);
        }
      }
    }
    writeFileSync(configTemp, serializeProviderYaml(config), { encoding: "utf8", flag: "wx", mode: 0o600 });
    writeFileSync(lockTemp, serializeProviderYaml(lock), { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (existsSync(configPath)) renameSync(configPath, configBackup);
    if (existsSync(lockPath)) renameSync(lockPath, lockBackup);
    renameSync(configTemp, configPath);
    configPublished = true;
    renameSync(lockTemp, lockPath);
    lockPublished = true;
    if (existsSync(configBackup)) rmSync(configBackup, { force: true });
    if (existsSync(lockBackup)) rmSync(lockBackup, { force: true });
  } catch (error) {
    if (configPublished && existsSync(configPath)) rmSync(configPath, { force: true });
    if (lockPublished && existsSync(lockPath)) rmSync(lockPath, { force: true });
    if (existsSync(configBackup) && !existsSync(configPath)) renameSync(configBackup, configPath);
    if (existsSync(lockBackup) && !existsSync(lockPath)) renameSync(lockBackup, lockPath);
    throw error;
  } finally {
    for (const path of [configTemp, lockTemp, configBackup, lockBackup]) {
      if (existsSync(path)) rmSync(path, { force: true });
    }
    releaseFileLock(guard);
  }
  return { config, lock, config_path: configPath, lock_path: lockPath, persisted: true };
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

export function archiveProjectProviderLock(
  projectRoot: string,
  projectLockDigest: Sha256Digest,
  entry: ProjectProviderLockEntry,
  action: "update" | "enable" | "disable" | "remove",
): string {
  identifier(entry.instance_id, "lock history instance_id");
  const root = resolvedProjectRoot(projectRoot);
  const historyDirectory = safeProviderSubdirectory(root, `${PROJECT_PROVIDER_HISTORY_PATH}/${entry.instance_id}`);
  const path = resolve(historyDirectory, `${projectLockDigest.slice("sha256:".length)}.yaml`);
  if (!existsSync(path)) {
    atomicWrite(path, serializeProviderYaml({
      apiVersion: "aidlc.project-provider-lock-history/v1",
      archived_at: new Date().toISOString(),
      action,
      project_lock_digest: projectLockDigest,
      provider: entry,
    }));
  }
  return relative(root, path).replace(/\\/g, "/");
}

function auditValue(value: unknown): string {
  const textValue = String(value ?? "-").replace(/[\r\n]+/g, " ").trim() || "-";
  return textValue.length <= MAX_AUDIT_VALUE ? textValue : `${textValue.slice(0, MAX_AUDIT_VALUE)}…`;
}

export function appendProviderLifecycleAudit(projectRoot: string, event: string, fields: Record<string, unknown>): void {
  const root = resolvedProjectRoot(projectRoot);
  safeAidlcDirectory(root);
  const auditPath = resolve(root, PROJECT_PROVIDER_AUDIT_PATH);
  if (existsSync(auditPath)) {
    const stat = lstatSync(auditPath);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("PROVIDER_CONFIG_INVALID", `${PROJECT_PROVIDER_AUDIT_PATH} must be a regular non-symlink file`);
  }
  const sanitized = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, auditValue(value)]));
  const lines = Object.entries(sanitized).map(([key, value]) => `- ${key}: ${value}`).join("\n");
  appendFileSync(auditPath, `## ${new Date().toISOString()}\n- Event: ${auditValue(event)}\n${lines}${lines ? "\n" : ""}\n`, "utf8");
  if (existsSync(lightStatePath(root, GLOBAL_WORKFLOW))) appendAuditEvent(root, GLOBAL_WORKFLOW, event, sanitized);
}

function walkJsonFiles(root: string, directory: string, output: string[]): void {
  if (!existsSync(directory)) return;
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(directory, entry.name);
    const itemStat = lstatSync(absolute);
    if (itemStat.isSymbolicLink()) continue;
    if (itemStat.isDirectory()) walkJsonFiles(root, absolute, output);
    else if (itemStat.isFile() && entry.name.endsWith(".json") && itemStat.size <= MAX_INVALIDATION_SCAN_BYTES) {
      output.push(relative(root, absolute).replace(/\\/g, "/"));
    }
  }
}

function containsString(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((entry) => containsString(entry, expected));
  if (isRecord(value)) return Object.values(value).some((entry) => containsString(entry, expected));
  return false;
}

export function providerArtifactsBoundToLock(projectRoot: string, lockDigest: Sha256Digest | null, _instanceId?: string): string[] {
  if (!lockDigest) return [];
  const root = resolvedProjectRoot(projectRoot);
  safeAidlcDirectory(root);
  const files: string[] = [];
  for (const candidate of [
    resolve(root, ".aidlc/provider-plans"),
    resolve(root, ".aidlc/evidence/providers"),
    resolve(root, ".aidlc/provider-gates"),
  ]) walkJsonFiles(root, candidate, files);
  return files.filter((path) => {
    try {
      const value = JSON.parse(readFileSync(resolve(root, path), "utf8")) as unknown;
      return containsString(value, lockDigest);
    } catch {
      return false;
    }
  }).sort();
}

export function recordProviderInvalidation(
  projectRoot: string,
  input: Omit<ProviderInvalidationRecord, "schema" | "invalidation_id" | "invalidated_at" | "state" | "affected_artifacts">,
): { readonly path: string; readonly record: ProviderInvalidationRecord } {
  const root = resolvedProjectRoot(projectRoot);
  const invalidationDirectory = safeProviderSubdirectory(root, PROJECT_PROVIDER_INVALIDATIONS_PATH);
  const invalidatedAt = new Date().toISOString();
  const invalidationId = `provider-invalidation-${invalidatedAt.replace(/[^0-9]/g, "").slice(0, 17)}-${randomBytes(4).toString("hex")}`;
  const record: ProviderInvalidationRecord = {
    schema: "aidlc.provider-invalidation/v1",
    invalidation_id: invalidationId,
    instance_id: identifier(input.instance_id, "invalidation.instance_id"),
    action: input.action,
    reason: text(input.reason, "invalidation.reason"),
    old_lock_digest: input.old_lock_digest,
    new_lock_digest: input.new_lock_digest,
    invalidated_at: invalidatedAt,
    state: "stale",
    affected_artifacts: providerArtifactsBoundToLock(root, input.old_lock_digest, input.instance_id),
  };
  const path = resolve(invalidationDirectory, `${invalidationId}.json`);
  atomicWrite(path, `${JSON.stringify(record, null, 2)}\n`);
  return { path: relative(root, path).replace(/\\/g, "/"), record };
}

function artifactLockDigest(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["project_lock_digest", "lock_digest"] as const) {
    if (typeof value[key] === "string" && DIGEST.test(value[key] as string)) return value[key] as string;
  }
  if (isRecord(value.plan)) {
    const nested = artifactLockDigest(value.plan);
    if (nested) return nested;
  }
  if (isRecord(value.provider_instance)) {
    const nested = artifactLockDigest(value.provider_instance);
    if (nested) return nested;
  }
  return undefined;
}

export function assertProviderArtifactCurrent(value: unknown, currentLockDigest: Sha256Digest): void {
  const bound = artifactLockDigest(value);
  if (!bound) fail("PROVIDER_PLAN_STALE", "Provider artifact does not bind project_lock_digest");
  if (bound !== currentLockDigest) fail("PROVIDER_EVIDENCE_STALE", `Provider artifact binds ${bound}, current lock is ${currentLockDigest}`);
}

function bindingMatches(intent: ProjectProviderIntent, capability: string, scope: ProviderScope): boolean {
  return intent.bindings.some((binding) => {
    const moduleMatches = binding.modules.includes("*") || (!!scope.module_id && binding.modules.includes(scope.module_id));
    const unitMatches = binding.units === undefined || binding.units.includes("*") || (!!scope.unit_id && binding.units.includes(scope.unit_id));
    const stageMatches = binding.stages.includes("*") || binding.stages.includes(scope.stage);
    return moduleMatches && unitMatches && stageMatches && binding.capabilities.includes(capability);
  });
}

export function requireEnabledProviderCapability(
  projectRoot: string,
  capability: string,
  scope: ProviderScope,
  options: { protectedGate?: boolean; verifySource?: boolean } = {},
): Array<{ readonly intent: ProjectProviderIntent; readonly lock: ProjectProviderLockEntry }> {
  identifier(capability, "required capability");
  const state = readProjectProviders(projectRoot, false);
  const matching = state.config.providers.filter((intent) => bindingMatches(intent, capability, scope));
  const enabled = matching.filter((intent) => intent.enabled);
  if (enabled.length === 0) {
    const disabled = matching.map((intent) => intent.instance_id);
    fail("PROVIDER_CAPABILITY_MISSING", disabled.length > 0
      ? `required capability ${capability} is provided only by disabled instances: ${disabled.join(", ")}`
      : `required capability ${capability} has no enabled Provider for stage ${scope.stage}`);
  }
  const locks = new Map(state.lock.providers.map((entry) => [entry.instance_id, entry]));
  return enabled.map((intent) => {
    const entry = locks.get(intent.instance_id);
    if (!entry) fail("PROVIDER_LOCK_MISSING", `required Provider ${intent.instance_id} has no lock entry`);
    if ((options.protectedGate || intent.trust.required_for_protected_gates) && entry.trust.status !== "verified") {
      fail("PROVIDER_COMMIT_UNTRUSTED", `required Provider ${intent.instance_id} is ${entry.trust.status}, but this capability requires verified trust`);
    }
    if (options.verifySource !== false) {
      const cache = resolve(resolvedProjectRoot(projectRoot), ".aidlc/provider-cache/git", `${createHash("sha256").update(entry.source.git, "utf8").digest("hex")}.git`);
      const objects = resolve(cache, "objects");
      if (!existsSync(cache) || !existsSync(objects)) fail("PROVIDER_SOURCE_UNAVAILABLE", `required Provider ${intent.instance_id} locked cache is missing`);
      for (const [path, label] of [[cache, "cache"], [objects, "object database"]] as const) {
        const stat = lstatSync(path);
        if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PROVIDER_SOURCE_UNAVAILABLE", `required Provider ${intent.instance_id} ${label} is not a regular directory`);
      }
    }
    return { intent, lock: entry };
  });
}
