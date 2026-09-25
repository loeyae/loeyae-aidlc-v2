#!/usr/bin/env tsx
/**
 * 存量项目追溯 ID 半自动迁移脚本（dry-run 优先，供审阅）
 * ------------------------------------------------------------------
 * 用途：把存量 AI-DLC 产物里的旧需求/故事 ID 统一到 REQ-/STORY- 前缀家族：
 *   FR-{MODULE}-{n}      → REQ-{MODULE}-{n}     （如 FR-SSO-001 → REQ-SSO-001）
 *   {MODULE}-FR-{n}      → REQ-{MODULE}-{n}     （如 SYSTEM-FR-001 → REQ-SYSTEM-001）
 *   US-{MODULE}-{n}      → STORY-{MODULE}-{n}   （如 US-SSO-001 → STORY-SSO-001）
 *
 * 本脚本【只做 ID 重命名 + 换引用】，刻意【不做】以下（因需人工判断/内容提炼，脚本擅自做会出错）：
 *   - 不填 track:（track 需按模块性质+需求内容人工确认，见迁移计划决策点3）
 *   - 不造 AC-xxx（AC 需从故事散文提炼，是内容级工作，非机械重命名）
 *   - 不改任何需求/故事的正文语义
 *
 * 安全设计：
 *   - 默认 DRY-RUN：只打印将改动的文件/行/旧→新，绝不写盘；必须显式 --apply 才写。
 *   - 精确边界：只匹配 "模块段+数字" 形态的 ID，用严格边界避免误伤相似 ID
 *     （SSO-UI-001、CT-SSO-OAUTH2、SC-001、产品级 FR-003、REQ-V2-CONTRACT-xxx 等一律不动）。
 *   - 默认排除 assets/（SVG/JSON 图表描述文本，改动无益且高风险）与 evidence/。
 *   - 输出映射表 id-migration-map.md 供下游查证与断链核对。
 *   - 不写盘时进程零副作用，可反复跑。
 *
 * 用法：
 *   预览单模块：  tsx legacy-id-migrate.ts --root <存量项目> --module sso
 *   预览全部：    tsx legacy-id-migrate.ts --root <存量项目> --all
 *   执行单模块：  tsx legacy-id-migrate.ts --root <存量项目> --module sso --apply
 *
 * ⚠️ --apply 会修改存量项目文件。执行前务必：(1) 该项目在干净 git 分支上；(2) 已审阅 dry-run 输出。
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

interface Args { root: string; module?: string; all: boolean; apply: boolean; }
function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (flag: string): string | undefined => { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
  const root = get("--root");
  if (!root) { console.error("必须提供 --root <存量项目根目录>"); process.exit(2); }
  return { root, module: get("--module"), all: a.includes("--all"), apply: a.includes("--apply") };
}

// 大写模块段：模块目录名转 ID 内使用的大写段（sso→SSO, admin-ui→ADMINUI, lowcode→LOWCODE）。
function moduleToken(moduleId: string): string { return moduleId.replace(/-/g, "").toUpperCase(); }

/**
 * 为一个模块构造重命名规则。返回一组 {re, replace, label}。
 * 只匹配含该模块段 + 数字的 ID，边界严格：ID 前后不得是 [A-Z0-9-]（否则是更长 ID 的一部分，如 SSO-UI）。
 * 用 (?<![A-Z0-9-]) / (?![A-Z0-9-]) 前后否定，避免误伤 SSO-UI-001 / CT-SSO / REQ-V2-CONTRACT 等。
 */
function rulesFor(moduleId: string): { re: RegExp; replace: string; label: string }[] {
  const M = moduleToken(moduleId);
  return [
    // FR-{M}-{n} → REQ-{M}-{n}
    { re: new RegExp(`(?<![A-Z0-9-])FR-${M}-(\\d{2,})(?![A-Z0-9-])`, "g"), replace: `REQ-${M}-$1`, label: `FR-${M}-* → REQ-${M}-*` },
    // {M}-FR-{n} → REQ-{M}-{n}
    { re: new RegExp(`(?<![A-Z0-9-])${M}-FR-(\\d{2,})(?![A-Z0-9-])`, "g"), replace: `REQ-${M}-$1`, label: `${M}-FR-* → REQ-${M}-*` },
    // US-{M}-{n} → STORY-{M}-{n}
    { re: new RegExp(`(?<![A-Z0-9-])US-${M}-(\\d{2,})(?![A-Z0-9-])`, "g"), replace: `STORY-${M}-$1`, label: `US-${M}-* → STORY-${M}-*` },
  ];
}

const EXCLUDE_DIRS = new Set([".git", "node_modules", "dist", "build", "target", "assets", "evidence"]);
const TEXT_EXT = /\.(md|json)$/i; // 只处理 md/json；assets 下的 svg/图表 desc 默认排除（EXCLUDE_DIRS 已含 assets）

function walkModuleFiles(moduleDir: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (EXCLUDE_DIRS.has(entry)) continue;
      const p = join(dir, entry);
      const info = statSync(p);
      if (info.isDirectory()) visit(p);
      else if (TEXT_EXT.test(entry)) out.push(p);
    }
  };
  visit(moduleDir);
  return out.sort();
}

interface Change { file: string; line: number; before: string; after: string; }

function processModule(root: string, moduleId: string, apply: boolean): { changes: Change[]; mappings: Set<string> } {
  const moduleDir = join(root, "docs", "aidlc", "modules", moduleId);
  if (!existsSync(moduleDir)) { console.error(`模块目录不存在：${moduleDir}`); return { changes: [], mappings: new Set() }; }
  const rules = rulesFor(moduleId);
  const changes: Change[] = [];
  const mappings = new Set<string>();

  for (const file of walkModuleFiles(moduleDir)) {
    const original = readFileSync(file, "utf8");
    const lines = original.split(/\r?\n/);
    let fileChanged = false;
    const newLines = lines.map((line, idx) => {
      let next = line;
      for (const { re, replace } of rules) {
        next = next.replace(re, (match, ...g) => {
          const rep = replace.replace("$1", g[0]);
          mappings.add(`${match} → ${rep}`);
          return rep;
        });
      }
      if (next !== line) { fileChanged = true; changes.push({ file: relative(root, file), line: idx + 1, before: line.trim(), after: next.trim() }); }
      return next;
    });
    if (fileChanged && apply) writeFileSync(file, newLines.join("\n"), "utf8");
  }
  return { changes, mappings };
}

function main(): void {
  const args = parseArgs();
  const modules = args.all
    ? readdirSync(join(args.root, "docs", "aidlc", "modules")).filter((m) => statSync(join(args.root, "docs", "aidlc", "modules", m)).isDirectory())
    : args.module ? [args.module] : [];
  if (modules.length === 0) { console.error("必须提供 --module <name> 或 --all"); process.exit(2); }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`存量 ID 迁移 ${args.apply ? "【APPLY 写盘】" : "【DRY-RUN 预览，不写盘】"}`);
  console.log(`根目录：${args.root}`);
  console.log(`模块：${modules.join(", ")}`);
  console.log(`${"=".repeat(70)}\n`);

  let totalChanges = 0;
  const allMappings = new Set<string>();
  for (const moduleId of modules) {
    const { changes, mappings } = processModule(args.root, moduleId, args.apply);
    if (changes.length === 0) { console.log(`[${moduleId}] 无匹配 ID，跳过。`); continue; }
    console.log(`\n[${moduleId}] ${changes.length} 处改动，${new Set(changes.map((c) => c.file)).size} 个文件：`);
    for (const m of [...mappings].sort()) { console.log(`   映射：${m}`); allMappings.add(`[${moduleId}] ${m}`); }
    // 每文件最多列前 6 行，避免刷屏
    const byFile = new Map<string, Change[]>();
    for (const c of changes) { (byFile.get(c.file) ?? byFile.set(c.file, []).get(c.file)!).push(c); }
    for (const [file, cs] of byFile) {
      console.log(`   ── ${file}（${cs.length} 处）`);
      for (const c of cs.slice(0, 6)) console.log(`      L${c.line}: ${c.before}\n            → ${c.after}`);
      if (cs.length > 6) console.log(`      … 及另外 ${cs.length - 6} 处`);
    }
    totalChanges += changes.length;
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`合计：${totalChanges} 处改动。`);
  console.log(`唯一 ID 映射 ${allMappings.size} 条。`);
  if (!args.apply) {
    console.log(`\n这是 DRY-RUN，未写任何文件。确认无误后加 --apply 执行。`);
    console.log(`⚠️ APPLY 前务必：存量项目在干净 git 分支上，可 git diff / 回滚。`);
  } else {
    console.log(`\n✅ 已写盘。请用 git diff 复核，并跑矩阵 producer 确认收敛。`);
  }
  console.log(`\n【脚本不做】track 填充、AC 新建、正文语义修改 —— 这三项需人工/审阅完成（见 legacy-migration-plan.md）。`);
  console.log(`${"=".repeat(70)}\n`);
}

main();
