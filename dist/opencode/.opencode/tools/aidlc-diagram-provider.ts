#!/usr/bin/env node
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync, readFileSync } from "fs";
import { dispatchVisual, safeVisualPath, bindVisualInputs, sealVisualEvidence } from "./aidlc-visual-provider.js";
import { sha256FileDigest } from "./aidlc-project-provider.js";
import { dirname, extname, join, relative, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  ExpectedContract,
  expectedContractPath,
  parseExpectedContract,
} from "./diagram-contract.js";
import { DIAGRAM_LAYOUT_METRICS, DIAGRAM_VISUAL_STYLE } from "./diagram-visual-style.js";
import { loadWorkflowState } from "./aidlc-light-state";
import { isSplitLayout, loadWorkflowParts } from "./aidlc-workflow-layout";
import { evidenceRelativePath } from "./aidlc-execution-context";

const PROJECT_ROOT = process.cwd();
const PROVIDER_PACKAGE = "diagram.visual";
const MAX_VIEWPORT = { width: 3840, height: 2160 };
const MIN_VIEWPORT = { width: 320, height: 240 };
let activeEvidenceDirectory: string | undefined;

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
  provider: "diagram.visual";
  target_operation: TargetOperation;
  stage: string;
  browser?: string;
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
  structuralNodeIntersections: string[];
  structuralEdgeIntersections: string[];
  structuralLabelIntersections: string[];
  structuralArrowIntersections: string[];
  structuralFrameStyleErrors: string[];
  structuralNodeFillErrors: string[];
  structuralLayerOrderErrors: string[];
  structuralMaskErrors: string[];
  structuralMaskCoverageErrors: string[];
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
  const resolved = safeVisualPath(PROJECT_ROOT, value);
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

function activeStageState(stage: string): ReturnType<typeof loadWorkflowState> {
  if (!isSplitLayout(PROJECT_ROOT)) return loadWorkflowState(PROJECT_ROOT);
  const activeModule = process.env.AIDLC_ACTIVE_MODULE?.trim();
  const candidates = [...loadWorkflowParts(PROJECT_ROOT).parts.values()]
    .map((part) => part.state)
    .filter((state) => state.status === "running" && state.current_stage === stage && (!activeModule || state.current_module === activeModule));
  if (candidates.length > 1) fail(`several workflows are running stage ${stage}; set AIDLC_ACTIVE_MODULE to the module this provider run belongs to`);
  return candidates[0] || null;
}

function configureEvidenceDirectory(stage: string): string {
  const state = activeStageState(stage);
  if (!state || state.status !== "running" || state.current_stage !== stage) {
    fail(`diagram provider stage ${stage} is not the active running stage`);
  }
  const axis = state.current_unit ? "unit" : state.current_module ? "module" : "project";
  const canonicalEvidence = evidenceRelativePath(stage, "diagram-contract", axis, { module_id: state.current_module, unit_id: state.current_unit });
  activeEvidenceDirectory = dirname(resolve(PROJECT_ROOT, canonicalEvidence));
  return activeEvidenceDirectory;
}

function evidencePath(stage: string, explicit?: string): string {
  const directory = activeEvidenceDirectory || configureEvidenceDirectory(stage);
  const expected = resolve(directory, "diagram-contract.json");
  const path = explicit ? projectPath(explicit, "evidence") : expected;
  if (path !== expected) fail(`evidence must be the active stage instance path: ${relativeArtifact(expected)}`);
  return path;
}

function artifactPath(value: string | undefined, defaultPath: string, field: string): string {
  if (!activeEvidenceDirectory) fail("active evidence context is not configured");
  const path = projectPath(value || defaultPath, field);
  const rel = relative(activeEvidenceDirectory, path);
  if (rel === ".." || rel.startsWith(`..${requirePathSeparator()}`) || rel.startsWith("/")) fail(`${field} must stay inside the active stage instance evidence directory`);
  return path;
}

function defaultDiagramArtifact(diagramId: string, suffix: string): string {
  if (!activeEvidenceDirectory) fail("active evidence context is not configured");
  return resolve(activeEvidenceDirectory, "diagram-contract", `${diagramId}${suffix}`);
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
  if (!["chrome-devtools", "diagram.visual"].includes(String(value.provider))) fail('request.provider must be "diagram.visual" (legacy chrome-devtools accepted)');
  const targetOperation = nonEmpty(value.target_operation, "request.target_operation") as TargetOperation;
  if (!["preview", "render"].includes(targetOperation)) fail('request.target_operation must be "preview" or "render"; export is not supported by this provider (NEEDS_CAPABILITY)');
  const stage = nonEmpty(value.stage, "request.stage");
  const requestedBrowser = value.browser === undefined ? undefined : nonEmpty(value.browser, "request.browser");
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
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result.id)) fail("diagram id must be a portable identifier");
    if (item.source_path !== undefined && item.url !== undefined) fail(`diagrams[${index}] must provide only one of source_path or url`);
    if (item.source_path === undefined && item.url === undefined) fail(`diagrams[${index}] must provide source_path or url`);
    if (item.source_path !== undefined) result.source_path = nonEmpty(item.source_path, `diagrams[${index}].source_path`);
    if (item.url !== undefined) result.url = nonEmpty(item.url, `diagrams[${index}].url`);
    if (item.manifest_path !== undefined) result.manifest_path = nonEmpty(item.manifest_path, `diagrams[${index}].manifest_path`);
    if (item.expected_contract_path !== undefined) result.expected_contract_path = nonEmpty(item.expected_contract_path, `diagrams[${index}].expected_contract_path`);
    if (item.screenshot_path !== undefined) { result.screenshot_path = nonEmpty(item.screenshot_path, `diagrams[${index}].screenshot_path`); if (!result.screenshot_path.endsWith(".png")) fail("screenshot_path must end in .png"); }
    if (item.snapshot_path !== undefined) { result.snapshot_path = nonEmpty(item.snapshot_path, `diagrams[${index}].snapshot_path`); if (!result.snapshot_path.endsWith(".snapshot.txt")) fail("snapshot_path must end in .snapshot.txt"); }
    result.viewport = item.viewport === undefined ? defaultViewport : validateViewport(item.viewport, `diagrams[${index}].viewport`);
    sourceUrl(result, index);
    if (result.manifest_path) projectPath(result.manifest_path, `diagrams[${index}].manifest_path`);
    if (result.expected_contract_path) projectPath(result.expected_contract_path, `diagrams[${index}].expected_contract_path`);
    return result;
  });
  if (new Set(diagrams.map(d => d.id)).size !== diagrams.length) fail("duplicate diagram ids");
  return { version: "1", provider: "diagram.visual", target_operation: targetOperation, stage, ...(requestedBrowser ? { browser: requestedBrowser } : {}), target_reading_environment: { viewport: defaultViewport, ...(viewports ? { viewports } : {}) }, diagrams };
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

  const measurementFields: Record<string, string> = {"role": "nullableString", "title": "string", "description": "string", "viewBox": "nullableString", "svgWidth": "number", "svgHeight": "number", "nodeIds": "array", "edgeIds": "array", "arrowTargets": "array", "groupIds": "array", "legendIds": "array", "noteIds": "array", "legendBeforeNotes": "boolean", "nodeCenters": "object", "nodeShapes": "object", "edgeRecords": "object", "edgeBBoxes": "object", "edgeBendCounts": "object", "edgeGeometryKinds": "object", "edgeLabelIds": "array", "edgeLabels": "object", "labelNodeCollisionPairs": "array", "labelLabelCollisionPairs": "array", "labelArrowCollisionPairs": "array", "edgeIntersectionPairs": "array", "collinearOverlapPairs": "array", "portDirectionErrors": "array", "portApproachErrors": "array", "sideSwitchDetectedEdgeIds": "array", "sideSwitchErrors": "array", "arrowVisibilityErrors": "array", "arrowOcclusionPairs": "array", "arrowDecorationOcclusionPairs": "array", "structuralNodeIntersections": "array", "structuralEdgeIntersections": "array", "structuralLabelIntersections": "array", "structuralArrowIntersections": "array", "structuralFrameStyleErrors": "array", "structuralNodeFillErrors": "array", "structuralLayerOrderErrors": "array", "structuralMaskErrors": "array", "structuralMaskCoverageErrors": "array", "labelEdgeCollisionPairs": "array", "labelPlacementErrors": "array", "visualStyleErrors": "array", "textOverflowIds": "array", "textOverlapPairs": "array", "contentBBox": "nullableObject", "horizontalOverflow": "boolean", "lifelineIds": "array", "lifelineCoordinates": "object", "nodeCollisionPairs": "array", "edgeNodeCollisionPairs": "array", "entityGapErrors": "array", "axisGapErrors": "array", "axisAlignmentErrors": "array", "portGapErrors": "array", "obstacleGapErrors": "array", "labelObstacleGapErrors": "array", "laneGapErrors": "array", "scroll": "object", "viewport": "object", "contentFullyVisible": "boolean", "groupOverlapPairs": "array", "groupCapacityErrors": "array", "groupTitleErrors": "array", "unsafeCount": "number", "outsideViewportCount": "number"};
  for (const [field, type] of Object.entries(measurementFields)) {
    const v = data[field];
    const valid = type === "array" ? Array.isArray(v) && v.every(x => typeof x === "string")
      : type === "nullableString" ? v === null || typeof v === "string"
      : type === "nullableObject" ? v === null || !!v && typeof v === "object" && !Array.isArray(v)
      : type === "object" ? !!v && typeof v === "object" && !Array.isArray(v)
      : typeof v === type && (type !== "number" || Number.isFinite(v));
    if (!valid) fail(`VISUAL_MEASUREMENT_INCOMPLETE: ${field}`);
  }
  const finite = (v: unknown): boolean => typeof v === "number" ? Number.isFinite(v)
    : !v || typeof v !== "object" || Object.values(v).every(finite);
  if (!finite(data)) fail("VISUAL_MEASUREMENT_NONFINITE");
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
    structuralNodeIntersections: Array.isArray(data.structuralNodeIntersections) ? data.structuralNodeIntersections.map(String) : [],
    structuralEdgeIntersections: Array.isArray(data.structuralEdgeIntersections) ? data.structuralEdgeIntersections.map(String) : [],
    structuralLabelIntersections: Array.isArray(data.structuralLabelIntersections) ? data.structuralLabelIntersections.map(String) : [],
    structuralArrowIntersections: Array.isArray(data.structuralArrowIntersections) ? data.structuralArrowIntersections.map(String) : [],
    structuralFrameStyleErrors: Array.isArray(data.structuralFrameStyleErrors) ? data.structuralFrameStyleErrors.map(String) : [],
    structuralNodeFillErrors: Array.isArray(data.structuralNodeFillErrors) ? data.structuralNodeFillErrors.map(String) : [],
    structuralLayerOrderErrors: Array.isArray(data.structuralLayerOrderErrors) ? data.structuralLayerOrderErrors.map(String) : [],
    structuralMaskErrors: Array.isArray(data.structuralMaskErrors) ? data.structuralMaskErrors.map(String) : [],
    structuralMaskCoverageErrors: Array.isArray(data.structuralMaskCoverageErrors) ? data.structuralMaskCoverageErrors.map(String) : [],
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
  if (result.nodeCollisionPairs.length > 0) errors.push(`NODE_OVERLAP: SVG node geometry collides: ${result.nodeCollisionPairs.join(", ")}`);
  if (result.entityGapErrors.length > 0) errors.push(`INSUFFICIENT_GAP: SVG entity gap is below the shared profile: ${result.entityGapErrors.join(", ")}`);
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
  if (unexpectedCrossings.length > 0) errors.push(`EDGE_CROSSING: SVG edge geometry intersects outside expected exceptions: ${unexpectedCrossings.join(", ")}`);
  if (expected) {
    for (const exception of expected.routeContract.exceptions.filter((entry) => entry.type === "crossing")) {
      const pair = exception.edgeIds.slice().sort().join("\u0000");
      if (!actualCrossings.has(pair)) errors.push(`CROSSING_EXCEPTION: SVG expected crossing exception is not observed: ${exception.edgeIds.join("/")}`);
    }
  }
  if (result.collinearOverlapPairs.length > 0) errors.push(`COLLINEAR_OVERLAP: SVG edges have non-declared collinear overlap: ${result.collinearOverlapPairs.join(", ")}`);
  if (result.portDirectionErrors.length > 0) errors.push(`PORT_DIRECTION: SVG edge port direction is invalid: ${result.portDirectionErrors.join(", ")}`);
  if (result.portApproachErrors.length > 0) errors.push(`PORT_APPROACH: SVG edge approaches a target from inside its visible shape: ${result.portApproachErrors.join(", ")}`);
  if (result.sideSwitchErrors.length > 0) errors.push(`SIDE_SWITCH: SVG edge switches sides without an expected exception: ${result.sideSwitchErrors.join(", ")}`);
  if (result.arrowVisibilityErrors.length > 0) errors.push(`VISIBLE_ARROW_MAPPING: SVG arrow overlay is not visible: ${result.arrowVisibilityErrors.join(", ")}`);
  if (result.arrowOcclusionPairs.length > 0) errors.push(`VISIBLE_ARROW_MAPPING: SVG arrow overlay is occluded: ${result.arrowOcclusionPairs.join(", ")}`);
  if (result.arrowDecorationOcclusionPairs.length > 0) errors.push(`VISIBLE_ARROW_MAPPING: SVG arrow overlay is occluded by a later decoration: ${result.arrowDecorationOcclusionPairs.join(", ")}`);
  if (result.structuralFrameStyleErrors.length > 0) errors.push(`STRUCTURAL_FRAME_STYLE: SVG structural frame computed style is invalid: ${result.structuralFrameStyleErrors.join(", ")}`);
  if (result.structuralNodeFillErrors.length > 0) errors.push(`STRUCTURAL_NODE_FILL: SVG structural intersection node fill is not opaque white: ${result.structuralNodeFillErrors.join(", ")}`);
  if (result.structuralLayerOrderErrors.length > 0) errors.push(`STRUCTURAL_LAYER_ORDER: SVG structural frame is painted above a business foreground object: ${result.structuralLayerOrderErrors.join(", ")}`);
  if (result.structuralMaskErrors.length > 0) errors.push(`STRUCTURAL_MASK: SVG structural occlusion mask is invalid: ${result.structuralMaskErrors.join(", ")}`);
  if (result.structuralMaskCoverageErrors.length > 0) errors.push(`STRUCTURAL_MASK_COVERAGE: SVG structural occlusion mask does not cover an actual intersection: ${result.structuralMaskCoverageErrors.join(", ")}`);
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
  for (const edgeId of expectedSideSwitches) if (!result.sideSwitchDetectedEdgeIds.includes(edgeId)) errors.push(`SIDE_SWITCH_EXCEPTION: browser expected side-switch exception is not observed: ${edgeId}`);
  const unexpectedEdgeCollisions = result.edgeNodeCollisionPairs.filter((pair) => {
    const separator = pair.indexOf(":");
    const edgeId = separator < 0 ? pair : pair.slice(0, separator);
    const nodeId = separator < 0 ? "" : pair.slice(separator + 1);
    const endpoints = expected.edgeEndpoints[edgeId];
    return !endpoints || (nodeId !== endpoints.from && nodeId !== endpoints.to);
  });
  if (unexpectedEdgeCollisions.length > 0) errors.push(`EDGE_NODE_COLLISION: SVG edge geometry collides with non-endpoint nodes: ${unexpectedEdgeCollisions.join(", ")}`);
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
  return relative(PROJECT_ROOT, path).replace(/\\/g, "/") || ".";
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function parseOptions(args: string[]): { request: string; evidence?: string; dryRun: boolean; browser?: string; hostProvider?: string } {
  if (args[0] !== "run") fail("usage: aidlc-diagram-provider.ts run --request <path> [--evidence <path>] [--host-provider <authorized-instance>] [--browser <installed-executable>] [--dry-run]");
  let request = "";
  let evidence: string | undefined;
  let dryRun = false;
  let hostProvider: string | undefined;
  let browser: string | undefined;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--request") request = nonEmpty(args[++index], "--request");
    else if (arg === "--evidence") evidence = nonEmpty(args[++index], "--evidence");
    else if (arg === "--host-provider") hostProvider = nonEmpty(args[++index], "--host-provider");
    else if (arg === "--browser") browser = nonEmpty(args[++index], "--browser");
    else if (arg === "--dry-run") dryRun = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (!request) fail("--request is required");
  return { request, evidence, dryRun, browser, hostProvider };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const request = parseRequest(options.request);
  configureEvidenceDirectory(request.stage);

  const plan = request.diagrams.map((diagram, index) => ({
    id: diagram.id,
    url: sourceUrl(diagram, index),
    local_preview_fallback: diagram.source_path !== undefined,
    viewport: diagram.viewport,
    manifest_path: diagram.manifest_path,
    expected_contract_path: declaredExpectedPath(diagram),
    screenshot_path: relativeArtifact(artifactPath(diagram.screenshot_path, defaultDiagramArtifact(diagram.id, ".png"), "screenshot_path")),
    snapshot_path: relativeArtifact(artifactPath(diagram.snapshot_path, defaultDiagramArtifact(diagram.id, ".snapshot.txt"), "snapshot_path")),
  }));
  const outputs = plan.flatMap(p => [p.screenshot_path, p.snapshot_path]);
  if (new Set(outputs).size !== outputs.length) fail("duplicate diagram output paths");
  if (options.dryRun) {
    console.log(JSON.stringify({ status: "ready", provider: PROVIDER_PACKAGE, target_operation: request.target_operation, plan }, null, 2));
    return;
  }


  const evidence = evidencePath(request.stage, options.evidence);
  if (!existsSync(evidence)) fail(`source diagram-contract evidence is missing: ${relativeArtifact(evidence)}`);
  const sourceEvidence = record(JSON.parse(readFileSync(evidence, "utf8")), "diagram-contract evidence");
  if (sourceEvidence.status !== "passed" || sourceEvidence.source_format !== "svg"
    || !["STATIC_PASS", "PASS"].includes(String(sourceEvidence.final_status))
    || sourceEvidence.expected_contract_status !== "passed" || sourceEvidence.generation_status !== "passed") {
    fail("UNVERIFIED: source diagram-contract requires current SVG structure, expected contract and generator closure before browser validation");
  }

  const results: Record<string, unknown>[] = [];
  try {
    if (request.browser) fail("VISUAL_BROWSER_SELECTION_DENIED: select an installed browser with the trusted --browser option");
    if (!request.target_reading_environment?.viewports) fail("browser validation requires normal, fit, and zoom reading viewports");
    for (const [index, diagram] of request.diagrams.entries()) {
      if (!diagram.manifest_path) fail(`UNVERIFIED: semantic sidecar is required for ${diagram.id}`);
      const expected = loadExpected(diagram);
      if (!expected) fail(`UNVERIFIED: browser validation requires an independent expected contract for ${diagram.id}`);
      const actualLayout = loadActualLayout(diagram);
      if (!diagram.source_path || diagram.url) fail("NEEDS_CAPABILITY: visual host requires a local SVG source; remote URLs are not authorized");
      const url = sourceUrl(diagram, index);
      const viewEntries = Object.entries(request.target_reading_environment!.viewports!) as Array<[ReadingView, Viewport]>;
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
      const inputs = bindVisualInputs(PROJECT_ROOT, [options.request, diagram.source_path, declaredExpectedPath(diagram)!, ...(diagram.manifest_path ? [diagram.manifest_path] : [])]);
      const state = activeStageState(request.stage)!;
      const currentContext = () => {
        const active = activeStageState(request.stage);
        if (!active || active.status !== "running" || active.current_stage !== request.stage) fail("VISUAL_CONTEXT_STALE");
        return { project_id: active.workflow_id, stage: request.stage, scope: active.current_stage_instance || request.stage, module_id: active.current_module, unit_id: active.current_unit };
      };
      const candidate = dispatchVisual({ project: PROJECT_ROOT, instance: options.hostProvider, browser: options.browser,
        currentContext,
        context: { project_id: state.workflow_id, stage: request.stage, scope: state.current_stage_instance || request.stage, module_id: state.current_module, unit_id: state.current_unit },
        operation: request.target_operation, svg: readFileSync(projectPath(diagram.source_path, "source"), "utf8"),
        contract: browserContract, viewports: request.target_reading_environment!.viewports!, inputs });
      for (const [readingView, viewport] of viewEntries) {
      const view = candidate.views[readingView];
      const inspected = inspection(view.measurement);
      const errors = validateInspection(inspected, expected, actualLayout, readingView);
      if (actualLayout.readabilityEvidence && actualLayout.readabilityEvidence[readingView] !== `${relativeArtifact(resolve(dirname(evidence), "diagram-contract-provider.json"))}#views.${readingView}`) errors.push(`READABILITY_EVIDENCE: ${readingView} metadata does not point to this run's provider evidence view`);
      const baseScreenshot = artifactPath(diagram.screenshot_path, defaultDiagramArtifact(diagram.id, ".png"), "screenshot_path");
      const baseSnapshot = artifactPath(diagram.snapshot_path, defaultDiagramArtifact(diagram.id, ".snapshot.txt"), "snapshot_path");
      const screenshot = baseScreenshot.replace(/\.png$/i, `-${readingView}.png`);
      const snapshot = baseSnapshot.replace(/\.snapshot\.txt$/i, `-${readingView}.snapshot.txt`);
      mkdirSync(dirname(screenshot), { recursive: true });
      mkdirSync(dirname(snapshot), { recursive: true });
      writeFileSync(screenshot, view.png);
      writeFileSync(snapshot, view.snapshot);
      const consolePayload = view.console;
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
        acquisition: candidate.receipt,
        snapshot_digest: view.snapshot_digest,
        screenshot_digest: view.screenshot_digest,
        measurement_digest: sha256FileDigest(JSON.stringify(inspected)),
        viewport,
        reading_view: readingView,
        status: errors.length === 0 ? "passed" : "failed",
        errors,
        inspection: inspected,
        structural_required: Object.values(actualLayout.groups).some((group) => group.styleRole === "structural"),
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
    const structuralRequired = results.some((result) => result.structural_required === true);
    const structuralArray = (field: string): string[] => results.flatMap((result) => {
      const inspection = result.inspection;
      if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) return [];
      const value = (inspection as Record<string, unknown>)[field];
      return Array.isArray(value) ? value.map(String) : [];
    });
    const structuralStatus = structuralRequired ? "passed" : "not_applicable";
    const structuralEvidence = {
      structural_occlusion_status: structuralStatus,
      structural_node_intersections: structuralArray("structuralNodeIntersections"),
      structural_edge_intersections: structuralArray("structuralEdgeIntersections"),
      structural_label_intersections: structuralArray("structuralLabelIntersections"),
      structural_arrow_intersections: structuralArray("structuralArrowIntersections"),
      structural_frame_style_status: structuralStatus,
      structural_node_fill_status: structuralStatus,
      structural_layer_order_status: structuralStatus,
      structural_mask_status: structuralStatus,
      structural_mask_coverage_status: structuralStatus,
      structural_visual_evidence: {
        required: structuralRequired,
        screenshots: structuralRequired ? results.map((result) => String(result.screenshot_path)) : [],
        snapshots: structuralRequired ? results.map((result) => String(result.snapshot_path)) : [],
        pixel_verified: false,
      },
    };
    const updatedEvidence = sealVisualEvidence(PROJECT_ROOT, {
      ...sourceEvidence,
      ...structuralEvidence,
      status: "passed",
      final_status: "PASS",
      provider_status: "passed",
      target_operation_required: true,
      browser_visual_status: "passed",
      visual_status: "VISUAL_PASS",
      overall_status: "OVERALL_PASS",
      gate_statuses: { structure: "STRUCTURE_PASS", route_contract: "ROUTE_CONTRACT_PASS", geometry: "GEOMETRY_PASS", visual: "VISUAL_PASS", overall: "OVERALL_PASS" },
      render_status: "passed",
      expected_contract_status: "passed",
      provider: { name: "diagram.visual", package: PROVIDER_PACKAGE, operation: request.target_operation },
      provider_validation: { status: "passed", request: relativeArtifact(projectPath(options.request, "request")), views: readingEvidence, structural: structuralEvidence, results },
      timestamp: new Date().toISOString(),
    });
    writeJsonAtomic(evidence, updatedEvidence);
    writeJsonAtomic(resolve(dirname(evidence), "diagram-contract-provider.json"), {
      evidence_version: "1",
      timestamp: updatedEvidence.timestamp,
      status: "passed",
      final_status: "PASS",
      provider: updatedEvidence.provider,
      request: relativeArtifact(projectPath(options.request, "request")),
      views: readingEvidence,
      structural: structuralEvidence,
      results,
      decision_digest: updatedEvidence.visual_seal.digest,
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
        visual_status: "UNVERIFIED",
        overall_status: "NEEDS_CAPABILITY",
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
        visual_status: "FAIL",
        overall_status: "FAIL",
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
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
