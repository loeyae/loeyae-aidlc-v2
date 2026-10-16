import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QualityFixture } from "./mars168_fixture";
import type { Region, UiAction } from "../core/tools/aidlc-quality-ui";
const f = new QualityFixture(); f.prepareUi();
const sensor = "ui-behavior-consistency"; f.pass(sensor);
const htmlPath = `${f.base}/ui-mock/page.html`; const html = readFileSync(join(f.root, htmlPath), "utf8");
f.write(htmlPath, html.replace('<h1>Publish</h1>', '<div><span></div>')); f.syncUi(); f.blocked(sensor, "HTML_STATIC_ERROR");
f.write(htmlPath, html.replace('</section>', '<p id="result">Duplicate</p></section>')); f.syncUi(); f.blocked(sensor, "HTML_DOM_CONTRACT_ERROR");
f.write(htmlPath, html.replace('data-region="publish"', 'data-region="missing"')); f.syncUi(); f.blocked(sensor, "UI_REGION_UNTRACED");
f.write(htmlPath, html.replace('<section ', '<main ').replace('</section>', '</main>')); f.syncUi(); f.blocked(sensor, "UI_ROOT_ONLY_TRACE");
f.write(htmlPath, html.replace('data-ac="AC-001"', 'data-ac="AC-999"')); f.syncUi(); f.blocked(sensor, "UI_TRACE_TARGET_MISSING");
f.write(htmlPath, html.replace('data-ac="AC-001"', 'data-ac="AC-002"')); f.syncUi(); f.blocked(sensor, "UI_AC_STORY_MISMATCH");
f.write(htmlPath, html); const region = (f.plan.regions as Region[])[0]; const action = (f.plan.actions as UiAction[])[0];
region.states.pop(); f.syncUi(); f.blocked(sensor, "UI_STATE_BRANCH_MISSING");
region.states.push({ condition: "draft", behavior: "disabled", source: "AC-002" });
delete action.failure; f.syncUi(); f.blocked(sensor, "UI_FEEDBACK_MISSING");
action.failure = "retry"; action.target = "absent"; f.syncUi(); f.blocked(sensor, "UI_ACTION_TARGET_MISSING");
action.target = "result"; action.result_entry = "absent"; f.syncUi(); f.blocked(sensor, "UI_FEEDBACK_MISSING");
action.result_entry = "result"; f.syncUi(); f.pass(sensor);
(f.plan.regions as Region[]).push({ id: "old-button", page_id: "PAGE-001", change: "removed", stories: ["US-002"], acs: ["AC-002"], required_states: [], states: [] });
f.syncUi(); f.review("ui", ["publish", "old-button"], [`${f.base}/ui-design/page-plan.md`, `${f.base}/user-stories.md`, `${f.base}/requirements.md`, ...(f.req.inputs as string[]), `${f.base}/ui-mock/ui-mock-manifest.json`, htmlPath]); f.pass(sensor);
for (const route of ["figma-create", "figma-existing"]) {
  const figma = new QualityFixture(); figma.prepareUi(route);
  // Hand-authored snapshots cannot stand in for a managed remote acquisition.
  figma.blocked(sensor, route === "figma-create" ? "UI_WRITE_REGISTRATION_REQUIRED" : "UI_READ_REGISTRATION_REQUIRED");
}
const planning = new QualityFixture(); planning.prepareUi(); planning.stage("ui-page-planning", "html-mock"); planning.syncUi(); planning.pass(sensor);
console.log("PASS MARS-168 phase 3 UI: local validator, DOM regions/AC ownership, states, actions, removals, Figma and planning real gates");
