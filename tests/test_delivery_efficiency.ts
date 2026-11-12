import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readModuleManifest } from "../core/tools/aidlc-execution-context";
import { evidenceScopeForInstance, evidenceSourceRevision, legacyEvidenceScopeForInstance } from "../core/tools/aidlc-workflow-layout";
import { classifyRepair, sensorRepairDiagnostics } from "../core/tools/aidlc-repair-guidance";
import { fixture, write } from "./mars244_fixture";

const f = fixture("code-generation@module:shop@unit:api");
try {
  const manifestPath = "docs/aidlc/ideation/module-manifest.json";
  const manifest = JSON.parse(readFileSync(join(f.root, manifestPath), "utf8"));
  const privateDoc = "team/other-integration.md";
  const scope = () => evidenceScopeForInstance(f.root, f.state.current_stage_instance!);
  const digest = () => evidenceSourceRevision(f.root, f.state.current_stage_instance!).scope_digest;
  write(f.root, privateDoc, "before");
  const undeclared = digest(); write(f.root, privateDoc, "after");
  assert.notEqual(digest(), undeclared, "unknown Markdown remains bound");
  const beforeOwnership = digest();
  manifest.modules[1].context_paths = [privateDoc]; write(f.root, manifestPath, manifest);
  assert.notEqual(digest(), beforeOwnership, "ownership change requires fresh evidence");
  const declared = digest(); write(f.root, privateDoc, "parallel module changes again");
  assert.equal(digest(), declared, "parallel private doc does not invalidate another unit");
  assert.equal(scope().exclude(privateDoc), true);
  assert.equal(evidenceScopeForInstance(f.root, "application-design@module:other").exclude(privateDoc), false);
  assert.equal(evidenceScopeForInstance(f.root, "build-and-test").exclude(privateDoc), false, "project validation retains private docs");
  assert.equal(legacyEvidenceScopeForInstance(f.root, f.state.current_stage_instance!).exclude(privateDoc), false);
  for (const path of ["team/unknown.md", "package-lock.json", "src/shop/api/code.ts"]) {
    const before = digest(); write(f.root, path, "real change"); assert.notEqual(digest(), before);
  }
  manifest.modules[0].contract_paths.push(privateDoc); write(f.root, manifestPath, manifest);
  assert.equal(scope().exclude(privateDoc), false, "explicit shared contract wins over private ownership");
  const shared = digest(); write(f.root, privateDoc, "shared change"); assert.notEqual(digest(), shared);
  manifest.modules[0].contract_paths.pop(); write(f.root, manifestPath, manifest);
  f.units[0].evidence_inputs.shared_paths.push(privateDoc);
  write(f.root, `${f.base}/unit-manifest.json`, { schema_version: 1, module_id: "shop", units: f.units });
  assert.equal(scope().exclude(privateDoc), false, "unit shared input wins too");
  for (const path of ["README.md", "team/AGENTS.md", "team/*.md", "team", "team/config.json", "../bad.md", ".aidlc/input.md", ".git/note.md", "docs/aidlc/ideation/input.md", "src/shop/api/design.md"]) {
    manifest.modules[1].context_paths = [path]; write(f.root, manifestPath, manifest);
    assert.throws(() => readModuleManifest(f.root), undefined, path);
  }
  manifest.modules[1].context_paths = [privateDoc]; manifest.modules[0].context_paths = [privateDoc.toUpperCase().replace(/\.MD$/, ".md")];
  write(f.root, manifestPath, manifest); assert.throws(() => readModuleManifest(f.root), /duplicate.*ownership/);
} finally { rmSync(f.root, { recursive: true, force: true }); }

for (const message of ["CANONICAL_INPUT_MISSING: design", "CANONICAL_DESIGN_SECTION_REQUIRED", "unresolved marker found in project artifact: design.md", "SLICE_COVERAGE: missing requirements"]) {
  assert.equal(classifyRepair(message).category, "input-defect");
  const [repair] = sensorRepairDiagnostics([{ message, sensor: "functional-design-completeness", stage_instance: "functional-design@module:shop@unit:api" }]);
  assert.equal(repair.action, "repair-inputs"); assert.equal(repair.command, undefined);
}
assert.equal(classifyRepair("evidence artifact stale").category, "artifact-stale");
assert.equal(classifyRepair("tests_failed: 1").category, "test-failed");
assert.equal(classifyRepair("claim expired").category, "permission-state");
console.log("PASS delivery efficiency: precise document ownership, shared/legacy boundaries and input-defect routing");
