import { createHash } from "crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { spawnSync } from "child_process";
import { loadWorkflowState } from "./aidlc-light-state";
import { readSourceRevision } from "./aidlc-revision";

const SAFE_BRANCH = /^aidlc-light\/[a-z0-9][a-z0-9/-]{0,120}$/;

interface Metadata {
  workflow_id: string;
  stage_instance: string;
  member: string;
  base_commit: string;
  branch: string;
  worktree_path: string;
  created_at: string;
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
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return (result.stdout || "").trim();
}

function metadataPath(project: string, instance: string): string {
  const dir = join(project, "aidlc", "active", "worktrees");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${createHash("sha256").update(instance).digest("hex").slice(0, 24)}.md`);
}

function selection(project: string, instance: string, member: string): void {
  const state = loadWorkflowState(project);
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
  return `# AI-DLC Lightweight Worktree\n\n- Workflow ID: ${metadata.workflow_id}\n- Stage Instance: ${metadata.stage_instance}\n- Member: ${metadata.member}\n- Base Commit: ${metadata.base_commit}\n- Branch: ${metadata.branch}\n- Worktree Path: ${metadata.worktree_path}\n- Created At: ${metadata.created_at}\n\n> This metadata is coordination context only. Git review, build and merge policy remain authoritative.\n`;
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
  };
}

export function prepareLightWorktree(projectRoot: string, instance: string, member: string, path: string, requestedBranch?: string): Metadata {
  const project = directory(projectRoot, "project root");
  if (resolve(git(project, ["rev-parse", "--show-toplevel"])) !== project) throw new Error("worktree must be created from the main project root");
  selection(project, instance, member);
  const revision = readSourceRevision(project);
  if (!/^[a-f0-9]{40,64}$/i.test(revision.commit) || revision.dirty !== false) throw new Error("lightweight worktree requires a clean committed project");
  const target = resolve(path);
  if (inside(project, target) || existsSync(target)) throw new Error("worktree path must be outside project and must not already exist");
  directory(dirname(target), "worktree parent");
  const state = loadWorkflowState(project)!;
  const branch = requestedBranch || `aidlc-light/${state.workflow_id.slice(0, 12)}/${createHash("sha256").update(instance).digest("hex").slice(0, 16)}`;
  if (!SAFE_BRANCH.test(branch)) throw new Error("branch must match aidlc-light/<safe-name>");
  git(project, ["worktree", "add", "-b", branch, target, revision.commit]);
  const metadata: Metadata = { workflow_id: state.workflow_id, stage_instance: instance, member, base_commit: revision.commit, branch, worktree_path: target, created_at: new Date().toISOString() };
  try {
    writeFileSync(metadataPath(project, instance), render(metadata), { encoding: "utf8", flag: "wx", mode: 0o600 });
    const local = join(target, ".aidlc", "worktrees");
    mkdirSync(local, { recursive: true, mode: 0o700 });
    writeFileSync(join(local, `${createHash("sha256").update(instance).digest("hex").slice(0, 24)}.md`), render(metadata), { encoding: "utf8", flag: "wx", mode: 0o600 });
    return metadata;
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
  const review = resolve(worktree, reviewPath);
  if (!inside(worktree, review) || !existsSync(review)) throw new Error("review evidence must be inside worktree");
  const value = JSON.parse(readFileSync(review, "utf8")) as Record<string, unknown>;
  if (value.status !== "passed" || value.spec_axis !== "passed" || value.standards_axis !== "passed" || value.issues_open !== 0 || !Array.isArray(value.files_reviewed)) throw new Error("merge-plan requires passing dual-axis review evidence");
  const reviewed = new Set(value.files_reviewed.filter((item): item is string => typeof item === "string"));
  const missing = changed.filter((path) => !reviewed.has(path));
  if (missing.length) throw new Error(`review evidence does not cover changed paths: ${missing.join(", ")}`);
  return { kind: "aidlc.aws-light.merge-plan", authorized: false, workflow_id: metadata.workflow_id, stage_instance: instance, member, branch: metadata.branch, base_commit: metadata.base_commit, head_commit: revision.commit, changed_paths: changed, merge_command: `git -C ${JSON.stringify(project)} merge --no-ff ${JSON.stringify(metadata.branch)}` };
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
  } else if (command === "verify" || command === "merge-plan") {
    process.stdout.write(`${JSON.stringify(lightMergePlan(project, text(flags.instance, "--instance"), text(flags.member, "--member"), text(flags.path, "--path"), text(flags["review-evidence"], "--review-evidence")), null, 2)}\n`);
  } else throw new Error("usage: loeyae-aidlc worktree <prepare|verify|merge-plan> [flags]");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(); } catch (error) { console.error(`Lightweight worktree blocked: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; }
}
