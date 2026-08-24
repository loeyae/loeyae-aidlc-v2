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
  target_reading_environment?: { viewport?: Viewport };
  diagrams: DiagramRequest[];
}

interface ExpectedContract {
  nodeIds: string[];
  edgeIds: string[];
  groupIds: string[];
  lifelineIds: string[];
  directedEdgeCount: number;
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
  lifelineIds: string[];
  legendCount: number;
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
  return { version: "1", provider: "chrome-devtools", target_operation: targetOperation, stage, target_reading_environment: { viewport: defaultViewport }, diagrams };
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

function runChrome(args: string[]): CliResult {
  const result = spawnSync("npx", ["-y", "--package", PROVIDER_PACKAGE, "chrome-devtools", ...args, "--output-format=json"], {
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
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `exit code ${result.status}`;
    const stderr = typeof result.stderr === "string" ? result.stderr.trim().slice(-1000) : "";
    fail(`NEEDS_CAPABILITY: Chrome DevTools Provider unavailable while running ${args.join(" ")}: ${detail}${stderr ? `; ${stderr}` : ""}`);
  }
  const stdout = typeof result.stdout === "string" ? result.stdout : String(result.stdout || "");
  return { payload: parseJsonOutput(stdout), stdout };
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
  const nodes = Array.isArray(diagram.nodes) ? diagram.nodes.map((entry) => nonEmpty(record(entry, "node").id, "node.id")) : [];
  const edges = Array.isArray(diagram.edges) ? diagram.edges.map((entry) => record(entry, "edge")) : [];
  const groups = Array.isArray(diagram.groups) ? diagram.groups.map((entry) => nonEmpty(record(entry, "group").id, "group.id")) : [];
  return {
    nodeIds: nodes,
    edgeIds: edges.map((edge) => nonEmpty(edge.id, "edge.id")),
    groupIds: groups,
    lifelineIds: diagram.diagramType === "sequence" ? nodes : [],
    directedEdgeCount: edges.filter((edge) => (edge.kind || "directed") !== "undirected").length,
  };
}

const INSPECTION_SCRIPT = `() => {
  const svg = document.querySelector('svg');
  const ids = (selector, attribute) => [...document.querySelectorAll(selector)].map((element) => element.getAttribute(attribute)).filter(Boolean);
  const bounds = (element) => {
    try {
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    } catch (_) { return null; }
  };
  const svgBounds = svg ? bounds(svg) : null;
  const tracked = [...document.querySelectorAll('[data-node], [data-edge], [data-edge-arrow], [data-legend-item], [data-lifeline-for]')];
  const outsideViewportCount = svgBounds ? tracked.filter((element) => {
    const box = bounds(element);
    return box && (box.left < svgBounds.left - 1 || box.top < svgBounds.top - 1 || box.right > svgBounds.right + 1 || box.bottom > svgBounds.bottom + 1);
  }).length : 0;
  return {
    role: svg?.getAttribute('role') ?? null,
    title: svg?.querySelector(':scope > title')?.textContent?.trim() ?? '',
    description: svg?.querySelector(':scope > desc')?.textContent?.trim() ?? '',
    viewBox: svg?.getAttribute('viewBox') ?? null,
    svgWidth: svgBounds?.width ?? 0,
    svgHeight: svgBounds?.height ?? 0,
    nodeIds: ids('[data-node]', 'data-node'),
    edgeIds: ids('[data-edge]', 'data-edge'),
    arrowTargets: ids('[data-arrow-target]', 'data-arrow-target'),
    lifelineIds: ids('[data-lifeline-for]', 'data-lifeline-for'),
    legendCount: document.querySelectorAll('[data-legend-item]').length,
    unsafeCount: document.querySelectorAll('script, foreignObject, iframe, object, embed').length,
    outsideViewportCount,
  };
}`;

function inspection(payload: unknown): InspectionResult {
  const value = record(payload, "evaluate_script response");
  const result = value.result && typeof value.result === "object" ? value.result : value;
  const data = record(result, "inspection result");
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
    lifelineIds: Array.isArray(data.lifelineIds) ? data.lifelineIds.map(String) : [],
    legendCount: Number(data.legendCount || 0),
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
  if (result.unsafeCount > 0) errors.push(`SVG contains ${result.unsafeCount} unsafe embedded element(s)`);
  if (result.outsideViewportCount > 0) errors.push(`SVG contains ${result.outsideViewportCount} tracked element(s) outside the viewport`);
  if (expected) {
    if (!equalIds(result.nodeIds, expected.nodeIds)) errors.push("browser node mapping does not match diagram manifest");
    if (!equalIds(result.edgeIds, expected.edgeIds)) errors.push("browser edge mapping does not match diagram manifest");
    if (expected.directedEdgeCount > 0 && result.arrowTargets.length < expected.directedEdgeCount) errors.push("browser arrow target mapping is incomplete");
    if (expected.lifelineIds.length > 0 && !equalIds(result.lifelineIds, expected.lifelineIds)) errors.push("browser sequence lifeline mapping does not match diagram manifest");
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
      const viewport = diagram.viewport || request.target_reading_environment?.viewport || { width: 1280, height: 720 };
      const pages = runChrome(["new_page", url, "--timeout", String(COMMAND_TIMEOUT_MS)]).payload;
      const pageId = selectPage(pages);
      runChrome(["select_page", String(pageId), "--bringToFront"]);
      runChrome(["resize_page", String(viewport.width), String(viewport.height)]);
      const inspected = inspection(runChrome(["evaluate_script", INSPECTION_SCRIPT]).payload);
      const errors = validateInspection(inspected, loadExpected(diagram));
      const tempScreenshot = join(temporaryRoot, `${index}-${diagram.id}.png`);
      const tempSnapshot = join(temporaryRoot, `${index}-${diagram.id}.snapshot.txt`);
      runChrome(["take_snapshot", "--filePath", tempSnapshot]);
      runChrome(["take_screenshot", "--fullPage", "--filePath", tempScreenshot]);
      const consolePayload = runChrome(["list_console_messages", "--pageSize", "200"]).payload;
      const screenshot = artifactPath(diagram.screenshot_path, `.aidlc/evidence/${request.stage}/diagram-contract/${diagram.id}.png`, "screenshot_path");
      const snapshot = artifactPath(diagram.snapshot_path, `.aidlc/evidence/${request.stage}/diagram-contract/${diagram.id}.snapshot.txt`, "snapshot_path");
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
        status: errors.length === 0 ? "passed" : "failed",
        errors,
        inspection: inspected,
        screenshot_path: relativeArtifact(screenshot),
        snapshot_path: relativeArtifact(snapshot),
        console: consolePayload,
      });
      if (errors.length > 0) fail(`browser validation failed for ${diagram.id}: ${errors.join("; ")}`);
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
    console.log(JSON.stringify({ status: "passed", evidence: relativeArtifact(evidence), diagrams_checked: results.length }, null, 2));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
