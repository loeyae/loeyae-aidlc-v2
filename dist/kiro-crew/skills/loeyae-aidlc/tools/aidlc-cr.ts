/** Read-only CR compatibility and test impact inspection. Never claims, installs or runs tests. */
import { readFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { localObservationFile } from "./aidlc-phase-observation";

export interface CrTestImpact { dependencies: Record<string, string[]>; tests: Array<{ method: string; paths: string[]; ucd_ids?: string[] }>; }
const pathLabel = (path: unknown): path is string => typeof path === "string" && !!path && !path.includes("\\") && !/^(?:\/|[A-Za-z]:)/.test(path) && !path.split("/").some(part => !part || part === "." || part === "..");
export function selectCrTests(impact: CrTestImpact, changed: string[], requiredUcds: string[] = []) {
  if (!impact || typeof impact !== "object" || !impact.dependencies || Array.isArray(impact.dependencies) || !Array.isArray(impact.tests)) throw Error("CR_TEST_IMPACT_INVALID");
  for (const [path, deps] of Object.entries(impact.dependencies)) if (!pathLabel(path) || !Array.isArray(deps) || !deps.every(pathLabel)) throw Error("CR_TEST_IMPACT_INVALID");
  for (const test of impact.tests) if (!test || typeof test.method !== "string" || !test.method.trim() || !Array.isArray(test.paths) || !test.paths.length || !test.paths.every(pathLabel)
    || test.ucd_ids !== undefined && (!Array.isArray(test.ucd_ids) || !test.ucd_ids.every(id => typeof id === "string" && id.trim()))) throw Error("CR_TEST_IMPACT_INVALID");
  const affected = new Set(changed);
  for (let expanded = true; expanded;) {
    expanded = false;
    for (const [path, dependencies] of Object.entries(impact.dependencies)) if (!affected.has(path) && dependencies.some(dependency => affected.has(dependency))) { affected.add(path); expanded = true; }
  }
  const selected = impact.tests.filter(test => test.paths.some(path => affected.has(path)) || test.ucd_ids?.some(id => requiredUcds.includes(id)));
  const known = new Set([...Object.keys(impact.dependencies), ...Object.values(impact.dependencies).flat(), ...impact.tests.flatMap(test => test.paths)]);
  return { methods: [...new Set(selected.map(test => test.method))].sort(), affected_paths: [...affected].sort(),
    unmapped_changes: changed.filter(path => !known.has(path)).sort() };
}
export function changedCrPaths(root: string): string[] {
  const git = (args: string[]) => execFileSync("git", ["--no-optional-locks", "--literal-pathspecs", ...args], { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 });
  return [...new Set((git(["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"]) + git(["ls-files", "--others", "--exclude-standard", "-z", "--"])).split("\0").filter(Boolean))];
}
export function inspectCr(root: string, configs: string[], moduleId?: string, extension?: string) {
  const diagnostics: Array<{ code: string; path: string; message: string }> = [];
  const commands: any[] = [];
  const issue = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
  for (const label of configs) {
    try {
      const file = localObservationFile(root, label), config = JSON.parse(readFileSync(file, "utf8"));
      if (config.version !== "1" || typeof config.stage !== "string" || !Array.isArray(config.commands)) throw Error("invalid existing stage configuration");
      for (const command of config.commands) {
        if (!command || !Array.isArray(command.argv) || !command.argv.length || !command.argv.every((arg: unknown) => typeof arg === "string")) throw Error("invalid argv");
        const argv: string[] = command.argv;
        if (argv.includes("test-case-derivation") || argv.some(arg => /(?:--sensor=)test-case-derivation$/.test(arg))) {
          if (argv.some(arg => /^--(?:cr-id|cr-control-root|unit)(?:=|$)/.test(arg))) issue("CR_CANONICAL_SCOPE_INVALID", label, "canonical module I13 must not receive CR/unit arguments");
        }
        const moduleArg = argv.find(arg => arg.startsWith("--module="))?.slice(9) || (argv.includes("--module") ? argv[argv.indexOf("--module") + 1] : undefined);
        if (moduleArg && moduleId && moduleArg !== moduleId) issue("CR_MODULE_MISMATCH", label, "command targets another module");
        if (command.cwd) {
          const cwd = resolve(root, command.cwd);
          if (!existsSync(cwd) || !lstatSync(cwd).isDirectory()) issue("CR_WORKTREE_MISSING", label, "command cwd does not exist");
          else if (relative(realpathSync(root), realpathSync(cwd)).startsWith("..")) issue("CR_WORKTREE_OUTSIDE", label, "explicit external worktree mapping must be resolved before execution");
        }
        for (const arg of argv.slice(1)) if (!arg.startsWith("--") && !/\s/.test(arg) && /\.(?:[cm]?[jt]s|py|sh|ps1|json)$/.test(arg)
          && !existsSync(resolve(root, command.cwd || ".", arg))) issue("CR_COMMAND_INPUT_MISSING", label, `command input not found: ${arg}`);
        const impact = command.test_impact ? selectCrTests(command.test_impact, changedCrPaths(root)) : undefined;
        commands.push({ config: label, id: command.id, role: command.role, ...(impact ? { test_selection: impact } : {}) });
      }
    } catch (error) { issue("CR_CONFIG_INVALID", label, String(error)); }
  }
  if (extension) {
    try {
      const manifest = JSON.parse(readFileSync(localObservationFile(root, extension), "utf8"));
      const tools = dirname(fileURLToPath(import.meta.url));
      let cursor = dirname(tools);
      while (dirname(cursor) !== cursor && !existsSync(join(cursor, "package.json"))) cursor = dirname(cursor);
      const version = JSON.parse(readFileSync(join(cursor, "package.json"), "utf8")).version;
      if (manifest.base_version !== version) issue("CR_ENGINE_VERSION_MISMATCH", extension, `extension requires ${manifest.base_version}; selected engine is ${version}; do not rewrite the pinned version or apply its patch`);
      else for (const entry of [...(manifest.base_files || []).map((file: any) => ({ path: file.path, expected: file.sha256 })), ...(manifest.files || []).map((file: any) => ({ path: file.path, expected: file.before }))]) {
        const selected = localObservationFile(cursor, entry.path);
        if (entry.expected === null ? existsSync(selected) : !/^[a-f0-9]{64}$/.test(String(entry.expected)) || !existsSync(selected) || createHash("sha256").update(readFileSync(selected)).digest("hex") !== entry.expected) issue("CR_ENGINE_CONTENT_MISMATCH", entry.path, "selected base bytes differ from the pinned extension; do not apply the patch");
      }
    } catch (error) { issue("CR_EXTENSION_INVALID", extension, String(error)); }
  }
  return { kind: "cr-inspection", read_only: true, status: diagnostics.length ? "blocked" : "checked", business_tests_started: 0, commands, diagnostics,
    limitation: "Static compatibility and declared test impact only; no approval, test execution or stage completion." };
}
export function runCrCli(args: string[]) {
  if (args[0] !== "inspect") throw Error("Usage: cr inspect --config <existing-stage.json> [--config ...] [--module <id>] [--extension <manifest.json>]");
  const configs: string[] = []; let module: string | undefined, extension: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const key = args[i], value = args[++i];
    if (!["--config", "--module", "--extension"].includes(key) || !value || value.startsWith("--")) throw Error("invalid CR inspection argument");
    if (key === "--config") configs.push(value); else if (key === "--module") module = value; else extension = value;
  }
  if (!configs.length && !extension) throw Error("Select at least one existing config or extension manifest");
  const result = inspectCr(process.cwd(), configs, module, extension);
  console.log(JSON.stringify(result, null, 2)); if (result.status === "blocked") process.exitCode = 2;
}
