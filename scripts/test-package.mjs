/** Real tarball acceptance. No registry publication, source imports or dependency copying.
 * npm run test:package -- [--output DIR] [--previous-ref COMMIT]
 *   [--provider-source URL --provider-revision SHA --trusted-documents]
 * External Providers and trusted document execution are deliberately opt-in.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  assert(["--output", "--previous-ref", "--previous-legacy-peer-deps", "--provider-source", "--provider-revision", "--trusted-documents"].includes(key), `unknown option ${key}`);
  assert(!(key in options), `duplicate ${key}`);
  options[key] = ["--trusted-documents", "--previous-legacy-peer-deps"].includes(key) ? true : process.argv[++i];
  assert(options[key] && !String(options[key]).startsWith("--"), `missing ${key}`);
}
assert.equal(!!options["--provider-source"], !!options["--provider-revision"], "Provider source and revision must be supplied together");
if (options["--provider-revision"]) assert(/^[a-f0-9]{40}$/.test(options["--provider-revision"]));
assert(!options["--trusted-documents"] || options["--provider-source"], "trusted documents require an explicit locked Provider");
assert(!options["--previous-legacy-peer-deps"] || options["--previous-ref"], "previous peer workaround requires --previous-ref");
const output = resolve(options["--output"] || mkdtempSync(join(tmpdir(), "aidlc-package-evidence-")));
mkdirSync(output, { recursive: true });
const sandbox = mkdtempSync(join(tmpdir(), "aidlc package 中文 "));
// This must not be nested below the checkout, where Node could find source dependencies.
assert(!realpathSync(sandbox).startsWith(realpathSync(repo)), "temporary package root must be outside the source checkout");
const home = join(sandbox, "home"), workspace = join(sandbox, "project 中文 with spaces"), fakebin = join(sandbox, "host-stubs");
for (const dir of [home, workspace, fakebin, join(home, "tmp")]) mkdirSync(dir, { recursive: true });
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData/Roaming"), LOCALAPPDATA: join(home, "AppData/Local"),
  TMP: join(home, "tmp"), TEMP: join(home, "tmp"), TMPDIR: join(home, "tmp"), NODE_PATH: "", NODE_OPTIONS: "",
  AIDLC_INSTALL_STATE_DIR: join(home, "installations"), AIDLC_PROGRAM_FILES_ROOTS: "", AIDLC_APPLICATIONS_ROOT: join(home, "Applications"),
  AIDLC_EXPORT_PROJECT: "", AIDLC_EXPORT_HOST_PROVIDER: "", AIDLC_DOCX_PROJECT: "", AIDLC_DOCX_HOST_PROVIDER: "",
  AIDLC_PROVIDER_ALLOW_FILE: "", AIDLC_PACKAGE_SSH_HOME: homedir(), GIT_CONFIG_GLOBAL: join(home, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
const npm = process.env.npm_execpath;
assert(npm && existsSync(npm), "run through npm run test:package so npm_execpath identifies the actual npm CLI");
const report = { node: process.version, platform: `${process.platform}-${process.arch}`, sandbox, dependency_mode: "npm install --omit=dev --ignore-scripts (local pack tarball and global remote tarball URL); normal configured cache/registry; lifecycle scripts disabled via explicit flag at every invocation, platform optionalDependencies preserved; no source node_modules copied", commands: [], checks: [], skipped: [], options };
function save() { writeFileSync(join(output, "results.json"), JSON.stringify(report, null, 2)); }
function run(name, command, args, settings = {}) {
  console.log(`RUN ${name}`);
  const { expected = 0, ...extra } = settings;
  const result = spawnSync(command, args, { cwd: workspace, env, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024, ...extra });
  const log = `${result.stdout || ""}\n${result.stderr || ""}\n${result.error?.message || ""}`;
  const logFile = `${String(report.commands.length).padStart(3, "0")}-${name}.log`;
  writeFileSync(join(output, logFile), log);
  report.commands.push({ name, command: [command, ...args], exit_code: result.status, signal: result.signal, log: logFile }); save();
  assert.equal(result.status, expected, `${name}: ${log.slice(-5000)}`);
  return expected === 0 ? result.stdout : `${result.stdout}${result.stderr}`;
}
const npmRun = (name, args, cwd = workspace) => run(name, process.execPath, [npm, ...args], { cwd });
function pack(cwd, label) {
  const info = JSON.parse(npmRun(`pack-${label}`, ["pack", "--json", "--pack-destination", output], cwd))[0];
  const tarball = join(output, `${label}-${info.filename}`);
  // Keep both versions even if their package versions happen to match.
  const original = join(output, info.filename);
  writeFileSync(tarball, readFileSync(original));
  const forbidden = info.files.filter(({ path }) => !path.startsWith("node_modules/") && /(^|\/)(tests|attachments|\.artifacts|\.aidlc|\.multica|\.worktrees|\.git)(\/|$)|(^|\/)\.env($|\.)|AGENTS\.md$|\.tgz$/.test(path));
  assert.deepEqual(forbidden, [], "tarball contains local state or developer files");
  assert.deepEqual(info.files.filter(({ path }) => /(^|\/)(\.npmrc|\.gitconfig|id_rsa|id_ed25519|credentials|known_hosts)$|(^|\/)\.env($|\.)/.test(path)), [], "tarball contains credential/configuration files");
  const paths = new Set(info.files.map(f => f.path));
  if (label === "candidate") assert(info.bundled.includes("html-validate"), "bundle the validator runtime to avoid npm optional test-peer resolution crashes");
  for (const p of ["bin/cli.js", "bin/cli.ts", "core/tools/data/stage-graph.json", "core/tools/data/provider-schema-ownership.json", "scripts/build.ts"])
    assert(paths.has(p), `missing packaged runtime ${p}`);
  const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  report[label] = { version: info.version, filename: tarball, sha256: digest, files: info.entryCount, integrity: info.integrity, bundled: info.bundled };
  writeFileSync(join(output, `${label}-files.json`), JSON.stringify(info.files, null, 2)); save();
  return tarball;
}
function install(tarball, label) {
  const prefix = join(sandbox, label);
  mkdirSync(prefix);
  writeFileSync(join(prefix, "package.json"), JSON.stringify({ private: true, name: `package-smoke-${label}`, version: "1.0.0" }));
  npmRun(`npm-install-${label}`, ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", ...(label === "previous" && options["--previous-legacy-peer-deps"] ? ["--legacy-peer-deps"] : []), tarball], prefix);
  const root = join(prefix, "node_modules/loeyae-aidlc");
  assert(!existsSync(join(root, "tests")));
  assert(!existsSync(join(prefix, "node_modules/typescript")), "production install unexpectedly needs dev dependencies");
  assert(existsSync(join(prefix, "node_modules/.bin", process.platform === "win32" ? "loeyae-aidlc.cmd" : "loeyae-aidlc")));
  return root;
}
const cli = (root, name, args, extra = {}) => run(name, process.execPath, [join(root, "bin/cli.js"), ...args], extra);
const json = p => JSON.parse(readFileSync(p, "utf8"));
function check(name, fn) { fn(); report.checks.push(name); save(); console.log(`PASS ${name}`); }
// Real remote-tarball acceptance: the supported global install fetches a real archive over HTTP
// (served locally for repeatability) instead of copying anything from the source checkout.
async function startArchiveServer(dir) {
  const script = join(sandbox, "serve-archive.mjs");
  writeFileSync(script, `import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
const root = resolve(process.argv[2]);
const server = createServer((request, response) => {
  const file = join(root, basename(decodeURIComponent(new URL(request.url, "http://localhost").pathname)));
  if (!existsSync(file) || !statSync(file).isFile()) { response.writeHead(404); response.end("not found"); return; }
  response.writeHead(200, { "content-type": extname(file) === ".tgz" ? "application/gzip" : "application/octet-stream", "content-length": statSync(file).size });
  createReadStream(file).pipe(response);
});
server.listen(0, "127.0.0.1", () => console.log(\`listening \${server.address().port}\`));
`);
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [script, dir], { stdio: ["ignore", "pipe", "pipe"] });
  return await new Promise((startOk, startFail) => {
    let announced = "";
    child.stdout.on("data", chunk => { announced += chunk; const found = announced.match(/listening (\d+)/); if (found) startOk({ child, url: `http://127.0.0.1:${found[1]}` }); });
    child.stderr.on("data", chunk => process.stderr.write(chunk));
    child.on("error", startFail);
    setTimeout(() => startFail(new Error("local archive HTTP server did not announce readiness")), 60000);
  });
}
try {
  report.core_revision = run("core-revision", "git", ["rev-parse", "HEAD"], { cwd: repo }).trim();
  report.npm_version = npmRun("npm-version", ["--version"]).trim();
  const candidateTarball = pack(repo, "candidate");
  const candidate = install(candidateTarball, "candidate");
  const installedRequire = createRequire(join(candidate, "package.json"));
  run("installed-layout", process.execPath, [installedRequire.resolve("tsx/cli"), join(repo, "tests/package-layout-smoke.mjs"), candidate]);
  report.checks.push("installed tarball: all nine distributions and runtime dependencies/schemas");
  // A real host is never invoked. Claude's required registration is represented by an observable stub.
  const hostLog = join(sandbox, "stub-host.jsonl");
  const stub = join(fakebin, "claude");
  writeFileSync(stub, `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(hostLog)}, JSON.stringify(process.argv.slice(2))+'\\n');\n`);
  if (process.platform === "win32") writeFileSync(`${stub}.cmd`, `@"${process.execPath}" "%~dp0claude" %*\r\n`);
  else { const { chmodSync } = await import("node:fs"); chmodSync(stub, 0o755); }
  env.PATH = `${fakebin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`;
  check("installed CLI help/version and graph data", () => {
    assert.match(cli(candidate, "help", ["--help"]), /Usage:/);
    assert.match(cli(candidate, "version", ["--version"]), new RegExp(report.candidate.version.replaceAll(".", "\\.")));
    cli(candidate, "graph-compile", ["graph", "compile"]);
    cli(candidate, "graph-validate", ["graph", "validate"]);
    cli(candidate, "provider-help", ["provider", "help"]);
    assert.match(cli(candidate, "runtime-summary", ["runtime", "summary"], { expected: 2 }), /no active AWS-style lightweight workflow/);
  });
  // Behavioral regression for the macOS tarball install fix: the supported install command must
  // disable lifecycle scripts (fsevents@2.3.3 metadata declares a node-gyp build the tarball
  // cannot satisfy) while platform optionalDependencies stay installable. A script canary proves
  // both halves: with the flag the script must not run, without it the same environment does run it.
  check("supported install disables lifecycle scripts and keeps installing (script canary)", () => {
    const canaryDir = join(sandbox, "lifecycle-canary"); mkdirSync(canaryDir);
    writeFileSync(join(canaryDir, "package.json"), JSON.stringify({ name: "aidlc-lifecycle-canary", version: "1.0.0", scripts: { install: "node -e \"require('fs').writeFileSync('lifecycle-ran.flag','ran')\"" } }));
    const canaryTarball = join(output, JSON.parse(npmRun("pack-canary", ["pack", "--json", "--pack-destination", output], canaryDir))[0].filename);
    const canaryInstall = (label, extraArgs, expectRan) => {
      const prefix = join(sandbox, `canary-${label}`); mkdirSync(prefix);
      writeFileSync(join(prefix, "package.json"), JSON.stringify({ private: true, name: `canary-${label}`, version: "1.0.0" }));
      npmRun(`npm-install-canary-${label}`, ["install", "--no-audit", "--no-fund", ...extraArgs, canaryTarball], prefix);
      const ran = existsSync(join(prefix, "node_modules", "aidlc-lifecycle-canary", "lifecycle-ran.flag"));
      assert.equal(ran, expectRan, `lifecycle script ${expectRan ? "did not run" : "ran"} under ${label}`);
      assert(existsSync(join(prefix, "node_modules", "aidlc-lifecycle-canary")), `canary package missing under ${label}`);
    };
    canaryInstall("ignore-scripts", ["--ignore-scripts"], false);
    canaryInstall("control", [], true);
  });
  const archiveServer = await startArchiveServer(output);
  try {
    const globalPrefix = join(sandbox, "global-prefix");
    npmRun("npm-install-global-remote", ["install", "-g", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", globalPrefix, `${archiveServer.url}/${encodeURIComponent(basename(candidateTarball))}`]);
    const globalRoot = join(globalPrefix, "node_modules", "loeyae-aidlc");
    const globalRequire = createRequire(join(globalRoot, "package.json"));
    check("global remote tarball: real version, bin shim and CLI startup (TS executed via installed tsx)", () => {
      assert.equal(json(join(globalRoot, "package.json")).version, report.candidate.version);
      const globalShim = process.platform === "win32" ? join(globalPrefix, "loeyae-aidlc.cmd") : join(globalPrefix, "bin", "loeyae-aidlc");
      assert(existsSync(globalShim), `missing global bin shim ${globalShim}`);
      assert.match(cli(globalRoot, "global-help", ["--help"]), /Usage:/);
      assert.match(cli(globalRoot, "global-version", ["--version"]), new RegExp(report.candidate.version.replaceAll(".", "\\.")));
    });
    // The platform package ships its executable at the package root (esbuild.exe on Windows,
    // bin/esbuild elsewhere); resolving the package keeps this independent of hoisting.
    const esbuildPlatform = dirname(globalRequire.resolve(`@esbuild/${process.platform}-${process.arch}/package.json`));
    const esbuildBinary = join(esbuildPlatform, ...process.platform === "win32" ? ["esbuild.exe"] : ["bin", "esbuild"]);
    check("global remote tarball: platform esbuild binary present and performing a real TS transform", () => {
      assert(existsSync(esbuildBinary), `missing platform esbuild binary ${esbuildBinary}`);
      const transformed = run("esbuild-transform", esbuildBinary, ["--loader=ts", "--format=cjs"], { input: "const answer: number = 42;\nconsole.log(answer);\n" });
      assert.match(transformed, /console\.log\(answer\)/, "platform esbuild binary did not transform TypeScript");
    });
    if (process.platform === "darwin") check("darwin fsevents prebuilt loads without lifecycle scripts", () => {
      const fsevents = globalRequire("fsevents");
      assert(["object", "function"].includes(typeof fsevents), `unexpected fsevents export ${typeof fsevents}`);
    });
    else report.skipped.push("darwin fsevents prebuilt load: platform-specific; re-run this acceptance on a real macOS host to cover it");
  } finally { archiveServer.child.kill(); }
  const host = join(workspace, "host.json");
  const original = { userSetting: "keep-user-field", mcpServers: { unknownLegacy: { command: "user-pinned", disabled: true } } };
  writeFileSync(host, JSON.stringify(original));
  check("provider-free safe MCP paths", () => {
    const args = ["--project", workspace, "--host-config", host];
    const plan = JSON.parse(cli(candidate, "empty-plan", ["provider", "mcp-plan", ...args]));
    assert.equal(plan.changes.length, 0);
    const saved = join(workspace, "empty-plan.json"); writeFileSync(saved, JSON.stringify(plan));
    assert.equal(JSON.parse(cli(candidate, "empty-recover", ["provider", "mcp-recover", ...args, "--plan", saved])).status, "unchanged");
    assert.equal(JSON.parse(cli(candidate, "empty-status", ["provider", "mcp-status", ...args])).status, "no-transaction");
    assert.deepEqual(json(host), original);
  });
  check("provider-free local workflow", () => {
    const local = join(sandbox, "local-workflow"); mkdirSync(local);
    const directive = JSON.parse(cli(candidate, "local-workflow-next", ["orchestrate", "next", "--scope", "express", "--work", "Package smoke workflow"], { cwd: local }));
    assert.notEqual(directive.kind, "error");
    cli(candidate, "local-workflow-runtime", ["runtime", "summary"], { cwd: local });
    assert(!existsSync(join(local, ".aidlc/providers.yaml")), "generic workflow implicitly installed domain Providers");
  });
  const harnesses = ["kiro-crew", "kiro-ide", "kiro-cli", "claude", "opencode", "codex", "codebuddy", "qoder", "zcode"];
  for (const harness of harnesses) check(`isolated ${harness} install/ownership/uninstall`, () => {
    const target = join(sandbox, `target ${harness} 中文`); mkdirSync(target);
    const args = ["--harness", harness, "--target", target];
    cli(candidate, `install-${harness}`, ["install", ...args]);
    assert(readdirSync(env.AIDLC_INSTALL_STATE_DIR).some(p => p.endsWith(".json")), "missing ownership manifest");
    assert(readdirSync(target).length, "empty harness install");
    assert.deepEqual(json(host), original, "Core install changed domain MCP configuration");
    cli(candidate, `uninstall-${harness}`, ["uninstall", ...args]);
    assert.equal(readdirSync(env.AIDLC_INSTALL_STATE_DIR).filter(p => p.endsWith(".json")).length, 0);
  });
  if (options["--provider-source"]) {
    run("installed-provider-suite", process.execPath, [installedRequire.resolve("tsx/cli"), join(repo, "tests/package-provider-smoke.mjs"), candidate, workspace,
      options["--provider-source"], options["--provider-revision"], ...(options["--trusted-documents"] ? ["--trusted-documents"] : [])], { timeout: 1200000, env: { ...env, AIDLC_PACKAGE_PROVIDER_LOG: join(output, "provider-commands.json") } });
    report.checks.push("installed locked production Provider suite");
    for (const name of ["provider-commands.json", "document.docx", "document.pdf", "diagram.png", "styled.docx"])
      if (existsSync(join(workspace, name))) cpSync(join(workspace, name), join(output, name));
  } else report.skipped.push("external Provider suite: supply --provider-source and --provider-revision");
  if (options["--previous-ref"]) {
    const ref = options["--previous-ref"];
    const archive = join(sandbox, "previous.tar"), source = join(sandbox, "previous-source"); mkdirSync(source);
    report.previous_revision = run("previous-revision", "git", ["rev-parse", `${ref}^{commit}`], { cwd: repo }).trim();
    run("previous-archive", "git", ["archive", "--format=tar", "--output", archive, report.previous_revision], { cwd: repo });
    run("previous-extract", "tar", ["-xf", archive, "-C", source]);
    const previousTarball = pack(source, "previous");
    const previous = install(previousTarball, "previous");
    const previousPrefix = resolve(previous, "../..");
    if (options["--provider-source"] && options["--trusted-documents"]) {
      run("installed-rollback-journal", process.execPath, [installedRequire.resolve("tsx/cli"), join(repo, "tests/package-rollback-smoke.mjs"), candidate, previous, workspace]);
      report.checks.push("actual old CLI preserves new pending journal; compatible installed candidate recovers before downgrade");
    }
    const target = join(sandbox, "upgrade target 中文"), args = ["--harness", "codex", "--target", target];
    check("actual previous tarball upgrade/rollback and user edit protection", () => {
      cli(previous, "previous-help", ["--help"]);
      cli(previous, "previous-install", ["install", ...args]);
      const note = join(target, "user-note.txt"); writeFileSync(note, "preserve my edit");
      assert.match(cli(candidate, "upgrade-refuses-edit", ["install", ...args], { expected: 1 }), /modified; refusing/);
    });
    // The expected failure above must leave the user's file and ownership untouched.
    // Continue after restoring only this test's own deliberately added file.
    const { unlinkSync } = await import("node:fs");
    assert.equal(readFileSync(join(target, "user-note.txt"), "utf8"), "preserve my edit"); unlinkSync(join(target, "user-note.txt"));
    npmRun("npm-upgrade", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", candidateTarball], previousPrefix);
    assert.match(cli(previous, "upgraded-version", ["--version"]), new RegExp(report.candidate.version.replaceAll(".", "\\.")));
    cli(previous, "upgrade", ["install", ...args]);
    npmRun("npm-rollback", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", ...(options["--previous-legacy-peer-deps"] ? ["--legacy-peer-deps"] : []), previousTarball], previousPrefix);
    cli(previous, "rollback", ["install", ...args]);
    assert.match(cli(previous, "rollback-version", ["--version"]), new RegExp(report.previous.version.replaceAll(".", "\\.")));
    cli(previous, "rollback-graph", ["graph", "validate"]);
    cli(previous, "rollback-uninstall", ["uninstall", ...args]);
    assert(!existsSync(target));
    npmRun("npm-uninstall", ["uninstall", "--no-audit", "--no-fund", "loeyae-aidlc"], previousPrefix);
    assert(!existsSync(previous));
    // A 4.17 CLI has no transaction recovery interface. Never hand it a new pending journal.
    report.checks.push("rollback after completed transactions only; old CLI is not claimed to read new journals");
  } else report.skipped.push("upgrade/rollback: supply --previous-ref with an accessible actual Git commit");
  report.skipped.push("real host application activation; Linux/macOS and Linux sandbox; production SSOT/design/Figma OAuth/write/readback; DOCX final rendered page layout");
  report.status = "passed";
} catch (error) { report.status = "failed"; report.error = String(error.stack || error); process.exitCode = 1; console.error(report.error); }
finally {
  // Retain partial document evidence as well as failures; a failed provider
  // subprocess must never erase what was actually generated before the error.
  for (const name of ["document.docx", "document.pdf", "diagram.png", "styled.docx"])
    if (existsSync(join(workspace, name))) cpSync(join(workspace, name), join(output, name));
  save(); console.log(`Package acceptance ${report.status}; evidence: ${output}`);
}
