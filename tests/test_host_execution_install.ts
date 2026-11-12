import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repo = process.cwd();
const home = fs.mkdtempSync(path.join(os.tmpdir(), "aidlc-native-install-"));
const env = { ...process.env, HOME: home, USERPROFILE: home,
  AIDLC_INSTALL_STATE_DIR: path.join(home, "ownership"), AIDLC_SESSION_BINDING: "" };
function cli(...args: string[]) {
  const run = spawnSync(process.execPath, [path.join(repo, "bin/cli.js"), ...args], {
    cwd: repo, env, encoding: "utf8", timeout: 60000, windowsHide: true,
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
}
function save(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
try {
  const hooksPath = path.join(home, ".codex/hooks.json");
  cli("install", "--harness", "codex");
  assert(!fs.existsSync(hooksPath), "fresh install must not create lifecycle configuration");
  const user = { type: "command", command: "echo keep-user" };
  const owned = { type: "command", command: "loeyae-aidlc hook --format codex" };
  const custom = { id: "user", hooks: [user] };
  save(hooksPath, { setting: "preserve", hooks: { Stop: [custom,
    { id: "loeyae-aidlc-stop-gate", hooks: [owned] },
    { id: "mixed", hooks: [owned, user] }], Other: [custom] } });
  for (let i = 0; i < 2; i++) cli("install", "--harness", "codex");
  assert.deepEqual(JSON.parse(fs.readFileSync(hooksPath, "utf8")), {
    setting: "preserve", hooks: { Stop: [custom, { id: "mixed", hooks: [user] }], Other: [custom] },
  });
  const installed = path.join(home, ".agents/skills/loeyae-aidlc");
  assert(fs.readFileSync(path.join(installed, "SKILL.md"), "utf8").includes("host-execution.md"));
  const work = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(repo, "node_modules/tsx/dist/loader.mjs")).href,
    path.join(installed, "tools/aidlc-host-work.ts"), "--help"], { cwd: repo, env, encoding: "utf8", timeout: 20000 });
  assert.equal(work.status, 0, work.stderr);
  assert(work.stdout.includes("--details"));
  cli("uninstall", "--harness", "codex");
  assert(!fs.existsSync(installed));
  assert.equal(JSON.parse(fs.readFileSync(hooksPath, "utf8")).hooks.Stop.length, 2);

  const zcodePath = path.join(home, ".zcode/cli/config.json");
  const zOwned = { type: "process", command: "loeyae-aidlc", args: ["hook", "--format", "zcode"] };
  const zConfig = { setting: "keep", mcp: { servers: { existing: { url: "https://example.invalid" } } },
    hooks: { enabled: false, events: { Stop: [{ hooks: [user] }, { hooks: [user, zOwned] }] } } };
  save(zcodePath, zConfig);
  cli("install", "--harness", "zcode");
  zConfig.hooks.events.Stop[1].hooks = [user];
  assert.deepEqual(JSON.parse(fs.readFileSync(zcodePath, "utf8")), zConfig);

  const project = path.join(home, "project");
  const foreignHook = path.join(project, ".kiro/hooks/loeyae-aidlc.json");
  save(foreignHook, { owner: "user" });
  cli("install", "--harness", "kiro-ide", "--project", project);
  assert.equal(fs.readFileSync(foreignHook, "utf8"), '{"owner":"user"}');
  console.log("PASS: native fresh install, owned/mixed Hook cleanup, idempotent upgrade, user config preservation, installed work and uninstall");
} finally {
  // Exact mkdtemp target under OS temporary directory, never a user installation.
  fs.rmSync(home, { recursive: true, force: true });
}
