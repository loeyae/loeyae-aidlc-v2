import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { i13SourceDefinitions, indexedTestMappings } from "../core/tools/aidlc-ucd-mapping";
import { normalizeUcdSources } from "../core/tools/aidlc-ucd-declarations";

const repository = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || tmpdir(), "aidlc-team-mapping-"));
let sequence = 0;
function fixture(options: { requirements?: string; design?: string; body?: string; deprecated?: boolean; blocked?: boolean; units?: unknown[]; oldI13?: boolean } = {}) {
  const root = join(scratch, String(++sequence));
  const put = (path: string, value: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  const inception = "docs/aidlc/modules/project/inception";
  put(`${inception}/requirements.md`, options.requirements ?? "# Requirements\nREQ-1: Given a user When exporting Then an export file is returned.\n");
  if (options.design) put(`${inception}/application-design.md`, options.design);
  const cases = `${inception}/application-design/test-cases`;
  put(`${cases}/_index.md`, "```yaml\nsource_coverage:\n  REQ-1: [UC-D-001]\n" + (options.deprecated ? "  REQ-OLD: [UC-D-999]\n" : "") + "```\nUC-D-001\n" + (options.deprecated ? "UC-D-999 historical case\n" : ""));
  put(`${cases}/UC-D-001.md`, `---\nid: UC-D-001\nstatus: ${options.blocked ? "blocked\nblocked_kind: business-unknown" : "ready"}\nsource_ref: REQ-1\n---\n${options.body ?? "Given a user When exporting Then a file is returned."}\n`);
  if (options.deprecated) put(`${cases}/UC-D-999.md`, "---\nid: UC-D-999\nstatus: deprecated\nsource_ref: REQ-OLD\n---\nPrior behavior retained for audit.\n");
  if (options.units) put(`${inception}/unit-manifest.json`, { schema_version: 1, module_id: "project", units: options.units });
  if (options.oldI13) put(".aidlc/evidence/test-case-derivation/project/test-case-derivation.json", { status: "required", ucd_ids: ["UC-D-001"] });
  const state = createInitialState("express", "4.23.3", undefined, [], "team mapping regression");
  Object.assign(state, { current_stage: "test-case-derivation", current_phase: "inception", current_module: "project", current_stage_instance: "test-case-derivation@module:project" });
  saveWorkflowState(root, state);
  return { root, put };
}
function check(root: string, fresh = false) {
  const result = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "bin/cli.ts"), "check", "--sensor", "test-case-derivation", "--module", "project"], {
    cwd: root, encoding: "utf8", env: { ...process.env, AIDLC_I13_DERIVATION_MODE: fresh ? "fresh" : "" },
  });
  return { status: result.status, output: result.stdout + result.stderr, payload: result.status === 0 ? JSON.parse(result.stdout) : undefined };
}
const failures: string[] = [];
function scenario(name: string, run: () => void) { try { run(); console.log(`PASS ${name}`); } catch (error) { failures.push(`${name}: ${String(error)}`); console.error(`FAIL ${name}: ${String(error)}`); } }

scenario("incidental historical reference does not create a mapping obligation", () => {
  const result = check(fixture({ design: "# Design\nHistorical reference to REQ-ARCHIVE from a retired module.\n" }).root);
  assert.equal(result.status, 0, result.output);
});
scenario("ready business outcome may contain blocked", () => {
  const result = check(fixture({ body: "Given a blocked account When exporting Then its business status remains blocked." }).root);
  assert.equal(result.status, 0, result.output);
});
scenario("deprecated declarations remain auditable without entering active coverage", () => {
  const result = check(fixture({ deprecated: true }).root);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.payload.ucd_ids, ["UC-D-001"]);
  assert.deepEqual(result.payload.deprecated_ucd_ids, ["UC-D-999"]);
  const stillRequired = check(fixture({ deprecated: true, requirements: "REQ-1: Given a user When exporting Then a file is returned.\nREQ-OLD: Given an export When interrupted Then resume its transfer.\n" }).root);
  assert.notEqual(stillRequired.status, 0); assert.match(stillRequired.output, /uncovered: REQ-OLD/);
});
scenario("true missing definition and real blocked state remain blocking", () => {
  const missing = check(fixture({ requirements: "REQ-1: Given a user When exporting Then a file is returned.\nREQ-2: Given an unauthorized user When exporting Then access is rejected.\n" }).root);
  assert.notEqual(missing.status, 0, missing.output); assert.match(missing.output, /uncovered: REQ-2/);
  const blocked = check(fixture({ blocked: true }).root);
  assert.notEqual(blocked.status, 0); assert.match(blocked.output, /UC-D-001 \(business-unknown\)/);
});
scenario("out of scope prose cannot suppress a real source definition", () => {
  const result = check(fixture({ design: "## REQ-2 export retries\nOUT OF SCOPE, do not test this.\n" }).root);
  assert.notEqual(result.status, 0); assert.match(result.output, /uncovered: REQ-2/);
});
scenario("unknown sources and forged aggregates stay rejected", () => {
  const project = fixture();
  project.put("docs/aidlc/modules/project/inception/application-design/test-cases/_index.md", "```yaml\nsource_coverage:\n  REQ-404: [UC-D-001]\n```\n");
  const result = check(project.root); assert.notEqual(result.status, 0); assert.match(result.output, /DANGLING_REF/);
});
scenario("definition parsing covers legacy forms and rejects ambiguous mixed headings", () => {
  assert.deepEqual(i13SourceDefinitions([{ path: "requirements.md", content: "## REQ-1 export\nREQ-2 retry\n| REQ-3 | audit |\nReference to REQ-OLD.\n```\nREQ-EXAMPLE\n```\n" }]), ["REQ-1", "REQ-2", "REQ-3"]);
  assert.throws(() => i13SourceDefinitions([{ path: "requirements.md", content: "## REQ-1 export\n## Requirement REQ-2 retry\n" }]), /I13_SOURCE_FORMAT.*ambiguous/);
  assert.throws(() => i13SourceDefinitions([{ path: "requirements.md", content: "Export requirement REQ-1 is defined only in prose.\n" }]), /I13_SOURCE_FORMAT/);
  assert.deepEqual(i13SourceDefinitions([{ path: "requirements.md", content: "## REQ-1 export\n\n| Priority | ID | Behavior |\n| --- | --- | --- |\n| P0 | REQ-2 | Retry |\n" }]), ["REQ-1", "REQ-2"]);
  assert.throws(() => i13SourceDefinitions([{ path: "requirements.md", content: "## REQ-1 export\n\n| P0 | REQ-2 | Retry |\n" }]), /I13_SOURCE_FORMAT.*table/);
});
scenario("legacy annotation indexing reads each file once regardless of UC-D count", () => {
  const files = Array.from({ length: 40 }, (_, index) => `tests/${index}.test.ts`);
  let reads = 0;
  const mapping = indexedTestMappings(files, () => { reads++; return Array.from({ length: 100 }, (_, index) => `UC-D-${index + 1}`).join(" "); });
  assert.equal(reads, files.length); assert.equal(mapping.size, 100);
  assert.equal(mapping.get("UC-D-100")?.length, 40);
});
scenario("producer file-keyed UC-D digests normalize with legacy and file-list forms", () => {
  const sha256 = "a".repeat(64), file = "docs/cases/UC-D-001.md";
  const expected = normalizeUcdSources({ files: [{ file, sha256, ucd_ids: ["UC-D-001"] }] });
  assert.deepEqual(normalizeUcdSources({ [file.replaceAll("/", "\\")]: { sha256, ucd_ids: ["UC-D-001"] } }), expected);
  assert.deepEqual(normalizeUcdSources({ "UC-D-001": { file, sha256 } }), expected);
  assert.throws(() => normalizeUcdSources({ [file]: { sha256: "invalid", ucd_ids: ["UC-D-001"] } }), /sha256/);
});
const units = [{ unit_id: "u1", name: "Export", service_id: "app", req_refs: ["REQ-1"] }, { unit_id: "u2", name: "Audit", service_id: "app", req_refs: ["REQ-2"] }];
scenario("unique approved requirement ownership avoids module-wide unit mappings", () => {
  const result = check(fixture({ units }).root);
  assert.equal(result.status, 0, result.output); assert.deepEqual(result.payload.ucd_units, { "UC-D-001": ["u1"] });
  assert.equal(result.payload.unit_scope_source, "manifest_req_refs");
});
scenario("ambiguous new multiunit ownership is an I13 prerequisite", () => {
  const result = check(fixture({ units: units.map(unit => ({ ...unit, req_refs: ["REQ-1"] })) }).root);
  assert.notEqual(result.status, 0); assert.match(result.output, /UC-D-001.*unit_refs/);
});
scenario("published legacy I13 keeps its scope until explicit fresh derivation", () => {
  const project = fixture({ units, oldI13: true });
  const prior = check(project.root); assert.equal(prior.status, 0, prior.output); assert.equal(prior.payload.ucd_units, undefined);
  const fresh = check(project.root, true); assert.equal(fresh.status, 0, fresh.output); assert.deepEqual(fresh.payload.ucd_units, { "UC-D-001": ["u1"] });
  project.put(".aidlc/evidence/test-case-derivation/project/test-case-derivation.json", fresh.payload);
  const repeated = check(project.root); assert.equal(repeated.status, 0, repeated.output); assert.deepEqual(repeated.payload.ucd_units, fresh.payload.ucd_units);
});
assert.equal(failures.length, 0, failures.join("\n"));
console.log(`PASS team mapping regression (${sequence} isolated fixture projects; ${scratch})`);
