/** Invoked by test-package with the INSTALLED tsx loader. All runtime imports
 * resolve explicitly beneath the installed package; never import checkout code.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const [installed, project, source, revision, trusted] = process.argv.slice(2);
assert(installed && project && source && /^[a-f0-9]{40}$/.test(revision));
const req = createRequire(join(installed, "package.json"));
const JSZip = req("jszip");
const runtime = p => import(pathToFileURL(join(installed, "core/tools", p)).href);
// Read existing SSH trust/identity material for the explicitly authorized Git fetch;
// do not copy it into the isolated profile or change the real user's configuration.
const { providerSshCommand } = await runtime("aidlc-provider-git.ts");
if (!process.env.GIT_SSH_COMMAND) process.env.GIT_SSH_COMMAND = providerSshCommand(process.platform, process.env.AIDLC_PACKAGE_SSH_HOME) || "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes";
const commands = [];
function run(args, expected = 0) {
  const r = spawnSync(process.execPath, [join(installed, "bin/cli.js"), ...args], { cwd: project, env: process.env, encoding: "utf8", timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
  commands.push({ args, exit_code: r.status });
  writeFileSync(process.env.AIDLC_PACKAGE_PROVIDER_LOG || join(project, "..", "provider-commands.json"), JSON.stringify(commands, null, 2));
  assert.equal(r.status, expected, `${args.join(" ")}\n${r.stdout}\n${r.stderr}\n${r.error || ""}`);
  return expected ? `${r.stdout}${r.stderr}` : r.stdout;
}
function write(path, value) { mkdirSync(resolve(path, ".."), { recursive: true }); writeFileSync(path, JSON.stringify(value)); }
const json = path => JSON.parse(readFileSync(path, "utf8"));
const git = (...args) => {
  const r = spawnSync("git", args, { cwd: project, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
};
git("init", "-b", "main"); git("config", "user.name", "Package smoke"); git("config", "user.email", "smoke@example.test");
writeFileSync(join(project, "README.md"), "Isolated package smoke\n"); git("add", "README.md"); git("commit", "-m", "isolated baseline");
write(join(project, ".aidlc/provider-git-policy.json"), { version: 1, allowed_hosts: [new URL(source).hostname], allowed_commits: [revision], allow_file_fixtures: false });
const add = (subdir, instance, extra = []) => JSON.parse(run(["provider", "add", source, "--ref", revision, "--subdir", `providers/${subdir}`, "--instance", instance, "--trust", "allowlisted-commit", "--project", project, ...extra]));

add("loeyae-boot-knowledge", "framework-knowledge", ["--stage", "code-generation", "--capability", "framework.conventions"]);
const { defaultResolutionPolicy, resolveProjectProviderPlan, PROVIDER_PROFILE_REGISTRY_PATH } = await runtime("aidlc-provider-resolver.ts");
const { readCurrentProviderSourceRevision } = await runtime("aidlc-provider-runner.ts");
write(join(project, PROVIDER_PROFILE_REGISTRY_PATH), { version: 1, active: "framework", profiles: { framework: { facts: { languages: ["java"], frameworks: ["loeyae-boot"] }, risk: { level: "standard", protected_gate: false } } } });
const resolution = resolveProjectProviderPlan(project, { scope: { stage: "code-generation", module_id: "app", unit_id: "unit" }, source_revision: readCurrentProviderSourceRevision(project), policy: defaultResolutionPolicy(), freeze: true });
assert.equal(resolution.plan.nodes.length, 1);
const knowledgeArgs = ["--project", project, "--plan", resolution.plan.plan_id, "--node", resolution.plan.nodes[0].node_id];
const delivery = JSON.parse(run(["provider", "knowledge-load", ...knowledgeArgs]));
assert.equal(delivery.provider_instance.commit_oid, revision);
assert(delivery.sections.some(s => s.id === "loeyae-test"));
assert.match(run(["provider", "knowledge-verify", ...knowledgeArgs], 2), /confirmation is missing/);
const confirmation = JSON.parse(run(["provider", "knowledge-confirm", ...knowledgeArgs, "--delivery-digest", delivery.delivery_digest, "--consumer", "installed-package-smoke"]));
assert.deepEqual(JSON.parse(run(["provider", "knowledge-verify", ...knowledgeArgs])), confirmation);
assert.equal(confirmation.receipt.gate_eligible, false);
// Corruption must be detected by the installed Core, independently of the Provider.
const { verifyProviderKnowledge } = await runtime("aidlc-provider-knowledge.ts");
assert.equal(verifyProviderKnowledge(project, { plan: resolution.plan, nodeId: resolution.plan.nodes[0].node_id }).receipt.receipt_digest, confirmation.receipt.receipt_digest);
console.log(`PASS locked offline knowledge and signed receipt: ${revision}; ${delivery.sections.length} chapters`);

add("ssot-readonly", "context");
const host = join(project, "managed-host.json"), original = { userSetting: "preserve", mcpServers: { unknownLegacy: { command: "pinned-user-entry", disabled: true } } };
write(host, original);
const mcpArgs = ["--project", project, "--host-config", host];
const planFile = join(project, "saved-mcp-plan.json");
assert.match(run(["provider", "mcp-plan", ...mcpArgs], 2), /enabled Provider has no MCP declaration/);
assert.deepEqual(json(host), original, "capability gap must not mutate the host");
run(["provider", "disable", "framework-knowledge", "--project", project]);
const plan = JSON.parse(run(["provider", "mcp-plan", ...mcpArgs])); write(planFile, plan);
assert.equal(plan.changes.filter(c => c.action === "add").length, 1);
assert.match(run(["provider", "mcp-apply", ...mcpArgs, "--plan", planFile], 2), /approve-config/);
const approved = plan.changes.flatMap(c => ["--approve-config", c.config_digest]);
assert.equal(JSON.parse(run(["provider", "mcp-apply", ...mcpArgs, "--plan", planFile, ...approved])).status, "applied");
assert.deepEqual(json(host).mcpServers.unknownLegacy, original.mcpServers.unknownLegacy);
assert.equal(json(host).userSetting, "preserve");
assert.equal(JSON.parse(run(["provider", "mcp-status", ...mcpArgs])).status, "completed");
assert.equal(JSON.parse(run(["provider", "mcp-recover", ...mcpArgs, "--plan", planFile])).status, "unchanged");
// Two actual project consumers share the same isolated host entry. Cleaning up
// one project must not remove the other project's configuration.
const second = join(project, "..", "second consumer 中文"); mkdirSync(second);
write(join(second, ".aidlc/provider-git-policy.json"), { version: 1, allowed_hosts: [new URL(source).hostname], allowed_commits: [revision], allow_file_fixtures: false });
run(["provider", "add", source, "--ref", revision, "--subdir", "providers/ssot-readonly", "--instance", "context", "--trust", "allowlisted-commit", "--project", second]);
const secondArgs = ["--project", second, "--host-config", host], secondPlan = join(second, "plan.json");
const shared = JSON.parse(run(["provider", "mcp-plan", ...secondArgs])); write(secondPlan, shared);
run(["provider", "mcp-apply", ...secondArgs, "--plan", secondPlan, ...shared.changes.flatMap(c => ["--approve-config", c.config_digest])]);
// Unsupported journals remain byte-identical and block mutation.
const journal = `${host}.aidlc-mcp-journal.json`, alien = JSON.stringify({ schema: "aidlc.mcp-transaction/v999", private: "preserve" });
writeFileSync(journal, alien);
assert.equal(JSON.parse(run(["provider", "mcp-status", ...mcpArgs])).status, "incompatible");
run(["provider", "mcp-recover", ...mcpArgs, "--plan", planFile], 2);
assert.equal(readFileSync(journal, "utf8"), alien);
const { unlinkSync } = await import("node:fs"); unlinkSync(journal); // Remove only this explicitly synthetic incompatible fixture.
run(["provider", "disable", "context", "--project", project]);
const cleanup = JSON.parse(run(["provider", "mcp-cleanup-plan", ...mcpArgs])); write(planFile, cleanup);
run(["provider", "mcp-cleanup", ...mcpArgs, "--plan", planFile]);
assert(json(host).mcpServers["context-documents"], "shared entry removed while another project still consumes it");
run(["provider", "disable", "context", "--project", second]);
write(secondPlan, JSON.parse(run(["provider", "mcp-cleanup-plan", ...secondArgs])));
run(["provider", "mcp-cleanup", ...secondArgs, "--plan", secondPlan]);
assert.deepEqual(json(host), original);
console.log("PASS installed MCP approval/apply/status/recover/cleanup; user and unknown entries preserved; incompatible journal blocked");

writeFileSync(join(project, "document.md"), "# 中文安装包验收\n\nA representative document.\n\n| Key | Value |\n| --- | --- |\n| Scope | Windows x64 |\n");
writeFileSync(join(project, "diagram.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#274060"/></svg>');
assert.match(run(["export", "md", "document.md", "--to", "docx", "--project", project, "--host-provider", "absent"], 1), /CAPABILITY|authorize|missing|Provider/i);
if (trusted !== "--trusted-documents") {
  console.log("SKIP trusted document execution: --trusted-documents was not supplied");
} else {
  add("document-render", "documents"); add("docx-style", "styles");
  for (const [kind, input, to] of [["md", "document.md", "docx"], ["md", "document.md", "pdf"], ["svg", "diagram.svg", "png"]]) {
    run(["export", kind, input, "--to", to, "--project", project, "--host-provider", "documents"]);
    const output = join(project, `${input.slice(0, input.lastIndexOf("."))}.${to}`), data = readFileSync(output);
    assert(data.length > 100);
    if (to === "pdf") assert.equal(data.subarray(0, 5).toString(), "%PDF-");
    if (to === "png") assert.equal(data.readUInt32BE(16), 120);
    if (to === "docx") assert.match(await (await JSZip.loadAsync(data)).file("word/document.xml").async("string"), /中文安装包验收/);
    console.log(`PASS installed production export ${to}: ${data.length} bytes`);
  }
  const docxArgs = ["--project", project, "--host-provider", "styles", "--json"];
  const before = readFileSync(join(project, "document.docx"));
  run(["docx", "inspect", "document.docx", ...docxArgs]);
  assert.deepEqual(readFileSync(join(project, "document.docx")), before);
  const report = JSON.parse(run(["docx", "beautify", "document.docx", "--output", "styled.docx", ...docxArgs]));
  assert.equal(report.status, "STATIC_PASS");
  run(["docx", "validate", "styled.docx", "--against", "document.docx", "--json"]);
  const originalZip = await JSZip.loadAsync(before), styled = await JSZip.loadAsync(readFileSync(join(project, "styled.docx")));
  assert.deepEqual(Object.keys(styled.files).sort(), Object.keys(originalZip.files).sort());
  for (const part of Object.keys(originalZip.files).filter(p => p !== "word/styles.xml"))
    assert.deepEqual(await styled.files[part].async("nodebuffer"), await originalZip.files[part].async("nodebuffer"), `non-style part changed: ${part}`);
  console.log("PASS installed docx-style and independent non-style ZIP protection; final page layout unverified");
}
assert(existsSync(join(project, ".aidlc")));
console.log("Production Provider package smoke complete; no SSOT/Figma service calls or production accounts used.");
