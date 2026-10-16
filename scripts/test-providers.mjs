import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { testPython } from "./run-python.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [mode, ...args] = process.argv.slice(2);
assert(["local", "integration"].includes(mode), "mode must be local or integration");
const flags = {};
for (let i = 0; i < args.length; i += 2) {
  assert(["--source", "--revision", "--checkout", "--output"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("--"), `invalid option ${args[i]}`);
  assert(!(args[i] in flags), `duplicate option ${args[i]}`);
  flags[args[i]] = args[i + 1];
}
const python = testPython();
const output = flags["--output"] ? resolve(flags["--output"]) : mkdtempSync(join(tmpdir(), `aidlc-provider-${mode}-`));
mkdirSync(output, { recursive: true });
const revision = flags["--revision"], source = flags["--source"], checkout = flags["--checkout"] && resolve(flags["--checkout"]);
if (mode === "integration") {
  assert(source && /^[a-f0-9]{40}$/.test(revision ?? "") && checkout, "integration requires --source <Git URL> --revision <40-char SHA> --checkout <matching actual Provider checkout>");
  const git = (...argv) => {
    const result = spawnSync("git", ["-C", checkout, ...argv], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.equal(git("rev-parse", "HEAD"), revision, "Provider checkout must match locked revision");
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), "", "Provider tracked sources must be clean");
}
const local = [
  "test_provider_mcp_apply", "test_mcp_readonly", "test_context_source_boundary", "test_module_facts",
  "test_docx_provider_fixture", "test_diagram_layout_contract", "test_diagram_layout_analysis",
  "test_provider_config.py", "test_mcp_config.py", "test_platform_layouts.py",
];
const integration = [
  ["test_external_provider_knowledge", source, revision], ["test_module_knowledge", source, revision],
  ["test_context_source", source, revision], ["test_design_resource", source, revision],
  ["test_figma_existing", source, revision], ["test_figma_create", source, revision],
  // The checkout is the same immutable production package; local Git also enables raw-candidate adversarial checks.
  ["test_diagram_visual_provider", checkout, revision, python], ["test_diagram_visual_chain", source, revision, python],
  ["test_document_export_provider", source, revision], ["test_docx_provider", source, revision, join(output, "document-export.docx")],
  ["test_tech_extraction", checkout],
];
const suites = mode === "local" ? local.map(name => [name]) : integration;
const results = [];
for (const [name, ...parameters] of suites) {
  const executable = name.endsWith(".py") ? python : process.execPath;
  const argv = name.endsWith(".py") ? [join(root, `tests/${name}`)] : [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, `tests/${name}.ts`), ...parameters];
  console.log(`RUN ${name}`);
  const started = Date.now();
  const result = spawnSync(executable, argv, { cwd: root, encoding: "utf8", timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, AIDLC_TEST_PYTHON: python, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", AIDLC_TEST_ARTIFACT_DIR: output, VISUAL_SCENARIOS: "" } });
  const log = `${result.stdout || ""}\n${result.stderr || ""}\n${result.error?.message || ""}`;
  writeFileSync(join(output, `${name}.log`), log);
  results.push({ name, command: [executable, ...argv], exit_code: result.status, signal: result.signal, duration_ms: Date.now() - started,
    scope: mode === "local" ? "deterministic local fixture" : name.includes("figma") || ["test_context_source", "test_design_resource"].includes(name) ? "locked production package with local protocol service fixture; no production account" : "locked production package", log: `${name}.log` });
  writeFileSync(join(output, "results.json"), JSON.stringify({ mode, source, revision, checkout, python, results }, null, 2));
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${name} (exit ${result.status})`);
  if (result.status !== 0) console.log(log.slice(-2500));
}
console.log(`${results.filter(result => result.exit_code === 0).length}/${results.length} suites passed; logs: ${output}`);
if (results.some(result => result.exit_code !== 0)) process.exitCode = 1;
