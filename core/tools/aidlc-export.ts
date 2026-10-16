#!/usr/bin/env node
/** Compatibility CLI and parameter parser; rendering is exclusively Provider-owned. */
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchDocumentExport } from "./aidlc-document-export.js";
export { findBrowser } from "./aidlc-trusted-host.js";
export interface ExportOptions {
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

function usage(): string {
  return `
loeyae-aidlc export — document and diagram conversion

Usage:
  loeyae-aidlc export md <input.md> --to <docx|pdf> [options]
  loeyae-aidlc export svg <input.svg> --to png [options]

Managed dispatch options:
  --project <path>     Provider configuration root (default: current directory)
  --host-provider <id> Explicit authorization for a locked trusted host package
  --project-id <id>    Binding identity (default: project directory name)
  --stage <name>       Binding stage (default: export)
  --scope <name>       Binding scope (default: input relative path)

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


async function main() {
  const args = process.argv.slice(2), renderArgs: string[] = [], dispatch: Record<string,string> = {};
  for (let i = 0; i < args.length; i++) {
    if (["--project", "--host-provider", "--project-id", "--stage", "--scope"].includes(args[i])) {
      if (dispatch[args[i]]) throw new Error(`duplicate option: ${args[i]}`);
      dispatch[args[i]] = optionValue(args, i, args[i]); i++;
    } else renderArgs.push(args[i]);
  }
  const options = parseExportArgs(renderArgs);
  if (!options) { console.log(usage()); return; }
  await dispatchDocumentExport(options, {
    project: resolve(dispatch["--project"] || process.env.AIDLC_EXPORT_PROJECT || process.cwd()),
    instance: dispatch["--host-provider"] || process.env.AIDLC_EXPORT_HOST_PROVIDER,
    projectId: dispatch["--project-id"], stage: dispatch["--stage"], scope: dispatch["--scope"],
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`❌ ${error.message}`); process.exitCode = 1; });
}
