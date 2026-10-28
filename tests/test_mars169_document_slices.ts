import { generateSlices, recoverCanonical, createUiGenerationLock } from "./mars244_fixture_writers";
import { fixtureEnvironment, saveFixtureState as saveWorkflowState } from "./mars243_fixture_session";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync, symlinkSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { HarnessManifest } from "../scripts/manifest-types";
import { spawnSync } from "node:child_process";
import { parseDocument } from "../core/tools/aidlc-document-parser";
import { parseStoryDefinitions } from "../core/tools/aidlc-story-index";
import { buildBusinessDocumentLoadPlan, checkSlices, sliceAdoption, sliceEvidenceErrors, type SliceContext } from "../core/tools/aidlc-document-slices";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { verifyUiGenerationLockAtBaseline } from "../core/tools/aidlc-ui-governance";

const repository = resolve(import.meta.dirname, "..");
class Fixture {
  root = mkdtempSync(join(tmpdir(), "mars169-"));
  base = "docs/aidlc/modules/shop/inception";
  state = createInitialState("feature", undefined, undefined, [], "document slices regression");
  ctx: SliceContext;
  mapping = { schema_version: 1, status: "approved", approved_by: "fixture-owner", mappings: [
    { story_id: "STORY-001", unit_ids: ["api"] }, { story_id: "US-002", unit_ids: ["web"] },
    { story_id: "STORY-003", unit_ids: ["api", "web"] }, { story_id: "STORY-004", unit_ids: ["worker"] },
  ], shared_req_refs: ["REQ-NFR"] };
  units = [
    { unit_id: "api", name: "Api", service_id: "shop", req_refs: ["REQ-001", "REQ-003", "REQ-NFR"] },
    { unit_id: "web", name: "Web", service_id: "shop", req_refs: ["REQ-002", "REQ-003", "REQ-NFR"] },
    { unit_id: "worker", name: "Worker", service_id: "shop", req_refs: ["REQ-004", "REQ-NFR"] },
  ];
  constructor() {
    this.state.document_slices_version = "1";
    this.state.completed_stages = ["module-division"];
    this.state.completed_stage_instances = ["module-division"];
    this.state.current_module = "shop"; this.state.current_stage = "units-generation";
    this.state.current_stage_instance = "units-generation@module:shop";
    this.ctx = { root: this.root, workflow_id: this.state.workflow_id, scope: "feature", stage: "units-generation", module_id: "shop", ui_route: "not-selected", slices_version: "1", units_executed: true };
    this.write("docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [{ module_id: "shop", name: "Shop", service_id: "shop", paths: ["src"] }] }));
    this.write(`${this.base}/requirements.md`, "# Requirements\r\n全局约束：完整保留。\r\n" + ["001", "002", "003", "004", "NFR"].map(id => `## REQ-${id} 需求\r\n完整中文正文 ${id}。\r\n`).join(""));
    this.write(`${this.base}/user-stories.md`, "# User stories\n共享原则：不可裁剪。\n" + ["STORY-001", "US-002", "STORY-003", "STORY-004"].map((id, i) => `## ${id} 标题\n来源: REQ-00${i + 1}\n普通引用 STORY-001 不定义故事\n### AC-00${i + 1} 正常\nGiven 前提\nWhen 操作\nThen 完整结果\n\n~~~gherkin\n## STORY-FAKE 代码内不是定义\nGiven 表格\n| 中文 | 原样 |\n~~~\n### AC-X${i + 1} 失败边界\n边界完整保留\n`).join(""));
    this.sync(); saveWorkflowState(this.root, this.state);
    this.runGit(["init", "-q"]); this.runGit(["add", "."]); this.runGit(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]);
  }
  write(path: string, body: string) { mkdirSync(resolve(this.root, path, ".."), { recursive: true }); writeFileSync(join(this.root, path), body); }
  read(path: string) { return readFileSync(join(this.root, path), "utf8"); }
  sync() {
    this.write(`${this.base}/unit-manifest.json`, JSON.stringify({ schema_version: 1, module_id: "shop", units: this.units }));
    this.write(`${this.base}/application-design/unit-of-work-story-map.md`, '# Approved map\n```aidlc-story-map\n' + JSON.stringify(this.mapping) + '\n```\n');
  }
  runGit(args: string[]) { const r = spawnSync("git", args, { cwd: this.root, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); }
  run(script: string, args: string[]) { return spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, script), ...args], { cwd: this.root, encoding: "utf8", env: fixtureEnvironment(this.root, script === "bin/cli.ts" ? args : ["evidence", ...args]) }); }
  manifest() { return this.read(`${this.base}/document-slices/manifest.json`); }
  produce() { return this.run("core/tools/aidlc-evidence.ts", ["run", "--stage", "units-generation", "--module", "shop", "--sensor", "document-slice-consistency"]); }
  gate() { const r = this.run("tests/gate_probe.ts", ["units-generation@module:shop", "sensors", "document-slice-consistency"]); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout).failures as string[]; }
}
const f = new Fixture();
const source = f.read(`${f.base}/user-stories.md`), req = f.read(`${f.base}/requirements.md`);
const parsed = parseDocument(source, "stories");
assert.equal(parsed.entries.filter(e => e.kind === "story").length, 4);
assert.equal(parsed.entries.filter(e => e.kind === "ac").length, 8);
assert.ok(parsed.entries.find(e => e.id === "STORY-001")!.text.includes("~~~gherkin\n## STORY-FAKE"));
assert.equal(parseStoryDefinitions(source).filter(e => e.kind === "story").length, 4);
assert.throws(() => parseDocument(source + "## STORY-001 duplicate\n", "stories"), /DUPLICATE/);
assert.throws(() => parseDocument("### AC-ORPHAN bad\n", "stories"), /ORPHAN/);
assert.throws(() => parseDocument("## US-1\n```js\n", "stories"), /UNCLOSED/);
assert.throws(() => parseDocument("## US-1\n来源: REQ-001\n## Other section\n### AC-ORPHAN\n", "stories"), /ORPHAN/);
assert.equal(parseDocument("    ## STORY-CODE\n", "stories").entries.length, 0);
const nestedFence = parseDocument("## STORY-001\n来源: REQ-001\n~~~~markdown\n```example\n来源: REQ-FAKE\n```\n~~~~\n### AC-1\nGiven 中文\n", "stories");
assert.deepEqual(nestedFence.entries[0].req_refs, ["REQ-001"]);
const nestedList = "## STORY-001 登录\n来源: REQ-001\n- 验收标准\n    - AC-001 正常登录\n      Given 用户已注册\n      Then 登录成功\n";
assert.deepEqual(parseDocument(nestedList, "stories").entries.map(e => [e.id, e.owner]), [["STORY-001", undefined], ["AC-001", "STORY-001"]]);
assert.equal(parseStoryDefinitions(nestedList).filter(e => e.kind === "ac").length, 1);
assert.throws(() => parseDocument(nestedList + "    - AC-001 重复\n", "stories"), /DUPLICATE/);
assert.throws(() => parseDocument("- 验收标准\n    - AC-001 孤立\n", "stories"), /ORPHAN/);
assert.deepEqual(parseDocument("## STORY-001\nRequirements are discussed in REQ-001, ownership is undecided\n### AC-001\nThen ok\n", "stories").entries[0].req_refs, []);
for (const declaration of ["来源: REQ-001", "**来源:** REQ-001", "Source: REQ-001", "- **需求来源**：REQ-001"]) assert.deepEqual(parseDocument(`## STORY-001\n${declaration}\n`, "stories").entries[0].req_refs, ["REQ-001"]);
const nestedStory = parseDocument("- Feature\n    - STORY-001 title\n      Source: REQ-001\n        - AC-001 pass\n          Then ok\n", "stories");
assert.deepEqual(nestedStory.entries[0].req_refs, ["REQ-001"]);
assert.throws(() => checkSlices(f.ctx), /MISSING/);
f.write(`${f.base}/ui-design/page-plan.md`, "# Page plan\nPAGE-001 REQ-001 STORY-001 AC-001\n");
createUiGenerationLock(f.root, { moduleId: "shop", route: "html-mock", upstreamRef: "HEAD" });
const uiBeforeSlices = verifyUiGenerationLockAtBaseline(f.root, "shop", "html-mock", ["PAGE-001"]);
const initialGeneration = generateSlices(f.ctx); const first = f.manifest();
assert.deepEqual(verifyUiGenerationLockAtBaseline(f.root, "shop", "html-mock", ["PAGE-001"]), uiBeforeSlices, "slicing preserves the real UI canonical source lock");
assert.equal(checkSlices(f.ctx).status, "passed");
const staleLockPath = `${f.base}/document-slices/writer.lock`;
f.write(`${f.base}/document-slices/recovery.lock`, "another recovery owns the critical section");
assert.throws(() => recoverCanonical(f.ctx, true), /SLICE_RECOVERY_LOCK_HELD/);
unlinkSync(join(f.root, `${f.base}/document-slices/recovery.lock`));
f.write(staleLockPath, JSON.stringify({ schema_version: 1, pid: 2147483647, hostname: hostname() }));
assert.equal(recoverCanonical(f.ctx).stale_writer_lock, staleLockPath);
assert.ok(existsSync(join(f.root, staleLockPath)));
recoverCanonical(f.ctx, true); assert.ok(!existsSync(join(f.root, staleLockPath)));
f.write(staleLockPath, JSON.stringify({ schema_version: 1, pid: process.pid, hostname: hostname() }));
assert.throws(() => recoverCanonical(f.ctx, true), /CONFLICT/); unlinkSync(join(f.root, staleLockPath));
generateSlices(f.ctx); assert.equal(f.manifest(), first);
assert.equal(f.read(`${f.base}/requirements.md`), req); assert.equal(f.read(`${f.base}/user-stories.md`), source);
const worker = buildBusinessDocumentLoadPlan(f.ctx, "worker");
const workerText = worker.files.map(i => f.read(i.path)).join("\n");
assert.ok(workerText.includes("AC-004")); assert.ok(workerText.includes("REQ-NFR"));
assert.ok(!workerText.includes("STORY-003")); assert.ok(!workerText.includes("AC-001"));
const webText = buildBusinessDocumentLoadPlan(f.ctx, "web").files.map(i => f.read(i.path)).join("\n");
assert.ok(webText.includes("STORY-003") && webText.includes("AC-X3") && webText.includes("共享原则"));
assert.ok(worker.bytes > 0 && worker.estimated_tokens > 0);
const produced = f.produce(); assert.equal(produced.status, 0, produced.stdout + produced.stderr);
assert.deepEqual(f.gate(), []);
const evidencePath = ".aidlc/evidence/units-generation/shop/document-slice-consistency.json";
const originalState = structuredClone(f.state);
f.state.completed_stages.push("units-generation");
f.state.completed_stage_instances.push("units-generation@module:shop");
f.state.current_stage = ""; f.state.current_stage_instance = undefined;
saveWorkflowState(f.root, f.state);
const refreshSlice = () => f.run("core/tools/aidlc-evidence.ts", ["run", "--stage", "units-generation", "--module", "shop", "--sensor", "document-slice-consistency", "--refresh"]);
const firstRefresh = refreshSlice(); assert.equal(firstRefresh.status, 0, firstRefresh.stdout + firstRefresh.stderr);
assert.match(firstRefresh.stderr, /\[aidlc\] main repository .*elapsed=.*last_progress=/);
const reuse = refreshSlice(); assert.equal(reuse.status, 0, reuse.stdout + reuse.stderr);
assert.equal(JSON.parse(reuse.stdout).action, "reused");
const cliRefresh = f.run("bin/cli.ts", ["evidence", "run", "--stage", "units-generation", "--module", "shop", "--sensor", "document-slice-consistency", "--refresh"]);
assert.equal(cliRefresh.status, 0, cliRefresh.stdout + cliRefresh.stderr);
assert.equal(JSON.parse(cliRefresh.stdout).action, "reused");
assert.match(cliRefresh.stderr, /\[aidlc\] main repository/);
const freshEvidence = JSON.parse(f.read(evidencePath));
assert.ok(Array.isArray(freshEvidence.inputs));
assert.match(freshEvidence.stage_inputs.digest, /^[a-f0-9]{64}$/);
f.write(evidencePath, JSON.stringify({ ...freshEvidence, producer: { ...freshEvidence.producer, name: "untrusted" } }));
const badProvenance = refreshSlice(); assert.equal(badProvenance.status, 0, badProvenance.stdout + badProvenance.stderr);
assert.equal(JSON.parse(badProvenance.stdout).action, "regenerated");
// Historical malformed records stored the stage fingerprint in inputs. Never reuse them.
f.write(evidencePath, JSON.stringify({ ...freshEvidence, inputs: freshEvidence.stage_inputs, stage_inputs: undefined }));
const repair = refreshSlice(); assert.equal(repair.status, 0, repair.stdout + repair.stderr);
assert.equal(JSON.parse(repair.stdout).action, "regenerated");
assert.deepEqual(f.gate(), []);
f.state = originalState; saveWorkflowState(f.root, f.state);
f.write(`${f.base}/requirements.md`, req.replace("完整中文正文 001", "变更正文 001"));
assert.ok(f.gate().length > 0, "changed authoritative inputs must invalidate evidence");
generateSlices(f.ctx);
const changed = f.produce(); assert.equal(changed.status, 0, changed.stdout + changed.stderr);
assert.deepEqual(f.gate(), []);
f.write(`${f.base}/requirements.md`, req);
generateSlices(f.ctx);
const restored = f.produce(); assert.equal(restored.status, 0, restored.stdout + restored.stderr);
assert.deepEqual(f.gate(), []);
if (process.argv.includes("--evidence-contract-only")) {
  console.log("PASS slice evidence generation, consumption, reuse and legacy repair");
  process.exit(0);
}
// Real report runs all declared controlled producers and exit gates.
f.write(`${f.base}/units.md`, "# Work units\nREQ-001 REQ-002 REQ-003 REQ-004 REQ-NFR approved unit responsibilities\n");
for (const name of ["unit-of-work", "unit-of-work-dependency"]) f.write(`${f.base}/application-design/${name}.md`, "# Approved unit design\nREQ-001 api, web and worker unit ownership and dependency boundaries.\n");
f.state.completed_stages.push("user-stories", "application-design");
f.state.completed_stage_instances.push("user-stories@module:shop", "application-design@module:shop"); saveWorkflowState(f.root, f.state);
for (const sensor of ["design-intent-coverage", "structural-invariants"]) {
  const result = f.run("core/tools/aidlc-evidence.ts", ["run", "--stage", "units-generation", "--module", "shop", "--sensor", sensor]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
const report = f.run("bin/cli.ts", ["orchestrate", "report", "--stage", "units-generation", "--module", "shop", "--result", "completed", "--user-input", "Approve"]);
assert.equal(report.status, 0, report.stdout + report.stderr);
f.state = loadWorkflowState(f.root)!;
const evidence = JSON.parse(f.read(".aidlc/evidence/units-generation/shop/document-slice-consistency.json"));
assert.deepEqual(sliceEvidenceErrors(f.ctx, evidence), []);
assert.ok(Array.isArray(evidence.inputs));
assert.match(evidence.stage_inputs.digest, /^[a-f0-9]{64}$/);
// Prepare actual next at the first construction stage without changing any gate.
const nextState = f.state;
nextState.current_stage = ""; nextState.current_stage_instance = undefined;
nextState.completed_stages = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template", "requirements-analysis", "user-stories", "cross-validation", "workflow-planning", "units-generation", "test-case-derivation"];
nextState.completed_stage_instances = nextState.completed_stages.map(s => ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"].includes(s) ? s : `${s}@module:shop`);
for (const s of ["reverse-engineering", "requirement-clarification", "requirements-methods", "application-design", "ui-mock"]) { nextState.skipped_stages.push(s); nextState.skipped_stage_instances.push(`${s}@module:shop`); }
f.write(`${f.base}/workflow-plan.md`, "# Execution plan\n| stage | decision |\n| functional-design | execute |\n| units-generation | execute |\n");
f.write("docs/aidlc/ideation/scenario-module-mapping.md", "REQ-001 all sources belong to shop and its units.\n");
saveWorkflowState(f.root, nextState);
const refresh = f.run("core/tools/aidlc-evidence.ts", ["run", "--stage", "units-generation", "--module", "shop", "--refresh", "--all-sensors"]);
assert.equal(refresh.status, 0, refresh.stdout + refresh.stderr);
const next = f.run("bin/cli.ts", ["orchestrate", "next"]);
assert.equal(next.status, 0, next.stdout + next.stderr);
const directive = JSON.parse(next.stdout);
assert.equal(directive.kind, "run-stage");
assert.equal(directive.business_document_load_plan.mode, "derived");
assert.equal("agent_execution" in directive, false);
assert.match(directive.handoff_prompt, /Business document load plan/);
const missingUpstream = ".aidlc/evidence/units-generation/shop/design-intent-coverage.json";
const savedUpstream = f.read(missingUpstream);
unlinkSync(join(f.root, missingUpstream));
const missingBefore = f.read("aidlc/active/aidlc-state.md");
const missingNext = f.run("bin/cli.ts", ["orchestrate", "next"]);
assert.equal(missingNext.status, 0, missingNext.stdout + missingNext.stderr);
const missingDirective = JSON.parse(missingNext.stdout);
assert.equal(missingDirective.execution_status, "isolated-work-exit-blocked");
assert.match(missingDirective.evidence_failures.join(" "), /design-intent-coverage/);
assert.equal(missingDirective.business_document_load_plan.mode, "canonical");
assert.equal(f.read("aidlc/active/aidlc-state.md"), missingBefore);
f.write(missingUpstream, savedUpstream);
const failedUpstream = JSON.parse(savedUpstream); failedUpstream.coverage_complete = false;
f.write(missingUpstream, JSON.stringify(failedUpstream));
const semanticFailure = f.run("bin/cli.ts", ["orchestrate", "next"]);
assert.notEqual(semanticFailure.status, 0, "semantic failure cannot be downgraded to missing evidence");
assert.match(semanticFailure.stdout + semanticFailure.stderr, /coverage_complete/);
f.write(missingUpstream, savedUpstream);
const validSliceEvidence = f.read(evidencePath);
const invalidSliceEvidence = JSON.parse(validSliceEvidence); invalidSliceEvidence.inputs = {};
f.write(evidencePath, JSON.stringify(invalidSliceEvidence));
const beforeIsolation = f.read("aidlc/active/aidlc-state.md");
const isolated = f.run("bin/cli.ts", ["orchestrate", "next"]);
assert.equal(isolated.status, 0, isolated.stdout + isolated.stderr);
const isolatedDirective = JSON.parse(isolated.stdout);
assert.equal(isolatedDirective.execution_status, "isolated-work-exit-blocked");
assert.equal(isolatedDirective.business_document_load_plan.mode, "canonical");
assert.ok(isolatedDirective.business_document_load_plan.files.some((item: { path: string }) => item.path.endsWith("unit-of-work-story-map.md")));
assert.equal(f.read("aidlc/active/aidlc-state.md"), beforeIsolation);
const blockedExit = f.run("bin/cli.ts", ["orchestrate", "report", "--stage", "functional-design", "--module", "shop", "--unit", "api", "--result", "completed"]);
assert.notEqual(blockedExit.status, 0, "isolated work must not authorize stage completion");
const mapPath = `${f.base}/application-design/unit-of-work-story-map.md`;
const approvedMap = f.read(mapPath);
f.write(mapPath, approvedMap.replace('"status":"approved"', '"status":"draft"'));
const ambiguous = f.run("bin/cli.ts", ["orchestrate", "next"]);
assert.notEqual(ambiguous.status, 0);
assert.match(ambiguous.stdout + ambiguous.stderr, /SLICE_MAPPING/);
f.write(mapPath, approvedMap);
f.write(evidencePath, validSliceEvidence);
f.write(`${f.base}/user-stories.md`, source + "\n");
const stateBeforeBlockedNext = f.read("aidlc/active/aidlc-state.md");
const staleNext = f.run("bin/cli.ts", ["orchestrate", "next"]);
assert.equal(staleNext.status, 0, staleNext.stdout + staleNext.stderr);
const staleDirective = JSON.parse(staleNext.stdout);
assert.equal(staleDirective.execution_status, "isolated-work-exit-blocked");
assert.match(staleDirective.evidence_failures.join(" "), /scope_digest|SLICE_MANIFEST_STALE/);
assert.equal(f.read("aidlc/active/aidlc-state.md"), stateBeforeBlockedNext);
const staleReport = f.run("bin/cli.ts", ["orchestrate", "report", "--stage", "functional-design", "--module", "shop", "--unit", "api", "--result", "completed"]);
assert.notEqual(staleReport.status, 0);
f.write(`${f.base}/user-stories.md`, source);
f.state = loadWorkflowState(f.root)!;
// Restore producer stage for subsequent refresh scenarios.
f.state.current_stage = "units-generation"; f.state.current_stage_instance = "units-generation@module:shop";
delete f.state.current_unit;
f.state.completed_stages = ["module-division"]; f.state.completed_stage_instances = ["module-division"];
saveWorkflowState(f.root, f.state);
f.write(`${f.base}/requirements.md`, req.replace("完整中文正文 001", "变更正文 001"));
assert.throws(() => verifyUiGenerationLockAtBaseline(f.root, "shop", "html-mock", ["PAGE-001"]), /source hashes/, "slicing cannot bypass UI source freshness on canonical changes");
assert.throws(() => buildBusinessDocumentLoadPlan(f.ctx, "api"), /STALE/);
assert.ok(f.gate().length > 0);
const result = generateSlices(f.ctx); assert.deepEqual(result.affected_units, ["api"]);
assert.notEqual((result.unit_input_fingerprints as Record<string, string>).api, (initialGeneration.unit_input_fingerprints as Record<string, string>).api);
assert.equal((result.unit_input_fingerprints as Record<string, string>).worker, (initialGeneration.unit_input_fingerprints as Record<string, string>).worker);
assert.ok((result.affected_unit_reasons as Record<string, string[]>).api.length > 0);
assert.deepEqual(buildBusinessDocumentLoadPlan(f.ctx, "worker"), worker);
assert.ok(sliceEvidenceErrors(f.ctx, evidence).length > 0);
assert.ok(f.gate().length > 0); assert.equal(f.produce().status, 0); assert.deepEqual(f.gate(), []);
const mapBeforeChange = f.read(mapPath);
f.write(mapPath, `${mapBeforeChange}\n`);
const changedMapping = generateSlices(f.ctx);
assert.deepEqual(changedMapping.affected_units, ["api", "web", "worker"]);
assert.match((changedMapping.affected_unit_reasons as Record<string, string[]>).worker.join(" "), /approved mapping changed/);
f.write(mapPath, mapBeforeChange); generateSlices(f.ctx);
const goodManifest = f.manifest(), manifest = JSON.parse(goodManifest);
for (const mutate of [
  (m: typeof manifest) => m.coverage.requirements.pop(),
  (m: typeof manifest) => m.coverage.acs[0].owner = "US-002",
  (m: typeof manifest) => m.views[1].files[0].path = "../escape",
  (m: typeof manifest) => m.module_id = "other",
  (m: typeof manifest) => m.views[1].stories = [],
]) {
  const bad = JSON.parse(goodManifest); mutate(bad); f.write(`${f.base}/document-slices/manifest.json`, JSON.stringify(bad));
  assert.throws(() => checkSlices(f.ctx), /STALE/);
}
f.write(`${f.base}/document-slices/manifest.json`, goodManifest);
const objectPath = manifest.views[1].files[0].path, objectBody = f.read(objectPath);
f.write(objectPath, objectBody + "tampered"); assert.throws(() => checkSlices(f.ctx), /DRIFT/);
assert.throws(() => generateSlices(f.ctx), /TAMPERED/); assert.equal(f.manifest(), goodManifest);
f.write(objectPath, objectBody);
f.mapping.mappings[0].unit_ids = ["missing"];
f.sync(); assert.throws(() => generateSlices(f.ctx), /MAPPING/); assert.equal(f.manifest(), goodManifest);
f.mapping.mappings[0].unit_ids = ["api"]; f.sync();
const beforeInvalidSource = f.read(`${f.base}/user-stories.md`);
f.write(`${f.base}/user-stories.md`, beforeInvalidSource.replace("来源: REQ-001", "普通提到 REQ-001"));
assert.throws(() => generateSlices(f.ctx), /SLICE_SOURCE/);
f.write(`${f.base}/user-stories.md`, beforeInvalidSource);
f.mapping.mappings.push(f.mapping.mappings[0]); f.sync(); assert.throws(() => generateSlices(f.ctx), /MAPPING/);
f.mapping.mappings.pop(); f.sync();
const oldReqRefs = f.units[0].req_refs; f.units[0].req_refs = ["REQ-001"]; f.sync();
assert.throws(() => generateSlices(f.ctx), /RECONCILIATION/); f.units[0].req_refs = oldReqRefs; f.sync();
f.write(`${f.base}/document-slices/writer.lock`, "simulated interrupted writer");
assert.throws(() => generateSlices(f.ctx), /EEXIST/); assert.equal(f.manifest(), goodManifest);
unlinkSync(join(f.root, `${f.base}/document-slices/writer.lock`));
assert.equal(checkSlices(f.ctx).status, "passed");
// Deletion retains old consumers in impact, and removes unit from active views.
f.units = f.units.filter(u => u.unit_id !== "worker"); f.mapping.mappings.pop();
f.write(`${f.base}/requirements.md`, f.read(`${f.base}/requirements.md`).replace(/## REQ-004[^]*?(?=## REQ-NFR)/, ""));
f.write(`${f.base}/user-stories.md`, source.slice(0, source.indexOf("## STORY-004"))); f.sync();
assert.ok((generateSlices(f.ctx).affected_units as string[]).includes("worker"));
assert.throws(() => buildBusinessDocumentLoadPlan(f.ctx, "worker"), /unknown unit/);
const adopted = f.read(`${f.base}/document-slices/adoption.json`);
f.write(`${f.base}/document-slices/adoption.json`, "{}"); assert.throws(() => sliceAdoption(f.ctx), /ADOPTION/);
f.write(`${f.base}/document-slices/adoption.json`, adopted);
assert.throws(() => checkSlices({ ...f.ctx, module_id: "../other" }), /SCOPE/);
// Legacy and lightweight paths do not globally force adoption.
const legacy = new Fixture(); const legacyCtx = { ...legacy.ctx, slices_version: undefined };
assert.equal(checkSlices(legacyCtx).status, "not_applicable");
assert.equal(buildBusinessDocumentLoadPlan(legacyCtx, "api").mode, "canonical");
assert.equal(sliceAdoption({ ...legacy.ctx, scope: "bugfix" }).enabled, false);
assert.equal(sliceAdoption({ ...legacy.ctx, units_executed: false }).enabled, false);
legacy.units = legacy.units.slice(0, 1); legacy.sync(); assert.equal(sliceAdoption(legacy.ctx).basis, "single-unit");
renameSync(join(legacy.root, `${legacy.base}/requirements.md`), join(legacy.root, `${legacy.base}/requirements.full.md`));
assert.throws(() => checkSlices(legacyCtx), /CANONICAL_MISSING/);
assert.equal(recoverCanonical(legacyCtx).status, "dry-run"); assert.ok(!existsSync(join(legacy.root, `${legacy.base}/requirements.md`)));
const originalWrite = fs.writeFileSync;
try {
  fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
    if (typeof args[0] === "number" && Buffer.isBuffer(args[1])) throw new Error("injected ENOSPC while staging canonical recovery");
    return originalWrite(...args);
  }) as typeof fs.writeFileSync;
  syncBuiltinESMExports();
  assert.throws(() => recoverCanonical(legacyCtx, true), /ENOSPC/);
} finally { fs.writeFileSync = originalWrite; syncBuiltinESMExports(); }
assert.ok(!existsSync(join(legacy.root, `${legacy.base}/requirements.md`)), "failed staged write must not publish an empty/partial canonical");
const interrupted = legacy.run("tests/mars169_recovery_interrupt.ts", []);
assert.notEqual(interrupted.status, 0, "recovery child must terminate at the publication boundary");
assert.ok(!existsSync(join(legacy.root, `${legacy.base}/requirements.md`)));
const recoveryDiagnostic = recoverCanonical(legacyCtx).recovery_lock as { status: string; path: string; remediation: string };
assert.equal(recoveryDiagnostic.status, "dead"); assert.match(recoveryDiagnostic.remediation, /Stop all/);
// SIGKILL also leaves the shared workflow publication lock. The foreground
// child is confirmed dead; remove exactly its fixture lock before testing the
// separate fail-closed recovery-lock remediation path.
unlinkSync(join(legacy.root, "aidlc/active/aidlc-state.md.lock"));
assert.throws(() => recoverCanonical(legacyCtx, true), /SLICE_RECOVERY_LOCK_HELD/);
// Explicit remediation, after the foreground child is confirmed terminated.
unlinkSync(join(legacy.root, recoveryDiagnostic.path));
assert.equal(recoverCanonical(legacyCtx, true).status, "restored-revalidation-required");
legacy.write(`${legacy.base}/requirements.md`, "conflict"); assert.equal(recoverCanonical(legacyCtx).status, "conflict");
assert.throws(() => recoverCanonical(legacyCtx, true), /CONFLICT/);
const linked = new Fixture();
renameSync(join(linked.root, "docs/aidlc/modules/shop"), join(linked.root, "docs/aidlc/modules/other"));
symlinkSync(join(linked.root, "docs/aidlc/modules/other"), join(linked.root, "docs/aidlc/modules/shop"), "junction");
assert.throws(() => generateSlices(linked.ctx), /GATE_SCOPE_MISMATCH/);
if (process.argv.includes("--distribution")) {
  const installed = mkdtempSync(join(tmpdir(), "mars169-installed-"));
  writeFileSync(join(installed, "package.json"), JSON.stringify({ type: "module" }));
  // Reuse the package's installed runtime dependencies, without writing to a user profile.
  symlinkSync(join(repository, "node_modules"), join(installed, "node_modules"), "junction");
  const expected = checkSlices(f.ctx);
  for (const name of readdirSync(join(repository, "harness"))) {
    const path = join(repository, "harness", name, "manifest.ts"); if (!existsSync(path)) continue;
    const manifest = (await import(pathToFileURL(path).href)).default as HarnessManifest;
    const mapping = manifest.coreDirs.find(m => m.src === "tools")!;
    const destination = join(installed, name, "tools");
    cpSync(join(repository, "dist", name, manifest.harnessDir, mapping.dst), destination, { recursive: true });
    const result = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(destination, "aidlc-document-slices.ts"), "check", "--module", "shop"], { cwd: f.root, encoding: "utf8" });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout), expected, `${name}: installed sensor must match core`);
    console.log(`PASS installed ${name} document-slice consistency`);
  }
}
console.log("PASS MARS-169 lossless parser, deterministic slices, real producer/gate, isolation, tampering, invalidation, deletion, recovery and compatibility");
