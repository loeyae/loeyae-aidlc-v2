import assert from "node:assert/strict";
import { QualityFixture } from "./mars168_fixture";
import { qualityMetrics } from "../core/tools/aidlc-quality-metrics";
import { qualityLineageRoot } from "../core/tools/aidlc-quality-gates";
const f = new QualityFixture();
const empty = qualityMetrics(f.ctx); assert.equal(empty.html_errors, null); assert.equal(empty.unique_return_defects, null);
f.req.inventory = { dependencies: [], fields: [], rules: [] }; f.req.dependencies = []; f.req.fields = []; f.stories.rules = []; f.sync();
f.stage("user-stories"); f.pass("story-rule-consistency");
const before = f.run("tests/mars168_artifact_paths.ts", []).stdout;
const events = { deliveries: [{ id: "DELIVERY-1", timestamp: "2026-10-14T00:00:00Z" }], defects: [
  { id: "BUG-1", delivery_id: "DELIVERY-1", primary_cause: "semantic-error", secondary_causes: ["synchronization-omission"], first_detectable_stage: "user-stories" },
  { id: "BUG-1", delivery_id: "DELIVERY-1", primary_cause: "semantic-error", secondary_causes: [], first_detectable_stage: "user-stories" },
  { id: "BUG-2", delivery_id: "DELIVERY-1", primary_cause: "external-fact-change", secondary_causes: [], first_detectable_stage: "requirements-analysis", external_fact: { confirmed_at: "2026-10-14", version: "2" } },
] };
f.write(`${qualityLineageRoot(f.ctx)}/quality-events.json`, JSON.stringify(events));
const metrics = qualityMetrics(f.ctx);
assert.equal(metrics.unique_return_defects, 2); assert.equal((metrics.return_causes as Record<string, number>)["semantic-error"], 1);
assert.equal((metrics.high_risk_rule_coverage as Record<string, unknown>).status, "not_applicable");
assert.equal((metrics.external_change_share as Record<string, unknown>).ratio, 0.5);
const cli = f.run("bin/cli.ts", ["quality", "metrics", "--module", "shop"]); assert.equal(cli.status, 0, cli.stderr);
assert.equal(JSON.parse(cli.stdout).unique_return_defects, 2);
assert.equal(f.run("tests/mars168_artifact_paths.ts", []).stdout, before, "metrics must not write product files");
console.log("PASS MARS-168 phase 5: read-only CLI metrics, unknowns, zero denominators and deduplicated return defects");
