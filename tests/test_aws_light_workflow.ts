import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), `aidlc-aws-light-${process.pid}`);
const project = join(root, "project");

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function success(args: string[]): Record<string, unknown> {
  const result = run(args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

try {
  mkdirSync(join(project, "docs", "aidlc"), { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "aidlc-state.json"), JSON.stringify({ schema_version: 3, workflow_id: "ignored-legacy" }), "utf8");

  const created = success(["orchestrate", "next", "--scope", "express", "--work", "Fix checkout validation failure"]);
  assert.equal(created.kind, "print");
  const statePath = join(project, "aidlc", "active", "aidlc-state.md");
  const auditPath = join(project, "aidlc", "active", "audit.md");
  assert.ok(existsSync(statePath));
  assert.ok(existsSync(auditPath));
  const markdown = readFileSync(statePath, "utf8");
  assert.match(markdown, /^# AI-DLC Lightweight Workflow/m);
  assert.match(markdown, /Work: Fix checkout validation failure/);
  assert.doesNotMatch(markdown, /"schema_version"|"integrity"|claim_receipt|enrollment|lease|receipt|routing_model/);

  const next = success(["orchestrate", "next"]);
  assert.equal(next.kind, "run-stage");
  assert.equal("claim_receipt" in next, false);
  const agentExecution = next.agent_execution as Record<string, unknown>;
  assert.equal(agentExecution.mode, "inline");
  assert.equal(agentExecution.state_authority, "conductor-only");
  assert.equal((agentExecution.primary as Record<string, unknown>).id, "aidlc-architect-agent");
  const handoff = String(next.handoff_prompt || "");
  assert.match(handoff, /工作目标：Fix checkout validation failure/);
  assert.match(handoff, /当前阶段：/);
  assert.match(handoff, /需要产物：/);
  assert.match(handoff, /质量动作：.*review.*构建.*测试/);
  assert.match(handoff, /下一步：/);
  const retiredNext = run(["orchestrate", "next", "--team-enrollment-confirmation-stdin"]);
  assert.notEqual(retiredNext.status, 0);
  assert.match(`${retiredNext.stdout}\n${retiredNext.stderr}`, /Unsupported AWS-style workflow option/);
  const retiredReport = run(["orchestrate", "report", "--stage", "workspace-detection", "--result", "completed", "--claim-receipt-stdin"]);
  assert.notEqual(retiredReport.status, 0);
  assert.match(`${retiredReport.stdout}\n${retiredReport.stderr}`, /Unsupported AWS-style report option/);
  success(["orchestrate", "report", "--stage", "workspace-detection", "--result", "completed", "--instruction-ack", "workspace-detection"]);

  mkdirSync(join(project, "docs", "aidlc", "ideation"), { recursive: true });
  mkdirSync(join(project, "docs", "aidlc", "modules", "module-a", "inception"), { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "ideation", "module-manifest.json"), JSON.stringify({ schema_version: 1, modules: [{ module_id: "module-a", name: "Module A", service_id: "service-a" }] }), "utf8");
  writeFileSync(join(project, "docs", "aidlc", "modules", "module-a", "inception", "unit-manifest.json"), JSON.stringify({ schema_version: 1, module_id: "module-a", units: [{ unit_id: "unit-a", name: "Unit A", service_id: "service-a", conditional_stages: [] }] }), "utf8");
  const selected = success(["unit", "select", "--module", "module-a", "--unit", "unit-a", "--member", "alice", "--branch", "feat/unit-a"]);
  assert.equal((selected.selection as Record<string, unknown>).member, "alice");
  const runtime = success(["runtime", "summary"]);
  assert.equal(runtime.kind, "aidlc.aws-light.runtime");
  assert.equal(runtime.authoritative, false);
  assert.equal(((runtime.unit_selections as Record<string, Record<string, unknown>>)["module-a:unit-a"]).member, "alice");

  console.log("AWS-style Markdown lightweight workflow tests passed");
} finally {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}
