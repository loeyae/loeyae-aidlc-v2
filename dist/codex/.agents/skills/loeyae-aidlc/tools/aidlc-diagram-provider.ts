#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, extname, join, relative, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath, pathToFileURL } from "url";
import {
  ExpectedContract,
  expectedContractPath,
  parseExpectedContract,
} from "./diagram-contract.js";
import { DIAGRAM_LAYOUT_METRICS, DIAGRAM_VISUAL_STYLE } from "./diagram-visual-style.js";

const PROJECT_ROOT = process.cwd();
const PROVIDER_PACKAGE = "chrome-devtools-mcp";
const COMMAND_TIMEOUT_MS = 120_000;
const MAX_VIEWPORT = { width: 3840, height: 2160 };
const MIN_VIEWPORT = { width: 320, height: 240 };

type TargetOperation = "preview" | "render";

interface Viewport {
  width: number;
  height: number;
}

type ReadingView = "normal" | "fit" | "zoom";
type ReadingViewports = Record<ReadingView, Viewport>;

interface DiagramRequest {
  id: string;
  source_path?: string;
  url?: string;
  manifest_path?: string;
  expected_contract_path?: string;
  screenshot_path?: string;
  snapshot_path?: string;
  viewport?: Viewport;
}

interface ProviderRequest {
  version: "1";
  provider: "chrome-devtools";
  target_operation: TargetOperation;
  stage: string;
  target_reading_environment?: { viewport?: Viewport; viewports?: ReadingViewports };
  diagrams: DiagramRequest[];
}

interface ActualGroupLayout {
  members: string[];
  label: string;
  styleRole: string;
}

interface ActualLayout {
  readingDirection?: "TB" | "LR";
  mainAxis?: number;
  nodeCenters: Record<string, number>;
  groups: Record<string, ActualGroupLayout>;
  readabilityEvidence?: Record<ReadingView, string>;
}

interface GeometryBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface InspectionResult {
  role: string | null;
  title: string;
  description: string;
  viewBox: string | null;
  svgWidth: number;
  svgHeight: number;
  nodeIds: string[];
  edgeIds: string[];
  arrowTargets: string[];
  groupIds: string[];
  legendIds: string[];
  noteIds: string[];
  legendBeforeNotes: boolean;
  nodeCenters: Record<string, { x: number; y: number }>;
  nodeShapes: Record<string, string>;
  edgeRecords: Record<string, { from: string; to: string; fromPort: string; toPort: string; arrowTarget: string }>;
  edgeBBoxes: Record<string, GeometryBox>;
  edgeBendCounts: Record<string, number>;
  edgeGeometryKinds: Record<string, "direct" | "manhattan" | "custom">;
  edgeLabelIds: string[];
  edgeLabels: Record<string, string>;
  labelNodeCollisionPairs: string[];
  labelLabelCollisionPairs: string[];
  labelArrowCollisionPairs: string[];
  edgeIntersectionPairs: string[];
  collinearOverlapPairs: string[];
  portDirectionErrors: string[];
  portApproachErrors: string[];
  sideSwitchDetectedEdgeIds: string[];
  sideSwitchErrors: string[];
  arrowVisibilityErrors: string[];
  arrowOcclusionPairs: string[];
  arrowDecorationOcclusionPairs: string[];
  labelEdgeCollisionPairs: string[];
  labelPlacementErrors: string[];
  visualStyleErrors: string[];
  textOverflowIds: string[];
  textOverlapPairs: string[];
  contentBBox: GeometryBox | null;
  horizontalOverflow: boolean;
  lifelineIds: string[];
  lifelineCoordinates: Record<string, number>;
  nodeCollisionPairs: string[];
  edgeNodeCollisionPairs: string[];
  entityGapErrors: string[];
  axisGapErrors: string[];
  axisAlignmentErrors: string[];
  portGapErrors: string[];
  obstacleGapErrors: string[];
  labelObstacleGapErrors: string[];
  laneGapErrors: string[];
  scroll: { x: number; y: number };
  viewport: { width: number; height: number };
  contentFullyVisible: boolean;
  groupOverlapPairs: string[];
  groupCapacityErrors: string[];
  groupTitleErrors: string[];
  unsafeCount: number;
  outsideViewportCount: number;
}

interface CliResult {
  payload: unknown;
  stdout: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${field} must be a non-empty string`);
  return value.trim();
}

function projectPath(value: string, field: string): string {
  const resolved = resolve(PROJECT_ROOT, value);
  const rel = relative(PROJECT_ROOT, resolved);
  if (rel === ".." || rel.startsWith(`..${requirePathSeparator()}`) || rel.startsWith("/")) {
    fail(`${field} must stay inside the project root`);
  }
  return resolved;
}

function requirePathSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function validateViewport(value: unknown, field: string): Viewport {
  const viewport = record(value, field);
  const width = Number(viewport.width);
  const height = Number(viewport.height);
  if (!Number.isInteger(width) || width < MIN_VIEWPORT.width || width > MAX_VIEWPORT.width) fail(`${field}.width must be an integer between ${MIN_VIEWPORT.width} and ${MAX_VIEWPORT.width}`);
  if (!Number.isInteger(height) || height < MIN_VIEWPORT.height || height > MAX_VIEWPORT.height) fail(`${field}.height must be an integer between ${MIN_VIEWPORT.height} and ${MAX_VIEWPORT.height}`);
  return { width, height };
}
function validateUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(`${field} must be a valid URL`);
  }
  if (!["file:", "http:", "https:"].includes(url.protocol)) fail(`${field} must use file:, http:, or https:`);
  if (url.protocol === "file:") projectPath(fileURLToPath(url), field);
  return url.toString();
}

function sourceUrl(item: DiagramRequest, index: number): string {
  if (item.url !== undefined) return validateUrl(item.url, `diagrams[${index}].url`);
  const source = projectPath(nonEmpty(item.source_path, `diagrams[${index}].source_path`), `diagrams[${index}].source_path`);
  if (!existsSync(source) || !statSync(source).isFile()) fail(`diagram source does not exist: ${relative(PROJECT_ROOT, source)}`);
  if (extname(source).toLowerCase() !== ".svg") fail(`diagram source must be an SVG file: ${relative(PROJECT_ROOT, source)}`);
  return pathToFileURL(source).toString();
}

function evidencePath(stage: string, explicit?: string): string {
  const path = explicit ? projectPath(explicit, "evidence") : resolve(PROJECT_ROOT, ".aidlc", "evidence", stage, "diagram-contract.json");
  const evidenceRoot = resolve(PROJECT_ROOT, ".aidlc", "evidence");
  const rel = relative(evidenceRoot, path);
  if (rel === ".." || rel.startsWith(`..${requirePathSeparator()}`) || rel.startsWith("/")) fail("evidence must stay inside .aidlc/evidence");
  return path;
}

function artifactPath(value: string | undefined, defaultPath: string, field: string): string {
  const path = projectPath(value || defaultPath, field);
  const evidenceRoot = resolve(PROJECT_ROOT, ".aidlc", "evidence");
  const rel = relative(evidenceRoot, path);
  if (rel === ".." || rel.startsWith(`..${requirePathSeparator()}`) || rel.startsWith("/")) fail(`${field} must stay inside .aidlc/evidence`);
  return path;
}

function parseRequest(path: string): ProviderRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(projectPath(path, "request"), "utf8"));
  } catch (error) {
    fail(`cannot read provider request: ${error instanceof Error ? error.message : String(error)}`);
  }
  const value = record(raw, "request");
  if (value.version !== "1") fail('request.version must be "1"');
  if (value.provider !== "chrome-devtools") fail('request.provider must be "chrome-devtools"');
  const targetOperation = nonEmpty(value.target_operation, "request.target_operation") as TargetOperation;
  if (!["preview", "render"].includes(targetOperation)) fail('request.target_operation must be "preview" or "render"; export is not supported by this provider (NEEDS_CAPABILITY)');
  const stage = nonEmpty(value.stage, "request.stage");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(stage)) fail("request.stage must contain only lowercase letters, digits, and hyphens");
  if (!Array.isArray(value.diagrams) || value.diagrams.length === 0) fail("request.diagrams must be a non-empty array");
  const environment = value.target_reading_environment === undefined ? undefined : record(value.target_reading_environment, "request.target_reading_environment");
  const defaultViewport = environment?.viewport === undefined ? { width: 1280, height: 720 } : validateViewport(environment.viewport, "request.target_reading_environment.viewport");
  let viewports: ReadingViewports | undefined;
  if (environment?.viewports !== undefined) {
    const rawViewports = record(environment.viewports, "request.target_reading_environment.viewports");
    const requiredViews: ReadingView[] = ["normal", "fit", "zoom"];
    for (const view of requiredViews) if (rawViewports[view] === undefined) fail(`request.target_reading_environment.viewports.${view} is required`);
    viewports = Object.fromEntries(requiredViews.map((view) => [view, validateViewport(rawViewports[view], `request.target_reading_environment.viewports.${view}`)])) as ReadingViewports;
  }
  const diagrams: DiagramRequest[] = value.diagrams.map((rawItem, index) => {
    const item = record(rawItem, `diagrams[${index}]`);
    const result: DiagramRequest = { id: nonEmpty(item.id, `diagrams[${index}].id`) };
    if (item.source_path !== undefined && item.url !== undefined) fail(`diagrams[${index}] must provide only one of source_path or url`);
    if (item.source_path === undefined && item.url === undefined) fail(`diagrams[${index}] must provide source_path or url`);
    if (item.source_path !== undefined) result.source_path = nonEmpty(item.source_path, `diagrams[${index}].source_path`);
    if (item.url !== undefined) result.url = nonEmpty(item.url, `diagrams[${index}].url`);
    if (item.manifest_path !== undefined) result.manifest_path = nonEmpty(item.manifest_path, `diagrams[${index}].manifest_path`);
    if (item.expected_contract_path !== undefined) result.expected_contract_path = nonEmpty(item.expected_contract_path, `diagrams[${index}].expected_contract_path`);
    if (item.screenshot_path !== undefined) result.screenshot_path = nonEmpty(item.screenshot_path, `diagrams[${index}].screenshot_path`);
    if (item.snapshot_path !== undefined) result.snapshot_path = nonEmpty(item.snapshot_path, `diagrams[${index}].snapshot_path`);
    result.viewport = item.viewport === undefined ? defaultViewport : validateViewport(item.viewport, `diagrams[${index}].viewport`);
    sourceUrl(result, index);
    if (result.manifest_path) projectPath(result.manifest_path, `diagrams[${index}].manifest_path`);
    if (result.expected_contract_path) projectPath(result.expected_contract_path, `diagrams[${index}].expected_contract_path`);
    return result;
  });
  return { version: "1", provider: "chrome-devtools", target_operation: targetOperation, stage, target_reading_environment: { viewport: defaultViewport, ...(viewports ? { viewports } : {}) }, diagrams };
}

function parseJsonOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) fail("Chrome DevTools CLI returned no JSON output");
  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === "object" && typeof direct.message === "string") {
      const match = direct.message.match(/```json\s*([\s\S]*?)\s*```/i);
      if (match) {
        try { return JSON.parse(match[1]); } catch { return direct; }
      }
    }
    return direct;
  } catch {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index--) {
      try { return JSON.parse(lines[index]); } catch { /* continue to the last JSON line */ }
    }
    fail(`Chrome DevTools CLI returned invalid JSON: ${text.slice(-500)}`);
  }
}

const BROWSER_PROFILE_CONFLICT = "BROWSER_PROFILE_CONFLICT";
let chromeSessionId: string | undefined;
let chromeSessionExitHandlerRegistered = false;

function isBrowserProfileConflict(detail: string): boolean {
  return /browser is already running|user[ -]data[ -]dir(?:ectory)?.*(?:in use|already)|profile.*(?:in use|already running)/i.test(detail);
}

function runChromeCommand(args: string[], sessionId: string, expectsJson: boolean): CliResult {
  const result = spawnSync("npx", [
    "-y",
    "--package",
    PROVIDER_PACKAGE,
    "chrome-devtools",
    "--sessionId",
    sessionId,
    ...args,
    ...(expectsJson ? ["--output-format=json"] : []),
  ], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    shell: false,
    timeout: COMMAND_TIMEOUT_MS,
    env: {
      ...process.env,
      CI: "1",
      CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1",
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : String(result.stdout || "");
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `exit code ${result.status}`;
    const output = [stderr, stdout.trim()].filter(Boolean).join("; ").slice(-1000);
    const code = isBrowserProfileConflict(output) ? BROWSER_PROFILE_CONFLICT : "NEEDS_CAPABILITY";
    const reason = code === BROWSER_PROFILE_CONFLICT
      ? "Chrome DevTools browser profile conflict"
      : "Chrome DevTools Provider unavailable";
    fail(`${code}: ${reason} while running ${args.join(" ")}: ${detail}${output ? `; ${output}` : ""}`);
  }
  return { payload: expectsJson ? parseJsonOutput(stdout) : undefined, stdout };
}

function stopChromeSession(sessionId: string): void {
  try {
    runChromeCommand(["stop"], sessionId, false);
  } catch (error) {
    console.error(`Chrome DevTools cleanup warning for isolated session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function ensureChromeSession(): string {
  if (chromeSessionId) return chromeSessionId;
  const sessionId = `loeyae-diagram-${process.pid}-${Date.now()}`;
  chromeSessionId = sessionId;
  if (!chromeSessionExitHandlerRegistered) {
    chromeSessionExitHandlerRegistered = true;
    process.once("exit", () => stopChromeSession(sessionId));
  }
  runChromeCommand(["start", "--isolated"], sessionId, false);
  return sessionId;
}

function runChrome(args: string[]): CliResult {
  return runChromeCommand(args, ensureChromeSession(), true);
}

function selectPage(payload: unknown): number {
  const pages = record(payload, "list_pages response").pages;
  if (!Array.isArray(pages) || pages.length === 0) fail("Chrome DevTools Provider returned no browser page");
  const selected = pages.find((page) => record(page, "page").selected === true) || pages[pages.length - 1];
  const id = Number(record(selected, "selected page").id);
  if (!Number.isInteger(id)) fail("Chrome DevTools Provider returned an invalid page id");
  return id;
}

function declaredExpectedPath(item: DiagramRequest): string | undefined {
  if (item.expected_contract_path) return item.expected_contract_path;
  if (!item.manifest_path) return undefined;
  const manifestPath = projectPath(item.manifest_path, "manifest_path");
  if (!existsSync(manifestPath)) return undefined;
  const manifest = record(JSON.parse(readFileSync(manifestPath, "utf8")), "diagram manifest");
  if (!Array.isArray(manifest.diagrams)) return undefined;
  const match = manifest.diagrams.find((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).id === item.id);
  return match && typeof match === "object" && !Array.isArray(match)
    ? expectedContractPath(manifest, match as Record<string, unknown>)
    : undefined;
}

function loadExpected(item: DiagramRequest): ExpectedContract | undefined {
  const declaredPath = declaredExpectedPath(item);
  if (!declaredPath) return undefined;
  const contractPath = projectPath(declaredPath, "expected_contract_path");
  if (!existsSync(contractPath)) fail(`UNVERIFIED: expected contract does not exist: ${relative(PROJECT_ROOT, contractPath)}`);
  try {
    return parseExpectedContract(JSON.parse(readFileSync(contractPath, "utf8")), item.id);
  } catch (error) {
    fail(`UNVERIFIED: expected contract is invalid for ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function loadActualLayout(item: DiagramRequest): ActualLayout {
  if (!item.manifest_path) return { nodeCenters: {}, groups: {} };
  const manifestPath = projectPath(item.manifest_path, "manifest_path");
  if (!existsSync(manifestPath)) fail(`diagram manifest does not exist: ${relative(PROJECT_ROOT, manifestPath)}`);
  const manifest = record(JSON.parse(readFileSync(manifestPath, "utf8")), "diagram manifest");
  if (!Array.isArray(manifest.diagrams)) fail("diagram manifest diagrams must be an array");
  const matches = manifest.diagrams.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).id === item.id);
  if (matches.length !== 1) fail(`diagram manifest must contain exactly one diagram with id ${item.id}`);
  const diagram = record(matches[0], `diagram ${item.id}`);
  const nodeRecords = Array.isArray(diagram.nodes) ? diagram.nodes.map((entry: unknown) => record(entry, "node")) : [];
  const groupRecords = Array.isArray(diagram.groups) ? diagram.groups.map((entry: unknown) => record(entry, "group")) : [];
  const nodeCenters = Object.fromEntries(nodeRecords.map((node) => [String(node.id), Number(node.x) + Number(node.width) / 2]));
  const groups = Object.fromEntries(groupRecords.map((group) => [String(group.id), {
    members: Array.isArray(group.members) ? group.members.map(String) : [],
    label: typeof group.label === "string" ? group.label : "",
    styleRole: typeof group.styleRole === "string" ? group.styleRole : "",
  }]));
  const designNotes = diagram.designNotes && typeof diagram.designNotes === "object" && !Array.isArray(diagram.designNotes) ? diagram.designNotes as Record<string, unknown> : undefined;
  const layout = designNotes?.layout && typeof designNotes.layout === "object" && !Array.isArray(designNotes.layout) ? designNotes.layout as Record<string, unknown> : undefined;
  const readabilityEvidence = layout?.readabilityEvidence && typeof layout.readabilityEvidence === "object" && !Array.isArray(layout.readabilityEvidence)
    ? Object.fromEntries(((["normal", "fit", "zoom"] as ReadingView[]).map((view) => [view, String((layout.readabilityEvidence as Record<string, any>)[view]?.evidence || "")])) as Array<[ReadingView, string]>)
    : undefined;
  return {
    readingDirection: layout?.direction === "TB" || layout?.direction === "LR" ? layout.direction : undefined,
    mainAxis: typeof layout?.mainAxis === "number" && Number.isFinite(layout.mainAxis) ? layout.mainAxis : undefined,
    nodeCenters,
    groups,
    ...(readabilityEvidence ? { readabilityEvidence: readabilityEvidence as Record<ReadingView, string> } : {}),
  };
}

const INSPECTION_SCRIPT = `(contract = {}) => {
  try {
  const svg = document.querySelector('svg');
  const visualStyle = ${JSON.stringify(DIAGRAM_VISUAL_STYLE)};
  const layoutMetrics = ${JSON.stringify(DIAGRAM_LAYOUT_METRICS)};
  const geometryProfile = contract.geometryProfile && typeof contract.geometryProfile === 'object' ? contract.geometryProfile : null;
  if (contract.resetScroll === true) window.scrollTo(0, 0);
  const ids = (selector, attribute) => [...document.querySelectorAll(selector)].map((element) => element.getAttribute(attribute)).filter(Boolean);
  const bounds = (element) => {
    try {
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    } catch (_) { return null; }
  };
  const overlaps = (first, second) => first && second && first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
  const pointInside = (point, box) => Boolean(box && point[0] > box.left + 1 && point[0] < box.right - 1 && point[1] > box.top + 1 && point[1] < box.bottom - 1);
  const segmentIntersectsBox = (first, second, box) => {
    if (!box) return false;
    const dx = second[0] - first[0];
    const dy = second[1] - first[1];
    let entering = 0;
    let leaving = 1;
    for (const [origin, delta, minimum, maximum] of [[first[0], dx, box.left, box.right], [first[1], dy, box.top, box.bottom]]) {
      if (delta === 0) {
        if (origin <= minimum || origin >= maximum) return false;
        continue;
      }
      const near = (minimum - origin) / delta;
      const far = (maximum - origin) / delta;
      entering = Math.max(entering, Math.min(near, far));
      leaving = Math.min(leaving, Math.max(near, far));
      if (entering > leaving) return false;
    }
    return entering < leaving && leaving > 0 && entering < 1;
  };
  const paintedAfter = (cover, target) => Boolean(cover && target && (target.compareDocumentPosition(cover) & Node.DOCUMENT_POSITION_FOLLOWING));
  const pointEqual = (first, second, tolerance = 1) => Math.abs(first[0] - second[0]) <= tolerance && Math.abs(first[1] - second[1]) <= tolerance;
  const orientation = (first, second, third) => (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0]);
  const onSegment = (first, second, point) => Math.abs(orientation(first, second, point)) <= 1e-9 && point[0] >= Math.min(first[0], second[0]) - 1e-9 && point[0] <= Math.max(first[0], second[0]) + 1e-9 && point[1] >= Math.min(first[1], second[1]) - 1e-9 && point[1] <= Math.max(first[1], second[1]) + 1e-9;
  const segmentRelation = (first, second, third, fourth) => {
    const a = orientation(first, second, third);
    const b = orientation(first, second, fourth);
    const c = orientation(third, fourth, first);
    const d = orientation(third, fourth, second);
    const collinear = Math.abs(a) <= 1e-9 && Math.abs(b) <= 1e-9 && Math.abs(c) <= 1e-9 && Math.abs(d) <= 1e-9;
    if (collinear) {
      const useX = Math.abs(first[0] - second[0]) >= Math.abs(first[1] - second[1]);
      const firstLow = useX ? Math.min(first[0], second[0]) : Math.min(first[1], second[1]);
      const firstHigh = useX ? Math.max(first[0], second[0]) : Math.max(first[1], second[1]);
      const secondLow = useX ? Math.min(third[0], fourth[0]) : Math.min(third[1], fourth[1]);
      const secondHigh = useX ? Math.max(third[0], fourth[0]) : Math.max(third[1], fourth[1]);
      const overlap = Math.min(firstHigh, secondHigh) - Math.max(firstLow, secondLow);
      if (overlap > 1e-9) return 'overlap';
      if (overlap >= -1e-9 && (onSegment(first, second, third) || onSegment(first, second, fourth) || onSegment(third, fourth, first) || onSegment(third, fourth, second))) return 'touch';
      return 'none';
    }
    const proper = ((a > 1e-9 && b < -1e-9) || (a < -1e-9 && b > 1e-9)) && ((c > 1e-9 && d < -1e-9) || (c < -1e-9 && d > 1e-9));
    if (proper) return 'cross';
    if (onSegment(first, second, third) || onSegment(first, second, fourth) || onSegment(third, fourth, first) || onSegment(third, fourth, second)) return 'touch';
    return 'none';
  };
  const nodeElements = [...document.querySelectorAll('[data-node]')];
  const edgeElements = [...document.querySelectorAll('path[data-edge]')].filter((element) => !element.hasAttribute('data-edge-arrow'));
  const nodeOutline = (element) => {
    if (element.matches('rect, ellipse, circle, polygon, path')) return element;
    return element.querySelector(':scope > rect, :scope > ellipse, :scope > circle, :scope > polygon, :scope > path') || element;
  };
  const edgeGeometry = (element) => {
    if (typeof element.getTotalLength !== 'function' || typeof element.getPointAtLength !== 'function') return null;
    const length = element.getTotalLength();
    const matrix = element.getScreenCTM();
    if (!matrix || length <= 0) return null;
    const points = [];
    const count = Math.max(2, Math.ceil(length / 4));
    for (let index = 0; index <= count; index++) {
      const point = element.getPointAtLength(length * index / count);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      points.push([screen.x, screen.y]);
    }
    return { points, box: bounds(element) };
  };
  const nodeBoxes = new Map(nodeElements.map((element) => [element.getAttribute('data-node'), bounds(element)]));
  const nodeOutlineBoxes = new Map(nodeElements.map((element) => [element.getAttribute('data-node'), bounds(nodeOutline(element))]));
  const nodeCollisionPairs = [];
  const entityGapErrors = [];
  const axisGapErrors = [];
  const axisAlignmentErrors = [];
  const portGapErrors = [];
  const obstacleGapErrors = [];
  const labelObstacleGapErrors = [];
  const laneGapErrors = [];
  const nodeEntries = [...nodeBoxes.entries()].filter((entry) => entry[0] && entry[1]);
  const nodeOutlineEntries = [...nodeOutlineBoxes.entries()].filter((entry) => entry[0] && entry[1]);
  const geometryScaleMatrix = svg?.getScreenCTM();
  const geometryScale = geometryScaleMatrix ? Math.max(0.01, Math.min(Math.hypot(geometryScaleMatrix.a, geometryScaleMatrix.b), Math.hypot(geometryScaleMatrix.c, geometryScaleMatrix.d))) : 1;
  const geometryThreshold = (field) => geometryProfile ? Number(geometryProfile[field] || 0) * geometryScale : 0;
  const axisGeometryThreshold = (field) => geometryProfile?.axisSpacing ? Number(geometryProfile.axisSpacing[field] || 0) * geometryScale : 0;
  const boxGap = (first, second) => {
    const horizontal = Math.max(0, first.left - second.right, second.left - first.right);
    const vertical = Math.max(0, first.top - second.bottom, second.top - first.bottom);
    return Math.hypot(horizontal, vertical);
  };
  const pointBoxDistance = (point, box) => {
    const horizontal = point[0] < box.left ? box.left - point[0] : point[0] > box.right ? point[0] - box.right : 0;
    const vertical = point[1] < box.top ? box.top - point[1] : point[1] > box.bottom ? point[1] - box.bottom : 0;
    return Math.hypot(horizontal, vertical);
  };
  const segmentBoxDistance = (first, second, box) => {
    if (segmentIntersectsBox(first, second, box)) return 0;
    const dx = second[0] - first[0];
    const dy = second[1] - first[1];
    if (Math.abs(dx) <= 1e-6) {
      const vertical = Math.max(box.top - Math.max(first[1], second[1]), Math.min(first[1], second[1]) - box.bottom, 0);
      const horizontal = first[0] < box.left ? box.left - first[0] : first[0] > box.right ? first[0] - box.right : 0;
      return Math.hypot(horizontal, vertical);
    }
    if (Math.abs(dy) <= 1e-6) {
      const horizontal = Math.max(box.left - Math.max(first[0], second[0]), Math.min(first[0], second[0]) - box.right, 0);
      const vertical = first[1] < box.top ? box.top - first[1] : first[1] > box.bottom ? first[1] - box.bottom : 0;
      return Math.hypot(horizontal, vertical);
    }
    const count = Math.max(2, Math.ceil(Math.hypot(dx, dy) / 4));
    let minimum = Infinity;
    for (let index = 0; index <= count; index++) minimum = Math.min(minimum, pointBoxDistance([first[0] + dx * index / count, first[1] + dy * index / count], box));
    return minimum;
  };
  if (geometryProfile) {
    for (let first = 0; first < nodeOutlineEntries.length; first++) for (let second = first + 1; second < nodeOutlineEntries.length; second++) {
      const gap = boxGap(nodeOutlineEntries[first][1], nodeOutlineEntries[second][1]);
      if (gap < geometryThreshold('entityGap') - 0.5) entityGapErrors.push(nodeOutlineEntries[first][0] + ':' + nodeOutlineEntries[second][0]);
    }
  }
  if (geometryProfile?.axisSpacing && (contract.readingDirection === 'TB' || contract.readingDirection === 'LR') && contract.primaryFlow && Array.isArray(contract.primaryFlow.nodeIds)) {
    const minimumGap = contract.readingDirection === 'TB' ? axisGeometryThreshold('tbMinimumGap') : axisGeometryThreshold('lrMinimumGap');
    const primaryNodes = contract.primaryFlow.nodeIds.map((nodeId) => [String(nodeId), nodeOutlineBoxes.get(String(nodeId))]).filter((entry) => entry[1]);
    for (let index = 1; index < primaryNodes.length; index++) {
      const previous = primaryNodes[index - 1][1];
      const current = primaryNodes[index][1];
      const gap = contract.readingDirection === 'TB' ? current.top - previous.bottom : current.left - previous.right;
      if (gap < minimumGap - 0.5) axisGapErrors.push(primaryNodes[index - 1][0] + ':' + primaryNodes[index][0]);
    }
  }
  for (let first = 0; first < nodeEntries.length; first++) for (let second = first + 1; second < nodeEntries.length; second++) {
    if (overlaps(nodeEntries[first][1], nodeEntries[second][1])) nodeCollisionPairs.push(nodeEntries[first][0] + ':' + nodeEntries[second][0]);
  }
  const edgeNodeCollisionPairs = [];
  const edgeIntersectionPairs = [];
  const collinearOverlapPairs = [];
  const portDirectionErrors = [];
  const portApproachErrors = [];
  const edgeRecords = {};
  const edgeBBoxes = {};
  const arrowTargetByEdge = new Map([...document.querySelectorAll('[data-edge-arrow]')].map((element) => [element.getAttribute('data-edge-arrow') || '', element.getAttribute('data-arrow-target') || '']));
  const edgeBendCounts = {};
  const edgeGeometryKinds = {};
  const edgeSamples = [];
  const directionToken = (first, second) => {
    const dx = second[0] - first[0];
    const dy = second[1] - first[1];
    const tolerance = 1e-3;
    const normalizedX = Math.abs(dx) <= tolerance ? 0 : Math.sign(dx);
    const normalizedY = Math.abs(dy) <= tolerance ? 0 : Math.sign(dy);
    if (normalizedX === 0 && normalizedY === 0) return null;
    // getPointAtLength may straddle a sharp Manhattan corner by one sample.
    // Use the dominant component for bend counting; isOrthogonal still checks
    // the original coordinates and rejects genuine diagonal geometry.
    if (normalizedX !== 0 && normalizedY !== 0) {
      return Math.abs(dx) >= Math.abs(dy) ? normalizedX + ',0' : '0,' + normalizedY;
    }
    return normalizedX + ',' + normalizedY;
  };
  const bendCount = (points) => {
    const directions = [];
    for (let index = 1; index < points.length; index++) {
      const direction = directionToken(points[index - 1], points[index]);
      if (direction && directions[directions.length - 1] !== direction) directions.push(direction);
    }
    return directions.length === 0 ? 0 : directions.length - 1;
  };
  const parseLineSegments = (element) => {
    const raw = element.getAttribute('d');
    if (!raw) return null;
    const tokens = raw.match(/[a-zA-Z]|[-+]?(?:\\d*\\.?\\d+)(?:[eE][-+]?\\d+)?/g) || [];
    const segments = [];
    let index = 0;
    let command = '';
    let current = [0, 0];
    let subpathStart = [0, 0];
    const isCommand = (token) => /^[a-zA-Z]$/.test(token);
    const number = (token) => Number(token);
    while (index < tokens.length) {
      if (isCommand(tokens[index])) command = tokens[index++];
      if (!command) return null;
      const upper = command.toUpperCase();
      const relative = command === command.toLowerCase();
      if (upper === 'Z') {
        segments.push([current, subpathStart]);
        current = subpathStart;
        command = '';
        continue;
      }
      if (!['M', 'L', 'H', 'V'].includes(upper)) return null;
      const required = upper === 'H' || upper === 'V' ? 1 : 2;
      if (index + required > tokens.length || tokens.slice(index, index + required).some(isCommand)) return null;
      const values = tokens.slice(index, index + required).map(number);
      index += required;
      let next = current;
      if (upper === 'H') next = [relative ? current[0] + values[0] : values[0], current[1]];
      else if (upper === 'V') next = [current[0], relative ? current[1] + values[0] : values[0]];
      else next = [relative ? current[0] + values[0] : values[0], relative ? current[1] + values[1] : values[1]];
      if (upper === 'M') {
        current = next;
        subpathStart = next;
        command = relative ? 'l' : 'L';
      } else {
        segments.push([current, next]);
        current = next;
      }
    }
    return segments;
  };
  const isOrthogonal = (element, points) => {
    const pathSegments = parseLineSegments(element);
    if (pathSegments) {
      const matrix = element.getScreenCTM();
      return pathSegments.length > 0 && Boolean(matrix) && pathSegments.every(([first, second]) => {
        const firstScreen = new DOMPoint(first[0], first[1]).matrixTransform(matrix);
        const secondScreen = new DOMPoint(second[0], second[1]).matrixTransform(matrix);
        return Math.abs(firstScreen.x - secondScreen.x) <= 1 || Math.abs(firstScreen.y - secondScreen.y) <= 1;
      });
    }
    return points.length >= 2 && points.every((point, index) => index === 0 || Math.abs(point[0] - points[index - 1][0]) <= 1 || Math.abs(point[1] - points[index - 1][1]) <= 1);
  };
  const leavesPort = (points, port) => {
    if (points.length < 2) return false;
    const first = points[0];
    const second = points.find((point) => !pointEqual(first, point));
    if (!second) return false;
    if (port === 'top') return second[1] < first[1] - 1;
    if (port === 'right') return second[0] > first[0] + 1;
    if (port === 'bottom') return second[1] > first[1] + 1;
    return second[0] < first[0] - 1;
  };
  const entersPort = (points, port) => {
    if (points.length < 2) return false;
    const last = points[points.length - 1];
    let previous = null;
    for (let index = points.length - 2; index >= 0; index--) if (!pointEqual(points[index], last)) { previous = points[index]; break; }
    if (!previous) return false;
    if (port === 'top') return previous[1] < last[1] - 1;
    if (port === 'right') return previous[0] > last[0] + 1;
    if (port === 'bottom') return previous[1] > last[1] + 1;
    return previous[0] < last[0] - 1;
  };
  const portEntries = [];
  for (const edge of edgeElements) {
    const edgeId = edge.getAttribute('data-edge');
    if (!edgeId) continue;
    const geometry = edgeGeometry(edge);
    if (!geometry) continue;
    const rawSegments = parseLineSegments(edge);
    const matrix = edge.getScreenCTM();
    const screenSegments = rawSegments && matrix
      ? rawSegments.map(([first, second]) => {
        const firstScreen = new DOMPoint(first[0], first[1]).matrixTransform(matrix);
        const secondScreen = new DOMPoint(second[0], second[1]).matrixTransform(matrix);
        return [[firstScreen.x, firstScreen.y], [secondScreen.x, secondScreen.y]];
      })
      : geometry.points.slice(1).map((point, index) => [geometry.points[index], point]);
    edgeSamples.push({ id: edgeId, element: edge, points: geometry.points, segments: screenSegments });
    edgeBendCounts[edgeId] = bendCount(geometry.points);
    edgeGeometryKinds[edgeId] = edgeBendCounts[edgeId] === 0 ? 'direct' : (isOrthogonal(edge, geometry.points) ? 'manhattan' : 'custom');
    if (geometry.box) edgeBBoxes[edgeId] = geometry.box;
    edgeRecords[edgeId] = { from: edge.getAttribute('data-from') || '', to: edge.getAttribute('data-to') || '', fromPort: edge.getAttribute('data-from-port') || '', toPort: edge.getAttribute('data-to-port') || '', arrowTarget: arrowTargetByEdge.get(edgeId) || '' };
    if (edgeRecords[edgeId].from && edgeRecords[edgeId].fromPort) portEntries.push({ role: 'from', nodeId: edgeRecords[edgeId].from, port: edgeRecords[edgeId].fromPort, edgeId, point: geometry.points[0] });
    if (edgeRecords[edgeId].to && edgeRecords[edgeId].toPort) portEntries.push({ role: 'to', nodeId: edgeRecords[edgeId].to, port: edgeRecords[edgeId].toPort, edgeId, point: geometry.points[geometry.points.length - 1] });
    if (!leavesPort(geometry.points, edgeRecords[edgeId].fromPort) || !entersPort(geometry.points, edgeRecords[edgeId].toPort)) portDirectionErrors.push(edgeId);
    const targetBox = nodeOutlineBoxes.get(edgeRecords[edgeId].to);
    const lastPoint = geometry.points[geometry.points.length - 1];
    let previousPoint = null;
    for (let pointIndex = geometry.points.length - 2; pointIndex >= 0; pointIndex--) if (!pointEqual(geometry.points[pointIndex], lastPoint)) { previousPoint = geometry.points[pointIndex]; break; }
    if (previousPoint && pointInside(previousPoint, targetBox)) portApproachErrors.push(edgeId);
    const hitNodes = new Set();
    for (const screen of geometry.points) for (const [nodeId, box] of nodeBoxes) if (box && pointInside(screen, box)) hitNodes.add(nodeId);
    for (const nodeId of hitNodes) edgeNodeCollisionPairs.push(edgeId + ':' + nodeId);
  }
  if (geometryProfile?.axisSpacing && (contract.readingDirection === 'TB' || contract.readingDirection === 'LR') && contract.branchLayoutPlan && Array.isArray(contract.branchLayoutPlan.groups)) {
    const loopEdges = new Set(Array.isArray(contract.loopEdges) ? contract.loopEdges.map(String) : []);
    for (const group of contract.branchLayoutPlan.groups) {
      const primaryEdgeId = group && group.primaryEdgeId ? String(group.primaryEdgeId) : '';
      if (!primaryEdgeId || loopEdges.has(primaryEdgeId)) continue;
      const edge = edgeRecords[primaryEdgeId];
      const source = edge ? nodeOutlineBoxes.get(edge.from) : null;
      const target = edge ? nodeOutlineBoxes.get(edge.to) : null;
      if (!source || !target) continue;
      const sourceCross = contract.readingDirection === 'TB' ? (source.left + source.right) / 2 : (source.top + source.bottom) / 2;
      const targetCross = contract.readingDirection === 'TB' ? (target.left + target.right) / 2 : (target.top + target.bottom) / 2;
      if (Math.abs(sourceCross - targetCross) > geometryScale + 0.5) axisAlignmentErrors.push(primaryEdgeId);
    }
  }
  if (geometryProfile) {
    for (let first = 0; first < portEntries.length; first++) for (let second = first + 1; second < portEntries.length; second++) {
      const left = portEntries[first];
      const right = portEntries[second];
      if (left.role !== right.role || left.nodeId !== right.nodeId || left.port !== right.port) continue;
      const distance = ['top', 'bottom'].includes(left.port) ? Math.abs(left.point[0] - right.point[0]) : Math.abs(left.point[1] - right.point[1]);
      if (distance < geometryThreshold('portGap') - 0.5) portGapErrors.push(left.edgeId + ':' + right.edgeId);
    }
    for (const edgeSample of edgeSamples) {
      const edge = edgeRecords[edgeSample.id];
      for (const [nodeId, box] of nodeOutlineEntries) {
        if (nodeId === edge?.from || nodeId === edge?.to) continue;
        if (edgeSample.segments.some((segment) => segmentBoxDistance(segment[0], segment[1], box) < geometryThreshold('obstacleGap') - 0.5)) obstacleGapErrors.push(edgeSample.id + ':' + nodeId);
      }
    }
  }
  for (let first = 0; first < edgeSamples.length; first++) for (let second = first + 1; second < edgeSamples.length; second++) {
    const firstEdge = edgeSamples[first];
    const secondEdge = edgeSamples[second];
    let hasIntersection = false;
    let hasOverlap = false;
    for (const firstSegment of firstEdge.segments) for (const secondSegment of secondEdge.segments) {
      const relation = segmentRelation(firstSegment[0], firstSegment[1], secondSegment[0], secondSegment[1]);
      if (relation === 'overlap') hasOverlap = true;
      else if (relation === 'cross') hasIntersection = true;
      else if (relation === 'touch') {
        const sharedEndpoint = [firstSegment[0], firstSegment[1]].some((point) => [secondSegment[0], secondSegment[1]].some((candidate) => pointEqual(point, candidate)));
        if (!sharedEndpoint) hasIntersection = true;
      }
    }
    if (hasOverlap) collinearOverlapPairs.push(firstEdge.id + ':' + secondEdge.id);
    if (hasIntersection) edgeIntersectionPairs.push(firstEdge.id + ':' + secondEdge.id);
  }
  if (geometryProfile && Array.isArray(contract.loopLanes) && (contract.readingDirection === 'TB' || contract.readingDirection === 'LR')) {
    const laneGeometry = contract.loopLanes.map((lane) => {
      const coordinates = lane.edgeIds.flatMap((edgeId) => {
        const sample = edgeSamples.find((candidate) => candidate.id === String(edgeId));
        if (!sample) return [];
        const points = sample.points.length > 2 ? sample.points.slice(1, -1) : sample.points;
        return points.map((point) => contract.readingDirection === 'TB' ? point[0] : point[1]);
      }).filter((value) => Number.isFinite(value));
      if (coordinates.length === 0) return null;
      return { id: String(lane.id), side: String(lane.side), coordinate: lane.side === 'left' ? Math.min(...coordinates) : Math.max(...coordinates) };
    }).filter(Boolean);
    for (let first = 0; first < laneGeometry.length; first++) for (let second = first + 1; second < laneGeometry.length; second++) {
      if (laneGeometry[first].side === laneGeometry[second].side && Math.abs(laneGeometry[first].coordinate - laneGeometry[second].coordinate) < geometryThreshold('laneGap') - 0.5) laneGapErrors.push(laneGeometry[first].id + ':' + laneGeometry[second].id);
    }
  }
  const labelElements = [...document.querySelectorAll('[data-edge-label]')].filter((element) => !element.matches('path[data-edge]'));
  const labelBoxes = new Map(labelElements.map((element) => [element.getAttribute('data-edge-label') || '', { element, box: bounds(element) }]));
  const edgeLabels = Object.fromEntries(labelElements.map((element) => [element.getAttribute('data-edge-label') || '', element.textContent?.trim() || '']).filter(([id]) => Boolean(id)));
  if (geometryProfile) for (const [labelId, label] of labelBoxes) {
    const edge = edgeRecords[labelId];
    if (!label.box || !edge) continue;
    for (const [nodeId, nodeBox] of nodeOutlineEntries) {
      if (nodeId === edge.from || nodeId === edge.to) continue;
      if (boxGap(label.box, nodeBox) < geometryThreshold('obstacleGap') - 0.5) labelObstacleGapErrors.push(labelId + ':' + nodeId);
    }
  }
  const labelEdgeCollisionPairs = [];
  const labelNodeCollisionPairs = [];
  const labelLabelCollisionPairs = [];
  const labelArrowCollisionPairs = [];
  for (const [labelId, label] of labelBoxes) {
    if (!labelId || !label.box) continue;
    for (const edgeSample of edgeSamples) {
      for (let pointIndex = 1; pointIndex < edgeSample.points.length; pointIndex++) {
        if (segmentIntersectsBox(edgeSample.points[pointIndex - 1], edgeSample.points[pointIndex], label.box)) {
          labelEdgeCollisionPairs.push(labelId + ':' + edgeSample.id);
          break;
        }
      }
    }
    for (const [nodeId, nodeBox] of nodeBoxes) if (nodeId && nodeBox && overlaps(label.box, nodeBox)) labelNodeCollisionPairs.push(labelId + ':' + nodeId);
    for (const [otherId, other] of labelBoxes) if (otherId && otherId !== labelId && other.box && overlaps(label.box, other.box)) labelLabelCollisionPairs.push(labelId + ':' + otherId);
    for (const arrow of document.querySelectorAll('[data-edge-arrow]')) {
      const arrowId = arrow.getAttribute('data-edge-arrow') || '';
      if (arrowId && overlaps(label.box, bounds(arrow))) labelArrowCollisionPairs.push(labelId + ':' + arrowId);
    }
  }
  const labelPlacementErrors = [];
  for (const [labelId, label] of labelBoxes) {
    const edgeSample = edgeSamples.find((candidate) => candidate.id === labelId);
    const localSegments = edgeSample ? parseLineSegments(edgeSample.element) : null;
    const matrix = edgeSample?.element.getScreenCTM();
    if (!label.box || !localSegments || !matrix) {
      labelPlacementErrors.push(labelId || 'unknown');
      continue;
    }
    const labelCenter = [(label.box.left + label.box.right) / 2, (label.box.top + label.box.bottom) / 2];
    const scale = Math.max(0.01, Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)));
    const valid = localSegments.some(([first, second]) => {
      const firstScreen = new DOMPoint(first[0], first[1]).matrixTransform(matrix);
      const secondScreen = new DOMPoint(second[0], second[1]).matrixTransform(matrix);
      const dx = secondScreen.x - firstScreen.x;
      const dy = secondScreen.y - firstScreen.y;
      const length = Math.hypot(dx, dy);
      if (length <= 0) return false;
      const tangent = [dx / length, dy / length];
      const normal = [-tangent[1], tangent[0]];
      const midpoint = [(firstScreen.x + secondScreen.x) / 2, (firstScreen.y + secondScreen.y) / 2];
      const offset = [labelCenter[0] - midpoint[0], labelCenter[1] - midpoint[1]];
      const parallelDistance = Math.abs(offset[0] * tangent[0] + offset[1] * tangent[1]);
      const perpendicularDistance = Math.abs(offset[0] * normal[0] + offset[1] * normal[1]);
      const perpendicularRadius = Math.abs(normal[0]) * label.box.width / 2 + Math.abs(normal[1]) * label.box.height / 2;
      return parallelDistance <= Math.max(2, scale * 2) && perpendicularDistance >= perpendicularRadius + visualStyle.labelClearance * scale;
    });
    if (!valid) labelPlacementErrors.push(labelId || 'unknown');
  }
  const groupId = (element) => element.getAttribute('data-group') || (element.id && element.id.startsWith('group-') ? element.id.slice('group-'.length) : '');
  const groupElements = [...new Set([...document.querySelectorAll('[data-group], [id^="group-"]')])];
  const groupBoxes = new Map(groupElements.map((element) => [groupId(element), bounds(element)]));
  const groupOverlapPairs = [];
  const groupEntries = [...groupBoxes.entries()].filter((entry) => entry[0] && entry[1]);
  for (let first = 0; first < groupEntries.length; first++) for (let second = first + 1; second < groupEntries.length; second++) {
    if (overlaps(groupEntries[first][1], groupEntries[second][1])) groupOverlapPairs.push(groupEntries[first][0] + ':' + groupEntries[second][0]);
  }
  const groupCapacityErrors = [];
  const groupTitleErrors = [];
  const groupTitleElements = [...document.querySelectorAll('text[data-group-title]')];
  const groupScaleMatrix = svg?.getScreenCTM();
  const groupScale = groupScaleMatrix ? Math.max(0.01, Math.min(Math.hypot(groupScaleMatrix.a, groupScaleMatrix.b), Math.hypot(groupScaleMatrix.c, groupScaleMatrix.d))) : 1;
  const groupDefinitions = contract.groups && typeof contract.groups === 'object' ? contract.groups : {};
  const contains = (outer, inner) => Boolean(outer && inner && inner.left >= outer.left - 1 && inner.top >= outer.top - 1 && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1);
  for (const [id, definition] of Object.entries(groupDefinitions)) {
    const groupBox = groupBoxes.get(id);
    if (!groupBox) continue;
    const group = definition && typeof definition === 'object' ? definition : {};
    const titles = groupTitleElements.filter((element) => element.getAttribute('data-group-title') === id);
    if (titles.length !== 1 || titles[0].getAttribute('data-group-style-role') !== String(group.styleRole || '')) groupTitleErrors.push(id + ':mapping');
    const memberIds = Array.isArray(group.members) ? group.members.map(String) : [];
    const memberBoxes = memberIds.map((nodeId) => nodeBoxes.get(nodeId)).filter(Boolean);
    if (memberBoxes.length === 0) continue;
    const internalEdges = edgeSamples.filter((sample) => {
      const edge = edgeRecords[sample.id];
      return edge && memberIds.includes(edge.from) && memberIds.includes(edge.to);
    });
    const internalEdgeIds = new Set(internalEdges.map((sample) => sample.id));
    const contentBoxes = [
      ...memberBoxes,
      ...internalEdges.map((sample) => bounds(sample.element)).filter(Boolean),
      ...[...labelBoxes.entries()].filter(([edgeId]) => internalEdgeIds.has(edgeId)).map(([, label]) => label.box).filter(Boolean),
    ];
    const content = {
      left: Math.min(...contentBoxes.map((box) => box.left)),
      top: Math.min(...contentBoxes.map((box) => box.top)),
      right: Math.max(...contentBoxes.map((box) => box.right)),
      bottom: Math.max(...contentBoxes.map((box) => box.bottom)),
    };
    const titleBox = titles.length === 1 ? bounds(titles[0]) : null;
    if (!titleBox || !contains(groupBox, titleBox) || overlaps(titleBox, content)) groupTitleErrors.push(id + ':placement');
    if (!contains(groupBox, content)) groupCapacityErrors.push(id + ':containment');
    if (content.top - groupBox.top < layoutMetrics.groupHeaderHeight * groupScale) groupCapacityErrors.push(id + ':header');
    if (content.left - groupBox.left < layoutMetrics.groupHorizontalPadding * groupScale || groupBox.right - content.right < layoutMetrics.groupHorizontalPadding * groupScale || groupBox.bottom - content.bottom < layoutMetrics.groupBottomPadding * groupScale) groupCapacityErrors.push(id + ':padding');
  }
  const lifelineCoordinates = {};
  for (const element of [...document.querySelectorAll('[data-lifeline-for]')]) {
    const id = element.getAttribute('data-lifeline-for');
    const x1 = Number(element.getAttribute('x1'));
    const x2 = Number(element.getAttribute('x2'));
    const box = bounds(element);
    if (id) lifelineCoordinates[id] = Number.isFinite(x1) ? (Number.isFinite(x2) ? (x1 + x2) / 2 : x1) : (box ? (box.left + box.right) / 2 : NaN);
  }
  const nodeCenterPoints = Object.fromEntries([...nodeBoxes.entries()].filter((entry) => entry[0] && entry[1]).map(([id, box]) => [id, { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }]));
  const sideSwitchDetectedEdgeIds = [];
  const sideSwitchErrors = [];
  const viewBoxValues = svg?.viewBox?.baseVal;
  const svgMatrixForAxis = svg?.getScreenCTM();
  if ((contract.readingDirection === 'TB' || contract.readingDirection === 'LR') && Number.isFinite(Number(contract.mainAxis)) && viewBoxValues && svgMatrixForAxis && viewBoxValues.width > 0 && viewBoxValues.height > 0) {
    const axisPoint = contract.readingDirection === 'TB'
      ? new DOMPoint(Number(contract.mainAxis), viewBoxValues.y).matrixTransform(svgMatrixForAxis)
      : new DOMPoint(viewBoxValues.x, Number(contract.mainAxis)).matrixTransform(svgMatrixForAxis);
    const screenAxis = contract.readingDirection === 'TB' ? axisPoint.x : axisPoint.y;
    const sideOf = (point) => {
      const delta = (contract.readingDirection === 'TB' ? point[0] : point[1]) - screenAxis;
      return delta > 1 ? 1 : delta < -1 ? -1 : 0;
    };
    const loopEdges = new Set(Array.isArray(contract.loopEdges) ? contract.loopEdges.map(String) : []);
    const allowed = new Set(Array.isArray(contract.sideSwitchExceptionEdgeIds) ? contract.sideSwitchExceptionEdgeIds.map(String) : []);
    for (const edgeSample of edgeSamples) {
      if (loopEdges.has(edgeSample.id)) continue;
      const edge = edgeRecords[edgeSample.id];
      const source = edge && nodeCenterPoints[edge.from];
      const target = edge && nodeCenterPoints[edge.to];
      if (!source || !target) continue;
      const sourceSide = sideOf([source.x, source.y]);
      const targetSide = sideOf([target.x, target.y]);
      if (sourceSide === 0 || targetSide === 0) continue;
      const sides = edgeSample.points.map(sideOf).filter((side) => side !== 0);
      let invalid = sourceSide === targetSide ? sides.some((side) => side !== sourceSide) : false;
      if (sourceSide !== targetSide) {
        let switches = 0;
        for (let pointIndex = 1; pointIndex < sides.length; pointIndex++) if (sides[pointIndex] !== sides[pointIndex - 1]) switches++;
        invalid = switches > 1;
      }
      if (invalid) {
        sideSwitchDetectedEdgeIds.push(edgeSample.id);
        if (!allowed.has(edgeSample.id)) sideSwitchErrors.push(edgeSample.id);
      }
    }
  }
  const noteElements = [...document.querySelectorAll('[data-note]')];
  const legendElements = [...document.querySelectorAll('[data-legend-item]')];
  const orderedDecorations = [...document.querySelectorAll('[data-legend-item], [data-note]')];
  const lastLegendIndex = Math.max(-1, ...legendElements.map((element) => orderedDecorations.indexOf(element)));
  const firstNoteIndex = Math.min(orderedDecorations.length, ...noteElements.map((element) => orderedDecorations.indexOf(element)));
  const legendBeforeNotes = lastLegendIndex < 0 || firstNoteIndex >= orderedDecorations.length || lastLegendIndex < firstNoteIndex;
  const svgBounds = svg ? bounds(svg) : null;
  const arrowVisibilityErrors = [];
  const arrowOcclusionPairs = [];
  const arrowDecorationOcclusionPairs = [];
  const arrowElements = [...document.querySelectorAll('[data-edge-arrow]')];
  const decorativeBlockers = [
    ...labelElements.map((element) => ['label:' + (element.getAttribute('data-edge-label') || 'unknown'), element]),
    ...legendElements.map((element) => ['legend:' + (element.getAttribute('data-legend-item') || 'unknown'), element]),
    ...groupElements.map((element) => ['group:' + groupId(element), element]),
  ];
  for (const arrow of arrowElements) {
    const arrowId = arrow.getAttribute('data-edge-arrow') || '';
    const arrowBox = bounds(arrow);
    if (!arrowBox || arrowBox.width <= 0 || arrowBox.height <= 0) arrowVisibilityErrors.push(arrowId || 'unknown');
    const target = (arrow.getAttribute('data-arrow-target') || '').split(':')[0];
    for (const [nodeId, nodeBox] of nodeBoxes) if (nodeBox && nodeId && nodeId !== target && arrowBox && overlaps(arrowBox, nodeBox)) arrowOcclusionPairs.push(arrowId + ':' + nodeId);
    for (const [blockerId, blocker] of decorativeBlockers) if (arrowBox && overlaps(arrowBox, bounds(blocker)) && paintedAfter(blocker, arrow)) arrowDecorationOcclusionPairs.push(arrowId + ':' + blockerId);
  }
  const textOverflowIds = [];
  const textOverlapPairs = [];
  const textElements = [...document.querySelectorAll('svg text')].flatMap((element) => {
    const tspans = [...element.querySelectorAll(':scope > tspan')];
    return tspans.length > 0 ? tspans : [element];
  });
  const textEntries = textElements.map((element, index) => ({ id: element.getAttribute('data-text-id') || String(index), element, box: bounds(element), owner: element.closest('[data-node], [data-edge], [data-edge-arrow], [data-edge-label], [data-note], [data-legend-item]') }));
  const visualStyleErrors = [];
  const black = (value) => value === 'rgb(0, 0, 0)' || value === '#000000' || value === '#000';
  const structuralGray = (value) => value === 'rgb(102, 102, 102)' || value === 'rgb(102,102,102)' || value === '#666666' || value === '#666';
  const white = (value) => value === 'rgb(255, 255, 255)' || value === '#ffffff' || value === '#fff';
  const structuralGroupFrame = (element) => element?.hasAttribute('data-group') && element.getAttribute('data-group-style-role') === 'structural';
  const structuralGroupTitle = (element) => element?.hasAttribute('data-group-title') && element.getAttribute('data-group-style-role') === 'structural';
  const frameStyle = (element, id) => {
    const style = getComputedStyle(element);
    const expectedInk = structuralGroupFrame(element) ? structuralGray : black;
    if (style.fill !== 'none' || !expectedInk(style.stroke) || Math.abs(parseFloat(style.strokeWidth) - visualStyle.strokeWidth) > 0.01) visualStyleErrors.push(id);
  };
  const backgrounds = [...document.querySelectorAll('[data-canvas-background]')];
  if (backgrounds.length !== 1) visualStyleErrors.push('canvas-background-count');
  else {
    const style = getComputedStyle(backgrounds[0]);
    if (!white(style.fill) || style.stroke !== 'none' || Number(style.opacity) !== 1) visualStyleErrors.push('canvas-background-style');
  }
  if (legendElements.length > 0 || noteElements.length > 0) visualStyleErrors.push('global-legend-or-note');
  for (const node of nodeElements) frameStyle(nodeOutline(node), 'node:' + (node.getAttribute('data-node') || 'unknown'));
  for (const group of groupElements) frameStyle(nodeOutline(group), 'group:' + groupId(group));
  for (const edge of edgeElements) frameStyle(edge, 'edge:' + (edge.getAttribute('data-edge') || 'unknown'));
  for (const lifeline of document.querySelectorAll('[data-lifeline-for]')) frameStyle(lifeline, 'lifeline:' + (lifeline.getAttribute('data-lifeline-for') || 'unknown'));
  for (const label of labelElements) if (label.tagName.toLowerCase() !== 'text' || label.querySelector('rect, polygon, ellipse, circle, path')) visualStyleErrors.push('label-frame:' + (label.getAttribute('data-edge-label') || 'unknown'));
  for (const entry of textEntries) {
    const style = getComputedStyle(entry.element);
    const edgeLabel = entry.element.hasAttribute('data-edge-label');
    const firstFont = style.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    const expectedSize = edgeLabel ? visualStyle.edgeLabelFontSize : visualStyle.frameFontSize;
    const expectedTextInk = structuralGroupTitle(entry.element) ? structuralGray : black;
    if ((firstFont !== 'microsoft yahei' && firstFont !== '微软雅黑') || Math.abs(parseFloat(style.fontSize) - expectedSize) > 0.01 || !expectedTextInk(style.fill)) visualStyleErrors.push('text:' + entry.id);
    if (edgeLabel && (style.textAnchor !== 'middle' || !['middle', 'central'].includes(style.dominantBaseline))) visualStyleErrors.push('label-anchor:' + entry.id);
  }
  for (const marker of document.querySelectorAll('marker')) {
    if (Number(marker.getAttribute('markerWidth')) !== visualStyle.arrowWidth || Number(marker.getAttribute('markerHeight')) !== visualStyle.arrowHeight || marker.getAttribute('markerUnits') !== 'userSpaceOnUse') visualStyleErrors.push('marker:' + (marker.id || 'unknown'));
    const shape = marker.querySelector('path, polygon');
    if (!shape || !black(getComputedStyle(shape).fill)) visualStyleErrors.push('marker-fill:' + (marker.id || 'unknown'));
  }
  for (const arrow of arrowElements) {
    const box = typeof arrow.getBBox === 'function' ? arrow.getBBox() : null;
    if (!box || Math.abs(box.width - visualStyle.arrowWidth) > 0.01 || Math.abs(box.height - visualStyle.arrowHeight) > 0.01 || !black(getComputedStyle(arrow).fill)) visualStyleErrors.push('arrow:' + (arrow.getAttribute('data-edge-arrow') || 'unknown'));
  }
  for (const entry of textEntries) if (entry.box && svgBounds && (entry.box.left < svgBounds.left - 1 || entry.box.right > svgBounds.right + 1 || entry.box.top < svgBounds.top - 1 || entry.box.bottom > svgBounds.bottom + 1)) textOverflowIds.push(entry.id);
  for (let first = 0; first < textEntries.length; first++) for (let second = first + 1; second < textEntries.length; second++) {
    const firstOwner = textEntries[first].owner;
    const secondOwner = textEntries[second].owner;
    if (firstOwner && secondOwner && firstOwner === secondOwner) continue;
    if (overlaps(textEntries[first].box, textEntries[second].box)) textOverlapPairs.push(textEntries[first].id + ':' + textEntries[second].id);
  }
  const tracked = [...new Set([...document.querySelectorAll('[data-node], path[data-edge], [data-edge-arrow], [data-legend-item], [data-note], [data-lifeline-for], [data-group], [data-group-title], [id^="group-"]')])];
  const visibleBoxes = tracked.map(bounds).filter(Boolean);
  const contentBBox = visibleBoxes.length > 0 ? {
    left: Math.min(...visibleBoxes.map((box) => box.left)),
    top: Math.min(...visibleBoxes.map((box) => box.top)),
    right: Math.max(...visibleBoxes.map((box) => box.right)),
    bottom: Math.max(...visibleBoxes.map((box) => box.bottom)),
  } : null;
  const horizontalOverflow = Boolean(svgBounds && (svgBounds.left < -1 || svgBounds.right > window.innerWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1));
  const outsideViewportCount = tracked.filter((element) => {
    const box = bounds(element);
    return box && (box.left < -1 || box.right > window.innerWidth + 1);
  }).length;
  const contentFullyVisible = Boolean(contentBBox && contentBBox.left >= -1 && contentBBox.top >= -1 && contentBBox.right <= window.innerWidth + 1 && contentBBox.bottom <= window.innerHeight + 1);
  const nodeShapes = Object.fromEntries(nodeElements.map((element) => [element.getAttribute('data-node'), element.getAttribute('data-node-shape') || '']));
  return {
    role: svg?.getAttribute('role') ?? null,
    title: svg?.querySelector(':scope > title')?.textContent?.trim() ?? '',
    description: svg?.querySelector(':scope > desc')?.textContent?.trim() ?? '',
    viewBox: svg?.getAttribute('viewBox') ?? null,
    svgWidth: svgBounds?.width ?? 0,
    svgHeight: svgBounds?.height ?? 0,
    nodeIds: ids('[data-node]', 'data-node'),
    edgeIds: ids('path[data-edge]:not([data-edge-arrow])', 'data-edge'),
    arrowTargets: ids('[data-arrow-target]', 'data-arrow-target'),
    groupIds: [...groupBoxes.keys()],
    legendIds: ids('[data-legend-item]', 'data-legend-item'),
    noteIds: ids('[data-note]', 'data-note'),
    legendBeforeNotes,
    nodeCenters: nodeCenterPoints,
    nodeShapes,
    edgeRecords,
    edgeBBoxes,
    edgeBendCounts,
    edgeGeometryKinds,
    edgeLabelIds: [...labelBoxes.keys()].filter(Boolean),
    edgeLabels,
    labelNodeCollisionPairs,
    labelLabelCollisionPairs,
    labelArrowCollisionPairs,
    edgeIntersectionPairs,
    collinearOverlapPairs,
    portDirectionErrors,
    portApproachErrors,
    sideSwitchDetectedEdgeIds,
    sideSwitchErrors,
    arrowVisibilityErrors,
    arrowOcclusionPairs,
    arrowDecorationOcclusionPairs,
    labelEdgeCollisionPairs,
    labelPlacementErrors,
    visualStyleErrors,
    textOverflowIds,
    textOverlapPairs,
    contentBBox,
    horizontalOverflow,
    lifelineIds: ids('[data-lifeline-for]', 'data-lifeline-for'),
    lifelineCoordinates,
    nodeCollisionPairs,
    edgeNodeCollisionPairs,
    entityGapErrors,
    axisGapErrors,
    axisAlignmentErrors,
    portGapErrors,
    obstacleGapErrors,
    labelObstacleGapErrors,
    laneGapErrors,
    scroll: { x: window.scrollX, y: window.scrollY },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    contentFullyVisible,
    groupOverlapPairs,
    groupCapacityErrors,
    groupTitleErrors,
    unsafeCount: document.querySelectorAll('script, foreignObject, iframe, object, embed').length,
    outsideViewportCount,
    };
  } catch (error) {
    return { scriptError: String(error && error.stack || error) };
  }
}`;

function inspection(payload: unknown): InspectionResult {
  let candidate: unknown = payload;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof candidate === "string") {
      try { candidate = JSON.parse(candidate); continue; } catch { break; }
    }
    if (Array.isArray(candidate)) {
      if (candidate.length !== 1) break;
      candidate = candidate[0];
      continue;
    }
    if (!candidate || typeof candidate !== "object") break;
    const wrapper = candidate as Record<string, unknown>;
    if (wrapper.result !== undefined) candidate = wrapper.result;
    else if (wrapper.value !== undefined) candidate = wrapper.value;
    else break;
  }
  const data = record(candidate, "inspection result");
  if (typeof data.scriptError === "string") fail(`browser inspection script failed: ${data.scriptError}`);
  return {
    role: data.role === null ? null : String(data.role),
    title: String(data.title || ""),
    description: String(data.description || ""),
    viewBox: data.viewBox === null ? null : String(data.viewBox),
    svgWidth: Number(data.svgWidth || 0),
    svgHeight: Number(data.svgHeight || 0),
    nodeIds: Array.isArray(data.nodeIds) ? data.nodeIds.map(String) : [],
    edgeIds: Array.isArray(data.edgeIds) ? data.edgeIds.map(String) : [],
    arrowTargets: Array.isArray(data.arrowTargets) ? data.arrowTargets.map(String) : [],
    groupIds: Array.isArray(data.groupIds) ? data.groupIds.map(String) : [],
    legendIds: Array.isArray(data.legendIds) ? data.legendIds.map(String) : [],
    noteIds: Array.isArray(data.noteIds) ? data.noteIds.map(String) : [],
    legendBeforeNotes: data.legendBeforeNotes !== false,
    nodeCenters: data.nodeCenters && typeof data.nodeCenters === "object" ? Object.fromEntries(Object.entries(data.nodeCenters).map(([key, value]) => {
      const center = record(value, `node center ${key}`);
      return [key, { x: Number(center.x), y: Number(center.y) }];
    })) : {},
    nodeShapes: data.nodeShapes && typeof data.nodeShapes === "object" ? Object.fromEntries(Object.entries(data.nodeShapes).map(([key, value]) => [key, String(value)])) : {},
    edgeRecords: data.edgeRecords && typeof data.edgeRecords === "object" ? Object.fromEntries(Object.entries(data.edgeRecords).map(([key, value]) => {
      const edge = record(value, `edge record ${key}`);
      return [key, { from: String(edge.from || ""), to: String(edge.to || ""), fromPort: String(edge.fromPort || ""), toPort: String(edge.toPort || ""), arrowTarget: String(edge.arrowTarget || "") }];
    })) : {},
    edgeBBoxes: data.edgeBBoxes && typeof data.edgeBBoxes === "object" ? Object.fromEntries(Object.entries(data.edgeBBoxes).map(([key, value]) => {
      const box = record(value, `edge bbox ${key}`);
      return [key, { left: Number(box.left), top: Number(box.top), right: Number(box.right), bottom: Number(box.bottom) }];
    })) : {},
    edgeBendCounts: data.edgeBendCounts && typeof data.edgeBendCounts === "object" ? Object.fromEntries(Object.entries(data.edgeBendCounts).map(([key, value]) => [key, Number(value)])) : {},
    edgeGeometryKinds: data.edgeGeometryKinds && typeof data.edgeGeometryKinds === "object" ? Object.fromEntries(Object.entries(data.edgeGeometryKinds).map(([key, value]) => [key, String(value) as "direct" | "manhattan" | "custom"])) : {},
    edgeLabelIds: Array.isArray(data.edgeLabelIds) ? data.edgeLabelIds.map(String) : [],
    edgeLabels: data.edgeLabels && typeof data.edgeLabels === "object" ? Object.fromEntries(Object.entries(data.edgeLabels).map(([key, value]) => [key, String(value)])) : {},
    labelNodeCollisionPairs: Array.isArray(data.labelNodeCollisionPairs) ? data.labelNodeCollisionPairs.map(String) : [],
    labelLabelCollisionPairs: Array.isArray(data.labelLabelCollisionPairs) ? data.labelLabelCollisionPairs.map(String) : [],
    labelArrowCollisionPairs: Array.isArray(data.labelArrowCollisionPairs) ? data.labelArrowCollisionPairs.map(String) : [],
    edgeIntersectionPairs: Array.isArray(data.edgeIntersectionPairs) ? data.edgeIntersectionPairs.map(String) : [],
    collinearOverlapPairs: Array.isArray(data.collinearOverlapPairs) ? data.collinearOverlapPairs.map(String) : [],
    portDirectionErrors: Array.isArray(data.portDirectionErrors) ? data.portDirectionErrors.map(String) : [],
    portApproachErrors: Array.isArray(data.portApproachErrors) ? data.portApproachErrors.map(String) : [],
    sideSwitchDetectedEdgeIds: Array.isArray(data.sideSwitchDetectedEdgeIds) ? data.sideSwitchDetectedEdgeIds.map(String) : [],
    sideSwitchErrors: Array.isArray(data.sideSwitchErrors) ? data.sideSwitchErrors.map(String) : [],
    arrowVisibilityErrors: Array.isArray(data.arrowVisibilityErrors) ? data.arrowVisibilityErrors.map(String) : [],
    arrowOcclusionPairs: Array.isArray(data.arrowOcclusionPairs) ? data.arrowOcclusionPairs.map(String) : [],
    arrowDecorationOcclusionPairs: Array.isArray(data.arrowDecorationOcclusionPairs) ? data.arrowDecorationOcclusionPairs.map(String) : [],
    labelEdgeCollisionPairs: Array.isArray(data.labelEdgeCollisionPairs) ? data.labelEdgeCollisionPairs.map(String) : [],
    labelPlacementErrors: Array.isArray(data.labelPlacementErrors) ? data.labelPlacementErrors.map(String) : [],
    visualStyleErrors: Array.isArray(data.visualStyleErrors) ? data.visualStyleErrors.map(String) : [],
    textOverflowIds: Array.isArray(data.textOverflowIds) ? data.textOverflowIds.map(String) : [],
    textOverlapPairs: Array.isArray(data.textOverlapPairs) ? data.textOverlapPairs.map(String) : [],
    contentBBox: data.contentBBox && typeof data.contentBBox === "object" ? (() => {
      const box = record(data.contentBBox, "content bbox");
      return { left: Number(box.left), top: Number(box.top), right: Number(box.right), bottom: Number(box.bottom) };
    })() : null,
    horizontalOverflow: data.horizontalOverflow === true,
    lifelineIds: Array.isArray(data.lifelineIds) ? data.lifelineIds.map(String) : [],
    lifelineCoordinates: data.lifelineCoordinates && typeof data.lifelineCoordinates === "object" ? Object.fromEntries(Object.entries(data.lifelineCoordinates).map(([key, value]) => [key, Number(value)])) : {},
    nodeCollisionPairs: Array.isArray(data.nodeCollisionPairs) ? data.nodeCollisionPairs.map(String) : [],
    edgeNodeCollisionPairs: Array.isArray(data.edgeNodeCollisionPairs) ? data.edgeNodeCollisionPairs.map(String) : [],
    entityGapErrors: Array.isArray(data.entityGapErrors) ? data.entityGapErrors.map(String) : [],
    axisGapErrors: Array.isArray(data.axisGapErrors) ? data.axisGapErrors.map(String) : [],
    axisAlignmentErrors: Array.isArray(data.axisAlignmentErrors) ? data.axisAlignmentErrors.map(String) : [],
    portGapErrors: Array.isArray(data.portGapErrors) ? data.portGapErrors.map(String) : [],
    obstacleGapErrors: Array.isArray(data.obstacleGapErrors) ? data.obstacleGapErrors.map(String) : [],
    labelObstacleGapErrors: Array.isArray(data.labelObstacleGapErrors) ? data.labelObstacleGapErrors.map(String) : [],
    laneGapErrors: Array.isArray(data.laneGapErrors) ? data.laneGapErrors.map(String) : [],
    scroll: data.scroll && typeof data.scroll === "object" ? { x: Number((data.scroll as Record<string, unknown>).x || 0), y: Number((data.scroll as Record<string, unknown>).y || 0) } : { x: 0, y: 0 },
    viewport: data.viewport && typeof data.viewport === "object" ? { width: Number((data.viewport as Record<string, unknown>).width || 0), height: Number((data.viewport as Record<string, unknown>).height || 0) } : { width: 0, height: 0 },
    contentFullyVisible: data.contentFullyVisible === true,
    groupOverlapPairs: Array.isArray(data.groupOverlapPairs) ? data.groupOverlapPairs.map(String) : [],
    groupCapacityErrors: Array.isArray(data.groupCapacityErrors) ? data.groupCapacityErrors.map(String) : [],
    groupTitleErrors: Array.isArray(data.groupTitleErrors) ? data.groupTitleErrors.map(String) : [],
    unsafeCount: Number(data.unsafeCount || 0),
    outsideViewportCount: Number(data.outsideViewportCount || 0),
  };
}

function equalIds(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((id) => actual.includes(id));
}

function readingPathTrace(result: InspectionResult, expected: ExpectedContract): Array<{ id: string; nodes_found: boolean; edges_found: boolean; labels_found: boolean; missing_nodes: string[]; missing_edges: string[]; missing_labels: string[] }> {
  return (expected.sourceGraph?.readingPaths || []).map((path) => {
    const missingNodes = path.nodeIds.filter((nodeId) => !result.nodeIds.includes(nodeId));
    const missingEdges = path.edgeIds.filter((edgeId) => !result.edgeIds.includes(edgeId));
    const visibleLabels = path.edgeIds.map((edgeId) => result.edgeLabels[edgeId] || "");
    const missingLabels = path.requiredLabels.filter((label) => !visibleLabels.includes(label));
    return { id: path.id, nodes_found: missingNodes.length === 0, edges_found: missingEdges.length === 0, labels_found: missingLabels.length === 0, missing_nodes: missingNodes, missing_edges: missingEdges, missing_labels: missingLabels };
  });
}

function validateInspection(result: InspectionResult, expected?: ExpectedContract, actualLayout: ActualLayout = { nodeCenters: {}, groups: {} }, readingView: ReadingView = "normal"): string[] {
  const errors: string[] = [];
  if (result.role !== "img") errors.push('SVG role must be "img"');
  if (!result.title) errors.push("SVG title is empty or missing");
  if (!result.description) errors.push("SVG desc is empty or missing");
  if (!result.viewBox) errors.push("SVG viewBox is missing");
  if (result.svgWidth <= 0 || result.svgHeight <= 0) errors.push("SVG has no visible browser bounds");
  if (result.nodeCollisionPairs.length > 0) errors.push(`SVG node geometry collides: ${result.nodeCollisionPairs.join(", ")}`);
  if (result.entityGapErrors.length > 0) errors.push(`SVG entity gap is below the shared profile: ${result.entityGapErrors.join(", ")}`);
  if (result.axisGapErrors.length > 0) errors.push(`SVG primary-flow axis gap is below the directional profile: ${result.axisGapErrors.join(", ")}`);
  if (result.axisAlignmentErrors.length > 0) errors.push(`SVG primary branch is not aligned to the main axis: ${result.axisAlignmentErrors.join(", ")}`);
  if (result.portGapErrors.length > 0) errors.push(`SVG port gap is below the shared profile: ${result.portGapErrors.join(", ")}`);
  if (result.obstacleGapErrors.length > 0) errors.push(`SVG edge obstacle gap is below the shared profile: ${result.obstacleGapErrors.join(", ")}`);
  if (result.labelObstacleGapErrors.length > 0) errors.push(`SVG label obstacle gap is below the shared profile: ${result.labelObstacleGapErrors.join(", ")}`);
  if (result.laneGapErrors.length > 0) errors.push(`SVG feedback lanes are closer than the shared lane gap: ${result.laneGapErrors.join(", ")}`);
  const edgePairKey = (pair: string): string => pair.split(":").sort().join("\u0000");
  const actualCrossings = new Set(result.edgeIntersectionPairs.map(edgePairKey));
  const expectedCrossingExceptions = new Set(expected?.routeContract.exceptions.filter((exception) => exception.type === "crossing").map((exception) => exception.edgeIds.slice().sort().join("\u0000")) || []);
  const unexpectedCrossings = result.edgeIntersectionPairs.filter((pair) => !expectedCrossingExceptions.has(edgePairKey(pair)));
  if (unexpectedCrossings.length > 0) errors.push(`SVG edge geometry intersects outside expected exceptions: ${unexpectedCrossings.join(", ")}`);
  if (expected) {
    for (const exception of expected.routeContract.exceptions.filter((entry) => entry.type === "crossing")) {
      const pair = exception.edgeIds.slice().sort().join("\u0000");
      if (!actualCrossings.has(pair)) errors.push(`SVG expected crossing exception is not observed: ${exception.edgeIds.join("/")}`);
    }
  }
  if (result.collinearOverlapPairs.length > 0) errors.push(`SVG edges have non-declared collinear overlap: ${result.collinearOverlapPairs.join(", ")}`);
  if (result.portDirectionErrors.length > 0) errors.push(`SVG edge port direction is invalid: ${result.portDirectionErrors.join(", ")}`);
  if (result.portApproachErrors.length > 0) errors.push(`SVG edge approaches a target from inside its visible shape: ${result.portApproachErrors.join(", ")}`);
  if (result.sideSwitchErrors.length > 0) errors.push(`SVG edge switches sides without an expected exception: ${result.sideSwitchErrors.join(", ")}`);
  if (result.arrowVisibilityErrors.length > 0) errors.push(`SVG arrow overlay is not visible: ${result.arrowVisibilityErrors.join(", ")}`);
  if (result.arrowOcclusionPairs.length > 0) errors.push(`SVG arrow overlay is occluded: ${result.arrowOcclusionPairs.join(", ")}`);
  if (result.arrowDecorationOcclusionPairs.length > 0) errors.push(`SVG arrow overlay is occluded by a later decoration: ${result.arrowDecorationOcclusionPairs.join(", ")}`);
  if (result.labelEdgeCollisionPairs.length > 0) errors.push(`SVG label geometry intersects edge geometry: ${result.labelEdgeCollisionPairs.join(", ")}`);
  if (result.labelPlacementErrors.length > 0) errors.push(`SVG edge labels are not centered and normally offset from their route segment: ${result.labelPlacementErrors.join(", ")}`);
  if (result.visualStyleErrors.length > 0) errors.push(`SVG unified visual style is invalid: ${result.visualStyleErrors.join(", ")}`);
  if (result.labelNodeCollisionPairs.length > 0) errors.push(`SVG label geometry intersects node geometry: ${result.labelNodeCollisionPairs.join(", ")}`);
  if (result.labelLabelCollisionPairs.length > 0) errors.push(`SVG labels overlap: ${result.labelLabelCollisionPairs.join(", ")}`);
  if (result.labelArrowCollisionPairs.length > 0) errors.push(`SVG labels intersect arrow overlays: ${result.labelArrowCollisionPairs.join(", ")}`);
  if (result.textOverflowIds.length > 0) errors.push(`SVG text/tspan geometry exceeds the visible SVG bounds: ${result.textOverflowIds.join(", ")}`);
  if (result.textOverlapPairs.length > 0) errors.push(`SVG text/tspan geometry overlaps: ${result.textOverlapPairs.join(", ")}`);
  if (result.groupTitleErrors.length > 0) errors.push(`SVG group titles are missing, mismatched, outside their group, or overlap content: ${result.groupTitleErrors.join(", ")}`);
  if (result.groupCapacityErrors.length > 0) errors.push(`SVG group capacity is insufficient for members, internal routes, or labels: ${result.groupCapacityErrors.join(", ")}`);
  if (result.horizontalOverflow) errors.push("SVG has horizontal overflow beyond the viewport");
  if (result.outsideViewportCount > 0) errors.push(`SVG contains ${result.outsideViewportCount} tracked element(s) outside the horizontal viewport`);
  if (result.unsafeCount > 0) errors.push(`SVG contains ${result.unsafeCount} unsafe embedded element(s)`);
  if (readingView === "normal" && (Math.abs(result.scroll.x) > 1 || Math.abs(result.scroll.y) > 1)) errors.push(`NORMAL_SCROLL_ORIGIN: normal view started at scroll=(${result.scroll.x},${result.scroll.y}), expected (0,0)`);
  if (readingView === "fit" && !result.contentFullyVisible) errors.push("FIT_INCOMPLETE: fit view does not fully contain the rendered diagram content");
  if (!expected) return errors;
  for (const trace of readingPathTrace(result, expected)) {
    if (!trace.nodes_found || !trace.edges_found || !trace.labels_found) errors.push(`READING_PATH_TRACE: ${trace.id} is incomplete (nodes=${trace.missing_nodes.join(",") || "ok"}; edges=${trace.missing_edges.join(",") || "ok"}; labels=${trace.missing_labels.join(",") || "ok"})`);
  }
  if (readingView === "zoom") {
    const uncovered = expected.routeContract.affectedEdgeIds.filter((edgeId) => {
      const box = result.edgeBBoxes[edgeId];
      return !box || box.left < -1 || box.top < -1 || box.right > result.viewport.width + 1 || box.bottom > result.viewport.height + 1;
    });
    if (uncovered.length > 0) errors.push(`ZOOM_COVERAGE: zoom view does not cover affected edges: ${uncovered.join(", ")}`);
  }

  if (!equalIds(result.nodeIds, expected.nodeIds)) errors.push("browser node mapping does not match independent expected contract");
  if (!equalIds(result.edgeIds, expected.edgeIds)) errors.push("browser edge mapping does not match independent expected contract");
  if (!equalIds(result.groupIds, expected.groupIds)) errors.push("browser group mapping does not match independent expected contract");
  if (!equalIds(result.legendIds, expected.legendIds)) errors.push("browser legend coverage does not match independent expected contract");
  if (!equalIds(result.noteIds, expected.annotationIds)) errors.push("browser annotation mapping does not match independent expected contract");
  const mainFlow = expected.routeContract.mainFlow;
  if (mainFlow && (!equalIds(result.nodeIds, mainFlow.nodeIds) || !equalIds(result.edgeIds, mainFlow.edgeIds))) errors.push("browser main-flow mapping does not cover the expected process");
  const expectedLoopEdges = expected.routeContract.loopLanes.flatMap((lane) => lane.edgeIds);
  if (expectedLoopEdges.some((edgeId) => !result.edgeIds.includes(edgeId))) errors.push("browser loop-lane edge mapping is incomplete");
  for (const decisionId of expected.decisionNodeIds) {
    if (result.nodeShapes[decisionId] !== "diamond") errors.push(`browser decision node ${decisionId} is not visibly diamond`);
    const exits = Object.values(result.edgeRecords).filter((edge) => edge.from === decisionId);
    if (exits.length < 2) errors.push(`browser decision node ${decisionId} has no explicit exits`);
  }
  for (const [edgeId, endpoints] of Object.entries(expected.edgeEndpoints)) {
    const actual = result.edgeRecords[edgeId];
    if (!actual || actual.from !== endpoints.from || actual.to !== endpoints.to) errors.push(`browser edge mapping does not match expected contract for ${edgeId}`);
    const ports = expected.edgePorts[edgeId];
    if (actual && ports && ((ports.fromPort && actual.fromPort !== ports.fromPort) || (ports.toPort && actual.toPort !== ports.toPort))) errors.push(`browser edge ports do not match expected contract for ${edgeId}`);
    const expectedArrowTarget = expected.edgeArrowTargets[edgeId] || expected.routeContract.edgeIntents.find((intent) => intent.edgeId === edgeId)?.arrowTarget;
    if (expectedArrowTarget && (!actual || actual.arrowTarget !== expectedArrowTarget)) errors.push(`browser edge arrowTarget does not match expected contract for ${edgeId}`);
  }
  if (!result.legendBeforeNotes) errors.push("browser legend and annotations are in the wrong order");
  const branchLayerExceptionEdgeIds = new Set(expected.routeContract.exceptions.filter((entry) => entry.type === "branch-layer").flatMap((entry) => entry.edgeIds));
  for (const branch of expected.routeContract.branchGroups) {
    const values = branch.targetIds.map((targetId) => {
      const center = result.nodeCenters[targetId];
      return center ? (branch.direction === "TB" ? center.y : center.x) : NaN;
    });
    const hasBranchLayerException = (branch.edgeIds || []).some((edgeId) => branchLayerExceptionEdgeIds.has(edgeId));
    if (values.some((value) => !Number.isFinite(value)) || (!hasBranchLayerException && Math.max(...values) - Math.min(...values) > Math.max(1, branch.tolerance))) errors.push("browser expected branch targets are not on the same business layer");
  }
  if (expected.directedEdgeCount > 0 && result.arrowTargets.length < expected.directedEdgeCount) errors.push("browser arrow target mapping is incomplete");
  for (const intent of expected.routeContract.edgeIntents) {
    const bends = result.edgeBendCounts[intent.edgeId];
    if (!Number.isFinite(bends)) {
      errors.push(`browser route geometry is missing for ${intent.edgeId}`);
      continue;
    }
    if (intent.bendCount !== undefined && bends !== intent.bendCount) errors.push(`browser route ${intent.edgeId} bend count is ${bends}, expected ${intent.bendCount}`);
    if (intent.minBendCount !== undefined && bends < intent.minBendCount) errors.push(`browser route ${intent.edgeId} bend count is below ${intent.minBendCount}`);
    if (intent.maxBendCount !== undefined && bends > intent.maxBendCount) errors.push(`browser route ${intent.edgeId} bend count exceeds ${intent.maxBendCount}`);
    if (intent.kind === "direct" && bends !== 0) errors.push(`browser route ${intent.edgeId} must be direct`);
    if (intent.kind === "manhattan" && result.edgeGeometryKinds[intent.edgeId] !== "manhattan") errors.push(`browser route ${intent.edgeId} must be Manhattan geometry`);
    if (intent.topology?.orthogonal && result.edgeGeometryKinds[intent.edgeId] === "custom") errors.push(`browser route ${intent.edgeId} points are not Manhattan orthogonal`);
    if (intent.topology?.segmentCount !== undefined && result.edgeBendCounts[intent.edgeId] + 1 !== intent.topology.segmentCount) errors.push(`browser route ${intent.edgeId} points topology segment count differs from expected`);
    if (intent.labelRequired && !result.edgeLabelIds.includes(intent.edgeId)) errors.push(`browser route ${intent.edgeId} requires a visible label`);
    if (intent.labelText !== undefined && result.edgeLabels[intent.edgeId] !== intent.labelText) errors.push(`browser route ${intent.edgeId} label text differs from expected`);
  }
  const expectedSideSwitches = expected.routeContract.exceptions.filter((entry) => entry.type === "side-switch").flatMap((entry) => entry.edgeIds);
  for (const edgeId of expectedSideSwitches) if (!result.sideSwitchDetectedEdgeIds.includes(edgeId)) errors.push(`browser expected side-switch exception is not observed: ${edgeId}`);
  const unexpectedEdgeCollisions = result.edgeNodeCollisionPairs.filter((pair) => {
    const separator = pair.indexOf(":");
    const edgeId = separator < 0 ? pair : pair.slice(0, separator);
    const nodeId = separator < 0 ? "" : pair.slice(separator + 1);
    const endpoints = expected.edgeEndpoints[edgeId];
    return !endpoints || (nodeId !== endpoints.from && nodeId !== endpoints.to);
  });
  if (unexpectedEdgeCollisions.length > 0) errors.push(`SVG edge geometry collides with non-endpoint nodes: ${unexpectedEdgeCollisions.join(", ")}`);
  const isNestedRelation = (first: string, second: string): boolean => {
    let current = expected.groupTypes[first];
    while (current?.semanticType === "nested" && current.parent) {
      if (current.parent === second) return true;
      current = expected.groupTypes[current.parent];
    }
    return false;
  };
  const unexpectedGroupOverlaps = result.groupOverlapPairs.filter((pair) => {
    const separator = pair.indexOf(":");
    const first = separator < 0 ? pair : pair.slice(0, separator);
    const second = separator < 0 ? "" : pair.slice(separator + 1);
    const firstType = expected.groupTypes[first]?.semanticType;
    const secondType = expected.groupTypes[second]?.semanticType;
    return firstType && secondType && firstType !== "overlay" && firstType !== "cross-cutting" && secondType !== "overlay" && secondType !== "cross-cutting" && !isNestedRelation(first, second) && !isNestedRelation(second, first);
  });
  if (unexpectedGroupOverlaps.length > 0) errors.push(`SVG groups overlap unexpectedly: ${unexpectedGroupOverlaps.join(", ")}`);
  if (expected.lifelineIds.length > 0 && !equalIds(result.lifelineIds, expected.lifelineIds)) errors.push("browser sequence lifeline mapping does not match independent expected contract");
  for (const lifelineId of expected.lifelineIds) {
    const actual = result.lifelineCoordinates[lifelineId];
    const actualNodeCenter = actualLayout.nodeCenters[lifelineId];
    if (!Number.isFinite(actual) || !Number.isFinite(actualNodeCenter) || Math.abs(actual - actualNodeCenter) > 1) errors.push(`browser sequence lifeline coordinate does not match actual node center for ${lifelineId}`);
  }
  const branchPortExceptions = expected.routeContract.exceptions.filter((entry) => entry.type === "branch-port");
  for (const exception of branchPortExceptions) {
    const direction = expected.routeContract.direction;
    const observed = exception.edgeIds.every((edgeId) => {
      const edge = result.edgeRecords[edgeId];
      if (!edge) return false;
      if (direction === "TB") return (edge.fromPort !== "right" && edge.fromPort !== "left") || edge.toPort !== "top";
      if (direction === "LR") return (edge.fromPort !== "top" && edge.fromPort !== "bottom") || edge.toPort !== "left";
      return Boolean(edge.fromPort && edge.toPort);
    });
    if (!observed) errors.push(`browser expected branch-port exception is not observed: ${exception.edgeIds.join(", ")}`);
  }
  const branchLayerExceptions = expected.routeContract.exceptions.filter((entry) => entry.type === "branch-layer");
  for (const exception of branchLayerExceptions) {
    const observed = exception.edgeIds.some((edgeId) => {
      const edge = result.edgeRecords[edgeId];
      const target = edge ? result.nodeCenters[edge.to] : undefined;
      const branch = expected.routeContract.branchGroups.find((candidate) => candidate.targetIds.includes(edge?.to || ""));
      if (!target || !branch) return false;
      const values = branch.targetIds.map((targetId) => result.nodeCenters[targetId] ? (branch.direction === "TB" ? result.nodeCenters[targetId].y : result.nodeCenters[targetId].x) : NaN);
      return values.every(Number.isFinite) && Math.max(...values) - Math.min(...values) > Math.max(1, branch.tolerance);
    });
    if (!observed) errors.push(`browser expected branch-layer exception is not observed: ${exception.edgeIds.join(", ")}`);
  }
  return errors;
}

function relativeArtifact(path: string): string {
  return relative(PROJECT_ROOT, path) || ".";
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function parseOptions(args: string[]): { request: string; evidence?: string; dryRun: boolean } {
  if (args[0] !== "run") fail("usage: aidlc-diagram-provider.ts run --request <path> [--evidence <path>] [--dry-run]");
  let request = "";
  let evidence: string | undefined;
  let dryRun = false;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--request") request = nonEmpty(args[++index], "--request");
    else if (arg === "--evidence") evidence = nonEmpty(args[++index], "--evidence");
    else if (arg === "--dry-run") dryRun = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (!request) fail("--request is required");
  return { request, evidence, dryRun };
}

function localPreviewUrl(source: string, temporaryRoot: string, index: number, diagramId: string): string {
  const content = readFileSync(source, "utf8");
  if (/<script\b|<foreignObject\b|\son[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["'](?:https?:|data:|\/\/)/i.test(content)) {
    fail(`local SVG contains unsafe content and cannot be embedded for browser validation: ${relativeArtifact(source)}`);
  }
  const svg = content.replace(/<\?xml[\s\S]*?\?>/gi, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "").trim();
  const wrapper = join(temporaryRoot, `${index}-${diagramId}.html`);
  writeFileSync(wrapper, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style></head><body>${svg}</body></html>`, { mode: 0o600 });
  return pathToFileURL(wrapper).toString();
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const request = parseRequest(options.request);
  const plan = request.diagrams.map((diagram, index) => ({
    id: diagram.id,
    url: sourceUrl(diagram, index),
    local_preview_fallback: diagram.source_path !== undefined,
    viewport: diagram.viewport,
    manifest_path: diagram.manifest_path,
    expected_contract_path: declaredExpectedPath(diagram),
    screenshot_path: relativeArtifact(artifactPath(diagram.screenshot_path, `.aidlc/evidence/${request.stage}/diagram-contract/${diagram.id}.png`, "screenshot_path")),
    snapshot_path: relativeArtifact(artifactPath(diagram.snapshot_path, `.aidlc/evidence/${request.stage}/diagram-contract/${diagram.id}.snapshot.txt`, "snapshot_path")),
  }));
  if (options.dryRun) {
    console.log(JSON.stringify({ status: "ready", provider: PROVIDER_PACKAGE, target_operation: request.target_operation, plan }, null, 2));
    return;
  }
  if (!request.target_reading_environment?.viewports) fail("browser validation requires normal, fit, and zoom reading viewports");

  const evidence = evidencePath(request.stage, options.evidence);
  if (!existsSync(evidence)) fail(`source diagram-contract evidence is missing: ${relativeArtifact(evidence)}`);
  const sourceEvidence = record(JSON.parse(readFileSync(evidence, "utf8")), "diagram-contract evidence");
  if (sourceEvidence.status !== "passed") fail("source diagram-contract evidence must already be passed before browser validation");

  const temporaryRoot = mkdtempSync(join(tmpdir(), "loeyae-diagram-provider-"));
  const results: Record<string, unknown>[] = [];
  try {
    for (const [index, diagram] of request.diagrams.entries()) {
      const expected = loadExpected(diagram);
      if (!expected) fail(`UNVERIFIED: browser validation requires an independent expected contract for ${diagram.id}`);
      const actualLayout = loadActualLayout(diagram);
      const url = diagram.source_path
        ? localPreviewUrl(projectPath(diagram.source_path, `diagrams[${index}].source_path`), temporaryRoot, index, diagram.id)
        : sourceUrl(diagram, index);
      const defaultViewport = diagram.viewport || request.target_reading_environment?.viewport || { width: 1280, height: 720 };
      const viewEntries: Array<[ReadingView, Viewport]> = request.target_reading_environment?.viewports
        ? (Object.entries(request.target_reading_environment.viewports) as Array<[ReadingView, Viewport]>)
        : [["normal", defaultViewport]];
      for (const [readingView, viewport] of viewEntries) {
      const pages = runChrome(["new_page", url, "--timeout", String(COMMAND_TIMEOUT_MS)]).payload;
      const pageId = selectPage(pages);
      runChrome(["select_page", String(pageId), "--bringToFront"]);
      runChrome(["resize_page", String(viewport.width), String(viewport.height)]);
      if (readingView !== "normal") {
        runChrome(["evaluate_script", `() => {
          const svg = document.querySelector('svg');
          if (!svg) return false;
          document.documentElement.style.width = '100vw';
          document.documentElement.style.height = '100vh';
          document.body.style.width = '100vw';
          document.body.style.height = '100vh';
          svg.style.width = '100vw';
          svg.style.height = '100vh';
          svg.style.maxWidth = 'none';
          svg.style.maxHeight = 'none';
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          return true;
        }`]);
      }
      const browserContract = {
        readingDirection: actualLayout.readingDirection || expected.routeContract.direction,
        mainAxis: actualLayout.mainAxis,
        groups: actualLayout.groups,
        loopEdges: expected.routeContract.loopLanes.flatMap((lane) => lane.edgeIds),
        loopLanes: expected.routeContract.loopLanes,
        primaryFlow: expected.routeContract.primaryFlow,
        branchLayoutPlan: expected.routeContract.branchLayoutPlan,
        geometryProfile: expected.routeContract.geometryProfile,
        sideSwitchExceptionEdgeIds: expected.routeContract.exceptions.filter((exception) => exception.type === "side-switch").flatMap((exception) => exception.edgeIds),
        resetScroll: true,
      };
      const inspectionScript = `() => ((${INSPECTION_SCRIPT})(${JSON.stringify(browserContract)}))`;
      const inspected = inspection(runChrome(["evaluate_script", inspectionScript]).payload);
      const errors = validateInspection(inspected, expected, actualLayout, readingView);
      if (actualLayout.readabilityEvidence && actualLayout.readabilityEvidence[readingView] !== `${relativeArtifact(resolve(dirname(evidence), "diagram-contract-provider.json"))}#views.${readingView}`) errors.push(`READABILITY_EVIDENCE: ${readingView} metadata does not point to this run's provider evidence view`);
      const viewSuffix = request.target_reading_environment?.viewports ? `-${readingView}` : "";
      const tempScreenshot = join(temporaryRoot, `${index}-${diagram.id}${viewSuffix}.png`);
      const tempSnapshot = join(temporaryRoot, `${index}-${diagram.id}${viewSuffix}.snapshot.txt`);
      runChrome(["take_snapshot", "--filePath", tempSnapshot]);
      runChrome(["take_screenshot", "--fullPage", "--filePath", tempScreenshot]);
      const consolePayload = runChrome(["list_console_messages", "--pageSize", "200"]).payload;
      const baseScreenshot = artifactPath(diagram.screenshot_path, `.aidlc/evidence/${request.stage}/diagram-contract/${diagram.id}.png`, "screenshot_path");
      const baseSnapshot = artifactPath(diagram.snapshot_path, `.aidlc/evidence/${request.stage}/diagram-contract/${diagram.id}.snapshot.txt`, "snapshot_path");
      const screenshot = request.target_reading_environment?.viewports ? baseScreenshot.replace(/\.png$/i, `-${readingView}.png`) : baseScreenshot;
      const snapshot = request.target_reading_environment?.viewports ? baseSnapshot.replace(/\.snapshot\.txt$/i, `-${readingView}.snapshot.txt`) : baseSnapshot;
      if (!existsSync(tempScreenshot) || !existsSync(tempSnapshot)) errors.push("Chrome DevTools did not produce the requested screenshot or snapshot");
      if (errors.length === 0) {
        mkdirSync(dirname(screenshot), { recursive: true });
        mkdirSync(dirname(snapshot), { recursive: true });
        copyFileSync(tempScreenshot, screenshot);
        copyFileSync(tempSnapshot, snapshot);
      }
      const exceptionEvidence = expected.routeContract.exceptions.map((exception) => ({
        type: exception.type,
        object: exception.object,
        edge_ids: exception.edgeIds,
        business_reason: exception.businessReason,
        geometric_reason: exception.geometricReason,
        scope: exception.scope,
        visual_evidence: {
          required: true,
          reading_view: readingView,
          screenshot_path: relativeArtifact(screenshot),
          snapshot_path: relativeArtifact(snapshot),
          observed: errors.length === 0,
        },
      }));
      results.push({
        diagram_id: diagram.id,
        source: diagram.source_path || diagram.url,
        expected_contract: relativeArtifact(projectPath(declaredExpectedPath(diagram)!, "expected_contract_path")),
        url,
        local_preview_fallback: diagram.source_path !== undefined,
        viewport,
        reading_view: readingView,
        status: errors.length === 0 ? "passed" : "failed",
        errors,
        inspection: inspected,
        reading_path_trace: readingPathTrace(inspected, expected),
        route_actual: { edge_bend_counts: inspected.edgeBendCounts, edge_geometry_kinds: inspected.edgeGeometryKinds },
        exception_evidence: exceptionEvidence,
        screenshot_path: relativeArtifact(screenshot),
        snapshot_path: relativeArtifact(snapshot),
        console: consolePayload,
      });
      if (errors.length > 0) fail(`browser validation failed for ${diagram.id} (${readingView}): ${errors.join("; ")}`);
      }
    }

    const readingEvidence = Object.fromEntries(results.map((result) => {
      const entry = result as Record<string, unknown>;
      return [String(entry.reading_view), {
        status: entry.status === "passed" ? "passed" : "failed",
        screenshot_path: entry.screenshot_path,
        snapshot_path: entry.snapshot_path,
        evidence: entry.status === "passed" ? "real Chrome DevTools screenshot and accessibility snapshot" : "browser validation failed",
      }];
    }));
    const updatedEvidence = {
      ...sourceEvidence,
      status: "passed",
      final_status: "PASS",
      provider_status: "passed",
      target_operation_required: true,
      browser_visual_status: "passed",
      gate_statuses: { structure: "STRUCTURE_PASS", route_contract: "ROUTE_CONTRACT_PASS", geometry: "GEOMETRY_PASS", visual: "VISUAL_PASS", overall: "OVERALL_PASS" },
      render_status: "passed",
      expected_contract_status: "passed",
      provider: { name: "chrome-devtools-mcp", package: PROVIDER_PACKAGE, operation: request.target_operation },
      provider_validation: { status: "passed", request: relativeArtifact(projectPath(options.request, "request")), views: readingEvidence, results },
      timestamp: new Date().toISOString(),
    };
    writeJsonAtomic(evidence, updatedEvidence);
    writeJsonAtomic(resolve(dirname(evidence), "diagram-contract-provider.json"), {
      evidence_version: "1",
      timestamp: updatedEvidence.timestamp,
      status: "passed",
      final_status: "PASS",
      provider: updatedEvidence.provider,
      request: relativeArtifact(projectPath(options.request, "request")),
      views: readingEvidence,
      results,
    });
    console.log(JSON.stringify({ status: "passed", final_status: "PASS", evidence: relativeArtifact(evidence), diagrams_checked: request.diagrams.length }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^(?:NEEDS_CAPABILITY|BROWSER_PROFILE_CONFLICT):/.test(message)) {
      const timestamp = new Date().toISOString();
      writeJsonAtomic(evidence, {
        ...sourceEvidence,
        status: "passed",
        final_status: "NEEDS_CAPABILITY",
        provider_status: "unavailable",
        target_operation_required: true,
        browser_visual_status: "unverified",
        gate_statuses: { structure: "STRUCTURE_PASS", route_contract: "ROUTE_CONTRACT_PASS", geometry: "GEOMETRY_PASS", visual: "UNVERIFIED", overall: "NEEDS_CAPABILITY" },
        provider_validation: { status: "unavailable", request: relativeArtifact(projectPath(options.request, "request")), reason: message, results },
        timestamp,
      });
      writeJsonAtomic(resolve(dirname(evidence), "diagram-contract-provider.json"), {
        evidence_version: "1",
        timestamp,
        status: "unavailable",
        final_status: "NEEDS_CAPABILITY",
        request: relativeArtifact(projectPath(options.request, "request")),
        reason: message,
        results,
      });
    } else {
      const timestamp = new Date().toISOString();
      writeJsonAtomic(evidence, {
        ...sourceEvidence,
        status: "passed",
        final_status: "FAIL",
        provider_status: "failed",
        target_operation_required: true,
        browser_visual_status: "failed",
        gate_statuses: { structure: "STRUCTURE_PASS", route_contract: "ROUTE_CONTRACT_PASS", geometry: "GEOMETRY_PASS", visual: "FAIL", overall: "FAIL" },
        provider_validation: { status: "failed", request: relativeArtifact(projectPath(options.request, "request")), reason: message, results },
        timestamp,
      });
      writeJsonAtomic(resolve(dirname(evidence), "diagram-contract-provider.json"), {
        evidence_version: "1",
        timestamp,
        status: "failed",
        final_status: "FAIL",
        request: relativeArtifact(projectPath(options.request, "request")),
        reason: message,
        results,
      });
    }
    throw error;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
