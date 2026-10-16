import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addProjectProvider, setProjectProviderEnabled } from "../core/tools/aidlc-provider-cli.js";
import { confirmProviderKnowledge, loadProviderKnowledge, verifyProviderKnowledge } from "../core/tools/aidlc-provider-knowledge.js";
import { readModuleFacts, matchKnowledgeRequirements } from "../core/tools/aidlc-module-facts.js";
import { defaultResolutionPolicy, resolveProjectProviderPlan } from "../core/tools/aidlc-provider-resolver.js";
import { readCurrentProviderSourceRevision } from "../core/tools/aidlc-provider-runner.js";
import { evaluateProviderGate } from "../core/tools/aidlc-provider-gate.js";
import { parseProviderEvidence } from "../core/tools/aidlc-provider-evidence.js";
import { createProjectProviders, createProjectProvidersLock, writeProjectProviders } from "../core/tools/aidlc-project-provider.js";

// Required real immutable external repository, never replaced by a fixture manifest.
const [source, commit] = process.argv.slice(2);
assert.ok(source && /^[a-f0-9]{40}$/.test(commit ?? ""), "usage: test_module_knowledge.ts <actual Git URL> <immutable commit>");
const project = mkdtempSync(join(tmpdir(), "aidlc-module-knowledge-"));
function write(path: string, value: unknown) { const target = join(project, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value)); }
function git(...args: string[]) { const result = spawnSync("git", args, { cwd: project, encoding: "utf8", shell: false }); assert.equal(result.status, 0, result.stderr); }
const modules: any[] = [];
function module(id: string, dependencies: Record<string, string>, locked?: Record<string, string>) {
  modules.push({ id, root: id });
  write(`${id}/package.json`, { dependencies, scripts: { postinstall: "exit 77", test: "never-executed" } });
  if (locked) write(`${id}/package-lock.json`, { lockfileVersion: 3, packages: { "": { dependencies }, ...Object.fromEntries(Object.entries(locked).map(([name, version]) => [`node_modules/${name}`, { version }])) } });
}
function registry() { write(".aidlc/module-facts.json", { schema: "aidlc.module-facts/v1", modules }); }
function resolveModule(id: string) { return resolveProjectProviderPlan(project, { scope: { stage: "code-generation", module_id: id, unit_id: "unit" }, source_revision: readCurrentProviderSourceRevision(project), policy: defaultResolutionPolicy(), freeze: true }); }
function load(id: string, capability: string) {
  const result = resolveModule(id);
  const node = result.plan.nodes.find(n => n.capability_id === `tech.${capability}` && n.state === "selected");
  assert.ok(node, `${id} needs selected ${capability}: ${JSON.stringify(result.provider_context.diagnostics)}`);
  const input = { plan: result.plan, nodeId: node.node_id };
  return { input, delivery: loadProviderKnowledge(project, input) };
}
try {
  git("init", "-b", "main"); git("config", "user.name", "Module integration"); git("config", "user.email", "integration@example.test");
  write("README.md", "real module dependency integration"); git("add", "."); git("commit", "-m", "baseline");
  const config = createProjectProviders(); writeProjectProviders(project, config, createProjectProvidersLock(config));
  const empty = resolveModule("no-packages"); assert.equal(empty.provider_actions.length, 0);
  module("vue35", { vue: "3.5.12", "element-plus": "2.11.8", pinia: "2.1.7", "vue-router": "4.4.5", "vue-i18n": "9.10.2", vitest: "2.0.0", "@vue/test-utils": "2.4.6" });
  module("vue34", { vue: "^3.4.0" }, { vue: "3.4.38" });
  module("vue2", { vue: "2.7.16" }); module("react", { react: "19.0.0" });
  module("uni", { vue: "3.5.12", "@dcloudio/uni-app": "3.0.0", "uview-plus": "3.0.0", "z-paging": "2.0.0" });
  module("unknown", { vue: "$vueVersion" }); module("range-only", { vue: "^3.4.0" });
  module("conflict", { vue: "3.5.12" }, { vue: "2.7.16" });
  module("range-conflict", { vue: "^3.5.0" }, { vue: "4.0.0" });
  module("named-vue-uniapp-nacos", {});
  for (const [id, artifact, version] of [["cloud", "spring-cloud-starter-gateway", "4.1.0"], ["nacos", "spring-cloud-starter-alibaba-nacos-config", "2023.0.1"], ["inherited", "spring-cloud-starter-gateway", ""], ["variable", "spring-cloud-starter-gateway", "${cloud.version}"]]) {
    modules.push({ id, root: id }); const group = artifact.includes("alibaba") ? "com.alibaba.cloud" : "org.springframework.cloud";
    write(`${id}/pom.xml`, `<project><dependencies><dependency><groupId>${group}</groupId><artifactId>${artifact}</artifactId>${version ? `<version>${version}</version>` : ""}</dependency></dependencies></project>`);
  }
  modules.push({ id: "explicit", root: "explicit", declarations: [{ dependency: "npm:vue", version: "3.4.38", decision: ".aidlc/decisions/explicit.json" }] });
  write(".aidlc/decisions/explicit.json", { schema: "aidlc.module-decision/v1", module_id: "explicit", approved: true, dependencies: [{ dependency: "npm:vue", version: "3.4.38" }] });
  for (const [id, dependency, version] of [["runtime", "runtime:node", "18.20.8"], ["legacy-security", "convention:legacy-security-reference", "1.0.0"]]) {
    const decision = `.aidlc/decisions/${id}.json`;
    modules.push({ id, root: id, declarations: [{ dependency, version, decision }] });
    write(decision, { schema: "aidlc.module-decision/v1", module_id: id, approved: true, dependencies: [{ dependency, version }] });
  }
  modules.push({ id: "java-test", root: "java-test" });
  write("java-test/pom.xml", `<project><dependencies>${[["org.junit.jupiter", "junit-jupiter", "5.11.0"], ["org.mockito", "mockito-core", "5.14.0"], ["org.assertj", "assertj-core", "3.26.0"], ["org.springframework.boot", "spring-boot-starter-test", "3.3.0"]].map(([group, artifact, version]) => `<dependency><groupId>${group}</groupId><artifactId>${artifact}</artifactId><version>${version}</version></dependency>`).join("")}</dependencies></project>`);
  registry();
  write(".aidlc/provider-git-policy.json", { version: 1, allowed_hosts: source.startsWith("file:") ? [] : [new URL(source).hostname], allowed_commits: [commit], allow_file_fixtures: source.startsWith("file:") });
  const bindings: Record<string, string[]> = {
    "vue-element-knowledge": ["vue35", "vue34", "vue2", "react", "unknown", "range-only", "conflict", "range-conflict", "named-vue-uniapp-nacos", "not-registered", "explicit"],
    "uniapp-knowledge": ["uni", "vue35"],
    "spring-cloud-knowledge": ["cloud", "nacos", "inherited", "variable", "named-vue-uniapp-nacos"],
    "spring-testing-knowledge": ["java-test"], "runtime-knowledge": ["runtime"], "legacy-security-reference": ["legacy-security"],
  };
  for (const [pack, boundModules] of Object.entries(bindings)) {
    addProjectProvider(project, { source, ref: commit, subdir: `providers/${pack}`, instance: pack, trust: "allowlisted-commit", allowFile: source.startsWith("file:"), modules: boundModules, stages: ["code-generation"], capabilities: [`tech.${pack}`] });
  }
  const v35 = load("vue35", "vue-element-knowledge");
  assert.equal(v35.delivery.provider_instance.commit_oid, commit);
  assert.ok(v35.delivery.sections.some(s => /:deep\(\)/.test(s.content)), "real Figma chapter content must load");
  assert.ok(v35.delivery.sections.some(s => /createPinia|defineStore/.test(s.content)), "real Pinia content must load");
  assert.ok(!v35.delivery.sections.some(s => /3\.5\.12 \/ 5\.3\.3/.test(s.content)), "uninstalled table dependencies cannot impose the original profile");
  const v34 = load("vue34", "vue-element-knowledge");
  assert.equal(v34.delivery.module_facts!.dependencies.find(d => d.dependency === "npm:vue")!.version, "3.4.38");
  assert.ok(!v34.delivery.sections.some(s => /<el-|defineStore/.test(s.content)), "no Element or Pinia dependency means no specialized chapter");
  assert.notEqual(v35.delivery.delivery_digest, v34.delivery.delivery_digest);
  assert.equal(v35.delivery.scope.module_id, "vue35"); assert.equal(v34.delivery.scope.module_id, "vue34");
  assert.ok(load("explicit", "vue-element-knowledge").delivery.sections.length > 0);
  assert.ok(load("java-test", "spring-testing-knowledge").delivery.sections.some(s => /@SpringBootTest/.test(s.content)));
  assert.ok(load("runtime", "runtime-knowledge").delivery.sections.some(s => /node:18-alpine/.test(s.content)));
  assert.ok(load("legacy-security", "legacy-security-reference").delivery.sections.some(s => /SecurityUtil/.test(s.content)));
  const uni = load("uni", "uniapp-knowledge"); assert.ok(uni.delivery.sections.some(s => /z-paging/.test(s.content)));
  assert.ok(!resolveModule("vue35").provider_actions.some(a => a.capability_id.includes("uniapp")));
  const cloud = load("cloud", "spring-cloud-knowledge");
  assert.ok(!cloud.delivery.sections.some(s => s.content.startsWith("## Nacos 配置处理")));
  const nacos = load("nacos", "spring-cloud-knowledge");
  assert.ok(nacos.delivery.sections.some(s => s.content.startsWith("## Nacos 配置处理")));
  for (const id of ["vue2", "react", "named-vue-uniapp-nacos", "not-registered"]) assert.equal(resolveModule(id).provider_actions.length, 0, id);
  for (const id of ["unknown", "range-only", "inherited", "variable", "conflict", "range-conflict"]) {
    const result = resolveModule(id); assert.equal(result.provider_actions.length, 0, id);
    assert.match(JSON.stringify(result.provider_context.diagnostics), /unknown|conflict/, id);
  }
  assert.equal(readModuleFacts(project, "conflict").dependencies[0].status, "conflict");
  assert.equal(readModuleFacts(project, "variable").dependencies[0].status, "unknown");
  assert.throws(() => verifyProviderKnowledge(project, v35.input), /confirmation is missing/);
  const confirmed = confirmProviderKnowledge(project, { ...v35.input, deliveryDigest: v35.delivery.delivery_digest, consumer: "real-module-integration" });
  assert.deepEqual(verifyProviderKnowledge(project, v35.input), confirmed);
  assert.throws(() => confirmProviderKnowledge(project, { ...v34.input, deliveryDigest: v35.delivery.delivery_digest, consumer: "wrong-module" }), /does not match/);
  assert.throws(() => parseProviderEvidence(confirmed.receipt), /PROVIDER_/);
  assert.equal(evaluateProviderGate(project, { plan: v35.input.plan, evidence: [] }).decision.status, "blocked");
  write("vue35/package.json", { dependencies: { vue: "3.6.0" } });
  assert.throws(() => verifyProviderKnowledge(project, v35.input), /source revision|confirmation is missing/);
  write("vue35/package.json", { dependencies: { vue: "3.5.12", "element-plus": "2.11.8", pinia: "2.1.7", "vue-router": "4.4.5", "vue-i18n": "9.10.2", vitest: "2.0.0", "@vue/test-utils": "2.4.6" }, scripts: { postinstall: "exit 77", test: "never-executed" } });
  assert.deepEqual(verifyProviderKnowledge(project, v35.input), confirmed);
  setProjectProviderEnabled(project, "vue-element-knowledge", false);
  assert.equal(resolveModule("vue35").provider_actions.length, 0);
  assert.throws(() => verifyProviderKnowledge(project, v35.input), /current lock|scope\/capability/);
  // Escape attempts and code-like declarations are rejected before arbitrary reads.
  modules[0].root = "../outside"; registry(); assert.throws(() => readModuleFacts(project, "vue35"), /unsafe relative path/);
  modules[0].root = "vue35"; modules[0].run = "echo unsafe"; registry(); assert.throws(() => readModuleFacts(project, "vue35"), /unknown field/); delete modules[0].run;
  registry();
  const facts = readModuleFacts(project, "vue34");
  assert.equal(matchKnowledgeRequirements(facts, [{ dependency: "npm:vue", minimum: "4.0.0", maximum_exclusive: "5.0.0" }]), "mismatch");
  assert.throws(() => matchKnowledgeRequirements(facts, [{ dependency: "npm:vue", exact: "latest" }]), /compatibility/);
  console.log(`Actual Git install/lock -> module facts -> compatible content -> signed Core receipt passed: ${commit}; Vue versions, mixed frameworks, UniApp, partial Spring/Nacos, unknown/conflict, scope/fact/lock drift and Gate isolation verified`);
} finally { rmSync(project, { recursive: true, force: true }); }
