import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const MAX_SPEC_BYTES = 256 * 1024;

export const STYLE_ROLES = [
	"normal",
	"title",
	"subtitle",
	"heading1",
	"heading2",
	"heading3",
	"heading4",
	"quote",
	"caption",
	"hyperlink",
] as const;
export type StyleRole = (typeof STYLE_ROLES)[number];
export type MappingRole = StyleRole | "table";

export interface StyleRule {
	size_pt?: number;
	color?: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	line_spacing?: number;
	space_before_pt?: number;
	space_after_pt?: number;
	keep_next?: boolean;
	keep_lines?: boolean;
	outline_level?: number;
}

export interface TableRule {
	border_color?: string;
	border_size?: number;
	header_fill?: string;
	header_text_color?: string;
	cell_margin_twips?: number;
	header_bold?: boolean;
}

export interface StyleSpec {
	schema_version: "1";
	id: string;
	fonts: {
		latin: string;
		east_asia: string;
	};
	style_map?: Partial<Record<MappingRole, string>>;
	styles: Partial<Record<StyleRole, StyleRule>>;
	table?: TableRule;
}

const PROFESSIONAL_ZH: StyleSpec = {
	schema_version: "1",
	id: "professional-zh",
	fonts: {
		latin: "Aptos",
		east_asia: "Microsoft YaHei",
	},
	styles: {
		normal: {
			size_pt: 10.5,
			color: "262626",
			line_spacing: 1.5,
			space_after_pt: 6,
		},
		title: {
			size_pt: 26,
			color: "17365D",
			bold: true,
			space_after_pt: 18,
			keep_next: true,
			keep_lines: true,
		},
		subtitle: {
			size_pt: 13,
			color: "5B6573",
			space_after_pt: 12,
			keep_next: true,
		},
		heading1: {
			size_pt: 18,
			color: "17365D",
			bold: true,
			space_before_pt: 18,
			space_after_pt: 8,
			keep_next: true,
			keep_lines: true,
			outline_level: 0,
		},
		heading2: {
			size_pt: 15,
			color: "1F4E78",
			bold: true,
			space_before_pt: 14,
			space_after_pt: 6,
			keep_next: true,
			keep_lines: true,
			outline_level: 1,
		},
		heading3: {
			size_pt: 12,
			color: "2F5597",
			bold: true,
			space_before_pt: 10,
			space_after_pt: 4,
			keep_next: true,
			outline_level: 2,
		},
		heading4: {
			size_pt: 11,
			color: "3F3F3F",
			bold: true,
			space_before_pt: 8,
			space_after_pt: 4,
			keep_next: true,
			outline_level: 3,
		},
		quote: {
			size_pt: 10.5,
			color: "595959",
			italic: true,
			space_before_pt: 6,
			space_after_pt: 6,
		},
		caption: {
			size_pt: 9,
			color: "666666",
			italic: true,
			space_before_pt: 3,
			space_after_pt: 6,
		},
		hyperlink: {
			color: "0563C1",
			underline: true,
		},
	},
	table: {
		border_color: "B4C6E7",
		border_size: 4,
		header_fill: "D9EAF7",
		header_text_color: "17365D",
		cell_margin_twips: 100,
		header_bold: true,
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownFields(
	value: Record<string, unknown>,
	allowed: readonly string[],
	label: string,
): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key))
			throw new Error(`unknown ${label} field: ${key}`);
	}
}

function stringValue(
	value: unknown,
	label: string,
	maximumLength = 120,
): string {
	const hasControlCharacter = [
		...(typeof value === "string" ? value : ""),
	].some((character) => {
		const code = character.charCodeAt(0);
		return code <= 0x1f || code === 0x7f;
	});
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.length > maximumLength ||
		hasControlCharacter
	) {
		throw new Error(`${label} must be a non-empty safe string`);
	}
	return value.trim();
}

function numberValue(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${label} must be a finite number`);
	}
	if (value < minimum || value > maximum) {
		throw new Error(`${label} must be between ${minimum} and ${maximum}`);
	}
	return value;
}

function booleanValue(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
	return value;
}

function colorValue(value: unknown, label: string): string {
	const color = stringValue(value, label, 6).toUpperCase();
	if (!/^[0-9A-F]{6}$/.test(color)) {
		throw new Error(`${label} must be a six-digit hexadecimal color`);
	}
	return color;
}

function parseStyleRule(value: unknown, label: string): StyleRule {
	if (!isRecord(value)) throw new Error(`${label} must be an object`);
	assertKnownFields(
		value,
		[
			"size_pt",
			"color",
			"bold",
			"italic",
			"underline",
			"line_spacing",
			"space_before_pt",
			"space_after_pt",
			"keep_next",
			"keep_lines",
			"outline_level",
		],
		"style rule",
	);
	const rule: StyleRule = {};
	if (value.size_pt !== undefined)
		rule.size_pt = numberValue(value.size_pt, `${label}.size_pt`, 6, 72);
	if (value.color !== undefined)
		rule.color = colorValue(value.color, `${label}.color`);
	for (const key of [
		"bold",
		"italic",
		"underline",
		"keep_next",
		"keep_lines",
	] as const) {
		if (value[key] !== undefined)
			rule[key] = booleanValue(value[key], `${label}.${key}`);
	}
	if (value.line_spacing !== undefined)
		rule.line_spacing = numberValue(
			value.line_spacing,
			`${label}.line_spacing`,
			0.8,
			3,
		);
	if (value.space_before_pt !== undefined)
		rule.space_before_pt = numberValue(
			value.space_before_pt,
			`${label}.space_before_pt`,
			0,
			72,
		);
	if (value.space_after_pt !== undefined)
		rule.space_after_pt = numberValue(
			value.space_after_pt,
			`${label}.space_after_pt`,
			0,
			72,
		);
	if (value.outline_level !== undefined) {
		const level = numberValue(
			value.outline_level,
			`${label}.outline_level`,
			0,
			8,
		);
		if (!Number.isInteger(level))
			throw new Error(`${label}.outline_level must be an integer`);
		rule.outline_level = level;
	}
	if (Object.keys(rule).length === 0)
		throw new Error(`${label} must declare at least one style property`);
	return rule;
}

function parseTableRule(value: unknown): TableRule {
	if (!isRecord(value)) throw new Error("table must be an object");
	assertKnownFields(
		value,
		[
			"border_color",
			"border_size",
			"header_fill",
			"header_text_color",
			"cell_margin_twips",
			"header_bold",
		],
		"table rule",
	);
	const rule: TableRule = {};
	if (value.border_color !== undefined)
		rule.border_color = colorValue(value.border_color, "table.border_color");
	if (value.border_size !== undefined) {
		const size = numberValue(value.border_size, "table.border_size", 1, 96);
		if (!Number.isInteger(size))
			throw new Error("table.border_size must be an integer");
		rule.border_size = size;
	}
	if (value.header_fill !== undefined)
		rule.header_fill = colorValue(value.header_fill, "table.header_fill");
	if (value.header_text_color !== undefined)
		rule.header_text_color = colorValue(
			value.header_text_color,
			"table.header_text_color",
		);
	if (value.cell_margin_twips !== undefined) {
		const margin = numberValue(
			value.cell_margin_twips,
			"table.cell_margin_twips",
			0,
			1440,
		);
		if (!Number.isInteger(margin))
			throw new Error("table.cell_margin_twips must be an integer");
		rule.cell_margin_twips = margin;
	}
	if (value.header_bold !== undefined)
		rule.header_bold = booleanValue(value.header_bold, "table.header_bold");
	if (Object.keys(rule).length === 0)
		throw new Error("table must declare at least one property");
	return rule;
}

export function parseStyleSpec(value: unknown): StyleSpec {
	if (!isRecord(value)) throw new Error("style spec must be a JSON object");
	assertKnownFields(
		value,
		["schema_version", "id", "fonts", "style_map", "styles", "table"],
		"style spec",
	);
	if (value.schema_version !== "1")
		throw new Error('style spec schema_version must be "1"');
	const id = stringValue(value.id, "style spec id", 80);
	if (!isRecord(value.fonts)) throw new Error("fonts must be an object");
	assertKnownFields(value.fonts, ["latin", "east_asia"], "fonts");
	const fonts = {
		latin: stringValue(value.fonts.latin, "fonts.latin"),
		east_asia: stringValue(value.fonts.east_asia, "fonts.east_asia"),
	};
	if (!isRecord(value.styles)) throw new Error("styles must be an object");
	assertKnownFields(value.styles, STYLE_ROLES, "styles");
	const styles: Partial<Record<StyleRole, StyleRule>> = {};
	for (const role of STYLE_ROLES) {
		if (value.styles[role] !== undefined)
			styles[role] = parseStyleRule(value.styles[role], `styles.${role}`);
	}
	if (Object.keys(styles).length === 0 && value.table === undefined) {
		throw new Error("style spec must declare at least one style or table rule");
	}
	let styleMap: Partial<Record<MappingRole, string>> | undefined;
	if (value.style_map !== undefined) {
		if (!isRecord(value.style_map))
			throw new Error("style_map must be an object");
		assertKnownFields(value.style_map, [...STYLE_ROLES, "table"], "style_map");
		styleMap = {};
		for (const role of [...STYLE_ROLES, "table"] as MappingRole[]) {
			if (value.style_map[role] !== undefined) {
				styleMap[role] = stringValue(
					value.style_map[role],
					`style_map.${role}`,
					120,
				);
			}
		}
	}
	return {
		schema_version: "1",
		id,
		fonts,
		style_map: styleMap,
		styles,
		table: value.table === undefined ? undefined : parseTableRule(value.table),
	};
}

export function loadStyleSpec(
	preset: string | undefined,
	styleSpecPath: string | undefined,
): StyleSpec {
	if (preset && styleSpecPath)
		throw new Error("--preset and --style-spec are mutually exclusive");
	if (styleSpecPath) {
		const path = resolve(styleSpecPath);
		if (extname(path).toLowerCase() !== ".json")
			throw new Error("--style-spec path must end with .json");
		if (!existsSync(path))
			throw new Error(`style spec does not exist: ${path}`);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink() || !stat.isFile())
			throw new Error(`style spec must be a regular non-symlink file: ${path}`);
		if (stat.size === 0 || stat.size > MAX_SPEC_BYTES)
			throw new Error(
				`style spec must be between 1 byte and ${MAX_SPEC_BYTES} bytes`,
			);
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			throw new Error(
				`invalid style spec JSON: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		return parseStyleSpec(parsed);
	}
	const selected = preset || "professional-zh";
	if (selected !== "professional-zh")
		throw new Error(`unknown DOCX preset: ${selected}`);
	return parseStyleSpec(JSON.parse(JSON.stringify(PROFESSIONAL_ZH)));
}

function canonical(value: unknown): string {
	if (value === null || typeof value === "number" || typeof value === "boolean")
		return JSON.stringify(value);
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.filter((key) => value[key] !== undefined)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`;
	}
	throw new Error("style spec contains an unsupported value");
}

export function styleSpecDigest(spec: StyleSpec): string {
	return createHash("sha256").update(canonical(spec)).digest("hex");
}
