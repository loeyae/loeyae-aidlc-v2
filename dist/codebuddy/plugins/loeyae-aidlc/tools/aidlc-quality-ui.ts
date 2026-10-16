import { readFileSync } from "fs";
import { createRequire } from "module";
import type { HtmlValidate, ConfigData } from "html-validate";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { parseStoryDefinitions } from "./aidlc-story-index";
import { qualityBase, qualityHash, qualityInput, qualityLegacyResult, qualityPath, qualityResult, qualitySection, type QualityContext, type QualityIssue } from "./aidlc-quality-gates";
import { reviewIssues } from "./aidlc-quality-checks";
import { verifyExternalUiManifest } from "./aidlc-ui-readonly.js";
import { verifyCreatedUiManifest } from "./aidlc-ui-create.js";

export const HTML_QUALITY_CONFIG: ConfigData = { root: true, extends: ["html-validate:recommended"] };
const qualityRequire = createRequire(import.meta.url);
type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["node"];
export interface Region {
  id: string; page_id: string; change: "added" | "changed" | "removed" | "unchanged";
  stories: string[]; acs: string[]; decorative_reason?: string;
  required_states: string[]; states: Array<{ condition: string; behavior: "show" | "hidden" | "disabled" | "replace"; source: string }>;
  base_structure?: { path: string; sha256: string }; structure_changed?: boolean; decision?: string;
  removed_node_id?: string;
}
export interface UiAction {
  id: string; region_id: string; page_id: string; target: string;
  success: string; failure_required: boolean; failure?: string; failure_exemption?: string;
  asynchronous: boolean; result_entry?: string; local?: boolean;
}
interface Page { page_id: string; html?: string; page_specs?: string; node_id?: string; mock_box_id?: string }
interface FigmaNode { id: string; page_id: string; region_id?: string; stories: string[]; acs: string[]; actions: string[]; targets: string[] }
function elements(node: Node): Element[] {
  const own = "tagName" in node ? [node as Element] : [];
  const children = "childNodes" in node ? node.childNodes : [];
  const template = "content" in node ? elements(node.content) : [];
  return [...own, ...children.flatMap(elements), ...template];
}
function attr(node: Element, key: string): string { return node.attrs.find(a => a.name === key)?.value || ""; }
function tokens(value: string): string[] { return value.split(/[\s,]+/).filter(Boolean); }
function arr<T>(value: unknown, field: string): T[] { if (!Array.isArray(value)) throw new Error(`GATE_EVIDENCE_MISSING: ${field}`); return value as T[]; }

export function qualityUiCheck(ctx: QualityContext): Record<string, unknown> {
  const sensor = "ui-behavior-consistency"; const legacy = qualityLegacyResult(ctx, sensor); if (legacy) return legacy;
  if (!["html-mock", "figma-create", "figma-existing"].includes(ctx.ui_route)) {
    const req = qualitySection(ctx, "requirements");
    return qualityResult(ctx, sensor, [req], [], { ui_applicable: false, ui_basis: ctx.ui_route, region_count: 0, traced_count: 0, html_errors: null });
  }
  const plan = qualitySection(ctx, "ui-design/page-plan"), stories = qualitySection(ctx, "user-stories"), req = qualitySection(ctx, "requirements");
  plan.inputs.push(...stories.inputs, ...req.inputs);
  const regions = arr<Region>(plan.value.regions, "approved functional region directory");
  const actions = arr<UiAction>(plan.value.actions, "approved action directory");
  const issues: QualityIssue[] = [];
  const issue = (code: string, location: string, message: string) => issues.push({ code, location, message });
  const definitions = parseStoryDefinitions(readFileSync(qualityPath(ctx, `${qualityBase(ctx)}/user-stories.md`), "utf8"));
  const knownStories = new Set(definitions.filter(d => d.kind === "story").map(d => d.id));
  const owners = new Map(definitions.filter(d => d.kind === "ac").map(d => [d.id, d.owner]));
  for (const region of regions) {
    if (region.decorative_reason) {
      if (actions.some(a => a.region_id === region.id)) issue("UI_REGION_UNTRACED", region.id, "interactive functionality cannot be excluded as decoration");
      continue;
    }
    if (!Array.isArray(region.stories) || !region.stories.length || !Array.isArray(region.acs)) { issue("UI_REGION_UNTRACED", region.id, "functional directory needs Story/AC mapping"); continue; }
    for (const story of region.stories) if (!knownStories.has(story)) issue("UI_TRACE_TARGET_MISSING", region.id, `undefined ${story}`);
    for (const ac of region.acs) {
      if (!owners.has(ac)) issue("UI_TRACE_TARGET_MISSING", region.id, `undefined ${ac}`);
      else if (!region.stories.includes(owners.get(ac) || "")) issue("UI_AC_STORY_MISMATCH", region.id, `${ac} belongs to ${owners.get(ac)}`);
    }
    if (region.change !== "removed") {
      if (!Array.isArray(region.required_states) || !Array.isArray(region.states)) issue("UI_STATE_BRANCH_MISSING", region.id, "state inventory and coverage required");
      else for (const condition of region.required_states) if (!region.states.some(s => s.condition === condition && ["show", "hidden", "disabled", "replace"].includes(s.behavior) && s.source)) issue("UI_STATE_BRANCH_MISSING", region.id, `missing ${condition}`);
      if (region.change === "changed" || region.change === "unchanged") {
        if (!region.base_structure) issue("UI_BASE_STRUCTURE_DRIFT", region.id, "local modifications require base structure evidence");
        else {
          const input = qualityInput(ctx, region.base_structure.path); plan.inputs.push(input);
          if (input.sha256 !== region.base_structure.sha256 || region.structure_changed && !region.decision) issue("UI_BASE_STRUCTURE_DRIFT", region.id, "base structure drift lacks effective authorization");
        }
      }
    }
  }
  for (const action of actions) {
    if (!regions.some(r => r.id === action.region_id && r.page_id === action.page_id && r.change !== "removed") || !action.target) issue("UI_ACTION_TARGET_MISSING", action.id, "action requires live region and target");
    if (!action.success || action.failure_required && !action.failure || !action.failure_required && !action.failure_exemption || action.asynchronous && !action.result_entry) issue("UI_FEEDBACK_MISSING", action.id, "applicable success/failure/async-result feedback missing");
  }
  let htmlErrors: number | null = null; let traced = 0;
  const planning = ctx.stage === "ui-page-planning";
  let executable = plan.value.interaction_mode === "executable";
  if (!["explanatory", "executable"].includes(String(plan.value.interaction_mode))) issue("UI_RULE_MISMATCH", "interaction_mode", "explicit executable/explanatory Mock applicability required");
  if (!planning && ctx.ui_route === "html-mock") {
    const manifestPath = `${qualityBase(ctx)}/ui-mock/ui-mock-manifest.json`;
    plan.inputs.push(qualityInput(ctx, manifestPath));
    const manifest = JSON.parse(readFileSync(qualityPath(ctx, manifestPath), "utf8"));
    const pages = arr<Page>(manifest.pages, "canonical manifest pages");
    htmlErrors = 0;
    let validator: HtmlValidate;
    try { const HtmlValidator = qualityRequire("html-validate").HtmlValidate as typeof import("html-validate").HtmlValidate; validator = new HtmlValidator(HTML_QUALITY_CONFIG); }
    catch (error) { throw new Error(`HTML_VALIDATOR_UNAVAILABLE: ${String(error)}`); }
    for (const page of pages) {
      if (!page.html) throw new Error("HTML_VALIDATOR_UNAVAILABLE: canonical HTML missing");
      plan.inputs.push(qualityInput(ctx, page.html));
      if (page.page_specs) plan.inputs.push(qualityInput(ctx, page.page_specs));
      const html = readFileSync(qualityPath(ctx, page.html), "utf8");
      if (/<script\b|\son[a-z]+\s*=/i.test(html)) executable = true;
      if (/<!--\s*html-validate-/i.test(html)) issue("HTML_DOM_CONTRACT_ERROR", page.html, "inline validator suppression is not authorized");
      try {
        const report = validator.validateStringSync(html, page.html);
        htmlErrors += report.errorCount;
        for (const result of report.results) for (const message of result.messages.filter(m => m.severity === 2)) issue("HTML_STATIC_ERROR", `${page.html}:${message.line}`, `${message.ruleId}: ${message.message}`);
      } catch (error) { throw new Error(`HTML_VALIDATOR_UNAVAILABLE: ${String(error)}`); }
      const dom = elements(parse(html));
      const ids = dom.map(n => attr(n, "id")).filter(Boolean);
      for (const id of new Set(ids)) if (ids.filter(i => i === id).length > 1) issue("HTML_DOM_CONTRACT_ERROR", page.html, `duplicate DOM id ${id}`);
      const expected = regions.filter(r => r.page_id === page.page_id && !r.decorative_reason);
      for (const region of expected) {
        const nodes = dom.filter(n => attr(n, "data-region") === region.id);
        if (region.change === "removed") { if (nodes.length) issue("UI_REGION_UNTRACED", region.id, "removed region still exists"); continue; }
        if (["added", "changed"].includes(region.change)) {
          if (nodes.length !== 1) { issue("UI_REGION_UNTRACED", region.id, "approved region missing or duplicate"); continue; }
          const node = nodes[0];
          if (["html", "body", "main"].includes(node.tagName) || attr(node, "data-page") === page.page_id || page.mock_box_id && attr(node, "id") === page.mock_box_id) issue("UI_ROOT_ONLY_TRACE", region.id, "page root cannot stand for functional regions");
          if (attr(node, "data-change") !== region.change || region.stories.some(s => !tokens(attr(node, "data-us")).includes(s)) || region.acs.some(ac => !tokens(attr(node, "data-ac")).includes(ac))) issue("UI_REGION_UNTRACED", region.id, "region markers differ from approved directory");
          else traced++;
        }
      }
      // Every actual marker is checked, even outside the approved directory.
      for (const node of dom) {
        for (const story of tokens(attr(node, "data-us"))) if (!knownStories.has(story)) issue("UI_TRACE_TARGET_MISSING", page.html, `undefined ${story}`);
        for (const ac of tokens(attr(node, "data-ac"))) {
          if (!owners.has(ac)) issue("UI_TRACE_TARGET_MISSING", page.html, `undefined ${ac}`);
          else if (!tokens(attr(node, "data-us")).includes(owners.get(ac) || "")) issue("UI_AC_STORY_MISMATCH", page.html, `wrong owner for ${ac}`);
        }
        if (attr(node, "data-region") && !regions.some(r => r.id === attr(node, "data-region") && r.page_id === page.page_id)) issue("UI_REGION_UNTRACED", page.html, "DOM region absent from approved directory");
        if (node.tagName === "button" || node.tagName === "a" && attr(node, "href")) if (!actions.some(a => a.id === attr(node, "data-action") && a.page_id === page.page_id)) issue("UI_ACTION_TARGET_MISSING", page.html, "interactive entry absent from action directory");
      }
      for (const action of actions.filter(a => a.page_id === page.page_id)) {
        if (!dom.some(n => attr(n, "data-action") === action.id)) issue("UI_ACTION_TARGET_MISSING", action.id, "action entry missing from final DOM");
        const targetExists = (target: string) => ids.includes(target) || pages.some(p => p.page_id === target);
        if (!action.local && !targetExists(action.target)) issue("UI_ACTION_TARGET_MISSING", action.id, "target missing from canonical pages/DOM");
        if (action.asynchronous && !targetExists(action.result_entry || "")) issue("UI_FEEDBACK_MISSING", action.id, "async result entry missing");
      }
    }
    for (const region of regions.filter(r => !r.decorative_reason)) if (!pages.some(p => p.page_id === region.page_id)) issue("UI_REGION_UNTRACED", region.id, "approved page absent from canonical manifest");
  } else if (!planning) {
    const manifestPath = `${qualityBase(ctx)}/ui-design/figma-manifest.json`;
    plan.inputs.push(qualityInput(ctx, manifestPath));
    const manifest = JSON.parse(readFileSync(qualityPath(ctx, manifestPath), "utf8"));
    if (ctx.ui_route === "figma-existing") for (const path of verifyExternalUiManifest(ctx.root, ctx.module_id!, manifest)) plan.inputs.push(qualityInput(ctx, path));
    if (ctx.ui_route === "figma-create") for (const path of verifyCreatedUiManifest(ctx.root, ctx.module_id!, manifest)) plan.inputs.push(qualityInput(ctx, path));
    const nodes = arr<FigmaNode>(manifest.region_nodes, "Figma real region nodes and component mappings");
    const snapshotPath = manifest.node_snapshot as string;
    plan.inputs.push(qualityInput(ctx, snapshotPath));
    const snapshot = JSON.parse(readFileSync(qualityPath(ctx, snapshotPath), "utf8")) as { file_url: string; nodes: Array<{ id: string; component_id: string; page_id: string }> };
    if (snapshot.file_url !== manifest.file_url || !manifest.file_url || !/^https:\/\/(www\.)?figma\.com\//.test(manifest.file_url)) issue("UI_REGION_UNTRACED", manifestPath, "node readback must bind selected Figma file");
    for (const region of regions.filter(r => !r.decorative_reason)) {
      const node = nodes.find(n => n.region_id === region.id && n.page_id === region.page_id);
      if (region.change === "removed") { if (!region.removed_node_id || node || snapshot.nodes.some(n => n.id === region.removed_node_id)) issue("UI_REGION_UNTRACED", region.id, "removed real Figma node must be absent from final readback"); continue; }
      if (!node || !/^\d+:\d+$/.test(node.id) || !snapshot.nodes.some(n => n.id === node.id && n.component_id && n.page_id === region.page_id)) { issue("UI_REGION_UNTRACED", region.id, "real node/component readback missing"); continue; }
      if (manifest.pages?.some((p: { page_id: string; node_id: string }) => p.page_id === region.page_id && p.node_id === node.id)) issue("UI_ROOT_ONLY_TRACE", region.id, "page frame cannot substitute for region nodes");
      if (region.stories.some(s => !node.stories.includes(s)) || region.acs.some(ac => !node.acs.includes(ac))) issue("UI_REGION_UNTRACED", region.id, "node trace mapping incomplete"); else if (["added", "changed"].includes(region.change)) traced++;
    }
    for (const action of actions) {
      const targetExists = (target: string) => nodes.some(n => (n.id === target || n.page_id === target) && snapshot.nodes.some(s => s.id === n.id && s.page_id === n.page_id));
      if (!nodes.some(n => n.region_id === action.region_id && n.page_id === action.page_id && n.actions.includes(action.id)) || !action.local && !targetExists(action.target)) issue("UI_ACTION_TARGET_MISSING", action.id, "Figma originating region/page action or target mapping missing");
      if (action.asynchronous && !targetExists(action.result_entry || "")) issue("UI_FEEDBACK_MISSING", action.id, "Figma async result entry missing from actual nodes");
    }
  }
  const reviewIds = [...regions.map(r => r.id), ...actions.map(a => a.id)];
  if (executable && !planning && ctx.ui_route === "html-mock") {
    const path = String(plan.value.browser_evidence || "");
    if (!path) issue("UI_RULE_MISMATCH", "browser_evidence", "executable Mock requires actual browser observation");
    else {
      plan.inputs.push(qualityInput(ctx, path));
      const browser = JSON.parse(readFileSync(qualityPath(ctx, path), "utf8"));
      if (!browser.command || browser.exit_code !== 0 || !Array.isArray(browser.actions)) issue("UI_RULE_MISMATCH", path, "browser command/actions must pass");
      for (const input of plan.inputs.filter(i => /\.html$/.test(i.path))) if (!browser.inputs?.some((i: { path: string; sha256: string }) => i.path === input.path && i.sha256 === input.sha256)) issue("HTML_REPORT_STALE", path, "browser report is not the final HTML");
      for (const action of actions) if (!browser.actions?.some((a: { id: string; status: string }) => a.id === action.id && a.status === "passed")) issue("UI_RULE_MISMATCH", action.id, "actual browser interaction unverified");
    }
  }
  issues.push(...reviewIssues(ctx, plan, String(plan.value.ui_review || ""), reviewIds, "ui", "UI_RULE_MISMATCH"));
  return qualityResult(ctx, sensor, [plan, stories, req], issues, { ui_applicable: true, region_count: regions.filter(r => ["added", "changed"].includes(r.change) && !r.decorative_reason).length, traced_count: planning ? null : traced, html_errors: htmlErrors, validator: ctx.ui_route === "html-mock" && !planning ? { name: "html-validate", version: "10.4.0", config_sha256: qualityHash(JSON.stringify(HTML_QUALITY_CONFIG)), execution: "validateStringSync", exit_code: 0 } : null });
}
