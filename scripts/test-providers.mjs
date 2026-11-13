/** Explicit production document Provider checks; local security fixtures run in npm test. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { testPython } from "./run-python.mjs";
import { integrationOwners, loadIntegrationProviders } from "./provider-integration-plan.mjs";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const flags = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  assert(["--providers", "--output"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("--") && !(args[i] in flags), `invalid option ${args[i]}`);
  flags[args[i]] = args[i + 1];
}
assert(flags["--providers"], "Usage: npm run test:providers -- --providers <pinned-registry.json> [--output <temporary directory>]");
const providers = loadIntegrationProviders(flags["--providers"]);
assert(providers["document-render"], "document-render Provider missing; production rendering is NOT verified");
const output = resolve(flags["--output"] || mkdtempSync(join(tmpdir(), "aidlc-document-integration-")));
mkdirSync(output, { recursive: true });
const results = [], python = testPython();
for (const [name, owner] of Object.entries(integrationOwners)) {
  const entry = providers[owner];
  const parameters = [entry.source, entry.revision, ...(name === "test_docx_provider" ? [join(output, "document-export.docx")] : [])];
  const command = ["--import", "tsx", `tests/${name}.ts`, ...parameters];
  const start = Date.now();
  const result = spawnSync(process.execPath, command, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 600000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, AIDLC_TEST_PYTHON: python, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", AIDLC_TEST_ARTIFACT_DIR: output,
      AIDLC_EXPORT_PROJECT: "", AIDLC_EXPORT_HOST_PROVIDER: "", AIDLC_DOCX_PROJECT: "", AIDLC_DOCX_HOST_PROVIDER: "" } });
  const log = `${result.stdout || ""}\n${result.stderr || ""}\n${result.error?.message || ""}`;
  writeFileSync(join(output, `${name}.log`), log);
  results.push({ name, command: [process.execPath, ...command], exit_code: result.status, elapsed_ms: Date.now() - start, log: `${name}.log` });
  writeFileSync(join(output, "results.json"), JSON.stringify({ providers, results }, null, 2));
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${name}`);
  if (result.status !== 0) { console.error(log.slice(-4000)); process.exitCode = 1; break; }
}
console.log(`${results.filter(r => r.exit_code === 0).length}/${Object.keys(integrationOwners).length} production checks passed; logs: ${output}`);
