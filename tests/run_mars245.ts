import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".artifacts/mars245");
mkdirSync(output, { recursive: true });
// One foreground issue task owns this worktree's regression and dist generation.
// An existing lock is a reason to investigate ownership, never to steal it.
const lockPath = resolve(output, "run.lock");
const lock = openSync(lockPath, "wx");
writeFileSync(lock, JSON.stringify({ issue: "MARS-245", pid: process.pid, started_at: new Date().toISOString() }));
const selected = process.argv.slice(2);
const tests = selected.length ? selected : [
  "test_mars245_split", "test_mars161_execution_profile_phase6",
  "test_mars243_sessions", "test_mars243_stop", "test_mars243_layout", "test_mars243_report",
  "test_mars244_migration", "test_mars244_writes", "test_mars244_publication",
  "test_orchestrate_upgrade", "test_ui_generation_governance", "test_mars159_ui_freshness",
  "test_mars169_document_slices", "test_mars161_execution_profile_phase4", "test_mars161_execution_profile_phase5",
];
const commands: [string, string[]][] = selected.length ? [] : [["typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]]];
for (const test of tests) commands.push([test, test === "typecheck" ? ["node_modules/typescript/bin/tsc", "--noEmit"] : test === "build-all" ? ["node_modules/tsx/dist/cli.mjs", "scripts/build.ts", "--all"] : ["node_modules/tsx/dist/cli.mjs", `tests/${test}.ts`]]);
if (!selected.length) commands.push(["build-all", ["node_modules/tsx/dist/cli.mjs", "scripts/build.ts", "--all"]], ["test_distribution_parity", ["node_modules/tsx/dist/cli.mjs", "tests/test_distribution_parity.ts"]]);
const results = [];
const resultsPath = resolve(output, "results.json");
const previous = selected.length && existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) as { name: string }[] : [];
try {
  for (const [name, args] of commands) {
    console.log(`RUN ${name}`);
    const started = Date.now();
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, AIDLC_SESSION_BINDING: "", AIDLC_MODULE: "" } });
    writeFileSync(resolve(output, `${name}.log`), `${result.stdout || ""}\n${result.stderr || ""}${result.error ? `\n${result.error}` : ""}`);
    results.push({ name, command: ["node", ...args], exit_code: result.status, signal: result.signal, duration_ms: Date.now() - started });
    writeFileSync(resultsPath, JSON.stringify([...previous.filter(row => !results.some(next => next.name === row.name)), ...results], null, 2) + "\n");
    console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${name} (exit ${result.status})`);
    if (result.status !== 0) console.log((result.stderr || result.stdout || String(result.error)).slice(-2500));
  }
} finally { closeSync(lock); unlinkSync(lockPath); }
console.log(`${results.filter(row => row.exit_code === 0).length}/${results.length} commands passed`);
process.exitCode = results.some(row => row.exit_code !== 0) ? 1 : 0;
