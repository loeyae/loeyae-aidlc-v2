/**
 * aidlc-module-ledger.ts — append-only module checkpoint ledger (MARS-159 B).
 *
 * Split-layout module state lives in aidlc/active/modules/<id>/aidlc-state.md and travels
 * with ordinary feature branches. When such a branch is squashed or deleted, nothing in the
 * repository guarantees that the module's latest state and contract view are still
 * reachable. The ledger keeps one dedicated ref per module,
 *
 *   refs/heads/aidlc/modules/<module-id>
 *
 * whose commits form an append-only chain of checkpoints. Each checkpoint commit is built
 * with git plumbing only (hash-object / mktree / commit-tree / update-ref with a
 * compare-and-swap old value): the worktree, the index and HEAD are never touched. A
 * checkpoint tree holds
 *
 *   checkpoint.json   identity, revision, lineage, file digests, contract snapshot, digest
 *   aidlc-state.md    the module workflow state, byte for byte
 *   audit.md          the module audit, byte for byte (when present)
 *
 * The ledger is never pushed automatically; callers print the publish command and warn
 * while the checkpoint is not on the remote. Only a published, protected ref (no deletion,
 * no force-push of aidlc/modules/*) makes the "anyone can recover" promise hold.
 */

import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { runSync } from "./aidlc-spawn";
import { contractTableRowsForModule } from "./aidlc-contract-table";
import { readModuleManifest } from "./aidlc-execution-context";
import { lightAuditPath, lightStatePath, parseLightWorkflowState, type WorkflowState } from "./aidlc-light-state";

export const LEDGER_REMOTE = "origin";
const MODULE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;
const OBJECT_ID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CHECKPOINT_FILE = "checkpoint.json";
const STATE_FILE = "aidlc-state.md";
const AUDIT_FILE = "audit.md";
/** Safety cap for chain walks; a module ledger with more checkpoints is reported, not truncated. */
const MAX_CHAIN = 100_000;

export interface ContractDocumentView {
  path: string;
  git_blob: string | null;
  rows: string[];
  references: string[];
  providers: string[];
  consumers: string[];
}

export interface ModuleContractSnapshot {
  manifest_entry_sha256: string;
  documents: ContractDocumentView[];
  digest: string;
}

export interface ModuleCheckpoint {
  version: "1";
  kind: "aidlc.module-checkpoint";
  module_id: string;
  workflow_id: string;
  lineage: string;
  state_revision: number;
  trigger: string;
  created_at: string;
  source_commit: string | null;
  previous_checkpoint: string | null;
  files: {
    state: { path: string; sha256: string };
    audit: { path: string; sha256: string } | null;
  };
  contracts: ModuleContractSnapshot;
  digest: string;
}

export interface VerifiedCheckpoint {
  commit: string;
  checkpoint: ModuleCheckpoint;
  state_text: Buffer;
  audit_text: Buffer | null;
  state: WorkflowState;
  chain_length: number;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
}

function canonical(value: unknown): string {
  return JSON.stringify(stable(value));
}

function git(root: string, args: string[], input?: string | Buffer): { ok: boolean; stdout: string; stderr: string } {
  const result = runSync("git", args, { cwd: root, encoding: "utf8", shell: false, ...(input !== undefined ? { input } : {}) });
  return { ok: !result.error && result.status === 0, stdout: String(result.stdout || ""), stderr: String(result.stderr || "").trim() };
}

function gitBuffer(root: string, args: string[]): Buffer | null {
  const result = runSync("git", args, { cwd: root, shell: false });
  if (result.error || result.status !== 0) return null;
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout || ""));
}

function assertModuleId(moduleId: string): void {
  if (!MODULE_ID.test(moduleId)) throw new Error(`invalid module id: ${moduleId}`);
}

export function ledgerRef(moduleId: string): string {
  assertModuleId(moduleId);
  return `refs/heads/aidlc/modules/${moduleId}`;
}

export function remoteLedgerRef(moduleId: string, remote = LEDGER_REMOTE): string {
  assertModuleId(moduleId);
  return `refs/remotes/${remote}/aidlc/modules/${moduleId}`;
}

export function ledgerPublishCommand(moduleId: string, remote = LEDGER_REMOTE): string {
  const ref = ledgerRef(moduleId);
  return `git push ${remote} ${ref}:${ref}`;
}

export function ledgerFetchCommand(remote = LEDGER_REMOTE): string {
  return `git fetch ${remote} "refs/heads/aidlc/modules/*:refs/remotes/${remote}/aidlc/modules/*"`;
}

export function gitRepositoryAvailable(root: string): boolean {
  return git(root, ["rev-parse", "--git-dir"]).ok;
}

function resolveRef(root: string, ref: string): string | null {
  const result = git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  const value = result.stdout.trim();
  return result.ok && OBJECT_ID.test(value) ? value : null;
}

function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  return git(root, ["merge-base", "--is-ancestor", ancestor, descendant]).ok;
}

function headCommit(root: string): string | null {
  return resolveRef(root, "HEAD");
}

function contractDocuments(root: string): string[] {
  const base = join(root, "docs", "aidlc");
  if (!existsSync(base)) return [];
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && (entry.name === "product-contracts.md" || entry.name === "runtime-dependencies.md")) result.push(path);
    }
  };
  visit(base);
  return result.sort();
}

/**
 * Normalized contract view of one module in the current checkout: its manifest entry and,
 * per contract document, the provided/consumed rows that involve it. The digest covers the
 * module's view only, so unrelated rows of another module never invalidate a checkpoint.
 */
export function moduleContractSnapshot(root: string, moduleId: string): ModuleContractSnapshot {
  assertModuleId(moduleId);
  const modules = readModuleManifest(root);
  const entry = modules.find((module) => module.module_id === moduleId);
  if (!entry) throw new Error(`module ${moduleId} is not declared in docs/aidlc/ideation/module-manifest.json`);
  const documents: ContractDocumentView[] = [];
  for (const path of contractDocuments(root)) {
    const view = contractTableRowsForModule(readFileSync(path, "utf8"), modules, moduleId);
    if (view.rows.length === 0 && view.references.length === 0) continue;
    const label = relative(root, path).replace(/\\/g, "/");
    const blob = git(root, ["hash-object", "--", label]);
    documents.push({
      path: label,
      git_blob: blob.ok && OBJECT_ID.test(blob.stdout.trim()) ? blob.stdout.trim() : null,
      rows: view.rows,
      references: view.references,
      providers: view.providers,
      consumers: view.consumers,
    });
  }
  const manifestEntry = sha256(canonical(entry));
  const digest = sha256(canonical({ manifest_entry_sha256: manifestEntry, documents: documents.map(({ git_blob: _blob, ...view }) => view) }));
  return { manifest_entry_sha256: manifestEntry, documents, digest };
}

function checkpointDigest(checkpoint: Omit<ModuleCheckpoint, "digest"> | ModuleCheckpoint): string {
  const { digest: _digest, ...body } = checkpoint as ModuleCheckpoint;
  return sha256(canonical(body));
}

function parseCheckpoint(raw: string, label: string): ModuleCheckpoint {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label}: checkpoint.json is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!value || typeof value !== "object" || value.version !== "1" || value.kind !== "aidlc.module-checkpoint") throw new Error(`${label}: unsupported checkpoint version or kind`);
  for (const key of ["module_id", "workflow_id", "lineage", "trigger", "created_at"]) {
    if (typeof value[key] !== "string" || !(value[key] as string)) throw new Error(`${label}: checkpoint.${key} is missing`);
  }
  if (!Number.isInteger(value.state_revision) || (value.state_revision as number) < 0) throw new Error(`${label}: checkpoint.state_revision is invalid`);
  if (typeof value.digest !== "string" || !SHA256.test(value.digest)) throw new Error(`${label}: checkpoint.digest is invalid`);
  if (value.previous_checkpoint !== null && (typeof value.previous_checkpoint !== "string" || !SHA256.test(value.previous_checkpoint))) throw new Error(`${label}: checkpoint.previous_checkpoint is invalid`);
  const files = value.files as Record<string, unknown> | undefined;
  const state = files?.state as Record<string, unknown> | undefined;
  if (!state || typeof state.sha256 !== "string" || !SHA256.test(state.sha256)) throw new Error(`${label}: checkpoint.files.state is invalid`);
  const contracts = value.contracts as Record<string, unknown> | undefined;
  if (!contracts || typeof contracts.digest !== "string" || !SHA256.test(contracts.digest)) throw new Error(`${label}: checkpoint.contracts is invalid`);
  return value as unknown as ModuleCheckpoint;
}

function commitParents(root: string, commit: string): string[] {
  const result = git(root, ["rev-list", "--parents", "-n", "1", commit]);
  if (!result.ok) throw new Error(`cannot read ledger commit ${commit}`);
  return result.stdout.trim().split(/\s+/).slice(1).filter(Boolean);
}

function readEntry(root: string, commit: string, name: string): Buffer | null {
  return gitBuffer(root, ["cat-file", "blob", `${commit}:${name}`]);
}

/** One checkpoint commit: its own digest, file digests, identity and the state it carries. */
function readCheckpointCommit(root: string, moduleId: string, commit: string): { checkpoint: ModuleCheckpoint; state_text: Buffer; audit_text: Buffer | null; state: WorkflowState } {
  const label = `ledger checkpoint ${commit.slice(0, 12)}`;
  const raw = readEntry(root, commit, CHECKPOINT_FILE);
  if (!raw) throw new Error(`${label} has no ${CHECKPOINT_FILE} (corrupted ledger)`);
  const checkpoint = parseCheckpoint(raw.toString("utf8"), label);
  if (checkpointDigest(checkpoint) !== checkpoint.digest) throw new Error(`${label}: digest does not match its content (corrupted or modified checkpoint)`);
  if (checkpoint.module_id !== moduleId) throw new Error(`${label} belongs to module ${checkpoint.module_id}, not ${moduleId}`);
  const stateText = readEntry(root, commit, STATE_FILE);
  if (!stateText || sha256(stateText) !== checkpoint.files.state.sha256) throw new Error(`${label}: ${STATE_FILE} is missing or does not match its recorded digest`);
  const auditText = readEntry(root, commit, AUDIT_FILE);
  if (checkpoint.files.audit) {
    if (!auditText || sha256(auditText) !== checkpoint.files.audit.sha256) throw new Error(`${label}: ${AUDIT_FILE} is missing or does not match its recorded digest`);
  } else if (auditText) {
    throw new Error(`${label}: carries an unrecorded ${AUDIT_FILE}`);
  }
  let state: WorkflowState;
  try {
    state = parseLightWorkflowState(stateText.toString("utf8").replace(/\r\n/g, "\n"));
  } catch (error) {
    throw new Error(`${label}: ${STATE_FILE} is not a readable workflow state (${error instanceof Error ? error.message : String(error)})`);
  }
  if (state.workflow_kind !== "module" || state.module_id !== moduleId) throw new Error(`${label}: ${STATE_FILE} is not the module workflow of ${moduleId}`);
  if (state.workflow_id !== checkpoint.workflow_id || (state.parent_workflow_id || "-") !== checkpoint.lineage || state.revision !== checkpoint.state_revision) {
    throw new Error(`${label}: recorded identity/revision does not match ${STATE_FILE}`);
  }
  return { checkpoint, state_text: stateText, audit_text: auditText, state };
}

/**
 * Verifies a ledger head and its whole chain: every commit has at most one parent, every
 * checkpoint's digest/file digests are intact, each previous_checkpoint names the parent's
 * digest, and the state revision never decreases within one workflow ID. Fails closed on
 * any break; nothing is skipped or repaired.
 */
export function verifyLedgerChain(root: string, moduleId: string, head: string): VerifiedCheckpoint {
  const top = readCheckpointCommit(root, moduleId, head);
  let child = top.checkpoint;
  let commit = head;
  let length = 1;
  for (;;) {
    const parents = commitParents(root, commit);
    if (parents.length > 1) throw new Error(`ledger commit ${commit.slice(0, 12)} has ${parents.length} parents; a module ledger is a linear chain`);
    if (parents.length === 0) {
      if (child.previous_checkpoint !== null) throw new Error(`ledger chain of ${moduleId} is discontinuous: ${commit.slice(0, 12)} names a previous checkpoint that is not present`);
      break;
    }
    const parent = parents[0];
    const previous = readCheckpointCommit(root, moduleId, parent).checkpoint;
    if (child.previous_checkpoint !== previous.digest) throw new Error(`ledger chain of ${moduleId} is discontinuous at ${commit.slice(0, 12)}: previous_checkpoint does not match the parent checkpoint`);
    if (previous.workflow_id === child.workflow_id && previous.state_revision > child.state_revision) {
      throw new Error(`ledger chain of ${moduleId} regresses at ${commit.slice(0, 12)}: revision ${child.state_revision} after ${previous.state_revision}`);
    }
    child = previous;
    commit = parent;
    length++;
    if (length > MAX_CHAIN) throw new Error(`ledger chain of ${moduleId} exceeds ${MAX_CHAIN} checkpoints`);
  }
  return { commit: head, ...top, chain_length: length };
}

export interface LedgerHeads {
  local: string | null;
  remote: string | null;
}

export function ledgerHeads(root: string, moduleId: string, remote = LEDGER_REMOTE): LedgerHeads {
  return { local: resolveRef(root, ledgerRef(moduleId)), remote: resolveRef(root, remoteLedgerRef(moduleId, remote)) };
}

export interface CheckpointResult {
  status: "created" | "unchanged" | "skipped";
  module_id: string;
  commit?: string;
  revision?: number;
  reason?: string;
  published: boolean;
  publish_command: string;
  warning?: string;
}

function publishWarning(moduleId: string): string {
  return `module checkpoint of ${moduleId} is not published; it is recoverable from this clone only. Publish it: ${ledgerPublishCommand(moduleId)} (protect refs/heads/aidlc/modules/* against deletion and force-push on the remote).`;
}

/**
 * Appends a checkpoint of the module's current state and contract view to its ledger when
 * the state revision or the contract view changed since the ledger head. Never pushes.
 * Returns `skipped` (never throws) when git is unavailable, the module state is missing,
 * or the local state is older than / diverged from the ledger; callers surface the reason.
 */
export function checkpointModule(root: string, moduleId: string, trigger: string, now = new Date().toISOString()): CheckpointResult {
  const base = { module_id: moduleId, publish_command: ledgerPublishCommand(moduleId) };
  try {
    assertModuleId(moduleId);
    if (!gitRepositoryAvailable(root)) return { ...base, status: "skipped", reason: "not a git repository", published: false };
    const ref = { kind: "module" as const, module_id: moduleId };
    const statePath = lightStatePath(root, ref);
    if (!existsSync(statePath)) return { ...base, status: "skipped", reason: `module ${moduleId} has no workflow state`, published: false };
    const stateText = readFileSync(statePath);
    const state = parseLightWorkflowState(stateText.toString("utf8").replace(/\r\n/g, "\n"));
    if (state.workflow_kind !== "module" || state.module_id !== moduleId) return { ...base, status: "skipped", reason: `${statePath} is not the module workflow of ${moduleId}`, published: false };
    const auditPath = lightAuditPath(root, ref);
    const auditText = existsSync(auditPath) ? readFileSync(auditPath) : null;
    const contracts = moduleContractSnapshot(root, moduleId);
    const heads = ledgerHeads(root, moduleId);
    let parent: string | null = heads.local;
    if (heads.local && heads.remote && heads.local !== heads.remote) {
      if (isAncestor(root, heads.local, heads.remote)) parent = heads.remote;
      else if (!isAncestor(root, heads.remote, heads.local)) {
        return { ...base, status: "skipped", reason: `local and remote ledgers of ${moduleId} diverged; recover with orchestrate state recover --module ${moduleId}`, published: false };
      }
    } else if (!heads.local && heads.remote) {
      parent = heads.remote;
    }
    let previous: ModuleCheckpoint | null = null;
    if (parent) {
      previous = verifyLedgerChain(root, moduleId, parent).checkpoint;
      if (previous.workflow_id === state.workflow_id && previous.state_revision > state.revision) {
        return { ...base, status: "skipped", reason: `local state revision ${state.revision} of ${moduleId} is older than ledger revision ${previous.state_revision}; run orchestrate state recover --module ${moduleId}`, published: parent === heads.remote };
      }
      if (previous.workflow_id === state.workflow_id && previous.state_revision === state.revision
        && previous.files.state.sha256 === sha256(stateText) && previous.contracts.digest === contracts.digest) {
        if (heads.local !== parent) git(root, ["update-ref", ledgerRef(moduleId), parent, heads.local || ""]);
        const published = heads.remote === parent;
        return { ...base, status: "unchanged", commit: parent, revision: state.revision, published, ...(published ? {} : { warning: publishWarning(moduleId) }) };
      }
    }
    const body: Omit<ModuleCheckpoint, "digest"> = {
      version: "1",
      kind: "aidlc.module-checkpoint",
      module_id: moduleId,
      workflow_id: state.workflow_id,
      lineage: state.parent_workflow_id || "-",
      state_revision: state.revision,
      trigger,
      created_at: now,
      source_commit: headCommit(root),
      previous_checkpoint: previous ? previous.digest : null,
      files: {
        state: { path: relative(root, statePath).replace(/\\/g, "/"), sha256: sha256(stateText) },
        audit: auditText ? { path: relative(root, auditPath).replace(/\\/g, "/"), sha256: sha256(auditText) } : null,
      },
      contracts,
    };
    const checkpoint: ModuleCheckpoint = { ...body, digest: checkpointDigest(body) };
    const blob = (content: string | Buffer): string => {
      const result = git(root, ["hash-object", "-w", "--stdin"], content);
      const id = result.stdout.trim();
      if (!result.ok || !OBJECT_ID.test(id)) throw new Error(`git hash-object failed: ${result.stderr}`);
      return id;
    };
    const entries = [
      `100644 blob ${blob(stateText)}\t${STATE_FILE}`,
      ...(auditText ? [`100644 blob ${blob(auditText)}\t${AUDIT_FILE}`] : []),
      `100644 blob ${blob(`${JSON.stringify(checkpoint, null, 2)}\n`)}\t${CHECKPOINT_FILE}`,
    ].sort((a, b) => a.split("\t")[1].localeCompare(b.split("\t")[1]));
    const tree = git(root, ["mktree"], `${entries.join("\n")}\n`);
    const treeId = tree.stdout.trim();
    if (!tree.ok || !OBJECT_ID.test(treeId)) throw new Error(`git mktree failed: ${tree.stderr}`);
    const identity = git(root, ["var", "GIT_COMMITTER_IDENT"]).ok;
    const env = identity ? process.env : { ...process.env, GIT_AUTHOR_NAME: "AI-DLC Core", GIT_AUTHOR_EMAIL: "aidlc-core@localhost", GIT_COMMITTER_NAME: "AI-DLC Core", GIT_COMMITTER_EMAIL: "aidlc-core@localhost" };
    const commitResult = runSync("git", ["commit-tree", treeId, ...(parent ? ["-p", parent] : []), "-m", `aidlc checkpoint ${moduleId} r${state.revision} (${trigger})`], { cwd: root, encoding: "utf8", shell: false, env });
    const commit = String(commitResult.stdout || "").trim();
    if (commitResult.error || commitResult.status !== 0 || !OBJECT_ID.test(commit)) throw new Error(`git commit-tree failed: ${String(commitResult.stderr || "").trim()}`);
    // Compare-and-swap: a concurrent writer that moved the ref first makes this append fail.
    const update = git(root, ["update-ref", ledgerRef(moduleId), commit, heads.local || ""]);
    if (!update.ok) throw new Error(`git update-ref ${ledgerRef(moduleId)} failed (concurrent ledger update?): ${update.stderr}`);
    return { ...base, status: "created", commit, revision: state.revision, published: false, warning: publishWarning(moduleId) };
  } catch (error) {
    return { ...base, status: "skipped", reason: error instanceof Error ? error.message : String(error), published: false };
  }
}

/**
 * The highest valid checkpoint among the module's local and remote-tracking ledger heads.
 * Every candidate is verified; a candidate whose chain is broken is reported as an error
 * rather than silently ignored.
 */
export function bestLedgerCheckpoint(root: string, moduleId: string): { best: VerifiedCheckpoint | null; heads: LedgerHeads; errors: string[] } {
  const heads = ledgerHeads(root, moduleId);
  const errors: string[] = [];
  const candidates: Array<VerifiedCheckpoint & { source: "remote" | "local" }> = [];
  for (const [source, head] of [["remote", heads.remote], ["local", heads.local]] as const) {
    if (!head || candidates.some((candidate) => candidate.commit === head)) continue;
    try {
      candidates.push({ ...verifyLedgerChain(root, moduleId, head), source });
    } catch (error) {
      errors.push(`${source} ledger ${source === "remote" ? remoteLedgerRef(moduleId) : ledgerRef(moduleId)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const best = candidates.reduce<(VerifiedCheckpoint & { source: "remote" | "local" }) | null>((winner, candidate) => {
    if (!winner) return candidate;
    if (candidate.checkpoint.state_revision !== winner.checkpoint.state_revision) return candidate.checkpoint.state_revision > winner.checkpoint.state_revision ? candidate : winner;
    return isAncestor(root, winner.commit, candidate.commit) ? candidate : winner;
  }, null);
  return { best, heads, errors };
}
