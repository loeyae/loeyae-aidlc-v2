import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const tests = process.argv.slice(2).length ? process.argv.slice(2) : [
  "test_mars244_boundary", "test_mars244_migration", "test_mars244_writes", "test_mars244_scope",
  "test_mars244_publication", "test_mars244_review",
  "test_mars243_sessions", "test_mars243_stop", "test_mars243_layout", "test_mars243_report",
  "test_mars160_execution_policy", "test_construction_tdd_gates", "test_i13_case_root", "test_i13_executable_behavior",
  "test_v4_5_4_engine_defects", "test_orchestrate_upgrade", "test_ui_generation_governance", "test_mars159_ui_freshness", "test_mars169_document_slices",
  "test_mars161_execution_profile_phase4", "test_mars161_execution_profile_phase5", "test_distribution_parity",
];
const out = resolve(".artifacts/mars244"); mkdirSync(out, { recursive: true });
let failures = 0;
const results = [];
for (const test of tests) {
  console.log(`RUN ${test}`);
  const start = Date.now();
  const result = spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve(`tests/${test}.ts`)], { encoding: "utf8", timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(`${out}/${test}.log`, `${result.stdout || ""}\n${result.stderr || ""}${result.error ? `\n${result.error}` : ""}`);
  const row = { test, exit_code: result.status, duration_ms: Date.now() - start };
  results.push(row);
  if (result.status !== 0) { failures++; console.log(`FAIL ${test}: ${(result.stderr || result.stdout).slice(-1800)}`); }
  else console.log(`PASS ${test}`);
}
const previous = process.argv.slice(2).length && existsSync(`${out}/results.json`) ? JSON.parse(readFileSync(`${out}/results.json`, "utf8")) as typeof results : [];
const merged = [...previous.filter(row => !results.some(next => next.test === row.test)), ...results];
writeFileSync(`${out}/results.json`, JSON.stringify(merged, null, 2) + "\n");
console.log(`${tests.length - failures}/${tests.length} passed. Logs: .artifacts/mars244`);
process.exitCode = failures ? 1 : 0;
