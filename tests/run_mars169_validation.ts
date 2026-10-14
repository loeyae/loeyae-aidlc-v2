import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const repo = resolve(import.meta.dirname, "..");
const groups: Record<string, string[]> = {
  slices: ["test_mars169_document_slices"],
  quality: ["test_mars168_phase1", "test_mars168_phase2", "test_mars168_phase3_ui", "test_mars168_phase3_delivery", "test_mars168_phase4", "test_mars168_phase5", "test_mars168_admission", "test_mars168_lifecycle", "test_mars168_report"],
  regression: ["test_aws_light_workflow", "test_v4_phase1_phase2", "test_mars90_stage_aligned_gates", "test_mars108_traceability_sensor", "test_mars112_lightweight_traceability", "test_ui_generation_governance", "test_mars159_ui_freshness", "test_mars159_module_ledger", "test_v4_3_module_workflows", "test_v4_8_1_checker_scope", "test_v4_9_0_nested_repo", "test_v4_10_0_adoption_baseline", "test_v4_10_1_adoption_exemption", "test_split_next_routing", "test_mars161_execution_profile_phase2", "test_mars161_execution_profile_phase3", "test_mars161_execution_profile_phase4", "test_mars161_execution_profile_phase5", "test_mars161_execution_profile_phase6"],
  distribution: ["test_distribution_parity", "test_mars169_document_slices"],
  full: ["npm-test"],
  "baseline-extra": ["test_v4_6_0_tdd_mode"],
};
const group = process.argv[2] || "slices", baselineArg = process.argv[3];
const baseline = baselineArg && resolve(baselineArg) !== repo ? baselineArg : undefined;
if (!groups[group]) throw new Error("group must be slices/quality/regression/distribution/full");
const root = baseline ? resolve(baseline) : repo;
const requested = process.argv.slice(4);
const suites = requested.length ? groups[group].filter(name => requested.includes(name)) : groups[group];
if (requested.length && suites.length !== new Set(requested).size) throw new Error("requested tests must belong to their group");
const output = join(repo, "docs/optimization-notes/mars169-command-logs", ...(baseline ? ["baseline-fee14ad"] : []));
mkdirSync(output, { recursive: true });
const results = [];
for (const name of suites) {
  const testArgs = group === "distribution" && name === "test_mars169_document_slices" ? ["--distribution"] : [];
  const command = name === "npm-test" ? "npm test" : `npx --no-install tsx tests/${name}.ts${testArgs.length ? ` ${testArgs.join(" ")}` : ""}`;
  console.log(`RUN ${command}${baseline ? " (fee14ad baseline)" : ""}`);
  const started = Date.now();
  const result = name === "npm-test"
    ? spawnSync(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/s", "/c", "npm test"] : ["test"], { cwd: root, encoding: "utf8", timeout: 40 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 })
    : spawnSync(process.execPath, [join(repo, "node_modules/tsx/dist/cli.mjs"), join(root, `tests/${name}.ts`), ...testArgs], { cwd: root, encoding: "utf8", timeout: 20 * 60 * 1000 });
  writeFileSync(join(output, `${name}.log`), `${result.stdout || ""}\n${result.stderr || ""}${result.error ? `\n${result.error.message}` : ""}`);
  results.push({ command, exit_code: result.status, duration_ms: Date.now() - started });
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${name}`);
}
const resultPath = join(output, `${group}${requested.length ? "-selected" : ""}-results.json`);
const previous = requested.length && existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")).results as typeof results : [];
const merged = [...previous.filter(r => !results.some(next => next.command === r.command)), ...results];
writeFileSync(resultPath, JSON.stringify({ baseline: baseline ? "fee14ad" : null, results: merged }, null, 2) + "\n");
if (results.some(r => r.exit_code !== 0)) process.exitCode = 1;
