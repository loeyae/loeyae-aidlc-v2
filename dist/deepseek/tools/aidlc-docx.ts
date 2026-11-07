/** Read-only DOCX package inspection. */

import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InspectionReport } from "./docx/types";
export type { InspectionReport } from "./docx/types";
import { dispatchDocx } from "./aidlc-docx-provider";
export async function inspectDocx(input: string): Promise<InspectionReport> {
	return dispatchDocx({ command: "inspect", input });
}

interface InspectOptions {
	command: "inspect";
	input: string;
	json: boolean;
}

interface BeautifyOptions {
	command: "beautify";
	input: string;
	output?: string;
	preset?: string;
	styleSpecPath?: string;
	dryRun: boolean;
	force: boolean;
	json: boolean;
}

interface ValidateOptions {
	command: "validate";
	output: string;
	against: string;
	json: boolean;
}

type DocxOptions = InspectOptions | BeautifyOptions | ValidateOptions;

function usage(): string {
	return `
loeyae-aidlc docx — Word document inspection and conservative beautification

Usage:
  loeyae-aidlc docx inspect <input.docx> [--json]
  loeyae-aidlc docx beautify <input.docx> [--output <output.docx>] [options]
  loeyae-aidlc docx validate <output.docx> --against <input.docx> [--json]

Beautify options:
  --preset <name>       Provider preset (default: professional-zh)
  --style-spec <json>   Strict allowlisted custom style specification
  --output <docx>       Required for writing; omitted only with --dry-run
  --dry-run             Report mappings and coverage without writing
  --force               Transactionally replace an existing regular output file
  --json                Emit a versioned machine-readable report

Managed dispatch: --project <path> --host-provider <locked-instance>
Environment: AIDLC_DOCX_PROJECT, AIDLC_DOCX_HOST_PROVIDER (explicit authorization).
Missing package: add/lock/enable providers/docx-style; no implicit installation.
Validate uses the independent Core verifier and needs no Provider.

Inspect is read-only and never downloads external relationships. Beautify is a
styles-only conservative transform: it preserves direct formatting and permits
only the relationship-resolved styles part to change. Macro-enabled, signed, and
protected packages are rejected.
`;
}

function docxPath(argument: string | undefined, label: string): string {
	if (!argument || argument.startsWith("--"))
		throw new Error(`${label} requires a DOCX file`);
	const path = resolve(argument);
	if (extname(path).toLowerCase() !== ".docx")
		throw new Error(`${label} input must end with .docx`);
	return path;
}

function optionValue(argv: string[], index: number, option: string): string {
	const value = argv[index + 1];
	if (!value || value.startsWith("--"))
		throw new Error(`${option} requires a value`);
	return value;
}

export function parseDocxArgs(argv: string[]): DocxOptions | undefined {
	if (argv.length === 0 || ["help", "--help", "-h"].includes(argv[0]))
		return undefined;
	const command = argv[0];
	if (["--help", "-h"].some((flag) => argv.slice(1).includes(flag)))
		return undefined;
	if (command === "inspect") {
		const input = docxPath(argv[1], "DOCX inspect");
		let json = false;
		for (const argument of argv.slice(2)) {
			if (argument !== "--json")
				throw new Error(`unknown docx inspect option: ${argument}`);
			if (json) throw new Error("duplicate option: --json");
			json = true;
		}
		return { command, input, json };
	}
	if (command === "beautify") {
		const input = docxPath(argv[1], "DOCX beautify");
		let output: string | undefined;
		let preset: string | undefined;
		let styleSpecPath: string | undefined;
		let dryRun = false;
		let force = false;
		let json = false;
		const seen = new Set<string>();
		for (let index = 2; index < argv.length; index++) {
			const argument = argv[index];
			if (["--output", "--preset", "--style-spec"].includes(argument)) {
				if (seen.has(argument))
					throw new Error(`duplicate option: ${argument}`);
				seen.add(argument);
				const value = optionValue(argv, index, argument);
				index++;
				if (argument === "--output") {
					output = resolve(value);
					if (extname(output).toLowerCase() !== ".docx")
						throw new Error("--output path must end with .docx");
				} else if (argument === "--preset") preset = value;
				else styleSpecPath = resolve(value);
			} else if (["--dry-run", "--force", "--json"].includes(argument)) {
				if (seen.has(argument))
					throw new Error(`duplicate option: ${argument}`);
				seen.add(argument);
				if (argument === "--dry-run") dryRun = true;
				else if (argument === "--force") force = true;
				else json = true;
			} else throw new Error(`unknown docx beautify option: ${argument}`);
		}
		if (preset && styleSpecPath)
			throw new Error("--preset and --style-spec are mutually exclusive");
		if (!dryRun && !output)
			throw new Error(
				"docx beautify requires --output unless --dry-run is used",
			);
		if (dryRun && force)
			throw new Error("--force cannot be combined with --dry-run");
		if (output && output === input)
			throw new Error("output path must differ from input path");
		return {
			command,
			input,
			output,
			preset,
			styleSpecPath,
			dryRun,
			force,
			json,
		};
	}
	if (command === "validate") {
		const output = docxPath(argv[1], "DOCX validate");
		let against: string | undefined;
		let json = false;
		const seen = new Set<string>();
		for (let index = 2; index < argv.length; index++) {
			const argument = argv[index];
			if (argument === "--against") {
				if (seen.has(argument)) throw new Error("duplicate option: --against");
				seen.add(argument);
				against = docxPath(optionValue(argv, index, argument), "--against");
				index++;
			} else if (argument === "--json") {
				if (json) throw new Error("duplicate option: --json");
				json = true;
			} else throw new Error(`unknown docx validate option: ${argument}`);
		}
		if (!against)
			throw new Error("docx validate requires --against <input.docx>");
		return { command, output, against, json };
	}
	throw new Error(
		`unknown docx command: ${command}; expected inspect, beautify, or validate`,
	);
}

function printHuman(report: InspectionReport): void {
	const changes =
		report.document.tracked_insertions + report.document.tracked_deletions;
	console.log(`DOCX inspection (read-only): ${report.input.path}`);
	console.log(`SHA-256: ${report.input.sha256}`);
	console.log(
		`Package: ${report.package.files} files, ${report.package.uncompressed_bytes} expanded bytes`,
	);
	console.log(
		`Paragraphs: ${report.document.paragraphs} (${report.document.non_empty_paragraphs} non-empty)`,
	);
	console.log(
		`Tables: ${report.document.tables} (${report.document.table_rows} rows, ${report.document.table_cells} cells)`,
	);
	console.log(
		`Media: ${report.document.media_files} files, ${report.document.media_bytes} bytes`,
	);
	console.log(
		`Styles: ${report.styles.defined} defined, ${report.styles.used_ids.length} used`,
	);
	if (report.direct_formatting) {
		const direct = report.direct_formatting;
		console.log(
			`Direct visual overrides: ${direct.paragraphs_with_direct_visual_overrides}/${direct.paragraphs_total} paragraphs, ${direct.runs_with_direct_visual_overrides}/${direct.runs_total} runs; preserved and may override styles`,
		);
	}
	console.log(
		`Tracked changes: ${changes}; comments: ${report.document.comments}`,
	);
	console.log(
		`External relationships: ${report.package.external_relationships} (not accessed)`,
	);
	if (report.warnings.length) {
		console.log("Warnings:");
		for (const warning of report.warnings) console.log(`  - ${warning}`);
	}
}

function printBeautifyHuman(report: {
	status: string;
	input: { path: string };
	output: { path: string } | null;
	coverage: { estimated_effective_percent: number };
	warnings: string[];
}): void {
	console.log(`DOCX beautify: ${report.status}`);
	console.log(`Input: ${report.input.path}`);
	if (report.output) console.log(`Output: ${report.output.path}`);
	console.log(
		`Estimated style coverage: ${report.coverage.estimated_effective_percent}%`,
	);
	for (const warning of report.warnings) console.log(`Warning: ${warning}`);
}

async function main(): Promise<void> {
	const raw = process.argv.slice(2),
		args: string[] = [],
		dispatch: Record<string, string> = {};
	for (let i = 0; i < raw.length; i++) {
		if (["--project", "--host-provider"].includes(raw[i])) {
			if (dispatch[raw[i]]) throw new Error("duplicate option: " + raw[i]);
			dispatch[raw[i]] = optionValue(raw, i, raw[i]);
			i++;
		} else args.push(raw[i]);
	}
	const options = parseDocxArgs(args);
	if (!options) {
		console.log(usage());
		return;
	}
	if (options.command === "inspect") {
		const report = await dispatchDocx(options, {
			project: dispatch["--project"],
			instance: dispatch["--host-provider"],
		});
		if (options.json) console.log(JSON.stringify(report, null, 2));
		else printHuman(report);
		return;
	}
	const { validateDocxAgainst } = await import("./docx/beautify");
	if (options.command === "beautify") {
		const report = await dispatchDocx(options, {
			project: dispatch["--project"],
			instance: dispatch["--host-provider"],
		});
		if (options.json) console.log(JSON.stringify(report, null, 2));
		else printBeautifyHuman(report);
		return;
	}
	const report = await validateDocxAgainst(options.output, options.against);
	if (options.json) console.log(JSON.stringify(report, null, 2));
	else {
		console.log(`DOCX validation: ${report.status}`);
		console.log(`Output: ${report.output.path}`);
		console.log(`Against: ${report.against.path}`);
		console.log(`Changed parts: ${report.changed_parts.join(", ") || "none"}`);
	}
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(
			`❌ ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	});
}
