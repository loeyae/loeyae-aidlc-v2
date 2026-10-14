import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createInitialState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { qualityChangeCheck, qualityEvidenceErrors, qualityHash, type QualityContext } from "../core/tools/aidlc-quality-gates";

const repo = resolve(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "mars168-phase1-"));
const base = "docs/aidlc/modules/shop/inception";
function write(path: string, value: string) { mkdirSync(resolve(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), value); }
const state = createInitialState("feature", undefined, undefined, [], "MARS-168 quality gate fixture");
state.current_module = "shop"; state.current_stage = "requirements-analysis"; state.current_stage_instance = "requirements-analysis@module:shop"; state.quality_gates_version = "1";
state.completed_stages = ["module-division"];
state.completed_stage_instances = ["module-division"];
saveWorkflowState(root, state);
write("docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [{ module_id: "shop", name: "Shop", service_id: "shop", paths: ["src"], depends_on: [] }] }));
write(`${base}/source.md`, "REQ-001 product source");
write(`${base}/requirements.md`, '# REQ-001 quality inventory\n```aidlc-quality\n' + JSON.stringify({ version: "1", delivery_scope: "release-a", inputs: [`${base}/source.md`], artifacts: [{ id: "source", path: `${base}/source.md`, sha256: qualityHash("REQ-001 product source"), ids: ["REQ-001"], depends_on: [] }], changes: [] }) + '\n```\n');
const ctx: QualityContext = { root, workflow_id: state.workflow_id, module_id: "shop", scope: "feature", stage: "requirements-analysis", ui_route: "not-selected", quality_version: "1" };
for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]]) {
  const git = spawnSync("git", args, { cwd: root, encoding: "utf8" }); assert.equal(git.status, 0, git.stderr);
}
const good = qualityChangeCheck(ctx);
assert.deepEqual(qualityEvidenceErrors(ctx, "quality-change-impact", good), []);
assert.ok(qualityEvidenceErrors({ ...ctx, module_id: "other" }, "quality-change-impact", good).some(e => e.includes("GATE_SCOPE_MISMATCH")));
assert.ok(qualityEvidenceErrors(ctx, "quality-change-impact", { ...good, applicable: false }).some(e => e.includes("GATE_INVALID_EXEMPTION")));
write(`${base}/source.md`, "REQ-001 changed source");
assert.ok(qualityEvidenceErrors(ctx, "quality-change-impact", good).some(e => e.includes("GATE_EVIDENCE_STALE")));
assert.throws(() => qualityChangeCheck(ctx), /CHANGE_EVIDENCE_STALE/);
write(`${base}/source.md`, "REQ-001 product source");
const tsx = join(repo, "node_modules/tsx/dist/cli.mjs");
function run(script: string, args: string[]) { const r = spawnSync(process.execPath, [tsx, join(repo, script), ...args], { cwd: root, encoding: "utf8" }); if (!r.stdout) throw new Error(r.stderr || String(r.error)); return r; }
let gate = run("tests/gate_probe.ts", ["requirements-analysis@module:shop", "sensors", "quality-change-impact"]);
assert.match(gate.stdout, /GATE_EVIDENCE_MISSING/);
const producer = run("core/tools/aidlc-evidence.ts", ["run", "--stage", "requirements-analysis", "--module", "shop", "--sensor", "quality-change-impact"]);
assert.equal(producer.status, 0, producer.stdout + producer.stderr);
gate = run("tests/gate_probe.ts", ["requirements-analysis@module:shop", "sensors", "quality-change-impact"]);
assert.deepEqual(JSON.parse(gate.stdout).failures, [], gate.stdout + gate.stderr);
const path = ".aidlc/evidence/requirements-analysis/shop/quality-change-impact.json";
const evidence = JSON.parse(readFileSync(join(root, path), "utf8"));
write(path, JSON.stringify({ ...evidence, module_id: "other" }));
gate = run("tests/gate_probe.ts", ["requirements-analysis@module:shop", "sensors", "quality-change-impact"]);
assert.match(gate.stdout, /GATE_SCOPE_MISMATCH/);
write(path, JSON.stringify(evidence));
write(`${base}/source.md`, "REQ-001 changed source");
gate = run("tests/gate_probe.ts", ["requirements-analysis@module:shop", "sensors", "quality-change-impact"]);
assert.match(gate.stdout, /GATE_EVIDENCE_STALE/);
console.log("PASS MARS-168 phase 1: binding, producer, real gates, stale/cross-module/exemption");
