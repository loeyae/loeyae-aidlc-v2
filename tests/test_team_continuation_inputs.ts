import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { phaseInputBinding, historicalPhaseInputErrors } from "../core/tools/aidlc-phase-inputs";
import { classifyRepair } from "../core/tools/aidlc-repair-guidance";
import { evidenceScopeForInstance, legacyEvidenceScopeForInstance, phaseExecutionScopeForInstance } from "../core/tools/aidlc-workflow-layout";
import { readSourceRevision, withRevisionMemoization } from "../core/tools/aidlc-revision";
import { fixture, git, write } from "./mars244_fixture";
import { createInitialState } from "../core/tools/aidlc-light-state";
import { saveFixtureState } from "./mars243_fixture_session";
import { semanticCheckerEnv, semanticValidationEnvironment } from "../core/tools/aidlc-evidence";

const root = mkdtempSync(join(tmpdir(), "aidlc-continuation-inputs-"));
const put = (path: string, value: unknown) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
};
try {
  const originalEnvironment = { AIDLC_ACTIVE_STAGE: "caller-context", AIDLC_PHASE: "actual-validator-input", AIDLC_PROGRESS: "user-progress", CUSTOM_CHECK_INPUT: "unchanged" };
  const semanticEnvironment = semanticCheckerEnv({ current_stage: "build-and-test", current_module: "project" }, originalEnvironment);
  semanticEnvironment.AIDLC_SEMANTIC_CALLER_CONTEXT = JSON.stringify({ version: 1, values: {
    AIDLC_ACTIVE_STAGE: originalEnvironment.AIDLC_ACTIVE_STAGE, AIDLC_ACTIVE_MODULE: null, AIDLC_ACTIVE_UNIT: null,
    AIDLC_PROGRESS: originalEnvironment.AIDLC_PROGRESS, AIDLC_SEMANTIC_CALLER_CONTEXT: null,
  } });
  assert.deepEqual(semanticValidationEnvironment(semanticEnvironment), originalEnvironment, "semantic-only context changes do not replace the actual command environment");
  assert.equal(semanticValidationEnvironment({ ...semanticEnvironment, AIDLC_PHASE: "changed actual validator input" })!.AIDLC_PHASE, "changed actual validator input", "real command environment changes remain visible");
  assert.equal(semanticValidationEnvironment(originalEnvironment), undefined, "direct execution does not invent caller context");
  assert.throws(() => semanticValidationEnvironment({ AIDLC_SEMANTIC_CALLER_CONTEXT: '{"version":1,"values":{}}' }), /invalid semantic caller/);
  const shared = "src/shared-api.ts";
  put("docs/aidlc/ideation/module-manifest.json", { schema_version: 1, modules: [{ module_id: "project", name: "Project", service_id: "project", paths: ["src"] }] });
  put("docs/aidlc/modules/project/inception/unit-manifest.json", { schema_version: 1, module_id: "project", units: [{ unit_id: "alpha", name: "Alpha", service_id: "project", evidence_inputs: { version: 1, paths: ["src/alpha"], shared_paths: [shared], depends_on_units: [] } }] });
  const scope = evidenceScopeForInstance(root, "test-case-derivation@module:project");
  assert.equal(scope.exclude("docs/aidlc/modules/project/construction/alpha/implementation-summary.md"), true);
  assert.equal(scope.exclude("src/alpha/implementation.ts"), true);
  assert.equal(scope.exclude(shared), false, "declared shared source input must stay bound");
  assert.equal(scope.exclude("docs/aidlc/modules/project/inception/requirements.md"), false);
  console.log("PASS planning scope excludes downstream construction while preserving declared shared and upstream inputs");

  const workflow = createInitialState("express", "4.23.3", undefined, [], "Validate narrow GREEN review receipt projection");
  saveFixtureState(root, workflow);
  const receiptPath = "docs/aidlc/modules/project/inception/artifact-review.json";
  const reportPath = "docs/aidlc/modules/project/construction/alpha/code-review.md";
  const receipt = { version: "1", kind: "artifact", workflow_id: workflow.workflow_id, module_id: "project", delivery_scope: "approved-scope", reviewer: "reviewer",
    inputs: [{ path: "requirements.md", sha256: "a".repeat(64) }], items: [{ id: "requirements.md", conclusion: "supported", rationale: "verified", references: ["requirements.md"], examples: ["approved example"] }], open_findings: [] };
  const projectReceipt = () => phaseExecutionScopeForInstance(root, "code-generation@module:project@unit:alpha").projectedInputs?.[receiptPath];
  put(receiptPath, receipt);
  const beforeReport = projectReceipt();
  assert.ok(beforeReport);
  const withReport = { ...receipt, inputs: [...receipt.inputs, { path: reportPath, sha256: "b".repeat(64) }] };
  put(receiptPath, withReport); assert.equal(projectReceipt(), beforeReport, "new allowed downstream report input does not invalidate GREEN");
  put(receiptPath, { ...withReport, inputs: [...receipt.inputs, { path: reportPath, sha256: "c".repeat(64) }] });
  assert.equal(projectReceipt(), beforeReport, "only the downstream report digest may change without invalidation");
  for (const changed of [
    { ...withReport, reviewer: "different reviewer" },
    { ...withReport, items: [{ ...receipt.items[0], conclusion: "conflict" }] },
    { ...withReport, open_findings: [{ code: "OPEN", id: "requirements.md", message: "unresolved" }] },
    { ...withReport, inputs: [{ ...receipt.inputs[0], sha256: "d".repeat(64) }, withReport.inputs[1]] },
  ]) { put(receiptPath, changed); assert.notEqual(projectReceipt(), beforeReport, "review semantics and real input bindings remain protected"); }
  for (const invalid of [{ ...withReport, kind: "unknown" }, { ...withReport, workflow_id: "foreign" }, { ...withReport, inputs: [{ path: reportPath, sha256: "bad" }] }]) {
    put(receiptPath, invalid); assert.equal(projectReceipt(), undefined, "invalid receipt keeps its original raw-byte binding");
  }
  put(receiptPath, withReport);
  const manifestPath = "docs/aidlc/ideation/module-manifest.json", manifestBefore = readFileSync(join(root, manifestPath), "utf8");
  const manifestShared = JSON.parse(manifestBefore); manifestShared.modules[0].contract_paths = ["docs"];
  put(manifestPath, manifestShared);
  const sharedScope = phaseExecutionScopeForInstance(root, "code-generation@module:project@unit:alpha");
  assert.equal(sharedScope.projectedInputs?.[receiptPath], undefined, "an explicitly shared receipt is never projected");
  assert.equal(sharedScope.exclude(reportPath), false, "an explicitly shared downstream report remains a real execution input");
  put(manifestPath, manifestBefore);
  const unitPath = "docs/aidlc/modules/project/inception/unit-manifest.json", unitsBefore = readFileSync(join(root, unitPath), "utf8");
  const unitsWithSibling = JSON.parse(unitsBefore);
  unitsWithSibling.units.push({ unit_id: "beta", name: "Beta", service_id: "project", evidence_inputs: { version: 1, paths: ["src/beta"], shared_paths: [], depends_on_units: [] } });
  put(unitPath, unitsWithSibling);
  const siblingSource = "src/beta/implementation.ts", siblingPlan = "docs/aidlc/modules/project/construction/beta/plans/code-generation-plan.md";
  const siblingReceipt = { ...receipt, inputs: [...receipt.inputs, { path: siblingSource, sha256: "b".repeat(64) }, { path: siblingPlan, sha256: "c".repeat(64) }] };
  put(receiptPath, siblingReceipt);
  assert.equal(projectReceipt(), beforeReport, "receipt cannot indirectly bind private sibling inputs already excluded by complete ownership");
  put(receiptPath, { ...siblingReceipt, inputs: [...receipt.inputs, { path: siblingSource, sha256: "d".repeat(64) }, { path: siblingPlan, sha256: "e".repeat(64) }] });
  assert.equal(projectReceipt(), beforeReport, "private sibling source and construction changes remain isolated");
  const incompleteOwnership = structuredClone(unitsWithSibling); delete incompleteOwnership.units[1].evidence_inputs;
  put(unitPath, incompleteOwnership);
  assert.notEqual(projectReceipt(), beforeReport, "without complete ownership the same sibling inputs remain conservatively bound");
  unitsWithSibling.units[0].evidence_inputs.shared_paths.push(siblingSource);
  put(unitPath, unitsWithSibling);
  assert.ok(JSON.parse(projectReceipt()!).inputs.some((input: { path: string }) => input.path === siblingSource), "shared input takes precedence over private sibling exclusion");
  put(unitPath, unitsBefore);
  console.log("PASS GREEN receipt projection ignores only allowed downstream report rows and preserves identity, review semantics, real inputs and shared contracts");

  // Exemption command configuration uses the exact existing ownership projection.
  const exemptUnits = structuredClone(unitsWithSibling);
  exemptUnits.units[0].ucd_exemption = { reason_code: "pure-declaration", reason: "declaration only", approval_ref: "approved", alternative_validation: "validate declaration", validation_command: ["node", "tests/validate.cjs"] };
  put("tests/validate.cjs", "console.log('validated');\n");
  put(unitPath, exemptUnits);
  const exemptionBinding = () => phaseInputBinding(root, { status: "required", ucd_ids: [], ucd_units: {} }, {}, "alpha", {
    argv: ["node", "tests/validate.cjs"], config: join(root, unitPath),
    projectedConfig: phaseExecutionScopeForInstance(root, "code-generation@module:project@unit:alpha").projectedInputs?.[unitPath],
  } as Parameters<typeof phaseInputBinding>[4]);
  const originalExemption = exemptionBinding();
  exemptUnits.units[1].name = "Renamed sibling"; put(unitPath, exemptUnits);
  assert.deepEqual(exemptionBinding(), originalExemption, "irrelevant sibling metadata must not rebind the current exemption command");
  exemptUnits.units[0].ucd_exemption.reason = "changed current declaration"; put(unitPath, exemptUnits);
  assert.notDeepEqual(exemptionBinding(), originalExemption, "the current unit exemption declaration stays bound");
  exemptUnits.units[0].ucd_exemption.reason = "declaration only";
  delete exemptUnits.units[1].evidence_inputs; put(unitPath, exemptUnits);
  const conservativeExemption = exemptionBinding();
  exemptUnits.units[1].name = "Another sibling metadata change"; put(unitPath, exemptUnits);
  assert.notDeepEqual(exemptionBinding(), conservativeExemption, "unknown ownership retains the complete unit set");
  put(unitPath, unitsBefore);
  console.log("PASS exemption config projection preserves current declarations and conservative ownership while isolating private sibling metadata");

  put("tests/alpha.test.ts", "assert(implementation());\n");
  put("cases/alpha.md", "UC-D-001: approved behavior\n");
  put("cases/beta.md", "UC-D-002: other behavior\n");
  put("requirements.md", "REQ-1: approved requirement\n");
  const i13 = { status: "required", ucd_ids: ["UC-D-001", "UC-D-002"], ucd_modes: { "UC-D-001": "new", "UC-D-002": "new" }, ucd_units: { "UC-D-001": ["alpha"], "UC-D-002": ["beta"] }, source_files: ["requirements.md"], ucd_sources: { files: [
    { file: "cases/alpha.md", sha256: "a".repeat(64), ucd_ids: ["UC-D-001"] }, { file: "cases/beta.md", sha256: "b".repeat(64), ucd_ids: ["UC-D-002"] },
  ] } };
  const observation: Record<string, any> = { uc_mapping: [{ use_case: "UC-D-001", test_methods: ["tests/alpha.test.ts#approved behavior"] }] };
  observation.phase_input_binding = phaseInputBinding(root, i13, observation, "alpha");
  assert.deepEqual(historicalPhaseInputErrors(root, { ...i13, timestamp: "new", producer: { execution_id: "refreshed" } }, observation, "alpha"), []);
  put("src/alpha/implementation.ts", "export const implemented = true;\n");
  put("cases/beta.md", "UC-D-002: changed unrelated unit\n");
  assert.deepEqual(historicalPhaseInputErrors(root, i13, observation, "alpha"), []);
  for (const path of ["tests/alpha.test.ts", "cases/alpha.md", "requirements.md"]) {
    const original = readFileSync(join(root, path), "utf8");
    put(path, `${original}changed\n`);
    assert.match(historicalPhaseInputErrors(root, i13, observation, "alpha").join("\n"), /PHASE_INPUT_BINDING_CHANGED/, path);
    put(path, original);
  }
  assert.match(historicalPhaseInputErrors(root, { ...i13, ucd_modes: { ...i13.ucd_modes, "UC-D-001": "characterization" } }, observation, "alpha").join("\n"), /PHASE_INPUT_BINDING_CHANGED/);
  assert.match(historicalPhaseInputErrors(root, i13, { uc_mapping: observation.uc_mapping }, "alpha").join("\n"), /PHASE_INPUT_BINDING_MISSING/);
  put(".aidlc/commands/tdd.json", { stage: "tdd", commands: [] });
  const command = { argv: [process.execPath, "-e", "console.log('observed')"], config: join(root, ".aidlc/commands/tdd.json"), files: ["tests/alpha.test.ts"] };
  const symbolic: Record<string, any> = { uc_mapping: [{ use_case: "UC-D-001", test_methods: ["AlphaTest#approvedBehavior"] }] };
  symbolic.phase_input_binding = phaseInputBinding(root, i13, symbolic, "alpha", command);
  assert.deepEqual(historicalPhaseInputErrors(root, i13, symbolic, "alpha", command), [], "explicit existing test input closure supports established symbolic method names and external interpreter argv");
  console.log("PASS historical phase protects tests, I13 semantics and real sources while ignoring unrelated unit output and producer metadata");

  const displayPaths = [
    "docs/aidlc/construction/build-test-report.md",
    "docs/aidlc/construction/build-and-test/build-and-test-summary.md",
    "docs/aidlc/construction/build-and-test/build-instructions.md",
    "docs/aidlc/construction/build-and-test/unit-test-instructions.md",
    "docs/aidlc/construction/implementation-report.md", "docs/aidlc/handoff.md",
    "docs/aidlc/modules/project/construction/alpha/implementation-summary.md",
  ];
  const retainedPaths = [reportPath, "docs/aidlc/modules/project/construction/alpha/audit.md",
    "docs/aidlc/modules/project/construction/alpha/audit/test-case-reconciliation.md",
    "docs/aidlc/construction/build-and-test/testscenario.md", "docs/aidlc/construction/security-acceptance.md",
    "docs/aidlc/handoff-source.md", "docs/aidlc/construction/build-and-test/custom-instructions.md"];
  for (const path of [...displayPaths, ...retainedPaths]) put(path, `Initial ${path}\n`);
  git(root, "init", "-q"); git(root, "add", "."); git(root, "commit", "-qm", "scope fixture");
  const scopedInstances = ["workspace-detection", "build-and-test", "code-generation@module:project@unit:alpha"];
  const revision = (instance: string, legacy = false) => readSourceRevision(root, (legacy ? legacyEvidenceScopeForInstance : evidenceScopeForInstance)(root, instance));
  assert.equal(evidenceScopeForInstance(root, scopedInstances[0]).label, "inputs-v3:project");
  assert.equal(evidenceScopeForInstance(root, scopedInstances[1]).label, "inputs-v3:integration");
  assert.equal(legacyEvidenceScopeForInstance(root, scopedInstances[0]).label, "worktree");
  assert.equal(legacyEvidenceScopeForInstance(root, scopedInstances[1]).label, "worktree");
  const displayBaseline = scopedInstances.map(instance => revision(instance).scope_digest);
  const legacyProject = revision(scopedInstances[0], true), legacyModule = revision(scopedInstances[2], true);
  assert.ok(displayBaseline.every(digest => /^[a-f0-9]{64}$/.test(String(digest))), "versioned project/integration scopes must produce actual scope digests, not the ignored worktree scope");
  for (const path of displayPaths) {
    put(path, `Updated display ${path}\n`);
    for (const [index, instance] of scopedInstances.entries()) assert.equal(revision(instance).scope_digest, displayBaseline[index], `${instance}: ${path} is only a display view`);
  }
  assert.notEqual(revision(scopedInstances[0], true).worktree_digest, legacyProject.worktree_digest, "legacy worktree evidence retains its exact old binding and needs controlled refresh after drift");
  assert.notEqual(revision(scopedInstances[2], true).scope_digest, legacyModule.scope_digest, "legacy module hashes are never silently rewritten to accept display drift");
  const templateStage = "build-and-test-templates";
  assert.equal(evidenceScopeForInstance(root, templateStage).label, "inputs-v3:integration:build-and-test-templates");
  for (const path of displayPaths.slice(2, 4)) {
    assert.equal(evidenceScopeForInstance(root, templateStage).exclude(path), false, "the template stage binds its own instruction documents");
    const templateBefore = revision(templateStage).scope_digest, c8Before = revision("build-and-test").scope_digest;
    put(path, "TODO\n");
    assert.notEqual(revision(templateStage).scope_digest, templateBefore, "changed or invalid templates must invalidate the prior passing template evidence");
    assert.equal(revision("build-and-test").scope_digest, c8Before, "template-only changes remain downstream of C8");
  }
  const templateCurrent = revision(templateStage).scope_digest, c8Current = revision("build-and-test").scope_digest;
  assert.notEqual(templateCurrent, c8Current);
  withRevisionMemoization(() => {
    assert.equal(revision("build-and-test").scope_digest, c8Current);
    assert.equal(revision(templateStage).scope_digest, templateCurrent, "cached C8 scope must not replace the template stage's stricter input scope");
  });
  assert.equal(evidenceScopeForInstance(root, templateStage).exclude(displayPaths[1]), true, "the self-input exception does not rebind an unrelated summary view");
  console.log("PASS template checker binds its own two instruction files while C8 display exclusion and distinct scope caching remain intact");
  for (const path of retainedPaths) assert.equal(evidenceScopeForInstance(root, "build-and-test").exclude(path), false, `unknown documents and canonical review remain bound: ${path}`);
  assert.equal(evidenceScopeForInstance(root, scopedInstances[2]).exclude(reportPath), false, "normal unit evidence binds canonical code-review");
  assert.equal(phaseExecutionScopeForInstance(root, scopedInstances[2]).exclude(reportPath), true, "GREEN keeps the existing narrow downstream-review exception");
  for (const path of [reportPath, "src/alpha/implementation.ts", shared]) {
    const before = scopedInstances.map(instance => revision(instance).scope_digest);
    put(path, `Changed real input ${path}\n`);
    for (const [index, instance] of scopedInstances.entries()) assert.notEqual(revision(instance).scope_digest, before[index], `${instance}: real input remains bound: ${path}`);
  }
  const beforeExport = revision("build-and-test").scope_digest;
  put(".aidlc/views/current-summary.md", "Exported display\n");
  assert.equal(revision("build-and-test").scope_digest, beforeExport, "the existing control-plane exclusion also covers the export area");
  console.log("PASS precise display scopes avoid repeated invalidation, preserve legacy hashes and retain actual source/review inputs");

  for (const [index, path] of displayPaths.entries()) {
    const declaredManifest = JSON.parse(manifestBefore), declaredUnits = JSON.parse(unitsBefore);
    // A module-tree leaf is intentionally not a legal contract declaration;
    // its valid shared ancestor still takes precedence over view exclusion.
    const declaredPath = path.startsWith("docs/aidlc/modules/") ? "docs" : path;
    if (index % 2) declaredUnits.units[0].evidence_inputs.shared_paths.push(declaredPath);
    else declaredManifest.modules[0].contract_paths = [declaredPath];
    put(manifestPath, declaredManifest); put(unitPath, declaredUnits);
    for (const instance of scopedInstances) assert.equal(evidenceScopeForInstance(root, instance).exclude(path), false, `${instance}: explicit shared/contract input overrides display exclusion`);
  }
  put(manifestPath, manifestBefore); put(unitPath, unitsBefore);
  put(receiptPath, receipt);
  const receiptBaseline = scopedInstances.map(instance => revision(instance).scope_digest);
  put(receiptPath, { ...receipt, inputs: [...receipt.inputs, { path: displayPaths[6], sha256: "e".repeat(64) }] });
  for (const [index, instance] of scopedInstances.entries()) assert.equal(revision(instance).scope_digest, receiptBaseline[index], `${instance}: valid review receipts cannot indirectly rebind a display view`);
  put(receiptPath, { ...receipt, inputs: [...receipt.inputs, { path: reportPath, sha256: "f".repeat(64) }] });
  for (const [index, instance] of scopedInstances.entries()) assert.notEqual(revision(instance).scope_digest, receiptBaseline[index], `${instance}: real code review receipt rows remain bound`);
  put(receiptPath, { ...receipt, reviewer: "changed reviewer" });
  for (const [index, instance] of scopedInstances.entries()) assert.notEqual(revision(instance).scope_digest, receiptBaseline[index], `${instance}: review semantics remain bound`);
  put(receiptPath, { ...receipt, workflow_id: "foreign" });
  for (const instance of scopedInstances) assert.equal(evidenceScopeForInstance(root, instance).projectedInputs?.[receiptPath], undefined, "unverified receipts keep their complete byte binding");
  put(receiptPath, receipt);
  const explicitDisplayCommand = { ...command, files: [displayPaths[0]] };
  const displayObservation = { ...observation, phase_input_binding: phaseInputBinding(root, i13, observation, "alpha", explicitDisplayCommand) };
  assert.deepEqual(historicalPhaseInputErrors(root, i13, displayObservation, "alpha", explicitDisplayCommand), []);
  put(displayPaths[0], "Changed explicitly declared command input\n");
  assert.match(historicalPhaseInputErrors(root, i13, displayObservation, "alpha", explicitDisplayCommand).join("\n"), /PHASE_INPUT_BINDING_CHANGED/, "display paths explicitly used by a command remain real command inputs");
  console.log("PASS shared contracts, trusted receipt semantics and explicit command inputs override display exclusions");

  const split = fixture("units-generation@module:shop", true);
  try {
    const splitScope = () => evidenceScopeForInstance(split.root, "workspace-detection");
    const legacyScope = () => legacyEvidenceScopeForInstance(split.root, "workspace-detection");
    assert.equal(splitScope().label, "inputs-v3:global"); assert.equal(legacyScope().label, "global");
    const before = readSourceRevision(split.root, splitScope()).scope_digest;
    const oldBefore = readSourceRevision(split.root, legacyScope()).scope_digest;
    write(split.root, "docs/aidlc/handoff.md", "Updated handoff view\n");
    assert.equal(readSourceRevision(split.root, splitScope()).scope_digest, before);
    assert.notEqual(readSourceRevision(split.root, legacyScope()).scope_digest, oldBefore, "legacy global evidence is checked with the original algorithm");
    const splitManifestPath = "docs/aidlc/ideation/module-manifest.json";
    const splitManifest = JSON.parse(readFileSync(join(split.root, splitManifestPath), "utf8"));
    splitManifest.modules[0].contract_paths.push("docs/aidlc/handoff.md"); write(split.root, splitManifestPath, splitManifest);
    assert.equal(splitScope().exclude("docs/aidlc/handoff.md"), false, "global scope also respects explicit contracts");
    assert.equal(splitScope().exclude("docs/aidlc/modules/shop/construction/api/code-review.md"), true, "split inception retains its existing downstream module boundary");
    assert.equal(splitScope().projectedInputs?.[`${split.base}/artifact-review.json`], undefined, "split inception gains no reverse dependency on module receipts");
  } finally { rmSync(split.root, { recursive: true, force: true }); }
  console.log("PASS versioned split-global scope preserves the legacy algorithm and existing inception boundary");

  for (const [message, category] of [
    ["[red-test-evidence] source_revision.scope_digest no longer matches", "phase-evidence-stale"],
    ["uc_mapping must cover UC-D-001", "mapping"], ["green-test-evidence Evidence not found", "test-missing"],
    ["tests_failed must be zero", "test-failed"], ["session binding generation mismatch", "permission-state"],
    ["SLICE_MANIFEST_STALE", "artifact-stale"], ["unrecognized provider result", "unknown"],
    ['Cannot complete stage "build-and-test" — automatic semantic evidence production failed for build-and-test (test-quality): Evidence producer blocked: built-in semantic checker test-quality failed: exit code 1; ation-temp\\completion-default\\.aidlc\\evidence\\tdd\\project\\default\\baseline-test-evidence.json. Run the controlled evidence producer first.', "test-missing"],
    ["built-in semantic checker test-quality failed: Evidence not found: .aidlc/evidence/tdd/project/default/red-test-evidence.json", "test-missing"],
    ["built-in semantic checker test-quality failed: green-test-evidence.json: source_revision.scope_digest no longer matches; uc_mapping unavailable", "phase-evidence-stale"],
    ["built-in semantic checker test-quality failed: GREEN tests_failed must be zero; uc_mapping cannot establish passing coverage", "test-failed"],
    ["built-in semantic checker test-quality failed: uc_mapping must cover UC-D-001", "mapping"],
    ["built-in semantic checker test-quality failed: exit code 1", "unknown"],
  ]) assert.equal(classifyRepair(message).category, category);
  assert.match(classifyRepair("[green-test-evidence] source_revision.scope_digest no longer matches").next_step, /current GREEN inputs changed, rerun only the affected allowlisted GREEN command once/);
  console.log("PASS repair classification distinguishes mapping, phase provenance, actual tests, state, slices and unknown failures");
} finally { rmSync(root, { recursive: true, force: true }); }
