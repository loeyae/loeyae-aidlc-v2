import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mermaid-default-"));
const M01 = "m01-trade";
const WORKFLOW_ID = "7e1d2c3b-4a5f-4e6d-9c8b-0a1f2e3d4c05";
const GLOBAL_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
const INSTANCE = `requirements-methods@module:${M01}`;

function cliRun(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function failure(cwd: string, args: string[], pattern: RegExp): void {
  const result = cliRun(cwd, args);
  assert.notEqual(result.status, 0, `${args.join(" ")} should fail\n${result.stdout}`);
  assert.match(`${result.stdout}\n${result.stderr}`, pattern, args.join(" "));
}

function success(cwd: string, args: string[]): Record<string, unknown> {
  const result = cliRun(cwd, args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
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

const BUSINESS_FLOWS = `# Business flows

## REQ-001 Checkout flow

The shopper checks out an order; an external vendor architecture image is referenced for context only.

![Vendor architecture](assets/vendor.svg)

\`\`\`mermaid
flowchart TB
  Cart[Cart] --> Pay{Payment approved?}
  Pay -->|yes| Done[Order created]
  Pay -->|no| Cart
\`\`\`
`;

try {
  const project = join(root, "mermaid");
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  write(project, "README.md", "REQ-BASE mermaid default fixture\n");
  write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [{ module_id: M01, name: "Trade", service_id: "trade-service" }] }));
  write(project, "docs/aidlc/ideation/scenario-module-mapping.md", "# Scenario module mapping\nREQ-001 checkout belongs to m01-trade.\n");
  write(project, "docs/aidlc/ideation/product-contracts.md", "# 产品级契约索引\n\n## 契约清单\n| 契约 ID | 类型 | 提供方 | 权威来源 | 版本/策略 | 兼容状态 | Owner |\n|---------|------|--------|----------|-----------|----------|-------|\n\n## 消费者状态\n| 契约 ID | 消费者 | 影响 | 状态 | 验证证据 |\n|---------|--------|------|------|----------|\n");
  write(project, `docs/aidlc/modules/${M01}/inception/requirements.md`, "# Requirements\n\n## REQ-001 Checkout\ntrack: [backend]\nThe shopper checks out an order with enough detail for review.\n");
  write(project, `docs/aidlc/modules/${M01}/inception/requirements/business-flows.md`, BUSINESS_FLOWS);
  write(project, `docs/aidlc/modules/${M01}/inception/requirements/assets/vendor.svg`, '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  // A stray manifest does not switch the format: only the user's recorded choice does.
  write(project, `docs/aidlc/modules/${M01}/inception/requirements/assets/vendor.diagram.json`, JSON.stringify({ version: 1, diagrams: [{ id: "vendor" }] }));
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", "fixture"]);

  const global = createInitialState("feature", "4.5.1", WORKFLOW_ID, [], "Deliver the trade module");
  global.completed_stages = [...GLOBAL_STAGES];
  global.completed_stage_instances = [...GLOBAL_STAGES];
  global.skipped_stage_instances = [`reverse-engineering@module:${M01}`];
  saveWorkflowState(project, global);
  success(project, ["orchestrate", "split", "--from", WORKFLOW_ID]);
  const ref = { kind: "module" as const, module_id: M01 };
  const state = loadWorkflowState(project, ref)!;
  state.completed_stage_instances.push(`requirements-analysis@module:${M01}`);
  state.skipped_stage_instances.push(`requirement-clarification@module:${M01}`, `requirements-data-model@module:${M01}`);
  state.current_stage = "requirements-methods";
  state.current_phase = "inception";
  state.current_stage_instance = INSTANCE;
  state.current_module = M01;
  saveWorkflowState(project, state, ref);

  const initial = success(project, ["orchestrate", "diagram-format"]);
  assert.equal(initial.diagram_format, "mermaid");
  assert.match(String(initial.message), /\(default\)/);

  // Default Mermaid: static checks on the stage document; the external SVG and stray manifest are ignored.
  const flows = `docs/aidlc/modules/${M01}/inception/requirements/business-flows.md`;
  const invalid: Array<[string, RegExp]> = [
    ["# Business flows\n\n## REQ-001 Checkout flow\n\nNo diagram yet.\n", /contains no mermaid code block/],
    ["# Business flows\n\n## REQ-001\n\n```mermaid\nCart --> Pay\n```\n", /must start with a diagram type/],
    ["# Business flows\n\n## REQ-001\n\n```mermaid\nflowchart XY\n  A --> B\n```\n", /direction must be TB, TD, BT, RL or LR/],
    ["# Business flows\n\n## REQ-001\n\n```mermaid\nflowchart TB\n  A --> B\n", /mermaid code block is not closed/],
    ["# Business flows\n\n## REQ-001\n\n```mermaid\nflowchart TB\n```\n", /declares no nodes or relations/],
  ];
  // Passes the static checks; only the Mermaid parser catches these.
  invalid.push(["# Business flows\n\n## REQ-001\n\n```mermaid\nflowchart TB\n  A[Cart --> B\n```\n", /mermaid syntax error \(Mermaid parser\): Parse error on line 3:? .*business-flows\.md:5/]);
  invalid.push(["# Business flows\n\n## REQ-001\n\n```mermaid\nstateDiagram-v2\n  [*] --> \n  --> B\n```\n", /mermaid syntax error \(Mermaid parser\)/]);
  for (const [content, pattern] of invalid) {
    write(project, flows, content);
    failure(project, ["evidence", "run", "--stage", "requirements-methods", "--module", M01], pattern);
  }
  write(project, flows, BUSINESS_FLOWS);
  success(project, ["evidence", "run", "--stage", "requirements-methods", "--module", M01]);
  const evidencePath = join(project, ".aidlc", "evidence", "requirements-methods", M01, "diagram-contract.json");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.source_format, "mermaid");
  assert.equal(evidence.diagrams_checked, 1);
  // Evidence records the path with the platform separator (\ on Windows); compare it as POSIX.
  const diagrams = (evidence.diagrams as Array<{ file: string }>).map((entry) => ({ ...entry, file: entry.file.replace(/\\/g, "/") }));
  assert.deepEqual(diagrams, [{ file: flows, line: 9, type: "flowchart" }]);
  assert.equal(evidence.syntax_parse, "passed");

  const report = success(project, ["orchestrate", "report", "--stage", "requirements-methods", "--module", M01, "--result", "completed"]);
  assert.notEqual(report.kind, "error", JSON.stringify(report));
  assert.ok(loadWorkflowState(project, ref)!.completed_stage_instances.includes(INSTANCE), "the Mermaid flow passes the requirements-methods gate");


  // SVG only after the user's explicit, recorded choice.
  failure(project, ["orchestrate", "diagram-format", "--set", "png", "--user-input", "x"], /--set must be one of: mermaid, svg/);
  failure(project, ["orchestrate", "diagram-format", "--set", "svg"], /--user-input is required/);
  const svg = success(project, ["orchestrate", "diagram-format", "--set", "svg", "--user-input", "业务流程图请用 SVG"]);
  assert.equal(svg.changed, true);
  assert.match(readFileSync(join(project, "aidlc", "active", "audit.md"), "utf8"), /DIAGRAM_FORMAT_SET[\s\S]*To: svg[\s\S]*User Input: 业务流程图请用 SVG/);
  failure(project, ["orchestrate", "report", "--stage", "requirements-methods", "--module", M01, "--result", "completed"], /diagram format is svg/);
  failure(project, ["evidence", "run", "--stage", "requirements-methods", "--module", M01, "--refresh"], /diagram-contract/);

  console.log("Mermaid default diagram gate tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
