import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { normalizeUcdSources } from "../core/tools/aidlc-ucd-declarations";

// MARS-273: aggregated source_coverage validation and dual-form ucd_sources.

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars273-"));
const MODULE = "project";

function run(project: string): { status: number; output: string; evidence: Record<string, unknown> | null } {
  const result = spawnSync(process.execPath, [tsx, cli, "check", "--sensor", "test-case-derivation", "--module", MODULE], { cwd: project, encoding: "utf8" });
  let evidence: Record<string, unknown> | null = null;
  try { evidence = JSON.parse(result.stdout) as Record<string, unknown>; } catch { evidence = null; }
  return { status: result.status ?? 1, output: `${result.stdout || ""}\n${result.stderr || ""}`, evidence };
}

type Fixture = { requirements?: string; index?: string; extraCase?: string };

let counter = 0;
function makeProject(fixture: Fixture): string {
  const project = join(scratch, `p${++counter}`);
  const inception = join(project, "docs", "aidlc", "modules", MODULE, "inception");
  const cases = join(inception, "application-design", "test-cases");
  mkdirSync(cases, { recursive: true });
  writeFileSync(join(project, "README.md"), "MARS-273 source coverage test\n", "utf8");
  writeFileSync(join(inception, "requirements.md"), fixture.requirements
    ?? "# Requirements\nREQ-1 订单导出：验收标准为 30 秒内完成\n", "utf8");
  writeFileSync(join(cases, "_index.md"), fixture.index ?? "# UC-D index\n- UC-D-001 订单导出\n", "utf8");
  writeFileSync(join(cases, "UC-D-001-export.md"), "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001 订单导出\n", "utf8");
  if (fixture.extraCase) writeFileSync(join(cases, "UC-D-002-extra.md"), fixture.extraCase, "utf8");
  const state = createInitialState("express", "4.5.0", `mars273-${counter}`, [], "MARS-273 source coverage");
  state.completed_stages = ["workspace-detection", "state-template"];
  state.completed_stage_instances = ["workspace-detection", "state-template"];
  state.current_stage = "test-case-derivation";
  state.current_phase = "inception";
  state.current_stage_instance = `test-case-derivation@module:${MODULE}`;
  state.current_module = MODULE;
  saveWorkflowState(project, state);
  assert.ok(loadWorkflowState(project));
  return project;
}

const caseFile = "docs/aidlc/modules/project/inception/application-design/test-cases/UC-D-001-export.md";

try {
  // 1. Unit: normalizeUcdSources — legacy per-UC-D map and file-level form compare equal.
  const sha = createHash("sha256").update("x").digest("hex");
  const legacy = { "UC-D-001": { file: caseFile, sha256: sha }, "UC-D-002": { file: caseFile, sha256: sha } };
  const fileLevel = { files: [{ file: caseFile, sha256: sha, ucd_ids: ["UC-D-002", "UC-D-001"] }] };
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeUcdSources(legacy))), JSON.parse(JSON.stringify(normalizeUcdSources(fileLevel))));
  assert.equal(normalizeUcdSources(undefined), undefined);
  assert.throws(() => normalizeUcdSources("nope"), /must be an object/);
  assert.throws(() => normalizeUcdSources({ files: [{ file: caseFile, sha256: "short", ucd_ids: ["UC-D-001"] }] }), /sha256 is invalid/);
  assert.throws(() => normalizeUcdSources({ "UC-D-001": { file: caseFile, sha256: sha }, "NOPE": { file: caseFile, sha256: sha } }), /not a UC-D id/);

  // 2. E2E: declared source_coverage passes and lands in the evidence; ucd_sources is file-level.
  const declaredProject = makeProject({ index: "---\nsource_coverage:\n  REQ-1: [UC-D-001]\n---\n# UC-D index\n" });
  const declared = run(declaredProject);
  assert.equal(declared.status, 0, declared.output);
  assert.deepEqual(declared.evidence?.source_coverage, { "REQ-1": ["UC-D-001"] }, declared.output);
  const sources = normalizeUcdSources(declared.evidence?.ucd_sources)!;
  assert.equal(sources.length, 1);
  assert.equal(sources[0].file, caseFile);
  assert.deepEqual(sources[0].ucd_ids, ["UC-D-001"]);
  assert.equal(sources[0].sha256, createHash("sha256").update(readFileSync(join(declaredProject, caseFile), "utf8")).digest("hex"));

  // 3. E2E: legacy projects without source_coverage keep passing (zero migration).
  const legacyRun = run(makeProject({}));
  assert.equal(legacyRun.status, 0, legacyRun.output);
  assert.equal(legacyRun.evidence?.source_coverage, undefined);
  assert.ok(Array.isArray((legacyRun.evidence?.ucd_sources as { files?: unknown[] })?.files));

  // 4. E2E: a fenced ```source_coverage block is accepted too.
  const fenced = run(makeProject({ index: "# UC-D index\n\n```source_coverage\nREQ-1: [UC-D-001]\n```\n" }));
  assert.equal(fenced.status, 0, fenced.output);
  assert.deepEqual(fenced.evidence?.source_coverage, { "REQ-1": ["UC-D-001"] });

  // 5. E2E: a UC-D id that exists nowhere is rejected — the notReady guard fires first
  // (idsFound scans _index.md too), the DANGLING_REF@source_coverage check is defense in depth.
  const danglingUcd = run(makeProject({ index: "---\nsource_coverage:\n  REQ-1: [UC-D-009]\n---\n" }));
  assert.notEqual(danglingUcd.status, 0);
  assert.match(danglingUcd.output, /UC-D-009/);

  // 6. E2E: a source key absent from the source artifacts is rejected.
  const danglingSource = run(makeProject({ index: "---\nsource_coverage:\n  NFR-9: [UC-D-001]\n  REQ-1: [UC-D-001]\n---\n" }));
  assert.notEqual(danglingSource.status, 0);
  assert.match(danglingSource.output, /DANGLING_REF@source_coverage: source NFR-9 not found/);

  // 7. E2E: positive coverage — every REQ of requirements.md must be a key.
  const missingReq = run(makeProject({
    requirements: "# Requirements\nREQ-1 订单导出：验收标准为 30 秒内完成\nREQ-2 订单取消：验收标准为可取消\n",
    index: "---\nsource_coverage:\n  REQ-1: [UC-D-001]\n---\n",
  }));
  assert.notEqual(missingReq.status, 0);
  assert.match(missingReq.output, /must map every requirement source.*REQ-2/);

  // 8. E2E: every declared source is satisfied once all REQs are mapped.
  const covered = run(makeProject({
    requirements: "# Requirements\nREQ-1 订单导出：验收标准为 30 秒内完成\nREQ-2 订单取消：验收标准为可取消\n",
    index: "---\nsource_coverage:\n  REQ-1: [UC-D-001]\n  REQ-2: [UC-D-002]\n---\n",
    extraCase: "---\nid: UC-D-002\nstatus: ready\nsource_ref: REQ-2\n---\n# UC-D-002 订单取消\n",
  }));
  assert.equal(covered.status, 0, covered.output);
  assert.deepEqual(covered.evidence?.source_coverage, { "REQ-1": ["UC-D-001"], "REQ-2": ["UC-D-002"] });

  // 9. E2E: an empty ucd_ids list under a source key is rejected.
  const emptyList = run(makeProject({ index: "---\nsource_coverage:\n  REQ-1: [ ]\n---\n" }));
  assert.notEqual(emptyList.status, 0);
  assert.match(emptyList.output, /source_coverage source REQ-1 maps no UC-D/);

  console.log("MARS-273 source_coverage + dual-form ucd_sources tests passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
