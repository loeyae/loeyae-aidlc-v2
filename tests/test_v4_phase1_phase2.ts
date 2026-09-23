import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-v4-phase1-phase2-"));

function run(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function success(cwd: string, args: string[]): Record<string, unknown> {
  const result = run(cwd, args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "AI-DLC",
      GIT_AUTHOR_EMAIL: "aidlc@example.invalid",
      GIT_COMMITTER_NAME: "AI-DLC",
      GIT_COMMITTER_EMAIL: "aidlc@example.invalid",
    },
  });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function makeGitProject(name: string): string {
  const project = join(root, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["config", "user.email", "aidlc@example.invalid"]);
  git(project, ["config", "user.name", "AI-DLC"]);
  writeFileSync(join(project, "README.md"), "REQ-BASE v4 test project\n", "utf8");
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-qm", "base"]);
  return project;
}

function writeModuleManifest(project: string): void {
  mkdirSync(join(project, "docs", "aidlc", "ideation"), { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "ideation", "module-manifest.json"), JSON.stringify({
    schema_version: 1,
    modules: [
      { module_id: "module-a", name: "Module A", service_id: "service-a" },
      { module_id: "module-b", name: "Module B", service_id: "service-b" },
    ],
  }), "utf8");
  git(project, ["add", "docs/aidlc/ideation/module-manifest.json"]);
  git(project, ["commit", "-qm", "module manifest"]);
}

let semanticProjectCounter = 0;

function prepareCrossValidationProject(): string {
  const project = makeGitProject(`semantic-${++semanticProjectCounter}`);
  writeModuleManifest(project);
  const moduleRoot = join(project, "docs", "aidlc", "modules", "module-a", "inception");
  mkdirSync(moduleRoot, { recursive: true });
  writeFileSync(join(moduleRoot, "requirements.md"), "# Requirements\nREQ-1 FR-1 defines a valid semantic requirement with enough detail.\n", "utf8");
  writeFileSync(join(moduleRoot, "user-stories.md"), "# Stories\nUS-1 covers FR-1 and provides a complete acceptance behavior for the user.\n", "utf8");
  writeFileSync(join(moduleRoot, "cross-validation-report.md"), "# Cross validation\nREQ-1 FR-1 US-1\n\n## Machine consistency summary\n- status: passed\n- unresolved_conflicts: 0\n- prd_route: not-selected\n- ui_route: not-selected\n", "utf8");
  mkdirSync(join(project, ".aidlc"), { recursive: true });
  writeFileSync(join(project, ".aidlc", "evidence-commands.json"), JSON.stringify({
    version: "1",
    stage: "cross-validation",
    commands: [{ id: "inception-consistency", role: "semantic", sensor: "inception-consistency", argv: ["loeyae-aidlc", "check", "--sensor", "inception-consistency"] }],
  }), "utf8");
  git(project, ["add", "docs/aidlc/modules/module-a/inception/requirements.md", "docs/aidlc/modules/module-a/inception/user-stories.md", "docs/aidlc/modules/module-a/inception/cross-validation-report.md"]);
  git(project, ["commit", "-qm", "cross validation inputs"]);

  const state = createInitialState("feature", "4.1.0", "workflow-semantic", [], "Validate semantic evidence UX");
  state.completed_stages = ["workspace-detection", "product-inception", "module-division"];
  state.completed_stage_instances = [
    "workspace-detection",
    "product-inception",
    "module-division",
    "requirements-analysis@module:module-a",
    "user-stories@module:module-a",
  ];
  state.current_stage = "cross-validation";
  state.current_phase = "inception";
  state.current_stage_instance = "cross-validation@module:module-a";
  state.current_module = "module-a";
  saveWorkflowState(project, state);
  return project;
}

try {
  const semanticProject = prepareCrossValidationProject();
  const produced = success(semanticProject, ["evidence", "run", "--stage", "cross-validation"]);
  const allProduced = success(semanticProject, ["evidence", "run", "--stage", "cross-validation", "--all-sensors"]);
  const semanticEvidence = join(semanticProject, ".aidlc", "evidence", "cross-validation", "module-a", "inception-consistency.json");
  assert.equal(produced.status, "passed");
  assert.equal(allProduced.status, "passed");
  assert.deepEqual(allProduced.sensors, ["inception-consistency"]);
  assert.ok(existsSync(semanticEvidence));
  assert.equal(JSON.parse(readFileSync(semanticEvidence, "utf8")).evidence_version, "1");

  unlinkSync(semanticEvidence);
  const reported = success(semanticProject, ["orchestrate", "report", "--stage", "cross-validation", "--result", "completed"]);
  assert.equal(reported.kind, "print");
  assert.ok(existsSync(semanticEvidence), "report must auto-produce missing semantic evidence");
  assert.ok(loadWorkflowState(semanticProject)?.completed_stage_instances.includes("cross-validation@module:module-a"));

  const mismatchProject = prepareCrossValidationProject();
  const mismatchState = loadWorkflowState(mismatchProject);
  assert.ok(mismatchState);
  mismatchState!.current_stage = "cross-validation";
  mismatchState!.current_phase = "inception";
  mismatchState!.current_stage_instance = "cross-validation@module:module-a";
  mismatchState!.current_module = "module-a";
  mismatchState!.completed_stages = ["workspace-detection", "product-inception", "module-division"];
  mismatchState!.completed_stage_instances = ["workspace-detection", "product-inception", "module-division", "requirements-analysis@module:module-a", "user-stories@module:module-a"];
  saveWorkflowState(mismatchProject, mismatchState!);
  const mismatchReport = join(mismatchProject, "docs", "aidlc", "modules", "module-a", "inception", "cross-validation-report.md");
  writeFileSync(mismatchReport, readFileSync(mismatchReport, "utf8").replace("prd_route: not-selected", "prd_route: selected"), "utf8");
  const mismatch = run(mismatchProject, ["check", "--sensor", "inception-consistency"]);
  assert.notEqual(mismatch.status, 0);
  assert.match(`${mismatch.stdout}\n${mismatch.stderr}`, /v3->v4 choice reconciliation failed/);
  assert.match(`${mismatch.stdout}\n${mismatch.stderr}`, /selected_optional_stages/);

  const moduleProject = makeGitProject("modules");
  writeModuleManifest(moduleProject);
  mkdirSync(join(moduleProject, "src"), { recursive: true });
  for (let index = 0; index < 11; index++) writeFileSync(join(moduleProject, "src", `legacy-${index}.ts`), `export const legacy${index} = ${index};\n`, "utf8");
  git(moduleProject, ["add", "src"]);
  git(moduleProject, ["commit", "-qm", "legacy source"]);
  success(moduleProject, ["orchestrate", "next", "--scope", "feature", "--work", "Run parallel modules"]);
  const moduleState = loadWorkflowState(moduleProject);
  assert.ok(moduleState);
  moduleState!.completed_stages = ["workspace-detection", "module-division"];
  moduleState!.completed_stage_instances = ["workspace-detection", "module-division"];
  saveWorkflowState(moduleProject, moduleState!);
  const orchestratedClaimA = success(moduleProject, ["orchestrate", "next", "--claim", "--module", "module-a", "--owner", "alice"]);
  assert.equal(orchestratedClaimA.claimed, true);
  writeFileSync(join(moduleProject, "docs", "aidlc", "ideation", "product-contracts.md"), "| provider | consumer | provider_stage | consumer_stage |\n| module-a | module-b | provider_stage: reverse-engineering | consumer_stage: reverse-engineering |\n", "utf8");
  const blockedClaimB = run(moduleProject, ["orchestrate", "next", "--claim", "--module", "module-b", "--owner", "bob"]);
  assert.notEqual(blockedClaimB.status, 0);
  assert.match(`${blockedClaimB.stdout}\n${blockedClaimB.stderr}`, /Unsatisfied requires|module-a/);
  const releasedState = loadWorkflowState(moduleProject);
  assert.ok(releasedState);
  releasedState!.completed_stage_instances.push("reverse-engineering@module:module-a");
  saveWorkflowState(moduleProject, releasedState!);
  const orchestratedClaimB = success(moduleProject, ["orchestrate", "next", "--claim", "--module", "module-b", "--owner", "bob"]);
  assert.equal(orchestratedClaimB.claimed, true);
  assert.match(String(orchestratedClaimA.stage_instance), /@module:module-a$/);
  assert.match(String(orchestratedClaimB.stage_instance), /@module:module-b$/);
  const parallelState = loadWorkflowState(moduleProject);
  assert.ok(parallelState);
  assert.equal(parallelState!.active_instances["reverse-engineering@module:module-a"].owner, "alice");
  assert.equal(parallelState!.active_instances["reverse-engineering@module:module-b"].owner, "bob");
  const selectedA = success(moduleProject, ["module", "select", "--module", "module-a", "--owner", "alice", "--branch", "feat/module-a"]);
  const selectedB = success(moduleProject, ["module", "select", "--module", "module-b", "--owner", "bob", "--branch", "feat/module-b"]);
  assert.equal((selectedA.selection as Record<string, unknown>).owner, "alice");
  assert.equal((selectedB.selection as Record<string, unknown>).owner, "bob");
  const claimA = success(moduleProject, ["module", "claim", "--module", "module-a", "--owner", "alice", "--stage-instance", "application-design@module:module-a"]);
  const claimB = success(moduleProject, ["module", "claim", "--module", "module-b", "--owner", "bob", "--stage-instance", "application-design@module:module-b"]);
  assert.equal((claimA.claim as Record<string, unknown>).owner, "alice");
  assert.equal((claimB.claim as Record<string, unknown>).owner, "bob");
  const duplicate = run(moduleProject, ["module", "claim", "--module", "module-a", "--owner", "mallory", "--stage-instance", "application-design@module:module-a"]);
  assert.notEqual(duplicate.status, 0);
  const heartbeat = success(moduleProject, ["module", "heartbeat", "--stage-instance", "application-design@module:module-a", "--owner", "alice"]);
  assert.equal((heartbeat.claim as Record<string, unknown>).owner, "alice");
  const moduleStateText = readFileSync(join(moduleProject, "aidlc", "active", "aidlc-state.md"), "utf8");
  assert.match(moduleStateText, /## Module Selections/);
  assert.match(moduleStateText, /## Active Instances/);
  assert.match(moduleStateText, /application-design@module:module-a/);
  assert.match(moduleStateText, /application-design@module:module-b/);

  const leftSnapshot = loadWorkflowState(moduleProject);
  const rightSnapshot = loadWorkflowState(moduleProject);
  assert.ok(leftSnapshot && rightSnapshot);
  leftSnapshot!.module_selections["module-c"] = { owner: "carol", selected_at: new Date().toISOString() };
  saveWorkflowState(moduleProject, leftSnapshot!);
  rightSnapshot!.module_selections["module-d"] = { owner: "dave", selected_at: new Date().toISOString() };
  assert.throws(() => saveWorkflowState(moduleProject, rightSnapshot!), /workflow state revision conflict/);
  assert.equal(loadWorkflowState(moduleProject)?.module_selections["module-c"].owner, "carol");

  console.log("v4 Phase 1/Phase 2 targeted tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
