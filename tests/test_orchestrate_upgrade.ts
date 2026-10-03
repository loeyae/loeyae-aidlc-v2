import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-upgrade-"));
const M01 = "m01-trade";
const M02 = "m02-product";
const WORKFLOW_ID = "5c2e8a10-3f4b-4d6e-8a1c-9b7d5e3f1a02";
const GLOBAL_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
const REQUIREMENTS = `requirements-analysis@module:${M01}`;
const DESIGN = `application-design@module:${M01}`;

function cliRun(cwd: string, args: string[]): { status: number; directive: Record<string, unknown>; output: string } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd, encoding: "utf8" });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const text = (result.stdout || "").trim() || (result.stderr || "").trim();
  return { status: result.status ?? 1, directive: JSON.parse(text) as Record<string, unknown>, output };
}

function success(cwd: string, args: string[]): Record<string, unknown> {
  const result = cliRun(cwd, args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.output}`);
  return result.directive;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function write(project: string, path: string, content: string): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), content, "utf8");
}

function snapshot(project: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(project, path), createHash("sha256").update(readFileSync(path)).digest("hex"));
    }
  };
  walk(project);
  return files;
}

/** A split project whose m01 completed requirements-analysis and application-design before the new sensors existed. */
function prepareProject(): string {
  const project = join(root, "upgrade");
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  write(project, "README.md", "REQ-BASE upgrade dry-run fixture\n");
  write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({
    schema_version: 1,
    modules: [
      { module_id: M01, name: "Trade", service_id: "trade-service" },
      { module_id: M02, name: "Product", service_id: "product-service" },
    ],
  }));
  write(project, "docs/aidlc/ideation/scenario-module-mapping.md", "# Scenario module mapping\nREQ-001 checkout belongs to m01-trade; REQ-201 catalog belongs to m02-product.\n");
  write(project, "docs/aidlc/ideation/product-contracts.md", "# 产品级契约索引\n\n## 契约清单\n| 契约 ID | 类型 | 提供方 | 权威来源 | 版本/策略 | 兼容状态 | Owner |\n|---------|------|--------|----------|-----------|----------|-------|\n\n## 消费者状态\n| 契约 ID | 消费者 | 影响 | 状态 | 验证证据 |\n|---------|--------|------|------|----------|\n");
  write(project, `docs/aidlc/modules/${M01}/inception/requirements.md`, `# Requirements\n\n## REQ-001 Checkout\ntrack: [backend]\nThe ${M01} module lets a shopper check out an order with enough detail for review.\n`);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", "fixture"]);
  const state = createInitialState("feature", "4.3.0", WORKFLOW_ID, [], "Deliver trade and product modules");
  state.completed_stages = [...GLOBAL_STAGES];
  state.completed_stage_instances = [...GLOBAL_STAGES];
  state.skipped_stage_instances = [`reverse-engineering@module:${M01}`, `reverse-engineering@module:${M02}`];
  saveWorkflowState(project, state);
  success(project, ["orchestrate", "split", "--from", WORKFLOW_ID]);

  const ref = { kind: "module" as const, module_id: M01 };
  const m01 = loadWorkflowState(project, ref)!;
  m01.completed_stage_instances.push(REQUIREMENTS, DESIGN);
  m01.skipped_stage_instances.push(`requirement-clarification@module:${M01}`, `requirements-data-model@module:${M01}`);
  m01.status = "parked";
  saveWorkflowState(project, m01, ref);
  // application-design kept its v4.3 evidence; only the sensor added in v4.5 has none.
  for (const sensor of ["diagram-contract", "traceability-matrix"]) {
    write(project, `.aidlc/evidence/application-design/${M01}/${sensor}.json`, "{}\n");
  }
  return project;
}

type Pending = { instance_id: string; module_id: string | null; workflow: string; missing_sensors: string[]; requires_user_approval: boolean; commands: string[] };

try {
  const project = prepareProject();

  const refused = cliRun(project, ["orchestrate", "upgrade"]);
  assert.notEqual(refused.status, 0);
  assert.match(String(refused.directive.message), /only supports --dry-run/);
  const unknown = cliRun(project, ["orchestrate", "upgrade", "--dry-run", "--module", "m09-unknown"]);
  assert.notEqual(unknown.status, 0);
  assert.match(String(unknown.directive.message), /m09-unknown/);

  const before = snapshot(project);
  const report = success(project, ["orchestrate", "upgrade", "--dry-run"]);
  assert.deepEqual(snapshot(project), before, "dry-run must not write any file");
  assert.equal(report.dry_run, true);
  assert.equal(report.layout, "split");
  assert.equal(report.engine_version, "4.6.1");
  const workflows = report.workflows as { workflow: string; recorded_engine_version: string }[];
  assert.deepEqual(workflows.map((item) => item.workflow).sort(), ["global", "integration", `module:${M01}`, `module:${M02}`].sort());
  assert.ok(workflows.every((item) => item.recorded_engine_version.length > 0));

  const pending = report.pending as Pending[];
  assert.deepEqual(pending.map((item) => item.instance_id).sort(), [DESIGN, REQUIREMENTS].sort());
  const design = pending.find((item) => item.instance_id === DESIGN)!;
  assert.equal(design.module_id, M01);
  assert.equal(design.workflow, `module:${M01}`);
  assert.deepEqual(design.missing_sensors, ["structural-invariants"]);
  assert.equal(design.requires_user_approval, true);
  assert.deepEqual(design.commands, [
    `loeyae-aidlc evidence run --stage application-design --instance ${DESIGN} --all-sensors --refresh`,
    `loeyae-aidlc orchestrate report --stage application-design --instance ${DESIGN} --result approved --user-input Approve`,
  ]);
  const requirements = pending.find((item) => item.instance_id === REQUIREMENTS)!;
  assert.deepEqual(requirements.missing_sensors, ["traceability-matrix"]);
  assert.equal(requirements.requires_user_approval, false);

  const m02Only = success(project, ["orchestrate", "upgrade", "--dry-run", "--module", M02]);
  assert.deepEqual(m02Only.pending, []);
  assert.deepEqual((m02Only.workflows as { workflow: string }[]).map((item) => item.workflow), [`module:${M02}`]);

  // Running the listed commands repairs the instance and removes it from the next dry-run.
  for (const command of requirements.commands) {
    const argv = command.split(" ").slice(1);
    const result = success(project, argv);
    if (argv[0] === "orchestrate") assert.equal(result.reattested, true, command);
  }
  const m01State = loadWorkflowState(project, { kind: "module", module_id: M01 })!;
  assert.equal(m01State.status, "parked", "recovery never changes workflow progress");
  const after = success(project, ["orchestrate", "upgrade", "--dry-run", "--module", M01]);
  assert.deepEqual((after.pending as Pending[]).map((item) => item.instance_id), [DESIGN]);

  console.log("test_orchestrate_upgrade: ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
