import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHandoffPrompt,
  updateDerivedHandoff,
  type HandoffPromptContext,
  type HandoffStageRef,
} from "../core/tools/aidlc-handoff.js";

const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-handoff-test-"));

function stage(overrides: Partial<HandoffStageRef> = {}): HandoffStageRef {
  return {
    stage_instance: "user-stories@module:orders",
    stage: "user-stories",
    name: "用户故事",
    phase: "inception",
    axis: "module",
    module_id: "orders",
    module_name: "订单模块",
    ...overrides,
  };
}

try {
  const context: HandoffPromptContext = {
    project_root: join(root, "shop-project"),
    completed_stage: stage({
      stage_instance: "requirements-analysis@module:orders",
      stage: "requirements-analysis",
      name: "需求分析",
    }),
    next_stage: stage(),
    ready_stages: [stage(), stage({ stage_instance: "reverse-engineering@module:orders", stage: "reverse-engineering", name: "逆向工程" })],
    architecture_mode: "single-module",
    collaboration_mode: "团队认领",
    mode: "after-report",
  };
  const prompt = buildHandoffPrompt(context);
  assert.match(prompt, /使用 AI-DLC，继续 shop-project 的 INCEPTION 阶段/);
  assert.match(prompt, /已完成：需求分析/);
  assert.match(prompt, /下一步：用户故事/);
  assert.match(prompt, /订单模块/);
  assert.match(prompt, /可认领实例/);
  assert.match(prompt, /orchestrate next --status/);
  assert.doesNotMatch(prompt, /claim_receipt|private key|AIDLC_TRUST_SECRET|provider_receipt/i);

  const project = context.project_root;
  mkdirSync(join(project, "docs", "aidlc"), { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "handoff.md"), [
    "# AI-DLC 状态跟踪",
    "",
    "## 下一步交接",
    "",
    "| 范围 | Stage 实例 | Module ID | Unit ID | 更新时间 | 提示词 |",
    "|------|------------|-----------|---------|----------|--------|",
    "| 其他模块 | old-stage@module:other | other | - | old | `保留这行` |",
    "",
    "## 项目信息",
    "",
    "保留的项目说明",
    "",
  ].join("\n"), "utf8");

  const firstUpdate = updateDerivedHandoff(context);
  assert.equal(firstUpdate.status, "updated");
  let handoff = readFileSync(firstUpdate.path, "utf8");
  assert.match(handoff, /保留的项目说明/);
  assert.match(handoff, /订单模块/);
  assert.match(handoff, /requirements-analysis@module:orders/);
  assert.match(handoff, /user-stories@module:orders/);
  assert.match(handoff, /其他模块.*old-stage@module:other/);

  const second = { ...context, next_stage: stage({ name: "需求澄清", stage: "requirement-clarification", stage_instance: "requirement-clarification@module:orders" }) };
  const secondUpdate = updateDerivedHandoff(second);
  assert.equal(secondUpdate.status, "updated");
  handoff = readFileSync(secondUpdate.path, "utf8");
  assert.equal((handoff.match(/\|\s*订单模块 模块\s*\|/g) || []).length, 1);
  assert.match(handoff, /requirement-clarification@module:orders/);
  const orderRow = handoff.split("\n").find((line) => line.startsWith("| 订单模块 模块 |"));
  assert.ok(orderRow);
  const orderCells = orderRow.split("|").map((cell) => cell.trim());
  assert.equal(orderCells[1], "订单模块 模块");
  assert.equal(orderCells[2], "requirement-clarification@module:orders");
  assert.match(handoff, /其他模块.*old-stage@module:other/);

  console.log("Handoff prompt and derived handoff tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
