import { createHash } from "crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { spawnSync } from "child_process";
import { assertClaimReceiptForStateV3, claimReceiptDigestV3, validateClaimReceiptV3, type ClaimReceiptV3 } from "./aidlc-coordination-local-v3";
import { loadWorkflowStateV3 } from "./aidlc-state-v3-store";
import { readSourceRevision } from "./aidlc-revision";
import { signTeamRecord, verifyRecord, type IntegrityEnvelope } from "./aidlc-trust";

const METADATA_KIND = "aidlc.v3-worktree";
const METADATA_SCHEMA = 1;
const SAFE_BRANCH = /^aidlc-worktree\/[a-z0-9][a-z0-9/-]{0,120}$/;
const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9._-]+$/;

export interface WorktreeMetadataV3 extends Record<string, unknown> {
  schema_version: 1;
  kind: "aidlc.v3-worktree";
  authoritative: false;
  workflow_id: string;
  stage_instance: string;
  claim_receipt_digest: string;
  base_commit: string;
  base_source_digest: string;
  branch: string;
  worktree_path: string;
  created_at: string;
  integrity: IntegrityEnvelope;
}

interface UnsignedWorktreeMetadataV3 {
  schema_version: 1;
  kind: "aidlc.v3-worktree";
  authoritative: false;
  workflow_id: string;
  stage_instance: string;
  claim_receipt_digest: string;
  base_commit: string;
  base_source_digest: string;
  branch: string;
  worktree_path: string;
  created_at: string;
}

export interface PreparedWorktreeV3 {
  metadata: WorktreeMetadataV3;
  registry_path: string;
  worktree_metadata_path: string;
}

export interface WorktreeMergePlanV3 {
  schema_version: 1;
  kind: "aidlc.v3-worktree.merge-plan";
  authorized: false;
  workflow_id: string;
  stage_instance: string;
  branch: string;
  worktree_path: string;
  base_commit: string;
  head_commit: string;
  changed_paths: string[];
  review_evidence: string;
  merge_command: string;
}

interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
  error?: Error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function digest(value: unknown, field: string): string {
  const result = text(value, field).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${field} must be a SHA-256 digest`);
  return result;
}

function commit(value: unknown, field: string): string {
  const result = text(value, field).toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(result)) throw new Error(`${field} must be a Git commit ID`);
  return result;
}

function timestamp(value: unknown, field: string): string {
  const result = text(value, field);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${field} must be an ISO timestamp`);
  return result;
}

function inside(root: string, candidate: string): boolean {
  const result = relative(root, candidate);
  return result === "" || (!isAbsolute(result) && result !== ".." && !result.startsWith(`..${sep}`));
}

function regularDirectory(path: string, field: string): string {
  const candidate = resolve(path);
  if (!existsSync(candidate)) throw new Error(`${field} does not exist: ${candidate}`);
  const stat = lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${field} must be a regular non-symlink directory: ${candidate}`);
  return realpathSync(candidate);
}

function git(cwd: string, args: string[]): GitResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, maxBuffer: 16 * 1024 * 1024 });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function requiredGit(cwd: string, args: string[], field: string): string {
  const result = git(cwd, args);
  if (result.status !== 0 || result.error) throw new Error(`${field}: ${result.error?.message || result.stderr.trim() || result.stdout.trim() || "Git command failed"}`);
  return result.stdout.trim();
}

function safeStageKey(stageInstance: string): string {
  return createHash("sha256").update(stageInstance).digest("hex").slice(0, 24);
}

function metadataDirectory(projectRoot: string): string {
  const root = resolve(projectRoot, ".aidlc", "worktrees");
  const project = realpathSync(projectRoot);
  if (!inside(project, root)) throw new Error("worktree metadata root escapes project root");
  let cursor = project;
  for (const segment of [".aidlc", "worktrees"]) {
    if (!SAFE_PATH_SEGMENT.test(segment)) throw new Error("invalid internal metadata segment");
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) mkdirSync(cursor, { mode: 0o700 });
    const stat = lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`worktree metadata directory must be a regular non-symlink directory: ${cursor}`);
    const real = realpathSync(cursor);
    if (!inside(project, real)) throw new Error(`worktree metadata directory resolves outside project root: ${cursor}`);
  }
  return root;
}

function metadataPath(projectRoot: string, stageInstance: string): string {
  return join(metadataDirectory(projectRoot), `${safeStageKey(stageInstance)}.json`);
}

function worktreeMetadataPath(worktree: string, stageInstance: string): string {
  const root = resolve(worktree, ".aidlc", "worktrees");
  if (!inside(worktree, root)) throw new Error("worktree metadata root escapes worktree");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const path of [resolve(worktree, ".aidlc"), root]) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`worktree metadata directory must be a regular non-symlink directory: ${path}`);
  }
  return join(root, `${safeStageKey(stageInstance)}.json`);
}

function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function signedMetadata(unsigned: UnsignedWorktreeMetadataV3): WorktreeMetadataV3 {
  const signable: Record<string, unknown> = { ...unsigned };
  return {
    schema_version: unsigned.schema_version,
    kind: unsigned.kind,
    authoritative: unsigned.authoritative,
    workflow_id: unsigned.workflow_id,
    stage_instance: unsigned.stage_instance,
    claim_receipt_digest: unsigned.claim_receipt_digest,
    base_commit: unsigned.base_commit,
    base_source_digest: unsigned.base_source_digest,
    branch: unsigned.branch,
    worktree_path: unsigned.worktree_path,
    created_at: unsigned.created_at,
    integrity: signTeamRecord(signable),
  };
}

function parseMetadata(value: unknown): WorktreeMetadataV3 {
  if (!isRecord(value)) throw new Error("worktree metadata must be an object");
  const keys = new Set([
    "schema_version", "kind", "authoritative", "workflow_id", "stage_instance", "claim_receipt_digest",
    "base_commit", "base_source_digest", "branch", "worktree_path", "created_at", "integrity",
  ]);
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new Error(`worktree metadata has unknown field ${key}`);
  if (value.schema_version !== METADATA_SCHEMA || value.kind !== METADATA_KIND || value.authoritative !== false) {
    throw new Error("worktree metadata schema mismatch");
  }
  const integrity = verifyRecord(value);
  if (integrity) throw new Error(`worktree metadata integrity failed: ${integrity}`);
  const branch = text(value.branch, "worktree metadata.branch");
  if (!SAFE_BRANCH.test(branch)) throw new Error("worktree metadata.branch is invalid");
  return {
    ...value,
    schema_version: 1,
    kind: METADATA_KIND,
    authoritative: false,
    workflow_id: text(value.workflow_id, "worktree metadata.workflow_id"),
    stage_instance: text(value.stage_instance, "worktree metadata.stage_instance"),
    claim_receipt_digest: digest(value.claim_receipt_digest, "worktree metadata.claim_receipt_digest"),
    base_commit: commit(value.base_commit, "worktree metadata.base_commit"),
    base_source_digest: digest(value.base_source_digest, "worktree metadata.base_source_digest"),
    branch,
    worktree_path: regularDirectory(text(value.worktree_path, "worktree metadata.worktree_path"), "worktree metadata.worktree_path"),
    created_at: timestamp(value.created_at, "worktree metadata.created_at"),
    integrity: value.integrity as IntegrityEnvelope,
  } as WorktreeMetadataV3;
}

function readMetadata(projectRoot: string, stageInstance: string): WorktreeMetadataV3 {
  const path = metadataPath(projectRoot, stageInstance);
  if (!existsSync(path)) throw new Error(`no managed worktree metadata exists for ${stageInstance}`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`worktree metadata must be a regular non-symlink file: ${path}`);
  return parseMetadata(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

function cleanRevision(root: string): { commit: string; worktree_digest: string } {
  const revision = readSourceRevision(root);
  if (!/^[a-f0-9]{40,64}$/i.test(revision.commit) || revision.dirty !== false || !revision.worktree_digest) {
    throw new Error("worktree adapter requires a clean Git source tree with a stable source digest");
  }
  return { commit: revision.commit.toLowerCase(), worktree_digest: revision.worktree_digest };
}

function validateMainWorktree(projectRoot: string): void {
  const top = requiredGit(projectRoot, ["rev-parse", "--show-toplevel"], "Git project root could not be resolved");
  if (realpathSync(top) !== projectRoot) throw new Error("worktree adapter must run from the main Git worktree root");
}

function safeWorktreePath(projectRoot: string, input: string): string {
  const candidate = resolve(input);
  if (inside(projectRoot, candidate)) throw new Error("worktree path must be outside the main project root");
  if (existsSync(candidate)) throw new Error(`worktree path already exists: ${candidate}`);
  const parent = dirname(candidate);
  const realParent = regularDirectory(parent, "worktree parent directory");
  if (!inside(realParent, candidate)) throw new Error("worktree path escapes its verified parent directory");
  return candidate;
}

function branchName(workflowId: string, stageInstance: string, requested?: string): string {
  const name = requested || `aidlc-worktree/${workflowId.slice(0, 12)}/${safeStageKey(stageInstance)}`;
  if (!SAFE_BRANCH.test(name)) throw new Error("worktree branch must match aidlc-worktree/<safe-name>");
  return name;
}

function readReceipt(input: string): ClaimReceiptV3 {
  const parsed = JSON.parse(input) as unknown;
  return validateClaimReceiptV3(parsed, true);
}

export function prepareV3Worktree(
  projectRoot: string,
  stageInstance: string,
  receiptValue: ClaimReceiptV3,
  path: string,
  requestedBranch?: string,
): PreparedWorktreeV3 {
  const project = regularDirectory(projectRoot, "project root");
  validateMainWorktree(project);
  const state = loadWorkflowStateV3(project);
  if (!state) throw new Error("worktree adapter requires an initialized schema v3 workflow");
  const receipt = assertClaimReceiptForStateV3(state, receiptValue, stageInstance);
  if (state.instances[stageInstance]?.status !== "in_progress") throw new Error(`worktree adapter requires an in_progress stage instance: ${stageInstance}`);
  const revision = cleanRevision(project);
  const target = safeWorktreePath(project, path);
  const branch = branchName(state.workflow_id, stageInstance, requestedBranch);
  if (git(project, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0) {
    throw new Error(`worktree branch already exists: ${branch}`);
  }
  requiredGit(project, ["worktree", "add", "-b", branch, target, revision.commit], "Git worktree creation failed");
  try {
    const metadata = signedMetadata({
      schema_version: 1,
      kind: METADATA_KIND,
      authoritative: false,
      workflow_id: state.workflow_id,
      stage_instance: stageInstance,
      claim_receipt_digest: claimReceiptDigestV3(receipt),
      base_commit: revision.commit,
      base_source_digest: revision.worktree_digest,
      branch,
      worktree_path: target,
      created_at: new Date().toISOString(),
    });
    const registry = metadataPath(project, stageInstance);
    const worktreeRecord = worktreeMetadataPath(target, stageInstance);
    atomicWrite(registry, `${JSON.stringify(metadata, null, 2)}\n`);
    atomicWrite(worktreeRecord, `${JSON.stringify(metadata, null, 2)}\n`);
    return { metadata, registry_path: registry, worktree_metadata_path: worktreeRecord };
  } catch (error) {
    git(project, ["worktree", "remove", "--force", target]);
    git(project, ["branch", "-D", branch]);
    throw error;
  }
}

function safeReviewPath(worktree: string, value: string): string {
  const path = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("review evidence path must be a safe worktree-relative path");
  }
  const absolute = resolve(worktree, path);
  if (!inside(worktree, absolute) || !existsSync(absolute)) throw new Error(`review evidence path does not exist inside worktree: ${path}`);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("review evidence must be a regular non-symlink file");
  return absolute;
}

function reviewCoverage(worktree: string, reviewPath: string, headCommit: string): string[] {
  const record = JSON.parse(readFileSync(reviewPath, "utf8")) as unknown;
  if (!isRecord(record)) throw new Error("review evidence must be a JSON object");
  const integrity = verifyRecord(record);
  if (integrity) throw new Error(`review evidence integrity failed: ${integrity}`);
  if (record.evidence_version !== "1" || record.status !== "passed" || record.spec_axis !== "passed" || record.standards_axis !== "passed") {
    throw new Error("review evidence is not a passing dual-axis review");
  }
  if (typeof record.reviewer !== "string" || record.reviewer.trim().length === 0 || record.issues_open !== 0) {
    throw new Error("review evidence lacks a reviewer or still has open issues");
  }
  if (!Array.isArray(record.files_reviewed) || record.files_reviewed.length === 0 || !record.files_reviewed.every((item) => typeof item === "string")) {
    throw new Error("review evidence files_reviewed must be a non-empty string array");
  }
  const revision = isRecord(record.source_revision) ? record.source_revision : undefined;
  if (!revision || revision.commit !== headCommit || revision.dirty !== false) {
    throw new Error("review evidence source revision is not bound to the committed worktree head");
  }
  const current = cleanRevision(worktree);
  if (current.commit !== headCommit || revision.worktree_digest !== current.worktree_digest) {
    throw new Error("review evidence worktree digest does not match the current committed worktree");
  }
  return [...new Set(record.files_reviewed.map((item) => {
    const path = item.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!path || path.startsWith("/") || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error("review evidence contains an unsafe reviewed path");
    }
    return path;
  }))].sort();
}

function changedPaths(worktree: string, base: string, head: string): string[] {
  const output = requiredGit(worktree, ["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", base, head, "--"], "worktree changed paths could not be read");
  return [...new Set(output.split("\0").filter(Boolean).map((value) => value.replace(/\\/g, "/")))].sort();
}

function worktreeRegistered(project: string, worktree: string): boolean {
  const output = requiredGit(project, ["worktree", "list", "--porcelain"], "Git worktree registry could not be read");
  return output.split(/\r?\n/).some((line) => line === `worktree ${worktree}`);
}

export function createV3WorktreeMergePlan(
  projectRoot: string,
  stageInstance: string,
  receiptValue: ClaimReceiptV3,
  worktreePath: string,
  reviewEvidencePath: string,
): WorktreeMergePlanV3 {
  const project = regularDirectory(projectRoot, "project root");
  validateMainWorktree(project);
  const metadata = readMetadata(project, stageInstance);
  const providedWorktree = regularDirectory(worktreePath, "worktree path");
  if (providedWorktree !== metadata.worktree_path || !worktreeRegistered(project, providedWorktree)) {
    throw new Error("worktree path does not match a registered managed worktree");
  }
  const state = loadWorkflowStateV3(project);
  if (!state || state.workflow_id !== metadata.workflow_id) throw new Error("managed worktree workflow does not match current schema v3 workflow");
  const receipt = assertClaimReceiptForStateV3(state, receiptValue, stageInstance);
  if (claimReceiptDigestV3(receipt) !== metadata.claim_receipt_digest) throw new Error("claim receipt does not match managed worktree metadata");
  const branch = requiredGit(providedWorktree, ["branch", "--show-current"], "worktree branch could not be read");
  if (branch !== metadata.branch) throw new Error("worktree branch does not match managed metadata");
  const revision = cleanRevision(providedWorktree);
  if (git(providedWorktree, ["merge-base", "--is-ancestor", metadata.base_commit, revision.commit]).status !== 0) {
    throw new Error("worktree head is not descended from the managed base commit");
  }
  const changed = changedPaths(providedWorktree, metadata.base_commit, revision.commit);
  if (changed.length === 0) throw new Error("worktree has no committed source changes beyond its managed base");
  const review = safeReviewPath(providedWorktree, reviewEvidencePath);
  const reviewed = new Set(reviewCoverage(providedWorktree, review, revision.commit));
  const uncovered = changed.filter((path) => !reviewed.has(path));
  if (uncovered.length > 0) throw new Error(`review evidence does not cover all committed worktree changes: ${uncovered.join(", ")}`);
  return {
    schema_version: 1,
    kind: "aidlc.v3-worktree.merge-plan",
    authorized: false,
    workflow_id: metadata.workflow_id,
    stage_instance: metadata.stage_instance,
    branch: metadata.branch,
    worktree_path: metadata.worktree_path,
    base_commit: metadata.base_commit,
    head_commit: revision.commit,
    changed_paths: changed,
    review_evidence: relative(providedWorktree, review).replaceAll(sep, "/"),
    merge_command: `git -C ${JSON.stringify(project)} merge --no-ff ${JSON.stringify(metadata.branch)}`,
  };
}

function usage(): void {
  process.stdout.write("Usage: loeyae-aidlc worktree <prepare|verify|merge-plan> --instance <id> --path <path> --claim-receipt-stdin [--review-evidence <path>] [--branch <name>] [--project <path>]\n");
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new Error(`unexpected worktree argument: ${arg}`);
    if (arg === "--claim-receipt-stdin") {
      flags.claim_receipt_stdin = "true";
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    flags[arg.slice(2)] = value;
  }
  return flags;
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "--help" || command === "-h" || !command) {
    usage();
    return;
  }
  if (command !== "prepare" && command !== "verify" && command !== "merge-plan") throw new Error(`unknown worktree command: ${command}`);
  const flags = parseFlags(rest);
  if (flags.claim_receipt_stdin !== "true") throw new Error("worktree commands require --claim-receipt-stdin");
  const stageInstance = text(flags.instance, "--instance");
  const receipt = readReceipt(readFileSync(0, "utf8"));
  const project = flags.project || process.cwd();
  if (command === "prepare") {
    process.stdout.write(`${JSON.stringify(prepareV3Worktree(project, stageInstance, receipt, text(flags.path, "--path"), flags.branch), null, 2)}\n`);
    return;
  }
  const plan = createV3WorktreeMergePlan(project, stageInstance, receipt, text(flags.path, "--path"), text(flags["review-evidence"], "--review-evidence"));
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`Worktree adapter blocked: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
