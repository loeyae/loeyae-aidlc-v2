import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { saveWorkflowState } from "../core/tools/aidlc-light-state";
import { QualityFixture } from "./mars168_fixture";
function prepare(f: QualityFixture, route = "skip") {
  f.stage("requirements-analysis"); f.pass("quality-change-impact"); f.pass("dependency-readiness"); f.pass("field-capability");
  f.stage("user-stories"); f.pass("story-rule-consistency");
  f.write(`${f.base}/development-handoff.md`, "REQ-001 migration localized labels; OMS full replacement; defaults none; regression ready/draft boundaries.");
  f.delivery = { version: "1", delivery_scope: "release-a", inputs: [], package: ["requirements.md", "user-stories.md", "development-handoff.md"].map(path => ({ path: `${f.base}/${path}`, kind: "canonical" })), pending_items: [], decisions: [] };
  f.section("cross-validation-report", f.delivery); f.stage("cross-validation", route);
  f.syncArtifactReview(); f.pass("artifact-consistency");
}
const f = new QualityFixture(); prepare(f); f.pass("delivery-readiness");
f.delivery.pending_items = [{ id: "CL-OPEN", blocking: true, status: "pending", reason: "OMS source unresolved" }]; f.section("cross-validation-report", f.delivery); f.blocked("delivery-readiness", "DELIVERY_BLOCKER_OPEN");
f.delivery.pending_items = []; (f.delivery.package as unknown[]).pop(); f.section("cross-validation-report", f.delivery); f.blocked("delivery-readiness", "DELIVERY_PACKAGE_INCOMPLETE");
(f.delivery.package as unknown[]).push({ path: `${f.base}/development-handoff.md`, kind: "handoff" }); f.section("cross-validation-report", f.delivery); f.syncArtifactReview(); f.pass("artifact-consistency"); f.pass("delivery-readiness");
const depPath = `.aidlc/evidence/requirements-analysis/shop/dependency-readiness.json`; const evidence = readFileSync(join(f.root, depPath), "utf8");
f.write(depPath, JSON.stringify({ ...JSON.parse(evidence), timestamp: "2000-01-01T00:00:00Z" })); f.blocked("delivery-readiness", "GATE_EVIDENCE_STALE");
f.write(depPath, evidence); f.pass("delivery-readiness");
f.write(`${f.base}/source.md`, "REQ-001 OMS changed to incremental delivery"); f.blocked("delivery-readiness", "DELIVERY_GATE_NOT_READY");
for (const route of ["skip", "not-selected"]) { const other = new QualityFixture(); prepare(other, route); other.pass("delivery-readiness"); }
// Actual report must reject resumed development without product readiness, before writing state.
const blocked = new QualityFixture();
blocked.state.current_stage = "functional-design"; blocked.state.current_stage_instance = "functional-design@module:shop@unit:default"; blocked.state.current_unit = "default";
saveWorkflowState(blocked.root, blocked.state);
const before = readFileSync(join(blocked.root, "aidlc/active/aidlc-state.md"), "utf8");
const result = blocked.run("bin/cli.ts", ["orchestrate", "report", "--stage", "functional-design", "--module", "shop", "--unit", "default", "--result", "completed"]);
assert.notEqual(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout + result.stderr, /DEVELOPMENT_ENTRY_NOT_READY/);
assert.equal(readFileSync(join(blocked.root, "aidlc/active/aidlc-state.md"), "utf8"), before);
console.log("PASS MARS-168 phase 3 delivery: aggregation, no-UI/skip, blockers/packages/freshness and real transactional development report");
