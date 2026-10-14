import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const repo = resolve(import.meta.dirname, "..");
const root = process.env.AIDLC_MARS168_BASELINE_ROOT ? resolve(process.env.AIDLC_MARS168_BASELINE_ROOT) : repo;
const groups: Record<string, string[]> = {
  quality: ["test_mars168_phase1", "test_mars168_phase2", "test_mars168_phase3_ui", "test_mars168_phase3_delivery", "test_mars168_phase4", "test_mars168_phase5", "test_mars168_admission", "test_mars168_lifecycle", "test_mars168_report"],
  regression: ["test_aws_light_workflow", "test_v4_phase1_phase2", "test_mars90_stage_aligned_gates", "test_mars108_traceability_sensor", "test_mars112_lightweight_traceability", "test_ui_generation_governance", "test_mars159_ui_freshness", "test_mars159_module_ledger", "test_v4_3_module_workflows", "test_v4_8_1_checker_scope", "test_v4_9_0_nested_repo", "test_v4_10_0_adoption_baseline", "test_v4_10_1_adoption_exemption", "test_orchestrate_archive", "test_mars161_execution_profile_phase2", "test_mars161_execution_profile_phase3", "test_mars161_execution_profile_phase4", "test_mars161_execution_profile_phase5", "test_mars161_execution_profile_phase6"],
  distribution: ["test_distribution_parity"],
};
const group = process.argv[2] || "quality"; if (!groups[group]) throw new Error("group must be quality/regression/distribution");
const requested = process.argv.slice(3); const suites = requested.length ? groups[group].filter(name => requested.includes(name)) : groups[group];
if (requested.length !== 0 && suites.length !== new Set(requested).size) throw new Error("requested suite must belong to its registered group");
const baseline = root !== repo;
const output = join(repo, "docs/optimization-notes/mars168-command-logs", ...(baseline ? ["baseline-39a0399"] : [])); mkdirSync(output, { recursive: true });
const results = [];
for (const name of suites) {
  const args = [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, `tests/${name}.ts`)];
  console.log(`RUN ${name}`); const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 20 * 60 * 1000 });
  const log = `${result.stdout || ""}\n${result.stderr || ""}${result.error ? `\n${result.error.message}` : ""}`;
  writeFileSync(join(output, `${name}.log`), log);
  results.push({ command: `npx --no-install tsx tests/${name}.ts`, exit_code: result.status, duration_ms: Date.now() - started, log: `mars168-command-logs/${name}.log` });
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${name}`);
}
const resultPath = join(output, `${group}-results.json`);
const previous = existsSync(resultPath) && requested.length ? JSON.parse(readFileSync(resultPath, "utf8")).results as typeof results : [];
const merged = [...previous.filter(p => !results.some(r => r.command === p.command)), ...results];
writeFileSync(resultPath, JSON.stringify({ group, baseline, timestamp: new Date().toISOString(), results: merged }, null, 2) + "\n");
console.log(`${results.filter(r => r.exit_code === 0).length}/${results.length} ${group} suites pass`);
if (results.some(r => r.exit_code !== 0)) process.exitCode = 1;
