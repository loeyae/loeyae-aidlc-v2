import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.env.AIDLC_TEST_OUTPUT ? resolve(process.env.AIDLC_TEST_OUTPUT) : mkdtempSync(join(tmpdir(), "aidlc-core-tests-"));
mkdirSync(output, { recursive: true });
const commands = JSON.parse(readFileSync(new URL("core-test-suites.json", import.meta.url), "utf8"));
const results = [];
for (const [tool, ...parameters] of commands) {
  const args = tool === "tsx" ? [join(root, "node_modules/tsx/dist/cli.mjs"), ...parameters]
    : tool === "tsc" ? [join(root, "node_modules/typescript/bin/tsc"), ...parameters] : parameters;
  const name = parameters.find(arg => arg.endsWith(".ts") || arg.endsWith(".py") || arg.endsWith(".mjs"))?.split("/").at(-1) || tool;
  if (parameters[0] === "scripts/test-providers.mjs") args.push("--output", join(output, "provider-local"));
  console.log(`RUN ${tool} ${parameters.join(" ")}`);
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, AIDLC_TEST_OUTPUT: output } });
  const log = `${result.stdout || ""}\n${result.stderr || ""}\n${result.error?.message || ""}`;
  const path = `${results.length.toString().padStart(2, "0")}-${name}.log`;
  writeFileSync(join(output, path), log);
  results.push({ command: [process.execPath, ...args], exit_code: result.status, signal: result.signal, duration_ms: Date.now() - started, log: path });
  writeFileSync(join(output, "results.json"), JSON.stringify({ results }, null, 2));
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${name} (exit ${result.status})`);
  // Preserve the original output (including explicitly reported skips/diagnostics).
  process.stdout.write(log);
}
console.log(`${results.filter(result => result.exit_code === 0).length}/${results.length} commands passed; logs: ${output}`);
if (results.some(result => result.exit_code !== 0)) process.exitCode = 1;
