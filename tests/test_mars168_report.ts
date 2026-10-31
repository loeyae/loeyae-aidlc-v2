import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QualityFixture } from "./mars168_fixture";
import type { Dependency, Field } from "../core/tools/aidlc-quality-checks";
import { saveFixtureState } from "./mars243_fixture_session";
function report(f: QualityFixture) {
  f.write("docs/aidlc/ideation/scenario-module-mapping.md", "REQ-001 source and consumers map to shop, with SKU localized product labels.");
  f.state.completed_stages.push("scenario-module-mapping"); f.state.completed_stage_instances.push("scenario-module-mapping");
  if (f.ctx.stage === "user-stories") { f.state.completed_stages.push("requirements-analysis"); f.state.completed_stage_instances.push("requirements-analysis@module:shop"); }
  saveFixtureState(f.root, f.state);
  f.run("bin/cli.ts", ["evidence", "run", "--stage", f.ctx.stage, "--module", "shop", "--all-sensors"]);
  return f.run("bin/cli.ts", ["orchestrate", "report", "--stage", f.ctx.stage, "--module", "shop", "--result", "completed"]);
}
const good = new QualityFixture(); const passed = report(good); assert.equal(passed.status, 0, passed.stdout + passed.stderr);
assert.match(readFileSync(join(good.root, "aidlc/active/aidlc-state.md"), "utf8"), /requirements-analysis@module:shop/);
const dependency = new QualityFixture(); (dependency.req.dependencies as Dependency[])[0].status = "pending"; dependency.sync();
const dep = report(dependency); assert.notEqual(dep.status, 0); assert.match(dep.stdout + dep.stderr, /dependency-readiness|DEPENDENCY_UNCONFIRMED/);
const field = new QualityFixture(); (field.req.fields as Field[])[0].verified_capabilities = ["storage"]; field.sync();
const capability = report(field); assert.notEqual(capability.status, 0); assert.match(capability.stdout + capability.stderr, /field-capability|FIELD_CAPABILITY_UNVERIFIED/);
const story = new QualityFixture(); story.stage("user-stories"); (story.stories.rules as Array<{ ui_reachable: boolean }>)[0].ui_reachable = false; story.sync();
const rules = report(story); assert.notEqual(rules.status, 0); assert.match(rules.stdout + rules.stderr, /story-rule-consistency|UI_PATH_UNREACHABLE/);
console.log("PASS MARS-168 real report: legal requirements completion and dependency/field/rule blocked completion");
