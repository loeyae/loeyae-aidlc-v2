import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fixture, repository, write } from "./mars244_fixture";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";

// Freeze the tool sources so a concurrent source edit cannot invalidate a checker
// while this test is exercising the command-line process boundary.
const tool = mkdtempSync(join(tmpdir(), "aidlc-process-cost-tool-"));
for (const name of ["core", "bin", "package.json", "tsconfig.json"])
  cpSync(join(repository, name), join(tool, name), { recursive: true });
symlinkSync(join(repository, "node_modules"), join(tool, "node_modules"), "junction");
const traces = mkdtempSync(join(tmpdir(), "aidlc-process-cost-traces-"));
const preload = join(traces, "trace.cjs");
writeFileSync(preload, `const fs = require('node:fs'); const path = require('node:path');
if (require('node:worker_threads').isMainThread) fs.writeFileSync(path.join(process.env.AIDLC_PROCESS_COST_TRACE, process.pid + '.json'), JSON.stringify(process.argv));\n`);
const f = fixture("build-and-test-templates");
delete f.state.current_module;
delete f.state.current_unit;
f.persist();
for (const name of ["build-instructions.md", "unit-test-instructions.md"])
  write(f.root, `docs/aidlc/construction/build-and-test/${name}`,
    "# Instructions\nREQ-001: Run the actual project command and inspect its result before delivery.\n");
const binding = JSON.stringify(bindSession(f.root, {
  instance: "build-and-test-templates", owner: "auditor", session: "process-cost", expected: claimToken(undefined),
}).binding);
const args = ["run", "--stage", "build-and-test-templates", "--instance", "build-and-test-templates", "--sensor", "template-completeness"];
const observations: Array<{ name: string; processes: number; duration_ms: number; status: number | null }> = [];
function run(name: string, entry: "cli" | "direct" | "installed", options: string[], session = binding) {
  const output = join(traces, name);
  mkdirSync(output);
  const entryArgs = entry === "installed"
    ? [join(tool, "bin/cli.js"), "evidence", ...options]
    : [join(tool, "node_modules/tsx/dist/cli.mjs"), join(tool, entry === "cli" ? "bin/cli.ts" : "core/tools/aidlc-evidence.ts"),
      ...(entry === "cli" ? ["evidence"] : []), ...options];
  const started = Date.now();
  const result = spawnSync(process.execPath, entryArgs, {
    cwd: f.root, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, AIDLC_SESSION_BINDING: session, AIDLC_PROCESS_COST_TRACE: output,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require ${JSON.stringify(preload.replace(/\\/g, "/"))}`.trim() },
  });
  const processes = readdirSync(output).map(name => JSON.parse(readFileSync(join(output, name), "utf8")) as string[]);
  observations.push({ name, processes: processes.length, duration_ms: Date.now() - started, status: result.status });
  assert.equal(result.error, undefined);
  return { ...result, processes };
}
const initial = run("initial", "cli", args);
assert.equal(initial.status, 0, initial.stdout + initial.stderr);
assert.equal(initial.processes.length, 4, "CLI and checker each need one tsx launcher; no producer subprocess");
assert(!initial.processes.some(argv => argv.some(arg => arg.endsWith("aidlc-evidence.ts"))), "producer runs inside the CLI process");
assert.equal(JSON.parse(initial.stdout).action, "regenerated", "exactly one producer JSON object is emitted");
const evidence = join(f.root, ".aidlc/evidence/build-and-test-templates/template-completeness.json");
const before = readFileSync(evidence);
const completed = loadWorkflowState(f.root)!;
completed.completed_stage_instances.push("build-and-test-templates");
completed.completed_stages.push("build-and-test-templates");
delete completed.current_stage_instance;
completed.current_stage = "";
f.persist(completed);
for (const [name, entry, expected] of [["refresh", "cli", 2], ["direct", "direct", 2], ["installed", "installed", 3]] as const) {
  const result = run(name, entry, [...args, "--refresh"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).action, "reused");
  assert.equal(result.processes.length, expected, `${name} creates no redundant producer process`);
  assert.deepEqual(readFileSync(evidence), before, "unchanged evidence is not rewritten");
}
for (const entry of ["cli", "direct", "installed"] as const) {
  const invalid = run(`${entry}-invalid`, entry, ["run", "--unknown"]);
  assert.equal(invalid.status, 2, invalid.stdout + invalid.stderr);
  assert.match(invalid.stderr, /Evidence producer blocked: unknown argument: --unknown/);
  const unbound = run(`${entry}-unbound`, entry, [...args, "--refresh"], "malformed-session-binding");
  assert.equal(unbound.status, 2, unbound.stdout + unbound.stderr);
  assert.match(unbound.stderr, /Evidence producer blocked:/);
  const help = run(`${entry}-help`, entry, ["run", "--help"]);
  assert.equal(help.status, 0, help.stdout + help.stderr);
  assert.match(help.stdout, /^Usage: aidlc-evidence.ts run/);
}

// Imported producers can be invoked twice in one process. Each invocation must
// establish a fresh identity even when the checker path and package version stay
// unchanged; read-only identity checks within the same batch still share a scan.
const batchRunner = join(tool, "batch-regression.mts");
writeFileSync(batchRunner, `import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { runEvidenceCli } from './core/tools/aidlc-evidence.ts';
import { semanticCheckerDigest, withSemanticCheckerIdentityMemoization } from './core/tools/aidlc-checker-identity.ts';
const checker = ${JSON.stringify(join(tool, "core/tools/aidlc-semantic-checks.ts"))};
const originalRead = fs.readFileSync;
let reads = 0;
fs.readFileSync = function(...args) { reads++; return originalRead.apply(this, args); };
syncBuiltinESMExports();
withSemanticCheckerIdentityMemoization(() => {
  const digest = semanticCheckerDigest(); const first = reads;
  assert(first > 0);
  assert.equal(semanticCheckerDigest(), digest); assert.equal(reads, first);
  assert.equal(semanticCheckerDigest(true), digest); assert(reads > first);
});
fs.readFileSync = originalRead; syncBuiltinESMExports();
const output = []; const log = console.log;
console.log = value => output.push(JSON.parse(value));
const args = ${JSON.stringify([...args, "--refresh"])};
runEvidenceCli(args);
fs.appendFileSync(checker, '\\n// Same-path, same-version change between producer invocations.\\n');
runEvidenceCli(args);
console.log = log;
assert.equal(process.exitCode || 0, 0);
assert.deepEqual(output.map(value => value.action), ['reused', 'regenerated']);
console.log('PASS identity memo is reused inside a batch and discarded between producer invocations');
`);
const batch = spawnSync(process.execPath, [join(tool, "node_modules/tsx/dist/cli.mjs"), batchRunner], {
  cwd: f.root, encoding: "utf8", timeout: 120_000, env: { ...process.env, AIDLC_SESSION_BINDING: binding },
});
assert.equal(batch.status, 0, batch.stdout + batch.stderr);

// Keep the post-execution byte check: a checker that changes its own source while
// running must never publish evidence, regardless of its successful JSON report.
const checker = join(tool, "core/tools/aidlc-semantic-checks.ts");
writeFileSync(checker, `import { appendFileSync as mutateOwnSource } from 'node:fs';
import { fileURLToPath as ownPath } from 'node:url';
mutateOwnSource(ownPath(import.meta.url), '\\n// Checker changed during execution.\\n');\n` + readFileSync(checker, "utf8").replace(/^#![^\n]*\n/, ""));
const lastEvidence = readFileSync(evidence);
const changing = run("checker-changing", "cli", [...args, "--refresh"]);
assert.equal(changing.status, 2, changing.stdout + changing.stderr);
assert.match(changing.stderr, /semantic checker implementation changed during execution/);
assert.deepEqual(readFileSync(evidence), lastEvidence, "a checker changed during execution cannot replace evidence");
console.log(JSON.stringify(observations));
console.log("PASS AU4232-04: fewer processes, stable CLI/direct/installed behavior, binding, arguments, and evidence reuse");
