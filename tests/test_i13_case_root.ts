import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import { join, relative, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { resolveScanRoot, scanFiles } from "../core/tools/aidlc-scan-root";

// Regression: I13 test-case-derivation passed an absolute caseRoot into allFiles,
// which re-joined ROOT and never found the UC-D files.

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-i13-case-root-"));
const MODULE = "project";

function run(project: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function makeI13Project(name: string, caseStatus: "ready" | "blocked"): { project: string; caseFile: string } {
  const project = join(scratch, name);
  const inception = join(project, "docs", "aidlc", "modules", MODULE, "inception");
  const cases = join(inception, "application-design", "test-cases");
  mkdirSync(cases, { recursive: true });
  writeFileSync(join(project, "README.md"), "I13 case root regression project\n", "utf8");
  writeFileSync(join(inception, "requirements.md"), "# Requirements\nREQ-1 订单导出验收\nScenario: Given 已有订单 When 导出 Then 30 秒内完成\n", "utf8");
  writeFileSync(join(cases, "_index.md"), "# UC-D index\n- UC-D-001 订单导出\n", "utf8");
  const caseFile = join(cases, "UC-D-001-export.md");
  writeFileSync(caseFile, `---\nid: UC-D-001\nstatus: ${caseStatus}\nsource_ref: REQ-1\n---\n# UC-D-001 订单导出\n`, "utf8");
  const state = createInitialState("express", "4.5.0", `workflow-${name}`, [], "I13 case root regression");
  state.completed_stages = ["workspace-detection", "state-template"];
  state.completed_stage_instances = ["workspace-detection", "state-template"];
  state.current_stage = "test-case-derivation";
  state.current_phase = "inception";
  state.current_stage_instance = `test-case-derivation@module:${MODULE}`;
  state.current_module = MODULE;
  saveWorkflowState(project, state);
  assert.ok(loadWorkflowState(project));
  return { project, caseFile };
}

try {
  // 1. Positive: UC-D files in the modular layout must be read.
  const ready = makeI13Project("ready", "ready");
  const readyResult = run(ready.project, ["check", "--sensor", "test-case-derivation", "--module", MODULE]);
  assert.equal(readyResult.status, 0, `${readyResult.stdout}\n${readyResult.stderr}`);
  const evidence = JSON.parse(readyResult.stdout) as Record<string, unknown>;
  assert.equal(evidence.status, "required");
  assert.equal(evidence.ucd_total, 1);
  assert.equal(evidence.ready_ucd, 1);
  const caseLabels = (evidence.test_case_files as string[]).map((path) => path.replace(/\\/g, "/"));
  assert.ok(caseLabels.includes(relative(ready.project, ready.caseFile).replace(/\\/g, "/")), JSON.stringify(caseLabels));

  // 2. Negative: a blocked UC-D proves the files are read and later rules still run.
  const blocked = makeI13Project("blocked", "blocked");
  const blockedResult = run(blocked.project, ["check", "--sensor", "test-case-derivation", "--module", MODULE]);
  assert.notEqual(blockedResult.status, 0);
  const blockedOutput = `${blockedResult.stdout}\n${blockedResult.stderr}`;
  assert.match(blockedOutput, /cannot complete while any UC-D is blocked/);
  assert.doesNotMatch(blockedOutput, /contains no UC-D identifiers/);

  // 3. allFiles helper: relative and absolute bases return the same files.
  const contextualize = (path: string) => path.replace("docs/aidlc/inception", `docs/aidlc/modules/${MODULE}/inception`);
  const relativeBase = "docs/aidlc/inception/application-design/test-cases";
  const absoluteBase = join(ready.project, contextualize(relativeBase));
  const fromRelative = scanFiles(ready.project, relativeBase, /\.md$/, { contextualize });
  const fromAbsolute = scanFiles(ready.project, absoluteBase, /\.md$/, { contextualize });
  assert.equal(fromRelative.length, 2, JSON.stringify(fromRelative));
  assert.deepEqual(fromAbsolute, fromRelative);
  const allowsCalls: string[] = [];
  scanFiles(ready.project, absoluteBase, /\.md$/, { contextualize, allows: (path) => { allowsCalls.push(path); return true; } });
  assert.deepEqual(allowsCalls.sort(), fromRelative, "allows filter must receive the same absolute file paths");

  // 4. Path semantics: absolute bases are idempotent under both POSIX and Windows rules.
  for (const [label, api, root, rel] of [
    ["posix", nodePath.posix, "/r", "x/y"],
    ["win32", nodePath.win32, "E:\\r", "x\\y"],
  ] as const) {
    const joined = resolveScanRoot(root, rel, (path) => path, api);
    assert.equal(joined, api.join(root, rel), `${label} relative base joins root`);
    assert.equal(resolveScanRoot(root, joined, (path) => path, api), joined, `${label} absolute base is not re-joined`);
    assert.equal(resolveScanRoot(root, joined, () => "ignored", api), joined, `${label} absolute base is not contextualized`);
  }

  console.log("I13 case root regression tests passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
