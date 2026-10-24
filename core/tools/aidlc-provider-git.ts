import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SpawnSyncReturns } from "node:child_process";
import { runSync } from "./aidlc-spawn";
import { validateKnowledgePackage } from "./aidlc-provider-knowledge-contract.js";
import {
  parseProviderYaml,
  sha256FileDigest,
  sha256ProviderDigest,
  type ProviderConfigurationDiagnostic,
} from "./aidlc-project-provider";
import {
  PROVIDER_SCHEMA,
  RESTRICTED_RUNNER_PROFILE,
  type JsonObject,
  type ProjectProviderIntent,
  type ProjectProviderLockEntry,
  type Sha256Digest,
  isPortableProviderPath,
} from "./aidlc-provider-types";

export const PROVIDER_GIT_POLICY_PATH = ".aidlc/provider-git-policy.json";
export const PROVIDER_GIT_CACHE_PATH = ".aidlc/provider-cache/git";

const PROVIDER_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_PROVIDER_BLOB_BYTES = 64 * 1024 * 1024;
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

export type ProviderGitDiagnostic =
  | "PROVIDER_SOURCE_DISALLOWED"
  | "PROVIDER_REF_UNRESOLVED"
  | "PROVIDER_SOURCE_UNAVAILABLE"
  | "PROVIDER_MANIFEST_INVALID"
  | "PROVIDER_SCHEMA_INCOMPATIBLE"
  | "PROVIDER_LOCK_MISMATCH";

export class ProviderGitError extends Error {
  readonly diagnostic: ProviderGitDiagnostic;

  constructor(diagnostic: ProviderGitDiagnostic, message: string) {
    super(`${diagnostic}: ${message}`);
    this.name = "ProviderGitError";
    this.diagnostic = diagnostic;
  }
}

export interface ProviderGitSourcePolicy {
  readonly version: 1;
  readonly allowed_hosts: readonly string[];
  readonly allowed_organizations: readonly string[];
  readonly allowed_commits: readonly string[];
  readonly allow_file_fixtures: boolean;
}

export interface ValidatedProviderGitSource {
  readonly source: string;
  readonly protocol: "https" | "ssh" | "file";
  readonly host: string | null;
  readonly organization: string | null;
  readonly fixture: boolean;
}

/** Mirrors the Provider-owned aidlc.provider/v1.1 Schema consumed at the Git boundary. */
export interface ProviderRepositoryManifestV1_1 {
  readonly schema: typeof PROVIDER_SCHEMA.provider;
  readonly provider_id: string;
  readonly name: string;
  readonly version: string;
  readonly kind: "knowledge" | "validation" | "command" | "composite";
  readonly capabilities: readonly string[];
  readonly selectors?: {
    readonly languages?: readonly string[];
    readonly frameworks?: readonly string[];
    readonly profiles?: readonly string[];
  };
  readonly entrypoint: {
    readonly path: string;
    readonly args?: readonly string[];
  };
  readonly ruleset: {
    readonly id: string;
    readonly version: string;
    readonly catalog: string;
  };
  readonly artifacts: {
    readonly lock: string;
    readonly sbom: string;
  };
  readonly policies: {
    readonly network: "none" | "allowlisted";
    readonly writes: readonly string[];
    readonly allowlisted_hosts?: readonly string[];
  };
  readonly extensions?: JsonObject;
}

export interface ProviderGitBundle {
  readonly source: ValidatedProviderGitSource;
  readonly requested_ref: string;
  readonly cache_path: string;
  readonly commit_oid: string;
  readonly tree_oid: string;
  readonly object_format: "sha1" | "sha256";
  readonly subdir: string | null;
  readonly manifest: ProviderRepositoryManifestV1_1;
  readonly manifest_digest: Sha256Digest;
  readonly ruleset_digest: Sha256Digest;
  readonly provider_lock_digest: Sha256Digest;
  readonly sbom_digest: Sha256Digest;
  readonly entrypoint_digest: Sha256Digest;
  readonly trust: ProjectProviderLockEntry["trust"];
  readonly lock_entry: ProjectProviderLockEntry;
  readonly install_safety: {
    readonly checkout: "none-object-database-only";
    readonly hooks: "disabled";
    readonly submodules: "not-initialized";
    readonly lfs_and_filters: "not-invoked";
    readonly provider_entrypoint: "not-executed";
    readonly package_scripts: "not-executed";
  };
}

function fail(diagnostic: ProviderGitDiagnostic, message: string): never {
  throw new ProviderGitError(diagnostic, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const expected = new Set(allowed);
  for (const key of Object.keys(value)) if (!expected.has(key)) fail("PROVIDER_MANIFEST_INVALID", `${field} has unknown field ${key}`);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail("PROVIDER_MANIFEST_INVALID", `${field} must be a non-empty string`);
  if (/[\u0000-\u001f\u007f]/.test(value)) fail("PROVIDER_MANIFEST_INVALID", `${field} cannot contain control characters`);
  return value.trim();
}

function id(value: unknown, field: string): string {
  const result = text(value, field);
  if (!PROVIDER_ID.test(result)) fail("PROVIDER_MANIFEST_INVALID", `${field} must be a Provider identifier`);
  return result;
}

function strings(value: unknown, field: string, allowEmpty = true): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail("PROVIDER_MANIFEST_INVALID", `${field} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  const result = value.map((candidate, index) => text(candidate, `${field}[${index}]`));
  if (new Set(result).size !== result.length) fail("PROVIDER_MANIFEST_INVALID", `${field} contains duplicates`);
  return result;
}

function ids(value: unknown, field: string): string[] {
  return strings(value, field, false).map((candidate, index) => id(candidate, `${field}[${index}]`));
}

function safePath(value: unknown, field: string): string {
  const result = text(value, field).replace(/^\.\//, "");
  if (!isPortableProviderPath(result) || result.includes(":")) fail("PROVIDER_MANIFEST_INVALID", `${field} must be a portable relative path`);
  return result;
}

function jsonObject(value: unknown, field: string): JsonObject {
  const visit = (candidate: unknown, path: string): unknown => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return candidate;
    if (typeof candidate === "number" && Number.isFinite(candidate)) return Object.is(candidate, -0) ? 0 : candidate;
    if (Array.isArray(candidate)) return candidate.map((entry, index) => visit(entry, `${path}[${index}]`));
    if (isRecord(candidate)) return Object.fromEntries(Object.entries(candidate).map(([key, entry]) => [key, visit(entry, `${path}.${key}`)]));
    fail("PROVIDER_MANIFEST_INVALID", `${path} must contain only JSON values`);
  };
  if (!isRecord(value)) fail("PROVIDER_MANIFEST_INVALID", `${field} must be an object`);
  return visit(value, field) as JsonObject;
}

/** External-source protocols that predate the knowledge contract. A knowledge-kind
 *  manifest that declares one of these instead of extensions["aidlc.knowledge"] stays
 *  installable during the deprecation window (the resolver already treats it as an
 *  external source with no knowledge confirmation action). */
export const LEGACY_KNOWLEDGE_EXTENSION_PROTOCOLS = ["aidlc.context-source", "aidlc.design-resource", "aidlc.ui-read-source"] as const;

export const LEGACY_KNOWLEDGE_DEPRECATION = 'kind: knowledge without extensions["aidlc.knowledge"] relies on a legacy external-source protocol; deprecated — add aidlc.knowledge or change kind (a future version will reject installation)';

/** True when a knowledge-kind manifest relies on a legacy external-source protocol
 *  instead of the knowledge contract. */
export function isLegacyKnowledgeExternalSource(manifest: Pick<ProviderRepositoryManifestV1_1, "kind" | "extensions">): boolean {
  return manifest.kind === "knowledge" && manifest.extensions?.["aidlc.knowledge"] === undefined
    && LEGACY_KNOWLEDGE_EXTENSION_PROTOCOLS.some((protocol) => manifest.extensions?.[protocol] !== undefined);
}

export function validateProviderRepositoryManifest(value: unknown, options: { locked?: boolean } = {}): ProviderRepositoryManifestV1_1 {
  if (!isRecord(value)) fail("PROVIDER_MANIFEST_INVALID", "provider.yaml must contain an object");
  exact(value, ["schema", "provider_id", "name", "version", "kind", "capabilities", "selectors", "entrypoint", "ruleset", "artifacts", "policies", "extensions"], "provider.yaml");
  if (value.schema !== PROVIDER_SCHEMA.provider) fail("PROVIDER_SCHEMA_INCOMPATIBLE", `provider.yaml schema must be ${PROVIDER_SCHEMA.provider}`);
  const version = text(value.version, "provider.yaml.version");
  if (!SEMVER.test(version)) fail("PROVIDER_MANIFEST_INVALID", "provider.yaml.version must be semver");
  const kind = text(value.kind, "provider.yaml.kind");
  if (!["knowledge", "validation", "command", "composite"].includes(kind)) fail("PROVIDER_MANIFEST_INVALID", "provider.yaml.kind is invalid");

  let selectors: ProviderRepositoryManifestV1_1["selectors"];
  if (value.selectors !== undefined) {
    if (!isRecord(value.selectors)) fail("PROVIDER_MANIFEST_INVALID", "provider.yaml.selectors must be an object");
    exact(value.selectors, ["languages", "frameworks", "profiles"], "provider.yaml.selectors");
    selectors = {
      ...(value.selectors.languages === undefined ? {} : { languages: strings(value.selectors.languages, "provider.yaml.selectors.languages") }),
      ...(value.selectors.frameworks === undefined ? {} : { frameworks: strings(value.selectors.frameworks, "provider.yaml.selectors.frameworks") }),
      ...(value.selectors.profiles === undefined ? {} : { profiles: strings(value.selectors.profiles, "provider.yaml.selectors.profiles") }),
    };
  }

  if (!isRecord(value.entrypoint)) fail("PROVIDER_MANIFEST_INVALID", "provider.yaml.entrypoint must be an object");
  exact(value.entrypoint, ["path", "args"], "provider.yaml.entrypoint");
  if (!isRecord(value.ruleset)) fail("PROVIDER_MANIFEST_INVALID", "provider.yaml.ruleset must be an object");
  exact(value.ruleset, ["id", "version", "catalog"], "provider.yaml.ruleset");
  const rulesetVersion = text(value.ruleset.version, "provider.yaml.ruleset.version");
  if (!SEMVER.test(rulesetVersion)) fail("PROVIDER_MANIFEST_INVALID", "provider.yaml.ruleset.version must be semver");
  if (!isRecord(value.artifacts)) fail("PROVIDER_MANIFEST_INVALID", "provider.yaml.artifacts must be an object");
  exact(value.artifacts, ["lock", "sbom"], "provider.yaml.artifacts");
  if (!isRecord(value.policies)) fail("PROVIDER_MANIFEST_INVALID", "provider.yaml.policies must be an object");
  exact(value.policies, ["network", "writes", "allowlisted_hosts"], "provider.yaml.policies");
  const network = text(value.policies.network, "provider.yaml.policies.network");
  if (network !== "none" && network !== "allowlisted") fail("PROVIDER_MANIFEST_INVALID", "provider.yaml.policies.network must be none or allowlisted");
  const writes = strings(value.policies.writes, "provider.yaml.policies.writes").map((candidate, index) => safePath(candidate, `provider.yaml.policies.writes[${index}]`));
  const extensions = value.extensions === undefined ? undefined : jsonObject(value.extensions, "provider.yaml.extensions");
  // Old locks may contain knowledge-kind external sources with no knowledge package.
  // Keep those readable offline, and keep manifests that declare a recognized legacy
  // external-source protocol installable as a deprecation window; every other
  // knowledge manifest must satisfy the contract.
  if (kind === "knowledge" && !(options.locked && extensions?.["aidlc.knowledge"] === undefined) && !isLegacyKnowledgeExternalSource({ kind: kind as ProviderRepositoryManifestV1_1["kind"], extensions })) {
    try {
      validateKnowledgePackage(extensions?.["aidlc.knowledge"], version);
    } catch (error) {
      fail("PROVIDER_MANIFEST_INVALID", error instanceof Error ? error.message : String(error));
    }
  }
  return {
    schema: PROVIDER_SCHEMA.provider,
    provider_id: id(value.provider_id, "provider.yaml.provider_id"),
    name: text(value.name, "provider.yaml.name"),
    version,
    kind: kind as ProviderRepositoryManifestV1_1["kind"],
    capabilities: ids(value.capabilities, "provider.yaml.capabilities"),
    ...(selectors ? { selectors } : {}),
    entrypoint: {
      path: safePath(value.entrypoint.path, "provider.yaml.entrypoint.path"),
      ...(value.entrypoint.args === undefined ? {} : { args: strings(value.entrypoint.args, "provider.yaml.entrypoint.args") }),
    },
    ruleset: {
      id: id(value.ruleset.id, "provider.yaml.ruleset.id"),
      version: rulesetVersion,
      catalog: safePath(value.ruleset.catalog, "provider.yaml.ruleset.catalog"),
    },
    artifacts: {
      lock: safePath(value.artifacts.lock, "provider.yaml.artifacts.lock"),
      sbom: safePath(value.artifacts.sbom, "provider.yaml.artifacts.sbom"),
    },
    policies: {
      network: network as "none" | "allowlisted",
      writes,
      ...(value.policies.allowlisted_hosts === undefined ? {} : { allowlisted_hosts: strings(value.policies.allowlisted_hosts, "provider.yaml.policies.allowlisted_hosts") }),
    },
    ...(extensions ? { extensions } : {}),
  };
}

function normalizeHost(value: unknown, field: string): string {
  if (typeof value !== "string" || !HOST.test(value.toLowerCase())) fail("PROVIDER_SOURCE_DISALLOWED", `${field} contains an invalid hostname`);
  return value.toLowerCase();
}

function safeCommit(value: unknown, field: string): string {
  if (typeof value !== "string" || (!SHA1.test(value) && !SHA256.test(value))) fail("PROVIDER_SOURCE_DISALLOWED", `${field} contains an invalid commit OID`);
  return value;
}

export function readProviderGitSourcePolicy(projectRoot: string): ProviderGitSourcePolicy {
  const aidlc = resolve(projectRoot, ".aidlc");
  if (existsSync(aidlc)) {
    const aidlcStat = lstatSync(aidlc);
    if (!aidlcStat.isDirectory() || aidlcStat.isSymbolicLink()) fail("PROVIDER_SOURCE_DISALLOWED", `.aidlc must be a regular non-symlink directory`);
  }
  const path = resolve(projectRoot, PROVIDER_GIT_POLICY_PATH);
  if (!existsSync(path)) return { version: 1, allowed_hosts: [], allowed_organizations: [], allowed_commits: [], allow_file_fixtures: false };
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("PROVIDER_SOURCE_DISALLOWED", `${PROVIDER_GIT_POLICY_PATH} must be a regular non-symlink file`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    fail("PROVIDER_SOURCE_DISALLOWED", `${PROVIDER_GIT_POLICY_PATH} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) fail("PROVIDER_SOURCE_DISALLOWED", `${PROVIDER_GIT_POLICY_PATH} must contain an object`);
  const allowed = new Set(["version", "allowed_hosts", "allowed_organizations", "allowed_commits", "allow_file_fixtures"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail("PROVIDER_SOURCE_DISALLOWED", `${PROVIDER_GIT_POLICY_PATH} has unknown field ${key}`);
  if (value.version !== undefined && value.version !== 1) fail("PROVIDER_SOURCE_DISALLOWED", `${PROVIDER_GIT_POLICY_PATH} version must be 1`);
  const list = (candidate: unknown, field: string): string[] => {
    if (candidate === undefined) return [];
    if (!Array.isArray(candidate)) fail("PROVIDER_SOURCE_DISALLOWED", `${field} must be an array`);
    const result = candidate.map((entry, index) => {
      if (typeof entry !== "string" || !entry.trim()) fail("PROVIDER_SOURCE_DISALLOWED", `${field}[${index}] must be a non-empty string`);
      return entry.trim().toLowerCase();
    });
    if (new Set(result).size !== result.length) fail("PROVIDER_SOURCE_DISALLOWED", `${field} contains duplicates`);
    return result;
  };
  const hosts = list(value.allowed_hosts, "allowed_hosts").map((host) => normalizeHost(host, "allowed_hosts"));
  const organizations = list(value.allowed_organizations, "allowed_organizations");
  const commits = list(value.allowed_commits, "allowed_commits").map((commit) => safeCommit(commit, "allowed_commits"));
  if (value.allow_file_fixtures !== undefined && typeof value.allow_file_fixtures !== "boolean") {
    fail("PROVIDER_SOURCE_DISALLOWED", "allow_file_fixtures must be a boolean");
  }
  return {
    version: 1,
    allowed_hosts: hosts,
    allowed_organizations: organizations,
    allowed_commits: commits,
    allow_file_fixtures: value.allow_file_fixtures === true,
  };
}

function parseScpSource(value: string): { host: string; path: string } | null {
  const match = /^(?:[A-Za-z0-9._-]+@)?([^:/\\\s]+):([^\s]+)$/.exec(value);
  if (!match || /^[A-Za-z]:/.test(value)) return null;
  return { host: match[1].toLowerCase(), path: match[2].replace(/^\//, "") };
}

function sourceOrganization(host: string, pathname: string): string {
  const segments = pathname.replace(/^\//, "").split("/").filter(Boolean);
  if (segments.length < 2) fail("PROVIDER_SOURCE_DISALLOWED", `Git source on ${host} must include organization and repository path`);
  return segments[0].toLowerCase();
}

function organizationAllowed(policy: ProviderGitSourcePolicy, host: string, organization: string): boolean {
  if (policy.allowed_organizations.length === 0) return true;
  return policy.allowed_organizations.some((entry) => entry === organization || entry === `${host}/${organization}`);
}

export function validateProviderGitSource(
  value: string,
  projectRoot: string,
  options: { allowFile?: boolean; policy?: ProviderGitSourcePolicy } = {},
): ValidatedProviderGitSource {
  const raw = value.trim();
  if (!raw) fail("PROVIDER_SOURCE_DISALLOWED", "Git source URL must not be empty");
  const policy = options.policy ?? readProviderGitSourcePolicy(projectRoot);
  const fileAllowed = options.allowFile === true || policy.allow_file_fixtures || process.env.AIDLC_PROVIDER_ALLOW_FILE === "1";
  if (isAbsolute(raw)) {
    if (!fileAllowed) fail("PROVIDER_SOURCE_DISALLOWED", "local paths are allowed only for explicit test fixtures");
    return validateProviderGitSource(pathToFileURL(raw).href, projectRoot, { ...options, allowFile: true, policy });
  }
  const scp = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw) ? null : parseScpSource(raw);
  if (scp) {
    const host = normalizeHost(scp.host, "Git SSH host");
    const organization = sourceOrganization(host, scp.path);
    if (!policy.allowed_hosts.includes(host)) fail("PROVIDER_SOURCE_DISALLOWED", `Git SSH host ${host} is not in ${PROVIDER_GIT_POLICY_PATH}`);
    if (!organizationAllowed(policy, host, organization)) fail("PROVIDER_SOURCE_DISALLOWED", `Git organization ${host}/${organization} is not allowed`);
    return { source: raw, protocol: "ssh", host, organization, fixture: false };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("PROVIDER_SOURCE_DISALLOWED", `Git source must be an https, ssh, or explicitly allowed file URL: ${raw}`);
  }
  if (url.search || url.hash) fail("PROVIDER_SOURCE_DISALLOWED", "Git source URL cannot contain query parameters or fragments");
  const protocol = url.protocol.replace(/:$/, "");
  if (protocol === "file") {
    if (!fileAllowed) fail("PROVIDER_SOURCE_DISALLOWED", "file Git sources are allowed only for explicit local test fixtures");
    if (url.username || url.password || url.host) fail("PROVIDER_SOURCE_DISALLOWED", "file Git fixture URL must be local and credential-free");
    let local: string;
    try {
      local = fileURLToPath(url);
    } catch (error) {
      fail("PROVIDER_SOURCE_DISALLOWED", `file Git fixture URL is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isAbsolute(local)) fail("PROVIDER_SOURCE_DISALLOWED", "file Git fixture URL must resolve to an absolute path");
    return { source: pathToFileURL(resolve(local)).href, protocol: "file", host: null, organization: null, fixture: true };
  }
  if (protocol !== "https" && protocol !== "ssh") fail("PROVIDER_SOURCE_DISALLOWED", `Git protocol ${protocol || "unknown"} is not allowed`);
  if (url.password || (protocol === "https" && url.username)) fail("PROVIDER_SOURCE_DISALLOWED", "Git source URL cannot embed credentials");
  const host = normalizeHost(url.hostname, "Git source host");
  const organization = sourceOrganization(host, url.pathname);
  if (!policy.allowed_hosts.includes(host)) fail("PROVIDER_SOURCE_DISALLOWED", `Git host ${host} is not in ${PROVIDER_GIT_POLICY_PATH}`);
  if (!organizationAllowed(policy, host, organization)) fail("PROVIDER_SOURCE_DISALLOWED", `Git organization ${host}/${organization} is not allowed`);
  return { source: raw, protocol, host, organization, fixture: false };
}

export function validateProviderRef(value: string): string {
  const ref = value.trim();
  const invalid = !SAFE_REF.test(ref)
    || ref.includes("..")
    || ref.includes("//")
    || ref.includes("@{")
    || ref.endsWith("/")
    || ref.endsWith(".")
    || ref.split("/").some((segment) => segment === "." || segment === ".." || segment.endsWith(".lock"));
  if (invalid) fail("PROVIDER_REF_UNRESOLVED", `Git ref is not safe: ${JSON.stringify(value)}`);
  return ref;
}

function cacheKey(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function providerGitCachePath(projectRoot: string, source: string): string {
  return resolve(projectRoot, PROVIDER_GIT_CACHE_PATH, `${cacheKey(source)}.git`);
}

function ensureRegularDirectory(path: string, label: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    return;
  }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PROVIDER_SOURCE_UNAVAILABLE", `${label} must be a regular non-symlink directory: ${path}`);
}

const DEFAULT_SSH_IDENTITIES = ["id_ed25519", "id_ed25519_sk", "id_ecdsa", "id_ecdsa_sk", "id_rsa"];

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Windows OpenSSH resolves `~/.ssh` from USERPROFILE, which the isolated Git
 * environment replaces with a throwaway home. Without this, every ssh Provider
 * source fails with "Host key verification failed". Point ssh explicitly at the
 * real user's known_hosts and default identities, keep strict host key checking,
 * and do not load ssh_config (no ProxyCommand/LocalCommand from config files).
 * POSIX ssh resolves `~` from the passwd database, so it needs no override.
 */
export function providerSshCommand(
  platform: NodeJS.Platform = process.platform,
  userHome: string = homedir(),
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (platform !== "win32" || !userHome) return undefined;
  const sshDir = join(userHome, ".ssh").replace(/\\/g, "/");
  const args = [
    "ssh",
    "-F", "none",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${shellQuote(`${sshDir}/known_hosts`)}`,
  ];
  for (const name of DEFAULT_SSH_IDENTITIES) {
    const identity = `${sshDir}/${name}`;
    if (exists(identity)) args.push("-i", shellQuote(identity));
  }
  return args.join(" ");
}

function isolatedGitEnvironment(home: string, offline = false): NodeJS.ProcessEnv {
  const inherited = ["PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "COMSPEC", "TEMP", "TMP",
    ...(offline ? [] : ["SSH_AUTH_SOCK", "GIT_SSH_COMMAND", "GIT_ASKPASS", "SSH_ASKPASS"])];
  const env: NodeJS.ProcessEnv = {};
  for (const key of inherited) if (process.env[key] !== undefined) env[key] = process.env[key];
  if (!offline && env.GIT_SSH_COMMAND === undefined) {
    const sshCommand = providerSshCommand();
    if (sshCommand) env.GIT_SSH_COMMAND = sshCommand;
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: NULL_DEVICE,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GCM_INTERACTIVE: "Never",
  };
}

interface GitContext {
  readonly cache: string;
  readonly home: string;
  readonly hooks: string;
  readonly allowFile: boolean;
  readonly offline?: boolean;
}

function gitArgs(context: GitContext, args: readonly string[]): string[] {
  return [
    // Detached caches can exceed MAX_PATH under a normal Windows user profile.
    // Scope this to the child invocation; never change the user's Git config.
    ...(process.platform === "win32" ? ["-c", "core.longpaths=true"] : []),
    "-c", `core.hooksPath=${context.hooks}`,
    "-c", "core.fsmonitor=false",
    "-c", "submodule.recurse=false",
    "-c", "filter.lfs.smudge=",
    "-c", "filter.lfs.required=false",
    "-c", "credential.helper=",
    "-c", "protocol.allow=never",
    "-c", `protocol.https.allow=${context.offline ? "never" : "always"}`,
    "-c", `protocol.ssh.allow=${context.offline ? "never" : "always"}`,
    "-c", `protocol.file.allow=${context.allowFile && !context.offline ? "always" : "never"}`,
    "-c", "protocol.ext.allow=never",
    ...args,
  ];
}

function assertSafeCacheConfiguration(context: GitContext): void {
  const path = join(context.cache, "config");
  if (!existsSync(path)) fail("PROVIDER_SOURCE_UNAVAILABLE", `Provider cache Git config is missing: ${path}`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) {
    fail("PROVIDER_SOURCE_UNAVAILABLE", `Provider cache Git config is not a small regular file: ${path}`);
  }
  const allowed = new Map<string, Set<string>>([
    ["core", new Set(["repositoryformatversion", "filemode", "bare", "logallrefupdates", "ignorecase", "precomposeunicode", "symlinks"])],
    ["extensions", new Set(["objectformat"])],
  ]);
  let section = "";
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const heading = /^\[([^\] \t"]+)\]$/.exec(line);
    if (heading) {
      section = heading[1].toLowerCase();
      if (!allowed.has(section)) fail("PROVIDER_SOURCE_UNAVAILABLE", `Provider cache Git config contains forbidden section [${heading[1]}]`);
      continue;
    }
    const setting = /^([A-Za-z][A-Za-z0-9-]*)\s*=/.exec(line);
    if (!setting || !allowed.get(section)?.has(setting[1].toLowerCase())) {
      fail("PROVIDER_SOURCE_UNAVAILABLE", `Provider cache Git config contains forbidden setting: ${line}`);
    }
  }
}

function git(context: GitContext, args: readonly string[], encoding: "utf8"): SpawnSyncReturns<string>;
function git(context: GitContext, args: readonly string[], encoding?: undefined): SpawnSyncReturns<Buffer>;
function git(context: GitContext, args: readonly string[], encoding?: "utf8"): SpawnSyncReturns<string> | SpawnSyncReturns<Buffer> {
  if (args[0] !== "init") assertSafeCacheConfiguration(context);
  return encoding === "utf8"
    ? runSync("git", gitArgs(context, args), { cwd: context.cache, env: isolatedGitEnvironment(context.home, context.offline), encoding: "utf8", shell: false })
    : runSync("git", gitArgs(context, args), { cwd: context.cache, env: isolatedGitEnvironment(context.home, context.offline), shell: false });
}

function gitText(context: GitContext, args: readonly string[], label: string): string {
  const result = git(context, args, "utf8");
  if (result.error) fail("PROVIDER_SOURCE_UNAVAILABLE", `${label}: ${result.error.message}`);
  if (result.status !== 0) fail("PROVIDER_SOURCE_UNAVAILABLE", `${label}: ${(result.stderr || result.stdout || `git exited ${result.status}`).trim()}`);
  return result.stdout.trim();
}

function initializeCache(projectRoot: string, source: ValidatedProviderGitSource): { context: GitContext; cleanup: () => void } {
  const root = realpathSync(resolve(projectRoot));
  const aidlc = resolve(root, ".aidlc");
  ensureRegularDirectory(aidlc, ".aidlc");
  const parent = resolve(root, PROVIDER_GIT_CACHE_PATH);
  const rel = relative(root, parent);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("PROVIDER_SOURCE_UNAVAILABLE", "Provider cache escapes project root");
  ensureRegularDirectory(dirname(parent), "Provider cache parent");
  ensureRegularDirectory(parent, "Provider Git cache directory");
  const cache = providerGitCachePath(root, source.source);
  const session = mkdtempSync(join(tmpdir(), "aidlc-provider-git-"));
  const home = join(session, "home");
  const hooks = join(session, "hooks-disabled");
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(hooks, { mode: 0o700 });
  const context: GitContext = { cache, home, hooks, allowFile: source.fixture };
  if (!existsSync(cache)) {
    const staging = `${cache}.stage-${process.pid}-${randomBytes(4).toString("hex")}`;
    mkdirSync(staging, { mode: 0o700 });
    const stageContext = { ...context, cache: staging };
    const initialized = git(stageContext, ["init", "--bare", `--template=${hooks}`], "utf8");
    if (initialized.error || initialized.status !== 0) {
      rmSync(staging, { recursive: true, force: true });
      rmSync(session, { recursive: true, force: true });
      fail("PROVIDER_SOURCE_UNAVAILABLE", `cannot initialize detached Provider cache: ${initialized.error?.message || initialized.stderr || initialized.stdout}`);
    }
    try {
      renameSync(staging, cache);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      if (!existsSync(cache)) {
        rmSync(session, { recursive: true, force: true });
        throw error;
      }
    }
  }
  const stat = lstatSync(cache);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    rmSync(session, { recursive: true, force: true });
    fail("PROVIDER_SOURCE_UNAVAILABLE", `Provider cache must be a regular non-symlink directory: ${cache}`);
  }
  return { context, cleanup: () => rmSync(session, { recursive: true, force: true }) };
}

function fetchRef(context: GitContext, source: ValidatedProviderGitSource, requestedRef: string): { commit: string; tree: string; objectFormat: "sha1" | "sha256" } {
  const fetched = git(context, ["fetch", "--force", "--no-tags", "--no-recurse-submodules", "--depth=1", source.source, requestedRef], "utf8");
  if (fetched.error || fetched.status !== 0) {
    const message = `${fetched.error?.message || ""}\n${fetched.stderr || ""}\n${fetched.stdout || ""}`.trim();
    if (/couldn.t find remote ref|not our ref|invalid refspec|unadvertised object|unknown revision/i.test(message)) {
      fail("PROVIDER_REF_UNRESOLVED", `cannot resolve ref ${requestedRef}: ${message}`);
    }
    fail("PROVIDER_SOURCE_UNAVAILABLE", `cannot fetch Provider source: ${message || `git exited ${fetched.status}`}`);
  }
  const commit = gitText(context, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"], `resolve Provider ref ${requestedRef}`);
  const tree = gitText(context, ["rev-parse", "--verify", `${commit}^{tree}`], `resolve Provider tree ${commit}`);
  let objectFormat = gitText(context, ["rev-parse", "--show-object-format"], "read Git object format") as "sha1" | "sha256";
  if (objectFormat !== "sha1" && objectFormat !== "sha256") objectFormat = commit.length === 64 ? "sha256" : "sha1";
  const pattern = objectFormat === "sha1" ? SHA1 : SHA256;
  if (!pattern.test(commit) || !pattern.test(tree)) fail("PROVIDER_LOCK_MISMATCH", `Git returned invalid ${objectFormat} commit/tree OIDs`);
  const fetchHead = join(context.cache, "FETCH_HEAD");
  if (existsSync(fetchHead)) unlinkSync(fetchHead);
  return { commit, tree, objectFormat };
}

function repoPath(subdir: string | null, value: string): string {
  const path = subdir ? `${subdir}/${value}` : value;
  if (!isPortableProviderPath(path) || path.includes(":")) fail("PROVIDER_MANIFEST_INVALID", `Provider repository path is invalid: ${path}`);
  return path;
}

interface GitBlob {
  readonly path: string;
  readonly oid: string;
  readonly bytes: Buffer;
}

function readLockedBlob(context: GitContext, commit: string, path: string): GitBlob {
  const tree = git(context, ["ls-tree", "-z", commit, "--", path]);
  if (tree.error || tree.status !== 0) fail("PROVIDER_SOURCE_UNAVAILABLE", `cannot inspect ${path}: ${tree.error?.message || String(tree.stderr)}`);
  const output = tree.stdout;
  const entries = output.length === 0 ? [] : output.subarray(0, output[output.length - 1] === 0 ? -1 : undefined).toString("utf8").split("\0");
  const match = entries.map((entry) => /^(\d{6}) (\w+) ([0-9a-f]+)\t(.+)$/.exec(entry)).find((entry) => entry?.[4] === path);
  if (!match) fail("PROVIDER_MANIFEST_INVALID", `Provider repository is missing ${path}`);
  if (match[1] === "120000") fail("PROVIDER_MANIFEST_INVALID", `Provider repository path cannot be a symlink: ${path}`);
  if (match[1] === "160000" || match[2] === "commit") fail("PROVIDER_MANIFEST_INVALID", `Provider repository path cannot be a submodule: ${path}`);
  if (match[2] !== "blob") fail("PROVIDER_MANIFEST_INVALID", `Provider repository path must be a file: ${path}`);
  const blob = git(context, ["cat-file", "blob", match[3]]);
  if (blob.error || blob.status !== 0) fail("PROVIDER_SOURCE_UNAVAILABLE", `cannot read ${path}: ${blob.error?.message || String(blob.stderr)}`);
  if (blob.stdout.length > MAX_PROVIDER_BLOB_BYTES) fail("PROVIDER_MANIFEST_INVALID", `${path} exceeds ${MAX_PROVIDER_BLOB_BYTES} bytes`);
  return { path, oid: match[3], bytes: blob.stdout };
}

function parseJsonObject(blob: GitBlob, field: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(blob.bytes.toString("utf8")) as unknown;
  } catch (error) {
    fail("PROVIDER_MANIFEST_INVALID", `${field} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) fail("PROVIDER_MANIFEST_INVALID", `${field} must contain a JSON object`);
  return value;
}

function validateRuleCatalog(value: Record<string, unknown>): void {
  if (!Array.isArray(value.rules)) fail("PROVIDER_MANIFEST_INVALID", "ruleset catalog must contain a rules array");
  const idsSeen = new Set<string>();
  value.rules.forEach((candidate, index) => {
    if (!isRecord(candidate)) fail("PROVIDER_MANIFEST_INVALID", `ruleset catalog rules[${index}] must be an object`);
    const ruleId = id(candidate.id, `ruleset catalog rules[${index}].id`);
    if (idsSeen.has(ruleId)) fail("PROVIDER_MANIFEST_INVALID", `ruleset catalog has duplicate rule id ${ruleId}`);
    idsSeen.add(ruleId);
  });
}

function inspectBundle(context: GitContext, commit: string, subdir: string | null, locked = false): {
  manifest: ProviderRepositoryManifestV1_1;
  manifestDigest: Sha256Digest;
  rulesetDigest: Sha256Digest;
  providerLockDigest: Sha256Digest;
  sbomDigest: Sha256Digest;
  entrypointDigest: Sha256Digest;
} {
  const manifestBlob = readLockedBlob(context, commit, repoPath(subdir, "provider.yaml"));
  let manifestValue: unknown;
  try {
    manifestValue = parseProviderYaml(manifestBlob.bytes.toString("utf8"), "provider.yaml");
  } catch (error) {
    if (error instanceof ProviderGitError) throw error;
    fail("PROVIDER_MANIFEST_INVALID", error instanceof Error ? error.message : String(error));
  }
  const manifest = validateProviderRepositoryManifest(manifestValue, { locked });
  const ruleset = readLockedBlob(context, commit, repoPath(subdir, manifest.ruleset.catalog));
  validateRuleCatalog(parseJsonObject(ruleset, "ruleset catalog"));
  const providerLock = readLockedBlob(context, commit, repoPath(subdir, manifest.artifacts.lock));
  parseJsonObject(providerLock, "Provider lockfile");
  const sbom = readLockedBlob(context, commit, repoPath(subdir, manifest.artifacts.sbom));
  parseJsonObject(sbom, "Provider SBOM");
  const entrypoint = readLockedBlob(context, commit, repoPath(subdir, manifest.entrypoint.path));
  return {
    manifest,
    manifestDigest: sha256FileDigest(manifestBlob.bytes),
    rulesetDigest: sha256FileDigest(ruleset.bytes),
    providerLockDigest: sha256FileDigest(providerLock.bytes),
    sbomDigest: sha256FileDigest(sbom.bytes),
    entrypointDigest: sha256FileDigest(entrypoint.bytes),
  };
}

function resolveTrust(
  context: GitContext,
  source: ValidatedProviderGitSource,
  commit: string,
  mode: ProjectProviderIntent["trust"]["mode"],
  policy: ProviderGitSourcePolicy,
): ProjectProviderLockEntry["trust"] {
  let verified = false;
  if (mode === "allowlisted-commit") verified = policy.allowed_commits.includes(commit);
  else if (mode === "signed-commit-or-tag") {
    const verification = git(context, ["verify-commit", "--raw", commit], "utf8");
    verified = !verification.error && verification.status === 0;
  }
  if (!verified) return { status: "untrusted" };
  return {
    status: "verified",
    verification_digest: sha256ProviderDigest({ mode, source: source.source, commit_oid: commit, policy }),
  };
}

export function fetchProviderGitBundle(
  projectRoot: string,
  input: {
    readonly source: string;
    readonly ref: string;
    readonly subdir?: string;
    readonly instance_id: string;
    readonly expected_provider_id?: string;
    readonly project_config_digest: Sha256Digest;
    readonly trust_mode: ProjectProviderIntent["trust"]["mode"];
  },
  options: { allowFile?: boolean; policy?: ProviderGitSourcePolicy } = {},
): ProviderGitBundle {
  if (!PROVIDER_ID.test(input.instance_id)) fail("PROVIDER_MANIFEST_INVALID", `instance_id is invalid: ${input.instance_id}`);
  const policy = options.policy ?? readProviderGitSourcePolicy(projectRoot);
  const source = validateProviderGitSource(input.source, projectRoot, { ...options, policy });
  const requestedRef = validateProviderRef(input.ref || "HEAD");
  const subdir = input.subdir === undefined || input.subdir === "" ? null : safePath(input.subdir, "source.subdir");
  const session = initializeCache(projectRoot, source);
  try {
    const resolved = fetchRef(session.context, source, requestedRef);
    const inspected = inspectBundle(session.context, resolved.commit, subdir);
    if (input.expected_provider_id && inspected.manifest.provider_id !== input.expected_provider_id) {
      fail("PROVIDER_MANIFEST_INVALID", `provider.yaml provider_id ${inspected.manifest.provider_id} does not match requested ${input.expected_provider_id}`);
    }
    const trust = resolveTrust(session.context, source, resolved.commit, input.trust_mode, policy);
    const lockEntry: ProjectProviderLockEntry = {
      instance_id: input.instance_id,
      id: inspected.manifest.provider_id,
      source: {
        git: source.source,
        requested_ref: requestedRef,
        commit_oid: resolved.commit,
        object_format: resolved.objectFormat,
        tree_oid: resolved.tree,
        subdir,
      },
      manifest: {
        version: inspected.manifest.version,
        digest: inspected.manifestDigest,
        rulesets: [{ id: inspected.manifest.ruleset.id, version: inspected.manifest.ruleset.version, digest: inspected.rulesetDigest }],
      },
      artifacts: {
        provider_lock_digest: inspected.providerLockDigest,
        sbom_digest: inspected.sbomDigest,
        entrypoint_digests: { [inspected.manifest.entrypoint.path]: inspected.entrypointDigest },
      },
      project_config_digest: input.project_config_digest,
      trust,
    };
    return {
      source,
      requested_ref: requestedRef,
      cache_path: session.context.cache,
      commit_oid: resolved.commit,
      tree_oid: resolved.tree,
      object_format: resolved.objectFormat,
      subdir,
      manifest: inspected.manifest,
      manifest_digest: inspected.manifestDigest,
      ruleset_digest: inspected.rulesetDigest,
      provider_lock_digest: inspected.providerLockDigest,
      sbom_digest: inspected.sbomDigest,
      entrypoint_digest: inspected.entrypointDigest,
      trust,
      lock_entry: lockEntry,
      install_safety: {
        checkout: "none-object-database-only",
        hooks: "disabled",
        submodules: "not-initialized",
        lfs_and_filters: "not-invoked",
        provider_entrypoint: "not-executed",
        package_scripts: "not-executed",
      },
    };
  } finally {
    session.cleanup();
  }
}

export interface LockedProviderRulePolicy {
  readonly id: string;
  readonly waivable: boolean;
}

/** Read a regular blob from an already locked package. No checkout, fetch or scripts. */
export function readLockedProviderFile(projectRoot: string, entry: ProjectProviderLockEntry, path: string): Buffer {
  const verified = verifyLockedProviderCache(projectRoot, entry);
  const session = mkdtempSync(join(tmpdir(), "aidlc-provider-knowledge-"));
  const context: GitContext = { cache: verified.cache_path, home: join(session, "home"), hooks: join(session, "hooks"), allowFile: false, offline: true };
  mkdirSync(context.home);
  mkdirSync(context.hooks);
  try {
    return readLockedBlob(context, entry.source.commit_oid, repoPath(entry.source.subdir, path)).bytes;
  } finally {
    rmSync(session, { recursive: true, force: true });
  }
}

/** Read only rule waiver policy from the already verified locked commit; never refresh or execute Provider code. */
export function readLockedProviderRulePolicies(projectRoot: string, entry: ProjectProviderLockEntry): readonly LockedProviderRulePolicy[] {
  const verified = verifyLockedProviderCache(projectRoot, entry);
  const source: ValidatedProviderGitSource = entry.source.git.startsWith("file:")
    ? { source: entry.source.git, protocol: "file", host: null, organization: null, fixture: true }
    : entry.source.git.startsWith("https:")
      ? { source: entry.source.git, protocol: "https", host: null, organization: null, fixture: false }
      : { source: entry.source.git, protocol: "ssh", host: null, organization: null, fixture: false };
  const sessionRoot = mkdtempSync(join(tmpdir(), "aidlc-provider-rules-check-"));
  const context: GitContext = {
    cache: verified.cache_path,
    home: join(sessionRoot, "home"),
    hooks: join(sessionRoot, "hooks-disabled"),
    allowFile: source.fixture,
    offline: true,
  };
  mkdirSync(context.home, { mode: 0o700 });
  mkdirSync(context.hooks, { mode: 0o700 });
  try {
    const blob = readLockedBlob(context, entry.source.commit_oid, repoPath(entry.source.subdir, verified.manifest.ruleset.catalog));
    const catalog = parseJsonObject(blob, "ruleset catalog");
    validateRuleCatalog(catalog);
    return (catalog.rules as Record<string, unknown>[]).map((candidate) => ({
      id: candidate.id as string,
      waivable: candidate.waivable === true,
    }));
  } finally {
    rmSync(sessionRoot, { recursive: true, force: true });
  }
}

export function verifyLockedProviderCache(projectRoot: string, entry: ProjectProviderLockEntry): {
  readonly status: "current";
  readonly cache_path: string;
  readonly manifest: ProviderRepositoryManifestV1_1;
} {
  const source: ValidatedProviderGitSource = entry.source.git.startsWith("file:")
    ? { source: entry.source.git, protocol: "file", host: null, organization: null, fixture: true }
    : entry.source.git.startsWith("https:")
      ? { source: entry.source.git, protocol: "https", host: null, organization: null, fixture: false }
      : { source: entry.source.git, protocol: "ssh", host: null, organization: null, fixture: false };
  const cache = providerGitCachePath(projectRoot, entry.source.git);
  if (!existsSync(cache)) fail("PROVIDER_SOURCE_UNAVAILABLE", `locked Provider cache is missing for ${entry.instance_id}`);
  const stat = lstatSync(cache);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PROVIDER_SOURCE_UNAVAILABLE", `locked Provider cache is not a regular directory for ${entry.instance_id}`);
  const sessionRoot = mkdtempSync(join(tmpdir(), "aidlc-provider-cache-check-"));
  const context: GitContext = {
    cache,
    home: join(sessionRoot, "home"),
    hooks: join(sessionRoot, "hooks-disabled"),
    allowFile: source.fixture,
    offline: true,
  };
  mkdirSync(context.home, { mode: 0o700 });
  mkdirSync(context.hooks, { mode: 0o700 });
  try {
    const object = git(context, ["cat-file", "-e", `${entry.source.commit_oid}^{commit}`], "utf8");
    if (object.error || object.status !== 0) fail("PROVIDER_SOURCE_UNAVAILABLE", `locked commit ${entry.source.commit_oid} is missing from cache`);
    const tree = gitText(context, ["rev-parse", "--verify", `${entry.source.commit_oid}^{tree}`], "verify locked Provider tree");
    if (tree !== entry.source.tree_oid) fail("PROVIDER_LOCK_MISMATCH", `locked tree for ${entry.instance_id} is ${entry.source.tree_oid}, cache has ${tree}`);
    const inspected = inspectBundle(context, entry.source.commit_oid, entry.source.subdir, true);
    const mismatches: string[] = [];
    if (inspected.manifest.provider_id !== entry.id) mismatches.push("provider_id");
    if (inspected.manifest.version !== entry.manifest.version) mismatches.push("manifest.version");
    if (inspected.manifestDigest !== entry.manifest.digest) mismatches.push("manifest.digest");
    const lockedRuleset = entry.manifest.rulesets.find((ruleset) => ruleset.id === inspected.manifest.ruleset.id);
    if (!lockedRuleset || lockedRuleset.version !== inspected.manifest.ruleset.version || lockedRuleset.digest !== inspected.rulesetDigest) mismatches.push("ruleset");
    if (entry.artifacts.provider_lock_digest !== inspected.providerLockDigest) mismatches.push("provider_lock_digest");
    if (entry.artifacts.sbom_digest !== inspected.sbomDigest) mismatches.push("sbom_digest");
    if (entry.artifacts.entrypoint_digests[inspected.manifest.entrypoint.path] !== inspected.entrypointDigest) mismatches.push("entrypoint_digest");
    if (mismatches.length > 0) fail("PROVIDER_LOCK_MISMATCH", `locked Provider ${entry.instance_id} cache/digest mismatch: ${mismatches.join(", ")}`);
    return { status: "current", cache_path: cache, manifest: inspected.manifest };
  } finally {
    rmSync(sessionRoot, { recursive: true, force: true });
  }
}

/** Converts a project configuration diagnostic to the nearest P0 Git diagnostic when needed by callers. */
export function providerGitDiagnosticFromConfiguration(value: ProviderConfigurationDiagnostic): ProviderGitDiagnostic | null {
  return value === "PROVIDER_LOCK_MISMATCH" ? value : null;
}
