import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QualityFixture } from "./mars168_fixture";
import { generateSlices } from "../core/tools/aidlc-document-slices";
import { fixtureEnvironment } from "./mars243_fixture_session";

const f = new QualityFixture();
f.stage("cross-validation");
f.pass("artifact-consistency");
f.write(`${f.base}/unit-manifest.json`, JSON.stringify({ schema_version: 1, module_id: "shop", units: [
  { unit_id: "api", name: "Api", service_id: "shop", req_refs: ["REQ-001"] },
  { unit_id: "web", name: "Web", service_id: "shop", req_refs: ["REQ-001"] },
] }));
f.write(`${f.base}/application-design/unit-of-work-story-map.md`, '# Approved mapping\n```aidlc-story-map\n' + JSON.stringify({
  schema_version: 1, status: "approved", approved_by: "fixture-owner", mappings: [
    { story_id: "US-001", unit_ids: ["api", "web"] }, { story_id: "US-002", unit_ids: ["api", "web"] },
  ], shared_req_refs: ["REQ-001"],
}) + '\n```\n');
const previousBinding = process.env.AIDLC_SESSION_BINDING;
process.env.AIDLC_SESSION_BINDING = fixtureEnvironment(f.root, ["document-slices", "generate", "--module", "shop"]).AIDLC_SESSION_BINDING;
try { generateSlices({ ...f.ctx, slices_version: "1", units_executed: true }); }
finally { if (previousBinding === undefined) delete process.env.AIDLC_SESSION_BINDING; else process.env.AIDLC_SESSION_BINDING = previousBinding; }
f.syncArtifactReview();
f.pass("artifact-consistency");
const manifestPath = `${f.base}/document-slices/manifest.json`;
const manifestBytes = readFileSync(join(f.root, manifestPath), "utf8");
const evidence = JSON.parse(readFileSync(join(f.root, ".aidlc/evidence/cross-validation/shop/artifact-consistency.json"), "utf8"));
assert.ok(evidence.inputs.some((input: { path: string }) => input.path === manifestPath), "quality Evidence must bind the verified projection manifest");
const object = (evidence.inputs as Array<{ path: string }>).find(input => input.path.includes("/objects/") && readFileSync(join(f.root, input.path), "utf8").includes("FIELD-LABEL"))!.path;
const original = readFileSync(join(f.root, object), "utf8");
f.write(object, original + "\nFIELD-FORGED changed projection\n");
f.blocked("artifact-consistency", "SLICE_PROJECTION_DRIFT");
f.write(object, original);
f.write(manifestPath, manifestBytes.replace('"generator_version": "1"', '"generator_version": "forged"'));
f.blocked("artifact-consistency", "SLICE_MANIFEST_STALE");
f.write(manifestPath, manifestBytes);
f.write(`${f.base}/document-slices/objects/unregistered.md`, "FIELD-LABEL unrelated authority must still have a mapping\n");
f.syncArtifactReview();
f.blocked("artifact-consistency", "ARTIFACT_MAPPING_MISSING");
console.log("PASS quality + document slices: controlled producer/gate, canonical authority, manifest/input binding, tampered projection/manifest and unknown-object rejection");
