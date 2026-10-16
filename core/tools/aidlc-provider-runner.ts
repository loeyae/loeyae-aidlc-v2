import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessByStdio, type SpawnSyncReturns } from "node:child_process";
import type { Readable } from "node:stream";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  P0_PROVIDER_DIAGNOSTICS,
  PROVIDER_SCHEMA,
  RESTRICTED_RUNNER_POLICY_V1,
  type JsonObject,
  type JsonValue,
  type ProjectProviderLockEntry,
  type ProviderDiagnosticCode,
  type ProviderPlanNode,
  type ProviderPlanV1_1,
  type ProviderRequestInput,
  type ProviderRequestV1_1,
  type ProviderResultCheck,
  type ProviderResultV1_1,
  type ProviderSourceRevision,
  type Sha256Digest,
  isPortableProviderPath,
  providerResultAuthorityViolations,
} from "./aidlc-provider-types.js";
import {
  canonicalProviderJson,
  readProjectProviders,
  requireEnabledProviderCapability,
  sha256FileDigest,
  sha256ProviderDigest,
} from "./aidlc-project-provider.js";
import {
  parseFrozenProviderPlan,
  recomputePlanDigest,
  recomputePlanId,
} from "./aidlc-provider-resolver.js";
import {
  providerGitCachePath,
  verifyLockedProviderCache,
  type ProviderRepositoryManifestV1_1,
} from "./aidlc-provider-git.js";
import { COMMIT_ID_PATTERN, readSourceRevision } from "./aidlc-revision.js";
import { nestedSourceRepos } from "./aidlc-nested-repos.js";
import { loadWorkflowView } from "./aidlc-workflow-layout.js";
import { runSync } from "./aidlc-spawn.js";
import {
  LocalProviderEvidenceStore,
  createAcceptedProviderEvidence,
  localProviderArtifactSigner,
  type ProviderArtifactSigner,
  type ProviderEvidenceStore,
} from "./aidlc-provider-evidence.js";

export const PROVIDER_INVOCATION_TEMP_PREFIX = "aidlc-provider-invocation-";
const PLAN_ROOT = ".aidlc/provider-plans";
const MAX_RESULT_BYTES = 8 * 1024 * 1024;
const MAX_PROVIDER_BUNDLE_BYTES = 512 * 1024 * 1024;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
const EXTENSION_NAMESPACE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const SHELL_EXECUTABLES = new Set(["sh", "bash", "dash", "zsh", "fish", "ksh", "csh", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"]);
const SHELL_EXTENSIONS = new Set([".bat", ".cmd", ".ps1", ".sh"]);
const SENSITIVE_ENVIRONMENT = /(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|AWS_|AZURE_|GOOGLE_|GITHUB_|GITLAB_|NPM_|DOCKER_)/i;

export class ProviderRunnerError extends Error {
  readonly diagnostic: ProviderDiagnosticCode;
  readonly invocationStatus: "blocked" | "failed" | "deferred" | "cancelled";

  constructor(diagnostic: ProviderDiagnosticCode, message: string) {
    super(`${diagnostic}: ${message}`);
    this.name = "ProviderRunnerError";
    this.diagnostic = diagnostic;
    const effect = P0_PROVIDER_DIAGNOSTICS.find((entry) => entry.code === diagnostic)?.default_effect;
    this.invocationStatus = effect === "failed" || effect === "deferred" || effect === "cancelled" ? effect : "blocked";
  }
}

function fail(diagnostic: ProviderDiagnosticCode, message: string): never {
  throw new ProviderRunnerError(diagnostic, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const fields = new Set(allowed);
  for (const field of Object.keys(value)) if (!fields.has(field)) fail("PROVIDER_RESULT_INVALID", `${label} has unknown field ${field}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("PROVIDER_RESULT_INVALID", `${label} must be a non-empty string without control characters`);
  }
  return value;
}

function digest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("PROVIDER_RESULT_INVALID", `${label} must be sha256:<64 lowercase hex>`);
  return value as Sha256Digest;
}

function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail("PROVIDER_RESULT_INVALID", `${label} must be an integer >= ${minimum}`);
  return value as number;
}

function validateExtensions(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) fail("PROVIDER_RESULT_INVALID", `${label} must be an object`);
  for (const [namespace, extension] of Object.entries(value)) {
    if (!EXTENSION_NAMESPACE.test(namespace) || !isRecord(extension)) fail("PROVIDER_RESULT_INVALID", `${label}.${namespace} must be a namespaced JSON object`);
  }
}

function currentProviderSourceRevision(projectRoot: string): ProviderSourceRevision {
  const revision = readSourceRevision(projectRoot, undefined, nestedSourceRepos(projectRoot));
  if (!COMMIT_ID_PATTERN.test(revision.commit) || !revision.worktree_digest || !/^[0-9a-f]{64}$/.test(revision.worktree_digest)) {
    fail("PROVIDER_PLAN_STALE", "current Git source revision is unavailable");
  }
  const repos: Record<string, { commit: string; worktree_digest: Sha256Digest }> = {};
  for (const [key, repo] of Object.entries(revision.repos ?? {})) {
    if (!COMMIT_ID_PATTERN.test(repo.commit) || !repo.worktree_digest || !/^[0-9a-f]{64}$/.test(repo.worktree_digest)) {
      fail("PROVIDER_PLAN_STALE", `nested source revision is unavailable: ${key}`);
    }
    repos[key] = { commit: repo.commit, worktree_digest: `sha256:${repo.worktree_digest}` };
  }
  return {
    commit: revision.commit,
    worktree_digest: `sha256:${revision.worktree_digest}`,
    ...(Object.keys(repos).length > 0 ? { repos } : {}),
  };
}

export { currentProviderSourceRevision as readCurrentProviderSourceRevision };

function safeRegularFile(path: string, label: string, maxBytes = MAX_RESULT_BYTES): void {
  if (!existsSync(path)) fail("PROVIDER_RESULT_MISSING", `${label} does not exist`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("PROVIDER_PATH_ESCAPE", `${label} must be a regular non-symlink file`);
  if (stat.size > maxBytes) fail("PROVIDER_RESULT_INVALID", `${label} exceeds ${maxBytes} bytes`);
}

function planPath(projectRoot: string, reference: string): string {
  const normalized = reference.trim().replace(/\\/g, "/");
  if (!normalized) fail("PROVIDER_CONFIG_INVALID", "Provider Plan reference must not be empty");
  const root = resolve(projectRoot, PLAN_ROOT);
  const path = /^plan-[0-9a-f]{32}$/.test(normalized)
    ? resolve(root, `${normalized}.json`)
    : resolve(projectRoot, normalized);
  const rel = relative(root, path);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("PROVIDER_PERMISSION_DENIED", "Provider Plan reference escapes the Core plan store");
  return path;
}

/** Load an immutable, content-addressed plan only from the Core plan store. */
export function loadFrozenProviderPlan(projectRoot: string, reference: string): ProviderPlanV1_1 {
  const path = planPath(projectRoot, reference);
  safeRegularFile(path, "Provider Plan");
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, "utf8")) as unknown; } catch { fail("PROVIDER_CONFIG_INVALID", "Provider Plan is invalid JSON"); }
  const plan = parseFrozenProviderPlan(raw);
  if (recomputePlanId(plan) !== plan.plan_id || recomputePlanDigest(plan) !== plan.plan_digest) {
    fail("PROVIDER_PLAN_STALE", `Provider Plan ${plan.plan_id} identity or digest is invalid`);
  }
  return plan;
}

function exactSourceRevision(left: ProviderSourceRevision, right: ProviderSourceRevision): boolean {
  return canonicalProviderJson(left) === canonicalProviderJson(right);
}

export function assertPlanAndNodeCurrent(projectRoot: string, plan: ProviderPlanV1_1, nodeId: string): {
  readonly node: ProviderPlanNode;
  readonly lock: ProjectProviderLockEntry;
  readonly manifest: ProviderRepositoryManifestV1_1;
} {
  if (plan.approval?.status === "pending") fail("PROVIDER_PERMISSION_DENIED", `Provider Plan ${plan.plan_id} still requires approval`);
  const state = readProjectProviders(projectRoot, false);
  if (plan.project_lock_digest !== state.lock.lock_digest) fail("PROVIDER_PLAN_STALE", "Provider Plan project lock no longer matches the current lock");
  const currentRevision = currentProviderSourceRevision(projectRoot);
  if (!exactSourceRevision(plan.source_revision, currentRevision)) fail("PROVIDER_PLAN_STALE", "Provider Plan source revision no longer matches the current project");
  const node = plan.nodes.find((candidate) => candidate.node_id === nodeId);
  if (!node) fail("PROVIDER_RESULT_BINDING_MISMATCH", `Provider Plan has no node ${nodeId}`);
  if (node.state !== "selected" || node.selector_result !== "true") fail("PROVIDER_PERMISSION_DENIED", `Provider Plan node ${nodeId} is not selected`);
  if (!node.entrypoint_id) fail("PROVIDER_MANIFEST_INVALID", `Provider Plan node ${nodeId} has no locked entrypoint`);
  const lock = state.lock.providers.find((candidate) => candidate.instance_id === node.provider_instance_id);
  if (!lock) fail("PROVIDER_LOCK_MISSING", `Provider lock has no instance ${node.provider_instance_id}`);
  if (lock.trust.status === "revoked") fail("PROVIDER_COMMIT_REVOKED", `Provider instance ${lock.instance_id} is revoked`);
  const verified = verifyLockedProviderCache(projectRoot, lock);
  if (!verified.manifest.capabilities.includes(node.capability_id)
    || !requireEnabledProviderCapability(projectRoot, node.capability_id, plan.scope, { verifySource: false }).some((candidate) => candidate.intent.instance_id === lock.instance_id)) {
    fail("PROVIDER_RESULT_BINDING_MISMATCH", `Provider node ${nodeId} is not bound to this scope/capability`);
  }
  if (verified.manifest.provider_id !== lock.id || verified.manifest.entrypoint.path !== node.entrypoint_id) {
    fail("PROVIDER_RESULT_BINDING_MISMATCH", `Provider Plan node ${nodeId} no longer matches its locked Manifest`);
  }
  validateRestrictedV1Manifest(verified.manifest);
  return { node, lock, manifest: verified.manifest };
}

function isolatedGitEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USERPROFILE: home,
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    COMSPEC: process.env.COMSPEC,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function gitObject(cache: string, home: string, args: readonly string[], encoding: "utf8"): SpawnSyncReturns<string>;
function gitObject(cache: string, home: string, args: readonly string[], encoding?: undefined): SpawnSyncReturns<Buffer>;
function gitObject(
  cache: string,
  home: string,
  args: readonly string[],
  encoding?: "utf8",
): SpawnSyncReturns<string> | SpawnSyncReturns<Buffer> {
  const command = [
    ...(process.platform === "win32" ? ["-c", "core.longpaths=true"] : []),
    "-c", "core.hooksPath=",
    "-c", "core.fsmonitor=false",
    "-c", "submodule.recurse=false",
    "-c", "filter.lfs.smudge=",
    "-c", "filter.lfs.required=false",
    "-c", "credential.helper=",
    "--git-dir", cache,
    ...args,
  ];
  return encoding === "utf8"
    ? runSync("git", command, { cwd: cache, env: isolatedGitEnvironment(home), encoding: "utf8", shell: false })
    : runSync("git", command, { cwd: cache, env: isolatedGitEnvironment(home), shell: false });
}

function safeDestinationPath(root: string, portable: string): string {
  if (!isPortableProviderPath(portable) || portable.includes(":")) fail("PROVIDER_PATH_ESCAPE", `unsafe Provider path: ${portable}`);
  const path = resolve(root, ...portable.split("/"));
  const rel = relative(root, path);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("PROVIDER_PATH_ESCAPE", `Provider path escapes materialization root: ${portable}`);
  return path;
}

/** Materialize only regular blobs from the locked commit; symlinks/submodules are rejected. */
function materializeLockedProvider(projectRoot: string, lock: ProjectProviderLockEntry, destination: string): void {
  const cache = providerGitCachePath(projectRoot, lock.source.git);
  const home = resolve(destination, ".git-home");
  mkdirSync(home, { mode: 0o700 });
  const prefix = lock.source.subdir ? `${lock.source.subdir}/` : "";
  const listed = gitObject(cache, home, ["ls-tree", "-rz", "--full-tree", lock.source.commit_oid, "--", lock.source.subdir ?? ""], "utf8");
  if (listed.error || listed.status !== 0 || typeof listed.stdout !== "string") {
    fail("PROVIDER_SOURCE_UNAVAILABLE", `cannot enumerate locked Provider tree: ${listed.error?.message || listed.stderr || listed.stdout}`);
  }
  const records = listed.stdout.split("\0").filter(Boolean);
  if (records.length === 0) fail("PROVIDER_MANIFEST_INVALID", "locked Provider tree is empty");
  const names = new Set<string>();
  let total = 0;
  for (const record of records) {
    const match = /^(\d{6}) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
    if (!match) fail("PROVIDER_MANIFEST_INVALID", "locked Provider tree contains an invalid entry");
    const [, mode, type, oid, repositoryPath] = match;
    if (mode === "120000" || mode === "160000" || type === "commit") fail("PROVIDER_PATH_ESCAPE", `Provider bundle contains a symlink or submodule: ${repositoryPath}`);
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) fail("PROVIDER_MANIFEST_INVALID", `Provider bundle entry is not a regular file: ${repositoryPath}`);
    if (prefix && !repositoryPath.startsWith(prefix)) fail("PROVIDER_PATH_ESCAPE", `Provider tree entry escapes locked subdir: ${repositoryPath}`);
    const portable = prefix ? repositoryPath.slice(prefix.length) : repositoryPath;
    if (!portable || portable.split("/").some((segment) => segment === ".git")) fail("PROVIDER_PATH_ESCAPE", `Provider bundle path is reserved: ${portable}`);
    const caseKey = process.platform === "win32" ? portable.toLowerCase() : portable;
    if (names.has(caseKey)) fail("PROVIDER_PATH_ESCAPE", `Provider bundle contains colliding paths: ${portable}`);
    names.add(caseKey);
    const blob = gitObject(cache, home, ["cat-file", "blob", oid]);
    if (blob.error || blob.status !== 0 || !Buffer.isBuffer(blob.stdout)) fail("PROVIDER_SOURCE_UNAVAILABLE", `cannot read locked Provider blob ${portable}`);
    total += blob.stdout.length;
    if (total > MAX_PROVIDER_BUNDLE_BYTES) fail("PROVIDER_PERMISSION_DENIED", `Provider bundle exceeds ${MAX_PROVIDER_BUNDLE_BYTES} bytes`);
    const output = safeDestinationPath(destination, portable);
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
    writeFileSync(output, blob.stdout, { flag: "wx", mode: mode === "100755" ? 0o500 : 0o400 });
    try { chmodSync(output, mode === "100755" ? 0o500 : 0o400); } catch { /* Windows ACL enforcement belongs to the sandbox adapter. */ }
  }
  rmSync(home, { recursive: true, force: true });
}

export interface ProviderRunInput {
  readonly id: string;
  /** Project-relative portable path. Core snapshots it before execution. */
  readonly path: string;
  readonly expectedDigest?: Sha256Digest;
}

interface SnapshotFile {
  readonly path: string;
  readonly digest: Sha256Digest;
  readonly bytes: number;
}

function copySnapshotNode(source: string, destination: string, logical: string, files: SnapshotFile[], limit: number): void {
  const before = lstatSync(source);
  if (before.isSymbolicLink()) fail("PROVIDER_PATH_ESCAPE", `authorized input contains a symlink/junction: ${logical}`);
  const canonical = realpathSync(source);
  const canonicalParent = realpathSync(dirname(source));
  if (dirname(canonical) !== canonicalParent && before.isFile()) fail("PROVIDER_PATH_ESCAPE", `authorized input changes containment through a reparse point: ${logical}`);
  if (before.isFile()) {
    const bytes = readFileSync(source);
    if (files.reduce((sum, file) => sum + file.bytes, 0) + bytes.length > limit) fail("PROVIDER_PERMISSION_DENIED", `authorized inputs exceed ${limit} bytes`);
    const after = statSync(source);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail("PROVIDER_PATH_ESCAPE", `authorized input changed while being snapshotted: ${logical}`);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, bytes, { flag: "wx", mode: 0o400 });
    try { chmodSync(destination, 0o400); } catch { /* enforced by sandbox mount */ }
    files.push({ path: logical, digest: sha256FileDigest(bytes), bytes: bytes.length });
    return;
  }
  if (!before.isDirectory()) fail("PROVIDER_PATH_ESCAPE", `authorized input is not a regular file or directory: ${logical}`);
  // Snapshot directories must stay owner-writable while children are copied and while the invocation
  // directory is removed afterwards; POSIX mkdir/unlink need the write bit on the parent directory.
  // Windows ignores these bits, and the restricted-v1 sandbox enforces inputs read-only via --ro-bind.
  mkdirSync(destination, { mode: 0o700 });
  for (const entry of readdirSync(source).sort()) {
    if (entry === "." || entry === "..") fail("PROVIDER_PATH_ESCAPE", `authorized input has an invalid entry: ${logical}`);
    copySnapshotNode(join(source, entry), join(destination, entry), `${logical}/${entry}`.replace(/^\//, ""), files, limit);
  }
}

function snapshotInputs(projectRoot: string, root: string, inputs: readonly ProviderRunInput[], limit: number): ProviderRequestInput[] {
  const seen = new Set<string>();
  const result: ProviderRequestInput[] = [];
  for (const input of inputs) {
    if (!IDENTIFIER.test(input.id) || seen.has(input.id)) fail("PROVIDER_PERMISSION_DENIED", `Provider input id is invalid or duplicated: ${input.id}`);
    seen.add(input.id);
    const logical = input.path.replace(/\\/g, "/");
    if (!isPortableProviderPath(logical) || logical === ".git" || logical.startsWith(".git/") || logical === ".aidlc" || logical.startsWith(".aidlc/") || logical === "aidlc/active" || logical.startsWith("aidlc/active/")) {
      fail("PROVIDER_PERMISSION_DENIED", `Provider input path is not an authorized business artifact: ${input.path}`);
    }
    const source = resolve(projectRoot, ...logical.split("/"));
    const rel = relative(projectRoot, source);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || !existsSync(source)) fail("PROVIDER_PATH_ESCAPE", `Provider input path escapes or does not exist: ${input.path}`);
    const sourceStat = lstatSync(source);
    if (sourceStat.isSymbolicLink()) fail("PROVIDER_PATH_ESCAPE", `Provider input cannot be a symlink/junction: ${input.path}`);
    const sandboxPath = `inputs/${input.id}`;
    const destination = safeDestinationPath(root, sandboxPath);
    const files: SnapshotFile[] = [];
    copySnapshotNode(source, destination, logical, files, limit);
    const kind = sourceStat.isFile() ? "file" as const : "directory" as const;
    const actualDigest = kind === "file" ? files[0].digest : sha256ProviderDigest(files.map((file) => ({ path: file.path, digest: file.digest })));
    if (input.expectedDigest && input.expectedDigest !== actualDigest) fail("PROVIDER_RESULT_BINDING_MISMATCH", `Provider input ${input.id} digest does not match expected value`);
    result.push({ id: input.id, kind, logical_path: logical, sandbox_path: sandboxPath, digest: actualDigest, access: "read_only" });
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

export interface ProviderRunLimits {
  readonly wall_time_ms: number;
  readonly memory_bytes: number;
  readonly process_count: number;
  readonly output_bytes: number;
  readonly temporary_storage_bytes: number;
}

function limits(overrides: Partial<ProviderRunLimits> = {}): ProviderRunLimits {
  const defaults: ProviderRunLimits = {
    wall_time_ms: RESTRICTED_RUNNER_POLICY_V1.limits.default_wall_time_ms,
    memory_bytes: RESTRICTED_RUNNER_POLICY_V1.limits.default_memory_bytes,
    process_count: RESTRICTED_RUNNER_POLICY_V1.limits.default_process_count,
    output_bytes: RESTRICTED_RUNNER_POLICY_V1.limits.default_output_bytes,
    temporary_storage_bytes: RESTRICTED_RUNNER_POLICY_V1.limits.default_temporary_storage_bytes,
  };
  const result = { ...defaults, ...overrides };
  for (const [field, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value <= 0) fail("PROVIDER_PERMISSION_DENIED", `Provider limit ${field} must be a finite positive integer`);
    if (value > defaults[field as keyof ProviderRunLimits]) fail("PROVIDER_PERMISSION_DENIED", `Provider limit ${field} exceeds restricted-v1 default without an approved project policy`);
  }
  return result;
}

function assertStructuredCommand(executable: string, args: readonly string[]): void {
  if (!isPortableProviderPath(executable) || executable.includes(":")) fail("PROVIDER_PATH_ESCAPE", `Provider executable is not portable: ${executable}`);
  const name = basename(executable).toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (SHELL_EXECUTABLES.has(name) || SHELL_EXTENSIONS.has(extension)) fail("PROVIDER_SHELL_DENIED", `Provider entrypoint cannot be a shell: ${executable}`);
  for (const [index, argument] of args.entries()) {
    if (typeof argument !== "string" || argument.includes("\0")) fail("PROVIDER_SHELL_DENIED", `Provider argv[${index}] is not a valid structured argument`);
  }
}

export function validateRestrictedV1Manifest(manifest: ProviderRepositoryManifestV1_1): void {
  if (manifest.policies.network !== "none") fail("PROVIDER_NETWORK_DENIED", "restricted-v1 does not admit a network-enabled Provider Manifest");
  if (manifest.policies.writes.length > 0) fail("PROVIDER_PERMISSION_DENIED", "restricted-v1 Provider may write only the Runner-owned output/tmp roots; Manifest writes must be empty");
  assertStructuredCommand(`provider/${manifest.entrypoint.path}`, manifest.entrypoint.args ?? []);
}

export interface PreparedProviderInvocation {
  readonly invocationId: string;
  readonly sandboxRoot: string;
  readonly providerRoot: string;
  readonly inputsRoot: string;
  readonly outputRoot: string;
  readonly temporaryRoot: string;
  readonly requestPath: string;
  readonly request: ProviderRequestV1_1;
  readonly manifest: ProviderRepositoryManifestV1_1;
  readonly lock: ProjectProviderLockEntry;
  readonly node: ProviderPlanNode;
}

function workflowRequestExtensions(projectRoot: string, scope: ProviderPlanV1_1["scope"]): Readonly<Record<string, JsonObject>> | undefined {
  try {
    const workflow = loadWorkflowView(projectRoot, scope.module_id);
    if (!workflow?.scope) return undefined;
    return {
      "io.loeyae.aidlc": {
        workflow_scope: workflow.scope,
        workflow_id: workflow.workflow_id,
      },
    };
  } catch {
    // A direct Provider invocation outside an active workflow has no workflow context;
    // the immutable Plan scope remains sufficient for generic Providers.
    return undefined;
  }
}

function prepareInvocation(
  projectRoot: string,
  plan: ProviderPlanV1_1,
  nodeId: string,
  inputs: readonly ProviderRunInput[],
  limitOverrides: Partial<ProviderRunLimits>,
): PreparedProviderInvocation {
  const binding = assertPlanAndNodeCurrent(projectRoot, plan, nodeId);
  if (binding.manifest.kind === "knowledge") fail("PROVIDER_PERMISSION_DENIED", "Knowledge Providers use knowledge-load/knowledge-confirm and cannot issue accepted Evidence");
  const invocationId = `inv-${randomBytes(16).toString("hex")}`;
  const sandboxRoot = mkdtempSync(join(tmpdir(), PROVIDER_INVOCATION_TEMP_PREFIX));
  const providerRoot = resolve(sandboxRoot, "provider");
  const inputsRoot = resolve(sandboxRoot, "inputs");
  const outputRoot = resolve(sandboxRoot, "output");
  const temporaryRoot = resolve(sandboxRoot, "tmp");
  mkdirSync(providerRoot, { mode: 0o700 });
  mkdirSync(inputsRoot, { mode: 0o700 });
  mkdirSync(outputRoot, { mode: 0o700 });
  mkdirSync(join(outputRoot, "reports"), { mode: 0o700 });
  mkdirSync(temporaryRoot, { mode: 0o700 });
  materializeLockedProvider(projectRoot, binding.lock, providerRoot);
  const bounded = limits(limitOverrides);
  const requestInputs = snapshotInputs(projectRoot, sandboxRoot, inputs, bounded.temporary_storage_bytes);
  const executable = `provider/${binding.manifest.entrypoint.path}`;
  const args = [...(binding.manifest.entrypoint.args ?? [])];
  assertStructuredCommand(executable, args);
  const requestExtensions = workflowRequestExtensions(projectRoot, plan.scope);
  const request: ProviderRequestV1_1 = {
    schema: PROVIDER_SCHEMA.request,
    invocation_id: invocationId,
    plan: { plan_id: plan.plan_id, plan_digest: plan.plan_digest, node_id: binding.node.node_id },
    provider_instance: {
      instance_id: binding.lock.instance_id,
      provider_id: binding.lock.id,
      project_lock_digest: plan.project_lock_digest,
      commit_oid: binding.lock.source.commit_oid,
      tree_oid: binding.lock.source.tree_oid,
      manifest_digest: binding.lock.manifest.digest,
      config_digest: binding.lock.project_config_digest,
    },
    scope: plan.scope,
    source_revision: plan.source_revision,
    inputs: requestInputs,
    permissions: {
      profile: "restricted-v1",
      network: "denied",
      environment: [],
      command: { executable, args, shell: false },
    },
    output: { root: "output", result_path: "output/result.json", reports_root: "output/reports" },
    limits: bounded,
    ...(requestExtensions ? { extensions: requestExtensions } : {}),
  };
  const requestPath = resolve(sandboxRoot, "request.json");
  writeFileSync(requestPath, `${canonicalProviderJson(request as unknown as JsonValue)}\n`, { flag: "wx", mode: 0o400 });
  try { chmodSync(requestPath, 0o400); } catch { /* sandbox mount is read-only */ }
  return { invocationId, sandboxRoot, providerRoot, inputsRoot, outputRoot, temporaryRoot, requestPath, request, manifest: binding.manifest, lock: binding.lock, node: binding.node };
}

export interface RestrictedSandboxProbe {
  readonly supported: boolean;
  readonly adapter: string;
  readonly controls: {
    readonly filesystem: boolean;
    readonly network: boolean;
    readonly environment: boolean;
    readonly process: boolean;
    readonly resources: boolean;
  };
  readonly reason?: string;
}

export interface RestrictedSandboxExecution {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RestrictedSandboxAdapter {
  probe(): Promise<RestrictedSandboxProbe> | RestrictedSandboxProbe;
  execute(invocation: PreparedProviderInvocation, signal?: AbortSignal): Promise<RestrictedSandboxExecution>;
}

function executableOnPath(name: string): boolean {
  const result = runSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8", shell: false, env: process.env });
  return !result.error && result.status === 0 && result.stdout.trim().length > 0;
}

function collectProcess(child: ChildProcessByStdio<null, Readable, Readable>, invocation: PreparedProviderInvocation, signal?: AbortSignal): Promise<RestrictedSandboxExecution> {
  return new Promise((resolvePromise, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let cancelled = false;
    let overflow = false;
    const logLimit = Math.min(invocation.request.limits.output_bytes, 8 * 1024 * 1024);
    const terminate = (): void => {
      if (child.pid && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      } else child.kill("SIGKILL");
    };
    const append = (chunks: Buffer[], chunk: Buffer, currentBytes: number): number => {
      if (currentBytes + chunk.length > logLimit) {
        overflow = true;
        terminate();
        return currentBytes;
      }
      chunks.push(chunk);
      return currentBytes + chunk.length;
    };
    child.stdout.on("data", (chunk: Buffer) => { stdoutBytes = append(stdout, chunk, stdoutBytes); });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes = append(stderr, chunk, stderrBytes); });
    const timer = setTimeout(() => { timedOut = true; terminate(); }, invocation.request.limits.wall_time_ms);
    const abort = (): void => { cancelled = true; terminate(); };
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code, closeSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolvePromise({
        exitCode: overflow ? 1 : code,
        signal: closeSignal,
        timedOut,
        cancelled,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}${overflow ? "\nRunner log limit exceeded" : ""}`,
      });
    });
  });
}

/** Linux bubblewrap+prlimit implementation. Other OSes fail closed rather than degrade. */
export class BubblewrapRestrictedSandbox implements RestrictedSandboxAdapter {
  probe(): RestrictedSandboxProbe {
    if (process.platform !== "linux") return { supported: false, adapter: "bubblewrap-prlimit", controls: { filesystem: false, network: false, environment: false, process: false, resources: false }, reason: `restricted-v1 OS sandbox is unavailable on ${process.platform}` };
    if (!executableOnPath("bwrap") || !executableOnPath("prlimit")) return { supported: false, adapter: "bubblewrap-prlimit", controls: { filesystem: false, network: false, environment: false, process: false, resources: false }, reason: "bwrap and prlimit are both required" };
    const test = runSync("bwrap", ["--die-with-parent", "--unshare-all", "--new-session", "--ro-bind", "/usr", "/usr", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--", "/usr/bin/true"], { encoding: "utf8", shell: false, env: {} });
    const supported = !test.error && test.status === 0;
    return {
      supported,
      adapter: "bubblewrap-prlimit",
      controls: { filesystem: supported, network: supported, environment: supported, process: supported, resources: supported },
      ...(supported ? {} : { reason: test.error?.message || test.stderr || `bwrap probe exited ${test.status}` }),
    };
  }

  async execute(invocation: PreparedProviderInvocation, signal?: AbortSignal): Promise<RestrictedSandboxExecution> {
    const probe = this.probe();
    if (!probe.supported) fail("PROVIDER_SANDBOX_UNAVAILABLE", probe.reason || "bubblewrap probe failed");
    const bwrap: string[] = ["--die-with-parent", "--unshare-all", "--new-session", "--clearenv", "--ro-bind", "/usr", "/usr"];
    for (const systemPath of ["/lib", "/lib64", "/bin"]) {
      if (existsSync(systemPath)) bwrap.push("--ro-bind", systemPath, systemPath);
    }
    if (existsSync("/etc/ld.so.cache")) bwrap.push("--ro-bind", "/etc/ld.so.cache", "/etc/ld.so.cache");
    bwrap.push(
      "--proc", "/proc",
      "--dev", "/dev",
      "--tmpfs", "/tmp",
      "--dir", "/work",
      "--ro-bind", invocation.providerRoot, "/work/provider",
      "--ro-bind", invocation.inputsRoot, "/work/inputs",
      "--ro-bind", invocation.requestPath, "/work/request.json",
      "--bind", invocation.outputRoot, "/work/output",
      "--bind", invocation.temporaryRoot, "/work/tmp",
      "--setenv", "HOME", "/work/tmp/home",
      "--setenv", "TMPDIR", "/work/tmp",
      "--setenv", "AIDLC_PROVIDER_REQUEST", "/work/request.json",
      "--setenv", "AIDLC_PROVIDER_OUTPUT", "/work/output",
      "--chdir", "/work",
    );
    const executable = invocation.manifest.entrypoint.path;
    const providerExecutable = `/work/provider/${executable}`;
    const isNode = /\.(?:c?js|mjs)$/i.test(executable);
    const command = isNode ? process.execPath : providerExecutable;
    const commandArgs = isNode ? [providerExecutable, ...(invocation.manifest.entrypoint.args ?? [])] : [...(invocation.manifest.entrypoint.args ?? [])];
    bwrap.push("--", command, ...commandArgs);
    const limits = invocation.request.limits;
    const args = [
      `--as=${limits.memory_bytes}`,
      `--nproc=${limits.process_count}`,
      `--fsize=${limits.output_bytes}`,
      "--",
      "bwrap",
      ...bwrap,
    ];
    const child = spawn("prlimit", args, { cwd: invocation.sandboxRoot, env: {}, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    return collectProcess(child, invocation, signal);
  }
}

function redactLog(value: string): string {
  return value
    .replace(/(token|secret|password|credential)\s*[:=]\s*[^\s]+/gi, "$1=[REDACTED]")
    .replace(/(?:https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "https://[REDACTED]@");
}

function walkOutput(root: string, base = root): { files: string[]; bytes: number } {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) fail("PROVIDER_PATH_ESCAPE", "Provider output contains a symlink/junction");
  if (stat.isFile()) return { files: [relative(base, root).replace(/\\/g, "/")], bytes: stat.size };
  if (!stat.isDirectory()) fail("PROVIDER_PATH_ESCAPE", "Provider output contains a non-regular node");
  let bytes = 0;
  const files: string[] = [];
  for (const entry of readdirSync(root).sort()) {
    const child = walkOutput(join(root, entry), base);
    bytes += child.bytes;
    files.push(...child.files);
  }
  return { files, bytes };
}

function validateResultCheck(candidate: unknown, index: number, allowedRules: ReadonlySet<string>): ProviderResultCheck {
  if (!isRecord(candidate)) fail("PROVIDER_RESULT_INVALID", `Provider Result checks[${index}] must be an object`);
  exact(candidate, ["rule_id", "status", "severity", "message", "locations", "artifact_refs", "applicability_reason", "extensions"], `Provider Result checks[${index}]`);
  const ruleId = text(candidate.rule_id, `Provider Result checks[${index}].rule_id`);
  if (!allowedRules.has(ruleId)) fail("PROVIDER_RESULT_BINDING_MISMATCH", `Provider Result rule ${ruleId} is not in the locked ruleset`);
  if (candidate.status !== "passed" && candidate.status !== "failed" && candidate.status !== "not_applicable") fail("PROVIDER_RESULT_INVALID", `Provider Result checks[${index}].status is invalid`);
  if (!(["info", "warning", "error", "critical"] as const).includes(candidate.severity as never)) fail("PROVIDER_RESULT_INVALID", `Provider Result checks[${index}].severity is invalid`);
  text(candidate.message, `Provider Result checks[${index}].message`);
  if (candidate.status === "not_applicable") text(candidate.applicability_reason, `Provider Result checks[${index}].applicability_reason`);
  else if (candidate.applicability_reason !== undefined) fail("PROVIDER_RESULT_INVALID", `Provider Result checks[${index}].applicability_reason is only valid for not_applicable`);
  if (candidate.locations !== undefined) {
    if (!Array.isArray(candidate.locations)) fail("PROVIDER_RESULT_INVALID", `Provider Result checks[${index}].locations must be an array`);
    candidate.locations.forEach((value, locationIndex) => {
      if (!isRecord(value)) fail("PROVIDER_RESULT_INVALID", `Provider Result checks[${index}].locations[${locationIndex}] must be an object`);
      exact(value, ["path", "line", "column"], `Provider Result checks[${index}].locations[${locationIndex}]`);
      const path = text(value.path, `Provider Result checks[${index}].locations[${locationIndex}].path`);
      if (!isPortableProviderPath(path)) fail("PROVIDER_PATH_ESCAPE", `Provider Result location path is not portable: ${path}`);
      if (value.line !== undefined) integer(value.line, `Provider Result checks[${index}].locations[${locationIndex}].line`, 1);
      if (value.column !== undefined) integer(value.column, `Provider Result checks[${index}].locations[${locationIndex}].column`, 1);
    });
  }
  if (candidate.artifact_refs !== undefined) {
    if (!Array.isArray(candidate.artifact_refs)) fail("PROVIDER_RESULT_INVALID", `Provider Result checks[${index}].artifact_refs must be an array`);
    candidate.artifact_refs.forEach((value, artifactIndex) => {
      const path = text(value, `Provider Result checks[${index}].artifact_refs[${artifactIndex}]`);
      if (!isPortableProviderPath(path)) fail("PROVIDER_PATH_ESCAPE", `Provider Result artifact path is not portable: ${path}`);
    });
  }
  validateExtensions(candidate.extensions, `Provider Result checks[${index}].extensions`);
  return candidate as unknown as ProviderResultCheck;
}

function readLockedRuleIds(invocation: PreparedProviderInvocation): ReadonlySet<string> {
  const catalogPath = safeDestinationPath(invocation.providerRoot, invocation.manifest.ruleset.catalog);
  safeRegularFile(catalogPath, "locked Provider ruleset catalog", MAX_RESULT_BYTES);
  let catalog: unknown;
  try { catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as unknown; } catch { fail("PROVIDER_MANIFEST_INVALID", "locked Provider ruleset catalog is invalid JSON"); }
  if (!isRecord(catalog) || !Array.isArray(catalog.rules)) fail("PROVIDER_MANIFEST_INVALID", "locked Provider ruleset catalog has no rules array");
  const ids = new Set<string>();
  catalog.rules.forEach((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || !IDENTIFIER.test(candidate.id) || ids.has(candidate.id)) fail("PROVIDER_MANIFEST_INVALID", `locked Provider rule ${index} has an invalid/duplicate id`);
    ids.add(candidate.id);
  });
  return ids;
}

/** Validate the only untrusted Provider output and re-check all report digests/paths. */
export function validateProviderResult(invocation: PreparedProviderInvocation): ProviderResultV1_1 {
  const resultPath = resolve(invocation.outputRoot, "result.json");
  safeRegularFile(resultPath, "Provider Result");
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(resultPath, "utf8")) as unknown; } catch { fail("PROVIDER_RESULT_INVALID", "Provider Result is invalid JSON"); }
  const authority = providerResultAuthorityViolations(raw);
  if (authority.length > 0) fail("PROVIDER_RESULT_INVALID", authority.join("; "));
  if (!isRecord(raw)) fail("PROVIDER_RESULT_INVALID", "Provider Result must be an object");
  exact(raw, ["schema", "invocation_id", "status", "checks", "diagnostics", "deferred", "reports", "extensions"], "Provider Result");
  if (raw.schema !== PROVIDER_SCHEMA.result) fail("PROVIDER_SCHEMA_INCOMPATIBLE", `Provider Result schema must be ${PROVIDER_SCHEMA.result}`);
  if (raw.invocation_id !== invocation.invocationId) fail("PROVIDER_RESULT_BINDING_MISMATCH", "Provider Result invocation_id does not match Request");
  if (!(["passed", "failed", "deferred", "error", "cancelled"] as const).includes(raw.status as never)) fail("PROVIDER_RESULT_INVALID", "Provider Result status is invalid");
  if (!Array.isArray(raw.checks)) fail("PROVIDER_RESULT_INVALID", "Provider Result checks must be an array");
  const allowedRules = readLockedRuleIds(invocation);
  const checks = raw.checks.map((candidate, index) => validateResultCheck(candidate, index, allowedRules));
  if (new Set(checks.map((check) => check.rule_id)).size !== checks.length) fail("PROVIDER_RESULT_INVALID", "Provider Result checks contain duplicate rule_id values");
  if (raw.status === "passed" && checks.some((check) => check.status === "failed")) fail("PROVIDER_RESULT_INVALID", "passed Provider Result contains failed checks");
  if (raw.status === "failed" && !checks.some((check) => check.status === "failed")) fail("PROVIDER_RESULT_INVALID", "failed Provider Result must contain at least one failed check");

  if (!Array.isArray(raw.diagnostics)) fail("PROVIDER_RESULT_INVALID", "Provider Result diagnostics must be an array");
  raw.diagnostics.forEach((candidate, index) => {
    if (!isRecord(candidate)) fail("PROVIDER_RESULT_INVALID", `Provider Result diagnostics[${index}] must be an object`);
    exact(candidate, ["code", "message", "details"], `Provider Result diagnostics[${index}]`);
    if (!P0_PROVIDER_DIAGNOSTICS.some((entry) => entry.emitter === "provider" && entry.code === candidate.code)) fail("PROVIDER_RESULT_INVALID", `Provider Result diagnostics[${index}].code is not Provider-owned`);
    text(candidate.message, `Provider Result diagnostics[${index}].message`);
    if (candidate.details !== undefined && !isRecord(candidate.details)) fail("PROVIDER_RESULT_INVALID", `Provider Result diagnostics[${index}].details must be an object`);
  });
  if (raw.status === "deferred") {
    if (!isRecord(raw.deferred)) fail("PROVIDER_DEFERRED_NOT_ALLOWED", "deferred Provider Result lacks bounded metadata");
    exact(raw.deferred, ["reason", "retry_after", "deadline", "required_inputs"], "Provider Result deferred");
    text(raw.deferred.reason, "Provider Result deferred.reason");
    if (typeof raw.deferred.retry_after !== "string" || !UTC.test(raw.deferred.retry_after) || typeof raw.deferred.deadline !== "string" || !UTC.test(raw.deferred.deadline)) fail("PROVIDER_DEFERRED_NOT_ALLOWED", "deferred timestamps must be UTC RFC 3339");
    const retry = Date.parse(raw.deferred.retry_after);
    const deadline = Date.parse(raw.deferred.deadline);
    if (!Number.isFinite(retry) || !Number.isFinite(deadline) || retry > deadline || deadline <= Date.now()) fail("PROVIDER_DEFERRED_NOT_ALLOWED", "deferred timestamps must be valid, ordered, and have a future deadline");
    if (raw.deferred.required_inputs !== undefined && (!Array.isArray(raw.deferred.required_inputs) || raw.deferred.required_inputs.some((entry) => typeof entry !== "string" || !entry.trim()))) fail("PROVIDER_DEFERRED_NOT_ALLOWED", "deferred required_inputs must be non-empty strings");
  } else if (raw.deferred !== undefined) fail("PROVIDER_RESULT_INVALID", "only deferred Result may include deferred metadata");

  if (!Array.isArray(raw.reports)) fail("PROVIDER_RESULT_INVALID", "Provider Result reports must be an array");
  const declaredReports = new Set<string>();
  raw.reports.forEach((candidate, index) => {
    if (!isRecord(candidate)) fail("PROVIDER_RESULT_INVALID", `Provider Result reports[${index}] must be an object`);
    exact(candidate, ["path", "media_type", "digest"], `Provider Result reports[${index}]`);
    const path = text(candidate.path, `Provider Result reports[${index}].path`);
    if (!isPortableProviderPath(path) || !path.startsWith("reports/")) fail("PROVIDER_PATH_ESCAPE", `Provider report path must stay under reports/: ${path}`);
    if (declaredReports.has(path)) fail("PROVIDER_RESULT_INVALID", `Provider Result declares duplicate report ${path}`);
    declaredReports.add(path);
    text(candidate.media_type, `Provider Result reports[${index}].media_type`);
    const expected = digest(candidate.digest, `Provider Result reports[${index}].digest`);
    const report = safeDestinationPath(invocation.outputRoot, path);
    safeRegularFile(report, `Provider report ${path}`, invocation.request.limits.output_bytes);
    if (sha256FileDigest(readFileSync(report)) !== expected) fail("PROVIDER_RESULT_INVALID", `Provider report ${path} digest does not match content`);
  });
  validateExtensions(raw.extensions, "Provider Result extensions");

  const output = walkOutput(invocation.outputRoot);
  if (output.bytes > invocation.request.limits.output_bytes) fail("PROVIDER_PERMISSION_DENIED", `Provider output exceeds ${invocation.request.limits.output_bytes} bytes`);
  for (const file of output.files) {
    if (file !== "result.json" && !declaredReports.has(file)) fail("PROVIDER_RESULT_INVALID", `Provider wrote undeclared output file ${file}`);
  }
  return raw as unknown as ProviderResultV1_1;
}

function completeControls(probe: RestrictedSandboxProbe): boolean {
  return probe.supported && Object.values(probe.controls).every(Boolean);
}

export interface ControlledProviderRunOptions {
  readonly plan: string | ProviderPlanV1_1;
  readonly nodeId: string;
  readonly inputs?: readonly ProviderRunInput[];
  readonly limits?: Partial<ProviderRunLimits>;
  readonly signal?: AbortSignal;
  readonly sandbox?: RestrictedSandboxAdapter;
  readonly signer?: ProviderArtifactSigner;
  readonly evidenceStore?: ProviderEvidenceStore;
  readonly now?: Date;
  readonly validitySeconds?: number;
  readonly keepInvocationDirectory?: boolean;
}

export interface ControlledProviderRunResult {
  readonly invocation_id: string;
  readonly request_digest: Sha256Digest;
  readonly result_digest: Sha256Digest;
  readonly evidence_id: string;
  readonly evidence_path: string;
  readonly status: ProviderResultV1_1["status"];
  readonly summary: { readonly passed: number; readonly failed: number; readonly not_applicable: number };
  readonly logs: { readonly stdout: string; readonly stderr: string };
}

/** Execute one selected Plan node. Any sandbox/process/Result failure publishes no accepted Evidence. */
export async function runControlledProvider(project: string, options: ControlledProviderRunOptions): Promise<ControlledProviderRunResult> {
  const projectRoot = realpathSync(resolve(project));
  const plan = typeof options.plan === "string" ? loadFrozenProviderPlan(projectRoot, options.plan) : options.plan;
  if (recomputePlanId(plan) !== plan.plan_id || recomputePlanDigest(plan) !== plan.plan_digest) fail("PROVIDER_PLAN_STALE", "Provider Plan identity or digest is invalid");
  if (options.signal?.aborted) fail("PROVIDER_CANCELLED", "Provider invocation was cancelled before start");
  const adapter = options.sandbox ?? new BubblewrapRestrictedSandbox();
  const probe = await adapter.probe();
  if (!completeControls(probe)) fail("PROVIDER_SANDBOX_UNAVAILABLE", probe.reason || `${probe.adapter} cannot enforce every restricted-v1 control`);
  const invocation = prepareInvocation(projectRoot, plan, options.nodeId, options.inputs ?? [], options.limits ?? {});
  try {
    let execution: RestrictedSandboxExecution;
    try {
      execution = await adapter.execute(invocation, options.signal);
    } catch (error) {
      if (error instanceof ProviderRunnerError) throw error;
      fail("PROVIDER_PROCESS_ERROR", `Provider process could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (execution.cancelled || options.signal?.aborted) fail("PROVIDER_CANCELLED", "Provider invocation was cancelled");
    if (execution.timedOut) fail("PROVIDER_TIMEOUT", `Provider invocation exceeded ${invocation.request.limits.wall_time_ms} ms`);
    if (execution.exitCode !== 0 || execution.signal) fail("PROVIDER_PROCESS_ERROR", `Provider process exited with code ${execution.exitCode ?? "null"}${execution.signal ? ` signal ${execution.signal}` : ""}`);
    const result = validateProviderResult(invocation);
    const signer = options.signer ?? localProviderArtifactSigner(projectRoot, true);
    const evidence = createAcceptedProviderEvidence(invocation.request, result, {
      signer,
      now: options.now,
      validitySeconds: options.validitySeconds,
    });
    const store = options.evidenceStore ?? new LocalProviderEvidenceStore(projectRoot);
    const evidencePath = store.put(evidence);
    return {
      invocation_id: invocation.invocationId,
      request_digest: sha256ProviderDigest(invocation.request),
      result_digest: sha256ProviderDigest(result),
      evidence_id: evidence.evidence_id,
      evidence_path: evidencePath,
      status: result.status,
      summary: evidence.summary,
      logs: { stdout: redactLog(execution.stdout), stderr: redactLog(execution.stderr) },
    };
  } finally {
    if (!options.keepInvocationDirectory) rmSync(invocation.sandboxRoot, { recursive: true, force: true });
  }
}

/** Public restricted-v1 capability probe used by `provider probe`; it never executes Provider code. */
export async function probeRestrictedV1Sandbox(adapter: RestrictedSandboxAdapter = new BubblewrapRestrictedSandbox()): Promise<RestrictedSandboxProbe> {
  return adapter.probe();
}
