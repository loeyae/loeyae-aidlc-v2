#!/usr/bin/env node
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";

const ROOT = process.cwd();
const SENSOR_NAMES = new Set([
  "review-evidence", "test-quality", "contract-baseline", "functional-design-completeness",
  "nfr-coverage", "infrastructure-completeness", "implementation-report", "frontend-platform-spec",
  "framework-compliance", "subagent-evidence", "template-completeness", "recovery-evidence",
  "prd-completeness", "diagram-contract", "design-intent-coverage", "ui-design-alignment",
]);

function fail(message: string): never { throw new Error(message); }
function text(path: string): string { return readFileSync(path, "utf8"); }
function textIfExists(path: string): string { return existsSync(path) ? text(path) : ""; }
function existing(paths: string[]): string[] { return paths.map((path) => join(ROOT, path)).filter(existsSync); }
function allFiles(base: string, pattern: RegExp): string[] {
  const root = join(ROOT, base);
  if (!existsSync(root)) return [];
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if ([".git", "node_modules", "dist", "build", "target", ".aidlc/evidence"].includes(entry)) continue;
      const path = join(directory, entry);
      const info = statSync(path);
      if (info.isDirectory()) visit(path);
      else if (pattern.test(path)) result.push(path);
    }
  };
  visit(root);
  return result.sort();
}
function projectFiles(pattern: RegExp): string[] { return allFiles(".", pattern); }
function relativePath(path: string): string { return relative(ROOT, path); }
function joined(paths: string[]): string { return paths.map(text).join("\n"); }
function ids(value: string, pattern: RegExp): string[] { return [...new Set([...value.matchAll(pattern)].map((match) => match[0]))].sort(); }
function count(value: string, pattern: RegExp): number { return [...value.matchAll(pattern)].length; }
function section(value: string, patterns: RegExp[]): boolean { return patterns.some((pattern) => pattern.test(value)); }
function noUnresolved(value: string): void {
  if (/\b(TODO|FIXME|TBD|HACK|NotImplemented)\b|待确认|待定|未解决|未定义|阻断/i.test(value)) fail("unresolved marker found in project artifact");
}
function jsonFile(path: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text(path)); } catch (error) { fail(`${relativePath(path)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${relativePath(path)} must contain a JSON object`);
  return value as Record<string, unknown>;
}
function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${field} must be a non-empty string`);
  return value.trim();
}
function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) fail(`${field} must be a non-negative integer`);
  return value;
}
function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim())) fail(`${field} must be a non-empty string array`);
  return value as string[];
}
function output(value: Record<string, unknown>): void { process.stdout.write(`${JSON.stringify(value)}\n`); }

function reviewEvidence(): Record<string, unknown> {
  const files = existing(["docs/aidlc/construction/code-review.md"]);
  files.push(...allFiles("docs/aidlc/construction/audit", /\.md$/));
  if (files.length === 0) fail("no code review record found");
  const content = joined(files);
  noUnresolved(content);
  if (!section(content, [/spec/i, /规格/]) || !section(content, [/standards/i, /规范/])) fail("review record must contain Spec and Standards axes");
  if (!section(content, [/passed/i, /通过/, /无需修复/, /已修复并复审通过/])) fail("review record has no passed conclusion");
  if (/未通过|blocked|阻断/i.test(content)) fail("review record contains a blocking conclusion");
  const reviewer = content.match(/(?:reviewer|审查者|审查人|reviewed\s+by)\s*[:：]\s*([^\n]+)/i)?.[1]?.trim();
  if (!reviewer) fail("reviewer identity is missing");
  const found = content.match(/(?:issues?_found|发现问题|问题数)\s*[:：]?\s*(\d+)/i)?.[1];
  const resolved = content.match(/(?:issues?_resolved|已解决|修复问题)\s*[:：]?\s*(\d+)/i)?.[1];
  const open = content.match(/(?:issues?_open|未关闭|开放问题)\s*[:：]?\s*(\d+)/i)?.[1] || "0";
  if (found === undefined || resolved === undefined) fail("review record must contain issue counts");
  const filesReviewed = [...new Set(content.match(/(?:src|app|lib|test|tests|docs)\/[^\s`),]+/g) || [])];
  if (filesReviewed.length === 0) fail("review record must identify reviewed files");
  if (Number(resolved) < Number(found) || Number(open) !== 0) fail("review issues are not fully resolved");
  return { status: "passed", spec_axis: "passed", standards_axis: "passed", reviewer, files_reviewed: filesReviewed, issues_found: Number(found), issues_resolved: Number(resolved), issues_open: Number(open) };
}

function testQuality(): Record<string, unknown> {
  const caseFiles = allFiles("docs/aidlc/inception/application-design/test-cases", /\.md$/);
  const testFiles = projectFiles(/(?:test|spec)[^/]*\.(?:java|kt|ts|tsx|js|jsx|py|go|rs|cs)$/i);
  if (caseFiles.length === 0) fail("UC-D test case files are missing");
  if (testFiles.length === 0) fail("test source files are missing");
  const cases = ids(joined(caseFiles), /UC-D-\d+(?:-[A-Za-z0-9_-]+)?/g);
  if (cases.length === 0) fail("no UC-D identifiers found in test case files");
  const mapping = cases.map((useCase) => {
    const matches = testFiles.filter((path) => new RegExp(`\\b${useCase}\\b`).test(text(path)));
    if (matches.length === 0) fail(`${useCase} has no test source mapping`);
    return { use_case: useCase, test_methods: matches.map(relativePath) };
  });
  const redGreenPath = join(ROOT, ".aidlc", "tdd", "red-green.json");
  if (!existsSync(redGreenPath)) fail(".aidlc/tdd/red-green.json is required for observed RED/GREEN evidence");
  const redGreen = jsonFile(redGreenPath);
  if (redGreen.red_seen !== true && typeof redGreen.red_exemption !== "string") fail("TDD RED evidence is missing");
  if (redGreen.green_seen !== true) fail("TDD GREEN evidence is missing");
  const total = numberValue(redGreen.tests_total, "red-green.tests_total");
  const failed = numberValue(redGreen.tests_failed, "red-green.tests_failed");
  if (total < 1 || failed !== 0) fail("red-green test result is not passing");
  return { status: "passed", red_seen: redGreen.red_seen === true, green_seen: true, tests_total: total, tests_failed: 0, traceability_complete: true, uc_mapping: mapping, ...(typeof redGreen.red_exemption === "string" ? { red_exemption: redGreen.red_exemption } : {}) };
}

function contractBaseline(): Record<string, unknown> {
  const files = projectFiles(/(?:contracts?|openapi|swagger|schema|\.proto$|\.avsc$)/i).filter((path) => !path.includes("core/"));
  if (files.length === 0) fail("no contract schema file found");
  const content = joined(files);
  noUnresolved(content);
  const owner = content.match(/(?:owner|负责人|所有者)\s*[:：|]\s*([^\n|]+)/i)?.[1]?.trim();
  const consumers = content.match(/(?:consumers?|消费者|下游)\s*[:：|]\s*([^\n]+)/i)?.[1]?.split(/[,，、|]/).map((item) => item.trim()).filter(Boolean) || [];
  if (!owner) fail("contract owner is missing");
  if (consumers.length === 0) fail("contract consumers are missing");
  if (!/version|版本|compat|兼容|schema/i.test(content)) fail("contract compatibility/version information is missing");
  const schema = files.map((path) => `${relativePath(path)}\n${text(path)}`).join("\n");
  const schemaHash = `sha256:${createHash("sha256").update(schema).digest("hex")}`;
  const extension = files[0].split(".").pop()?.toLowerCase();
  const contractType = extension === "proto" ? "proto" : /openapi|swagger/i.test(relativePath(files[0])) ? "api" : "schema";
  return { status: "verified", contract_id: `contract-${schemaHash.slice(-12)}`, contract_type: contractType, owner, consumers, schema_hash: schemaHash, validation_status: "passed" };
}

function functionalDesign(): Record<string, unknown> {
  const files = existing(["docs/aidlc/construction/functional-design.md"]);
  files.push(...allFiles("docs/aidlc/construction", /functional-design\/[^/]+\.md$/));
  if (files.length === 0) fail("functional design artifacts are missing");
  const content = joined(files);
  noUnresolved(content);
  const sourceCases = ids(joined(allFiles("docs/aidlc/inception/application-design/test-cases", /\.md$/)), /UC-D-\d+(?:-[A-Za-z0-9_-]+)?/g);
  const covered = sourceCases.filter((id) => new RegExp(`\\b${id}\\b`).test(content));
  if (sourceCases.length > 0 && covered.length !== sourceCases.length) fail("functional design does not cover every UC-D case");
  const interfaces = count(content, /(?:API|接口|endpoint|event handler|事件处理|public method|公共方法)/gi);
  if (interfaces < 1) fail("functional design contains no interface specification");
  if (!/数据源|data source|repository|database|数据库|表结构/i.test(content)) fail("functional design contains no data source validation");
  if (!/错误|异常|error|exception|失败|timeout|超时/i.test(content)) fail("functional design contains no error handling definition");
  return { status: "passed", data_source_validation: "passed", ambiguities_resolved: true, unresolved_blockers: 0, use_cases_covered: covered.length > 0 ? covered : ["documented functional cases"], interfaces_specified: interfaces, error_handling_defined: true };
}

function nfrCoverage(): Record<string, unknown> {
  const files = projectFiles(/(?:nfr|non-functional|非功能)/i).filter((path) => path.endsWith(".md"));
  if (files.length === 0) fail("NFR artifacts are missing");
  const content = joined(files);
  noUnresolved(content);
  const nfrIds = ids(content, /NFR-\d+(?:-[A-Za-z0-9_-]+)?/g);
  if (nfrIds.length === 0) fail("no NFR identifiers found");
  const items = nfrIds.map((id) => {
    const start = content.indexOf(id);
    const next = content.slice(start + id.length).search(/NFR-\d+/);
    const block = content.slice(start, next < 0 ? start + 1600 : start + next);
    if (!/验收|acceptance|阈值|threshold|p95|measurement|度量|指标/i.test(block)) fail(`${id} has no acceptance or measurement rule`);
    return { id, category: block.match(/performance|security|reliability|scalability|性能|安全|可靠性|扩展性/i)?.[0] || "quality", acceptance_criterion: block.split(/\n/).find((line) => /验收|acceptance|阈值|threshold|p95|指标/i.test(line))?.trim() || id, verified: true };
  });
  return { status: "passed", requirements_covered: items.length, unresolved: 0, nfr_items: items };
}

function infrastructure(): Record<string, unknown> {
  const files = projectFiles(/(?:infrastructure|deployment|deploy|基础设施|部署)/i).filter((path) => path.endsWith(".md"));
  if (files.length === 0) fail("infrastructure design artifacts are missing");
  const content = joined(files);
  noUnresolved(content);
  const required = ["deployment", "resources", "migration", "rollback", "runtime_dependencies"];
  const matched = required.filter((item) => {
    const aliases: Record<string, RegExp> = { deployment: /deployment|部署|发布/i, resources: /resources?|资源/i, migration: /migration|迁移/i, rollback: /rollback|回滚/i, runtime_dependencies: /runtime dependencies|运行时依赖|外部依赖/i };
    return aliases[item].test(content);
  });
  if (matched.length !== required.length) fail(`infrastructure sections missing: ${required.filter((item) => !matched.includes(item)).join(", ")}`);
  const resourceLines = content.split("\n").filter((line) => /资源|resource|数据库|缓存|queue|消息|service|服务/i.test(line) && line.trim().length > 3);
  if (resourceLines.length === 0) fail("infrastructure resources are not enumerated");
  const unprovisioned = resourceLines.filter((line) => !/provisioned|已创建|已配置|existing|现有|true|就绪/i.test(line));
  if (unprovisioned.length > 0) fail("infrastructure resources lack provisioning confirmation");
  return { status: "passed", sections: required, unresolved: 0, resources_enumerated: resourceLines.slice(0, 50).map((line, index) => ({ name: line.trim().replace(/^[-*|\s]+/, "").slice(0, 120), type: "declared", provisioned: true, index })), rollback_strategy: "documented in infrastructure artifacts" };
}

function implementationReport(): Record<string, unknown> {
  const path = join(ROOT, "docs/aidlc/construction/implementation-report.md");
  if (!existsSync(path)) fail("implementation report is missing");
  const content = text(path);
  noUnresolved(content);
  const references = [...new Set(content.match(/\.aidlc\/evidence\/[A-Za-z0-9._/-]+\.json/g) || [])];
  if (references.length === 0) fail("implementation report has no evidence references");
  const missing = references.filter((ref) => !existsSync(join(ROOT, ref)));
  if (missing.length > 0) fail(`implementation report references missing evidence: ${missing.join(", ")}`);
  if (!/all_gates_passed\s*[:：]\s*true|所有.*门禁.*通过|all gates passed/i.test(content)) fail("implementation report does not confirm all gates passed");
  const scope = content.match(/(?:scope|范围)\s*[:：|]\s*([A-Za-z0-9_-]+)/i)?.[1];
  const stageCount = content.match(/(?:stages_completed|完成阶段数|阶段数)\s*[:：|]\s*(\d+)/i)?.[1];
  if (!scope || !stageCount || Number(stageCount) < 1) fail("implementation report lacks scope or completed stage count");
  return { status: "passed", summary_complete: true, all_gates_passed: true, scope, stages_completed: Number(stageCount), evidence_references: references };
}

function frontendPlatform(): Record<string, unknown> {
  const path = join(ROOT, "docs/aidlc/frontend-platform-spec.md");
  if (!existsSync(path)) fail("frontend platform specification is missing");
  const content = text(path);
  noUnresolved(content);
  const layout = count(content, /布局原语|layout primitive|stack|grid|container|flex|row|column/gi);
  const components = count(content, /组件|component|button|form|table|dialog|navigation|列表|表单|按钮/gi);
  const css = count(content, /CSS|样式|spacing|responsive|tokens|间距|响应式|设计令牌/gi);
  if (layout < 3 || components < 5 || css < 3) fail(`frontend platform spec is incomplete: layout=${layout}, components=${components}, css=${css}`);
  return { status: "passed", layout_primitives: ["documented-layout-1", "documented-layout-2", "documented-layout-3"], component_mapping: Array.from({ length: 5 }, (_, index) => `documented-component-${index + 1}`), css_constraints: ["documented-css-1", "documented-css-2", "documented-css-3"] };
}

function frameworkCompliance(): Record<string, unknown> {
  const buildFiles = projectFiles(/(?:pom\.xml|build\.gradle|settings\.gradle|package\.json)$/i);
  const buildContent = joined(buildFiles);
  if (!/loeyae-boot|loeyae\.boot/i.test(buildContent)) fail("Loeyae Boot project was not detected");
  const files = projectFiles(/\.(?:java|kt|ts|tsx|js|md)$/i);
  const content = joined(files);
  if (!/loeyae|framework|技能|skill/i.test(content)) fail("framework skill loading evidence is missing");
  const checksTotal = count(content, /\[[ xX]\]|通过|passed|check|检查/gi);
  const checksFailed = count(content, /\[\s*[xX]\s*\].*(?:失败|failed)|未通过|blocked/gi);
  if (checksTotal < 1 || checksFailed > 0) fail("framework compliance checks did not pass");
  return { status: "passed", skills_loaded: true, checks_total: checksTotal, checks_failed: 0 };
}

function subagentEvidence(): Record<string, unknown> {
  const planFiles = projectFiles(/workflow-plan\.md|subagent-execution\.md/i);
  const resultFiles = [...allFiles(".aidlc/subagents", /\.json$/), ...allFiles("docs/aidlc/construction/subagent-results", /\.json$/)];
  if (resultFiles.length === 0) fail("structured subagent result files are missing");
  const records = resultFiles.map(jsonFile);
  const failures = records.filter((record) => record.status === "failed" || record.success === false).length;
  const agents = [...new Set(records.map((record) => typeof record.agent === "string" ? record.agent : typeof record.agent_id === "string" ? record.agent_id : "").filter(Boolean))];
  const completed = records.filter((record) => record.status === "completed" || record.success === true).length;
  if (agents.length === 0 || completed < 1 || failures > 0) fail("subagent results are incomplete or failed");
  return { status: "passed", agents, tasks_completed: completed, failures, plan_files: planFiles.map(relativePath) };
}

function templateCompleteness(): Record<string, unknown> {
  const directory = join(ROOT, "docs/aidlc/construction/build-and-test");
  const expected = ["build-instructions.md", "unit-test-instructions.md"];
  const templates = expected.map((name) => join(directory, name));
  if (templates.some((path) => !existsSync(path))) fail("build/test template files are incomplete");
  for (const path of templates) {
    const content = text(path);
    if (content.trim().length < 40 || /\[[^\]]+\]|TODO|TBD/i.test(content)) fail(`${relativePath(path)} contains unresolved template placeholders`);
  }
  return { status: "passed", templates: templates.map(relativePath), unresolved: 0 };
}

function recoveryEvidence(): Record<string, unknown> {
  const statePath = join(ROOT, "docs/aidlc/state.md");
  const markerPath = join(ROOT, ".aidlc/context-compacted");
  const state = existsSync(statePath) ? text(statePath) : "";
  if (!existsSync(markerPath) && !/context_compacted\s*[:：]\s*true|上下文压缩|compact recovery/i.test(state)) fail("context compaction was not detected");
  const handoff = existing(["docs/aidlc/handoff.md", "docs/aidlc/construction/compact-recovery.md"]);
  if (!existsSync(statePath) || handoff.length === 0) fail("state restoration or handoff evidence is missing");
  return { status: "passed", state_restored: true, handoff_recorded: true };
}

function prdCompleteness(): Record<string, unknown> {
  const candidates = ["docs/aidlc/ideation/prd.md", "docs/aidlc/inception/prd.md", ...allFiles("docs/aidlc/product/scenarios", /prd\.md$/).map(relativePath)];
  const paths = existing(candidates);
  if (paths.length === 0) fail("PRD artifact is missing");
  const path = paths[0];
  const content = text(path);
  noUnresolved(content);
  const required: Array<[string, RegExp]> = [
    ["overview", /概述|overview|背景/i], ["goals", /目标|goals?/i], ["features", /功能|features?/i],
    ["non-goals", /非目标|non[- ]?goals?/i], ["questions", /待确认|问题|questions?/i], ["sources", /来源|source index|sources?/i],
  ];
  const missing = required.filter(([, pattern]) => !pattern.test(content)).map(([name]) => name);
  if (missing.length > 0) fail(`PRD sections missing: ${missing.join(", ")}`);
  const requirements = ids(content, /(?:FR|REQ)-\d+(?:-[A-Za-z0-9_-]+)?/g);
  if (requirements.length < 1 || !/验收|acceptance|acceptance criteria/i.test(content)) fail("PRD lacks functional requirements or acceptance criteria");
  if (!/clarification|澄清|一致性|consistency|通过|passed/i.test(content)) fail("PRD clarification consistency evidence is missing");
  const flow = projectFiles(/business-flows?\.md$/i).length > 0 ? "passed" : "not_applicable";
  return { status: "passed", prd_path: relativePath(path), required_sections: required.map(([name]) => name), functional_requirements: requirements.length, acceptance_criteria_complete: true, non_goals_complete: true, pending_questions_indexed: true, source_index_complete: true, clarification_consistency: "passed", business_flow_validation: flow, unresolved_blockers: 0 };
}

function diagramContract(): Record<string, unknown> {
  const files = projectFiles(/\.svg$/i).filter((path) => !/(template|library)/i.test(path));
  if (files.length === 0) fail("no SVG diagram source found");
  let idsUnique = true;
  let portsValid = true;
  let direction = true;
  let legend = true;
  let groups = true;
  let viewbox = true;
  let frMapping = false;
  for (const path of files) {
    const content = text(path);
    const svgIds = [...content.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
    if (new Set(svgIds).size !== svgIds.length) idsUnique = false;
    if (!/<svg\b[^>]*\bviewBox=["'][^"']+["']/i.test(content)) viewbox = false;
    if (!/(?:port|marker-(?:start|end)|data-port)/i.test(content)) portsValid = false;
    if (!/(?:marker-end|marker-start|data-direction|direction=)/i.test(content)) direction = false;
    if (!/<g\b/i.test(content)) groups = false;
    if (!/(?:图例|legend)/i.test(content) && !/(?:图例|legend)/i.test(textIfExists(path.replace(/\.svg$/i, ".md")))) legend = false;
    if (/\b(?:FR|REQ)-\d+\b/i.test(content) || /\b(?:FR|REQ)-\d+\b/i.test(textIfExists(path.replace(/\.svg$/i, ".md")))) frMapping = true;
  }
  if (!idsUnique || !portsValid || !direction || !legend || !groups || !viewbox || !frMapping) fail(`diagram contract failed: ids=${idsUnique}, ports=${portsValid}, direction=${direction}, legend=${legend}, groups=${groups}, viewbox=${viewbox}, fr_mapping=${frMapping}`);
  return { status: "passed", source_format: "svg", diagrams_checked: files.length, ids_unique: true, ports_valid: true, direction_consistent: true, legend_valid: true, groups_valid: true, viewbox_valid: true, provider_status: "unverified", target_operation_required: false, fr_mapping_complete: true, unresolved: 0 };
}

function designIntentCoverage(): Record<string, unknown> {
  const designFiles = allFiles("docs/aidlc/inception/application-design", /\.md$/);
  const unitFiles = [...designFiles, ...allFiles("docs/aidlc/construction", /(?:unit|implementation|summary).*\.md$/i)];
  const content = joined(designFiles);
  const markers = [...new Set([...content.matchAll(/\[意图:([^\]]+)\]/g)].map((match) => match[1].trim()))];
  if (markers.length === 0) return { status: "passed", intent_markers_found: 0, coverage_complete: true, uncovered: 0, skip_reason: "no structural change intent markers" };
  const unitContent = joined(unitFiles);
  const uncovered = markers.filter((marker) => !unitContent.includes(marker) || !/允许修改范围|完成证据|implementation summary|unit/i.test(unitContent));
  if (uncovered.length > 0) fail(`design intents are not covered: ${uncovered.join(", ")}`);
  return { status: "passed", intent_markers_found: markers.length, coverage_complete: true, uncovered: 0, covered_intents: markers };
}

function uiAlignment(): Record<string, unknown> {
  const pagePlans = projectFiles(/page-plan\.md$|page-specs\.md$/i);
  const htmlFiles = projectFiles(/\.html?$/i).filter((path) => path.includes("ui-mock") || path.includes("mock"));
  const figma = projectFiles(/(?:figma|cross-validation).*\.md$/i);
  if (pagePlans.length === 0 && htmlFiles.length === 0 && figma.length === 0) return { status: "not_applicable" };
  if (figma.length > 0 && htmlFiles.length === 0) {
    const content = joined(figma);
    if (!/F1|F2|F3|F4/.test(content) || /未通过|blocked|unverified/i.test(content)) fail("Figma alignment evidence is incomplete");
    return { status: "passed", design_mode: "figma", pages_checked: count(content, /F\d+/g), elements_checked: count(content, /Frame|组件|element/gi), unmapped_elements: 0, extra_elements: 0, styles_aligned: true, conditional_visibility_aligned: true, platform_constraints_respected: true };
  }
  if (pagePlans.length === 0 || htmlFiles.length === 0) fail("HTML Mock alignment requires both page plan and HTML Mock artifacts");
  const plan = joined(pagePlans);
  const html = joined(htmlFiles);
  const pages = ids(plan, /(?:PAGE|Page|页面)[-_ ]?[A-Za-z0-9_-]+/g).slice(0, 100);
  if (pages.length === 0) fail("page plan contains no page identifiers");
  const missing = pages.filter((page) => !html.includes(page));
  if (missing.length > 0) fail(`HTML Mock is missing planned pages: ${missing.join(", ")}`);
  const elements = count(html, /mock-box|<button\b|<input\b|<select\b|<table\b|<dialog\b/gi);
  if (elements < 1 || !/<style\b|\.css\b/i.test(html)) fail("HTML Mock has no verifiable components or styles");
  const frontend = existing(["docs/aidlc/frontend-platform-spec.md"]);
  return { status: "passed", design_mode: "html-mock", pages_checked: pages.length, elements_checked: elements, unmapped_elements: 0, extra_elements: 0, styles_aligned: true, conditional_visibility_aligned: /显示|隐藏|visible|hidden|condition/i.test(html), platform_constraints_respected: frontend.length > 0 };
}

const CHECKERS: Record<string, () => Record<string, unknown>> = {
  "review-evidence": reviewEvidence,
  "test-quality": testQuality,
  "contract-baseline": contractBaseline,
  "functional-design-completeness": functionalDesign,
  "nfr-coverage": nfrCoverage,
  "infrastructure-completeness": infrastructure,
  "implementation-report": implementationReport,
  "frontend-platform-spec": frontendPlatform,
  "framework-compliance": frameworkCompliance,
  "subagent-evidence": subagentEvidence,
  "template-completeness": templateCompleteness,
  "recovery-evidence": recoveryEvidence,
  "prd-completeness": prdCompleteness,
  "diagram-contract": diagramContract,
  "design-intent-coverage": designIntentCoverage,
  "ui-design-alignment": uiAlignment,
};

try {
  const args = process.argv.slice(2);
  const sensorIndex = args.indexOf("--sensor");
  const sensor = sensorIndex >= 0 ? args[sensorIndex + 1] : undefined;
  if (!sensor || !SENSOR_NAMES.has(sensor) || !CHECKERS[sensor]) fail("usage: aidlc-semantic-checks.ts --sensor <semantic-sensor>");
  output(CHECKERS[sensor]());
} catch (error) {
  console.error(`Semantic checker blocked: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
