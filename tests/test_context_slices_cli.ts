import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fixture, write, cli, snapshot } from "./mars244_fixture";
import { generateSlices } from "./mars244_fixture_writers";
import { buildBusinessDocumentLoadPlan, checkSlices } from "../core/tools/aidlc-document-slices";
import K from "../harness/codex/runtime/host-kernel.cjs";

const f = fixture();
try {
  f.units.forEach(unit => unit.req_refs = ["REQ-001", "REQ-002"]);
  write(f.root, `${f.base}/unit-manifest.json`, { schema_version: 1, module_id: "shop", units: f.units });
  write(f.root, `${f.base}/application-design/unit-of-work-story-map.md`, '```aidlc-story-map\n'+JSON.stringify({ schema_version: 1, status: "approved", approved_by: "fixture", mappings: [
    { story_id: "US-001", unit_ids: ["api", "web"] }, { story_id: "US-002", unit_ids: ["api", "web"] },
  ], shared_req_refs: [] })+'\n```\n');
  const ctx = { root: f.root, workflow_id: f.state.workflow_id, module_id: "shop", scope: "feature", stage: "units-generation", ui_route: "not-selected", slices_version: "1", units_executed: true };
  generateSlices(ctx);
  const manifestPath = `${f.base}/document-slices/manifest.json`, manifest = readFileSync(join(f.root, manifestPath), "utf8");
  write(f.root, `${f.base}/document-slices/objects/unreferenced-history.md`, "must not load or validate this historical file");
  const before = snapshot(f.root), plan = buildBusinessDocumentLoadPlan(ctx, "api");
  assert.equal(plan.mode, "derived");
  assert.deepEqual(plan.reading?.coverage, { requirements: 2, stories: 2, acs: 2 });
  assert(plan.reading?.files.some(f => f.role === "inherited" && !f.empty));
  assert(!plan.files.some(f => f.path.endsWith("unreferenced-history.md")));
  assert.equal(plan.reading?.files.reduce((n, f) => n + f.bytes, 0), plan.bytes);
  assert.equal(readFileSync(join(f.root, manifestPath), "utf8"), manifest, "reading improvements do not regenerate or invalidate the slice manifest");
  assert.deepEqual(snapshot(f.root), before);
  const inherited = plan.reading!.files.find(f => f.role === "inherited" && !f.empty)!;
  const original = readFileSync(join(f.root, inherited.path), "utf8");
  write(f.root, inherited.path, "damaged inherited input"); assert.throws(() => checkSlices(ctx), /SLICE_PROJECTION_DRIFT/);
  write(f.root, inherited.path, original);
  f.units[0].req_refs = ["REQ-001"]; write(f.root, `${f.base}/unit-manifest.json`, { schema_version: 1, module_id: "shop", units: f.units });
  assert.throws(() => buildBusinessDocumentLoadPlan(ctx, "api"), /SLICE_REQ_RECONCILIATION/);
  f.units[0].req_refs = ["REQ-001", "REQ-002"]; write(f.root, `${f.base}/unit-manifest.json`, { schema_version: 1, module_id: "shop", units: f.units });
  const stable = snapshot(f.root);
  for (const args of [
    ["orchestrate", "state", "context", "--module", "shop", "--unit", "api"],
    ["orchestrate", "state", "artifact", "--path", inherited.path, "--limit", "50"],
    ["orchestrate", "state", "artifact", "--path", manifestPath],
  ]) {
    const result = cli(f.root, args, ""); assert.equal(result.status, 0, result.stdout + result.stderr);
    const value = JSON.parse(result.stdout); assert.equal(value.kind, "print");
    const descriptor = K.describeAction({ action: "core", args }, { commands: [] }, { mode: "repair-diagnosis" });
    assert.equal(descriptor.needs_window, false); assert.equal(descriptor.core.inspect, true);
  }
  const denied = cli(f.root, ["orchestrate", "state", "context", "--module", "shop", "--user-input", "Approve"], "");
  assert.notEqual(denied.status, 0);
  assert.throws(() => K.describeAction({ action: "core", args: ["orchestrate", "state", "recover"] }, { commands: [] }), /DENIED/);
  assert.deepEqual(snapshot(f.root), stable, "public CLI views remain read-only without session binding");
  console.log("PASS inherited coverage, manifest compatibility, original drift/mapping checks, public CLI and host read-only dispatch");
} finally { rmSync(f.root, { recursive: true, force: true }); }
