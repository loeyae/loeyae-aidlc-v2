import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readModuleFacts, matchKnowledgeRequirements } from "../core/tools/aidlc-module-facts.js";
const root = mkdtempSync(join(tmpdir(), "aidlc-facts-"));
const write = (name: string, data: unknown) => writeFileSync(join(root, name), typeof data === "string" ? data : JSON.stringify(data));
const req = [{ dependency: "npm:vue", minimum: "3.0.0", maximum_exclusive: "4.0.0" }];
try {
  mkdirSync(join(root, ".aidlc/decisions"), { recursive: true });
  write(".aidlc/module-facts.json", { schema: "aidlc.module-facts/v1", modules: [{ id: "app", root: "." }] });
  write("package.json", { packageManager: "pnpm@9.15.0", dependencies: { vue: "^3.4.0" } });
  assert.equal(readModuleFacts(root, "app").dependencies[0].status, "unknown");
  write("package-lock.json", { lockfileVersion: 3, packages: { "": { dependencies: { vue: "^3.4.0" } }, "node_modules/vue": { version: "3.5.12" } } });
  const before = readModuleFacts(root, "app");
  assert.equal(before.dependencies.find(d => d.dependency === "runtime:pnpm")!.version, "9.15.0");
  assert.equal(before.dependencies[0].version, "3.5.12");
  assert.equal(matchKnowledgeRequirements(before, req), "match");
  assert.equal(before.dependencies[0].sources.length, 2);
  write("package-lock.json", { lockfileVersion: 3, packages: { "": { dependencies: { vue: "^4.0.0" } }, "node_modules/vue": { version: "3.5.12" } } });
  assert.equal(readModuleFacts(root, "app").dependencies[0].status, "conflict");
  assert.notEqual(readModuleFacts(root, "app").facts_digest, before.facts_digest);
  write("package-lock.json", { lockfileVersion: 3, packages: { "": { dependencies: { vue: "^3.4.0" } } } });
  assert.equal(readModuleFacts(root, "app").dependencies[0].status, "conflict", "missing declared lock entry is not a valid resolved dependency");
  write("package.json", { dependencies: { vue: "latest" } });
  write("package-lock.json", { lockfileVersion: 3, packages: { "": { dependencies: { vue: "latest" } }, "node_modules/vue": { version: "3.5.12" } } });
  assert.equal(readModuleFacts(root, "app").dependencies[0].status, "unknown", "tags never become resolved fixed versions");
  write("pom.xml", '<project><dependencyManagement><dependencies><dependency><groupId>org.springframework.cloud</groupId><artifactId>spring-cloud-dependencies</artifactId><version>2023.0.1</version></dependency></dependencies></dependencyManagement><dependencies><dependency><groupId>org.springframework.cloud</groupId><artifactId>spring-cloud-starter-gateway</artifactId><version>${cloud.version}</version></dependency></dependencies></project>');
  const maven = readModuleFacts(root, "app").dependencies.filter(d => d.dependency.startsWith("maven:"));
  assert.equal(maven.length, 1); assert.equal(maven[0].status, "unknown");
  write("pom.xml", '<!DOCTYPE project [<!ENTITY env SYSTEM "file:///secret">]><project/>');
  assert.throws(() => readModuleFacts(root, "app"), /entities prohibited/);
  rmSync(join(root, "pom.xml"));
  const declaration = { dependency: "runtime:node", version: "18.20.8", decision: ".aidlc/decisions/app.json" };
  write(".aidlc/module-facts.json", { schema: "aidlc.module-facts/v1", modules: [{ id: "app", root: ".", declarations: [declaration] }] });
  write(declaration.decision, { schema: "aidlc.module-decision/v1", module_id: "app", approved: false, dependencies: [{ dependency: "runtime:node", version: "18.20.8" }] });
  assert.throws(() => readModuleFacts(root, "app"), /unapproved/);
  write(declaration.decision, { schema: "aidlc.module-decision/v1", module_id: "app", approved: true, dependencies: [{ dependency: "runtime:node", version: "18.20.8" }] });
  assert.equal(readModuleFacts(root, "app").dependencies.find(d => d.dependency === "runtime:node")!.version, "18.20.8");
  // The same reviewed data path can resolve a workspace/parent supplied version.
  const vueDecision = { dependency: "npm:vue", version: "3.5.12", decision: ".aidlc/decisions/vue.json" };
  rmSync(join(root, "package-lock.json"));
  write("package.json", { dependencies: { vue: "^3.4.0" } });
  write(vueDecision.decision, { schema: "aidlc.module-decision/v1", module_id: "app", approved: true, dependencies: [{ dependency: "npm:vue", version: "3.5.12" }] });
  write(".aidlc/module-facts.json", { schema: "aidlc.module-facts/v1", modules: [{ id: "app", root: ".", declarations: [vueDecision] }] });
  assert.equal(readModuleFacts(root, "app").dependencies[0].version, "3.5.12");
  write("package.json", { dependencies: { vue: "^4.0.0" } });
  assert.equal(readModuleFacts(root, "app").dependencies[0].status, "conflict", "reviewed version cannot override an incompatible manifest range");
  declaration.decision = ".git/config";
  write(".aidlc/module-facts.json", { schema: "aidlc.module-facts/v1", modules: [{ id: "app", root: ".", declarations: [declaration] }] });
  assert.throws(() => readModuleFacts(root, "app"), /bounded .aidlc\/decisions/);
  for (const badRoot of ["..", "a/../../b", "C:/secret", "/tmp", "a\\b"]) {
    write(".aidlc/module-facts.json", { schema: "aidlc.module-facts/v1", modules: [{ id: "app", root: badRoot }] });
    assert.throws(() => readModuleFacts(root, "app"), /unsafe relative path/);
  }
  assert.throws(() => matchKnowledgeRequirements(before, { any_of: [{ any_of: [req] }] }), /alternatives/);
  assert.throws(() => matchKnowledgeRequirements(before, [{ dependency: "npm:vue", exact: "latest" }]), /compatibility/);
  console.log("Bounded module facts: source digests, lock conflicts, tags, Maven variables/BOM, approved declarations, path/XML/code rejection passed");
} finally { rmSync(root, { recursive: true, force: true }); }
