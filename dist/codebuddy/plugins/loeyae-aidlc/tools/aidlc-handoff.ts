import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, isAbsolute, relative, resolve } from "path";

export type HandoffPromptMode = "before-stage" | "after-report";
export type HandoffStatus = "updated" | "unverified";

export interface HandoffStageRef {
  stage_instance: string;
  stage: string;
  name: string;
  phase: string;
  axis: "project" | "module" | "unit";
  module_id?: string;
  unit_id?: string;
  module_name?: string;
  unit_name?: string;
}

export interface HandoffPromptContext {
  project_root: string;
  completed_stage?: HandoffStageRef;
  next_stage?: HandoffStageRef;
  ready_stages: HandoffStageRef[];
  architecture_mode?: string;
  collaboration_mode?: string;
  mode?: HandoffPromptMode;
}

export interface HandoffUpdateResult {
  prompt: string;
  path: string;
  status: HandoffStatus;
  error?: string;
}

function displayValue(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function projectName(projectRoot: string): string {
  return basename(resolve(projectRoot));
}

function stageDisplay(stage: HandoffStageRef): string {
  return `${displayValue(stage.name, stage.stage)}（${stage.stage_instance}）`;
}

function contextLines(stage: HandoffStageRef | undefined): string[] {
  if (!stage) return [];
  const lines: string[] = [];
  if (stage.module_id) lines.push(`- 活跃模块：${displayValue(stage.module_name, stage.module_id)}`);
  if (stage.unit_id) lines.push(`- 当前单元：${displayValue(stage.unit_name, stage.unit_id)}`);
  return lines;
}

export function buildHandoffPrompt(context: HandoffPromptContext): string {
  const completed = context.completed_stage;
  const next = context.next_stage;
  const subject = next || completed;
  const phase = displayValue(subject?.phase, "WORKFLOW").toUpperCase();
  const lines = [
    `使用 AI-DLC，继续 ${projectName(context.project_root)} 的 ${phase} 阶段。`,
    "",
    "当前状态：",
    completed
      ? `- 已完成：${stageDisplay(completed)}`
      : "- 当前状态：等待认领第一个 Stage 实例",
  ];

  if (next) {
    lines.push(
      context.mode === "before-stage"
        ? `- 当前待执行：${stageDisplay(next)}`
        : `- 下一步：${stageDisplay(next)}`,
    );
  } else {
    lines.push("- 下一步：当前 workflow 已完成，先执行状态检查确认结果");
  }

  lines.push(...contextLines(next || completed));
  if (context.architecture_mode) lines.push(`- 架构模式：${context.architecture_mode}`);
  if (context.collaboration_mode) lines.push(`- 协作模式：${context.collaboration_mode}`);
  if (context.ready_stages.length > 1) {
    lines.push(`- 可认领实例：${context.ready_stages.map(stageDisplay).join("、")}`);
  }
  lines.push(
    "",
    "请先执行 `loeyae-aidlc orchestrate next --status` 验证签名 state，再按返回的 directive 继续；不要直接修改 aidlc-state.json。",
    "请读取 handoff.md 恢复人类上下文，当前 Stage 的完成必须通过定向 report 门禁。",
  );
  return lines.join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").replace(/`/g, "'").trim();
}

function scopeLabel(context: HandoffPromptContext): string {
  const stage = context.next_stage || context.completed_stage;
  if (stage?.unit_id) return `${displayValue(stage.unit_name, stage.unit_id)} 单元`;
  if (stage?.module_id) return `${displayValue(stage.module_name, stage.module_id)} 模块`;
  return projectName(context.project_root);
}

function handoffRow(context: HandoffPromptContext, prompt: string): string {
  const stage = context.next_stage || context.completed_stage;
  const cells = [
    escapeCell(scopeLabel(context)),
    escapeCell(stage?.stage_instance || "-"),
    escapeCell(stage?.module_id || "-"),
    escapeCell(stage?.unit_id || "-"),
    escapeCell(new Date().toISOString()),
    `\`${escapeCell(prompt.replace(/\s+/g, " "))}\``,
  ];
  return `| ${cells.join(" | ")} |`;
}

function rowsFromSection(sectionBody: string): string[] {
  return sectionBody
    .split("\n")
    .filter((line) => /^\s*\|/.test(line))
    .filter((line) => !/^\s*\|\s*-/.test(line))
    .filter((line) => !/\|\s*范围\s*\|/.test(line));
}

function rowScope(row: string): string {
  return row.split("|")[1]?.trim() || "";
}

function renderSection(rows: string[]): string {
  return [
    "## 下一步交接",
    "",
    "| 范围 | Stage 实例 | Module ID | Unit ID | 更新时间 | 提示词 |",
    "|------|------------|-----------|---------|----------|--------|",
    ...rows,
    "",
  ].join("\n");
}

function upsertSection(content: string, row: string): string {
  const heading = /^## 下一步交接\s*$/m.exec(content);
  if (!heading || heading.index === undefined) {
    const insertion = content.search(/^## 项目信息\s*$/m);
    const at = insertion >= 0 ? insertion : content.length;
    const before = content.slice(0, at);
    const separator = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    return `${before}${separator}${renderSection([row])}${content.slice(at)}`;
  }

  const sectionStart = heading.index;
  const bodyStart = sectionStart + heading[0].length;
  const followingHeading = content.slice(bodyStart).search(/^##\s+/m);
  const sectionEnd = followingHeading >= 0 ? bodyStart + followingHeading : content.length;
  const existingRows = rowsFromSection(content.slice(bodyStart, sectionEnd));
  const scope = rowScope(row);
  const index = existingRows.findIndex((existing) => rowScope(existing) === scope);
  if (index >= 0) existingRows[index] = row;
  else existingRows.push(row);
  return `${content.slice(0, sectionStart)}${renderSection(existingRows)}${content.slice(sectionEnd)}`;
}

function safeHandoffPath(projectRoot: string): string {
  const root = realpathSync(projectRoot);
  const directory = resolve(root, "docs", "aidlc");
  mkdirSync(directory, { recursive: true });
  const realDirectory = realpathSync(directory);
  const relativeDirectory = relative(root, realDirectory);
  if (isAbsolute(relativeDirectory) || relativeDirectory.startsWith("..")) {
    throw new Error("handoff directory escapes project root");
  }
  const target = resolve(realDirectory, "handoff.md");
  if (existsSync(target)) {
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("handoff.md must be a regular non-symlink file");
  }
  return target;
}

function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function updateDerivedHandoff(context: HandoffPromptContext): HandoffUpdateResult {
  const prompt = buildHandoffPrompt(context);
  try {
    const path = safeHandoffPath(context.project_root);
    const content = existsSync(path)
      ? readFileSync(path, "utf8")
      : "# AI-DLC 状态跟踪\n\n";
    atomicWrite(path, upsertSection(content, handoffRow(context, prompt)));
    return { prompt, path, status: "updated" };
  } catch (error) {
    return {
      prompt,
      path: resolve(context.project_root, "docs", "aidlc", "handoff.md"),
      status: "unverified",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
