#!/usr/bin/env node
/** Deterministic document and diagram export utilities. */

import { randomUUID } from "crypto";
import { spawnSync } from "child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import path, { basename, dirname, extname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { Resvg } from "@resvg/resvg-js";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
  convertInchesToTwip,
  convertMillimetersToTwip,
  type FileChild,
  type IParagraphOptions,
  type ParagraphChild,
} from "docx";
import JSZip from "jszip";
import MarkdownIt, { type MarkdownIt as MarkdownItType, type RendererRule, type Token } from "markdown-it";

const require = createRequire(import.meta.url);
const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;
const MAX_SVG_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_PIXELS = 100_000_000;
const DEFAULT_FONT = "Microsoft YaHei";
const CONTENT_WIDTH_TWIPS = convertInchesToTwip(6.77);
const CONTENT_HEIGHT_TWIPS = convertInchesToTwip(9.3);
const CONTENT_WIDTH_PX = Math.round((CONTENT_WIDTH_TWIPS / 1440) * 96);
const CONTENT_HEIGHT_PX = Math.round((CONTENT_HEIGHT_TWIPS / 1440) * 96);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const BROWSER_CANDIDATES = process.platform === "darwin"
  ? [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
  : process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
      ];

interface ExportOptions {
  sourceKind: "md" | "svg";
  input: string;
  target: "docx" | "pdf" | "png";
  output: string;
  force: boolean;
  stripKeywords: string[];
  template?: string;
  toc: boolean;
  pageSize: "A4" | "Letter";
  scale: number;
  width?: number;
  dpi: number;
  background: string;
  browser?: string;
  fontDirs: string[];
}

interface SvgRenderOptions {
  scale?: number;
  width?: number;
  dpi?: number;
  background?: string;
  fontDirs?: string[];
}

interface RenderedPng {
  data: Buffer;
  width: number;
  height: number;
}

interface RasterInfo {
  type: "png" | "jpg" | "gif" | "bmp";
  width: number;
  height: number;
}

interface HeadingEntry {
  level: number;
  title: string;
  id: string;
}

interface TemplateInfo {
  styles: string;
  pageWidth?: number;
  pageHeight?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
}

interface DocxRenderContext {
  quote?: boolean;
}

function usage(): string {
  return `
loeyae-aidlc export — document and diagram conversion

Usage:
  loeyae-aidlc export md <input.md> --to <docx|pdf> [options]
  loeyae-aidlc export svg <input.svg> --to png [options]

Common options:
  --output <path>       Output path (default: input basename + target extension)
  --force               Replace an existing regular output file
  --browser <path>      Chrome/Chromium/Edge executable for PDF or Mermaid

Markdown options:
  --strip <keyword>     Remove matching heading section; repeatable
  --template <docx>     Import Word styles and page settings (DOCX only)
  --toc                 Insert a generated table of contents
  --page-size <name>    A4 or Letter (default: A4; ignored when template sets size)

SVG options:
  --scale <number>      Raster scale from 0.1 to 10 (default: 1)
  --width <pixels>      Exact PNG width; mutually exclusive with --scale
  --dpi <number>        SVG physical-unit DPI from 72 to 600 (default: 96)
  --background <color>  CSS color or transparent (default: #ffffff)
  --font-dir <path>     Additional local font directory; repeatable

The exporter never downloads remote images or Mermaid code. Conversion failures
return a non-zero exit status and never silently substitute another format.
`;
}

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function finiteNumber(value: string, option: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${option} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function parseExportArgs(argv: string[]): ExportOptions | undefined {
  if (argv.length === 0 || ["help", "--help", "-h"].includes(argv[0])) return undefined;
  const sourceKind = argv[0];
  if (sourceKind !== "md" && sourceKind !== "svg") {
    throw new Error(`unknown export source "${sourceKind}"; expected md or svg`);
  }
  const inputArgument = argv[1];
  if (!inputArgument || inputArgument.startsWith("--")) throw new Error(`export ${sourceKind} requires an input file`);

  let target: string | undefined;
  let outputArgument: string | undefined;
  let force = false;
  const stripKeywords: string[] = [];
  let templateArgument: string | undefined;
  let toc = false;
  let pageSize: "A4" | "Letter" = "A4";
  let scale = 1;
  let width: number | undefined;
  let dpi = 96;
  let background = "#ffffff";
  let browserArgument: string | undefined;
  const fontDirs: string[] = [];
  const seen = new Set<string>();

  for (let index = 2; index < argv.length; index++) {
    const argument = argv[index];
    if (["--to", "--output", "--template", "--page-size", "--scale", "--width", "--dpi", "--background", "--browser"].includes(argument)) {
      if (seen.has(argument)) throw new Error(`duplicate option: ${argument}`);
      seen.add(argument);
      const value = optionValue(argv, index, argument);
      index++;
      if (argument === "--to") target = value.toLowerCase();
      else if (argument === "--output") outputArgument = value;
      else if (argument === "--template") templateArgument = value;
      else if (argument === "--page-size") {
        const normalized = value.toLowerCase();
        if (normalized !== "a4" && normalized !== "letter") throw new Error("--page-size must be A4 or Letter");
        pageSize = normalized === "a4" ? "A4" : "Letter";
      } else if (argument === "--scale") scale = finiteNumber(value, argument, 0.1, 10);
      else if (argument === "--width") width = Math.round(finiteNumber(value, argument, 1, 20_000));
      else if (argument === "--dpi") dpi = finiteNumber(value, argument, 72, 600);
      else if (argument === "--background") background = value;
      else if (argument === "--browser") browserArgument = value;
    } else if (argument === "--strip" || argument === "--font-dir") {
      const value = optionValue(argv, index, argument);
      index++;
      if (argument === "--strip") stripKeywords.push(value);
      else fontDirs.push(resolve(value));
    } else if (argument === "--force" || argument === "--toc") {
      if (seen.has(argument)) throw new Error(`duplicate option: ${argument}`);
      seen.add(argument);
      if (argument === "--force") force = true;
      else toc = true;
    } else {
      throw new Error(`unknown export option: ${argument}`);
    }
  }

  if (!target) throw new Error("--to is required");
  if (sourceKind === "md" && target !== "docx" && target !== "pdf") {
    throw new Error("Markdown export supports only --to docx or --to pdf");
  }
  if (sourceKind === "svg" && target !== "png") throw new Error("SVG export supports only --to png");
  if (sourceKind === "md" && (width !== undefined || scale !== 1 || dpi !== 96 || background !== "#ffffff" || fontDirs.length)) {
    throw new Error("--scale, --width, --dpi, --background, and --font-dir are SVG export options");
  }
  if (sourceKind === "svg" && (stripKeywords.length || templateArgument || toc || pageSize !== "A4")) {
    throw new Error("--strip, --template, --toc, and --page-size are Markdown export options");
  }
  if (width !== undefined && seen.has("--scale")) throw new Error("--width and --scale cannot be combined");
  if (templateArgument && target !== "docx") throw new Error("--template is valid only for DOCX export");

  const input = resolve(inputArgument);
  const expectedInputExtensions = sourceKind === "md" ? new Set([".md", ".markdown"]) : new Set([".svg"]);
  if (!expectedInputExtensions.has(extname(input).toLowerCase())) {
    throw new Error(`export ${sourceKind} input must use ${[...expectedInputExtensions].join(" or ")}`);
  }
  const output = resolve(outputArgument || `${input.slice(0, -extname(input).length)}.${target}`);
  if (extname(output).toLowerCase() !== `.${target}`) throw new Error(`output path must end with .${target}`);
  if (output === input) throw new Error("output path must differ from input path");

  return {
    sourceKind,
    input,
    target: target as ExportOptions["target"],
    output,
    force,
    stripKeywords,
    template: templateArgument ? resolve(templateArgument) : undefined,
    toc,
    pageSize,
    scale,
    width,
    dpi,
    background,
    browser: browserArgument,
    fontDirs,
  };
}

function assertRegularFile(filePath: string, label: string, maximumBytes: number): void {
  if (!existsSync(filePath)) throw new Error(`${label} does not exist: ${filePath}`);
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
  if (stat.size === 0) throw new Error(`${label} is empty: ${filePath}`);
  if (stat.size > maximumBytes) throw new Error(`${label} exceeds ${Math.round(maximumBytes / 1024 / 1024)} MB: ${filePath}`);
}

function prepareOutput(output: string, force: boolean): void {
  if (existsSync(output)) {
    const stat = lstatSync(output);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`output exists and is not a regular file: ${output}`);
    if (!force) throw new Error(`output already exists; use --force to replace it: ${output}`);
  }
  mkdirSync(dirname(output), { recursive: true });
}

function temporaryOutputPath(output: string): string {
  return join(dirname(output), `.${basename(output)}.${process.pid}.${randomUUID()}.tmp`);
}

function commitOutput(tempPath: string, output: string, force: boolean): void {
  if (!force && existsSync(output)) throw new Error(`output appeared during conversion; refusing to replace it without --force: ${output}`);
  if (force && existsSync(output)) rmSync(output);
  renameSync(tempPath, output);
}

function atomicWrite(output: string, data: Buffer, force: boolean): void {
  const tempPath = temporaryOutputPath(output);
  try {
    writeFileSync(tempPath, data, { flag: "wx", mode: 0o644 });
    commitOutput(tempPath, output, force);
  } finally {
    if (existsSync(tempPath)) rmSync(tempPath, { force: true });
  }
}

function commandOnPath(command: string): string | undefined {
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const directory of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = resolve(directory, `${command}${extension}`);
      if (existsSync(candidate) && lstatSync(candidate).isFile()) return candidate;
    }
  }
  return undefined;
}

export function findBrowser(configured?: string): string | undefined {
  const explicit = configured || process.env.AIDLC_CHROME_BIN || process.env.CHROME_BIN;
  if (explicit) {
    const resolved = existsSync(explicit) ? resolve(explicit) : commandOnPath(explicit);
    if (!resolved) throw new Error(`configured browser executable not found: ${explicit}`);
    return resolved;
  }
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "msedge"]) {
    const found = commandOnPath(name);
    if (found) return found;
  }
  return BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
}

function safeSvg(svg: string, label: string): string {
  if (!/<svg\b/i.test(svg)) throw new Error(`${label} does not contain an SVG root element`);
  if (/<script\b/i.test(svg)) throw new Error(`${label} contains a script element`);
  if (/<foreignObject\b/i.test(svg)) throw new Error(`${label} contains unsupported foreignObject content`);
  if (/@import\b/i.test(svg)) throw new Error(`${label} contains an external CSS import`);

  const references: string[] = [];
  for (const match of svg.matchAll(/(?:href|xlink:href)\s*=\s*["']([^"']+)["']/gi)) references.push(match[1].trim());
  for (const match of svg.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi)) references.push(match[1].trim());
  for (const reference of references) {
    if (!reference || reference.startsWith("#") || reference.startsWith("data:image/")) continue;
    throw new Error(`${label} contains an external resource reference: ${reference}`);
  }
  return svg;
}

function renderSvgPng(svg: string, options: SvgRenderOptions = {}): RenderedPng {
  const source = safeSvg(svg, "SVG input");
  const fitTo = options.width !== undefined
    ? { mode: "width" as const, value: options.width }
    : { mode: "zoom" as const, value: options.scale ?? 1 };
  let renderer: Resvg;
  try {
    renderer = new Resvg(source, {
      fitTo,
      dpi: options.dpi ?? 96,
      background: options.background === "transparent" ? undefined : options.background,
      font: {
        loadSystemFonts: true,
        fontDirs: options.fontDirs,
        defaultFontFamily: DEFAULT_FONT,
        sansSerifFamily: DEFAULT_FONT,
        monospaceFamily: "Consolas",
      },
      languages: ["zh-CN", "en"],
      shapeRendering: 2,
      textRendering: 1,
      imageRendering: 0,
      logLevel: "error",
    });
  } catch (error) {
    throw new Error(`SVG parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rendered = renderer.render();
  if (rendered.width <= 0 || rendered.height <= 0 || rendered.width * rendered.height > MAX_OUTPUT_PIXELS) {
    throw new Error(`SVG output dimensions are invalid or exceed ${MAX_OUTPUT_PIXELS} pixels: ${rendered.width}x${rendered.height}`);
  }
  const data = rendered.asPng();
  const info = rasterInfo(data);
  if (info.type !== "png" || info.width !== rendered.width || info.height !== rendered.height) {
    throw new Error("SVG renderer returned an invalid PNG payload");
  }
  return { data, width: rendered.width, height: rendered.height };
}

function rasterInfo(data: Buffer): RasterInfo {
  if (data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { type: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length >= 10 && ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))) {
    return { type: "gif", width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  if (data.length >= 26 && data.subarray(0, 2).toString("ascii") === "BM") {
    return { type: "bmp", width: Math.abs(data.readInt32LE(18)), height: Math.abs(data.readInt32LE(22)) };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset++;
        continue;
      }
      while (offset < data.length && data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > data.length) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) break;
      if (startOfFrame.has(marker) && length >= 7) {
        return { type: "jpg", height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) };
      }
      offset += length;
    }
  }
  throw new Error("unsupported or malformed image; supported raster formats are PNG, JPEG, GIF, and BMP");
}

function scaledDimensions(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new Error(`invalid image dimensions: ${width}x${height}`);
  const ratio = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

function resolveLocalAsset(raw: string, baseDirectory: string): string {
  const decoded = decodeURIComponent(raw.trim().replace(/^<|>$/g, "").split("#", 1)[0]);
  if (!decoded) throw new Error("empty local image path");
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith("//")) {
    throw new Error(`remote and data image resources are not allowed: ${raw}`);
  }
  const filePath = resolve(baseDirectory, decoded);
  assertRegularFile(filePath, "Markdown image", MAX_IMAGE_BYTES);
  return filePath;
}

function imageMimeType(extension: string): string {
  const normalized = extension.toLowerCase();
  if (normalized === ".png") return "image/png";
  if (normalized === ".jpg" || normalized === ".jpeg") return "image/jpeg";
  if (normalized === ".gif") return "image/gif";
  if (normalized === ".bmp") return "image/bmp";
  if (normalized === ".svg") return "image/svg+xml";
  throw new Error(`unsupported image extension: ${extension || "(none)"}`);
}

function imageDataUri(raw: string, baseDirectory: string): string {
  const filePath = resolveLocalAsset(raw, baseDirectory);
  const extension = extname(filePath).toLowerCase();
  const data = readFileSync(filePath);
  if (extension === ".svg") safeSvg(data.toString("utf8"), `Markdown image ${filePath}`);
  else rasterInfo(data);
  return `data:${imageMimeType(extension)};base64,${data.toString("base64")}`;
}

function stripHtmlCommentsOutsideFences(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let fence: { char: string; length: number } | undefined;
  let inComment = false;
  return lines.map((original) => {
    const fenceMatch = original.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { char: marker[0], length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length) fence = undefined;
      return original;
    }
    if (fence) return original;
    let line = original;
    let output = "";
    while (line.length) {
      if (inComment) {
        const end = line.indexOf("-->");
        if (end < 0) return output;
        line = line.slice(end + 3);
        inComment = false;
      } else {
        const start = line.indexOf("<!--");
        if (start < 0) return output + line;
        output += line.slice(0, start);
        line = line.slice(start + 4);
        inComment = true;
      }
    }
    return output;
  }).join("\n");
}

function stripSections(markdown: string, keywords: string[]): string {
  if (keywords.length === 0) return stripHtmlCommentsOutsideFences(markdown);
  const lines = stripHtmlCommentsOutsideFences(markdown).split("\n");
  let fence: { char: string; length: number } | undefined;
  let skipLevel: number | undefined;
  const kept: string[] = [];
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { char: marker[0], length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length) fence = undefined;
      if (skipLevel === undefined) kept.push(line);
      continue;
    }
    if (fence) {
      if (skipLevel === undefined) kept.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].replace(/[*_`>#]/g, "").trim();
      if (skipLevel !== undefined && level <= skipLevel) skipLevel = undefined;
      if (skipLevel === undefined && keywords.some((keyword) => title.includes(keyword))) {
        skipLevel = level;
        continue;
      }
    }
    if (skipLevel === undefined) kept.push(line);
  }
  return kept.join("\n");
}

function mermaidBundlePath(): string {
  const entry = require.resolve("mermaid");
  const bundle = resolve(dirname(entry), "mermaid.min.js");
  if (!existsSync(bundle)) throw new Error(`local Mermaid browser bundle is missing: ${bundle}`);
  return bundle;
}

function browserResultTail(value: string | Buffer | null | undefined): string {
  const text = typeof value === "string" ? value : value?.toString("utf8") || "";
  return text.trim().slice(-1200);
}

function renderMermaidSources(sources: string[], configuredBrowser?: string): string[] {
  if (sources.length === 0) return [];
  const browser = findBrowser(configuredBrowser);
  if (!browser) {
    throw new Error("Mermaid export requires Chrome, Chromium, or Edge; install a browser or pass --browser/AIDLC_CHROME_BIN");
  }
  const mermaidCode = readFileSync(mermaidBundlePath(), "utf8");
  const encodedSources = JSON.stringify(sources).replace(/</g, "\\u003c");
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>${mermaidCode}</script>
<script>
const sources = ${encodedSources};
function encode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}
(async () => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    htmlLabels: false,
    flowchart: { useMaxWidth: false, htmlLabels: false },
    sequence: { useMaxWidth: false },
    themeVariables: { fontFamily: "Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif", fontSize: "15px" }
  });
  for (let index = 0; index < sources.length; index++) {
    const output = document.createElement("pre");
    output.id = "aidlc-result-" + index;
    try {
      const rendered = await mermaid.render("aidlc-mermaid-" + index, sources[index]);
      output.dataset.status = "ok";
      output.textContent = encode(rendered.svg);
    } catch (error) {
      output.dataset.status = "error";
      output.textContent = encode(error && error.message ? error.message : String(error));
    }
    document.body.appendChild(output);
  }
  document.body.dataset.aidlcDone = "true";
})().catch((error) => {
  document.body.dataset.aidlcFatal = encode(error && error.message ? error.message : String(error));
});
</script></body></html>`;

  const tempRoot = mkdtempSync(join(tmpdir(), "loeyae-aidlc-mermaid-"));
  try {
    const htmlPath = join(tempRoot, "render.html");
    writeFileSync(htmlPath, html, "utf8");
    const result = spawnSync(browser, [
      "--headless=new",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      `--user-data-dir=${join(tempRoot, "profile")}`,
      "--virtual-time-budget=30000",
      "--dump-dom",
      pathToFileURL(htmlPath).href,
    ], { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    const dom = result.stdout || "";
    const rendered: string[] = [];
    for (let index = 0; index < sources.length; index++) {
      const match = dom.match(new RegExp(`<pre[^>]*id="aidlc-result-${index}"[^>]*data-status="(ok|error)"[^>]*>([^<]*)<\\/pre>`));
      if (!match) {
        const detail = browserResultTail(result.stderr) || (result.error ? result.error.message : `browser exit code ${result.status}`);
        throw new Error(`Mermaid renderer did not return diagram ${index + 1}: ${detail}`);
      }
      const value = Buffer.from(match[2].trim(), "base64").toString("utf8");
      if (match[1] !== "ok") throw new Error(`Mermaid diagram ${index + 1} failed: ${value}`);
      rendered.push(safeSvg(value, `Mermaid diagram ${index + 1}`));
    }
    return rendered;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function plainInlineText(token?: Token): string {
  if (!token) return "";
  if (token.children) {
    return token.children.map((child) => child.type === "image" ? child.content : child.content || "").join("").trim();
  }
  return token.content.trim();
}

function slugBase(value: string): string {
  const slug = value.normalize("NFKC").toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  return slug || "section";
}

function prepareHeadings(tokens: Token[]): HeadingEntry[] {
  const used = new Map<string, number>();
  const headings: HeadingEntry[] = [];
  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;
    const level = Number(token.tag.slice(1));
    const title = plainInlineText(tokens[index + 1]);
    const base = slugBase(title);
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    token.attrSet("id", id);
    headings.push({ level, title, id });
  }
  return headings;
}

function collectNestedTokens(tokens: Token[]): Token[] {
  const nested: Token[] = [];
  const visit = (token: Token): void => {
    nested.push(token);
    token.children?.forEach(visit);
  };
  tokens.forEach(visit);
  return nested;
}

function prepareMarkdown(markdown: string, baseDirectory: string, configuredBrowser?: string, inlineImages = false): { md: MarkdownItType; tokens: Token[]; headings: HeadingEntry[] } {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
  const tokens = md.parse(markdown, {});
  const allTokens = collectNestedTokens(tokens);
  const mermaidTokens = allTokens.filter((token) => token.type === "fence" && token.info.trim().split(/\s+/, 1)[0].toLowerCase() === "mermaid");
  const renderedMermaid = renderMermaidSources(mermaidTokens.map((token) => token.content.trim()), configuredBrowser);
  mermaidTokens.forEach((token, index) => {
    token.meta = { ...(token.meta || {}), aidlcMermaidSvg: renderedMermaid[index] };
  });
  if (inlineImages) {
    for (const token of allTokens) {
      if (token.type !== "image") continue;
      const sourceValue = token.attrGet("src");
      if (!sourceValue) throw new Error("Markdown image is missing a source path");
      token.attrSet("src", imageDataUri(String(sourceValue), baseDirectory));
    }
  }
  return { md, tokens, headings: prepareHeadings(tokens) };
}

function tocHtml(headings: HeadingEntry[]): string {
  const entries = headings.filter((heading) => heading.level > 1);
  if (entries.length === 0) return "";
  return `<nav class="toc"><div class="toc-title">目录</div><ul>${entries.map((entry) =>
    `<li class="toc-level-${entry.level}"><a href="#${entry.id}">${escapeHtml(entry.title)}</a></li>`).join("")}</ul></nav>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderMarkdownHtml(markdown: string, baseDirectory: string, options: Pick<ExportOptions, "toc" | "pageSize" | "browser">): string {
  const { md, tokens, headings } = prepareMarkdown(markdown, baseDirectory, options.browser, true);
  const defaultFence = md.renderer.rules.fence?.bind(md.renderer);
  const fenceRenderer: RendererRule = (renderTokens, index, rendererOptions, env, self) => {
    const token = renderTokens[index];
    if (token.info.trim().split(/\s+/, 1)[0].toLowerCase() === "mermaid") {
      const svg = token.meta?.aidlcMermaidSvg;
      if (typeof svg !== "string") throw new Error("Mermaid token was not rendered before HTML generation");
      return `<figure class="diagram mermaid-diagram">${svg}</figure>\n`;
    }
    return defaultFence ? defaultFence(renderTokens, index, rendererOptions, env, self) : `<pre><code>${escapeHtml(token.content)}</code></pre>\n`;
  };
  md.renderer.rules.fence = fenceRenderer;
  let body = md.renderer.render(tokens, md.options, {});
  if (options.toc) {
    const toc = tocHtml(headings);
    const titleEnd = body.search(/<\/h1>/i);
    body = toc && titleEnd >= 0
      ? `${body.slice(0, titleEnd + 5)}${toc}${body.slice(titleEnd + 5)}`
      : `${toc}${body}`;
  }
  const css = pdfCss(options.pageSize);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;
}

function pdfCss(pageSize: "A4" | "Letter"): string {
  return `
@page { size: ${pageSize}; margin: 18mm 16mm; }
:root { --text:#262626; --muted:#666; --border:#d9d9d9; --header:#f5f5f5; --code:#f6f8fa; }
* { box-sizing:border-box; }
html, body { margin:0; padding:0; }
body { color:var(--text); font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Arial,sans-serif; font-size:10.5pt; line-height:1.65; overflow-wrap:anywhere; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
h1 { margin:0 0 18pt; padding-bottom:7pt; border-bottom:2px solid #333; font-size:22pt; line-height:1.3; page-break-after:avoid; }
h2 { margin:20pt 0 8pt; padding-bottom:4pt; border-bottom:1px solid #cfcfcf; font-size:16pt; line-height:1.35; page-break-after:avoid; }
h3 { margin:15pt 0 6pt; font-size:13pt; page-break-after:avoid; }
h4,h5,h6 { margin:11pt 0 5pt; font-size:11.5pt; page-break-after:avoid; }
p { margin:0 0 7pt; }
a { color:#0969da; text-decoration:none; }
.toc { margin:10pt 0 18pt; padding:10pt 12pt; border:1px solid var(--border); background:#fafafa; page-break-inside:avoid; }
.toc-title { margin-bottom:5pt; font-size:14pt; font-weight:bold; }
.toc ul { margin:0; padding:0; list-style:none; }
.toc li { margin:2pt 0; line-height:1.45; }
.toc-level-3 { margin-left:1.25em !important; } .toc-level-4 { margin-left:2.5em !important; } .toc-level-5 { margin-left:3.75em !important; } .toc-level-6 { margin-left:5em !important; }
table { width:100%; margin:10pt 0 12pt; border-collapse:collapse; table-layout:auto; font-size:9pt; page-break-inside:auto; }
thead { display:table-header-group; } tr { page-break-inside:avoid; }
th,td { padding:5pt 6pt; border:1px solid var(--border); text-align:left; vertical-align:top; white-space:normal; }
th { background:var(--header); font-weight:bold; } th:first-child,td:first-child { white-space:nowrap; } tr:nth-child(even) td { background:#fcfcfc; }
code { padding:1pt 3pt; border-radius:2pt; background:var(--code); font-family:Menlo,Monaco,Consolas,monospace; font-size:9pt; }
pre { margin:8pt 0 10pt; padding:9pt 11pt; border:1px solid #e5e7eb; border-radius:3pt; background:var(--code); white-space:pre-wrap; overflow-wrap:anywhere; page-break-inside:avoid; }
pre code { padding:0; border:0; background:transparent; }
blockquote { margin:8pt 0 10pt; padding:5pt 10pt; border-left:3px solid #a6a6a6; color:#4d4d4d; background:#fafafa; page-break-inside:avoid; }
ul,ol { margin:4pt 0 8pt; padding-left:1.7em; } li { margin:2pt 0; }
hr { margin:12pt 0; border:0; border-top:1px solid #bfbfbf; }
img,svg { max-width:100%; height:auto; }
figure.diagram { margin:10pt auto 14pt; text-align:center; page-break-inside:avoid; }
figure.diagram svg { display:block; margin:auto; max-width:100%; max-height:235mm; }
`;
}

function validatePdf(data: Buffer): void {
  if (data.length < 64 || data.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Chrome did not produce a valid PDF header");
  if (!data.subarray(Math.max(0, data.length - 2048)).includes(Buffer.from("%%EOF"))) throw new Error("Chrome produced an incomplete PDF without %%EOF");
}

function exportPdf(markdown: string, options: ExportOptions): void {
  const browser = findBrowser(options.browser);
  if (!browser) throw new Error("PDF export requires Chrome, Chromium, or Edge; install a browser or pass --browser/AIDLC_CHROME_BIN");
  const html = renderMarkdownHtml(markdown, dirname(options.input), options);
  const tempRoot = mkdtempSync(join(tmpdir(), "loeyae-aidlc-pdf-"));
  const tempOutput = temporaryOutputPath(options.output);
  try {
    const htmlPath = join(tempRoot, "document.html");
    writeFileSync(htmlPath, html, "utf8");
    const result = spawnSync(browser, [
      "--headless=new",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-pdf-header-footer",
      `--user-data-dir=${join(tempRoot, "profile")}`,
      `--print-to-pdf=${tempOutput}`,
      pathToFileURL(htmlPath).href,
    ], { encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    if (!existsSync(tempOutput)) {
      const detail = browserResultTail(result.stderr) || (result.error ? result.error.message : `browser exit code ${result.status}`);
      throw new Error(`PDF generation failed: ${detail}`);
    }
    validatePdf(readFileSync(tempOutput));
    commitOutput(tempOutput, options.output, options.force);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    if (existsSync(tempOutput)) rmSync(tempOutput, { force: true });
  }
}

function findMatching(tokens: Token[], start: number, openType: string, closeType: string, end = tokens.length): number {
  let depth = 0;
  for (let index = start; index < end; index++) {
    if (tokens[index].type === openType) depth++;
    else if (tokens[index].type === closeType && --depth === 0) return index;
  }
  throw new Error(`malformed Markdown token stream: missing ${closeType}`);
}

function displayUnits(value: string): number {
  const lines = value.replace(/<br\s*\/?>/gi, "\n").split("\n");
  return Math.max(0, ...lines.map((line) => [...line.replace(/[*_~`]/g, "")].reduce((sum, character) => sum + (character.codePointAt(0)! > 127 ? 2 : 1), 0)));
}

function columnFractions(rows: string[][], columns: number): number[] {
  const usableUnits = 108;
  const cellPadding = 3;
  const shortMaximum = 20;
  const needs = Array.from({ length: columns }, (_, column) =>
    Math.max(0, ...rows.map((row) => displayUnits(row[column] || ""))) + cellPadding);
  const total = needs.reduce((sum, value) => sum + value, 0) || columns;
  if (total <= usableUnits) return needs.map((value) => value / total);
  const short = needs.map((value, index) => ({ value, index })).filter(({ value }) => value - cellPadding <= shortMaximum);
  const long = needs.map((value, index) => ({ value, index })).filter(({ value }) => value - cellPadding > shortMaximum);
  if (long.length === 0) return needs.map((value) => value / total);
  const widths = Array(columns).fill(0) as number[];
  const rawShort = short.reduce((sum, item) => sum + item.value, 0);
  const shortBudget = Math.min(rawShort, usableUnits * 0.62);
  const shortScale = rawShort ? shortBudget / rawShort : 1;
  short.forEach(({ value, index }) => { widths[index] = value * shortScale; });
  const remaining = Math.max(usableUnits - widths.reduce((sum, value) => sum + value, 0), long.length * 14);
  const longTotal = long.reduce((sum, item) => sum + item.value, 0) || 1;
  long.forEach(({ value, index }) => { widths[index] = remaining * value / longTotal; });
  const widthTotal = widths.reduce((sum, value) => sum + value, 0) || 1;
  return widths.map((value) => value / widthTotal);
}

function imageRun(raw: string, alt: string, baseDirectory: string, maxWidth = CONTENT_WIDTH_PX, maxHeight = CONTENT_HEIGHT_PX): ImageRun {
  const filePath = resolveLocalAsset(raw, baseDirectory);
  const extension = extname(filePath).toLowerCase();
  let data = readFileSync(filePath);
  let info: RasterInfo;
  if (extension === ".svg") {
    const rendered = renderSvgPng(data.toString("utf8"), { scale: 2, background: "#ffffff" });
    data = rendered.data;
    info = { type: "png", width: Math.round(rendered.width / 2), height: Math.round(rendered.height / 2) };
  } else {
    info = rasterInfo(data);
  }
  const dimensions = scaledDimensions(info.width, info.height, maxWidth, maxHeight);
  return new ImageRun({
    type: info.type,
    data,
    transformation: dimensions,
    altText: { title: alt || basename(filePath), description: alt || basename(filePath), name: basename(filePath) },
  });
}

class DocxRenderer {
  private firstTitle = true;

  constructor(private readonly baseDirectory: string) {}

  async render(tokens: Token[], start = 0, end = tokens.length, context: DocxRenderContext = {}): Promise<(Paragraph | Table)[]> {
    const blocks: (Paragraph | Table)[] = [];
    let index = start;
    while (index < end) {
      const token = tokens[index];
      if (token.type === "heading_open") {
        const close = findMatching(tokens, index, "heading_open", "heading_close", end);
        const inline = tokens.slice(index + 1, close).find((entry) => entry.type === "inline");
        blocks.push(await this.heading(token, inline, context));
        index = close + 1;
      } else if (token.type === "paragraph_open") {
        const close = findMatching(tokens, index, "paragraph_open", "paragraph_close", end);
        const inline = tokens.slice(index + 1, close).find((entry) => entry.type === "inline");
        blocks.push(await this.paragraph(inline, context));
        index = close + 1;
      } else if (token.type === "fence" || token.type === "code_block") {
        blocks.push(this.codeBlock(token, context));
        index++;
      } else if (token.type === "table_open") {
        const close = findMatching(tokens, index, "table_open", "table_close", end);
        blocks.push(await this.table(tokens, index + 1, close));
        index = close + 1;
      } else if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
        const closeType = token.type === "bullet_list_open" ? "bullet_list_close" : "ordered_list_close";
        const close = findMatching(tokens, index, token.type, closeType, end);
        blocks.push(...await this.list(tokens, index, close, 0, token.type === "ordered_list_open", context));
        index = close + 1;
      } else if (token.type === "blockquote_open") {
        const close = findMatching(tokens, index, "blockquote_open", "blockquote_close", end);
        blocks.push(...await this.render(tokens, index + 1, close, { ...context, quote: true }));
        index = close + 1;
      } else if (token.type === "hr") {
        blocks.push(new Paragraph({
          children: [],
          border: { bottom: { style: BorderStyle.SINGLE, color: "BFBFBF", size: 6, space: 1 } },
          spacing: { before: 40, after: 40 },
        }));
        index++;
      } else {
        index++;
      }
    }
    return blocks;
  }

  private quoteProperties(context: DocxRenderContext): Partial<IParagraphOptions> {
    return context.quote
      ? {
          indent: { left: convertInchesToTwip(0.25) },
          border: { left: { style: BorderStyle.SINGLE, color: "A6A6A6", size: 18, space: 6 } },
          shading: { fill: "FAFAFA", type: ShadingType.CLEAR },
        }
      : {};
  }

  private async heading(open: Token, inline: Token | undefined, context: DocxRenderContext): Promise<Paragraph> {
    const level = Number(open.tag.slice(1));
    const children = await this.inline(inline?.children || []);
    if (level === 1 && this.firstTitle) {
      this.firstTitle = false;
      return new Paragraph({
        ...this.quoteProperties(context),
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { before: 720, after: 360 },
        children,
      });
    }
    const wordLevel = Math.min(Math.max(level - 1, 1), 6);
    const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][wordLevel - 1];
    return new Paragraph({ ...this.quoteProperties(context), heading, keepNext: true, children });
  }

  private async paragraph(inline: Token | undefined, context: DocxRenderContext, extra: Partial<IParagraphOptions> = {}): Promise<Paragraph> {
    return new Paragraph({
      ...this.quoteProperties(context),
      spacing: { after: 80 },
      ...extra,
      children: await this.inline(inline?.children || []),
    });
  }

  private codeBlock(token: Token, context: DocxRenderContext): Paragraph {
    const language = token.info.trim().split(/\s+/, 1)[0].toLowerCase();
    if (language === "mermaid") {
      const svg = token.meta?.aidlcMermaidSvg;
      if (typeof svg !== "string") throw new Error("Mermaid token was not rendered before DOCX generation");
      const rendered = renderSvgPng(svg, { scale: 2, background: "#ffffff" });
      const display = scaledDimensions(rendered.width / 2, rendered.height / 2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
      return new Paragraph({
        ...this.quoteProperties(context),
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 160 },
        children: [new ImageRun({
          type: "png",
          data: rendered.data,
          transformation: display,
          altText: { title: "Mermaid diagram", description: "Rendered Mermaid diagram", name: "mermaid.png" },
        })],
      });
    }
    const children: TextRun[] = [];
    token.content.replace(/\n$/, "").split("\n").forEach((line, index) => {
      children.push(new TextRun({ text: line, break: index ? 1 : undefined, font: "Consolas", size: 17 }));
    });
    return new Paragraph({
      ...this.quoteProperties(context),
      children,
      indent: { left: convertInchesToTwip(0.2), right: convertInchesToTwip(0.1) },
      shading: { fill: "F6F8FA", type: ShadingType.CLEAR },
      border: {
        top: { style: BorderStyle.SINGLE, color: "E5E7EB", size: 4 },
        bottom: { style: BorderStyle.SINGLE, color: "E5E7EB", size: 4 },
        left: { style: BorderStyle.SINGLE, color: "E5E7EB", size: 4 },
        right: { style: BorderStyle.SINGLE, color: "E5E7EB", size: 4 },
      },
      spacing: { before: 100, after: 120 },
    });
  }

  private async inline(
    tokens: Token[],
    maxImageWidth = CONTENT_WIDTH_PX,
    initialStyle: Partial<{ bold: boolean; italics: boolean; strike: boolean }> = {},
  ): Promise<ParagraphChild[]> {
    const output: ParagraphChild[] = [];
    const style = { bold: false, italics: false, strike: false, ...initialStyle };
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.type === "strong_open") style.bold = true;
      else if (token.type === "strong_close") style.bold = false;
      else if (token.type === "em_open") style.italics = true;
      else if (token.type === "em_close") style.italics = false;
      else if (token.type === "s_open") style.strike = true;
      else if (token.type === "s_close") style.strike = false;
      else if (token.type === "text") output.push(new TextRun({ text: token.content, ...style }));
      else if (token.type === "code_inline") output.push(new TextRun({
        text: token.content,
        font: "Consolas",
        size: 19,
        shading: { fill: "F6F8FA", type: ShadingType.CLEAR },
        ...style,
      }));
      else if (token.type === "softbreak" || token.type === "hardbreak") output.push(new TextRun({ break: 1 }));
      else if (token.type === "image") {
        const sourceValue = token.attrGet("src");
        if (!sourceValue) throw new Error("Markdown image is missing a source path");
        output.push(imageRun(String(sourceValue), token.content, this.baseDirectory, maxImageWidth));
      } else if (token.type === "link_open") {
        const close = findMatching(tokens, index, "link_open", "link_close");
        const href = String(token.attrGet("href") || "");
        const linkedChildren = await this.inline(tokens.slice(index + 1, close), maxImageWidth);
        if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
          output.push(new ExternalHyperlink({ link: href, children: linkedChildren }));
        } else {
          output.push(...linkedChildren);
        }
        index = close;
      }
    }
    return output;
  }

  private async list(tokens: Token[], open: number, close: number, level: number, ordered: boolean, context: DocxRenderContext): Promise<Paragraph[]> {
    const paragraphs: Paragraph[] = [];
    let index = open + 1;
    while (index < close) {
      if (tokens[index].type !== "list_item_open") {
        index++;
        continue;
      }
      const itemClose = findMatching(tokens, index, "list_item_open", "list_item_close", close);
      let itemIndex = index + 1;
      let markerUsed = false;
      while (itemIndex < itemClose) {
        const token = tokens[itemIndex];
        if (token.type === "paragraph_open") {
          const paragraphClose = findMatching(tokens, itemIndex, "paragraph_open", "paragraph_close", itemClose);
          const inline = tokens.slice(itemIndex + 1, paragraphClose).find((entry) => entry.type === "inline");
          const marker = markerUsed
            ? { indent: { left: convertInchesToTwip(0.5 + level * 0.25) } }
            : ordered
              ? { numbering: { reference: "aidlc-ordered", level: Math.min(level, 5) } }
              : { bullet: { level: Math.min(level, 5) } };
          paragraphs.push(await this.paragraph(inline, context, { ...marker, spacing: { after: 40 } }));
          markerUsed = true;
          itemIndex = paragraphClose + 1;
        } else if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
          const nestedOrdered = token.type === "ordered_list_open";
          const closeType = nestedOrdered ? "ordered_list_close" : "bullet_list_close";
          const nestedClose = findMatching(tokens, itemIndex, token.type, closeType, itemClose);
          paragraphs.push(...await this.list(tokens, itemIndex, nestedClose, level + 1, nestedOrdered, context));
          itemIndex = nestedClose + 1;
        } else {
          itemIndex++;
        }
      }
      index = itemClose + 1;
    }
    return paragraphs;
  }

  private async table(tokens: Token[], start: number, end: number): Promise<Table> {
    const rows: Array<{ header: boolean; cells: Token[][] }> = [];
    let inHeader = false;
    let index = start;
    while (index < end) {
      if (tokens[index].type === "thead_open") inHeader = true;
      else if (tokens[index].type === "thead_close") inHeader = false;
      else if (tokens[index].type === "tr_open") {
        const rowClose = findMatching(tokens, index, "tr_open", "tr_close", end);
        const cells: Token[][] = [];
        let cellIndex = index + 1;
        while (cellIndex < rowClose) {
          if (tokens[cellIndex].type === "th_open" || tokens[cellIndex].type === "td_open") {
            const openType = tokens[cellIndex].type;
            const closeType = openType === "th_open" ? "th_close" : "td_close";
            const cellClose = findMatching(tokens, cellIndex, openType, closeType, rowClose);
            const inline = tokens.slice(cellIndex + 1, cellClose).find((entry) => entry.type === "inline");
            cells.push(inline?.children || []);
            cellIndex = cellClose + 1;
          } else cellIndex++;
        }
        rows.push({ header: inHeader, cells });
        index = rowClose;
      }
      index++;
    }
    if (rows.length === 0) throw new Error("Markdown table contains no rows");
    const columns = Math.max(...rows.map((row) => row.cells.length));
    const textRows = rows.map((row) => row.cells.map((cell) => cell.map((token) => token.content).join("")));
    const fractions = columnFractions(textRows, columns);
    const columnWidths = fractions.map((fraction) => Math.max(200, Math.round(CONTENT_WIDTH_TWIPS * fraction)));
    const tableRows: TableRow[] = [];
    for (const row of rows) {
      const cells: TableCell[] = [];
      for (let column = 0; column < columns; column++) {
        const maxImageWidth = Math.max(40, Math.round(CONTENT_WIDTH_PX * fractions[column] * 0.9));
        const children = await this.inline(row.cells[column] || [], maxImageWidth, row.header ? { bold: true } : {});
        cells.push(new TableCell({
          width: { size: columnWidths[column], type: WidthType.DXA },
          verticalAlign: VerticalAlignTable.CENTER,
          shading: row.header ? { fill: "F5F5F5", type: ShadingType.CLEAR } : undefined,
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [new Paragraph({
            children,
            spacing: { before: 20, after: 20 },
          })],
        }));
      }
      tableRows.push(new TableRow({ children: cells, cantSplit: true, tableHeader: row.header }));
    }
    const border = { style: BorderStyle.SINGLE, color: "D9D9D9", size: 4 };
    return new Table({
      rows: tableRows,
      width: { size: "100%", type: WidthType.PERCENTAGE },
      columnWidths,
      layout: TableLayoutType.FIXED,
      alignment: AlignmentType.CENTER,
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    });
  }
}

function docxStyles() {
  const font = { ascii: DEFAULT_FONT, eastAsia: DEFAULT_FONT, hAnsi: DEFAULT_FONT, cs: DEFAULT_FONT };
  return {
    default: {
      document: { run: { font, size: 21, color: "262626" }, paragraph: { spacing: { after: 80, line: 330 } } },
      title: { run: { font, size: 52, bold: true, color: "000000" }, paragraph: { spacing: { before: 720, after: 360 } } },
      heading1: { run: { font, size: 44, bold: true, color: "000000" }, paragraph: { spacing: { before: 360, after: 160 }, keepNext: true } },
      heading2: { run: { font, size: 32, bold: true, color: "1A1A1A" }, paragraph: { spacing: { before: 280, after: 160 }, keepNext: true } },
      heading3: { run: { font, size: 26, bold: true, color: "2A2A2A" }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true } },
      heading4: { run: { font, size: 23, bold: true, color: "333333" }, paragraph: { spacing: { before: 220, after: 100 }, keepNext: true } },
      hyperlink: { run: { color: "0969DA", underline: { type: "single" as const } } },
    },
  };
}

function orderedNumbering() {
  return {
    config: [{
      reference: "aidlc-ordered",
      levels: Array.from({ length: 6 }, (_, level) => ({
        level,
        format: LevelFormat.DECIMAL,
        text: `%${level + 1}.`,
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
      })),
    }],
  };
}

function parseXmlAttributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

async function loadTemplate(templatePath: string): Promise<TemplateInfo> {
  assertRegularFile(templatePath, "DOCX template", 50 * 1024 * 1024);
  if (extname(templatePath).toLowerCase() !== ".docx") throw new Error("DOCX template path must end with .docx");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(readFileSync(templatePath));
  } catch (error) {
    throw new Error(`invalid DOCX template: ${error instanceof Error ? error.message : String(error)}`);
  }
  const stylesFile = zip.file("word/styles.xml");
  const documentFile = zip.file("word/document.xml");
  if (!stylesFile || !documentFile) throw new Error("DOCX template is missing word/styles.xml or word/document.xml");
  const styles = await stylesFile.async("string");
  const documentXml = await documentFile.async("string");
  const pageSizeTag = documentXml.match(/<w:pgSz\b[^>]*\/?\s*>/)?.[0] || "";
  const marginTag = documentXml.match(/<w:pgMar\b[^>]*\/?\s*>/)?.[0] || "";
  const pageSize = parseXmlAttributes(pageSizeTag);
  const margins = parseXmlAttributes(marginTag);
  const number = (value?: string): number | undefined => value && /^\d+$/.test(value) ? Number(value) : undefined;
  return {
    styles,
    pageWidth: number(pageSize["w:w"]),
    pageHeight: number(pageSize["w:h"]),
    marginTop: number(margins["w:top"]),
    marginRight: number(margins["w:right"]),
    marginBottom: number(margins["w:bottom"]),
    marginLeft: number(margins["w:left"]),
  };
}

function staticToc(headings: HeadingEntry[]): Paragraph[] {
  const entries = headings.filter((heading) => heading.level > 1);
  if (entries.length === 0) return [];
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "目录", bold: true })] }),
    ...entries.map((entry) => new Paragraph({
      indent: { left: Math.max(0, entry.level - 2) * 360 },
      spacing: { after: 40 },
      children: [new TextRun({ text: entry.title })],
    })),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

async function validateDocx(data: Buffer): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (error) {
    throw new Error(`generated DOCX is not a valid ZIP package: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const required of ["[Content_Types].xml", "word/document.xml", "word/styles.xml"]) {
    if (!zip.file(required)) throw new Error(`generated DOCX is missing ${required}`);
  }
}

async function exportDocx(markdown: string, options: ExportOptions): Promise<void> {
  const { tokens, headings } = prepareMarkdown(markdown, dirname(options.input), options.browser);
  const renderer = new DocxRenderer(dirname(options.input));
  const body = await renderer.render(tokens);
  if (options.toc) {
    const toc = staticToc(headings);
    const titleIndex = tokens.findIndex((token) => token.type === "heading_open" && token.tag === "h1");
    body.splice(titleIndex >= 0 ? 1 : 0, 0, ...toc);
  }
  const template = options.template ? await loadTemplate(options.template) : undefined;
  const a4 = { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) };
  const letter = { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) };
  const page = options.pageSize === "A4" ? a4 : letter;
  const document = new Document({
    title: basename(options.input),
    creator: "loeyae-aidlc",
    description: "Exported from Markdown by loeyae-aidlc",
    externalStyles: template?.styles,
    styles: template ? undefined : docxStyles(),
    numbering: orderedNumbering(),
    features: { updateFields: true },
    sections: [{
      properties: {
        page: {
          size: { width: template?.pageWidth || page.width, height: template?.pageHeight || page.height },
          margin: {
            top: template?.marginTop || convertInchesToTwip(0.8),
            right: template?.marginRight || convertInchesToTwip(0.75),
            bottom: template?.marginBottom || convertInchesToTwip(0.8),
            left: template?.marginLeft || convertInchesToTwip(0.75),
          },
        },
      },
      children: body as FileChild[],
    }],
  });
  const data = await Packer.toBuffer(document);
  await validateDocx(data);
  atomicWrite(options.output, data, options.force);
}

async function runExport(options: ExportOptions): Promise<void> {
  assertRegularFile(options.input, `${options.sourceKind.toUpperCase()} input`, options.sourceKind === "md" ? MAX_MARKDOWN_BYTES : MAX_SVG_BYTES);
  if (options.template) assertRegularFile(options.template, "DOCX template", 50 * 1024 * 1024);
  for (const fontDirectory of options.fontDirs) {
    if (!existsSync(fontDirectory) || !lstatSync(fontDirectory).isDirectory() || lstatSync(fontDirectory).isSymbolicLink()) {
      throw new Error(`font directory must be a regular non-symlink directory: ${fontDirectory}`);
    }
  }
  prepareOutput(options.output, options.force);

  if (options.sourceKind === "svg") {
    const svg = readFileSync(options.input, "utf8");
    const rendered = renderSvgPng(svg, {
      scale: options.scale,
      width: options.width,
      dpi: options.dpi,
      background: options.background,
      fontDirs: options.fontDirs,
    });
    atomicWrite(options.output, rendered.data, options.force);
    console.log(`✅ PNG exported: ${options.output}`);
    console.log(`   Dimensions: ${rendered.width}x${rendered.height}`);
    console.log(`   Size: ${(rendered.data.length / 1024).toFixed(1)} KB`);
    return;
  }

  const markdown = stripSections(readFileSync(options.input, "utf8").replace(/^\uFEFF/, ""), options.stripKeywords);
  if (!markdown.trim()) throw new Error("Markdown contains no exportable content after section filtering");
  if (options.target === "docx") await exportDocx(markdown, options);
  else exportPdf(markdown, options);
  const size = lstatSync(options.output).size;
  console.log(`✅ ${options.target.toUpperCase()} exported: ${options.output}`);
  console.log(`   Size: ${(size / 1024).toFixed(1)} KB`);
}

async function main(): Promise<void> {
  const options = parseExportArgs(process.argv.slice(2));
  if (!options) {
    console.log(usage());
    return;
  }
  await runExport(options);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
