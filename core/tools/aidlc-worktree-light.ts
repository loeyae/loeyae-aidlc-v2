import { createHash } from "crypto";
import { copyFileSync, existsSync, lstatSync, linkSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync } from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { runSync } from "./aidlc-spawn";
import { loadWorkflowView } from "./aidlc-workflow-layout";
import { readSourceRevision } from "./aidlc-revision";
import { describeInvolvement, nestedInvolvement } from "./aidlc-nested-repos";

const SAFE_BRANCH = /^aidlc-light\/[a-z0-9][a-z0-9/-]{0,120}$/;

interface Metadata {
  workflow_id: string;
  stage_instance: string;
  member: string;
  base_commit: string;
  branch: string;
  worktree_path: string;
  created_at: string;
  /** 4.9.0: declared nested repositories that `git worktree add` does not check out (absent when none). */
  nested_repos_skipped?: string[];
  /** MARS-271 #8: the shared baseline warm cache produced the working tree instead of a full checkout. */
  warm_reused?: boolean;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function scalar(markdown: string, label: string): string {
  const match = new RegExp(`^- ${label}:\\s*(.*)$`, "m").exec(markdown);
  if (!match) throw new Error(`worktree metadata is missing ${label}`);
  return text(match[1].trim(), label);
}

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function directory(path: string, field: string): string {
  const candidate = resolve(path);
  if (!existsSync(candidate)) throw new Error(`${field} does not exist: ${candidate}`);
  const stat = lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${field} must be a regular non-symlink directory: ${candidate}`);
  return candidate;
}

function git(cwd: string, args: string[]): string {
  const result = runSync("git", args, { cwd, encoding: "utf8", shell: false});
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return (result.stdout || "").trim();
}

function metadataPath(project: string, instance: string): string {
  const dir = join(project, "aidlc", "active", "worktrees");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${createHash("sha256").update(instance).digest("hex").slice(0, 24)}.md`);
}

function selection(project: string, instance: string, member: string): void {
  const state = loadWorkflowView(project);
  if (!state) throw new Error("no active AWS-style lightweight workflow");
  const unitMatch = /@module:([a-z0-9][a-z0-9-]*)@unit:([a-z0-9][a-z0-9-]*)$/.exec(instance);
  if (unitMatch) {
    const selected = state.unit_selections?.[`${unitMatch[1]}:${unitMatch[2]}`];
    if (!selected) throw new Error(`unit ${unitMatch[1]}:${unitMatch[2]} has not been selected`);
    if (selected.member !== member) throw new Error(`unit ${unitMatch[1]}:${unitMatch[2]} is selected by ${selected.member}, not ${member}`);
    return;
  }
  const moduleMatch = /@module:([a-z0-9][a-z0-9-]*)$/.exec(instance);
  if (!moduleMatch) throw new Error("lightweight worktree requires a module or unit stage instance");
  const moduleId = moduleMatch[1];
  const selected = state.module_selections?.[moduleId];
  const claim = state.active_instances?.[instance];
  if (!selected && !claim) throw new Error(`module ${moduleId} has not been selected or claimed`);
  const owner = claim?.owner || selected?.owner;
  if (owner !== member) throw new Error(`module ${moduleId} is selected by ${owner}, not ${member}`);
}

function render(metadata: Metadata): string {
  return `# AI-DLC Lightweight Worktree\n\n- Workflow ID: ${metadata.workflow_id}\n- Stage Instance: ${metadata.stage_instance}\n- Member: ${metadata.member}\n- Base Commit: ${metadata.base_commit}\n- Branch: ${metadata.branch}\n- Worktree Path: ${metadata.worktree_path}\n- Created At: ${metadata.created_at}\n${metadata.nested_repos_skipped ? `- Nested Repos Skipped: ${metadata.nested_repos_skipped.join(", ")}\n` : ""}${metadata.warm_reused ? "- Warm Reused: yes\n" : ""}\n> This metadata is coordination context only. Git review, build and merge policy remain authoritative.\n`;
}

function readMetadata(project: string, instance: string): Metadata {
  const path = metadataPath(project, instance);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("lightweight worktree metadata must be a regular Markdown file");
  const markdown = readFileSync(path, "utf8");
  return {
    workflow_id: scalar(markdown, "Workflow ID"),
    stage_instance: scalar(markdown, "Stage Instance"),
    member: scalar(markdown, "Member"),
    base_commit: scalar(markdown, "Base Commit"),
    branch: scalar(markdown, "Branch"),
    worktree_path: directory(scalar(markdown, "Worktree Path"), "worktree path"),
    created_at: scalar(markdown, "Created At"),
    ...(/^- Nested Repos Skipped:/m.test(markdown) ? { nested_repos_skipped: scalar(markdown, "Nested Repos Skipped").split(",").map((value) => value.trim()).filter(Boolean) } : {}),
  };
}

function instanceContext(instance: string): { module_id?: string; unit_id?: string } {
  const unit = /@module:([a-z0-9][a-z0-9-]*)@unit:([a-z0-9][a-z0-9-]*)$/.exec(instance);
  if (unit) return { module_id: unit[1], unit_id: unit[2] };
  const module = /@module:([a-z0-9][a-z0-9-]*)$/.exec(instance);
  return module ? { module_id: module[1] } : {};
}

/**
 * 4.9.0: `git worktree add` only checks out the workflow repository. An instance whose
 * characterization code refs (or compared changed paths) lie in a nested repository
 * cannot be isolated; any other instance proceeds and records the skipped repositories.
 */
function nestedWorktreeCheck(project: string, instance: string, action: string, paths: readonly string[] = []): string[] {
  const result = nestedInvolvement(project, { ...instanceContext(instance), paths });
  if (result.nested_repos_involved.length > 0) {
    throw new Error(`${action} cannot isolate ${instance}: it involves the nested source repository ${describeInvolvement(result.nested_repos_involved)}; git worktree add only checks out the workflow repository. Work on this unit in the main checkout, or create a worktree of ${[...new Set(result.nested_repos_involved.map((item) => `${item.repo}/`))].join(", ")} yourself and record it outside AI-DLC.`);
  }
  return result.nested_source_roots;
}

export function prepareLightWorktree(projectRoot: string, instance: string, member: string, path: string, requestedBranch?: string): Metadata {
  const project = directory(projectRoot, "project root");
  if (resolve(git(project, ["rev-parse", "--show-toplevel"])) !== project) throw new Error("worktree must be created from the main project root");
  selection(project, instance, member);
  const skipped = nestedWorktreeCheck(project, instance, "worktree prepare");
  const revision = readSourceRevision(project);
  if (!/^[a-f0-9]{40,64}$/i.test(revision.commit) || revision.dirty !== false) throw new Error("lightweight worktree requires a clean committed project");
  const target = resolve(path);
  if (inside(project, target) || existsSync(target)) throw new Error("worktree path must be outside project and must not already exist");
  directory(dirname(target), "worktree parent");
  const state = loadWorkflowView(project)!;
  const branch = requestedBranch || `aidlc-light/${state.workflow_id.slice(0, 12)}/${createHash("sha256").update(instance).digest("hex").slice(0, 16)}`;
  if (!SAFE_BRANCH.test(branch)) throw new Error("branch must match aidlc-light/<safe-name>");
  const warmReused = warmCheckout(project, target, branch, revision.commit);
  if (!warmReused) git(project, ["worktree", "add", "-b", branch, target, revision.commit]);
  const metadata: Metadata = { workflow_id: state.workflow_id, stage_instance: instance, member, base_commit: revision.commit, branch, worktree_path: target, created_at: new Date().toISOString(), ...(skipped.length > 0 ? { nested_repos_skipped: skipped } : {}), warm_reused: warmReused };
  try {
    writeFileSync(metadataPath(project, instance), render(metadata), { encoding: "utf8", flag: "wx", mode: 0o600 });
    const local = join(target, ".aidlc", "worktrees");
    mkdirSync(local, { recursive: true, mode: 0o700 });
    writeFileSync(join(local, `${createHash("sha256").update(instance).digest("hex").slice(0, 24)}.md`), render(metadata), { encoding: "utf8", flag: "wx", mode: 0o600 });
    return skipped.length > 0 ? { ...metadata, nested_source_roots: skipped } as Metadata : metadata;
  } catch (error) {
    try { git(project, ["worktree", "remove", "--force", target]); } catch {}
    try { git(project, ["branch", "-D", branch]); } catch {}
    throw error;
  }
}

export function lightMergePlan(projectRoot: string, instance: string, member: string, worktreePath: string, reviewPath: string): Record<string, unknown> {
  const project = directory(projectRoot, "project root");
  const metadata = readMetadata(project, instance);
  const worktree = directory(worktreePath, "worktree path");
  selection(project, instance, member);
  if (metadata.member !== member || metadata.worktree_path !== worktree) throw new Error("worktree metadata does not match selected member/path");
  if (git(worktree, ["branch", "--show-current"]) !== metadata.branch) throw new Error("worktree branch does not match metadata");
  const revision = readSourceRevision(worktree);
  if (!/^[a-f0-9]{40,64}$/i.test(revision.commit) || revision.dirty !== false) throw new Error("merge-plan requires committed clean worktree changes");
  git(worktree, ["merge-base", "--is-ancestor", metadata.base_commit, revision.commit]);
  const changed = git(worktree, ["diff", "--name-only", "-z", metadata.base_commit, revision.commit, "--"]).split("\0").filter(Boolean).sort();
  if (!changed.length) throw new Error("worktree has no committed changes");
  const skipped = nestedWorktreeCheck(project, instance, "worktree merge-plan", changed);
  const review = resolve(worktree, reviewPath);
  if (!inside(worktree, review) || !existsSync(review)) throw new Error("review evidence must be inside worktree");
  const value = JSON.parse(readFileSync(review, "utf8")) as Record<string, unknown>;
  if (value.status !== "passed" || value.spec_axis !== "passed" || value.standards_axis !== "passed" || value.issues_open !== 0 || !Array.isArray(value.files_reviewed)) throw new Error("merge-plan requires passing dual-axis review evidence");
  const reviewed = new Set(value.files_reviewed.filter((item): item is string => typeof item === "string"));
  const missing = changed.filter((path) => !reviewed.has(path));
  if (missing.length) throw new Error(`review evidence does not cover changed paths: ${missing.join(", ")}`);
  return { kind: "aidlc.aws-light.merge-plan", authorized: false, workflow_id: metadata.workflow_id, stage_instance: instance, member, branch: metadata.branch, base_commit: metadata.base_commit, head_commit: revision.commit, changed_paths: changed, merge_command: `git -C ${JSON.stringify(project)} merge --no-ff ${JSON.stringify(metadata.branch)}`, ...(skipped.length > 0 ? { nested_repos_skipped: skipped, nested_source_roots: skipped } : {}) };
}

// ---------------------------------------------------------------------------
// MARS-271 #8: shared baseline worktree warmup
// ---------------------------------------------------------------------------

interface WarmMetadata {
  base_commit: string;
  warm_path: string;
  warmed_at: string;
  files: number;
}

function warmMetadataPath(project: string): string {
  const dir = join(project, "aidlc", "active", "worktrees");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, "_warm.md");
}

function renderWarm(metadata: WarmMetadata): string {
  return `# AI-DLC Shared Baseline Worktree\n\n- Base Commit: ${metadata.base_commit}\n- Warm Path: ${metadata.warm_path}\n- Warmed At: ${metadata.warmed_at}\n- Files: ${metadata.files}\n> Shared read-only warm cache for worktree prepare (MARS-271 #8). Delete the path and this file together; prepare falls back to a full checkout.\n`;
}

function readWarmMetadata(project: string): WarmMetadata | null {
  const path = warmMetadataPath(project);
  if (!existsSync(path)) return null;
  const markdown = readFileSync(path, "utf8");
  return {
    base_commit: scalar(markdown, "Base Commit"),
    warm_path: scalar(markdown, "Warm Path"),
    warmed_at: scalar(markdown, "Warmed At"),
    files: Number(scalar(markdown, "Files")),
  };
}

function warmPathFor(project: string): string {
  return join(dirname(project), `${basename(project)}-aidlc-warm`);
}

/** Recreate the target working tree from the warm cache via hard links (copy fallback). */
function linkWarmTree(warm: string, target: string): void {
  const walk = (from: string, to: string): void => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const source = join(from, entry.name);
      const destination = join(to, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(destination, { recursive: true });
        walk(source, destination);
      } else if (entry.isSymbolicLink()) {
        symlinkSync(readlinkSync(source), destination);
      } else {
        try {
          linkSync(source, destination);
        } catch {
          copyFileSync(source, destination);
        }
      }
    }
  };
  walk(warm, target);
}

/** Valid warm cache: a registered, clean worktree of the same repo at the recorded commit. */
function usableWarm(project: string, metadata: WarmMetadata | null, commit: string): string | null {
  if (!metadata || metadata.base_commit !== commit) return null;
  if (!existsSync(metadata.warm_path) || inside(project, metadata.warm_path)) return null;
  try {
    const warm = metadata.warm_path.replace(/\\/g, "/").toLowerCase();
    const listed = git(project, ["worktree", "list"]).split("\n").some((line) => line.replace(/\\/g, "/").toLowerCase().startsWith(warm));
    if (!listed) return null;
    if (git(metadata.warm_path, ["rev-parse", "HEAD"]) !== commit) return null;
    if (git(metadata.warm_path, ["status", "--porcelain"]) !== "") return null;
    return metadata.warm_path;
  } catch {
    return null;
  }
}

export function warmupLightWorktree(projectRoot: string, commitOverride?: string): WarmMetadata & { warm_path: string; reused: boolean } {
  const project = directory(projectRoot, "project root");
  if (resolve(git(project, ["rev-parse", "--show-toplevel"])) !== project) throw new Error("worktree warmup must run from the main project root");
  const revision = readSourceRevision(project);
  if (!/^[a-f0-9]{40,64}$/i.test(revision.commit) || revision.dirty !== false) throw new Error("worktree warmup requires a clean committed project");
  const commit = commitOverride || revision.commit;
  const existing = readWarmMetadata(project);
  const reusable = usableWarm(project, existing, commit);
  if (reusable) return { base_commit: commit, warm_path: reusable, warmed_at: existing!.warmed_at, files: existing!.files, reused: true };
  const warm = warmPathFor(project);
  if (inside(project, warm)) throw new Error(`warm path must be outside the project: ${warm}`);
  if (existsSync(warm)) {
    // Stale cache at a different commit: drop it and re-warm at the current baseline.
    try { git(project, ["worktree", "remove", "--force", warm]); } catch { /* not a registered worktree */ }
    if (existsSync(warm)) throw new Error(`warm path already exists and is not a reusable worktree: ${warm}`);
  }
  directory(dirname(warm), "warm path parent");
  git(project, ["worktree", "add", "--detach", warm, commit]);
  const files = countFiles(warm);
  const metadata: WarmMetadata = { base_commit: commit, warm_path: warm, warmed_at: new Date().toISOString(), files };
  writeFileSync(warmMetadataPath(project), renderWarm(metadata), { encoding: "utf8", flag: "w", mode: 0o600 });
  return { ...metadata, reused: false };
}

function countFiles(root: string): number {
  let total = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (statSync(path).isFile()) total++;
    }
  };
  walk(root);
  return total;
}

/** MARS-271 #8: reuse the warm cache when it matches the prepare commit. */
function warmCheckout(project: string, target: string, branch: string, commit: string): boolean {
  const warm = usableWarm(project, readWarmMetadata(project), commit);
  if (!warm) return false;
  try {
    git(project, ["worktree", "add", "--no-checkout", "-b", branch, target, commit]);
    linkWarmTree(warm, target);
    git(target, ["reset"]);
    if (git(target, ["status", "--porcelain"]) !== "") git(target, ["reset", "--hard"]);
    if (git(target, ["status", "--porcelain"]) !== "") throw new Error("warm-linked worktree is not clean after reset");
    return true;
  } catch {
    // Fall back to the standard full checkout; never leave a half-linked target behind.
    try { git(project, ["worktree", "remove", "--force", target]); } catch {}
    try { git(project, ["branch", "-D", branch]); } catch {}
    return false;
  }
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new Error(`unexpected worktree argument: ${arg}`);
    const value = args[++index];
    if (!value) throw new Error(`${arg} requires a value`);
    flags[arg.slice(2)] = value;
  }
  const project = flags.project || process.cwd();
  if (command === "prepare") {
    process.stdout.write(`${JSON.stringify(prepareLightWorktree(project, text(flags.instance, "--instance"), text(flags.member, "--member"), text(flags.path, "--path"), flags.branch), null, 2)}\n`);
  } else if (command === "warmup") {
    if (flags.instance || flags.member || flags.path || flags.branch) throw new Error("warmup takes no instance/member/path/branch flags");
    process.stdout.write(`${JSON.stringify(warmupLightWorktree(project, flags.commit), null, 2)}\n`);
  } else if (command === "verify" || command === "merge-plan") {
    process.stdout.write(`${JSON.stringify(lightMergePlan(project, text(flags.instance, "--instance"), text(flags.member, "--member"), text(flags.path, "--path"), text(flags["review-evidence"], "--review-evidence")), null, 2)}\n`);
  } else throw new Error("usage: loeyae-aidlc worktree <prepare|warmup|verify|merge-plan> [flags]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Lightweight worktree blocked: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; }
}
