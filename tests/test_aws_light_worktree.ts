import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), `aidlc-aws-light-worktree-${process.pid}`);
const project = join(root, "project");
const worktree = join(root, "worker");

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" } });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return (result.stdout || "").trim();
}

function cliRun(cwd: string, args: string[]): Record<string, unknown> {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

try {
  mkdirSync(join(project, "src"), { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["config", "user.email", "aidlc@example.invalid"]);
  git(project, ["config", "user.name", "AI-DLC"]);
  writeFileSync(join(project, "src", "unit.ts"), "export const value = 1;\n");
  git(project, ["add", "src/unit.ts"]);
  git(project, ["commit", "-qm", "base"]);
  cliRun(project, ["orchestrate", "next", "--scope", "feature", "--work", "Implement unit A"]);
  mkdirSync(join(project, "docs", "aidlc", "ideation"), { recursive: true });
  mkdirSync(join(project, "docs", "aidlc", "modules", "module-a", "inception"), { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "ideation", "module-manifest.json"), JSON.stringify({ schema_version: 1, modules: [{ module_id: "module-a", name: "Module A", service_id: "service-a" }] }));
  writeFileSync(join(project, "docs", "aidlc", "modules", "module-a", "inception", "unit-manifest.json"), JSON.stringify({ schema_version: 1, module_id: "module-a", units: [{ unit_id: "unit-a", name: "Unit A", service_id: "service-a", conditional_stages: [] }] }));
  git(project, ["add", "docs/aidlc/ideation/module-manifest.json", "docs/aidlc/modules/module-a/inception/unit-manifest.json"]);
  git(project, ["commit", "-qm", "unit contract"]);
  cliRun(project, ["unit", "select", "--module", "module-a", "--unit", "unit-a", "--member", "alice", "--branch", "feat/unit-a"]);
  const instance = "code-generation@module:module-a@unit:unit-a";
  const prepared = cliRun(project, ["worktree", "prepare", "--instance", instance, "--member", "alice", "--path", worktree]);
  assert.equal(prepared.member, "alice");
  writeFileSync(join(worktree, "src", "unit.ts"), "export const value = 2;\n");
  git(worktree, ["add", "src/unit.ts"]);
  git(worktree, ["commit", "-qm", "implementation"]);
  mkdirSync(join(worktree, ".aidlc"), { recursive: true });
  writeFileSync(join(worktree, ".aidlc", "review.json"), JSON.stringify({ status: "passed", spec_axis: "passed", standards_axis: "passed", issues_open: 0, files_reviewed: ["src/unit.ts"] }));
  const plan = cliRun(project, ["worktree", "merge-plan", "--instance", instance, "--member", "alice", "--path", worktree, "--review-evidence", ".aidlc/review.json"]);
  assert.equal(plan.kind, "aidlc.aws-light.merge-plan");
  assert.equal(plan.authorized, false);
  assert.match(String(plan.merge_command), /merge --no-ff/);
  console.log("AWS-style Markdown lightweight worktree tests passed");
} finally {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}
