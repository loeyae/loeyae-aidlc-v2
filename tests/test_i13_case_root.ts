import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import { join, relative, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { resolveScanRoot, scanFiles } from "../core/tools/aidlc-scan-root";

// Regression: I13 test-case-derivation passed an absolute caseRoot into allFiles,
// which re-joined ROOT and never found the UC-D files.
// MARS-273 S2: aggregate source_coverage (positive coverage + dangling refs),
// per-file ucd_sources emission, and the unit req_refs convergence of the
// traceability-matrix tests layer.

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
  writeFileSync(join(inception, "requirements.md"), "# Requirements\nREQ-1 订单导出：验收标准为 30 秒内完成\n", "utf8");
  writeFileSync(join(cases, "_index.md"), "# UC-D index\n- UC-D-001 订单导出\n", "utf8");
  const caseFile = join(cases, "UC-D-001-export.md");
  const blockedFields = caseStatus === "blocked" ? "blocked_kind: business-unknown\n" : "";
  writeFileSync(caseFile, `---\nid: UC-D-001\nstatus: ${caseStatus}\nsource_ref: REQ-1\n${blockedFields}---\n# UC-D-001 订单导出\n`, "utf8");
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

  // --- MARS-273 S2: aggregate source_coverage + per-file ucd_sources ---

  type CaseFile = { name: string; content: string };
  function makeAggregateProject(name: string, requirements: string, caseFiles: CaseFile[], indexContent?: string): { project: string; casePaths: string[] } {
    const project = join(scratch, name);
    const inception = join(project, "docs", "aidlc", "modules", MODULE, "inception");
    const cases = join(inception, "application-design", "test-cases");
    mkdirSync(cases, { recursive: true });
    writeFileSync(join(project, "README.md"), "I13 aggregate regression project\n", "utf8");
    writeFileSync(join(inception, "requirements.md"), requirements, "utf8");
    writeFileSync(join(cases, "_index.md"), indexContent ?? "# UC-D index\n- UC-D-001 订单导出\n", "utf8");
    const casePaths = caseFiles.map(({ name: file, content }) => {
      const path = join(cases, file);
      writeFileSync(path, content, "utf8");
      return path;
    });
    const state = createInitialState("express", "4.5.0", `workflow-${name}`, [], "I13 aggregate regression");
    state.completed_stages = ["workspace-detection", "state-template"];
    state.completed_stage_instances = ["workspace-detection", "state-template"];
    state.current_stage = "test-case-derivation";
    state.current_phase = "inception";
    state.current_stage_instance = `test-case-derivation@module:${MODULE}`;
    state.current_module = MODULE;
    saveWorkflowState(project, state);
    return { project, casePaths };
  }

  function checkI13(project: string): { status: number; output: string; evidence: Record<string, unknown> | null } {
    const result = run(project, ["check", "--sensor", "test-case-derivation", "--module", MODULE]);
    let evidence: Record<string, unknown> | null = null;
    try { evidence = JSON.parse(result.stdout) as Record<string, unknown>; } catch { /* failure output is not JSON */ }
    return { status: result.status ?? 1, output: `${result.stdout}\n${result.stderr}`, evidence };
  }

  const REQ_1_2 = "# Requirements\nREQ-1 订单导出：验收标准为 30 秒内完成\nREQ-2 导出审计：验收标准为全量记录\n";
  const singleCase = { name: "UC-D-001-export.md", content: "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001 订单导出\n" };
  const jsonBlock = (coverage: string) => `# UC-D index\n- UC-D-001 订单导出\n\n\`\`\`json\n{ "source_coverage": ${coverage} }\n\`\`\`\n`;

  // 5. Derived emission: source_coverage aggregates UC-D source_ref refs; ucd_sources is per-file.
  {
    const { project } = makeAggregateProject("aggregate-derived", REQ_1_2, [singleCase]);
    const check = checkI13(project);
    assert.equal(check.status, 0, check.output);
    assert.deepEqual(check.evidence?.source_coverage, { "REQ-1": ["UC-D-001"] });
    const ucdSources = check.evidence?.ucd_sources as Record<string, { sha256: string; ucd_ids: string[] }>;
    const key = relative(project, join(project, "docs", "aidlc", "modules", MODULE, "inception", "application-design", "test-cases", singleCase.name));
    assert.deepEqual(Object.keys(ucdSources), [key], JSON.stringify(ucdSources));
    assert.deepEqual(ucdSources[key].ucd_ids, ["UC-D-001"]);
    assert.match(ucdSources[key].sha256, /^[a-f0-9]{64}$/);
  }

  // 6. Multi-UC-D single file: both declarations land in one per-file ucd_sources entry.
  {
    const content = "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001\n---\nid: UC-D-002\nstatus: ready\nsource_ref: REQ-2\n---\n# UC-D-002\n";
    const { project } = makeAggregateProject("aggregate-multi", REQ_1_2, [{ name: "UC-D-export.md", content }]);
    const check = checkI13(project);
    assert.equal(check.status, 0, check.output);
    assert.deepEqual(check.evidence?.source_coverage, { "REQ-1": ["UC-D-001"], "REQ-2": ["UC-D-002"] });
    const ucdSources = check.evidence?.ucd_sources as Record<string, { sha256: string; ucd_ids: string[] }>;
    const key = Object.keys(ucdSources)[0];
    assert.deepEqual(ucdSources[key].ucd_ids, ["UC-D-001", "UC-D-002"]);
    assert.equal(ucdSources[key].sha256, createHash("sha256").update(content, "utf8").digest("hex"));
  }

  // 7. source_ref array form feeds the aggregate.
  {
    const { project } = makeAggregateProject("aggregate-array-ref", REQ_1_2, [
      { name: "UC-D-001-export.md", content: "---\nid: UC-D-001\nstatus: ready\nsource_ref: [REQ-1, REQ-2]\n---\n# UC-D-001\n" },
    ]);
    const check = checkI13(project);
    assert.equal(check.status, 0, check.output);
    assert.deepEqual(check.evidence?.source_coverage, { "REQ-1": ["UC-D-001"], "REQ-2": ["UC-D-001"] });
  }

  // 8. Declared JSON block, consistent with the UC-D files, passes and is validated.
  {
    const { project } = makeAggregateProject("aggregate-declared-json", "# Requirements\nREQ-1 订单导出：验收标准为 30 秒内完成\n", [singleCase], jsonBlock('{ "REQ-1": ["UC-D-001"] }'));
    const check = checkI13(project);
    assert.equal(check.status, 0, check.output);
    assert.deepEqual(check.evidence?.source_coverage, { "REQ-1": ["UC-D-001"] });
  }

  // 9. Declared YAML block, consistent, passes.
  {
    const index = "# UC-D index\n- UC-D-001 订单导出\n\n```yaml\nsource_coverage:\n  REQ-1:\n    - UC-D-001\n```\n";
    const { project } = makeAggregateProject("aggregate-declared-yaml", "# Requirements\nREQ-1 订单导出：验收标准为 30 秒内完成\n", [singleCase], index);
    const check = checkI13(project);
    assert.equal(check.status, 0, check.output);
  }

  // 10. Dangling source in the declared block is machine-blocked.
  {
    const { project } = makeAggregateProject("aggregate-dangling-source", "# Requirements\nREQ-1 订单导出：验收标准为 30 秒内完成\n", [singleCase], jsonBlock('{ "REQ-9": ["UC-D-001"] }'));
    const check = checkI13(project);
    assert.notEqual(check.status, 0);
    assert.match(check.output, /DANGLING_REF@source_coverage: REQ-9/);
  }

  // 11. Declared mapping to a UC-D that does not exist is machine-blocked (the index
  // mention feeds the ready-UC-D gate, which fails before the aggregate check).
  {
    const { project } = makeAggregateProject("aggregate-dangling-ucd", "# Requirements\nREQ-1 订单导出：验收标准为 30 秒内完成\n", [singleCase], jsonBlock('{ "REQ-1": ["UC-D-999"] }'));
    const check = checkI13(project);
    assert.notEqual(check.status, 0);
    assert.match(check.output, /UC-D-999/);
  }

  // 12. Declared mapping conflicting with the UC-D source_ref is machine-blocked.
  {
    const second = { name: "UC-D-002-audit.md", content: "---\nid: UC-D-002\nstatus: ready\nsource_ref: REQ-2\n---\n# UC-D-002\n" };
    const { project } = makeAggregateProject("aggregate-conflict", REQ_1_2, [singleCase, second], jsonBlock('{ "REQ-2": ["UC-D-001"] }'));
    const check = checkI13(project);
    assert.notEqual(check.status, 0);
    assert.match(check.output, /source_coverage conflict/);
  }

  // 13. Declared block missing a derived mapping is rejected.
  {
    const second = { name: "UC-D-002-audit.md", content: "---\nid: UC-D-002\nstatus: ready\nsource_ref: REQ-2\n---\n# UC-D-002\n" };
    const { project } = makeAggregateProject("aggregate-mismatch", REQ_1_2, [singleCase, second], jsonBlock('{ "REQ-1": ["UC-D-001"] }'));
    const check = checkI13(project);
    assert.notEqual(check.status, 0);
    assert.match(check.output, /does not match the aggregate/);
  }

  // 14. Positive coverage: an uncovered requirement fails only when source_coverage is declared.
  {
    const { project } = makeAggregateProject("aggregate-uncovered-declared", REQ_1_2, [singleCase], jsonBlock('{ "REQ-1": ["UC-D-001"] }'));
    const declared = checkI13(project);
    assert.notEqual(declared.status, 0);
    assert.match(declared.output, /uncovered: REQ-2/);
    const legacy = makeAggregateProject("aggregate-uncovered-legacy", REQ_1_2, [singleCase]);
    const legacyCheck = checkI13(legacy.project);
    assert.equal(legacyCheck.status, 0, legacyCheck.output);
  }

  // 15. Two source_coverage blocks in one index are rejected.
  {
    const index = "# UC-D index\n\n```json\n{ \"source_coverage\": { \"REQ-1\": [\"UC-D-001\"] } }\n```\n\n```json\n{ \"source_coverage\": { \"REQ-1\": [\"UC-D-001\"] } }\n```\n";
    const { project } = makeAggregateProject("aggregate-duplicate", "# Requirements\nREQ-1 订单导出：验收标准为 30 秒内完成\n", [singleCase], index);
    const check = checkI13(project);
    assert.notEqual(check.status, 0);
    assert.match(check.output, /source_coverage must be declared once/);
  }

  // --- MARS-273 S2: unit req_refs convergence of the traceability-matrix tests layer ---

  const MATRIX_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
  function gitInit(project: string): void {
    for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]]) {
      const result = spawnSync("git", args, { cwd: project, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr || String(result.error));
    }
  }

  function makeMatrixProject(name: string, options: { reqRefs?: string[]; i13?: Record<string, unknown> }): string {
    const project = join(scratch, `matrix-${name}`);
    const inception = join(project, "docs", "aidlc", "modules", MODULE, "inception");
    const cases = join(inception, "application-design", "test-cases");
    mkdirSync(cases, { recursive: true });
    mkdirSync(join(project, "docs", "aidlc", "ideation"), { recursive: true });
    mkdirSync(join(project, "services"), { recursive: true });
    mkdirSync(join(project, "tests"), { recursive: true });
    writeFileSync(join(project, "docs", "aidlc", "ideation", "module-manifest.json"), JSON.stringify({
      schema_version: 1,
      modules: [{ module_id: MODULE, name: "Orders", service_id: "order-service", paths: ["services"] }],
    }), "utf8");
    writeFileSync(join(inception, "requirements.md"), "# Requirements\n\n## REQ-001 Order export retry\ntrack: [backend]\nRetries on timeout.\n\n## REQ-002 Export audit\ntrack: [backend]\nEvery export is audited.\n", "utf8");
    writeFileSync(join(inception, "user-stories.md"), "# User stories\n\n## STORY-001 Retry (REQ-001)\n- AC-01 retry succeeds\n\n## STORY-002 Audit (REQ-002)\n- AC-02 audit row written\n", "utf8");
    writeFileSync(join(inception, "application-design.md"), "# Application design\n\n- ExportService implements REQ-001 and REQ-002.\n", "utf8");
    writeFileSync(join(cases, "_index.md"), "# UC-D index\n\n- UC-D-001 export\n", "utf8");
    writeFileSync(join(cases, "UC-D-001.md"), "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-001\ntdd_mode: new\nunit_refs: [u-a]\n---\n# UC-D-001 export\n\nGiven REQ-001 and REQ-002, When the export runs, Then it retries and is audited.\n", "utf8");
    writeFileSync(join(inception, "unit-manifest.json"), JSON.stringify({
      schema_version: 1,
      module_id: MODULE,
      units: [{ unit_id: "u-a", name: "Export", service_id: "order-service", ...(options.reqRefs ? { req_refs: options.reqRefs } : {}) }],
    }, null, 2), "utf8");
    writeFileSync(join(project, "services", "export.py"), "# REQ-001 REQ-002 UC-D-001 export retry and audit\ndef export(job):\n    return job\n", "utf8");
    writeFileSync(join(project, "tests", "test_export.py"), "# REQ-001 REQ-002 UC-D-001\ndef test_export():\n    assert True\n", "utf8");
    const i13 = options.i13 ?? { status: "required", ucd_ids: ["UC-D-001"], ucd_modes: { "UC-D-001": "new" }, ucd_units: { "UC-D-001": ["u-a"] } };
    mkdirSync(join(project, ".aidlc", "evidence", "test-case-derivation", MODULE), { recursive: true });
    writeFileSync(join(project, ".aidlc", "evidence", "test-case-derivation", MODULE, "test-case-derivation.json"), JSON.stringify(i13), "utf8");
    gitInit(project);
    const state = createInitialState("feature", "4.22.12", `workflow-matrix-${name}`, [], "I13 matrix regression");
    state.completed_stages = [...MATRIX_STAGES];
    state.completed_stage_instances = [...MATRIX_STAGES];
    saveWorkflowState(project, state);
    return project;
  }

  function matrix(project: string, unit?: string): { status: number; output: string; record: Record<string, unknown> | null } {
    const result = spawnSync(process.execPath, [tsx, cli, "check", "--sensor", "traceability-matrix", "--module", MODULE, ...(unit ? ["--unit", unit] : [])], {
      cwd: project, encoding: "utf8", env: { ...process.env, AIDLC_ACTIVE_STAGE: "code-generation" },
    });
    let record: Record<string, unknown> | null = null;
    try { record = JSON.parse(result.stdout) as Record<string, unknown>; } catch { /* failure output is not JSON */ }
    return { status: result.status ?? 1, output: `${result.stdout}\n${result.stderr}`, record };
  }

  // 16. req_refs and ucd_subset produce equivalent matrix rows; only code_refs_source differs.
  {
    const subsetProject = makeMatrixProject("ucd-subset", {});
    const refsProject = makeMatrixProject("req-refs", { reqRefs: ["REQ-001", "REQ-002"] });
    const subset = matrix(subsetProject, "u-a");
    const refs = matrix(refsProject, "u-a");
    assert.equal(subset.status, 0, subset.output);
    assert.equal(refs.status, 0, refs.output);
    assert.deepEqual(subset.record?.broken_rows, refs.record?.broken_rows);
    const subsetScope = subset.record?.unit_scope as Record<string, unknown>;
    const refsScope = refs.record?.unit_scope as Record<string, unknown>;
    assert.deepEqual(subsetScope.tests_layer_reqs, ["REQ-001", "REQ-002"]);
    assert.deepEqual(refsScope.tests_layer_reqs, ["REQ-001", "REQ-002"]);
    assert.equal(subsetScope.code_refs_source, "ucd_subset");
    assert.equal(refsScope.code_refs_source, "req_refs");
  }

  // 17. req_refs entries missing from source_coverage surface as an UNCOVERED_REQ row.
  {
    const project = makeMatrixProject("req-refs-conflict", { reqRefs: ["REQ-001", "REQ-002"], i13: { status: "required", ucd_ids: ["UC-D-001"], ucd_modes: { "UC-D-001": "new" }, ucd_units: { "UC-D-001": ["u-a"] }, source_coverage: { "REQ-001": ["UC-D-001"] } } });
    const result = matrix(project, "u-a");
    assert.equal(result.status, 0, result.output);
    const rows = result.record?.broken_rows as string[];
    assert.deepEqual(rows.filter((row) => row.includes("UNCOVERED_REQ@source_coverage")), ["REQ-002: UNCOVERED_REQ@source_coverage(unit u-a.req_refs 未被聚合层 source_coverage 覆盖)"]);
    const scope = result.record?.unit_scope as Record<string, unknown>;
    assert.deepEqual(scope.tests_layer_reqs, ["REQ-001", "REQ-002"]);
  }

  // 18. Legacy I13 evidence (old per-UC-D ucd_sources form, no source_coverage) stays compatible.
  {
    const project = makeMatrixProject("legacy-evidence", {
      reqRefs: ["REQ-001", "REQ-002"],
      i13: { status: "required", ucd_ids: ["UC-D-001"], ucd_modes: { "UC-D-001": "new" }, ucd_units: { "UC-D-001": ["u-a"] },
        ucd_sources: { "UC-D-001": { file: `docs/aidlc/modules/${MODULE}/inception/application-design/test-cases/UC-D-001.md`, sha256: "a".repeat(64) } } },
    });
    const result = matrix(project, "u-a");
    assert.equal(result.status, 0, result.output);
    assert.ok(!(result.record?.broken_rows as string[]).some((row) => row.includes("UNCOVERED_REQ")));
    const scope = result.record?.unit_scope as Record<string, unknown>;
    assert.deepEqual(scope.tests_layer_reqs, ["REQ-001", "REQ-002"]);
  }

  console.log("I13 case root regression tests passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
