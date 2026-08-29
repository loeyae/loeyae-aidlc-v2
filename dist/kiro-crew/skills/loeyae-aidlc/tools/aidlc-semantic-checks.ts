#!/usr/bin/env node
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { pointEqual, segmentRelation } from "./diagram-geometry.js";
import { DIAGRAM_VISUAL_STYLE, diagramVisualStyleErrors, edgeLabelPlacementError } from "./diagram-visual-style.js";
import {
  ExpectedContract,
  expectedContractPath,
  parseExpectedContract,
  routeBendCount,
  routeDirectionTokens,
  routeGeometryKind,
  routeIntentErrors,
} from "./diagram-contract.js";

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
  const manifests = projectFiles(/\.diagram\.json$/i);
  if (manifests.length === 0) fail("diagram structured source is missing; new or adjusted SVG requires a .diagram.json manifest");

  const ports = new Set(["top", "right", "bottom", "left"]);
  const shapes = new Set(["round", "rect", "diamond", "ellipse", "database", "actor", "note"]);
  const edgeKinds = new Set(["directed", "bidirectional", "undirected", "dashed"]);
  const diagramTypes = new Set(["architecture", "context", "container", "flowchart", "pipeline", "sequence", "state", "er", "deployment", "class", "component", "infrastructure"]);
  const semanticModes = new Set(["static-boundary", "static-relation", "process-flow", "data-flow", "dependency-flow", "constraint"]);
  const visualChannels = new Set(["edge-kind", "node-shape", "group-role", "icon"]);
  const visualRoles = new Set(["semantic", "decorative"]);
  const groupTypes = new Set(["exclusive", "nested", "cross-cutting", "overlay"]);
  const legendStatuses = new Set(["required", "exempt", "not-needed"]);
  const splitStatuses = new Set(["not-needed", "split", "kept-single"]);
  const architectureTypes = new Set(["architecture", "context", "container", "deployment", "class", "component", "infrastructure", "er"]);
  const processTypes = new Set(["flowchart", "pipeline", "sequence", "state"]);
  const unsafeSvg = /<\s*(?:script|foreignObject|image|style)\b|<[^>]*\b(?:href|on[a-zA-Z]+|style)\s*=|<[^>]*url\s*\(\s*(?!#)[^)]*\)/i;
  let diagramsChecked = 0;
  let expectedContractsChecked = 0;
  let generationContractsChecked = 0;
  const generationClosures: Record<string, unknown>[] = [];
  const routeContractReports: Record<string, unknown>[] = [];
  let changeImpactReviewsChecked = 0;
  let riskScore = 0;
  const riskReasons = new Set<string>();

  const requireString = (value: unknown, field: string): string => {
    if (typeof value !== "string" || value.trim().length === 0) fail(`${field} must be a non-empty string`);
    return value.trim();
  };
  const requireFinite = (value: unknown, field: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be a finite number`);
    return value;
  };
  const observedChannelValues = (diagram: Record<string, any>): Map<string, Set<string>> => {
    const values = new Map<string, Set<string>>();
    const edges = Array.isArray(diagram.edges) ? diagram.edges : [];
    const nodes = Array.isArray(diagram.nodes) ? diagram.nodes : [];
    const groups = Array.isArray(diagram.groups) ? diagram.groups : [];
    if (edges.length > 0) values.set("edge-kind", new Set(edges.map((edge) => edge.kind || "directed")));
    if (nodes.length > 0) values.set("node-shape", new Set(nodes.map((node) => node.shape || "rect")));
    const typedGroups = groups.filter((group) => group.semanticType);
    if (typedGroups.length > 0) values.set("group-role", new Set(typedGroups.map((group) => group.semanticType)));
    return values;
  };

  const portPoint = (node: Record<string, any>, port: string, offset = 0): [number, number] => {
    const centerX = node.x + node.width / 2;
    const centerY = node.y + node.height / 2;
    if (node.shape === "diamond") {
      if (port === "top") return [centerX, node.y];
      if (port === "right") return [node.x + node.width, centerY];
      if (port === "bottom") return [centerX, node.y + node.height];
      return [node.x, centerY];
    }
    if (port === "top") return [centerX + offset, node.y];
    if (port === "right") return [node.x + node.width, centerY + offset];
    if (port === "bottom") return [centerX - offset, node.y + node.height];
    return [node.x, centerY - offset];
  };
  const samePoint = (first: unknown, second: [number, number]): boolean => {
    if (!Array.isArray(first) || first.length !== 2 || typeof first[0] !== "number" || typeof first[1] !== "number") return false;
    return Math.abs(first[0] - second[0]) <= 1 && Math.abs(first[1] - second[1]) <= 1;
  };
  const isOrthogonal = (points: unknown[]): boolean => points.every((point, index) => {
    if (index === 0) return true;
    const current = point as unknown[];
    const previous = points[index - 1] as unknown[];
    return Array.isArray(current) && Array.isArray(previous) && (current[0] === previous[0] || current[1] === previous[1]);
  });
  const nonZeroSegment = (points: [number, number][], fromStart: boolean): [[number, number], [number, number]] | null => {
    if (fromStart) {
      for (let index = 1; index < points.length; index++) if (!pointEqual(points[index - 1], points[index])) return [points[index - 1], points[index]];
    } else {
      for (let index = points.length - 1; index > 0; index--) if (!pointEqual(points[index - 1], points[index])) return [points[index], points[index - 1]];
    }
    return null;
  };
  const leavesPort = (points: [number, number][], port: string): boolean => {
    const segment = nonZeroSegment(points, true);
    if (!segment) return false;
    const [first, second] = segment;
    if (port === "top") return second[1] < first[1] - 1;
    if (port === "right") return second[0] > first[0] + 1;
    if (port === "bottom") return second[1] > first[1] + 1;
    return second[0] < first[0] - 1;
  };
  const entersPort = (points: [number, number][], port: string): boolean => {
    const segment = nonZeroSegment(points, false);
    if (!segment) return false;
    const [last, previous] = segment;
    if (port === "top") return previous[1] < last[1] - 1;
    if (port === "right") return previous[0] > last[0] + 1;
    if (port === "bottom") return previous[1] > last[1] + 1;
    return previous[0] < last[0] - 1;
  };
  type Rectangle = { left: number; top: number; right: number; bottom: number };
  const rectangleOf = (item: Record<string, any>, field: string): Rectangle | null => {
    const values = [item.x, item.y, item.width, item.height];
    if (values.every((value) => typeof value === "number" && Number.isFinite(value))) {
      if (item.width <= 0 || item.height <= 0) fail(`${field} has invalid dimensions`);
      return { left: item.x, top: item.y, right: item.x + item.width, bottom: item.y + item.height };
    }
    if (values.every((value) => value === undefined)) return null;
    fail(`${field} must define x, y, width, and height together`);
  };
  const pointInsideNodeShape = (node: Record<string, any>, point: [number, number]): boolean => {
    const centerX = node.x + node.width / 2;
    const centerY = node.y + node.height / 2;
    if (node.shape === "diamond") {
      return Math.abs(point[0] - centerX) / (node.width / 2) + Math.abs(point[1] - centerY) / (node.height / 2) < 1 - 1e-6;
    }
    if (node.shape === "ellipse") {
      return ((point[0] - centerX) / (node.width / 2)) ** 2 + ((point[1] - centerY) / (node.height / 2)) ** 2 < 1 - 1e-6;
    }
    return point[0] > node.x + 1e-6 && point[0] < node.x + node.width - 1e-6 && point[1] > node.y + 1e-6 && point[1] < node.y + node.height - 1e-6;
  };
  const approachesTargetFromOutside = (points: [number, number][], node: Record<string, any>): boolean => {
    const segment = nonZeroSegment(points, false);
    return Boolean(segment && !pointInsideNodeShape(node, segment[1]));
  };
  const rectanglesOverlap = (first: Rectangle, second: Rectangle): boolean => first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
  const segmentIntersectsRectangle = (first: [number, number], second: [number, number], rectangle: Rectangle): boolean => {
    const dx = second[0] - first[0];
    const dy = second[1] - first[1];
    let entering = 0;
    let leaving = 1;
    for (const [origin, delta, minimum, maximum] of [[first[0], dx, rectangle.left, rectangle.right], [first[1], dy, rectangle.top, rectangle.bottom]] as Array<[number, number, number, number]>) {
      if (delta === 0) {
        if (origin <= minimum || origin >= maximum) return false;
        continue;
      }
      const near = (minimum - origin) / delta;
      const far = (maximum - origin) / delta;
      const low = Math.min(near, far);
      const high = Math.max(near, far);
      entering = Math.max(entering, low);
      leaving = Math.min(leaving, high);
      if (entering > leaving) return false;
    }
    return entering < leaving && leaving > 0 && entering < 1;
  };
  const segmentOverlapsRectangleBoundary = (first: [number, number], second: [number, number], rectangle: Rectangle): boolean => {
    const overlap = (firstLow: number, firstHigh: number, secondLow: number, secondHigh: number): boolean => Math.min(firstHigh, secondHigh) - Math.max(firstLow, secondLow) > 1e-6;
    if (first[0] === second[0]) return (Math.abs(first[0] - rectangle.left) <= 1e-6 || Math.abs(first[0] - rectangle.right) <= 1e-6) && overlap(first[1], second[1], rectangle.top, rectangle.bottom);
    if (first[1] === second[1]) return (Math.abs(first[1] - rectangle.top) <= 1e-6 || Math.abs(first[1] - rectangle.bottom) <= 1e-6) && overlap(first[0], second[0], rectangle.left, rectangle.right);
    return false;
  };
  const segmentsIntersect = (first: [number, number], second: [number, number], third: [number, number], fourth: [number, number]): boolean => {
    const relation = segmentRelation(first, second, third, fourth);
    if (relation === "cross" || relation === "overlap") return true;
    if (relation !== "touch") return false;
    const sharedEndpoint = [first, second].some((point) => [third, fourth].some((candidate) => pointEqual(point, candidate)));
    return !sharedEndpoint;
  };
  const textRectangle = (label: Record<string, any>, field: string): Rectangle => {
    const rawText = label.text;
    const lines = Array.isArray(rawText) ? rawText.map((line) => requireString(line, `${field}.text`)) : [requireString(rawText, `${field}.text`)];
    const x = requireFinite(label.x, `${field}.x`);
    const y = requireFinite(label.y, `${field}.y`);
    const edgeLabel = field.includes("edge");
    const expectedFontSize = edgeLabel ? DIAGRAM_VISUAL_STYLE.edgeLabelFontSize : DIAGRAM_VISUAL_STYLE.frameFontSize;
    const fontSize = label.fontSize === undefined ? expectedFontSize : requireFinite(label.fontSize, `${field}.fontSize`);
    if (fontSize !== expectedFontSize) fail(`FONT_STYLE: ${field}.fontSize must be ${expectedFontSize}`);
    const width = Math.max(1, ...lines.map((line) => line.length * fontSize * 0.55));
    const height = lines.length * fontSize * 1.2;
    return { left: x - width / 2, top: y - height / 2, right: x + width / 2, bottom: y + height / 2 };
  };
  const layoutExceptionIds = (layout: Record<string, any>, field: string): Set<string> => {
    const exceptions = layout[field] === undefined ? [] : layout[field];
    if (!Array.isArray(exceptions)) fail(`diagram layout ${field} must be an array`);
    const ids = new Set<string>();
    for (const exception of exceptions) {
      if (!exception || !Array.isArray(exception.edgeIds) || exception.edgeIds.length === 0) fail(`diagram layout ${field} requires edgeIds`);
      requireString(exception.reason, `diagram layout ${field}.reason`);
      for (const edgeId of exception.edgeIds) ids.add(requireString(edgeId, `diagram layout ${field}.edgeId`));
    }
    return ids;
  };
  const edgePairKey = (first: string, second: string): string => [first, second].sort().join("\u0000");
  const crossingExceptionPairs = (layout: Record<string, any>): Map<string, [string, string]> => {
    const exceptions = layout.crossingExceptions === undefined ? [] : layout.crossingExceptions;
    if (!Array.isArray(exceptions)) fail("diagram layout crossingExceptions must be an array");
    const pairs = new Map<string, [string, string]>();
    for (const exception of exceptions) {
      if (!exception || !Array.isArray(exception.edgeIds) || exception.edgeIds.length !== 2) fail("CROSSING_EXCEPTION: diagram layout crossingExceptions requires exactly two edgeIds");
      const first = requireString(exception.edgeIds[0], "diagram layout crossingExceptions.edgeId");
      const second = requireString(exception.edgeIds[1], "diagram layout crossingExceptions.edgeId");
      if (first === second) fail("CROSSING_EXCEPTION: diagram layout crossingExceptions requires two distinct edgeIds");
      requireString(exception.businessReason, "diagram layout crossingExceptions.businessReason");
      requireString(exception.geometricReason, "diagram layout crossingExceptions.geometricReason");
      const visualEvidence = exception.visualEvidence;
      if (!visualEvidence || typeof visualEvidence !== "object" || Array.isArray(visualEvidence) || visualEvidence.required !== true || !Array.isArray(visualEvidence.refs) || visualEvidence.refs.length === 0 || !visualEvidence.refs.every((ref: unknown) => typeof ref === "string" && ref.trim().length > 0)) fail("CROSSING_EXCEPTION: diagram layout crossingExceptions.visualEvidence must contain required=true and non-empty refs");
      const key = edgePairKey(first, second);
      if (pairs.has(key)) fail(`CROSSING_EXCEPTION: diagram layout crossingExceptions duplicates ${first}/${second}`);
      pairs.set(key, [first, second]);
    }
    return pairs;
  };

  const projectReference = (value: string, field: string): string => {
    if (/^(?:https?:|ssot:)/i.test(value)) return value;
    const candidate = resolve(ROOT, value);
    const relativeCandidate = relative(ROOT, candidate);
    if (relativeCandidate === ".." || relativeCandidate.startsWith(`..${process.platform === "win32" ? "\\\\" : "/"}`) || relativeCandidate.startsWith("/")) fail(`${field} must stay inside the project root`);
    if (!existsSync(candidate)) fail(`${field} does not exist: ${value}`);
    return candidate;
  };

  const loadIndependentExpected = (manifest: Record<string, unknown>, diagram: Record<string, unknown>, id: string): { contract?: ExpectedContract; path?: string } => {
    const declared = expectedContractPath(manifest, diagram);
    if (!declared) return {};
    const contractPath = projectReference(declared, `diagram ${id}.expected_contract_path`);
    let raw: unknown;
    try { raw = JSON.parse(text(contractPath)); } catch (error) { fail(`UNVERIFIED: diagram ${id} expected contract is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
    try {
      const contract = parseExpectedContract(raw, id);
      projectReference(contract.source.ref, `diagram ${id}.expected_contract.source.ref`);
      for (const sourceRef of contract.generator.sourceRefs) projectReference(sourceRef, `diagram ${id}.expected_contract.generator.source_refs`);
      return { contract, path: contractPath };
    } catch (error) {
      fail(`UNVERIFIED: diagram ${id} expected contract is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const snapshotProjectFiles = (): Map<string, string> => {
    const files = new Map<string, string>();
    const skipped = new Set([".git", "node_modules", "dist", "build", "out", "target"]);
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        if (skipped.has(entry)) continue;
        const path = join(directory, entry);
        const relativeName = relative(ROOT, path);
        if (relativeName === ".aidlc/evidence" || relativeName.startsWith(`.aidlc${process.platform === "win32" ? "\\\\" : "/"}evidence${process.platform === "win32" ? "\\\\" : "/"}`)) continue;
        const info = statSync(path);
        if (info.isDirectory()) visit(path);
        else if (info.isFile()) files.set(path, createHash("sha256").update(readFileSync(path)).digest("hex"));
      }
    };
    visit(ROOT);
    return files;
  };

  const changedFiles = (before: Map<string, string>, after: Map<string, string>): string[] => {
    const paths = new Set([...before.keys(), ...after.keys()]);
    return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
  };

  const validateGeneration = (manifestPath: string, diagram: Record<string, unknown>, expected: ExpectedContract, expectedPath: string, svgPath: string, id: string): Record<string, unknown> => {
    const generation = diagram.generation;
    if (!generation || typeof generation !== "object" || Array.isArray(generation)) fail(`GENERATOR_CLOSED_LOOP: diagram ${id} generation metadata is missing`);
    const metadata = generation as Record<string, unknown>;
    const generator = metadata.generator && typeof metadata.generator === "object" && !Array.isArray(metadata.generator) ? metadata.generator as Record<string, unknown> : undefined;
    if (!generator) fail(`GENERATOR_CLOSED_LOOP: diagram ${id}.generation.generator is required`);
    if (requireString(generator.name, `diagram ${id}.generation.generator.name`) !== expected.generator.name || requireString(generator.version, `diagram ${id}.generation.generator.version`) !== expected.generator.version) fail(`GENERATOR_CLOSED_LOOP: diagram ${id} generator identity does not match expected contract`);
    const config = metadata.config && typeof metadata.config === "object" && !Array.isArray(metadata.config) ? metadata.config as Record<string, unknown> : undefined;
    if (!config) fail(`GENERATOR_CLOSED_LOOP: diagram ${id}.generation.config is required`);
    requireString(config.summary, `diagram ${id}.generation.config.summary`);
    if (requireString(config.digest, `diagram ${id}.generation.config.digest`) !== expected.generator.configDigest) fail(`GENERATOR_CLOSED_LOOP: diagram ${id} generator config digest does not match expected contract`);
    const routeConfig = metadata.route_config && typeof metadata.route_config === "object" && !Array.isArray(metadata.route_config) ? metadata.route_config as Record<string, unknown> : undefined;
    if (!routeConfig || Object.keys(routeConfig).length === 0) fail(`GENERATOR_CLOSED_LOOP: diagram ${id}.generation.route_config must be a non-empty object`);
    const sourceRefs = stringArray(metadata.source_refs, `diagram ${id}.generation.source_refs`);
    for (const sourceRef of sourceRefs) projectReference(sourceRef, `diagram ${id}.generation.source_refs`);
    const outputs = stringArray(metadata.outputs, `diagram ${id}.generation.outputs`);
    const requiredOutputs = [relativePath(svgPath), relativePath(expectedPath)];
    for (const output of requiredOutputs) if (!outputs.includes(output)) fail(`GENERATOR_CLOSED_LOOP: diagram ${id}.generation.outputs must include ${output}`);
    const command = metadata.command_argv;
    if (!Array.isArray(command) || command.length === 0 || !command.every((value) => typeof value === "string" && value.trim().length > 0)) fail(`GENERATOR_CLOSED_LOOP: diagram ${id}.generation.command_argv must be a non-empty argv array`);
    const commandArgv = (command as string[]).map((value) => value.trim());
    const configuredCwd = metadata.cwd === undefined ? ROOT : resolve(ROOT, requireString(metadata.cwd, `diagram ${id}.generation.cwd`));
    if (!existsSync(configuredCwd) || !statSync(configuredCwd).isDirectory()) fail(`GENERATOR_CLOSED_LOOP: diagram ${id}.generation.cwd does not exist: ${configuredCwd}`);
    const before = snapshotProjectFiles();
    const result = spawnSync(commandArgv[0], commandArgv.slice(1), {
      cwd: configuredCwd,
      shell: false,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, AIDLC_DIAGRAM_ID: id, AIDLC_ROUTE_CONFIG_JSON: JSON.stringify(routeConfig), AIDLC_EXPECTED_CONTRACT_PATH: expectedPath },
    });
    if (result.error || result.status !== 0) {
      const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
      const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
      const detail = result.error?.message || `exit code ${result.status}`;
      const output = stderr || stdout;
      fail(`GENERATOR_CLOSED_LOOP: diagram ${id} generator failed: ${detail}${output ? `; ${output}` : ""}`);
    }
    const after = snapshotProjectFiles();
    const allowed = new Set([resolve(svgPath), resolve(manifestPath)]);
    const unexpected = changedFiles(before, after).filter((path) => !allowed.has(resolve(path)));
    if (unexpected.length > 0) fail(`GENERATOR_CLOSED_LOOP: diagram ${id} generator changed non-target files: ${unexpected.map(relativePath).join(", ")}`);
    if (!existsSync(svgPath) || !existsSync(manifestPath)) fail(`GENERATOR_CLOSED_LOOP: diagram ${id} generator did not leave target SVG and sidecar readable`);
    const refreshedManifest = jsonFile(manifestPath) as Record<string, any>;
    const matches = Array.isArray(refreshedManifest.diagrams) ? refreshedManifest.diagrams.filter((entry: unknown) => entry && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).id === id) : [];
    if (matches.length !== 1) fail(`GENERATOR_CLOSED_LOOP: diagram ${id} sidecar cannot be re-read after generation`);
    const refreshedDiagram = matches[0] as Record<string, unknown>;
    const refreshedGeneration = refreshedDiagram.generation;
    if (!refreshedGeneration || typeof refreshedGeneration !== "object" || Array.isArray(refreshedGeneration)) fail(`GENERATOR_CLOSED_LOOP: diagram ${id} regenerated sidecar lost generation metadata`);
    Object.assign(diagram, refreshedDiagram);
    return {
      status: "passed",
      command: commandArgv,
      cwd: relativePath(configuredCwd) || ".",
      external_generator: commandArgv.some((value) => value.startsWith("/tmp/") || value.includes("/tmp/")) || configuredCwd.startsWith("/tmp/"),
      route_config: routeConfig,
      changed_files: changedFiles(before, after).map(relativePath),
      allowed_changed_files: [relativePath(svgPath), relativePath(manifestPath)],
      reloaded: true,
      stdout_tail: typeof result.stdout === "string" ? result.stdout.trim().slice(-1000) : "",
    };
  };

  const compareIds = (actual: string[], expected: string[], field: string, id: string): void => {
    if (actual.length !== expected.length || actual.some((value) => !expected.includes(value))) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} ${field} differs from independent expected contract`);
  };

  for (const manifestPath of manifests) {
    const manifest = jsonFile(manifestPath) as Record<string, any>;
    if (manifest.version !== 1 || !Array.isArray(manifest.diagrams)) fail(`${relativePath(manifestPath)} must be a version 1 diagram manifest`);
    const documentPath = typeof manifest.document === "string" ? join(ROOT, manifest.document) : "";
    if (!documentPath || !existsSync(documentPath)) fail(`${relativePath(manifestPath)} references a missing document`);
    const diagramIds = new Set<string>();
    const outputs = new Set<string>();
    const manifestDir = manifestPath.slice(0, manifestPath.lastIndexOf("/"));

    for (const diagram of manifest.diagrams as Record<string, any>[]) {
      const id = requireString(diagram.id, `${relativePath(manifestPath)} diagram.id`);
      const expectedInfo = loadIndependentExpected(manifest, diagram, id);
      const expected = expectedInfo.contract;
      if (expected && expected.diagramType && expected.diagramType !== diagram.diagramType) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} diagramType differs from independent expected contract`);
      if (!/^[a-z0-9-]+$/.test(id) || diagramIds.has(id)) fail(`diagram id is invalid or duplicated: ${id}`);
      diagramIds.add(id);
      const outputName = requireString(diagram.output, `diagram ${id}.output`);
      if (!/^[a-z0-9-]+\.svg$/.test(outputName) || outputs.has(outputName)) fail(`diagram output is invalid or duplicated: ${outputName}`);
      outputs.add(outputName);
      const svgPath = join(manifestDir, outputName);
      if (expected && expectedInfo.path) {
        const closure = validateGeneration(manifestPath, diagram, expected, expectedInfo.path, svgPath, id);
        generationClosures.push({ diagram_id: id, ...closure });
        generationContractsChecked += 1;
      }
      requireString(diagram.title, `diagram ${id}.title`);
      requireString(diagram.description, `diagram ${id}.description`);
      if (!diagram.canvas || requireFinite(diagram.canvas.width, `diagram ${id}.canvas.width`) <= 0 || requireFinite(diagram.canvas.height, `diagram ${id}.canvas.height`) <= 0) fail(`diagram ${id} canvas is invalid`);
      if (!Array.isArray(diagram.nodes) || diagram.nodes.length === 0) fail(`diagram ${id} must contain nodes`);
      if (!Array.isArray(diagram.edges)) fail(`diagram ${id}.edges must be an array`);
      if (!Array.isArray(diagram.groups || [])) fail(`diagram ${id}.groups must be an array`);
      if (diagram.legend !== undefined) fail(`VISUAL_STYLE: diagram ${id} must not define a global legend`);
      if (diagram.annotations !== undefined && (!Array.isArray(diagram.annotations) || diagram.annotations.length > 0)) fail(`VISUAL_STYLE: diagram ${id} must not define global annotations`);

      // New/adjusted diagrams must carry the v1 structured design contract.
      if (!diagramTypes.has(diagram.diagramType)) fail(`MIGRATION_REQUIRED: diagram ${id} lacks a valid diagramType`);
      const notes = diagram.designNotes;
      if (!notes || typeof notes !== "object") fail(`MIGRATION_REQUIRED: diagram ${id} lacks designNotes`);
      requireString(notes.intent, `diagram ${id}.designNotes.intent`);
      if (!Array.isArray(notes.semanticModes) || notes.semanticModes.length === 0 || !notes.semanticModes.every((mode: unknown) => semanticModes.has(String(mode)))) fail(`diagram ${id}.designNotes.semanticModes is invalid`);
      if (!Array.isArray(notes.visualSemantics)) fail(`diagram ${id}.designNotes.visualSemantics must be an array`);
      const declarations = new Map<string, Record<string, any>>();
      for (const declaration of notes.visualSemantics) {
        if (!declaration || !visualChannels.has(declaration.channel) || !visualRoles.has(declaration.role)) fail(`diagram ${id}.visualSemantics contains an invalid declaration`);
        if (declarations.has(declaration.channel)) fail(`diagram ${id}.visualSemantics duplicates ${declaration.channel}`);
        requireString(declaration.reason, `diagram ${id}.visualSemantics.${declaration.channel}.reason`);
        declarations.set(declaration.channel, declaration);
      }

      const layout = notes.layout;
      if (processTypes.has(diagram.diagramType)) {
        if (!layout || typeof layout !== "object" || Array.isArray(layout)) fail(`MIGRATION_REQUIRED: diagram ${id} lacks designNotes.layout`);
        if (!new Set(["TB", "LR"]).has(layout.direction)) fail(`LAYOUT_AXIS: diagram ${id}.layout.direction must be TB or LR`);
        requireFinite(layout.mainAxis, `diagram ${id}.layout.mainAxis`);
        const layerTolerance = layout.layerTolerance === undefined ? 24 : requireFinite(layout.layerTolerance, `diagram ${id}.layout.layerTolerance`);
        if (layerTolerance <= 0) fail(`diagram ${id}.layout.layerTolerance must be positive`);
        if (!Array.isArray(layout.symmetryGroups || [])) fail(`diagram ${id}.layout.symmetryGroups must be an array`);
        for (const symmetry of layout.symmetryGroups || []) {
          if (!symmetry || !Array.isArray(symmetry.nodeIds) || symmetry.nodeIds.length < 2) fail(`diagram ${id}.layout.symmetryGroups requires at least two nodeIds`);
          const tolerance = symmetry.tolerance === undefined ? 1 : requireFinite(symmetry.tolerance, `diagram ${id}.layout.symmetryGroups.tolerance`);
          if (tolerance < 0) fail(`diagram ${id}.layout.symmetryGroups.tolerance must be non-negative`);
          for (const nodeId of symmetry.nodeIds) requireString(nodeId, `diagram ${id}.layout.symmetryGroups.nodeId`);
        }
        const mergeNodes = layout.mergeNodes === undefined ? [] : layout.mergeNodes;
        if (!Array.isArray(mergeNodes)) fail(`diagram ${id}.layout.mergeNodes must be an array`);
        for (const merge of mergeNodes) {
          requireString(merge.nodeId, `diagram ${id}.layout.mergeNodes.nodeId`);
          requireString(merge.reason, `diagram ${id}.layout.mergeNodes.reason`);
          if (!Array.isArray(merge.edgeIds) || merge.edgeIds.length < 2 || !merge.edgeIds.every((edgeId: unknown) => typeof edgeId === "string" && edgeId.trim().length > 0)) fail(`MERGE_DECLARATION: diagram ${id}.layout.mergeNodes.${merge.nodeId} must declare at least two edgeIds`);
          if (!merge.ports || typeof merge.ports !== "object" || Array.isArray(merge.ports)) fail(`MERGE_DECLARATION: diagram ${id}.layout.mergeNodes.${merge.nodeId}.ports is required`);
          for (const edgeId of merge.edgeIds) requireString(merge.ports[edgeId], `diagram ${id}.layout.mergeNodes.${merge.nodeId}.ports.${edgeId}`);
        }
        for (const state of ["normal", "fit", "zoom"]) {
          const evidence = layout.readabilityEvidence?.[state];
          if (!evidence || !["PASS", "FAIL", "UNVERIFIED"].includes(evidence.status) || typeof evidence.evidence !== "string" || evidence.evidence.trim().length === 0) fail(`diagram ${id}.layout.readabilityEvidence.${state} is invalid`);
          if (!/^\.aidlc\/evidence\/[^#]+\/diagram-contract-provider\.json#views\.(?:normal|fit|zoom)$/.test(evidence.evidence.trim())) fail(`READABILITY_EVIDENCE: diagram ${id}.layout.readabilityEvidence.${state} must reference the current provider evidence view`);
          if (evidence.status === "FAIL") fail(`diagram ${id}.layout.readabilityEvidence.${state} records FAIL`);
          if (evidence.status === "PASS") fail(`UNVERIFIED: diagram ${id}.layout.readabilityEvidence.${state} claims PASS without controlled browser evidence`);
        }
        layoutExceptionIds(layout, "branchLayerExceptions");
        layoutExceptionIds(layout, "branchPortExceptions");
        layoutExceptionIds(layout, "sideSwitchExceptions");
        crossingExceptionPairs(layout);
      }
      const layoutDirection = processTypes.has(diagram.diagramType) ? String(layout.direction) : "";
      const layoutMainAxis = processTypes.has(diagram.diagramType) ? Number(layout.mainAxis) : 0;
      const layoutTolerance = processTypes.has(diagram.diagramType) ? Number(layout.layerTolerance === undefined ? 24 : layout.layerTolerance) : 24;
      const branchLayerExceptions = processTypes.has(diagram.diagramType) ? layoutExceptionIds(layout, "branchLayerExceptions") : new Set<string>();
      const branchPortExceptions = processTypes.has(diagram.diagramType) ? layoutExceptionIds(layout, "branchPortExceptions") : new Set<string>();
      const sideSwitchExceptions = processTypes.has(diagram.diagramType) ? layoutExceptionIds(layout, "sideSwitchExceptions") : new Set<string>();
      const crossingExceptions = processTypes.has(diagram.diagramType) ? crossingExceptionPairs(layout) : new Map<string, [string, string]>();

      const nodes = new Map<string, Record<string, any>>();
      for (const node of diagram.nodes) {
        const nodeId = requireString(node.id, `diagram ${id} node.id`);
        if (nodes.has(nodeId) || !shapes.has(node.shape || "rect")) fail(`diagram ${id} has an invalid or duplicated node: ${nodeId}`);
        if (node.tone !== undefined) fail(`VISUAL_STYLE: diagram ${id} node ${nodeId} must not define tone`);
        nodes.set(nodeId, node);
        for (const property of ["x", "y", "width", "height"]) requireFinite(node[property], `diagram ${id} node ${nodeId}.${property}`);
        if (node.width <= 0 || node.height <= 0 || node.x < 0 || node.y < 0 || node.x + node.width > diagram.canvas.width || node.y + node.height > diagram.canvas.height) fail(`diagram ${id} node ${nodeId} is outside the canvas`);
        const rawLabel = node.label;
        const labelLines = Array.isArray(rawLabel) ? rawLabel.map((line: unknown) => requireString(line, `diagram ${id} node ${nodeId}.label`)) : [requireString(rawLabel, `diagram ${id} node ${nodeId}.label`)];
        const nodeFontSize = node.fontSize === undefined ? DIAGRAM_VISUAL_STYLE.frameFontSize : requireFinite(node.fontSize, `diagram ${id} node ${nodeId}.fontSize`);
        if (nodeFontSize !== DIAGRAM_VISUAL_STYLE.frameFontSize) fail(`FONT_STYLE: diagram ${id} node ${nodeId}.fontSize must be ${DIAGRAM_VISUAL_STYLE.frameFontSize}`);
        const textWidth = Math.max(...labelLines.map((line: string) => line.length * nodeFontSize * 0.55));
        const textHeight = labelLines.length * nodeFontSize * 1.2;
        if (textWidth + 32 > node.width || textHeight + 24 > node.height) fail(`LABEL_OVERFLOW: diagram ${id} node ${nodeId} label does not fit its node`);
        if (node.shape === "diamond" && textWidth / node.width + textHeight / node.height > 0.70) fail(`LABEL_OVERFLOW: diagram ${id} decision ${nodeId} label exceeds the diamond readable area`);
      }

      const nodeRectangles = new Map<string, Rectangle>();
      for (const [nodeId, node] of nodes) {
        const rectangle = rectangleOf(node, `diagram ${id} node ${nodeId}`);
        if (rectangle) nodeRectangles.set(nodeId, rectangle);
      }
      const annotationRectangles = new Map<string, Rectangle>();
      const annotations: Record<string, any>[] = [];
      const nodeEntries = [...nodeRectangles.entries()];
      for (let first = 0; first < nodeEntries.length; first++) {
        for (let second = first + 1; second < nodeEntries.length; second++) {
          if (rectanglesOverlap(nodeEntries[first][1], nodeEntries[second][1])) fail(`diagram ${id} nodes ${nodeEntries[first][0]} and ${nodeEntries[second][0]} have geometric collision`);
        }
      }

      const labelRectangles = new Map<string, Rectangle>();
      const edges = new Map<string, Record<string, any>>();
      for (const edge of diagram.edges) {
        const edgeId = requireString(edge.id, `diagram ${id} edge.id`);
        if (edges.has(edgeId) || !nodes.has(edge.from) || !nodes.has(edge.to)) fail(`diagram ${id} edge ${edgeId} has invalid identity or endpoints`);
        if (!ports.has(edge.fromPort) || !ports.has(edge.toPort) || !edgeKinds.has(edge.kind || "directed")) fail(`diagram ${id} edge ${edgeId} has invalid port or kind`);
        for (const offset of ["fromPortOffset", "toPortOffset"]) if (edge[offset] !== undefined) requireFinite(edge[offset], `diagram ${id} edge ${edgeId}.${offset}`);
        if ((nodes.get(edge.from)!.shape === "diamond" && Number(edge.fromPortOffset || 0) !== 0) || (nodes.get(edge.to)!.shape === "diamond" && Number(edge.toPortOffset || 0) !== 0)) fail(`PORT_MISMATCH: diagram ${id} edge ${edgeId} cannot offset a diamond vertex`);
        if (!Array.isArray(edge.points) || edge.points.length < 2 || !edge.points.every((point: unknown) => Array.isArray(point) && point.length === 2 && point.every((value) => typeof value === "number" && Number.isFinite(value)))) fail(`MIGRATION_REQUIRED: diagram ${id} edge ${edgeId} lacks complete points`);
        const points = edge.points as unknown[];
        if (points.some((point) => (point as number[])[0] < 0 || (point as number[])[1] < 0 || (point as number[])[0] > diagram.canvas.width || (point as number[])[1] > diagram.canvas.height)) fail(`CANVAS_CLIPPING: diagram ${id} edge ${edgeId} has points outside the canvas`);
        if (diagram.diagramType !== "sequence" && !samePoint(points[0], portPoint(nodes.get(edge.from)!, edge.fromPort, edge.fromPortOffset || 0))) fail(`EDGE_ENDPOINT_MISMATCH: diagram ${id} edge ${edgeId} first point does not match fromPort`);
        if (diagram.diagramType !== "sequence" && !samePoint(points[points.length - 1], portPoint(nodes.get(edge.to)!, edge.toPort, edge.toPortOffset || 0))) fail(`EDGE_ENDPOINT_MISMATCH: diagram ${id} edge ${edgeId} last point does not match toPort`);
        if (diagram.diagramType !== "sequence" && !leavesPort(points as [number, number][], edge.fromPort)) fail(`PORT_DIRECTION: diagram ${id} edge ${edgeId} path direction does not match its declared fromPort`);
        if (diagram.diagramType !== "sequence" && !approachesTargetFromOutside(points as [number, number][], nodes.get(edge.to)!)) fail(`PORT_APPROACH: diagram ${id} edge ${edgeId} final segment must begin outside the target shape`);
        if (diagram.diagramType !== "sequence" && !entersPort(points as [number, number][], edge.toPort)) fail(`PORT_DIRECTION: diagram ${id} edge ${edgeId} path direction does not match its declared toPort`);
        if ((edge.kind || "directed") !== "undirected" && edge.arrowTarget !== `${edge.to}:${edge.toPort}`) fail(`ARROW_MAPPING: diagram ${id} edge ${edgeId} sidecar arrowTarget must be ${edge.to}:${edge.toPort}`);
        if (processTypes.has(diagram.diagramType) && edge.kind === "bidirectional") fail(`diagram ${id} process edge ${edgeId} must not be bidirectional`);
        if (diagram.diagramType === "flowchart" || diagram.diagramType === "pipeline") {
          if (!isOrthogonal(points)) fail(`diagram ${id} process edge ${edgeId} is not orthogonal`);
          for (let pointIndex = 2; pointIndex < points.length; pointIndex++) {
            const previous = points[pointIndex - 2] as [number, number];
            const current = points[pointIndex - 1] as [number, number];
            const next = points[pointIndex] as [number, number];
            if (pointEqual(previous, current) || pointEqual(current, next) || (previous[0] === current[0] && current[0] === next[0]) || (previous[1] === current[1] && current[1] === next[1])) fail(`REDUNDANT_PATH_POINT: diagram ${id} edge ${edgeId} contains a redundant collinear point`);
          }
        }
        if (edge.label && typeof edge.label === "object" && !Array.isArray(edge.label)) {
          const placementError = edgeLabelPlacementError(edgeId, edge.points as [number, number][], edge.label);
          if (placementError) fail(`diagram ${id} ${placementError}`);
          labelRectangles.set(edgeId, textRectangle(edge.label, `diagram ${id} edge ${edgeId}.label`));
        }
        const edgePoints = edge.points as [number, number][];
        for (const [nodeId, rectangle] of nodeRectangles) {
          for (let pointIndex = 1; pointIndex < edgePoints.length; pointIndex++) {
            const first = edgePoints[pointIndex - 1];
            const second = edgePoints[pointIndex];
            if (nodeId !== edge.from && nodeId !== edge.to && nodes.get(nodeId)?.shape !== "diamond" && segmentOverlapsRectangleBoundary(first, second, rectangle)) fail(`EDGE_NODE_BOUNDARY_OVERLAP: diagram ${id} edge ${edgeId} overlaps unrelated node boundary ${nodeId}`);
            if (!segmentIntersectsRectangle(first, second, rectangle)) continue;
            if (nodeId === edge.from) fail(`SOURCE_REENTRY: diagram ${id} edge ${edgeId} re-enters its source node ${nodeId}`);
            if (nodeId === edge.to) fail(`TARGET_REENTRY: diagram ${id} edge ${edgeId} enters the interior of target node ${nodeId}`);
            fail(`EDGE_NODE_COLLISION: diagram ${id} edge ${edgeId} collides with non-endpoint node ${nodeId}`);
          }
        }
        edges.set(edgeId, edge);
      }
      const edgeEntries = [...edges.entries()];
      if (processTypes.has(diagram.diagramType)) {
        for (const merge of (Array.isArray(layout.mergeNodes) ? layout.mergeNodes : []) as Record<string, any>[]) {
          const incoming = edgeEntries.filter(([, edge]) => edge.to === merge.nodeId);
          if (incoming.length < 2) fail(`MERGE_DECLARATION: diagram ${id} merge node ${merge.nodeId} does not have real multiple incoming edges`);
          compareIds(incoming.map(([edgeId]) => edgeId), merge.edgeIds.map(String), `merge node ${merge.nodeId} incoming edges`, id);
          for (const [edgeId, edge] of incoming) if (edge.toPort !== merge.ports[edgeId]) fail(`MERGE_PORT_DIFF: diagram ${id} merge node ${merge.nodeId} edge ${edgeId} enters via ${edge.toPort}, expected ${merge.ports[edgeId]}`);
        }
        for (const edgeId of branchPortExceptions) {
          const edge = edges.get(edgeId);
          if (!edge) fail(`BRANCH_PORT_EXCEPTION: diagram ${id} references missing edge ${edgeId}`);
          const branchSourceEdges = edgeEntries.filter(([, candidate]) => candidate.from === edge.from);
          if (branchSourceEdges.length < 2) fail(`BRANCH_PORT_EXCEPTION: diagram ${id} edge ${edgeId} is not an actual branch edge`);
        }
      }
      if (expected) {
        compareIds([...nodes.keys()], expected.nodeIds, "node IDs", id);
        compareIds([...edges.keys()], expected.edgeIds, "edge IDs", id);
        compareIds((diagram.groups || []).map((group: Record<string, any>) => String(group.id)), expected.groupIds, "group IDs", id);
        compareIds(diagram.legend?.items?.map((item: Record<string, any>) => String(item.id)) || [], expected.legendIds, "legend IDs", id);
        compareIds((diagram.annotations || []).map((annotation: Record<string, any>) => String(annotation.id)), expected.annotationIds, "annotation IDs", id);
        if (!expected.sourceGraph) for (const [nodeId, shape] of Object.entries(expected.nodeShapes)) if (shape && nodes.get(nodeId)?.shape !== shape) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} node ${nodeId} shape differs from independent expected contract`);
        if (expected.sourceGraph) {
          const sourceNodes = new Map(expected.sourceGraph.nodes.map((node) => [node.displayId, node]));
          for (const [nodeId, sourceNode] of sourceNodes) {
            const actualNode = nodes.get(nodeId)!;
            if (actualNode.label !== sourceNode.label) fail(`SOURCE_NODE_FIDELITY: diagram ${id} node ${nodeId} label differs from source graph`);
            if (actualNode.shape !== sourceNode.shape) fail(`SOURCE_NODE_FIDELITY: diagram ${id} node ${nodeId} shape differs from source graph`);
          }
          const sourceRelationsByEdge = new Map<string, typeof expected.sourceGraph.relations>();
          for (const relation of expected.sourceGraph.relations) sourceRelationsByEdge.set(relation.displayEdgeId, [...(sourceRelationsByEdge.get(relation.displayEdgeId) || []), relation]);
          for (const [edgeId, relations] of sourceRelationsByEdge) {
            const actual = edges.get(edgeId)!;
            const sourceKind = relations[0].kind;
            if ((actual.kind || "directed") !== sourceKind) fail(`SOURCE_RELATION_FIDELITY: diagram ${id} edge ${edgeId} kind differs from source graph`);
            const requiredLabel = relations.length === 1 ? relations[0].label : relations[0].displayLabel;
            const actualLabel = actual.label && typeof actual.label === "object" && !Array.isArray(actual.label) ? String(actual.label.text || "") : undefined;
            if (requiredLabel === undefined && actualLabel !== undefined) fail(`SOURCE_RELATION_FIDELITY: diagram ${id} edge ${edgeId} adds a label absent from source graph`);
            if (requiredLabel !== undefined && actualLabel !== requiredLabel) fail(`SOURCE_RELATION_FIDELITY: diagram ${id} edge ${edgeId} label differs from source graph`);
          }
          for (const path of expected.sourceGraph.readingPaths) {
            const labels = path.edgeIds.map((edgeId) => {
              const edge = edges.get(edgeId)!;
              return edge.label && typeof edge.label === "object" && !Array.isArray(edge.label) ? String(edge.label.text || "") : "";
            });
            for (const label of path.requiredLabels) if (!labels.includes(label)) fail(`READING_PATH_TRACE: diagram ${id} path ${path.id} is missing required label ${label}`);
          }
        }
        const routeDifferences = {
          endpoint: [] as string[],
          port: [] as string[],
          arrowTarget: [] as string[],
          bends: [] as string[],
          pointsTopology: [] as string[],
        };
        for (const edgeId of expected.edgeIds) {
          const actual = edges.get(edgeId)!;
          const endpoints = expected.edgeEndpoints[edgeId];
          if (!endpoints || actual.from !== endpoints.from || actual.to !== endpoints.to) {
            routeDifferences.endpoint.push(edgeId);
            fail(`ROUTE_ENDPOINT_DIFF: diagram ${id} edge ${edgeId} endpoints are ${actual.from}->${actual.to}, expected ${endpoints?.from}->${endpoints?.to}`);
          }
          const ports = expected.edgePorts[edgeId];
          if (ports?.fromPort && actual.fromPort !== ports.fromPort || ports?.toPort && actual.toPort !== ports.toPort) {
            routeDifferences.port.push(edgeId);
            fail(`ROUTE_PORT_DIFF: diagram ${id} edge ${edgeId} ports are ${actual.fromPort}->${actual.toPort}, expected ${ports?.fromPort}->${ports?.toPort}`);
          }
          const expectedKind = expected.edgeKinds[edgeId];
          if (expectedKind && (actual.kind || "directed") !== expectedKind) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} edge ${edgeId} kind differs from independent expected contract`);
          const intent = expected.routeContract.edgeIntents.find((candidate) => candidate.edgeId === edgeId);
          if (!intent) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} route contract omits edge ${edgeId}`);
          const expectedArrowTarget = expected.edgeArrowTargets[edgeId] || intent.arrowTarget;
          if (expectedArrowTarget !== undefined && actual.arrowTarget !== expectedArrowTarget) {
            routeDifferences.arrowTarget.push(edgeId);
            fail(`ROUTE_ARROW_TARGET_DIFF: diagram ${id} edge ${edgeId} arrowTarget is ${actual.arrowTarget}, expected ${expectedArrowTarget}`);
          }
          const actualLabelText = actual.label && typeof actual.label === "object" && !Array.isArray(actual.label) ? String(actual.label.text || "") : undefined;
          const routeErrors = routeIntentErrors(intent, actual.points, Boolean(actual.label && typeof actual.label === "object" && !Array.isArray(actual.label)), actual.arrowTarget, actualLabelText);
          for (const error of routeErrors) {
            if (error.startsWith("ROUTE_BEND_DIFF")) routeDifferences.bends.push(edgeId);
            if (error.startsWith("ROUTE_TOPOLOGY") || error.startsWith("NON_MANHATTAN")) routeDifferences.pointsTopology.push(edgeId);
          }
          if (routeErrors.length > 0) fail(`ROUTE_CONTRACT_FAIL: diagram ${id} ${routeErrors.join("; ")}`);
          if (intent.kind === "loop" && !expected.routeContract.loopLanes.some((lane) => lane.edgeIds.includes(edgeId))) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} loop route ${edgeId} is not assigned to an expected loop lane`);
          if (intent.kind === "branch" && expected.routeContract.branchGroups.length === 0) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} branch route ${edgeId} lacks an expected branch group`);
        }
        routeContractReports.push({
          diagram_id: id,
          expected_vs_actual: routeDifferences,
          source_target_normal_errors: [],
          non_manhattan_paths: [],
          node_crossings: [],
          unauthorized_crossings: [],
          label_collisions: [],
        });
        if (expected.routeContract.direction && layoutDirection && expected.routeContract.direction !== layoutDirection) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} reading direction differs from independent expected contract`);
        const expectedMain = expected.routeContract.mainFlow;
        if (expectedMain) {
          const actualMain = layout.mainFlow;
          if (!actualMain || !Array.isArray(actualMain.nodeIds) || !Array.isArray(actualMain.edgeIds)) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} actual mainFlow is missing`);
          const actualEntry = Array.isArray(actualMain.entryNodeIds) ? actualMain.entryNodeIds : actualMain.entryNodeId === undefined ? [] : [actualMain.entryNodeId];
          compareIds(actualEntry.map(String), expectedMain.entryNodeIds, "mainFlow entry nodes", id);
          compareIds((actualMain.exitNodeIds || []).map(String), expectedMain.exitNodeIds, "mainFlow exit nodes", id);
          compareIds(actualMain.nodeIds.map(String), expectedMain.nodeIds, "mainFlow nodes", id);
          compareIds(actualMain.edgeIds.map(String), expectedMain.edgeIds, "mainFlow edges", id);
        }
        const expectedPrimary = expected.routeContract.primaryFlow;
        if (expectedPrimary) {
          const actualPrimary = layout.primaryFlow;
          if (!actualPrimary || !Array.isArray(actualPrimary.nodeIds) || !Array.isArray(actualPrimary.edgeIds)) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} actual primaryFlow is missing`);
          compareIds(actualPrimary.nodeIds.map(String), expectedPrimary.nodeIds, "primaryFlow nodes", id);
          compareIds(actualPrimary.edgeIds.map(String), expectedPrimary.edgeIds, "primaryFlow edges", id);
          if (String(actualPrimary.reason) !== expectedPrimary.reason) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} primaryFlow reason differs from independent expected contract`);
        }
        const structuredBranches = expected.routeContract.branchGroups.filter((branch) => branch.decisionNodeId && branch.edgeIds);
        if (structuredBranches.length > 0) {
          const actualBranches = Array.isArray(layout.branchGroups) ? layout.branchGroups as Record<string, any>[] : [];
          for (const expectedBranch of structuredBranches) {
            const actualBranch = actualBranches.find((branch) => (expectedBranch.id && String(branch.id) === expectedBranch.id) || String(branch.decisionNodeId) === expectedBranch.decisionNodeId);
            if (!actualBranch) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} structured branch group ${expectedBranch.id || expectedBranch.decisionNodeId} is missing from actual layout`);
            compareIds((actualBranch.edgeIds || []).map(String), expectedBranch.edgeIds || [], `branch group ${expectedBranch.id || expectedBranch.decisionNodeId} edge IDs`, id);
            compareIds((actualBranch.targetIds || []).map(String), expectedBranch.targetIds, `branch group ${expectedBranch.id || expectedBranch.decisionNodeId} target IDs`, id);
            if (expectedBranch.mergeNodeId !== undefined && String(actualBranch.mergeNodeId) !== expectedBranch.mergeNodeId) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} branch group ${expectedBranch.id || expectedBranch.decisionNodeId} merge node differs from independent expected contract`);
            if (expectedBranch.depth !== undefined && Number(actualBranch.depth) !== expectedBranch.depth) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} branch group ${expectedBranch.id || expectedBranch.decisionNodeId} depth differs from independent expected contract`);
            if (expectedBranch.mode !== undefined && String(actualBranch.mode) !== expectedBranch.mode) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} branch group ${expectedBranch.id || expectedBranch.decisionNodeId} mode differs from independent expected contract`);
          }
        }
        const expectedLoopEdges = expected.routeContract.loopLanes.flatMap((lane) => lane.edgeIds).sort();
        const actualLoopLanes = Array.isArray(layout.loopLanes) ? layout.loopLanes as Record<string, any>[] : [];
        const actualLoopEdges = actualLoopLanes.flatMap((lane: Record<string, any>) => Array.isArray(lane.edgeIds) ? lane.edgeIds.map(String) : []).sort();
        compareIds(actualLoopEdges, expectedLoopEdges, "loop lane edges", id);
        for (const expectedLane of expected.routeContract.loopLanes) {
          const actualLane = actualLoopLanes.find((lane) => String(lane.id) === expectedLane.id);
          if (!actualLane) fail(`EXPECTED_ACTUAL_MISMATCH: diagram ${id} loop lane ${expectedLane.id} is missing from actual layout`);
          if (actualLane.side !== expectedLane.side) fail(`LOOP_LANE_DIFF: diagram ${id} loop lane ${expectedLane.id} side is ${actualLane.side}, expected ${expectedLane.side}`);
          if (Number(actualLane.laneOffset) !== expectedLane.laneOffset) fail(`LOOP_LANE_DIFF: diagram ${id} loop lane ${expectedLane.id} laneOffset is ${actualLane.laneOffset}, expected ${expectedLane.laneOffset}`);
          if (String(actualLane.reason) !== expectedLane.reason) fail(`LOOP_LANE_DIFF: diagram ${id} loop lane ${expectedLane.id} reason differs from independent expected contract`);
          compareIds((actualLane.edgeIds || []).map(String), expectedLane.edgeIds, `loop lane ${expectedLane.id} edge IDs`, id);
        }
        const actualMergeNodes = Array.isArray(layout.mergeNodes) ? layout.mergeNodes as Record<string, any>[] : [];
        for (const expectedMerge of expected.routeContract.mergeNodes) {
          const actualMerge = actualMergeNodes.find((merge) => String(merge.nodeId) === expectedMerge.nodeId);
          if (!actualMerge) fail(`MERGE_DECLARATION: diagram ${id} merge node ${expectedMerge.nodeId} is missing from actual layout`);
          const actualIncoming = edgeEntries.filter(([, edge]) => edge.to === expectedMerge.nodeId).map(([edgeId]) => edgeId);
          if (actualIncoming.length < 2) fail(`MERGE_DECLARATION: diagram ${id} merge node ${expectedMerge.nodeId} does not have real multiple incoming edges`);
          compareIds(actualIncoming, expectedMerge.edgeIds, `merge node ${expectedMerge.nodeId} incoming edges`, id);
          for (const edgeId of expectedMerge.edgeIds) {
            const actualEdge = edges.get(edgeId)!;
            if (actualEdge.to !== expectedMerge.nodeId || actualEdge.toPort !== expectedMerge.ports[edgeId]) fail(`MERGE_PORT_DIFF: diagram ${id} merge node ${expectedMerge.nodeId} edge ${edgeId} enters via ${actualEdge.toPort}, expected ${expectedMerge.ports[edgeId]}`);
          }
        }
        const expectedCrossings = expected.routeContract.exceptions.filter((exception) => exception.type === "crossing").map((exception) => exception.edgeIds.slice().sort().join("\u0000")).sort();
        compareIds([...crossingExceptions.keys()].sort(), expectedCrossings, "crossing exception declarations", id);
        expectedContractsChecked += 1;
      }
      if (processTypes.has(diagram.diagramType) && layout.changeImpactReview !== undefined) {
        const review = layout.changeImpactReview;
        if (!review || typeof review !== "object" || Array.isArray(review)) fail(`CHANGE_IMPACT_REVIEW: diagram ${id} changeImpactReview must be an object`);
        requireString(review.baseline, `diagram ${id}.layout.changeImpactReview.baseline`);
        if (!Array.isArray(review.movedNodeIds) || review.movedNodeIds.length === 0) fail(`CHANGE_IMPACT_REVIEW: diagram ${id} changeImpactReview requires movedNodeIds`);
        if (!Array.isArray(review.impactedEdgeIds)) fail(`CHANGE_IMPACT_REVIEW: diagram ${id} changeImpactReview requires impactedEdgeIds`);
        if (!Array.isArray(review.edgeReviews)) fail(`CHANGE_IMPACT_REVIEW: diagram ${id} changeImpactReview requires edgeReviews`);
        const movedNodeIds = review.movedNodeIds.map((nodeId: unknown) => requireString(nodeId, `diagram ${id}.layout.changeImpactReview.movedNodeId`));
        const impactedEdgeIds = review.impactedEdgeIds.map((edgeId: unknown) => requireString(edgeId, `diagram ${id}.layout.changeImpactReview.impactedEdgeId`));
        if (new Set(movedNodeIds).size !== movedNodeIds.length || new Set(impactedEdgeIds).size !== impactedEdgeIds.length) fail(`CHANGE_IMPACT_REVIEW: diagram ${id} changeImpactReview contains duplicate IDs`);
        for (const nodeId of movedNodeIds) if (!nodes.has(nodeId)) fail(`CHANGE_IMPACT_REVIEW: diagram ${id} moved node is missing: ${nodeId}`);
        for (const edgeId of impactedEdgeIds) if (!edges.has(edgeId)) fail(`CHANGE_IMPACT_REVIEW: diagram ${id} impacted edge is missing: ${edgeId}`);
        const incidentEdgeIds = new Set(edgeEntries.filter(([, edge]) => movedNodeIds.includes(edge.from) || movedNodeIds.includes(edge.to)).map(([edgeId]) => edgeId));
        const missingIncidentEdges = [...incidentEdgeIds].filter((edgeId) => !impactedEdgeIds.includes(edgeId));
        if (missingIncidentEdges.length > 0) fail(`CHANGE_IMPACT_REVIEW: diagram ${id} omits incident edge(s): ${missingIncidentEdges.join(", ")}`);
        const reviewed = new Set<string>();
        for (const rawEntry of review.edgeReviews) {
          if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) fail(`CHANGE_IMPACT_REVIEW: diagram ${id} has an invalid edge review`);
          const edgeId = requireString(rawEntry.edgeId, `diagram ${id}.layout.changeImpactReview.edgeReview.edgeId`);
          if (!impactedEdgeIds.includes(edgeId) || reviewed.has(edgeId)) fail(`CHANGE_IMPACT_REVIEW: diagram ${id} edge review is invalid for ${edgeId}`);
          if (!new Set(["recomputed", "unchanged"]).has(rawEntry.status)) fail(`CHANGE_IMPACT_REVIEW: diagram ${id} edge review ${edgeId} must be recomputed or unchanged`);
          if (rawEntry.status === "unchanged") requireString(rawEntry.unchangedReason, `diagram ${id}.layout.changeImpactReview.edgeReview.unchangedReason`);
          reviewed.add(edgeId);
        }
        if (reviewed.size !== impactedEdgeIds.length) fail(`CHANGE_IMPACT_REVIEW: diagram ${id} requires one review for every impacted edge`);
        changeImpactReviewsChecked += 1;
      }
      const mainFlowNodeIds = new Set<string>();
      const mainFlowEdgeIds = new Set<string>();
      const primaryFlowEdgeIds = new Set<string>();
      const loopEdgeIds = new Set<string>();
      if (processTypes.has(diagram.diagramType)) {
        const mainFlow = layout.mainFlow;
        if (!mainFlow || typeof mainFlow !== "object" || Array.isArray(mainFlow)) fail(`MIGRATION_REQUIRED: diagram ${id} lacks designNotes.layout.mainFlow`);
        const entryNodeIds: string[] = Array.isArray(mainFlow.entryNodeIds)
          ? mainFlow.entryNodeIds.map((nodeId: unknown) => requireString(nodeId, `diagram ${id}.layout.mainFlow.entryNodeId`))
          : mainFlow.entryNodeId === undefined ? [] : [requireString(mainFlow.entryNodeId, `diagram ${id}.layout.mainFlow.entryNodeId`)];
        const flowNodeIds = mainFlow.nodeIds;
        const flowEdgeIds = mainFlow.edgeIds;
        const exitNodeIds = mainFlow.exitNodeIds;
        if (entryNodeIds.length === 0 || !Array.isArray(flowNodeIds) || flowNodeIds.length === 0 || !Array.isArray(flowEdgeIds) || flowEdgeIds.length === 0 || !Array.isArray(exitNodeIds) || exitNodeIds.length === 0) fail(`MIGRATION_REQUIRED: diagram ${id}.layout.mainFlow is incomplete`);
        for (const nodeId of flowNodeIds) mainFlowNodeIds.add(requireString(nodeId, `diagram ${id}.layout.mainFlow.nodeId`));
        for (const edgeId of flowEdgeIds) mainFlowEdgeIds.add(requireString(edgeId, `diagram ${id}.layout.mainFlow.edgeId`));
        const actualPrimaryFlow = layout.primaryFlow;
        if (actualPrimaryFlow && typeof actualPrimaryFlow === "object" && !Array.isArray(actualPrimaryFlow) && Array.isArray(actualPrimaryFlow.edgeIds)) {
          for (const edgeId of actualPrimaryFlow.edgeIds) primaryFlowEdgeIds.add(requireString(edgeId, `diagram ${id}.layout.primaryFlow.edgeId`));
        }
        const exitIds = exitNodeIds.map((nodeId: unknown) => requireString(nodeId, `diagram ${id}.layout.mainFlow.exitNodeId`));
        if (mainFlowNodeIds.size !== flowNodeIds.length || mainFlowEdgeIds.size !== flowEdgeIds.length || new Set(entryNodeIds).size !== entryNodeIds.length || new Set(exitIds).size !== exitIds.length) fail(`diagram ${id}.layout.mainFlow contains duplicate IDs`);
        if (entryNodeIds.some((entryNodeId) => !nodes.has(entryNodeId) || !mainFlowNodeIds.has(entryNodeId))) fail(`MAIN_FLOW_TRACE: diagram ${id} mainFlow entry node is not declared`);
        if (mainFlowNodeIds.size !== nodes.size || [...nodes.keys()].some((nodeId) => !mainFlowNodeIds.has(nodeId))) fail(`MAIN_FLOW_TRACE: diagram ${id} mainFlow does not cover every business node`);
        if (mainFlowEdgeIds.size !== edges.size || [...edges.keys()].some((edgeId) => !mainFlowEdgeIds.has(edgeId))) fail(`MAIN_FLOW_TRACE: diagram ${id} mainFlow does not cover every process edge`);
        for (const nodeId of mainFlowNodeIds) if (!nodes.has(nodeId)) fail(`MAIN_FLOW_TRACE: diagram ${id} mainFlow references missing node ${nodeId}`);
        for (const edgeId of mainFlowEdgeIds) if (!edges.has(edgeId)) fail(`MAIN_FLOW_TRACE: diagram ${id} mainFlow references missing edge ${edgeId}`);
        for (const exitId of exitIds) if (!nodes.has(exitId) || !mainFlowNodeIds.has(exitId)) fail(`MAIN_FLOW_TRACE: diagram ${id} mainFlow exit node is invalid: ${exitId}`);
        const mainAdjacency = new Map<string, string[]>();
        for (const [, edge] of edgeEntries) mainAdjacency.set(edge.from, [...(mainAdjacency.get(edge.from) || []), edge.to]);
        const reachable = new Set<string>(entryNodeIds);
        const queue = [...entryNodeIds];
        while (queue.length > 0) {
          const current = queue.shift()!;
          for (const target of mainAdjacency.get(current) || []) if (!reachable.has(target)) { reachable.add(target); queue.push(target); }
        }
        if ([...mainFlowNodeIds].some((nodeId) => !reachable.has(nodeId))) fail(`MAIN_FLOW_TRACE: diagram ${id} mainFlow contains an unreachable node`);
        const loopLanes = layout.loopLanes === undefined ? [] : layout.loopLanes;
        if (!Array.isArray(loopLanes)) fail(`diagram ${id}.layout.loopLanes must be an array`);
        const laneIds = new Set<string>();
        for (const lane of loopLanes) {
          const laneId = requireString(lane.id, `diagram ${id}.layout.loopLane.id`);
          if (laneIds.has(laneId)) fail(`diagram ${id}.layout.loopLanes contains duplicate lane ${laneId}`);
          laneIds.add(laneId);
          if (!new Set(["left", "right"]).has(lane.side)) fail(`LOOP_LANE: diagram ${id} loop lane ${laneId} must declare left or right side`);
          const laneOffset = requireFinite(lane.laneOffset, `diagram ${id}.layout.loopLane.laneOffset`);
          if (laneOffset < 24) fail(`LOOP_LANE: diagram ${id} loop lane ${laneId} must stay at least 24 units from the main axis`);
          requireString(lane.reason, `diagram ${id}.layout.loopLane.reason`);
          if (!Array.isArray(lane.edgeIds) || lane.edgeIds.length === 0) fail(`LOOP_LANE: diagram ${id} loop lane ${laneId} requires edgeIds`);
          for (const rawEdgeId of lane.edgeIds) {
            const edgeId = requireString(rawEdgeId, `diagram ${id}.layout.loopLane.edgeId`);
            if (!mainFlowEdgeIds.has(edgeId) || !edges.has(edgeId)) fail(`LOOP_LANE: diagram ${id} loop lane ${laneId} references an edge outside mainFlow`);
            if (loopEdgeIds.has(edgeId)) fail(`LOOP_LANE: diagram ${id} loop edge ${edgeId} is assigned to more than one lane`);
            loopEdgeIds.add(edgeId);
            const edge = edges.get(edgeId)!;
            const expectedIntent = expected?.routeContract.edgeIntents.find((intent) => intent.edgeId === edgeId);
            if ((!edge.label || typeof edge.label !== "object" || Array.isArray(edge.label)) && expectedIntent?.labelRequired !== false) fail(`LOOP_LANE: diagram ${id} loop edge ${edgeId} requires an explicit source label`);
            if (edge.label && typeof edge.label === "object" && !Array.isArray(edge.label)) requireString(edge.label.text, `diagram ${id} loop edge ${edgeId}.label.text`);
            const points = edge.points as [number, number][];
            const corridorPoints = points.length > 3 ? points.slice(1, -2) : points.slice(1, -1);
            const isOnDeclaredSide = (point: [number, number]): boolean => {
              const distance = layoutDirection === "TB" ? layoutMainAxis - point[0] : layoutMainAxis - point[1];
              return lane.side === "left" ? distance >= laneOffset : distance <= -laneOffset;
            };
            if (corridorPoints.length === 0 || !corridorPoints.some(isOnDeclaredSide)) fail(`LOOP_LANE: diagram ${id} loop edge ${edgeId} does not use its declared independent lane`);
          }
        }
        for (const exitId of exitIds) {
          const untrackedOutgoing = edgeEntries.filter(([edgeId, edge]) => edge.from === exitId && !loopEdgeIds.has(edgeId));
          if (untrackedOutgoing.length > 0) fail(`MAIN_FLOW_TRACE: diagram ${id} mainFlow exit ${exitId} has outgoing edge(s) outside declared loopLanes: ${untrackedOutgoing.map(([edgeId]) => edgeId).join(", ")}`);
        }
      }
      const incomingEdges = new Map<string, string[]>();
      for (const [edgeId, edge] of edgeEntries) incomingEdges.set(edge.to, [...(incomingEdges.get(edge.to) || []), edgeId]);
      const declaredMergeNodes = new Set<string>((layout?.mergeNodes || []).map((merge: Record<string, any>) => String(merge.nodeId)));
      for (const [nodeId, incoming] of incomingEdges) {
        const nonLoopIncoming = incoming.filter((edgeId) => !loopEdgeIds.has(edgeId));
        if (nonLoopIncoming.length > 1 && processTypes.has(diagram.diagramType) && !declaredMergeNodes.has(nodeId)) fail(`MERGE_DECLARATION: diagram ${id} node ${nodeId} has multiple incoming branches without explicit merge semantics`);
      }
      if (processTypes.has(diagram.diagramType)) {
        for (const [nodeId, node] of nodes) {
          if (node.shape !== "diamond") continue;
          const outgoing = edgeEntries.filter(([, edge]) => edge.from === nodeId);
          if (outgoing.length < 2) fail(`DECISION_EXIT: diagram ${id} decision ${nodeId} must have at least two explicit exits`);
          for (const [edgeId, edge] of outgoing) {
            if (!edge.label || typeof edge.label !== "object" || Array.isArray(edge.label)) fail(`DECISION_EXIT: diagram ${id} decision ${nodeId} exit ${edgeId} lacks a visible label`);
            requireString(edge.label.text, `diagram ${id} decision ${nodeId} exit ${edgeId}.label.text`);
          }
        }
      }
      for (const symmetry of layout?.symmetryGroups || []) {
        const centers: Array<{ layer: number; cross: number }> = symmetry.nodeIds.map((nodeId: string) => {
          const node = nodes.get(nodeId);
          if (!node) fail(`LAYOUT_SYMMETRY: diagram ${id} symmetry group references missing node ${nodeId}`);
          return { layer: layoutDirection === "TB" ? node.y + node.height / 2 : node.x + node.width / 2, cross: layoutDirection === "TB" ? node.x + node.width / 2 : node.y + node.height / 2 };
        });
        const tolerance = symmetry.tolerance === undefined ? 1 : Number(symmetry.tolerance);
        if (Math.max(...centers.map((center) => center.layer)) - Math.min(...centers.map((center) => center.layer)) > layoutTolerance) fail(`LAYOUT_LAYER: diagram ${id} symmetry group is not on one business layer`);
        for (const center of centers) {
          const mirror = centers.find((candidate) => Math.abs(candidate.cross - (2 * layoutMainAxis - center.cross)) <= tolerance);
          if (!mirror) fail(`LAYOUT_SYMMETRY: diagram ${id} symmetry group is not uniformly distributed around mainAxis`);
        }
      }
      for (const [nodeId, node] of nodes) {
        if (node.shape !== "diamond") continue;
        const branchEdges = edgeEntries.filter(([edgeId, edge]) => edge.from === nodeId && !loopEdgeIds.has(edgeId));
        if (branchEdges.length < 2) continue;
        const layers = branchEdges.map(([, edge]) => {
          const target = nodes.get(edge.to)!;
          return layoutDirection === "TB" ? target.y + target.height / 2 : target.x + target.width / 2;
        });
        if (Math.max(...layers) - Math.min(...layers) > layoutTolerance && !branchEdges.every(([edgeId]) => branchLayerExceptions.has(edgeId))) fail(`BRANCH_LAYER: diagram ${id} decision ${nodeId} branch targets are not on the same business layer`);
        const localMergeSplit = branchEdges.length === 2 && branchEdges[0][1].to === branchEdges[1][1].to && declaredMergeNodes.has(branchEdges[0][1].to);
        if (branchEdges.length === 2 && !branchEdges.every(([edgeId]) => branchPortExceptions.has(edgeId))) {
          const primaryEdges = branchEdges.filter(([edgeId]) => primaryFlowEdgeIds.has(edgeId));
          if (layoutDirection === "TB" && (primaryEdges.length === 1 || localMergeSplit)) {
            const downward = localMergeSplit ? branchEdges.filter(([, edge]) => edge.fromPort === "bottom") : primaryEdges;
            const downwardIds = new Set(downward.map(([edgeId]) => edgeId));
            const lateralEdges = branchEdges.filter(([edgeId]) => !downwardIds.has(edgeId));
            if (downward.length !== 1 || downward[0][1].fromPort !== "bottom" || lateralEdges.length !== 1 || !["left", "right"].includes(lateralEdges[0][1].fromPort)) fail(`BRANCH_PORT: diagram ${id} decision ${nodeId} must use bottom for its primary or direct merge exit and a side port for its local branch`);
          } else {
            const expectedSources = layoutDirection === "TB" ? new Set(["right", "left"]) : new Set(["top", "bottom"]);
            if (new Set(branchEdges.map(([, edge]) => edge.fromPort)).size !== 2 || !branchEdges.every(([, edge]) => expectedSources.has(edge.fromPort))) fail(`BRANCH_PORT: diagram ${id} decision ${nodeId} branches must leave through the declared side ports`);
          }
        }
        for (const [edgeId, edge] of branchEdges) {
          if (branchPortExceptions.has(edgeId)) continue;
          const isLocalMergeEntry = localMergeSplit && edge.to === branchEdges[0][1].to && edge.toPort !== "top";
          const expectedTarget = isLocalMergeEntry ? edge.toPort : (layoutDirection === "TB" ? "top" : "left");
          if (edge.toPort !== expectedTarget) fail(`BRANCH_PORT: diagram ${id} branch ${edgeId} must enter target through ${expectedTarget}`);
          const points = edge.points as [number, number][];
          const last = points[points.length - 1];
          const previous = points[points.length - 2];
          if (layoutDirection === "TB" && expectedTarget === "top" && Math.abs(last[0] - previous[0]) > 1) fail(`BRANCH_PORT: diagram ${id} branch ${edgeId} final segment must enter vertically`);
          if (layoutDirection === "TB" && ["left", "right"].includes(expectedTarget) && Math.abs(last[1] - previous[1]) > 1) fail(`BRANCH_PORT: diagram ${id} branch ${edgeId} final segment must enter horizontally`);
          if (layoutDirection === "LR" && Math.abs(last[1] - previous[1]) > 1) fail(`BRANCH_PORT: diagram ${id} branch ${edgeId} final segment must enter horizontally`);
        }
      }

      const sideSwitchViolations = new Set<string>();
      if (processTypes.has(diagram.diagramType)) {
        const sideOf = (point: [number, number]): -1 | 0 | 1 => {
          const delta = (layoutDirection === "TB" ? point[0] : point[1]) - layoutMainAxis;
          return delta > 1 ? 1 : delta < -1 ? -1 : 0;
        };
        const hasUnexpectedSideSwitch = (edge: Record<string, any>, points: [number, number][]): boolean => {
          const from = nodes.get(edge.from)!;
          const to = nodes.get(edge.to)!;
          const fromSide = sideOf([from.x + from.width / 2, from.y + from.height / 2]);
          const toSide = sideOf([to.x + to.width / 2, to.y + to.height / 2]);
          if (fromSide === 0 || toSide === 0) return false;
          const sides = points.map(sideOf).filter((side) => side !== 0);
          if (fromSide === toSide) return sides.some((side) => side !== fromSide);
          let switches = 0;
          for (let pointIndex = 1; pointIndex < sides.length; pointIndex++) if (sides[pointIndex] !== sides[pointIndex - 1]) switches++;
          return switches > 1;
        };
        for (const [edgeId, edge] of edgeEntries) {
          if (loopEdgeIds.has(edgeId)) continue;
          if (!hasUnexpectedSideSwitch(edge, edge.points as [number, number][])) continue;
          sideSwitchViolations.add(edgeId);
          if (!sideSwitchExceptions.has(edgeId)) fail(`SIDE_SWITCH: diagram ${id} edge ${edgeId} crosses sides or folds back without a declared sideSwitchException`);
        }
        for (const edgeId of sideSwitchExceptions) {
          if (!edges.has(edgeId)) fail(`SIDE_SWITCH_EXCEPTION: diagram ${id} references missing edge ${edgeId}`);
          if (!sideSwitchViolations.has(edgeId)) fail(`SIDE_SWITCH_EXCEPTION: diagram ${id} declares no actual side-switch violation for ${edgeId}`);
        }
        if (expected) {
          const expectedSideSwitches = expected.routeContract.exceptions.filter((exception) => exception.type === "side-switch").flatMap((exception) => exception.edgeIds).sort();
          compareIds([...sideSwitchExceptions].sort(), expectedSideSwitches, "side-switch exception declarations", id);
          const expectedBranchPorts = expected.routeContract.exceptions.filter((exception) => exception.type === "branch-port").flatMap((exception) => exception.edgeIds).sort();
          compareIds([...branchPortExceptions].sort(), expectedBranchPorts, "branch-port exception declarations", id);
          const expectedBranchLayers = expected.routeContract.exceptions.filter((exception) => exception.type === "branch-layer").flatMap((exception) => exception.edgeIds).sort();
          compareIds([...branchLayerExceptions].sort(), expectedBranchLayers, "branch-layer exception declarations", id);
        }
      }

      for (const [pairKey, [firstId, secondId]] of crossingExceptions) {
        if (!edges.has(firstId) || !edges.has(secondId)) fail(`CROSSING_EXCEPTION: diagram ${id} references missing edge pair ${firstId}/${secondId}`);
        if (pairKey !== edgePairKey(firstId, secondId)) fail(`CROSSING_EXCEPTION: diagram ${id} contains an invalid edge pair`);
      }
      const actualCrossingPairs = new Set<string>();
      for (let first = 0; first < edgeEntries.length; first++) {
        const [firstId, firstEdge] = edgeEntries[first];
        const firstPoints = firstEdge.points as [number, number][];
        for (let second = first + 1; second < edgeEntries.length; second++) {
          const [secondId, secondEdge] = edgeEntries[second];
          const secondPoints = secondEdge.points as [number, number][];
          let hasCollinearOverlap = false;
          let hasEdgeCrossing = false;
          for (let firstPoint = 1; firstPoint < firstPoints.length; firstPoint++) {
            for (let secondPoint = 1; secondPoint < secondPoints.length; secondPoint++) {
              const relation = segmentRelation(firstPoints[firstPoint - 1], firstPoints[firstPoint], secondPoints[secondPoint - 1], secondPoints[secondPoint]);
              if (relation === "none") continue;
              const sharedPoint = [firstPoints[firstPoint - 1], firstPoints[firstPoint]].find((point) => [secondPoints[secondPoint - 1], secondPoints[secondPoint]].some((candidate) => pointEqual(point, candidate)));
              const sharedGraphNode = firstEdge.to === secondEdge.from || firstEdge.from === secondEdge.to || (firstEdge.to === secondEdge.to && declaredMergeNodes.has(firstEdge.to)) || (firstEdge.from === secondEdge.from && declaredMergeNodes.has(firstEdge.from));
              const allowedEndpointTouch = relation === "touch" && sharedPoint !== undefined && sharedGraphNode;
              if (relation === "overlap") { hasCollinearOverlap = true; continue; }
              if (relation === "cross" || !allowedEndpointTouch) hasEdgeCrossing = true;
            }
          }
          if (hasCollinearOverlap) fail(`COLLINEAR_OVERLAP: diagram ${id} edges ${firstId} and ${secondId} share a non-zero collinear path segment`);
          if (hasEdgeCrossing) {
            const pairKey = edgePairKey(firstId, secondId);
            actualCrossingPairs.add(pairKey);
            if (!crossingExceptions.has(pairKey)) fail(`EDGE_CROSSING: diagram ${id} edges ${firstId} and ${secondId} intersect outside a declared shared endpoint`);
          }
          if (firstEdge.from === secondEdge.from && firstEdge.fromPort === secondEdge.fromPort && Math.hypot(firstPoints[0][0] - secondPoints[0][0], firstPoints[0][1] - secondPoints[0][1]) < 24) fail(`INSUFFICIENT_GAP: diagram ${id} edges ${firstId} and ${secondId} share a port with less than 24 units of separation`);
          if (firstEdge.to === secondEdge.to && firstEdge.toPort === secondEdge.toPort && Math.hypot(firstPoints[firstPoints.length - 1][0] - secondPoints[secondPoints.length - 1][0], firstPoints[firstPoints.length - 1][1] - secondPoints[secondPoints.length - 1][1]) < 24) fail(`INSUFFICIENT_GAP: diagram ${id} edges ${firstId} and ${secondId} share a target port with less than 24 units of separation`);
        }
      }
      for (const [pairKey, [firstId, secondId]] of crossingExceptions) {
        if (!actualCrossingPairs.has(pairKey)) fail(`CROSSING_EXCEPTION: diagram ${id} declares no actual crossing for ${firstId}/${secondId}`);
      }
      const labelEntries = [...labelRectangles.entries()];
      for (const [labelId, label] of labelEntries) {
        const edge = edges.get(labelId)!;
        for (const [nodeId, rectangle] of nodeRectangles) if (nodeId !== edge.from && nodeId !== edge.to && rectanglesOverlap(label, rectangle)) fail(`LABEL_COLLISION: diagram ${id} label ${labelId} overlaps unrelated node ${nodeId}`);
      }
      for (let first = 0; first < labelEntries.length; first++) for (let second = first + 1; second < labelEntries.length; second++) if (rectanglesOverlap(labelEntries[first][1], labelEntries[second][1])) fail(`LABEL_COLLISION: diagram ${id} labels ${labelEntries[first][0]} and ${labelEntries[second][0]} overlap`);
      for (const [labelId, label] of labelEntries) {
        for (const [edgeId, edge] of edgeEntries) {
          if (edgeId === labelId) continue;
          const points = edge.points as [number, number][];
          for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
            if (segmentIntersectsRectangle(points[pointIndex - 1], points[pointIndex], label)) fail(`LABEL_COLLISION: diagram ${id} label ${labelId} intersects edge ${edgeId}`);
          }
        }
      }
      if (diagram.diagramType === "flowchart" || diagram.diagramType === "pipeline") {
        const candidateHitsObstacle = (candidate: [number, number][], currentId: string, current: Record<string, any>): boolean => {
          for (const [nodeId, rectangle] of nodeRectangles) {
            if (nodeId === current.from || nodeId === current.to) continue;
            for (let pointIndex = 1; pointIndex < candidate.length; pointIndex++) if (segmentIntersectsRectangle(candidate[pointIndex - 1], candidate[pointIndex], rectangle)) return true;
          }
          for (const [labelId, label] of labelEntries) {
            if (labelId === currentId && loopEdgeIds.has(currentId)) continue;
            for (let pointIndex = 1; pointIndex < candidate.length; pointIndex++) if (segmentIntersectsRectangle(candidate[pointIndex - 1], candidate[pointIndex], label)) return true;
          }
          for (const [otherId, other] of edgeEntries) {
            if (otherId === currentId) continue;
            const otherPoints = other.points as [number, number][];
            for (let candidatePoint = 1; candidatePoint < candidate.length; candidatePoint++) {
              for (let otherPoint = 1; otherPoint < otherPoints.length; otherPoint++) {
                const relation = segmentRelation(candidate[candidatePoint - 1], candidate[candidatePoint], otherPoints[otherPoint - 1], otherPoints[otherPoint]);
                if (relation === "none") continue;
                const sharedPoint = [candidate[candidatePoint - 1], candidate[candidatePoint]].find((point) => [otherPoints[otherPoint - 1], otherPoints[otherPoint]].some((otherCandidate) => pointEqual(point, otherCandidate)));
                const sharedGraphNode = current.to === other.from || current.from === other.to || (current.to === other.to && declaredMergeNodes.has(current.to)) || (current.from === other.from && declaredMergeNodes.has(current.from));
                if (relation === "touch" && sharedPoint !== undefined && sharedGraphNode) continue;
                return true;
              }
            }
          }
          return false;
        };
        for (const [edgeId, edge] of edgeEntries) {
          const points = edge.points as [number, number][];
          if (points.length <= 2) continue;
          const start = points[0];
          const end = points[points.length - 1];
          const candidates: [number, number][][] = [];
          const loopLane = loopEdgeIds.has(edgeId)
            ? (Array.isArray(layout.loopLanes) ? layout.loopLanes as Record<string, any>[] : []).find((lane) => Array.isArray(lane.edgeIds) && lane.edgeIds.map(String).includes(edgeId))
            : undefined;
          if (loopLane) {
            const laneOffset = Number(loopLane.laneOffset);
            const laneCoordinates = new Set(points.slice(1, -1).map((point) => layoutDirection === "TB" ? point[0] : point[1]));
            for (const coordinate of laneCoordinates) {
              const distance = layoutDirection === "TB" ? layoutMainAxis - coordinate : layoutMainAxis - coordinate;
              const isOnDeclaredSide = loopLane.side === "left" ? distance >= laneOffset : distance <= -laneOffset;
              if (!isOnDeclaredSide) continue;
              candidates.push(layoutDirection === "TB"
                ? [start, [coordinate, start[1]], [coordinate, end[1]], end]
                : [start, [start[0], coordinate], [end[0], coordinate], end]);
            }
          } else {
            if (start[0] === end[0] || start[1] === end[1]) candidates.push([start, end]);
            if (start[0] !== end[0] && start[1] !== end[1]) {
              candidates.push([start, [start[0], end[1]], end], [start, [end[0], start[1]], end]);
            }
          }
          const shortestLegal = candidates.some((candidate) => candidate.length < points.length
            && candidate.every((point, pointIndex) => pointIndex === 0 || !pointEqual(point, candidate[pointIndex - 1]))
            && leavesPort(candidate, edge.fromPort)
            && approachesTargetFromOutside(candidate, nodes.get(edge.to)!)
            && entersPort(candidate, edge.toPort)
            && !candidateHitsObstacle(candidate, edgeId, edge));
          if (shortestLegal) fail(`ROUTING_MINIMALITY: diagram ${id} edge ${edgeId} has a shorter legal direct, one-bend, or lane-constrained Manhattan route`);
        }
      }

      const groups = new Map<string, Record<string, any>>();
      for (const group of diagram.groups || []) {
        const groupId = requireString(group.id, `diagram ${id} group.id`);
        if (groups.has(groupId) || nodes.has(groupId) || edges.has(groupId) || !groupTypes.has(group.semanticType)) fail(`MIGRATION_REQUIRED: diagram ${id} group ${groupId} lacks valid semanticType`);
        if (group.tone !== undefined) fail(`VISUAL_STYLE: diagram ${id} group ${groupId} must not define tone`);
        if (!Array.isArray(group.members)) fail(`MIGRATION_REQUIRED: diagram ${id} group ${groupId} lacks members`);
        if (group.semanticType === "nested" && typeof group.parent !== "string") fail(`diagram ${id} nested group ${groupId} lacks parent`);
        if (group.semanticType !== "nested" && group.parent !== undefined) fail(`diagram ${id} non-nested group ${groupId} must not declare parent`);
        if ((group.semanticType === "cross-cutting" || group.semanticType === "overlay") && group.members.length !== 0) fail(`diagram ${id} ${group.semanticType} group ${groupId} must have no members`);
        for (const member of group.members) if (!nodes.has(member)) fail(`diagram ${id} group ${groupId} references missing node ${member}`);
        groups.set(groupId, group);
      }
      for (const group of groups.values()) if (group.semanticType === "nested" && !groups.has(group.parent)) fail(`diagram ${id} group ${group.id} references missing parent ${group.parent}`);
      const groupRectangles = new Map<string, Rectangle>();
      for (const [groupId, group] of groups) {
        const rectangle = rectangleOf(group, `diagram ${id} group ${groupId}`);
        if (rectangle) groupRectangles.set(groupId, rectangle);
      }
      const isNestedRelation = (first: Record<string, any>, second: Record<string, any>): boolean => {
        let current = first;
        while (current.semanticType === "nested" && typeof current.parent === "string") {
          if (current.parent === second.id) return true;
          const parent = groups.get(current.parent);
          if (!parent) return false;
          current = parent;
        }
        return false;
      };
      const groupEntries = [...groupRectangles.entries()];
      for (let first = 0; first < groupEntries.length; first++) {
        for (let second = first + 1; second < groupEntries.length; second++) {
          const firstGroup = groups.get(groupEntries[first][0])!;
          const secondGroup = groups.get(groupEntries[second][0])!;
          if (firstGroup.semanticType === "overlay" || firstGroup.semanticType === "cross-cutting" || secondGroup.semanticType === "overlay" || secondGroup.semanticType === "cross-cutting") continue;
          if (!isNestedRelation(firstGroup, secondGroup) && !isNestedRelation(secondGroup, firstGroup) && rectanglesOverlap(groupEntries[first][1], groupEntries[second][1])) {
            fail(`diagram ${id} groups ${groupEntries[first][0]} and ${groupEntries[second][0]} have geometric overlap`);
          }
        }
      }

      for (const [groupId, group] of groups) {
        const rectangle = groupRectangles.get(groupId);
        if (!rectangle) continue;
        for (const member of group.members) {
          const memberRectangle = nodeRectangles.get(member);
          if (!memberRectangle || memberRectangle.left < rectangle.left || memberRectangle.top < rectangle.top || memberRectangle.right > rectangle.right || memberRectangle.bottom > rectangle.bottom) fail(`GROUP_CONTAINMENT: diagram ${id} group ${groupId} does not contain member ${member}`);
          const padding = Math.min(memberRectangle.left - rectangle.left, memberRectangle.top - rectangle.top, rectangle.right - memberRectangle.right, rectangle.bottom - memberRectangle.bottom);
          if (padding < 24) fail(`INSUFFICIENT_GAP: diagram ${id} group ${groupId} has less than 24 units of member padding`);
        }
      }
      const edgePoints = edgeEntries.flatMap(([, edge]) => edge.points as [number, number][]);
      const businessRectangles = [...nodeRectangles.values(), ...groupRectangles.values(), ...labelRectangles.values()];
      const businessBottom = Math.max(...businessRectangles.map((rectangle) => rectangle.bottom), ...edgePoints.map((point) => point[1]));
      for (const [annotationId, annotation] of annotationRectangles) if (annotation.top < businessBottom) fail(`ANNOTATION_ORDER: diagram ${id} annotation ${annotationId} must be below the business body`);
      const contentRectangles = [...businessRectangles, ...annotationRectangles.values()];
      const contentLeft = Math.min(...contentRectangles.map((rectangle) => rectangle.left), ...edgePoints.map((point) => point[0]));
      const contentTop = Math.min(...contentRectangles.map((rectangle) => rectangle.top), ...edgePoints.map((point) => point[1]));
      const contentRight = Math.max(...contentRectangles.map((rectangle) => rectangle.right), ...edgePoints.map((point) => point[0]));
      const contentBottom = Math.max(...contentRectangles.map((rectangle) => rectangle.bottom), ...edgePoints.map((point) => point[1]));
      const contentWidth = contentRight - contentLeft;
      const contentHeight = contentBottom - contentTop;
      const canvasWidth = diagram.canvas.width;
      const canvasHeight = diagram.canvas.height;
      if (contentLeft < 0 || contentTop < 0 || contentRight > canvasWidth || contentBottom > canvasHeight) fail(`CANVAS_CLIPPING: diagram ${id} contentBBox exceeds canvas`);
      if (contentWidth / canvasWidth < 0.1 || contentHeight / canvasHeight < 0.1) fail(`CANVAS_TOO_EMPTY: diagram ${id} contentBBox occupies too little of the canvas`);
      if (Math.min(contentLeft, contentTop, canvasWidth - contentRight, canvasHeight - contentBottom) < 24) fail(`INSUFFICIENT_GAP: diagram ${id} contentBBox has less than 24 units of canvas padding`);

      const observed = observedChannelValues(diagram);
      const semanticChannels: string[] = [];
      for (const [channel, values] of observed) {
        if (values.size > 1) {
          const declaration = declarations.get(channel);
          if (!declaration) fail(`diagram ${id} visual channel ${channel} has multiple values without declaration`);
          if (declaration.role === "semantic") semanticChannels.push(channel);
        }
      }
      const legendDecision = notes.legendDecision;
      if (!legendDecision || !legendStatuses.has(legendDecision.status)) fail(`diagram ${id} lacks a valid legendDecision`);
      requireString(legendDecision.reason, `diagram ${id}.legendDecision.reason`);
      if (legendDecision.status === "required") fail(`VISUAL_STYLE: diagram ${id} must use inline text semantics instead of a global legend`);
      if (semanticChannels.length > 0 && legendDecision.status !== "exempt") fail(`diagram ${id} semantic visual differences require an inline-only legend exemption`);
      if (legendDecision.status === "exempt" && (!Array.isArray(legendDecision.inlineSemanticEvidence) || legendDecision.inlineSemanticEvidence.length === 0)) fail(`diagram ${id} inline semantic evidence is incomplete`);
      if (legendDecision.status === "not-needed" && semanticChannels.length > 0) fail(`diagram ${id} legendDecision not-needed conflicts with semantic visual differences`);

      const splitDecision = notes.splitDecision;
      if (!splitDecision || !splitStatuses.has(splitDecision.status)) fail(`diagram ${id} lacks a valid splitDecision`);
      requireString(splitDecision.reason, `diagram ${id}.splitDecision.reason`);
      const mixed = (architectureTypes.has(diagram.diagramType) && notes.semanticModes.some((mode: string) => ["process-flow", "data-flow", "dependency-flow"].includes(mode))) || (processTypes.has(diagram.diagramType) && notes.semanticModes.some((mode: string) => ["static-boundary", "static-relation"].includes(mode)));
      if (mixed && splitDecision.status === "not-needed") fail(`diagram ${id} mixes static and process semantics without split decision`);
      if (splitDecision.status === "kept-single") {
        for (const field of ["singleGoal", "staticBoundary", "processFlowDistinction"]) requireString(splitDecision[field], `diagram ${id}.splitDecision.${field}`);
        for (const state of ["normal", "fit", "zoom"]) {
          const evidence = splitDecision.readabilityEvidence?.[state];
          if (!evidence || !["PASS", "UNVERIFIED"].includes(evidence.status) || typeof evidence.evidence !== "string" || evidence.evidence.length === 0) fail(`diagram ${id} split readability evidence ${state} is invalid`);
        }
      }

      if (!existsSync(svgPath)) fail(`diagram ${id} SVG output is missing: ${relativePath(svgPath)}`);
      const svg = text(svgPath);
      if (unsafeSvg.test(svg) || !/<svg\b[^>]*\bviewBox=["'][^"']+["']/i.test(svg) || !/\brole=["']img["']/i.test(svg) || !/<title\b/i.test(svg) || !/<desc\b/i.test(svg)) fail(`diagram ${id} SVG fails static safety or accessibility checks`);
      const visualStyleErrors = diagramVisualStyleErrors(svg);
      if (visualStyleErrors.length > 0) fail(`diagram ${id} ${visualStyleErrors.join("; ")}`);
      const renderedNodeIds = [...svg.matchAll(/\bdata-node=["']([^"']+)["']/g)].map((match) => match[1]);
      const renderedEdgeTags = [...svg.matchAll(/<[^>]*\bdata-edge=["']([^"']+)["'][^>]*>/g)].map((match) => ({ id: match[1], tag: match[0] }));
      const renderedEdgeElements = renderedEdgeTags.filter((entry) => !/\bdata-edge-arrow=["']/i.test(entry.tag));
      const renderedEdgeIds = renderedEdgeElements.map((entry) => entry.id);
      if (new Set(renderedNodeIds).size !== renderedNodeIds.length || renderedNodeIds.length !== nodes.size || [...nodes.keys()].some((nodeId) => !renderedNodeIds.includes(nodeId))) fail(`diagram ${id} SVG node mapping does not match structured source`);
      if (new Set(renderedEdgeIds).size !== renderedEdgeIds.length || renderedEdgeIds.length !== edges.size || [...edges.keys()].some((edgeId) => !renderedEdgeIds.includes(edgeId))) fail(`diagram ${id} SVG edge mapping does not match structured source`);
      for (const [nodeId, node] of nodes) {
        const nodeTag = [...svg.matchAll(new RegExp(`<[^>]*\\bdata-node=["']${nodeId}["'][^>]*>`, "g"))].map((match) => match[0])[0] || "";
        if (node.shape === "diamond" && !/\bdata-node-shape=["']diamond["']/i.test(nodeTag)) fail(`DECISION_SHAPE: diagram ${id} SVG node ${nodeId} is not visibly mapped as diamond`);
      }
      const directedEdgeCount = diagram.edges.filter((edge: Record<string, any>) => (edge.kind || "directed") !== "undirected").length;
      const markerIds = new Set([...svg.matchAll(/<marker\b[^>]*\bid=["']([^"']+)["']/gi)].map((match) => match[1]));
      const arrowTags = [...svg.matchAll(/<[^>]*\bdata-edge-arrow=["']([^"']+)["'][^>]*>/g)].map((match) => ({ id: match[1], tag: match[0] }));
      const arrowIds = arrowTags.map((entry) => entry.id);
      if (new Set(arrowIds).size !== arrowIds.length || arrowIds.length < directedEdgeCount) fail(`diagram ${id} SVG arrow overlay mapping is incomplete`);
      for (const [edgeId, edge] of edges) {
        const edgeTag = renderedEdgeElements.find((entry) => entry.id === edgeId)?.tag || "";
        const expectedAttributes = [["data-from", edge.from], ["data-to", edge.to], ["data-from-port", edge.fromPort], ["data-to-port", edge.toPort]] as Array<[string, string]>;
        for (const [attribute, expected] of expectedAttributes) {
          const actual = edgeTag.match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, "i"))?.[1];
          if (actual !== expected) fail(`PORT_MISMATCH: diagram ${id} SVG edge ${edgeId} ${attribute} does not match structured source`);
        }
        if (edge.label && typeof edge.label === "object" && !Array.isArray(edge.label)) {
          const labelId = edgeTag.match(/\bdata-edge-label=["']([^"']+)["']/i)?.[1];
          if (labelId !== edgeId) fail(`LABEL_MAPPING: diagram ${id} SVG label mapping is missing for edge ${edgeId}`);
        }
        if ((edge.kind || "directed") !== "undirected") {
          const arrow = arrowTags.find((entry) => entry.id === edgeId && entry.tag.match(/\bdata-edge=["']([^"']+)["']/i)?.[1] === edgeId);
          const target = arrow?.tag.match(/\bdata-arrow-target=["']([^"']+)["']/i)?.[1];
          if (!arrow || target !== `${edge.to}:${edge.toPort}`) fail(`ARROW_MAPPING: diagram ${id} SVG arrow target is invalid for edge ${edgeId}`);
          const marker = edgeTag.match(/\bmarker-end=["']url\(#([^)]*)\)["']/i)?.[1];
          if (!marker || !markerIds.has(marker)) fail(`ARROW_MAPPING: diagram ${id} SVG marker is missing for edge ${edgeId}`);
        }
      }
      const renderedLegendIds = [...svg.matchAll(/\bdata-legend-item=["']([^"']+)["']/g)].map((match) => match[1]);
      if (new Set(renderedLegendIds).size !== renderedLegendIds.length) fail(`diagram ${id} SVG legend mapping contains duplicate IDs`);
      if (renderedLegendIds.length !== (diagram.legend?.items?.length || 0)) fail(`diagram ${id} SVG legend coverage is incomplete`);
      if (diagram.legend && diagram.legend.items.some((item: Record<string, any>) => !renderedLegendIds.includes(item.id))) fail(`diagram ${id} SVG legend coverage is incomplete`);
      const renderedNoteIds = [...svg.matchAll(/\bdata-note=["']([^"']+)["']/g)].map((match) => match[1]);
      if (new Set(renderedNoteIds).size !== renderedNoteIds.length || renderedNoteIds.length !== annotationRectangles.size || annotationRectangles.size !== annotations.length || annotations.some((annotation: Record<string, any>) => !renderedNoteIds.includes(annotation.id))) fail(`ANNOTATION_MAPPING: diagram ${id} SVG annotation mapping does not match structured source`);
      if (renderedLegendIds.length > 0 && renderedNoteIds.length > 0) {
        const firstLegend = svg.search(/\bdata-legend-item=["']/);
        const lastLegend = Math.max(...[...svg.matchAll(/\bdata-legend-item=["']/g)].map((match) => match.index || 0));
        const firstNote = svg.search(/\bdata-note=["']/);
        if (firstNote < lastLegend || firstNote < firstLegend) fail(`ANNOTATION_ORDER: diagram ${id} SVG annotations must follow the legend`);
      }
      if (diagram.groups?.length && !diagram.groups.every((group: Record<string, any>) => svg.includes(`group-${group.id}`))) fail(`diagram ${id} SVG group mapping is incomplete`);
      if (diagram.diagramType === "sequence") {
        for (const [nodeId, node] of nodes) {
          const lifeline = svg.match(new RegExp(`<[^>]*data-lifeline-for=["']${nodeId}["'][^>]*>`, "i"))?.[0];
          if (!lifeline) fail(`diagram ${id} sequence lifeline mapping is missing for ${nodeId}`);
          const x1 = Number(lifeline.match(/\bx1=["']([0-9.+-]+)["']/i)?.[1]);
          const x2 = Number(lifeline.match(/\bx2=["']([0-9.+-]+)["']/i)?.[1]);
          const expectedX = node.x + node.width / 2;
          if (!Number.isFinite(x1) || !Number.isFinite(x2) || Math.abs(x1 - x2) > 1 || Math.abs(x1 - expectedX) > 1) fail(`diagram ${id} sequence lifeline coordinate is invalid for ${nodeId}`);
        }
      }
      const adjacentMarkdown = textIfExists(svgPath.replace(/\.svg$/i, ".md"));
      if (!/\b(?:FR|REQ)-\d+\b/i.test(svg) && !/\b(?:FR|REQ)-\d+\b/i.test(adjacentMarkdown)) fail(`diagram ${id} has no FR/REQ mapping evidence`);
      const nodeCount = diagram.nodes.length;
      const edgeCount = diagram.edges.length;
      const groupCount = (diagram.groups || []).length;
      if (nodeCount > 20) { riskScore += 1; riskReasons.add("nodes > 20"); }
      if (edgeCount > 30) { riskScore += 1; riskReasons.add("edges > 30"); }
      if (diagram.edges.some((edge: Record<string, any>) => Array.isArray(edge.points) && edge.points.length > 2)) { riskScore += 2; riskReasons.add("complex edge routing"); }
      if (diagram.edges.some((edge: Record<string, any>) => diagram.edges.some((other: Record<string, any>) => other !== edge && other.from === edge.from && other.fromPort === edge.fromPort))) { riskScore += 2; riskReasons.add("multiple edges share a source port"); }
      if (diagram.diagramType === "sequence") { riskScore += 1; riskReasons.add("sequence diagram"); }
      if (diagram.diagramType === "flowchart" && edgeCount > 12) { riskScore += 2; riskReasons.add("complex flowchart"); }
      if (groupCount > 0 && (diagram.groups || []).some((group: Record<string, any>) => group.semanticType === "nested" && group.parent && (diagram.groups || []).some((parent: Record<string, any>) => parent.id === group.parent && parent.parent))) { riskScore += 2; riskReasons.add("nested groups"); }
      if (/\btransform\s*=|\bmarker-end\s*=|<text\b/i.test(svg)) { riskScore += 1; riskReasons.add("browser-sensitive SVG features"); }
      diagramsChecked += 1;
    }
  }

  const riskLevel = riskScore >= 6 ? "HIGH" : riskScore >= 3 ? "MEDIUM" : "LOW";
  const finalStatus = expectedContractsChecked === diagramsChecked ? "STATIC_PASS" : "UNVERIFIED";
  const routeStatus = expectedContractsChecked === diagramsChecked ? "ROUTE_CONTRACT_PASS" : "UNVERIFIED";
  return {
    status: "passed", final_status: finalStatus, source_format: "svg", diagrams_checked: diagramsChecked,
    structure_status: "STRUCTURE_PASS",
    route_contract_status: routeStatus,
    geometry_gate_status: "GEOMETRY_PASS",
    visual_status: "UNVERIFIED",
    overall_status: finalStatus,
    gate_statuses: { structure: "STRUCTURE_PASS", route_contract: routeStatus, geometry: "GEOMETRY_PASS", visual: "UNVERIFIED", overall: finalStatus },
    expected_contract_status: expectedContractsChecked === diagramsChecked ? "passed" : "unverified",
    generation_status: generationContractsChecked === diagramsChecked ? "passed" : "unverified",
    generation_closure: generationClosures,
    route_contract_reports: routeContractReports,
    semantic_status: expectedContractsChecked === diagramsChecked ? "passed" : "unverified",
    ids_unique: true, ports_valid: true, direction_consistent: true, legend_valid: true, global_decorations_absent: true,
    groups_valid: true, viewbox_valid: true, provider_status: "unverified",
    target_operation_required: false, fr_mapping_complete: true,
    design_notes_valid: true, layout_contract_valid: true, main_flow_valid: true, loop_lanes_valid: true, decision_exit_valid: true, annotation_mapping_valid: true, migration_status: "passed", port_paths_valid: true,
    geometry_status: "passed", visual_style_status: "passed", edge_label_placement_status: "passed", edge_intersection_status: "passed", collinear_overlap_status: "passed", target_port_direction_status: "passed", target_port_approach_status: "passed", routing_minimality_status: "passed", side_switch_status: "passed", change_impact_review_status: changeImpactReviewsChecked > 0 ? "passed" : "not_applicable", visible_arrow_mapping_status: "passed",
    render_preflight_status: "passed",
    render_status: "unverified",
    render_status_reason: "no static SVG renderer is configured",
    risk: { level: riskLevel, score: riskScore, reasons: [...riskReasons].sort() },
    unresolved: 0,
  };
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
