/** A real old CLI must not be treated as a reader of a new pending journal. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [candidate, previous, project] = process.argv.slice(2);
const run = (root, args, expected = 0) => {
  const r = spawnSync(process.execPath, [join(root, "bin/cli.js"), ...args], { cwd: project, env: process.env, encoding: "utf8", timeout: 120000 });
  console.log(JSON.stringify({ command: [process.execPath, join(root, "bin/cli.js"), ...args], exit_code: r.status }));
  assert.equal(r.status, expected, `${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return expected ? `${r.stdout}${r.stderr}` : r.stdout;
};
for (const instance of ["documents", "styles"]) run(candidate, ["provider", "disable", instance, "--project", project]);
run(candidate, ["provider", "enable", "context", "--project", project]);
const host = join(project, "rollback-host.json"), planFile = join(project, "rollback-plan.json");
writeFileSync(host, JSON.stringify({ mcpServers: {}, userSetting: "preserve" }));
const args = ["--project", project, "--host-config", host];
const plan = JSON.parse(run(candidate, ["provider", "mcp-plan", ...args]));
writeFileSync(planFile, JSON.stringify(plan));
const { applyProviderMcp } = await import(pathToFileURL(join(candidate, "core/tools/aidlc-provider-mcp-apply.ts")).href);
assert.throws(() => applyProviderMcp(project, { hostConfig: host, plan, approvedConfigs: plan.changes.map(c => c.config_digest) }, point => {
  if (point === "after-config") throw new Error("deliberately interrupted installed transaction");
}), /deliberately interrupted/);
const paths = [host, `${host}.aidlc-mcp-ledger.json`, `${host}.aidlc-mcp-journal.json`];
const snapshot = () => paths.map(p => readFileSync(p).toString("base64"));
const before = snapshot();
assert.equal(JSON.parse(run(candidate, ["provider", "mcp-status", ...args])).status, "recoverable");
assert(!JSON.parse(run(previous, ["provider", "help"])).usage.includes("mcp-recover"));
assert.match(run(previous, ["provider", "mcp-recover", ...args, "--plan", planFile], 2), /unknown provider (command|option)/);
assert.deepEqual(snapshot(), before, "old CLI changed unsupported pending state");
assert.equal(JSON.parse(run(candidate, ["provider", "mcp-recover", ...args, "--plan", planFile])).status, "recovered");
assert(!existsSync(paths[2]), "compatible recovery must finish before downgrade");
assert.equal(JSON.parse(run(candidate, ["provider", "mcp-status", ...args])).status, "completed");
console.log("PASS old 4.17 CLI rejects new recovery command and preserves pending v2 bytes; installed candidate explicitly recovers before npm rollback");
