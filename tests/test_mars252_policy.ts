import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadGraph } from "../core/tools/aidlc-orchestrate";
import { deliveryConsistencyPayloadErrors } from "../core/tools/aidlc-evidence-policy";

const root=resolve(import.meta.dirname,".."), graph=loadGraph();
const read=(path:string)=>readFileSync(join(root,path),"utf8");
const files=(directory:string):string[]=>readdirSync(join(root,directory),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(`${directory}/${entry.name}`):[`${directory}/${entry.name}`]);
let notify=0;
for(const file of files("core/stages").filter(file=>file.endsWith(".md"))) {
  const text=read(file), slug=/^slug: (.+)$/m.exec(text)?.[1], stage=graph.stages.find(stage=>stage.slug===slug);
  if(stage?.approval!=="notify")continue;
  notify++;
  assert.doesNotMatch(text,/(?:在用户明确(?:审批|确认)前不得继续|等待明确审批)/,file);
}
for(const slug of ["application-design","operations-authorization"])assert.equal(graph.stages.find(stage=>stage.slug===slug)?.approval,"block");
for(const slug of ["reverse-engineering","requirements-analysis","functional-design","nfr-requirements","nfr-design"])assert.equal(graph.stages.find(stage=>stage.slug===slug)?.approval,"notify");
const requirements=read("core/stages/inception/inception-requirements-analysis.md");
assert.doesNotMatch(requirements,/✅\(3轮\)|✅\(5轮\+\)|任何维度(?:评分)?\s*<80%.*(?:触发|。)/);
assert.match(requirements,/提前结束/);assert.match(requirements,/已有或明确批准的项目量化阈值继续生效/);
assert.match(requirements,/不把全面深度专属检查扩展到标准\/最小深度/);
assert.match(requirements,/quality inventory|质量 inventory/);
assert.match(requirements,/每个需求都有验收标准/);
for(const file of ["core/stages/inception/inception-test-case-derivation.md","core/knowledge/protocols/test-case-derivation.md","core/skills/aidlc-test-case-derivation/SKILL.md","core/skills/aidlc-build-test-evidence/SKILL.md"]) {
  const text=read(file);assert.match(text,/reused_from/);assert.match(text,/observation_id/);assert.match(text,/基线世代漂移/);assert.match(text,/业务 RED\/GREEN 仍独立执行/);
}
console.log(`PASS ${notify} notify stage bodies, protected block gates, requirements depth/policy and I13 reuse reference chain`);

// A zero-exit checker can report measured failures with status=passed. Final
// delivery checks must enforce the same payload gate as normal stage completion.
const prd = { status: "passed", prd_path: "docs/aidlc/ideation/prd.md", required_sections: ["overview", "goals", "features", "non-goals", "questions", "sources"],
  functional_requirements: 2, acceptance_criteria_complete: true, non_goals_complete: true, pending_questions_indexed: true, source_index_complete: true,
  clarification_consistency: "passed", business_flow_validation: "not_applicable", unresolved_blockers: 0 };
assert.deepEqual(deliveryConsistencyPayloadErrors("prd-completeness", prd, {}), []);
for (const field of ["acceptance_criteria_complete", "non_goals_complete", "pending_questions_indexed", "source_index_complete"]) {
  assert(deliveryConsistencyPayloadErrors("prd-completeness", { ...prd, [field]: false }, {}).some(error => error.includes(field)), "status=passed cannot hide incomplete PRD criterion " + field);
}
assert(deliveryConsistencyPayloadErrors("prd-completeness", { ...prd, unresolved_blockers: 1 }, {}).some(error => error.includes("unresolved_blockers")));

const alignment = { status: "passed", design_mode: "html-mock", styles_aligned: true, conditional_visibility_aligned: true, platform_constraints_respected: true,
  unmapped_elements: 0, extra_elements: 0, pages_checked: 1, elements_checked: 2, pages_covered: ["PAGE-001"] };
const selectedUi = { ui_route: "html-mock" };
assert.deepEqual(deliveryConsistencyPayloadErrors("ui-design-alignment", alignment, selectedUi), []);
for (const field of ["styles_aligned", "conditional_visibility_aligned", "platform_constraints_respected"]) {
  assert(deliveryConsistencyPayloadErrors("ui-design-alignment", { ...alignment, [field]: false }, selectedUi).some(error => error.includes(field)), "status=passed cannot hide failed UI criterion " + field);
}
for (const field of ["unmapped_elements", "extra_elements"]) {
  assert(deliveryConsistencyPayloadErrors("ui-design-alignment", { ...alignment, [field]: 1 }, selectedUi).some(error => error.includes(field)), "status=passed cannot hide measured UI divergence " + field);
}
assert(deliveryConsistencyPayloadErrors("ui-design-alignment", { ...alignment, pages_covered: [] }, selectedUi).some(error => error.includes("pages_covered")));
assert.deepEqual(deliveryConsistencyPayloadErrors("ui-design-alignment", { status: "not_applicable", reason: "Current unit explicitly declares no UI pages ([ui: n/a])" }, selectedUi), [], "the existing explicit no-UI exception remains valid");
assert(deliveryConsistencyPayloadErrors("ui-design-alignment", { status: "not_applicable" }, selectedUi).some(error => error.includes("reason")));
assert.deepEqual(deliveryConsistencyPayloadErrors("ui-design-alignment", { status: "not_applicable" }, { ui_route: "skip" }), []);

const inception = { status: "passed", module_id: "project", requirements_checked: 1, stories_checked: 1, prd_selected: false, prd_items_checked: 0,
  ui_route: "skip", ui_pages_checked: 0, unresolved_conflicts: 0, ui_freshness_verified: false, ui_full_acceptance_runs: 0,
  artifacts_checked: ["requirements.md", "user-stories.md", "cross-validation-report.md"] };
const skippedUi = { module_id: "project", prd_selected: false, ui_route: "skip" };
assert.deepEqual(deliveryConsistencyPayloadErrors("inception-consistency", inception, skippedUi), []);
for (const [field, value] of [["module_id", "foreign"], ["requirements_checked", 0], ["stories_checked", 0], ["unresolved_conflicts", 1], ["prd_selected", true], ["ui_route", "html-mock"]] as const) {
  assert(deliveryConsistencyPayloadErrors("inception-consistency", { ...inception, [field]: value }, skippedUi).some(error => error.includes(field)), "I10 current payload retains " + field + " protection");
}
const withUi = { ...inception, ui_route: "html-mock", ui_pages_checked: 1, ui_freshness_verified: true, ui_full_acceptance_runs: 1,
  ui_generation_lock_digest: "a".repeat(64), ui_generation_acceptance_digest: "b".repeat(64), ui_upstream_ref: "origin/main",
  ui_baseline_upstream_commit: "c".repeat(40), ui_current_upstream_commit: "d".repeat(40), ui_changed_paths: [], ui_affected_pages: [],
  ui_impact_unmapped: 0, ui_targeted_reverification_runs: 0, artifacts_checked: [...inception.artifacts_checked, "page-plan.md", "ui-generation-acceptance.json"] };
const withUiContext = { ...skippedUi, ui_route: "html-mock" };
assert.deepEqual(deliveryConsistencyPayloadErrors("inception-consistency", withUi, withUiContext), []);
for (const [field, value] of [["ui_freshness_verified", false], ["ui_generation_lock_digest", "invalid"], ["ui_generation_acceptance_digest", "invalid"], ["ui_full_acceptance_runs", 2], ["ui_impact_unmapped", 1]] as const) {
  assert(deliveryConsistencyPayloadErrors("inception-consistency", { ...withUi, [field]: value }, withUiContext).some(error => error.includes(field)), "I10 selected UI retains " + field + " protection");
}
console.log("PASS shared delivery payload gates reject real measured PRD/UI/I10 failures despite status=passed and preserve explicit not-applicable cases");
