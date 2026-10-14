import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";
import { qualityHash, type QualityContext } from "../core/tools/aidlc-quality-gates";
import type { Dependency, Field, Rule } from "../core/tools/aidlc-quality-checks";

export const repository = resolve(import.meta.dirname, "..");
export class QualityFixture {
  root = mkdtempSync(join(tmpdir(), "mars168-quality-"));
  base = "docs/aidlc/modules/shop/inception";
  state: WorkflowState = createInitialState("feature", undefined, undefined, [], "MARS-168 faithful quality fixtures");
  ctx: QualityContext;
  req: Record<string, unknown>;
  stories: Record<string, unknown>;
  plan: Record<string, unknown> = {};
  delivery: Record<string, unknown> = {};
  constructor() {
    this.state.quality_gates_version = "1"; this.state.completed_stages = ["module-division"]; this.state.completed_stage_instances = ["module-division"];
    this.state.current_module = "shop";
    this.ctx = { root: this.root, workflow_id: this.state.workflow_id, module_id: "shop", scope: "feature", stage: "requirements-analysis", ui_route: "not-selected", quality_version: "1" };
    this.write("docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [{ module_id: "shop", name: "Shop", service_id: "shop", paths: ["src"] }] }));
    this.write(`${this.base}/source.md`, "REQ-001 BOM version 1, SKU full replacement, deleted IDs explicit. Product owner confirmed.");
    this.write(`${this.base}/prototype.txt`, "Fixture execution: bilingual labels and values round trip; lookup latency 3ms <= 10ms. Exit 0.");
    this.write(`${this.base}/performance.json`, JSON.stringify({ command: "fixture prototype", exit_code: 0, measured: 3, unit: "ms" }));
    const dependency: Dependency = { id: "DEP-BOM", critical: true, in_scope: true, granularity: "SKU", mode: "full", deletion: "explicit IDs", default_value: "none", source: `${this.base}/source.md`, source_version: "1", owner: "OMS", confirmed_by: "product-owner", status: "confirmed", consumers: ["REQ-001"], baseline_source_sha256: this.hash(`${this.base}/source.md`), product_source: `${this.base}/source.md`, technical_validation: `${this.base}/prototype.txt` };
    const field: Field = { id: "FIELD-LABEL", applies: "new", granularity: "SKU", plan: "new localized label table", capability: "planned", required_capabilities: ["storage", "dto", "conversion", "query", "index", "import", "export", "i18n-name", "i18n-value", "i18n-enum", "consumer-web"], verified_capabilities: ["storage", "dto", "conversion", "query", "index", "import", "export", "i18n-name", "i18n-value", "i18n-enum", "consumer-web"], evidence: [`${this.base}/prototype.txt`], adaptation_plan: "add localized DTO consumer and migration", performance_required: true, performance: { path: `${this.base}/prototype.txt`, threshold: 10, measured: 3, unit: "ms", command: "fixture prototype", exit_code: 0 } };
    const rule: Rule = { id: "RULE-001", condition: "ready", action: "publish", effect: "published", channel: "ui", ui_reachable: true, visibility: "show", failure_required: true, failure: "show retry feedback", examples: [{ id: "EX-1", input: "ready", expected: "published", boundary: "draft rejected by API" }] };
    this.req = { version: "1", delivery_scope: "release-a", inputs: [`${this.base}/source.md`, `${this.base}/prototype.txt`], inventory: { dependencies: [dependency.id], fields: [field.id], rules: [rule.id] }, dependencies: [dependency], fields: [field], dependency_review: `${this.base}/dependency-review.json`, field_review: `${this.base}/field-review.json`, artifacts: [], changes: [] };
    this.stories = { version: "1", delivery_scope: "release-a", inputs: [], rules: [rule], rule_review: `${this.base}/rule-review.json` };
    this.req.field_contracts = [{ id: "FIELD-LABEL", granularity: "SKU", definition: "localized product label", aliases: [] }];
    this.req.decision_contracts = [];
    this.req.artifact_mappings = [{ path: `${this.base}/requirements.md`, field_uses: [{ id: "FIELD-LABEL", granularity: "SKU", definition: "localized product label" }], decision_uses: [], depends_on: [] }];
    this.req.artifact_review = `${this.base}/artifact-review.json`;
    field.performance!.path = `${this.base}/performance.json`;
    (this.req.inputs as string[]).push(`${this.base}/performance.json`);
    this.sync(); this.stage("requirements-analysis");
    this.git(["init", "-q"]); this.git(["add", "."]); this.git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]);
  }
  write(path: string, body: string) { mkdirSync(resolve(this.root, path, ".."), { recursive: true }); writeFileSync(join(this.root, path), body, "utf8"); }
  hash(path: string) { return qualityHash(readFileSync(join(this.root, path))); }
  section(name: string, value: Record<string, unknown>) { this.write(`${this.base}/${name}.md`, `# REQ-001 US-001 AC-001 quality fixture\n\n` + (name === "cross-validation-report" ? `## Machine consistency summary\n- status: passed\n- unresolved_conflicts: 0\n- prd_route: not-selected\n- ui_route: ${this.ctx.ui_route}\n- checked_ids: REQ-001 US-001 US-002 AC-001 AC-002\n` : "") + (name === "user-stories" ? "## US-001 Publish ready products\nSource REQ-001. Ready products may publish.\n### AC-001 Successful publication\nReady products become published and show success; failure retains retry.\n## US-002 Defensive validation\nSource REQ-001. API rejects draft requests.\n### AC-002 Draft rejected\nUI cannot select draft; API rejects forced draft requests.\n" : "") + '```aidlc-quality\n' + JSON.stringify(value) + '\n```\n'); }
  review(kind: string, ids: string[], paths: string[], findings: unknown[] = []) {
    this.write(`${this.base}/${kind}-review.json`, JSON.stringify({ version: "1", workflow_id: this.state.workflow_id, module_id: "shop", delivery_scope: "release-a", reviewer: "fixture-independent-reviewer", kind, inputs: [...new Set(paths)].map(path => ({ path, sha256: this.hash(path) })), items: ids.map(id => ({ id, conclusion: "supported", rationale: "Fixture review compared actual source contract and boundary examples", references: paths, examples: kind === "rule" ? ((this.stories.rules as Rule[]).find(r => r.id === id)?.examples.map(e => e.id) || []) : ["ready publishes; draft UI cannot select; API rejects draft"] })), open_findings: findings }));
  }
  sync() {
    this.section("requirements", this.req); this.section("user-stories", this.stories);
    const reqPaths = [`${this.base}/requirements.md`, ...(this.req.inputs as string[])];
    this.review("dependency", ["inventory", ...(this.req.dependencies as Dependency[]).filter(d => d.in_scope).map(d => d.id)], reqPaths);
    this.review("field", (this.req.fields as Field[]).map(f => f.id), reqPaths);
    this.review("rule", (this.stories.rules as Rule[]).map(r => r.id), [...reqPaths, `${this.base}/user-stories.md`, ...(existsSync(join(this.root, `${this.base}/epics/copy.md`)) ? [`${this.base}/epics/copy.md`] : [])]);
    this.syncArtifactReview();
  }
  stage(stage: string, route = "not-selected") {
    this.state.current_stage = stage; this.state.current_stage_instance = `${stage}@module:shop`;
    this.state.history = this.state.history.filter(h => h.stage !== "ui-mock");
    if (route !== "not-selected") this.state.history.push({ phase: "inception", stage: "ui-mock", module_id: "shop", result: "completed", user_input: route, timestamp: new Date().toISOString() });
    saveWorkflowState(this.root, this.state); this.ctx.stage = stage; this.ctx.ui_route = route;
  }
  git(args: string[]) { const r = spawnSync("git", args, { cwd: this.root, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); }
  run(script: string, args: string[]) { return spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, script), ...args], { cwd: this.root, encoding: "utf8" }); }
  produce(sensor: string) { return this.run("core/tools/aidlc-evidence.ts", ["run", "--stage", this.ctx.stage, "--module", "shop", "--sensor", sensor]); }
  gate(sensor: string) { const r = this.run("tests/gate_probe.ts", [`${this.ctx.stage}@module:shop`, "sensors", sensor]); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout).failures as string[]; }
  pass(sensor: string) { const r = this.produce(sensor); assert.equal(r.status, 0, r.stdout + r.stderr); assert.deepEqual(this.gate(sensor), []); }
  blocked(sensor: string, code: string) { const r = this.produce(sensor); assert.notEqual(r.status, 0, r.stdout + r.stderr); const report = join(this.root, `.aidlc/reports/${this.ctx.stage}/shop/${sensor}.blocked.json`); let detail = ""; try { detail = readFileSync(report, "utf8"); } catch {} assert.match(r.stdout + r.stderr + detail, new RegExp(code)); assert.ok(this.gate(sensor).length > 0, "real gate must reject old/missing failed evidence"); }
  prepareUi(route = "html-mock") {
    this.plan = { version: "1", delivery_scope: "release-a", inputs: [], interaction_mode: "explanatory", ui_review: `${this.base}/ui-review.json`, regions: [{ id: "publish", page_id: "PAGE-001", change: "added", stories: ["US-001"], acs: ["AC-001"], required_states: ["ready", "draft"], states: [{ condition: "ready", behavior: "show", source: "AC-001" }, { condition: "draft", behavior: "disabled", source: "AC-002" }] }], actions: [{ id: "publish", region_id: "publish", page_id: "PAGE-001", target: "result", success: "published status", failure_required: true, failure: "retry notice", asynchronous: true, result_entry: "result" }] };
    this.write(`${this.base}/ui-mock/page.html`, '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>PAGE-001</title></head><body><main data-page="PAGE-001"><section data-region="publish" data-change="added" data-us="US-001" data-ac="AC-001"><h1>Publish</h1><button type="button" data-action="publish">Publish</button><p id="result">Results</p></section></main></body></html>');
    this.write(`${this.base}/ui-mock/ui-mock-manifest.json`, JSON.stringify({ schema_version: "1", design_mode: "html-mock", pages: [{ page_id: "PAGE-001", html: `${this.base}/ui-mock/page.html` }] }));
    this.write(`${this.base}/ui-design/nodes.json`, JSON.stringify({ file_url: "https://figma.com/design/fixture", nodes: [{ id: "1:1", component_id: "2:1", page_id: "PAGE-001" }] }));
    this.write(`${this.base}/ui-design/figma-manifest.json`, JSON.stringify({ schema_version: "1", design_mode: "figma", file_url: "https://figma.com/design/fixture", node_snapshot: `${this.base}/ui-design/nodes.json`, region_nodes: [{ id: "1:1", page_id: "PAGE-001", region_id: "publish", stories: ["US-001"], acs: ["AC-001"], actions: ["publish"], targets: ["result"] }] }));
    if (route.startsWith("figma")) {
      const action = (this.plan.actions as Array<Record<string, unknown>>)[0]; action.target = "1:1"; action.result_entry = "1:1";
    }
    this.stage(route === "html-mock" ? "ui-mock-generation" : "ui-figma-generation", route); this.syncUi();
  }
  syncUi() {
    this.section("ui-design/page-plan", this.plan);
    const paths = [`${this.base}/ui-design/page-plan.md`, `${this.base}/user-stories.md`, `${this.base}/requirements.md`, ...(this.req.inputs as string[])];
    if (this.ctx.stage !== "ui-page-planning") paths.push(...(this.ctx.ui_route === "html-mock" ? [`${this.base}/ui-mock/ui-mock-manifest.json`, `${this.base}/ui-mock/page.html`] : [`${this.base}/ui-design/figma-manifest.json`, `${this.base}/ui-design/nodes.json`]));
    this.review("ui", ["publish"], paths);
  }
  syncArtifactReview() {
    const probe = this.run("tests/mars168_artifact_paths.ts", []);
    const paths = [...new Set([...(probe.status === 0 ? JSON.parse(probe.stdout) as string[] : [`${this.base}/requirements.md`, `${this.base}/user-stories.md`]), ...(this.req.inputs as string[])])];
    this.review("artifact", (this.req.artifact_mappings as Array<{ path: string }>).map(m => m.path), paths);
  }
}
