import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fixture, write, git, repository } from "./mars244_fixture";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { selectCrTests, inspectCr } from "../core/tools/aidlc-cr";
import { parsePhaseReuse, loadPhaseObservation } from "../core/tools/aidlc-phase-observation";

const impact = { dependencies: { "src/form.ts": ["src/validator.ts"], "src/unrelated.ts": [] }, tests: [
  { method: "tests/lock.test.ts#lockOrder", paths: ["src/form.ts"] },
  { method: "tests/unrelated.test.ts#other", paths: ["src/unrelated.ts"], ucd_ids: ["UC-D-002"] },
] };
assert.deepEqual(selectCrTests(impact, ["src/validator.ts"]).methods, ["tests/lock.test.ts#lockOrder"]);
assert.equal(selectCrTests(impact, ["unknown.ts"]).unmapped_changes.length, 1);
assert.equal(selectCrTests(impact, ["src/validator.ts"], ["UC-D-002"]).methods.length, 2);
assert.throws(() => parsePhaseReuse({ version: "1", cr_id: "CR-1", units: ["api"], max_age_ms: 1, isolation: "database" }));

const legacyCr = process.env.AIDLC_CR_TEST_LEGACY_CONTEXT === "1";
const f = fixture("code-generation@module:shop@unit:api", legacyCr);
const tsx = join(repository, "node_modules/tsx/dist/cli.mjs");
const cli = join(process.env.AIDLC_CR_TEST_ENGINE_ROOT || repository, "bin/cli.ts");
write(f.root, ".gitignore", ".aidlc/\naidlc/\n");
write(f.root, "tests/regression.cjs", "// Direct lock-order regression without a UC-D tag\n");
write(f.root, "scripts/shared.cjs", `const fs=require('node:fs');
fs.appendFileSync('.aidlc/command-count','run\\n');
if(process.env.AIDLC_ACTIVE_UNIT)throw Error('unit context leaked');
console.log(JSON.stringify({phase:'GREEN',status:'passed',compile_status:'passed',environment_status:'passed',tests_total:3,tests_failed:0,traceability_complete:true,
uc_mapping:[{use_case:'UC-D-001',test_methods:['tests/regression.cjs']},{use_case:'UC-D-002',test_methods:['tests/regression.cjs']}],regression_test_methods:JSON.parse(process.env.AIDLC_REGRESSION_TESTS||'[]')}));
`);
const i13 = { status: "required", ucd_ids: ["UC-D-001", "UC-D-002"], ucd_modes: { "UC-D-001": "new", "UC-D-002": "new" }, ucd_units: { "UC-D-001": ["api"], "UC-D-002": ["web"] } };
write(f.root, ".aidlc/evidence/test-case-derivation/shop/test-case-derivation.json", i13);
const configPath = legacyCr ? ".aidlc/commands/change-requests/CR-SHOP-1/code-generation.json" : ".aidlc/commands/code-generation.json";
if (legacyCr) {
  write(f.root, "docs/aidlc/change-requests/CR-SHOP-1.md", "# CR-SHOP-1\nApproved fixture behavior\n");
  write(f.root, ".aidlc/commands/change-requests/CR-SHOP-1/scope.json", { cr_id: "CR-SHOP-1", module_id: "shop", unit_ids: ["api", "web"], units: ["api", "web"].map(unit_id => ({ unit_id, control_root: ".aidlc" })), baselines: {} });
  write(f.root, ".aidlc/source-roots.json", { version: "1", source_roots: ["src"] });
}
const config = { version: "1", stage: "code-generation", commands: [{ id: "shared", role: "green", argv: ["node", "scripts/shared.cjs"],
  evidence_inputs: { environment: [], files: ["scripts/shared.cjs", "tests/regression.cjs"] }, regression_tests: ["tests/regression.cjs#lockOrder"],
  observation_reuse: { version: "1", cr_id: "CR-SHOP-1", units: ["api", "web"], max_age_ms: 600000, isolation: "read-only" } }] };
write(f.root, configPath, config);
git(f.root, "add", "."); git(f.root, "commit", "-qm", "shared runner and regression");
const bindings = Object.fromEntries(["api", "web"].map(unit => [unit, JSON.stringify(bindSession(f.root, { instance: `code-generation@module:shop@unit:${unit}`, owner: "fixture", session: `reuse-${unit}`, expected: claimToken(undefined) }).binding)]));
function run(unit: string, ok = true, extra: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [tsx, cli, "evidence", "run", "--stage", "code-generation", "--module", "shop", "--unit", unit, "--sensor", "green-test-evidence", ...(legacyCr ? ["--cr-id", "CR-SHOP-1", "--cr-control-root", ".aidlc"] : [])],
    { cwd: f.root, encoding: "utf8", env: { ...process.env, ...extra, AIDLC_SESSION_BINDING: bindings[unit] }, timeout: 60000 });
  assert.equal(result.status === 0, ok, result.stdout + result.stderr);
  return result;
}
const evidencePath = (unit: string) => legacyCr ? `.aidlc/evidence/change-requests/CR-SHOP-1/code-generation/shop/${unit}/green-test-evidence.json` : `.aidlc/evidence/code-generation/shop/${unit}/green-test-evidence.json`;
const evidence = (unit: string) => JSON.parse(readFileSync(join(f.root, evidencePath(unit)), "utf8"));
const count = () => readFileSync(join(f.root, ".aidlc/command-count"), "utf8").trim().split("\n").length;
function gate(unit: string) {
  const result = spawnSync(process.execPath, [tsx, join(repository, "tests/phase_observation_probe.ts"), evidencePath(unit), ...(legacyCr ? [configPath] : [])],
    { cwd: f.root, encoding: "utf8", env: { ...process.env, AIDLC_SESSION_BINDING: bindings[unit] }, timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout) as string[];
}
run("api"); run("web");
assert.deepEqual(gate("api"), []); assert.deepEqual(gate("web"), [], "current validator accepts the original execution, not a copied sibling receipt");
assert.equal(count(), 1, "shared command runs once, despite different sessions/units");
assert.deepEqual(evidence("api").uc_mapping.map((row: any) => row.use_case), ["UC-D-001"]);
assert.deepEqual(evidence("web").uc_mapping.map((row: any) => row.use_case), ["UC-D-002"]);
assert.equal(evidence("web").execution_observation.reused, true);
assert.equal(evidence("api").execution_observation.executed_at, evidence("web").execution_observation.executed_at);
assert.notEqual(evidence("api").producer.execution_id, evidence("web").producer.execution_id, "stage evidence remains per-unit");
// The raw execution survives a new qualification pass without inventing another test run.
run("api"); assert.equal(count(), 1);
const first = evidence("api");
const rawPath = join(f.root, first.execution_observation.path);
const originalRaw = readFileSync(rawPath);
const originalRecord = JSON.parse(originalRaw.toString());
const webRecordPath = join(f.root, evidencePath("web"));
const webRecord = readFileSync(webRecordPath);
writeFileSync(webRecordPath, JSON.stringify({ ...evidence("web"), tests_total: 999 }));
assert(gate("web").some(error => error.includes("PAYLOAD_MISMATCH")), "forged derived result rejected");
writeFileSync(webRecordPath, webRecord);
assert.equal(loadPhaseObservation(f.root, originalRecord.binding)?.ref.observation_id, originalRecord.observation_id);
assert.equal(loadPhaseObservation(f.root, originalRecord.binding, Date.parse(originalRecord.executed_at) + 600001), undefined);
writeFileSync(rawPath, "corrupt"); run("web", false); assert.equal(count(), 1, "corruption diagnoses without silently rerunning");
assert(gate("api").some(error => error.includes("CORRUPT")));
writeFileSync(rawPath, originalRaw);
writeFileSync(rawPath, JSON.stringify({ ...originalRecord, stdout: originalRecord.stdout.replace('"tests_total":3', '"tests_total":999') }));
run("api", false); assert.equal(count(), 1, "syntactically valid edited raw output must fail its signature, never be laundered through the producer");
writeFileSync(rawPath, originalRaw);
write(f.root, "src/shop/api/code.ts", "real implementation change\n"); run("web"); assert.equal(count(), 2);
run("web", true, { CR_TEST_ENVIRONMENT_CHANGE: "new" }); assert.equal(count(), 3, "actual child environment changes invalidate reuse");
const oldRef = evidence("api").execution_observation;
assert(readFileSync(join(f.root, oldRef.path)).length > 0, "old immutable execution remains after later qualifications");
config.commands[0].id = "shared-concurrent";
write(f.root, configPath, config);
const concurrent = (unit: string) => new Promise<void>((resolve, reject) => {
  const child = spawn(process.execPath, [tsx, cli, "evidence", "run", "--stage", "code-generation", "--module", "shop", "--unit", unit, "--sensor", "green-test-evidence", ...(legacyCr ? ["--cr-id", "CR-SHOP-1", "--cr-control-root", ".aidlc"] : [])],
    { cwd: f.root, env: { ...process.env, AIDLC_SESSION_BINDING: bindings[unit] }, windowsHide: true });
  let output = ""; child.stdout.on("data", bytes => output += bytes); child.stderr.on("data", bytes => output += bytes);
  child.on("error", reject); child.on("close", code => code === 0 ? resolve() : reject(Error(output)));
});
await Promise.all([concurrent("api"), concurrent("web")]);
assert.equal(count(), 4, "concurrent units serialize the same execution and consume one observation");
assert.deepEqual(gate("api"), []); assert.deepEqual(gate("web"), []);
write(f.root, "bad-i13.json", { version: "1", stage: "test-case-derivation", commands: [{ id: "bad", argv: ["node", "checker.ts", "--sensor", "test-case-derivation", "--cr-id", "CR-1"] }] });
write(f.root, "old-extension.json", { base_version: "4.25.1" });
const inspection = inspectCr(f.root, ["bad-i13.json"], "shop", "old-extension.json");
assert(inspection.diagnostics.some(item => item.code === "CR_CANONICAL_SCOPE_INVALID"));
assert(inspection.diagnostics.some(item => item.code === "CR_ENGINE_VERSION_MISMATCH"));
assert.equal(inspection.business_tests_started, 0);
write(f.root, "changed-extension.json", { base_version: JSON.parse(readFileSync(join(repository, "package.json"), "utf8")).version,
  files: [{ path: "core/tools/aidlc-cr.ts", before: "0".repeat(64) }] });
const changedEngine = inspectCr(f.root, [], "shop", "changed-extension.json");
assert(changedEngine.diagnostics.some(item => item.code === "CR_ENGINE_CONTENT_MISMATCH"));
assert.equal(changedEngine.business_tests_started, 0);
console.log(JSON.stringify({ passed: true, fixture: f.root, shared_initial_executions: 1, unit_receipts: 2,
  actual_command_executions: count(), observations: readdirSync(join(f.root, ".aidlc/phase-observations/records")).length,
  covered: ["untagged related test", "shared command", "per-unit coverage", "input/environment invalidation", "corruption", "expiry", "CR/I13 arguments", "pinned version"] }));
