import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createAutonomyFixture } from "./helpers/autonomy-fixture";
import { autonomyDigest } from "../core/tools/aidlc-autonomy-files";
import { previewAutonomousAdmission } from "../core/tools/aidlc-autonomous-admission";
const scratch = mkdtempSync(join(tmpdir(), "aidlc-dependency-preflight-")), inherited = process.env.AIDLC_SESSION_BINDING;
try {
  for (const mode of ["single", "shared-input", "multiple-units"]) {
    const f = createAutonomyFixture(scratch, mode), path = "fixtures/admission.json", manifestPath = join(f.root, "docs/aidlc/modules/orders/inception/unit-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (mode === "shared-input") { manifest.units[0].evidence_inputs = { version: 1, paths: ["src"], depends_on_units: [], shared_paths: ["src/shared"] }; f.unitRef.definition_digest = autonomyDigest(manifest.units[0]); }
    if (mode === "multiple-units") { const second = { ...manifest.units[0], unit_id: "second", name: "Second" }; manifest.units.push(second); f.batch.units.push({ unit_ref: { ...f.unitRef, unit_id: "second", definition_digest: autonomyDigest(second) }, role: "implement", expected_capabilities: [] }); }
    writeFileSync(manifestPath, JSON.stringify(manifest)); mkdirSync(join(f.root, "fixtures"));
    const bytes = JSON.stringify({ schema: "aidlc.admission-plan/v1", batch_id: "publish", scope_revision: 1, lifetime_seconds: 300, reception: [], commands: [], validation_bindings: [], resources: [], environment_variables: [] });
    writeFileSync(join(f.root, path), bytes); f.batch.baseline_inputs.push({ repository_id: "project", path, digest_mode: "raw-file", digest: createHash("sha256").update(bytes).digest("hex") }); f.freeze();
    const r = previewAutonomousAdmission(f.root, path), dependency = r.checks.find((c: any) => c.check_id === "dependency-readiness");
    assert.equal(r.checks.find((c: any) => c.check_id === "scope-policy").status, "passed"); assert.equal(r.admission_result, "not-ready");
    assert.equal(dependency.status, mode === "single" ? "passed" : "failed"); if (mode !== "single") assert.match(dependency.reason, /unit-extension/);
    console.log(`PASS dependency preflight ${mode}: missing canonical unit definitions do not become ready`);
  }
} finally {
  if (inherited === undefined) delete process.env.AIDLC_SESSION_BINDING; else process.env.AIDLC_SESSION_BINDING = inherited;
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir())); assert.ok(scratch.startsWith(join(tmpdir(), "aidlc-dependency-preflight-"))); rmSync(scratch, { recursive: true, force: true });
}
