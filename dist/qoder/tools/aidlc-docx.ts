/** Read-only DOCX package inspection. */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { extname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 5_000;
const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 250 * 1024 * 1024;
const MAX_XML_BYTES = 16 * 1024 * 1024;
const MAX_STYLE_DETAILS = 200;
const DOCX_MAIN_CONTENT_TYPE =
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

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

interface StyleDefinition {
	id: string;
	type: string;
	name?: string;
	default: boolean;
}

export interface InspectionReport {
	schema_version: "1";
	input: {
		path: string;
		size_bytes: number;
		sha256: string;
	};
	package: {
		entries: number;
		files: number;
		directories: number;
		uncompressed_bytes: number;
		content_types: number;
		relationships: number;
		external_relationships: number;
		external_relationship_types: string[];
		embedded_objects: number;
		has_macros: false;
		has_digital_signatures: false;
	};
	metadata: Record<string, string | number>;
	document: {
		paragraphs: number;
		non_empty_paragraphs: number;
		tables: number;
		table_rows: number;
		table_cells: number;
		drawings: number;
		media_files: number;
		media_bytes: number;
		hyperlinks: number;
		sections: number;
		page_breaks: number;
		fields: number;
		content_controls: number;
		comments: number;
		footnotes: number;
		endnotes: number;
		tracked_insertions: number;
		tracked_deletions: number;
		tracked_moves: number;
		headers: number;
		footers: number;
		text_characters: number;
		text_sha256: string;
	};
	styles: {
		defined: number;
		by_type: Record<string, number>;
		definitions: StyleDefinition[];
		definitions_truncated: boolean;
		used_ids: string[];
		undefined_used_ids: string[];
		default_fonts: Record<string, string>;
		default_font_refs: Record<string, string>;
		theme_fonts: Record<string, string>;
		default_size_half_points?: number;
		numbering_definitions: number;
		used_numbering_ids: string[];
	};
	warnings: string[];
}

type ZipEntry = JSZip.JSZipObject;
type SizedZipEntry = ZipEntry & { _data?: { uncompressedSize?: number } };

function usage(): string {
	return `
loeyae-aidlc docx — Word document inspection and conservative beautification

Usage:
  loeyae-aidlc docx inspect <input.docx> [--json]
  loeyae-aidlc docx beautify <input.docx> [--output <output.docx>] [options]
  loeyae-aidlc docx validate <output.docx> --against <input.docx> [--json]

Beautify options:
  --preset <name>       Built-in preset (default: professional-zh)
  --style-spec <json>   Strict allowlisted custom style specification
  --output <docx>       Required for writing; omitted only with --dry-run
  --dry-run             Report mappings and coverage without writing
  --force               Transactionally replace an existing regular output file
  --json                Emit a versioned machine-readable report

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

function assertInput(path: string): void {
	if (!existsSync(path)) throw new Error(`DOCX input does not exist: ${path}`);
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || !stat.isFile())
		throw new Error(`DOCX input must be a regular non-symlink file: ${path}`);
	if (stat.size === 0) throw new Error(`DOCX input is empty: ${path}`);
	if (stat.size > MAX_INPUT_BYTES)
		throw new Error(
			`DOCX input exceeds ${MAX_INPUT_BYTES / 1024 / 1024} MB: ${path}`,
		);
}

function zipEntrySize(entry: ZipEntry): number {
	if (entry.dir) return 0;
	const value = (entry as SizedZipEntry)._data?.uncompressedSize;
	if (!Number.isSafeInteger(value) || value === undefined || value < 0) {
		throw new Error(
			`DOCX ZIP entry has no trustworthy expanded size: ${entry.name}`,
		);
	}
	return value;
}

function unixMode(value: number | string | null): number | undefined {
	if (typeof value === "number") return value;
	if (typeof value === "string" && /^[0-7]+$/.test(value))
		return Number.parseInt(value, 8);
	return undefined;
}

function validateZipEntry(entry: ZipEntry): void {
	const original = entry.unsafeOriginalName || entry.name;
	const candidate = original.endsWith("/") ? original.slice(0, -1) : original;
	const segments = candidate.split("/");
	const unsafe =
		!candidate ||
		original.includes("\\") ||
		original.includes("\0") ||
		original.startsWith("/") ||
		/^[a-zA-Z]:/.test(original) ||
		segments.some(
			(segment) => segment === "" || segment === "." || segment === "..",
		);
	if (
		unsafe ||
		(entry.unsafeOriginalName !== undefined &&
			entry.unsafeOriginalName !== entry.name)
	) {
		throw new Error(`unsafe ZIP entry path: ${original}`);
	}
	const mode = unixMode(entry.unixPermissions);
	if (mode !== undefined && (mode & 0o170000) === 0o120000) {
		throw new Error(`DOCX ZIP contains a symbolic-link entry: ${original}`);
	}
}

function decodeXmlBuffer(data: Buffer, name: string): string {
	let text: string;
	if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
		text = data.subarray(2).toString("utf16le");
	} else if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
		const swapped = Buffer.from(data.subarray(2));
		for (let index = 0; index + 1 < swapped.length; index += 2) {
			const first = swapped[index];
			swapped[index] = swapped[index + 1];
			swapped[index + 1] = first;
		}
		text = swapped.toString("utf16le");
	} else {
		text = data.toString("utf8").replace(/^\uFEFF/, "");
	}
	if (/<!DOCTYPE\b|<!ENTITY\b/i.test(text))
		throw new Error(`unsafe XML declaration in ${name}`);
	return text;
}

async function readXml(
	zip: JSZip,
	name: string,
	required = false,
): Promise<string | undefined> {
	const entry = zip.file(name);
	if (!entry) {
		if (required)
			throw new Error(`DOCX package is missing required part: ${name}`);
		return undefined;
	}
	const expectedSize = zipEntrySize(entry);
	if (expectedSize > MAX_XML_BYTES)
		throw new Error(
			`DOCX XML part exceeds ${MAX_XML_BYTES / 1024 / 1024} MB: ${name}`,
		);
	const data = await entry.async("nodebuffer");
	if (data.length !== expectedSize)
		throw new Error(`DOCX ZIP entry size changed while reading: ${name}`);
	return decodeXmlBuffer(data, name);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function qname(localName: string): string {
	return `(?:[A-Za-z_][\\w.-]*:)?${escapeRegex(localName)}`;
}

function openingTags(xml: string | undefined, localName: string): string[] {
	if (!xml) return [];
	return [
		...xml.matchAll(new RegExp(`<${qname(localName)}(?=[\\s/>])[^>]*>`, "g")),
	].map((match) => match[0]);
}

function elementBlocks(xml: string | undefined, localName: string): string[] {
	if (!xml) return [];
	const name = qname(localName);
	return [
		...xml.matchAll(
			new RegExp(`<${name}(?=[\\s>])[^>]*>[\\s\\S]*?</${name}\\s*>`, "g"),
		),
	].map((match) => match[0]);
}

function countTags(xml: string | undefined, localName: string): number {
	return openingTags(xml, localName).length;
}

function decodeXml(value: string): string {
	return value
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#([0-9]+);/g, (_, decimal: string) =>
			String.fromCodePoint(Number.parseInt(decimal, 10)),
		)
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

function attribute(
	tag: string | undefined,
	localName: string,
): string | undefined {
	if (!tag) return undefined;
	const match = tag.match(
		new RegExp(`\\s${qname(localName)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`),
	);
	return match ? decodeXml(match[2]) : undefined;
}

function tagText(
	xml: string | undefined,
	localName: string,
): string | undefined {
	if (!xml) return undefined;
	const name = qname(localName);
	const match = xml.match(
		new RegExp(`<${name}(?=[\\s>])[^>]*>([\\s\\S]*?)</${name}\\s*>`),
	);
	if (!match) return undefined;
	return (
		decodeXml(match[1].replace(/<[^>]+>/g, ""))
			.trim()
			.slice(0, 4_096) || undefined
	);
}

function tagNumber(
	xml: string | undefined,
	localName: string,
): number | undefined {
	const value = tagText(xml, localName);
	if (!value || !/^\d+$/.test(value)) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function valuesForAttribute(
	xml: string | undefined,
	localName: string,
	attributeName: string,
): string[] {
	return openingTags(xml, localName)
		.map((tag) => attribute(tag, attributeName))
		.filter((value): value is string => Boolean(value));
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((left, right) =>
		left.localeCompare(right, "en"),
	);
}

function relationshipTarget(root: string, target: string): string {
	if (
		!target ||
		target.includes("\\") ||
		target.includes("\0") ||
		/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)
	) {
		throw new Error(
			`unsafe internal relationship target: ${target || "(empty)"}`,
		);
	}
	const withoutAnchor = target.split(/[?#]/, 1)[0];
	const joined = target.startsWith("/")
		? target.slice(1)
		: posix.join(root, withoutAnchor);
	const normalized = posix.normalize(joined);
	if (
		!normalized ||
		normalized === ".." ||
		normalized.startsWith("../") ||
		normalized.startsWith("/")
	) {
		throw new Error(`unsafe internal relationship target: ${target}`);
	}
	return normalized;
}

function themeFontSummary(
	themeXml: string | undefined,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const family of ["major", "minor"] as const) {
		const block = elementBlocks(themeXml, `${family}Font`)[0];
		for (const [key, elementName] of [
			["latin", "latin"],
			["east_asia", "ea"],
			["complex_script", "cs"],
		] as const) {
			const typeface = attribute(
				openingTags(block, elementName)[0],
				"typeface",
			);
			if (typeface !== undefined) result[`${family}_${key}`] = typeface;
		}
		for (const fontTag of openingTags(block, "font")) {
			const script = attribute(fontTag, "script");
			const typeface = attribute(fontTag, "typeface");
			if (script && typeface !== undefined)
				result[`${family}_script_${script}`] = typeface;
		}
	}
	return Object.fromEntries(
		Object.entries(result).sort(([left], [right]) =>
			left.localeCompare(right, "en"),
		),
	);
}

function styleSummary(
	stylesXml: string | undefined,
	documentXml: string,
	numberingXml: string | undefined,
	themeXml: string | undefined,
): InspectionReport["styles"] {
	const definitions = elementBlocks(stylesXml, "style")
		.map((block): StyleDefinition | undefined => {
			const opening = openingTags(block, "style")[0];
			const id = attribute(opening, "styleId");
			if (!id) return undefined;
			const name = attribute(openingTags(block, "name")[0], "val");
			return {
				id,
				type: attribute(opening, "type") || "unknown",
				name,
				default:
					attribute(opening, "default") === "1" ||
					attribute(opening, "default") === "true",
			};
		})
		.filter((value): value is StyleDefinition => value !== undefined);

	const byType: Record<string, number> = {};
	for (const definition of definitions)
		byType[definition.type] = (byType[definition.type] || 0) + 1;
	const sortedByType = Object.fromEntries(
		Object.entries(byType).sort(([left], [right]) =>
			left.localeCompare(right, "en"),
		),
	);
	const usedIds = uniqueSorted([
		...valuesForAttribute(documentXml, "pStyle", "val"),
		...valuesForAttribute(documentXml, "rStyle", "val"),
		...valuesForAttribute(documentXml, "tblStyle", "val"),
	]);
	const definedIds = new Set(definitions.map((definition) => definition.id));
	const fontsTag = openingTags(stylesXml, "rFonts")[0];
	const defaultFonts = Object.fromEntries(
		["ascii", "hAnsi", "eastAsia", "cs"]
			.map((name) => [name, attribute(fontsTag, name)] as const)
			.filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
	);
	const defaultFontRefs = Object.fromEntries(
		["asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"]
			.map((name) => [name, attribute(fontsTag, name)] as const)
			.filter(
				(entry): entry is readonly [string, string] => entry[1] !== undefined,
			),
	);
	const sizeValue = attribute(openingTags(stylesXml, "sz")[0], "val");
	const defaultSize =
		sizeValue && /^\d+$/.test(sizeValue) ? Number(sizeValue) : undefined;

	return {
		defined: definitions.length,
		by_type: sortedByType,
		definitions: definitions.slice(0, MAX_STYLE_DETAILS),
		definitions_truncated: definitions.length > MAX_STYLE_DETAILS,
		used_ids: usedIds,
		undefined_used_ids: usedIds.filter((id) => !definedIds.has(id)),
		default_fonts: defaultFonts,
		default_font_refs: defaultFontRefs,
		theme_fonts: themeFontSummary(themeXml),
		default_size_half_points: defaultSize,
		numbering_definitions: countTags(numberingXml, "abstractNum"),
		used_numbering_ids: uniqueSorted(
			valuesForAttribute(documentXml, "numId", "val"),
		),
	};
}

function noteCount(
	xml: string | undefined,
	localName: "footnote" | "endnote",
): number {
	return openingTags(xml, localName).filter((tag) => {
		const id = attribute(tag, "id");
		return id !== undefined && /^\d+$/.test(id) && Number(id) > 0;
	}).length;
}

function metadataSummary(
	coreXml: string | undefined,
	appXml: string | undefined,
): Record<string, string | number> {
	const metadata: Record<string, string | number> = {};
	const strings: Array<[string, string | undefined]> = [
		["title", tagText(coreXml, "title")],
		["subject", tagText(coreXml, "subject")],
		["creator", tagText(coreXml, "creator")],
		["last_modified_by", tagText(coreXml, "lastModifiedBy")],
		["created", tagText(coreXml, "created")],
		["modified", tagText(coreXml, "modified")],
		["application", tagText(appXml, "Application")],
	];
	for (const [key, value] of strings)
		if (value !== undefined) metadata[key] = value;
	const numbers: Array<[string, number | undefined]> = [
		["pages", tagNumber(appXml, "Pages")],
		["words", tagNumber(appXml, "Words")],
		["characters", tagNumber(appXml, "Characters")],
		["lines", tagNumber(appXml, "Lines")],
	];
	for (const [key, value] of numbers)
		if (value !== undefined) metadata[key] = value;
	return metadata;
}

export async function inspectDocx(input: string): Promise<InspectionReport> {
	assertInput(input);
	const inputData = readFileSync(input);
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(inputData);
	} catch (error) {
		throw new Error(
			`invalid DOCX ZIP package: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const entries = Object.values(zip.files);
	if (entries.length > MAX_ENTRIES)
		throw new Error(`DOCX ZIP contains more than ${MAX_ENTRIES} entries`);
	let expandedBytes = 0;
	for (const entry of entries) {
		validateZipEntry(entry);
		const size = zipEntrySize(entry);
		if (size > MAX_ENTRY_BYTES)
			throw new Error(
				`DOCX ZIP entry exceeds ${MAX_ENTRY_BYTES / 1024 / 1024} MB: ${entry.name}`,
			);
		expandedBytes += size;
		if (expandedBytes > MAX_EXPANDED_BYTES)
			throw new Error(
				`DOCX ZIP expands beyond ${MAX_EXPANDED_BYTES / 1024 / 1024} MB`,
			);
	}

	const names = entries
		.filter((entry) => !entry.dir)
		.map((entry) => entry.name);
	const lowerNames = names.map((name) => name.toLowerCase());
	if (
		lowerNames.some(
			(name) =>
				name === "word/vbaproject.bin" || name.endsWith("/vbaproject.bin"),
		)
	) {
		throw new Error("DOCX package contains macro-enabled content");
	}
	if (
		lowerNames.some(
			(name) =>
				name.startsWith("_xmlsignatures/") || name.includes("origin.sigs"),
		)
	) {
		throw new Error(
			"DOCX package contains digital signatures; read-only prototype refuses signed packages",
		);
	}

	const contentTypesXml = (await readXml(
		zip,
		"[Content_Types].xml",
		true,
	)) as string;
	if (/macroEnabled/i.test(contentTypesXml))
		throw new Error("DOCX package declares macro-enabled content");
	if (/digital-signature/i.test(contentTypesXml))
		throw new Error("DOCX package declares digital signatures");
	const rootRelsXml = (await readXml(zip, "_rels/.rels", true)) as string;
	const officeRelationship = openingTags(rootRelsXml, "Relationship").find(
		(tag) => attribute(tag, "Type")?.endsWith("/officeDocument"),
	);
	const officeTarget = attribute(officeRelationship, "Target");
	if (!officeTarget)
		throw new Error("DOCX package has no officeDocument relationship");
	const documentPart = relationshipTarget("", officeTarget);
	const documentXml = (await readXml(zip, documentPart, true)) as string;
	const mainOverride = openingTags(contentTypesXml, "Override").find(
		(tag) => attribute(tag, "PartName")?.replace(/^\//, "") === documentPart,
	);
	if (attribute(mainOverride, "ContentType") !== DOCX_MAIN_CONTENT_TYPE) {
		throw new Error(
			`DOCX main document has an unexpected content type: ${attribute(mainOverride, "ContentType") || "(missing)"}`,
		);
	}

	const documentRoot = posix.dirname(documentPart);
	const documentRelsPart = posix.join(
		documentRoot,
		"_rels",
		`${posix.basename(documentPart)}.rels`,
	);
	const documentRelsXml = await readXml(zip, documentRelsPart);
	const themeRelationship = openingTags(documentRelsXml, "Relationship").find(
		(tag) =>
			attribute(tag, "Type")?.endsWith("/theme") &&
			attribute(tag, "TargetMode")?.toLowerCase() !== "external",
	);
	const themeTarget = attribute(themeRelationship, "Target");
	const themeXml = themeTarget
		? await readXml(zip, relationshipTarget(documentRoot, themeTarget))
		: undefined;
	const stylesXml = await readXml(zip, posix.join(documentRoot, "styles.xml"));
	const numberingXml = await readXml(
		zip,
		posix.join(documentRoot, "numbering.xml"),
	);
	const commentsXml = await readXml(
		zip,
		posix.join(documentRoot, "comments.xml"),
	);
	const footnotesXml = await readXml(
		zip,
		posix.join(documentRoot, "footnotes.xml"),
	);
	const endnotesXml = await readXml(
		zip,
		posix.join(documentRoot, "endnotes.xml"),
	);
	const coreXml = await readXml(zip, "docProps/core.xml");
	const appXml = await readXml(zip, "docProps/app.xml");

	let relationshipCount = 0;
	let externalRelationshipCount = 0;
	const externalRelationshipTypes: string[] = [];
	for (const name of names.filter((entryName) => entryName.endsWith(".rels"))) {
		const xml =
			name === "_rels/.rels"
				? rootRelsXml
				: name === documentRelsPart
					? documentRelsXml
					: await readXml(zip, name);
		for (const tag of openingTags(xml, "Relationship")) {
			relationshipCount++;
			if (attribute(tag, "TargetMode")?.toLowerCase() === "external") {
				externalRelationshipCount++;
				const type = attribute(tag, "Type");
				if (type) externalRelationshipTypes.push(type.split("/").pop() || type);
			}
		}
	}

	const paragraphBlocks = elementBlocks(documentXml, "p");
	const paragraphTexts = paragraphBlocks.map((block) =>
		elementBlocks(block, "t")
			.map((text) => decodeXml(text.replace(/<[^>]+>/g, "")))
			.join(""),
	);
	const visibleText = paragraphTexts.join("\n");
	const mediaEntries = entries.filter(
		(entry) => !entry.dir && entry.name.startsWith(`${documentRoot}/media/`),
	);
	const embeddedObjects = names.filter((name) =>
		name.startsWith(`${documentRoot}/embeddings/`),
	).length;
	const trackedInsertions = countTags(documentXml, "ins");
	const trackedDeletions = countTags(documentXml, "del");
	const warnings: string[] = [];
	if (!stylesXml)
		warnings.push("word/styles.xml is missing; style inventory is unavailable");
	if (externalRelationshipCount)
		warnings.push(
			`${externalRelationshipCount} external relationship(s) are present; targets were not accessed`,
		);
	if (embeddedObjects)
		warnings.push(
			`${embeddedObjects} embedded object(s) are present and were not opened`,
		);
	if (trackedInsertions + trackedDeletions)
		warnings.push("tracked changes are present");
	if (commentsXml) warnings.push("comments are present");

	const report: InspectionReport = {
		schema_version: "1",
		input: {
			path: input,
			size_bytes: inputData.length,
			sha256: createHash("sha256").update(inputData).digest("hex"),
		},
		package: {
			entries: entries.length,
			files: entries.filter((entry) => !entry.dir).length,
			directories: entries.filter((entry) => entry.dir).length,
			uncompressed_bytes: expandedBytes,
			content_types:
				countTags(contentTypesXml, "Default") +
				countTags(contentTypesXml, "Override"),
			relationships: relationshipCount,
			external_relationships: externalRelationshipCount,
			external_relationship_types: uniqueSorted(externalRelationshipTypes),
			embedded_objects: embeddedObjects,
			has_macros: false,
			has_digital_signatures: false,
		},
		metadata: metadataSummary(coreXml, appXml),
		document: {
			paragraphs: paragraphBlocks.length,
			non_empty_paragraphs: paragraphBlocks.filter(
				(block, index) =>
					paragraphTexts[index].trim() ||
					countTags(block, "drawing") ||
					countTags(block, "pict"),
			).length,
			tables: countTags(documentXml, "tbl"),
			table_rows: countTags(documentXml, "tr"),
			table_cells: countTags(documentXml, "tc"),
			drawings:
				countTags(documentXml, "drawing") + countTags(documentXml, "pict"),
			media_files: mediaEntries.length,
			media_bytes: mediaEntries.reduce(
				(sum, entry) => sum + zipEntrySize(entry),
				0,
			),
			hyperlinks: countTags(documentXml, "hyperlink"),
			sections: countTags(documentXml, "sectPr"),
			page_breaks:
				openingTags(documentXml, "br").filter(
					(tag) => attribute(tag, "type") === "page",
				).length + countTags(documentXml, "lastRenderedPageBreak"),
			fields:
				countTags(documentXml, "fldSimple") +
				openingTags(documentXml, "fldChar").filter(
					(tag) => attribute(tag, "fldCharType") === "begin",
				).length,
			content_controls: countTags(documentXml, "sdt"),
			comments: countTags(commentsXml, "comment"),
			footnotes: noteCount(footnotesXml, "footnote"),
			endnotes: noteCount(endnotesXml, "endnote"),
			tracked_insertions: trackedInsertions,
			tracked_deletions: trackedDeletions,
			tracked_moves:
				countTags(documentXml, "moveFrom") + countTags(documentXml, "moveTo"),
			headers: names.filter((name) =>
				new RegExp(`^${escapeRegex(documentRoot)}/header\\d+\\.xml$`, "i").test(
					name,
				),
			).length,
			footers: names.filter((name) =>
				new RegExp(`^${escapeRegex(documentRoot)}/footer\\d+\\.xml$`, "i").test(
					name,
				),
			).length,
			text_characters: Array.from(visibleText).length,
			text_sha256: createHash("sha256").update(visibleText).digest("hex"),
		},
		styles: styleSummary(stylesXml, documentXml, numberingXml, themeXml),
		warnings,
	};
	return report;
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
	const options = parseDocxArgs(process.argv.slice(2));
	if (!options) {
		console.log(usage());
		return;
	}
	if (options.command === "inspect") {
		const report = await inspectDocx(options.input);
		if (options.json) console.log(JSON.stringify(report, null, 2));
		else printHuman(report);
		return;
	}
	const { beautifyDocx, validateDocxAgainst } = await import("./docx/beautify");
	if (options.command === "beautify") {
		const inspection = await inspectDocx(options.input);
		const report = await beautifyDocx(options, inspection, inspectDocx);
		if (options.json) console.log(JSON.stringify(report, null, 2));
		else printBeautifyHuman(report);
		return;
	}
	const outputInspection = await inspectDocx(options.output);
	const againstInspection = await inspectDocx(options.against);
	const report = await validateDocxAgainst(
		options.output,
		options.against,
		outputInspection,
		againstInspection,
	);
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
