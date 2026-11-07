/**
 * aidlc-git-merge.ts — engine-provisioned git merge strategy for the `aidlc/active/`
 * control plane (MARS-117).
 *
 * Multi-member AI-DLC collaboration kept producing spurious git conflicts in the shared
 * control plane (state / registry / audit), pushing teams to "keep local and force
 * push", which in turn split the workflow lineage. The engine now provisions and
 * automates a merge strategy so ordinary merges stop conflicting:
 *
 *   A. `.gitattributes`: the `aidlc/active` audit.md glob -> `merge=union`. audit.md is
 *      strictly append-only, ISO-timestamped, non-overlapping blocks (aidlc-light-state.ts
 *      appendAudit / appendAuditEvent), so git's built-in `union` driver keeps every
 *      side's blocks with no conflict markers. union is NEVER applied to state /
 *      registry (structured documents union would corrupt).
 *   B. `.gitattributes`: `aidlc/active/registry.md merge=aidlc-registry`, backed by a
 *      three-way merge driver (`orchestrate registry merge-driver %O %A %B`) that unions
 *      the identity rows by module id, keeps genuine conflicts (one module id pointing
 *      at two Workflow IDs) as conflict markers, and drops the derived projection
 *      columns to be recomputed. The driver implementation does not travel with the
 *      repository (git security), so it is registered idempotently in the local
 *      `.git/config` on install / next.
 *   C. `.gitignore`: the `aidlc/active` backup glob (`*.bak-*`) so engine-produced
 *      backups never become a tracked conflict / noise source.
 *
 * Every provisioning write is idempotent: it creates the file when absent, appends only
 * the missing managed line when present, and never rewrites, reorders or deduplicates
 * the user's existing content. A user line that sets a DIFFERENT strategy for the same
 * pattern is reported, never silently overwritten.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { runSync } from "./aidlc-spawn";
import {
  parseRegistry,
  renderRegistry,
  type RegistryModuleRow,
  type WorkflowRegistry,
} from "./aidlc-workflow-layout";

// ---------------------------------------------------------------------------
// Managed line constants
// ---------------------------------------------------------------------------

/** audit.md is append-only and block-disjoint, so git's `union` driver merges it losslessly. */
export const GITATTRIBUTES_AUDIT_PATTERN = "aidlc/active/**/audit.md";
export const GITATTRIBUTES_AUDIT_ATTR = "merge=union";
export const GITATTRIBUTES_AUDIT_LINE = `${GITATTRIBUTES_AUDIT_PATTERN} ${GITATTRIBUTES_AUDIT_ATTR}`;

/** The registry uses the engine's identity-row union driver (change B). */
export const REGISTRY_MERGE_DRIVER_NAME = "aidlc-registry";
export const GITATTRIBUTES_REGISTRY_PATTERN = "aidlc/active/registry.md";
export const GITATTRIBUTES_REGISTRY_ATTR = `merge=${REGISTRY_MERGE_DRIVER_NAME}`;
export const GITATTRIBUTES_REGISTRY_LINE = `${GITATTRIBUTES_REGISTRY_PATTERN} ${GITATTRIBUTES_REGISTRY_ATTR}`;

/** Engine-produced control-plane backups (e.g. aidlc-state.md.bak-mars35) are noise, not state (change C). */
export const GITIGNORE_BACKUP_LINE = "aidlc/active/**/*.bak-*";

/** The managed `.gitattributes` lines, in the order the engine appends missing ones. */
export const MANAGED_GITATTRIBUTES: readonly { pattern: string; attribute: string; line: string }[] = [
  { pattern: GITATTRIBUTES_AUDIT_PATTERN, attribute: GITATTRIBUTES_AUDIT_ATTR, line: GITATTRIBUTES_AUDIT_LINE },
  { pattern: GITATTRIBUTES_REGISTRY_PATTERN, attribute: GITATTRIBUTES_REGISTRY_ATTR, line: GITATTRIBUTES_REGISTRY_LINE },
];

// ---------------------------------------------------------------------------
// Idempotent provisioning of .gitattributes / .gitignore
// ---------------------------------------------------------------------------

export interface EnsureFileResult {
  /** Absolute path of the file. */
  path: string;
  /** The file did not exist and was created with the managed lines. */
  created: boolean;
  /** Managed lines appended because they were missing (the exact lines added). */
  added: string[];
  /** A pre-existing line that sets a different attribute for a managed pattern (reported, never changed). */
  conflicts: { pattern: string; existing: string; managed: string }[];
}

/** The first whitespace-separated token of a .gitattributes line (its pathspec), or "". */
function attributePattern(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return "";
  return trimmed.split(/\s+/, 1)[0] || "";
}

/** Whether `line` already carries `attribute` as one of its whitespace-separated tokens. */
function hasAttributeToken(line: string, attribute: string): boolean {
  return line.trim().split(/\s+/).slice(1).includes(attribute);
}

function readTextOrNull(path: string): string | null {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`refusing to manage a non-regular file: ${path}`);
  return readFileSync(path, "utf8");
}

/**
 * Append `lines` that are missing to the end of a line-oriented config file, preserving
 * the existing content byte-for-byte (only the newline before the first appended line is
 * normalized when the file did not end with one). Creating a new file writes the managed
 * lines with a trailing newline each. The file's existing EOL is detected and reused so a
 * CRLF file keeps CRLF.
 */
function ensureManagedLines(
  path: string,
  managed: { pattern: string; line: string; conflictAttribute?: string }[],
): EnsureFileResult {
  const existing = readTextOrNull(path);
  const result: EnsureFileResult = { path, created: existing === null, added: [], conflicts: [] };
  const eol = existing && existing.includes("\r\n") ? "\r\n" : "\n";
  const existingLines = existing === null ? [] : existing.split(/\r?\n/);
  const toAppend: string[] = [];
  for (const entry of managed) {
    const already = existingLines.some((line) => line.trim() === entry.line);
    if (already) continue;
    if (entry.conflictAttribute) {
      const samePattern = existingLines.filter((line) => attributePattern(line) === entry.pattern);
      const conflicting = samePattern.filter((line) => !hasAttributeToken(line, entry.conflictAttribute!));
      if (samePattern.length > 0 && conflicting.length === samePattern.length) {
        result.conflicts.push({ pattern: entry.pattern, existing: conflicting[0].trim(), managed: entry.line });
        continue;
      }
      // A same-pattern line that already carries the managed attribute counts as present.
      if (samePattern.some((line) => hasAttributeToken(line, entry.conflictAttribute!))) continue;
    }
    toAppend.push(entry.line);
  }
  if (toAppend.length === 0) return result;
  mkdirSync(dirname(path), { recursive: true });
  let content: string;
  if (existing === null) {
    content = toAppend.map((line) => `${line}${eol}`).join("");
  } else {
    const needsNewline = existing.length > 0 && !/\r?\n$/.test(existing);
    content = existing + (needsNewline ? eol : "") + toAppend.map((line) => `${line}${eol}`).join("");
  }
  writeFileSync(path, content, { encoding: "utf8" });
  result.added = toAppend;
  return result;
}

export function gitAttributesPath(projectRoot: string): string {
  return resolve(projectRoot, ".gitattributes");
}

export function gitIgnorePath(projectRoot: string): string {
  return resolve(projectRoot, ".gitignore");
}

/**
 * Change A + B provisioning: idempotently ensure the project-root `.gitattributes`
 * routes `aidlc/active/**​/audit.md` through git's `union` driver and
 * `aidlc/active/registry.md` through the engine's `aidlc-registry` driver. The managed
 * lines are appended only when missing; the user's content is preserved verbatim. A
 * user line that already sets a different merge strategy for a managed pattern is
 * returned as a conflict rather than overwritten.
 */
export function ensureGitAttributes(projectRoot: string): EnsureFileResult {
  return ensureManagedLines(
    gitAttributesPath(projectRoot),
    MANAGED_GITATTRIBUTES.map((entry) => ({ pattern: entry.pattern, line: entry.line, conflictAttribute: entry.attribute })),
  );
}

/**
 * Change C provisioning: idempotently ensure the project-root `.gitignore` excludes
 * engine-produced control-plane backups (`aidlc/active/**​/*.bak-*`). Appended only when
 * missing; existing content preserved verbatim.
 */
export function ensureGitIgnore(projectRoot: string): EnsureFileResult {
  return ensureManagedLines(gitIgnorePath(projectRoot), [{ pattern: GITIGNORE_BACKUP_LINE, line: GITIGNORE_BACKUP_LINE }]);
}

// ---------------------------------------------------------------------------
// Registry merge driver registration (change B)
// ---------------------------------------------------------------------------

export const REGISTRY_MERGE_DRIVER_CONFIG_KEY = `merge.${REGISTRY_MERGE_DRIVER_NAME}.driver`;
export const REGISTRY_MERGE_DRIVER_NAME_CONFIG_KEY = `merge.${REGISTRY_MERGE_DRIVER_NAME}.name`;

/**
 * How to invoke the installed CLI for the merge driver. The installed global binary is
 * `loeyae-aidlc`; `AIDLC_CLI` overrides it (an absolute invocation for a repository
 * whose PATH lacks the global binary, or for the engine's own tests). The value is
 * recorded verbatim into `.git/config`, so a caller setting it is responsible for its
 * quoting.
 */
export const DEFAULT_CLI_INVOCATION = "loeyae-aidlc";

export function resolveCliInvocation(): string {
  const override = process.env.AIDLC_CLI?.trim();
  return override || DEFAULT_CLI_INVOCATION;
}

/** The command the driver registration points at (`%O` base, `%A` ours, `%B` theirs). */
export function registryMergeDriverCommand(cliInvocation: string): string {
  return `${cliInvocation} orchestrate registry merge-driver %O %A %B`;
}

function gitConfig(projectRoot: string, args: string[]): { ok: boolean; stdout: string } {
  const result = runSync("git", ["config", ...args], { cwd: projectRoot, encoding: "utf8", shell: false });
  return { ok: !result.error && result.status === 0, stdout: (result.stdout || "").trim() };
}

/** True inside a git work tree whose local config the engine may write. */
export function gitConfigAvailable(projectRoot: string): boolean {
  const result = runSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot, encoding: "utf8", shell: false });
  return !result.error && result.status === 0 && (result.stdout || "").trim() === "true";
}

export interface DriverRegistrationResult {
  /** The repository is a git work tree whose local config could be read/written. */
  available: boolean;
  /** The driver command was written (absent or changed before). */
  registered: boolean;
  /** The driver command already matched (idempotent no-op). */
  unchanged: boolean;
  /** The command the driver now points at. */
  command?: string;
}

/**
 * Idempotently register the registry merge driver in the LOCAL `.git/config` (git
 * security requires every clone to register the driver once; `.gitattributes` travels
 * with the repository, the driver implementation does not). Writing the local config
 * only touches this repository. A clone that never registered the driver falls back to
 * git's default text merge (degraded, not fatal). No-op outside a git work tree.
 */
export function registerRegistryMergeDriver(projectRoot: string, cliInvocation: string): DriverRegistrationResult {
  if (!gitConfigAvailable(projectRoot)) return { available: false, registered: false, unchanged: false };
  const command = registryMergeDriverCommand(cliInvocation);
  const current = gitConfig(projectRoot, ["--local", "--get", REGISTRY_MERGE_DRIVER_CONFIG_KEY]);
  if (current.ok && current.stdout === command) {
    // Keep the human-readable name in sync even when the driver command already matched.
    const name = gitConfig(projectRoot, ["--local", "--get", REGISTRY_MERGE_DRIVER_NAME_CONFIG_KEY]);
    if (!name.ok || !name.stdout) gitConfig(projectRoot, ["--local", REGISTRY_MERGE_DRIVER_NAME_CONFIG_KEY, "AI-DLC registry identity-row union merge"]);
    return { available: true, registered: false, unchanged: true, command };
  }
  const wrote = gitConfig(projectRoot, ["--local", REGISTRY_MERGE_DRIVER_CONFIG_KEY, command]);
  if (!wrote.ok) return { available: true, registered: false, unchanged: false };
  gitConfig(projectRoot, ["--local", REGISTRY_MERGE_DRIVER_NAME_CONFIG_KEY, "AI-DLC registry identity-row union merge"]);
  return { available: true, registered: true, unchanged: false, command };
}

// ---------------------------------------------------------------------------
// Registry three-way identity-row union merge (change B)
// ---------------------------------------------------------------------------

export interface RegistryMergeConflict {
  module_id: string;
  ours_workflow_id: string;
  theirs_workflow_id: string;
}

export interface RegistryMergeResult {
  /** The merged registry Markdown (identity rows unioned, projection columns dropped). */
  content: string;
  /** Module ids whose identity rows genuinely diverge (same module, different Workflow ID). */
  conflicts: RegistryMergeConflict[];
  /** A scalar whose two sides diverge and cannot be unioned (e.g. Global Workflow ID). */
  scalarConflicts: { field: string; ours: string; theirs: string }[];
}

function moduleMap(rows: RegistryModuleRow[]): Map<string, RegistryModuleRow> {
  const map = new Map<string, RegistryModuleRow>();
  for (const row of rows) map.set(row.module_id, row);
  return map;
}

/**
 * Union the identity rows of two registries (change B). Modules present on either side
 * are kept; a module on both sides with the SAME Workflow ID is a clean union; the same
 * module id with DIFFERENT Workflow IDs is a genuine lineage divergence recorded in
 * `conflicts` (never silently merged). renderRegistry sorts and dedupes module rows.
 * Scalars (Global Workflow ID, Split From, Split At) that differ between sides and the
 * integration identity row that diverges are recorded in `scalarConflicts`.
 */
export function mergeRegistries(base: WorkflowRegistry | null, ours: WorkflowRegistry, theirs: WorkflowRegistry): RegistryMergeResult {
  const conflicts: RegistryMergeConflict[] = [];
  const scalarConflicts: { field: string; ours: string; theirs: string }[] = [];
  const ourModules = moduleMap(ours.modules);
  const theirModules = moduleMap(theirs.modules);
  const mergedModules: RegistryModuleRow[] = [];
  for (const id of new Set([...ourModules.keys(), ...theirModules.keys()])) {
    const left = ourModules.get(id);
    const right = theirModules.get(id);
    if (left && right && left.workflow_id !== right.workflow_id) {
      conflicts.push({ module_id: id, ours_workflow_id: left.workflow_id, theirs_workflow_id: right.workflow_id });
      // Keep ours in the body; the conflict is surfaced through the driver's exit status.
      mergedModules.push(left);
      continue;
    }
    mergedModules.push((left || right)!);
  }

  const scalar = (field: string, left: string, right: string): string => {
    if (left === right) return left;
    if (!left || left === "-") return right;
    if (!right || right === "-") return left;
    scalarConflicts.push({ field, ours: left, theirs: right });
    return left;
  };

  const integration = ours.integration.workflow_id === theirs.integration.workflow_id || !theirs.integration.workflow_id || theirs.integration.workflow_id === "-"
    ? ours.integration
    : (!ours.integration.workflow_id || ours.integration.workflow_id === "-" ? theirs.integration : (() => {
        scalarConflicts.push({ field: "Integration Workflow ID", ours: ours.integration.workflow_id, theirs: theirs.integration.workflow_id });
        return ours.integration;
      })());

  const merged: WorkflowRegistry = {
    version: "1",
    global_workflow_id: scalar("Global Workflow ID", ours.global_workflow_id, theirs.global_workflow_id),
    split_from_workflow_id: scalar("Split From Workflow ID", ours.split_from_workflow_id, theirs.split_from_workflow_id),
    split_at: scalar("Split At", ours.split_at, theirs.split_at),
    updated_at: ours.updated_at,
    modules: mergedModules,
    integration: {
      workflow_id: integration.workflow_id,
      state_path: integration.state_path,
      status: "-",
      current_stage: "-",
      barrier_ready: false,
      blocking: [],
    },
    shared_contracts: [],
    cross_module_requires: [],
  };
  // base is accepted for interface symmetry with git's %O; identity-row union is a true
  // set union, so a module removed on one side relative to base is still kept (removing a
  // module workflow is not an ordinary merge and must stay visible).
  void base;
  return { content: renderRegistry(merged), conflicts, scalarConflicts };
}

const CONFLICT_START = "<<<<<<<";
const CONFLICT_MIDDLE = "=======";
const CONFLICT_END = ">>>>>>>";

/**
 * The driver entry point (`orchestrate registry merge-driver %O %A %B`). git passes the
 * base, ours and theirs versions as temporary files; the merged result is written back
 * to the OURS file (`%A`), and the exit status tells git whether the merge is clean (0)
 * or needs human resolution (non-zero). On a genuine divergence the ours file is left
 * with standard conflict markers so a human sees both lineages.
 */
export function runRegistryMergeDriver(baseFile: string, oursFile: string, theirsFile: string): number {
  const read = (file: string): string => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  let base: WorkflowRegistry | null = null;
  let ours: WorkflowRegistry;
  let theirs: WorkflowRegistry;
  const oursText = read(oursFile);
  const theirsText = read(theirsFile);
  try {
    ours = parseRegistry(oursText);
    theirs = parseRegistry(theirsText);
    try {
      base = parseRegistry(read(baseFile));
    } catch {
      base = null;
    }
  } catch {
    // One side is not a parseable registry (e.g. already conflict-marked, or a non-v2
    // file). Fall back to leaving conflict markers so git treats it as unresolved.
    writeFileSync(oursFile, `${CONFLICT_START} ours\n${oursText}${CONFLICT_MIDDLE}\n${theirsText}${CONFLICT_END} theirs\n`, { encoding: "utf8" });
    return 1;
  }
  const result = mergeRegistries(base, ours, theirs);
  const hasConflict = result.conflicts.length > 0 || result.scalarConflicts.length > 0;
  if (!hasConflict) {
    writeFileSync(oursFile, result.content, { encoding: "utf8" });
    return 0;
  }
  const notes = [
    ...result.conflicts.map((c) => `# AIDLC-REGISTRY-CONFLICT module ${c.module_id}: ours=${c.ours_workflow_id} theirs=${c.theirs_workflow_id}`),
    ...result.scalarConflicts.map((c) => `# AIDLC-REGISTRY-CONFLICT ${c.field}: ours=${c.ours} theirs=${c.theirs}`),
  ].join("\n");
  // NOTE: the "ours" side below is `result.content` — the ALREADY-UNIONED registry
  // (every cleanly mergeable module row from both sides is already present), not the
  // raw ours file. The AIDLC-REGISTRY-CONFLICT notes above name only the rows that
  // genuinely diverge; a human resolves those, keeping the union body for the rest.
  const body = `${notes}\n${CONFLICT_START} ours\n${result.content}${CONFLICT_MIDDLE}\n${theirsText}${CONFLICT_END} theirs\n`;
  writeFileSync(oursFile, body, { encoding: "utf8" });
  return 1;
}

// ---------------------------------------------------------------------------
// One-shot provisioning used by install / next / split
// ---------------------------------------------------------------------------

export interface ControlPlaneProvisionResult {
  gitattributes: EnsureFileResult;
  gitignore: EnsureFileResult;
  driver: DriverRegistrationResult;
}

/**
 * Provision the full control-plane git merge strategy (changes A + B + C) at the project
 * root, idempotently. Called from the control-plane creation paths (orchestrate next /
 * split) and the install path. Never throws on a .gitattributes/.gitignore conflict; the
 * conflict is reported in the result for the caller to surface.
 */
export function provisionControlPlaneGitStrategy(projectRoot: string, cliInvocation: string = resolveCliInvocation()): ControlPlaneProvisionResult {
  const gitattributes = ensureGitAttributes(projectRoot);
  const gitignore = ensureGitIgnore(projectRoot);
  const driver = registerRegistryMergeDriver(projectRoot, cliInvocation);
  return { gitattributes, gitignore, driver };
}
