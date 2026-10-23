import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { sourceDeletions } from "../core/tools/aidlc-source-deletions";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";

// MARS-273 S5: existing projects keep passing with legacy per-UC-D ucd_sources evidence
// (zero migration), and the same project also passes with the new file-level form.

const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars273-compat-"));
const caseFile = "docs/aidlc/modules/project/inception/application-design/test-cases/UC-D-001.md";
const indexFile = "docs/aidlc/modules/project/inception/application-design/test-cases/_index.md";
const i13Path = ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json";
const manifestPath = ".aidlc/evidence/code-generation/project/default/source-deletions.json";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function put(root: string, path: string, value: unknown): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
}

function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

let counter = 0;
function makeProject(): string {
  const root = join(scratch, `compat-${++counter}`);
  mkdirSync(root);
  put(root, ".gitignore", ".aidlc/\naidlc/\n");
  put(root, "src/legacy.route.cjs", "module.exports = 'legacy';\n");
  put(root, "docs/aidlc/ideation/module-manifest.json", { schema_version: 1, modules: [{ module_id: "project", name: "Routes", service_id: "svc", paths: ["src"] }] });
  put(root, "docs/aidlc/modules/project/inception/unit-manifest.json", { schema_version: 1, module_id: "project", units: [{ unit_id: "default", name: "Remove route", service_id: "svc", req_refs: ["REQ-1"], conditional_stages: [] }] });
  put(root, "docs/aidlc/modules/project/inception/requirements.md", "REQ-1: Given a router, When routes are discovered, Then the legacy route must no longer be exposed. Approved removal requested by product owner.\n");
  put(root, indexFile, "# Cases\nUC-D-001 status: ready source_ref: REQ-1\n");
  put(root, caseFile, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\nunit_refs: [default]\n---\n# Remove legacy route\nGiven the router When discovery runs Then legacy is absent. REQ-1\n");
  git(root, "init", "-q");
  git(root, "add", ".");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline");
  const state = createInitialState("express", "4.22.4", "mars273-compat", [], "legacy ucd_sources compatibility");
  state.baseline_commit = git(root, "rev-parse", "HEAD");
  state.baseline_source = "created";
  saveWorkflowState(root, state);
  assert.ok(loadWorkflowState(root));
  const entry = { path: "src/legacy.route.cjs", baseline_blob: git(root, "rev-parse", "HEAD:src/legacy.route.cjs"), req_refs: ["REQ-1"], ucd_id: "UC-D-001" };
  put(root, manifestPath, { schema_version: "1", module_id: "project", unit_id: "default", deletions: [entry] });
  rmSync(join(root, "src/legacy.route.cjs"));
  return root;
}

function legacyI13(root: string): Record<string, unknown> {
  return {
    status: "required",
    ucd_ids: ["UC-D-001"],
    ucd_units: { "UC-D-001": ["default"] },
    ucd_sources: { "UC-D-001": { file: caseFile, sha256: sha256(readFileSync(join(root, caseFile), "utf8")) } },
    test_case_files: [caseFile, indexFile],
  };
}

try {
  // 1. Legacy per-UC-D ucd_sources evidence passes the deletion reconciliation as-is.
  const legacyRoot = makeProject();
  put(legacyRoot, i13Path, legacyI13(legacyRoot));
  assert.equal(sourceDeletions(legacyRoot, "project", "default").length, 1);

  // 2. The same project with file-level ucd_sources passes identically.
  const fileRoot = makeProject();
  const legacy = legacyI13(fileRoot);
  put(fileRoot, i13Path, { ...legacy, ucd_sources: { files: [{ file: caseFile, sha256: sha256(readFileSync(join(fileRoot, caseFile), "utf8")), ucd_ids: ["UC-D-001"] }] } });
  assert.equal(sourceDeletions(fileRoot, "project", "default").length, 1);

  // 3. A UC-D source file drift (content change) still forces re-derivation under both forms.
  for (const [label, form] of [["legacy", 0], ["file-level", 1]] as const) {
    const root = makeProject();
    const legacyEvidence = legacyI13(root);
    const evidence = form === 0 ? legacyEvidence
      : { ...legacyEvidence, ucd_sources: { files: [{ file: caseFile, sha256: sha256(readFileSync(join(root, caseFile), "utf8")), ucd_ids: ["UC-D-001"] }] } };
    put(root, i13Path, evidence);
    put(root, caseFile, `${readFileSync(join(root, caseFile), "utf8")}\nsource drift\n`);
    assert.throws(() => sourceDeletions(root, "project", "default"), /source changed/, label);
  }

  // 4. A UC-D moved to another file (recorded file no longer matches) is rejected under both forms.
  for (const [label, form] of [["legacy", 0], ["file-level", 1]] as const) {
    const root = makeProject();
    const legacyEvidence = legacyI13(root);
    const evidence = form === 0 ? legacyEvidence
      : { ...legacyEvidence, ucd_sources: { files: [{ file: caseFile, sha256: sha256(readFileSync(join(root, caseFile), "utf8")), ucd_ids: ["UC-D-001"] }] } };
    put(root, i13Path, evidence);
    const content = readFileSync(join(root, caseFile), "utf8");
    rmSync(join(root, caseFile));
    put(root, "docs/aidlc/modules/project/inception/application-design/test-cases/UC-D-001-moved.md", content);
    // The moved file also changes test_case_files, so the inventory guard fires.
    assert.throws(() => sourceDeletions(root, "project", "default"), /source changed|no longer matches/, label);
  }

  console.log("MARS-273 legacy ucd_sources compatibility tests passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
