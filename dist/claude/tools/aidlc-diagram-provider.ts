#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, extname, join, relative, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath, pathToFileURL } from "url";

const PROJECT_ROOT = process.cwd();
const PROVIDER_PACKAGE = "chrome-devtools-mcp@1.6.0";
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

interface ExpectedContract {
  nodeIds: string[];
  nodeCenters: Record<string, number>;
  nodeCenterPoints: Record<string, { x: number; y: number }>;
  edgeIds: string[];
  edgeEndpoints: Record<string, { from: string; to: string }>;
  groupIds: string[];
  groupTypes: Record<string, { semanticType: string; parent?: string }>;
  legendIds: string[];
  annotationIds: string[];
  readingDirection?: "TB" | "LR";
  mainAxis?: number;
  layerTolerance: number;
  symmetryGroups: Array<{ nodeIds: string[]; tolerance: number }>;
  branchGroups: Array<{ targetIds: string[]; direction: "TB" | "LR"; tolerance: number }>;
  mainFlowNodeIds: string[];
  mainFlowEdgeIds: string[];
  loopEdges: string[];
  crossingExceptionPairs: string[];
  sideSwitchExceptionEdgeIds: string[];
  decisionNodeIds: string[];
  lifelineIds: string[];
  directedEdgeCount: number;
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
  edgeRecords: Record<string, { from: string; to: string; fromPort: string; toPort: string }>;
  edgeBBoxes: Record<string, GeometryBox>;
  edgeIntersectionPairs: string[];
  collinearOverlapPairs: string[];
  portDirectionErrors: string[];
  portApproachErrors: string[];
  sideSwitchErrors: string[];
  arrowVisibilityErrors: string[];
  arrowOcclusionPairs: string[];
  arrowDecorationOcclusionPairs: string[];
  labelEdgeCollisionPairs: string[];
  textOverflowIds: string[];
  textOverlapPairs: string[];
  contentBBox: GeometryBox | null;
  horizontalOverflow: boolean;
  lifelineIds: string[];
  lifelineCoordinates: Record<string, number>;
  nodeCollisionPairs: string[];
  edgeNodeCollisionPairs: string[];
  groupOverlapPairs: string[];
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
    if (item.screenshot_path !== undefined) result.screenshot_path = nonEmpty(item.screenshot_path, `diagrams[${index}].screenshot_path`);
    if (item.snapshot_path !== undefined) result.snapshot_path = nonEmpty(item.snapshot_path, `diagrams[${index}].snapshot_path`);
    result.viewport = item.viewport === undefined ? defaultViewport : validateViewport(item.viewport, `diagrams[${index}].viewport`);
    sourceUrl(result, index);
    if (result.manifest_path) projectPath(result.manifest_path, `diagrams[${index}].manifest_path`);
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

function loadExpected(item: DiagramRequest): ExpectedContract | undefined {
  if (!item.manifest_path) return undefined;
  const manifestPath = projectPath(item.manifest_path, "manifest_path");
  if (!existsSync(manifestPath)) fail(`diagram manifest does not exist: ${relative(PROJECT_ROOT, manifestPath)}`);
  const manifest = record(JSON.parse(readFileSync(manifestPath, "utf8")), "diagram manifest");
  if (!Array.isArray(manifest.diagrams)) fail("diagram manifest diagrams must be an array");
  const matches = manifest.diagrams.filter((entry) => record(entry, "diagram").id === item.id);
  if (matches.length !== 1) fail(`diagram manifest must contain exactly one diagram with id ${item.id}`);
  const diagram = record(matches[0], `diagram ${item.id}`);
  const nodeRecords = Array.isArray(diagram.nodes) ? diagram.nodes.map((entry: unknown) => record(entry, "node")) : [];
  const nodes = nodeRecords.map((entry) => nonEmpty(entry.id, "node.id"));
  const nodeCenters = Object.fromEntries(nodeRecords.map((entry) => [String(entry.id), Number(entry.x) + Number(entry.width) / 2]));
  const nodeCenterPoints = Object.fromEntries(nodeRecords.map((entry) => [String(entry.id), { x: Number(entry.x) + Number(entry.width) / 2, y: Number(entry.y) + Number(entry.height) / 2 }]));
  const nodeById = new Map(nodeRecords.map((entry) => [String(entry.id), entry]));
  const edges = Array.isArray(diagram.edges) ? diagram.edges.map((entry: unknown) => record(entry, "edge")) : [];
  const groups = Array.isArray(diagram.groups) ? diagram.groups.map((entry: unknown) => record(entry, "group")) : [];
  const annotations = Array.isArray(diagram.annotations) ? diagram.annotations.map((entry: unknown) => record(entry, "annotation")) : [];
  const designNotes = diagram.designNotes && typeof diagram.designNotes === "object" && !Array.isArray(diagram.designNotes) ? diagram.designNotes as Record<string, unknown> : undefined;
  const layout = designNotes?.layout && typeof designNotes.layout === "object" ? designNotes.layout as Record<string, unknown> : undefined;
  const branchGroups = [...nodeById.entries()].filter(([, node]) => node.shape === "diamond").map(([nodeId]) => {
    const targets = edges.filter((edge) => edge.from === nodeId).map((edge) => String(edge.to));
    return targets.length >= 2 ? { targetIds: targets, direction: String(layout?.direction || "TB") as "TB" | "LR", tolerance: Number(layout?.layerTolerance || 24) } : undefined;
  }).filter((value): value is { targetIds: string[]; direction: "TB" | "LR"; tolerance: number } => value !== undefined);
  const mainFlow = layout?.mainFlow && typeof layout.mainFlow === "object" && !Array.isArray(layout.mainFlow) ? layout.mainFlow as Record<string, unknown> : undefined;
  const loopLanes = Array.isArray(layout?.loopLanes) ? layout.loopLanes.map((lane: Record<string, any>) => Array.isArray(lane.edgeIds) ? lane.edgeIds.map(String) : []).flat() : [];
  const crossingExceptionPairs = Array.isArray(layout?.crossingExceptions) ? layout.crossingExceptions.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const edgeIds = (entry as Record<string, unknown>).edgeIds;
    return Array.isArray(edgeIds) && edgeIds.length === 2 ? [[String(edgeIds[0]), String(edgeIds[1])].sort().join("\u0000")] : [];
  }) : [];
  const sideSwitchExceptionEdgeIds = Array.isArray(layout?.sideSwitchExceptions) ? layout.sideSwitchExceptions.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const edgeIds = (entry as Record<string, unknown>).edgeIds;
    return Array.isArray(edgeIds) ? edgeIds.map(String) : [];
  }) : [];
  const decisionNodeIds = [...nodeById.entries()].filter(([, node]) => node.shape === "diamond").map(([nodeId]) => nodeId);
  const legend = diagram.legend && typeof diagram.legend === "object" && !Array.isArray(diagram.legend) ? diagram.legend as Record<string, unknown> : undefined;
  const legendItems = legend && Array.isArray(legend.items) ? legend.items.map((entry: unknown) => record(entry, "legend item")) : [];
  return {
    nodeIds: nodes,
    nodeCenters,
    nodeCenterPoints,
    edgeIds: edges.map((edge) => nonEmpty(edge.id, "edge.id")),
    edgeEndpoints: Object.fromEntries(edges.map((edge) => [String(edge.id), { from: nonEmpty(edge.from, "edge.from"), to: nonEmpty(edge.to, "edge.to") }])),
    groupIds: groups.map((entry) => nonEmpty(entry.id, "group.id")),
    groupTypes: Object.fromEntries(groups.map((entry) => [String(entry.id), { semanticType: nonEmpty(entry.semanticType, "group.semanticType"), ...(entry.parent ? { parent: String(entry.parent) } : {}) }])),
    legendIds: legendItems.map((entry) => nonEmpty(entry.id, "legend item.id")),
    annotationIds: annotations.map((entry) => nonEmpty(entry.id, "annotation.id")),
    readingDirection: layout?.direction === "TB" || layout?.direction === "LR" ? layout.direction : undefined,
    mainAxis: typeof layout?.mainAxis === "number" && Number.isFinite(layout.mainAxis) ? layout.mainAxis : undefined,
    layerTolerance: Number(layout?.layerTolerance || 24),
    symmetryGroups: Array.isArray(layout?.symmetryGroups) ? layout.symmetryGroups.map((group: Record<string, any>) => ({ nodeIds: group.nodeIds.map(String), tolerance: Number(group.tolerance === undefined ? 1 : group.tolerance) })) : [],
    branchGroups,
    mainFlowNodeIds: Array.isArray(mainFlow?.nodeIds) ? mainFlow.nodeIds.map(String) : [],
    mainFlowEdgeIds: Array.isArray(mainFlow?.edgeIds) ? mainFlow.edgeIds.map(String) : [],
    loopEdges: loopLanes,
    crossingExceptionPairs,
    sideSwitchExceptionEdgeIds,
    decisionNodeIds,
    lifelineIds: diagram.diagramType === "sequence" ? nodes : [],
    directedEdgeCount: edges.filter((edge) => (edge.kind || "directed") !== "undirected").length,
  };
}

const INSPECTION_SCRIPT = `(contract = {}) => {
  try {
  const svg = document.querySelector('svg');
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
  const nodeEntries = [...nodeBoxes.entries()].filter((entry) => entry[0] && entry[1]);
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
  const edgeSamples = [];
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
  for (const edge of edgeElements) {
    const edgeId = edge.getAttribute('data-edge');
    if (!edgeId) continue;
    const geometry = edgeGeometry(edge);
    if (!geometry) continue;
    edgeSamples.push({ id: edgeId, element: edge, points: geometry.points });
    if (geometry.box) edgeBBoxes[edgeId] = geometry.box;
    edgeRecords[edgeId] = { from: edge.getAttribute('data-from') || '', to: edge.getAttribute('data-to') || '', fromPort: edge.getAttribute('data-from-port') || '', toPort: edge.getAttribute('data-to-port') || '' };
    if (!leavesPort(geometry.points, edgeRecords[edgeId].fromPort) || !entersPort(geometry.points, edgeRecords[edgeId].toPort)) portDirectionErrors.push(edgeId);
    const targetBox = nodeOutlineBoxes.get(edgeRecords[edgeId].to);
    const lastPoint = geometry.points[geometry.points.length - 1];
    let previousPoint = null;
    for (let pointIndex = geometry.points.length - 2; pointIndex >= 0; pointIndex--) if (!pointEqual(geometry.points[pointIndex], lastPoint)) { previousPoint = geometry.points[pointIndex]; break; }
    if (previousPoint && pointInside(previousPoint, targetBox)) portApproachErrors.push(edgeId);
    const hitNodes = new Set();
    for (const screen of geometry.points) for (const [nodeId, box] of nodeBoxes) if (box && screen[0] >= box.left && screen[0] <= box.right && screen[1] >= box.top && screen[1] <= box.bottom) hitNodes.add(nodeId);
    for (const nodeId of hitNodes) edgeNodeCollisionPairs.push(edgeId + ':' + nodeId);
  }
  for (let first = 0; first < edgeSamples.length; first++) for (let second = first + 1; second < edgeSamples.length; second++) {
    const firstEdge = edgeSamples[first];
    const secondEdge = edgeSamples[second];
    let hasIntersection = false;
    let hasOverlap = false;
    for (let firstPoint = 1; firstPoint < firstEdge.points.length; firstPoint++) for (let secondPoint = 1; secondPoint < secondEdge.points.length; secondPoint++) {
      const relation = segmentRelation(firstEdge.points[firstPoint - 1], firstEdge.points[firstPoint], secondEdge.points[secondPoint - 1], secondEdge.points[secondPoint]);
      if (relation === 'overlap') hasOverlap = true;
      else if (relation === 'cross') hasIntersection = true;
      else if (relation === 'touch') {
        const sharedEndpoint = [firstEdge.points[firstPoint - 1], firstEdge.points[firstPoint]].some((point) => [secondEdge.points[secondPoint - 1], secondEdge.points[secondPoint]].some((candidate) => pointEqual(point, candidate)));
        if (!sharedEndpoint) hasIntersection = true;
      }
    }
    if (hasOverlap) collinearOverlapPairs.push(firstEdge.id + ':' + secondEdge.id);
    if (hasIntersection) edgeIntersectionPairs.push(firstEdge.id + ':' + secondEdge.id);
  }
  const labelElements = [...document.querySelectorAll('[data-edge-label]')].filter((element) => !element.matches('path[data-edge]'));
  const labelBoxes = new Map(labelElements.map((element) => [element.getAttribute('data-edge-label') || '', { element, box: bounds(element) }]));
  const labelEdgeCollisionPairs = [];
  for (const edgeSample of edgeSamples) for (const [labelId, label] of labelBoxes) {
    if (!labelId || labelId === edgeSample.id || !label.box) continue;
    for (let pointIndex = 1; pointIndex < edgeSample.points.length; pointIndex++) {
      if (segmentIntersectsBox(edgeSample.points[pointIndex - 1], edgeSample.points[pointIndex], label.box)) {
        labelEdgeCollisionPairs.push(edgeSample.id + ':' + labelId);
        break;
      }
    }
  }
  const groupElements = [...document.querySelectorAll('[id^="group-"]')];
  const groupBoxes = new Map(groupElements.map((element) => [element.id.slice('group-'.length), bounds(element)]));
  const groupOverlapPairs = [];
  const groupEntries = [...groupBoxes.entries()].filter((entry) => entry[0] && entry[1]);
  for (let first = 0; first < groupEntries.length; first++) for (let second = first + 1; second < groupEntries.length; second++) {
    if (overlaps(groupEntries[first][1], groupEntries[second][1])) groupOverlapPairs.push(groupEntries[first][0] + ':' + groupEntries[second][0]);
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
  const sideSwitchErrors = [];
  const viewBoxValues = svg?.viewBox?.baseVal;
  const svgBoxForAxis = svg ? bounds(svg) : null;
  if ((contract.readingDirection === 'TB' || contract.readingDirection === 'LR') && Number.isFinite(Number(contract.mainAxis)) && viewBoxValues && svgBoxForAxis && viewBoxValues.width > 0 && viewBoxValues.height > 0) {
    const screenAxis = contract.readingDirection === 'TB'
      ? svgBoxForAxis.left + (Number(contract.mainAxis) - viewBoxValues.x) / viewBoxValues.width * svgBoxForAxis.width
      : svgBoxForAxis.top + (Number(contract.mainAxis) - viewBoxValues.y) / viewBoxValues.height * svgBoxForAxis.height;
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
      if (invalid && !allowed.has(edgeSample.id)) sideSwitchErrors.push(edgeSample.id);
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
    ...groupElements.map((element) => ['group:' + element.id.slice('group-'.length), element]),
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
  for (const entry of textEntries) if (entry.box && svgBounds && (entry.box.left < svgBounds.left - 1 || entry.box.right > svgBounds.right + 1 || entry.box.top < svgBounds.top - 1 || entry.box.bottom > svgBounds.bottom + 1)) textOverflowIds.push(entry.id);
  for (let first = 0; first < textEntries.length; first++) for (let second = first + 1; second < textEntries.length; second++) {
    const firstOwner = textEntries[first].owner;
    const secondOwner = textEntries[second].owner;
    if (firstOwner && secondOwner && firstOwner === secondOwner) continue;
    if (overlaps(textEntries[first].box, textEntries[second].box)) textOverlapPairs.push(textEntries[first].id + ':' + textEntries[second].id);
  }
  const tracked = [...document.querySelectorAll('[data-node], path[data-edge], [data-edge-arrow], [data-legend-item], [data-note], [data-lifeline-for], [id^="group-"]')];
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
    edgeIntersectionPairs,
    collinearOverlapPairs,
    portDirectionErrors,
    portApproachErrors,
    sideSwitchErrors,
    arrowVisibilityErrors,
    arrowOcclusionPairs,
    arrowDecorationOcclusionPairs,
    labelEdgeCollisionPairs,
    textOverflowIds,
    textOverlapPairs,
    contentBBox,
    horizontalOverflow,
    lifelineIds: ids('[data-lifeline-for]', 'data-lifeline-for'),
    lifelineCoordinates,
    nodeCollisionPairs,
    edgeNodeCollisionPairs,
    groupOverlapPairs,
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
      return [key, { from: String(edge.from || ""), to: String(edge.to || ""), fromPort: String(edge.fromPort || ""), toPort: String(edge.toPort || "") }];
    })) : {},
    edgeBBoxes: data.edgeBBoxes && typeof data.edgeBBoxes === "object" ? Object.fromEntries(Object.entries(data.edgeBBoxes).map(([key, value]) => {
      const box = record(value, `edge bbox ${key}`);
      return [key, { left: Number(box.left), top: Number(box.top), right: Number(box.right), bottom: Number(box.bottom) }];
    })) : {},
    edgeIntersectionPairs: Array.isArray(data.edgeIntersectionPairs) ? data.edgeIntersectionPairs.map(String) : [],
    collinearOverlapPairs: Array.isArray(data.collinearOverlapPairs) ? data.collinearOverlapPairs.map(String) : [],
    portDirectionErrors: Array.isArray(data.portDirectionErrors) ? data.portDirectionErrors.map(String) : [],
    portApproachErrors: Array.isArray(data.portApproachErrors) ? data.portApproachErrors.map(String) : [],
    sideSwitchErrors: Array.isArray(data.sideSwitchErrors) ? data.sideSwitchErrors.map(String) : [],
    arrowVisibilityErrors: Array.isArray(data.arrowVisibilityErrors) ? data.arrowVisibilityErrors.map(String) : [],
    arrowOcclusionPairs: Array.isArray(data.arrowOcclusionPairs) ? data.arrowOcclusionPairs.map(String) : [],
    arrowDecorationOcclusionPairs: Array.isArray(data.arrowDecorationOcclusionPairs) ? data.arrowDecorationOcclusionPairs.map(String) : [],
    labelEdgeCollisionPairs: Array.isArray(data.labelEdgeCollisionPairs) ? data.labelEdgeCollisionPairs.map(String) : [],
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
    groupOverlapPairs: Array.isArray(data.groupOverlapPairs) ? data.groupOverlapPairs.map(String) : [],
    unsafeCount: Number(data.unsafeCount || 0),
    outsideViewportCount: Number(data.outsideViewportCount || 0),
  };
}

function equalIds(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((id) => actual.includes(id));
}

function validateInspection(result: InspectionResult, expected?: ExpectedContract): string[] {
  const errors: string[] = [];
  if (result.role !== "img") errors.push('SVG role must be "img"');
  if (!result.title) errors.push("SVG title is empty or missing");
  if (!result.description) errors.push("SVG desc is empty or missing");
  if (!result.viewBox) errors.push("SVG viewBox is missing");
  if (result.svgWidth <= 0 || result.svgHeight <= 0) errors.push("SVG has no visible browser bounds");
  if (result.nodeCollisionPairs.length > 0) errors.push(`SVG node geometry collides: ${result.nodeCollisionPairs.join(", ")}`);
  const edgePairKey = (pair: string): string => pair.split(":").sort().join("\u0000");
  const declaredCrossings = new Set(expected?.crossingExceptionPairs || []);
  const actualCrossings = new Set(result.edgeIntersectionPairs.map(edgePairKey));
  const unexpectedCrossings = result.edgeIntersectionPairs.filter((pair) => !declaredCrossings.has(edgePairKey(pair)));
  if (unexpectedCrossings.length > 0) errors.push(`SVG edge geometry intersects: ${unexpectedCrossings.join(", ")}`);
  if (expected) {
    const missingDeclaredCrossings = [...declaredCrossings].filter((pair) => !actualCrossings.has(pair));
    if (missingDeclaredCrossings.length > 0) errors.push(`SVG declared crossing exception is not present: ${missingDeclaredCrossings.map((pair) => pair.replace("\u0000", ":")).join(", ")}`);
  }
  if (result.collinearOverlapPairs.length > 0) errors.push(`SVG edges have non-declared collinear overlap: ${result.collinearOverlapPairs.join(", ")}`);
  if (result.portDirectionErrors.length > 0) errors.push(`SVG edge port direction is invalid: ${result.portDirectionErrors.join(", ")}`);
  if (result.portApproachErrors.length > 0) errors.push(`SVG edge approaches a target from inside its visible shape: ${result.portApproachErrors.join(", ")}`);
  if (result.sideSwitchErrors.length > 0) errors.push(`SVG edge switches sides without a declared exception: ${result.sideSwitchErrors.join(", ")}`);
  if (result.arrowVisibilityErrors.length > 0) errors.push(`SVG arrow overlay is not visible: ${result.arrowVisibilityErrors.join(", ")}`);
  if (result.arrowOcclusionPairs.length > 0) errors.push(`SVG arrow overlay is occluded: ${result.arrowOcclusionPairs.join(", ")}`);
  if (result.arrowDecorationOcclusionPairs.length > 0) errors.push(`SVG arrow overlay is occluded by a later decoration: ${result.arrowDecorationOcclusionPairs.join(", ")}`);
  if (result.labelEdgeCollisionPairs.length > 0) errors.push(`SVG label geometry intersects unrelated edge geometry: ${result.labelEdgeCollisionPairs.join(", ")}`);
  if (result.textOverflowIds.length > 0) errors.push(`SVG text/tspan geometry exceeds the visible SVG bounds: ${result.textOverflowIds.join(", ")}`);
  if (result.textOverlapPairs.length > 0) errors.push(`SVG text/tspan geometry overlaps: ${result.textOverlapPairs.join(", ")}`);
  if (result.horizontalOverflow) errors.push("SVG has horizontal overflow beyond the viewport");
  if (result.outsideViewportCount > 0) errors.push(`SVG contains ${result.outsideViewportCount} tracked element(s) outside the horizontal viewport`);
  if (result.unsafeCount > 0) errors.push(`SVG contains ${result.unsafeCount} unsafe embedded element(s)`);
  if (expected) {
    if (!equalIds(result.nodeIds, expected.nodeIds)) errors.push("browser node mapping does not match diagram manifest");
    if (!equalIds(result.edgeIds, expected.edgeIds)) errors.push("browser edge mapping does not match diagram manifest");
    if (!equalIds(result.groupIds, expected.groupIds)) errors.push("browser group mapping does not match diagram manifest");
    if (!equalIds(result.legendIds, expected.legendIds)) errors.push("browser legend coverage does not match diagram manifest");
    if (!equalIds(result.noteIds, expected.annotationIds)) errors.push("browser annotation mapping does not match diagram manifest");
    if (expected.mainFlowNodeIds.length > 0 && !equalIds(result.nodeIds, expected.mainFlowNodeIds)) errors.push("browser main-flow node mapping does not cover the declared process");
    if (expected.mainFlowEdgeIds.length > 0 && !equalIds(result.edgeIds, expected.mainFlowEdgeIds)) errors.push("browser main-flow edge mapping does not cover the declared process");
    if (expected.loopEdges.some((edgeId) => !result.edgeIds.includes(edgeId))) errors.push("browser loop-lane edge mapping is incomplete");
    for (const decisionId of expected.decisionNodeIds) {
      if (result.nodeShapes[decisionId] !== "diamond") errors.push(`browser decision node ${decisionId} is not visibly diamond`);
      const exits = Object.values(result.edgeRecords).filter((edge) => edge.from === decisionId);
      if (exits.length < 2) errors.push(`browser decision node ${decisionId} has no explicit exits`);
    }
    for (const [edgeId, endpoints] of Object.entries(expected.edgeEndpoints)) {
      const actual = result.edgeRecords[edgeId];
      if (!actual || actual.from !== endpoints.from || actual.to !== endpoints.to) errors.push(`browser edge mapping does not match diagram manifest for ${edgeId}`);
    }
    if (!result.legendBeforeNotes) errors.push("browser legend and annotations are in the wrong order");
    for (const branch of expected.branchGroups) {
      const values = branch.targetIds.map((targetId) => {
        const center = result.nodeCenters[targetId];
        return center ? (branch.direction === "TB" ? center.y : center.x) : NaN;
      });
      if (values.some((value) => !Number.isFinite(value)) || Math.max(...values) - Math.min(...values) > Math.max(1, branch.tolerance)) errors.push("browser branch targets are not on the same business layer");
    }
    if (expected.directedEdgeCount > 0 && result.arrowTargets.length < expected.directedEdgeCount) errors.push("browser arrow target mapping is incomplete");
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
    if (expected.lifelineIds.length > 0 && !equalIds(result.lifelineIds, expected.lifelineIds)) errors.push("browser sequence lifeline mapping does not match diagram manifest");
    for (const lifelineId of expected.lifelineIds) {
      const actual = result.lifelineCoordinates[lifelineId];
      const expectedCenter = expected.nodeCenters[lifelineId];
      if (!Number.isFinite(actual) || !Number.isFinite(expectedCenter) || Math.abs(actual - expectedCenter) > 1) errors.push(`browser sequence lifeline coordinate does not match node center for ${lifelineId}`);
    }
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
      const expected = loadExpected(diagram);
      const browserContract = expected ? {
        readingDirection: expected.readingDirection,
        mainAxis: expected.mainAxis,
        loopEdges: expected.loopEdges,
        sideSwitchExceptionEdgeIds: expected.sideSwitchExceptionEdgeIds,
      } : {};
      const inspectionScript = `() => ((${INSPECTION_SCRIPT})(${JSON.stringify(browserContract)}))`;
      const inspected = inspection(runChrome(["evaluate_script", inspectionScript]).payload);
      const errors = validateInspection(inspected, expected);
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
      results.push({
        diagram_id: diagram.id,
        source: diagram.source_path || diagram.url,
        url,
        local_preview_fallback: diagram.source_path !== undefined,
        viewport,
        reading_view: readingView,
        status: errors.length === 0 ? "passed" : "failed",
        errors,
        inspection: inspected,
        screenshot_path: relativeArtifact(screenshot),
        snapshot_path: relativeArtifact(snapshot),
        console: consolePayload,
      });
      if (errors.length > 0) fail(`browser validation failed for ${diagram.id} (${readingView}): ${errors.join("; ")}`);
      }
    }

    const updatedEvidence = {
      ...sourceEvidence,
      provider_status: "passed",
      target_operation_required: true,
      provider: { name: "chrome-devtools-mcp", version: "1.6.0", operation: request.target_operation },
      provider_validation: { status: "passed", request: relativeArtifact(projectPath(options.request, "request")), results },
      timestamp: new Date().toISOString(),
    };
    writeJsonAtomic(evidence, updatedEvidence);
    writeJsonAtomic(resolve(dirname(evidence), "diagram-contract-provider.json"), {
      evidence_version: "1",
      timestamp: updatedEvidence.timestamp,
      status: "passed",
      provider: updatedEvidence.provider,
      request: relativeArtifact(projectPath(options.request, "request")),
      results,
    });
    console.log(JSON.stringify({ status: "passed", evidence: relativeArtifact(evidence), diagrams_checked: request.diagrams.length }, null, 2));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
