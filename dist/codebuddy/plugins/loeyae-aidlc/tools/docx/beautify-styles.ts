import { createHash } from "node:crypto";
import type {
	MappingRole,
	StyleRole,
	StyleRule,
	StyleSpec,
	TableRule,
} from "./style-spec";
import {
	WORDPROCESSINGML_NS,
	createWordElement,
	directChild,
	directChildren,
	elements,
	ensureWordChild,
	parseXmlStrict,
	removeWordAttribute,
	serializeXml,
	setWordAttribute,
	wordAttribute,
} from "./xml";

const STYLE_ORDER = [
	"name",
	"aliases",
	"basedOn",
	"next",
	"link",
	"autoRedefine",
	"hidden",
	"uiPriority",
	"semiHidden",
	"unhideWhenUsed",
	"qFormat",
	"locked",
	"personal",
	"personalCompose",
	"personalReply",
	"rsid",
	"pPr",
	"rPr",
	"tblPr",
	"trPr",
	"tcPr",
	"tblStylePr",
] as const;
const RUN_ORDER = [
	"rStyle",
	"rFonts",
	"b",
	"bCs",
	"i",
	"iCs",
	"caps",
	"smallCaps",
	"strike",
	"dstrike",
	"outline",
	"shadow",
	"emboss",
	"imprint",
	"noProof",
	"snapToGrid",
	"vanish",
	"webHidden",
	"color",
	"spacing",
	"w",
	"kern",
	"position",
	"sz",
	"szCs",
	"highlight",
	"u",
	"effect",
	"bdr",
	"shd",
	"fitText",
	"vertAlign",
	"rtl",
	"cs",
	"em",
	"lang",
	"eastAsianLayout",
	"specVanish",
	"oMath",
	"rPrChange",
] as const;
const PARAGRAPH_ORDER = [
	"pStyle",
	"keepNext",
	"keepLines",
	"pageBreakBefore",
	"framePr",
	"widowControl",
	"numPr",
	"suppressLineNumbers",
	"pBdr",
	"shd",
	"tabs",
	"suppressAutoHyphens",
	"kinsoku",
	"wordWrap",
	"overflowPunct",
	"topLinePunct",
	"autoSpaceDE",
	"autoSpaceDN",
	"bidi",
	"adjustRightInd",
	"snapToGrid",
	"spacing",
	"ind",
	"contextualSpacing",
	"mirrorIndents",
	"suppressOverlap",
	"jc",
	"textDirection",
	"textAlignment",
	"textboxTightWrap",
	"outlineLvl",
	"divId",
	"cnfStyle",
	"rPr",
	"sectPr",
	"pPrChange",
] as const;
const TABLE_PROPERTY_ORDER = [
	"tblStyle",
	"tblpPr",
	"tblOverlap",
	"bidiVisual",
	"tblStyleRowBandSize",
	"tblStyleColBandSize",
	"tblW",
	"jc",
	"tblCellSpacing",
	"tblInd",
	"tblBorders",
	"shd",
	"tblLayout",
	"tblCellMar",
	"tblLook",
	"tblCaption",
	"tblDescription",
	"tblPrChange",
] as const;
const CELL_PROPERTY_ORDER = [
	"cnfStyle",
	"tcW",
	"gridSpan",
	"hMerge",
	"vMerge",
	"tcBorders",
	"shd",
	"noWrap",
	"tcMar",
	"textDirection",
	"tcFitText",
	"vAlign",
	"hideMark",
	"headers",
	"cellIns",
	"cellDel",
	"cellMerge",
	"tcPrChange",
] as const;
const BORDER_ORDER = [
	"top",
	"start",
	"left",
	"bottom",
	"end",
	"right",
	"insideH",
	"insideV",
] as const;
const MARGIN_ORDER = [
	"top",
	"start",
	"left",
	"bottom",
	"end",
	"right",
] as const;
const DOC_DEFAULTS_ORDER = ["rPrDefault", "pPrDefault"] as const;
const DEFAULT_PROPERTY_ORDER = ["rPr", "pPr"] as const;

const ROLE_ALIASES: Record<MappingRole, string[]> = {
	normal: ["normal", "bodytext", "body text", "正文", "标准"],
	title: ["title", "doctitle", "document title", "标题"],
	subtitle: ["subtitle", "sub title", "副标题"],
	heading1: ["heading1", "heading 1", "标题1", "标题 1", "一级标题"],
	heading2: ["heading2", "heading 2", "标题2", "标题 2", "二级标题"],
	heading3: ["heading3", "heading 3", "标题3", "标题 3", "三级标题"],
	heading4: ["heading4", "heading 4", "标题4", "标题 4", "四级标题"],
	quote: ["quote", "intensequote", "intense quote", "引用", "明显引用"],
	caption: ["caption", "题注"],
	hyperlink: ["hyperlink", "超链接"],
	table: ["tablegrid", "table grid", "网格型", "表格网格"],
};

const PARAGRAPH_VISUAL_PROPERTIES = new Set([
	"keepNext",
	"keepLines",
	"pageBreakBefore",
	"pBdr",
	"shd",
	"tabs",
	"spacing",
	"ind",
	"jc",
	"textDirection",
	"textAlignment",
	"outlineLvl",
]);
const RUN_VISUAL_PROPERTIES = new Set([
	"rFonts",
	"b",
	"bCs",
	"i",
	"iCs",
	"caps",
	"smallCaps",
	"strike",
	"dstrike",
	"color",
	"spacing",
	"sz",
	"szCs",
	"highlight",
	"u",
	"bdr",
	"shd",
	"vertAlign",
]);

interface StyleDefinition {
	id: string;
	type: string;
	name?: string;
	default: boolean;
	element: Element;
}

export interface StyleMapping {
	role: MappingRole;
	style_id: string;
	style_name?: string;
	style_type: string;
	matched_by: "explicit" | "default" | "style-id" | "style-name";
	used_count: number;
}

export interface CoverageReport {
	paragraphs_total: number;
	paragraphs_style_mapped: number;
	paragraphs_with_direct_visual_overrides: number;
	runs_total: number;
	runs_with_direct_visual_overrides: number;
	estimated_effective_paragraphs: number;
	estimated_effective_percent: number;
}

export interface StyleTransformation {
	stylesXml: string;
	stylesSha256: string;
	mappings: StyleMapping[];
	updatedRoles: MappingRole[];
	skippedRoles: MappingRole[];
	coverage: CoverageReport;
	warnings: string[];
}

function normalizeName(value: string | undefined): string {
	return (value || "")
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\s_\-./]+/g, "")
		.replace(/[（）()]/g, "");
}

function styleDefinitions(document: Document): StyleDefinition[] {
	return elements(document, WORDPROCESSINGML_NS, "style")
		.map((element): StyleDefinition | undefined => {
			const id = wordAttribute(element, "styleId");
			if (!id) return undefined;
			const name = wordAttribute(
				directChild(element, WORDPROCESSINGML_NS, "name"),
				"val",
			);
			return {
				id,
				type: wordAttribute(element, "type") || "unknown",
				name,
				default: ["1", "true", "on"].includes(
					(wordAttribute(element, "default") || "").toLowerCase(),
				),
				element,
			};
		})
		.filter((value): value is StyleDefinition => value !== undefined);
}

function expectedType(role: MappingRole): string {
	if (role === "table") return "table";
	if (role === "hyperlink") return "character";
	return "paragraph";
}

function styleUseCounts(document: Document): Map<string, number> {
	const counts = new Map<string, number>();
	for (const element of [
		...elements(document, WORDPROCESSINGML_NS, "pStyle"),
		...elements(document, WORDPROCESSINGML_NS, "rStyle"),
		...elements(document, WORDPROCESSINGML_NS, "tblStyle"),
	]) {
		const id = wordAttribute(element, "val");
		if (id) counts.set(id, (counts.get(id) || 0) + 1);
	}
	return counts;
}

function implicitDefaultParagraphUses(document: Document): number {
	return elements(document, WORDPROCESSINGML_NS, "p").filter((paragraph) => {
		const properties = directChild(paragraph, WORDPROCESSINGML_NS, "pPr");
		return !wordAttribute(
			properties
				? directChild(properties, WORDPROCESSINGML_NS, "pStyle")
				: undefined,
			"val",
		);
	}).length;
}

function selectCandidate(
	role: MappingRole,
	definitions: StyleDefinition[],
	useCounts: Map<string, number>,
	explicitId?: string,
): { definition?: StyleDefinition; matchedBy?: StyleMapping["matched_by"] } {
	const type = expectedType(role);
	if (explicitId) {
		const selected = definitions.find(
			(definition) => definition.id === explicitId && definition.type === type,
		);
		if (!selected) {
			throw new Error(
				`style_map.${role} references missing ${type} style: ${explicitId}`,
			);
		}
		return { definition: selected, matchedBy: "explicit" };
	}
	if (role === "normal") {
		const defaults = definitions.filter(
			(definition) => definition.type === "paragraph" && definition.default,
		);
		if (defaults.length === 1)
			return { definition: defaults[0], matchedBy: "default" };
		if (defaults.length > 1)
			throw new Error("DOCX contains multiple default paragraph styles");
	}
	const aliases = new Set(ROLE_ALIASES[role].map(normalizeName));
	const nameMatches = definitions.filter(
		(definition) =>
			definition.type === type && aliases.has(normalizeName(definition.name)),
	);
	const idMatches = definitions.filter(
		(definition) =>
			definition.type === type && aliases.has(normalizeName(definition.id)),
	);
	const candidates = nameMatches.length > 0 ? nameMatches : idMatches;
	const matchedBy: StyleMapping["matched_by"] =
		nameMatches.length > 0 ? "style-name" : "style-id";
	if (candidates.length === 0) return {};
	if (candidates.length === 1)
		return {
			definition: candidates[0],
			matchedBy,
		};
	const ranked = candidates
		.map((definition) => ({
			definition,
			uses: useCounts.get(definition.id) || 0,
		}))
		.sort((left, right) => right.uses - left.uses);
	if (ranked[0].uses > ranked[1].uses) {
		return {
			definition: ranked[0].definition,
			matchedBy,
		};
	}
	if (ranked[0].uses === 0) return {};
	throw new Error(
		`DOCX style role ${role} is ambiguous: ${candidates.map((entry) => entry.id).join(", ")}`,
	);
}

function directVisualParagraphOverride(paragraph: Element): boolean {
	const properties = directChild(paragraph, WORDPROCESSINGML_NS, "pPr");
	if (
		properties &&
		directChildren(properties).some(
			(child) =>
				child.namespaceURI === WORDPROCESSINGML_NS &&
				PARAGRAPH_VISUAL_PROPERTIES.has(child.localName),
		)
	) {
		return true;
	}
	return elements(paragraph, WORDPROCESSINGML_NS, "r").some((run) =>
		directRunVisualOverride(run),
	);
}

function directRunVisualOverride(run: Element): boolean {
	const properties = directChild(run, WORDPROCESSINGML_NS, "rPr");
	return Boolean(
		properties &&
			directChildren(properties).some(
				(child) =>
					child.namespaceURI === WORDPROCESSINGML_NS &&
					RUN_VISUAL_PROPERTIES.has(child.localName),
			),
	);
}

function coverageReport(
	document: Document,
	mappings: StyleMapping[],
): CoverageReport {
	const roleByStyle = new Map(
		mappings
			.filter((mapping) => mapping.style_type === "paragraph")
			.map((mapping) => [mapping.style_id, mapping.role]),
	);
	const normal = mappings.find((mapping) => mapping.role === "normal");
	const paragraphs = elements(document, WORDPROCESSINGML_NS, "p");
	let mapped = 0;
	let directOverrides = 0;
	let effective = 0;
	for (const paragraph of paragraphs) {
		const properties = directChild(paragraph, WORDPROCESSINGML_NS, "pPr");
		const styleId = wordAttribute(
			properties
				? directChild(properties, WORDPROCESSINGML_NS, "pStyle")
				: undefined,
			"val",
		);
		const isMapped = styleId ? roleByStyle.has(styleId) : normal !== undefined;
		const hasDirectOverride = directVisualParagraphOverride(paragraph);
		if (isMapped) mapped++;
		if (hasDirectOverride) directOverrides++;
		if (isMapped && !hasDirectOverride) effective++;
	}
	const runs = elements(document, WORDPROCESSINGML_NS, "r");
	const runOverrides = runs.filter(directRunVisualOverride).length;
	return {
		paragraphs_total: paragraphs.length,
		paragraphs_style_mapped: mapped,
		paragraphs_with_direct_visual_overrides: directOverrides,
		runs_total: runs.length,
		runs_with_direct_visual_overrides: runOverrides,
		estimated_effective_paragraphs: effective,
		estimated_effective_percent:
			paragraphs.length === 0
				? 0
				: Math.round((effective / paragraphs.length) * 10_000) / 100,
	};
}

function setValueChild(
	parent: Element,
	localName: string,
	value: string,
	order: readonly string[],
): Element {
	const child = ensureWordChild(parent, localName, order);
	setWordAttribute(child, "val", value);
	return child;
}

function setBooleanChild(
	parent: Element,
	localName: string,
	value: boolean,
	order: readonly string[],
): void {
	setValueChild(parent, localName, value ? "1" : "0", order);
}

function applyRunRule(
	properties: Element,
	rule: StyleRule,
	fonts: StyleSpec["fonts"],
): void {
	const font = ensureWordChild(properties, "rFonts", RUN_ORDER);
	setWordAttribute(font, "ascii", fonts.latin);
	setWordAttribute(font, "hAnsi", fonts.latin);
	setWordAttribute(font, "eastAsia", fonts.east_asia);
	setWordAttribute(font, "cs", fonts.latin);
	for (const attribute of [
		"asciiTheme",
		"hAnsiTheme",
		"eastAsiaTheme",
		"cstheme",
	]) {
		removeWordAttribute(font, attribute);
	}
	if (rule.size_pt !== undefined) {
		const halfPoints = String(Math.round(rule.size_pt * 2));
		setValueChild(properties, "sz", halfPoints, RUN_ORDER);
		setValueChild(properties, "szCs", halfPoints, RUN_ORDER);
	}
	if (rule.color !== undefined)
		setValueChild(properties, "color", rule.color, RUN_ORDER);
	if (rule.bold !== undefined)
		setBooleanChild(properties, "b", rule.bold, RUN_ORDER);
	if (rule.italic !== undefined)
		setBooleanChild(properties, "i", rule.italic, RUN_ORDER);
	if (rule.underline !== undefined)
		setValueChild(
			properties,
			"u",
			rule.underline ? "single" : "none",
			RUN_ORDER,
		);
}

function applyParagraphRule(properties: Element, rule: StyleRule): void {
	if (rule.keep_next !== undefined)
		setBooleanChild(properties, "keepNext", rule.keep_next, PARAGRAPH_ORDER);
	if (rule.keep_lines !== undefined)
		setBooleanChild(properties, "keepLines", rule.keep_lines, PARAGRAPH_ORDER);
	if (
		rule.line_spacing !== undefined ||
		rule.space_before_pt !== undefined ||
		rule.space_after_pt !== undefined
	) {
		const spacing = ensureWordChild(properties, "spacing", PARAGRAPH_ORDER);
		if (rule.line_spacing !== undefined) {
			setWordAttribute(
				spacing,
				"line",
				String(Math.round(rule.line_spacing * 240)),
			);
			setWordAttribute(spacing, "lineRule", "auto");
		}
		if (rule.space_before_pt !== undefined)
			setWordAttribute(
				spacing,
				"before",
				String(Math.round(rule.space_before_pt * 20)),
			);
		if (rule.space_after_pt !== undefined)
			setWordAttribute(
				spacing,
				"after",
				String(Math.round(rule.space_after_pt * 20)),
			);
	}
	if (rule.outline_level !== undefined)
		setValueChild(
			properties,
			"outlineLvl",
			String(rule.outline_level),
			PARAGRAPH_ORDER,
		);
}

function applyStyleRule(
	definition: StyleDefinition,
	rule: StyleRule,
	fonts: StyleSpec["fonts"],
): void {
	const runProperties = ensureWordChild(definition.element, "rPr", STYLE_ORDER);
	applyRunRule(runProperties, rule, fonts);
	if (definition.type === "paragraph") {
		const paragraphProperties = ensureWordChild(
			definition.element,
			"pPr",
			STYLE_ORDER,
		);
		applyParagraphRule(paragraphProperties, rule);
	}
}

function applyDocDefaults(
	stylesRoot: Element,
	rule: StyleRule | undefined,
	fonts: StyleSpec["fonts"],
): void {
	const docDefaults = ensureWordChild(stylesRoot, "docDefaults", [
		"docDefaults",
		"latentStyles",
		"style",
	]);
	const runDefault = ensureWordChild(
		docDefaults,
		"rPrDefault",
		DOC_DEFAULTS_ORDER,
	);
	const runProperties = ensureWordChild(
		runDefault,
		"rPr",
		DEFAULT_PROPERTY_ORDER,
	);
	applyRunRule(runProperties, rule || {}, fonts);
	if (rule) {
		const paragraphDefault = ensureWordChild(
			docDefaults,
			"pPrDefault",
			DOC_DEFAULTS_ORDER,
		);
		const paragraphProperties = ensureWordChild(
			paragraphDefault,
			"pPr",
			DEFAULT_PROPERTY_ORDER,
		);
		applyParagraphRule(paragraphProperties, rule);
	}
}

function border(parent: Element, name: string, rule: TableRule): void {
	const entry = ensureWordChild(parent, name, BORDER_ORDER);
	setWordAttribute(entry, "val", "single");
	setWordAttribute(entry, "sz", String(rule.border_size || 4));
	setWordAttribute(entry, "space", "0");
	setWordAttribute(entry, "color", rule.border_color || "B4C6E7");
}

function applyTableRule(
	definition: StyleDefinition,
	rule: TableRule,
	fonts: StyleSpec["fonts"],
): void {
	const tableProperties = ensureWordChild(
		definition.element,
		"tblPr",
		STYLE_ORDER,
	);
	if (rule.border_color !== undefined || rule.border_size !== undefined) {
		const borders = ensureWordChild(
			tableProperties,
			"tblBorders",
			TABLE_PROPERTY_ORDER,
		);
		for (const name of ["top", "start", "bottom", "end", "insideH", "insideV"])
			border(borders, name, rule);
	}
	if (rule.cell_margin_twips !== undefined) {
		const margins = ensureWordChild(
			tableProperties,
			"tblCellMar",
			TABLE_PROPERTY_ORDER,
		);
		for (const name of ["top", "start", "bottom", "end"]) {
			const margin = ensureWordChild(margins, name, MARGIN_ORDER);
			setWordAttribute(margin, "w", String(rule.cell_margin_twips));
			setWordAttribute(margin, "type", "dxa");
		}
	}
	let firstRow = directChildren(definition.element).find(
		(child) =>
			child.namespaceURI === WORDPROCESSINGML_NS &&
			child.localName === "tblStylePr" &&
			wordAttribute(child, "type") === "firstRow",
	);
	if (!firstRow) {
		firstRow = createWordElement(definition.element, "tblStylePr");
		definition.element.appendChild(firstRow);
		setWordAttribute(firstRow, "type", "firstRow");
	}
	const runProperties = ensureWordChild(firstRow, "rPr", STYLE_ORDER);
	applyRunRule(
		runProperties,
		{
			bold: rule.header_bold,
			color: rule.header_text_color,
		},
		fonts,
	);
	if (rule.header_fill !== undefined) {
		const cellProperties = ensureWordChild(firstRow, "tcPr", STYLE_ORDER);
		const shading = ensureWordChild(cellProperties, "shd", CELL_PROPERTY_ORDER);
		setWordAttribute(shading, "val", "clear");
		setWordAttribute(shading, "color", "auto");
		setWordAttribute(shading, "fill", rule.header_fill);
	}
}

function configuredRoles(spec: StyleSpec): MappingRole[] {
	const roles: MappingRole[] = Object.keys(spec.styles) as StyleRole[];
	if (spec.table) roles.push("table");
	return roles;
}

export function transformStyles(
	documentXml: string,
	stylesXml: string,
	stylesPart: string,
	spec: StyleSpec,
): StyleTransformation {
	const document = parseXmlStrict(documentXml, "DOCX main document");
	const stylesDocument = parseXmlStrict(stylesXml, stylesPart);
	const stylesRoot = stylesDocument.documentElement;
	if (
		stylesRoot.namespaceURI !== WORDPROCESSINGML_NS ||
		stylesRoot.localName !== "styles"
	) {
		throw new Error(
			`DOCX styles part has an unexpected root element: ${stylesPart}`,
		);
	}
	const definitions = styleDefinitions(stylesDocument);
	const useCounts = styleUseCounts(document);
	const implicitNormalUses = implicitDefaultParagraphUses(document);
	const mappings: StyleMapping[] = [];
	const selectedDefinitions = new Map<MappingRole, StyleDefinition>();
	const skippedRoles: MappingRole[] = [];
	for (const role of configuredRoles(spec)) {
		const selected = selectCandidate(
			role,
			definitions,
			useCounts,
			spec.style_map?.[role],
		);
		if (!selected.definition || !selected.matchedBy) {
			skippedRoles.push(role);
			continue;
		}
		selectedDefinitions.set(role, selected.definition);
		mappings.push({
			role,
			style_id: selected.definition.id,
			style_name: selected.definition.name,
			style_type: selected.definition.type,
			matched_by: selected.matchedBy,
			used_count:
				(useCounts.get(selected.definition.id) || 0) +
				(role === "normal" && selected.definition.default
					? implicitNormalUses
					: 0),
		});
	}
	if (mappings.length === 0)
		throw new Error(
			"DOCX contains no styles matching the requested style spec",
		);
	const coverage = coverageReport(document, mappings);
	applyDocDefaults(stylesRoot, spec.styles.normal, spec.fonts);
	for (const [role, definition] of selectedDefinitions) {
		if (role === "table") {
			if (spec.table) applyTableRule(definition, spec.table, spec.fonts);
			continue;
		}
		const rule = spec.styles[role];
		if (rule) applyStyleRule(definition, rule, spec.fonts);
	}
	const transformed = serializeXml(stylesDocument);
	parseXmlStrict(transformed, `transformed ${stylesPart}`);
	const warnings: string[] = [];
	if (coverage.paragraphs_with_direct_visual_overrides > 0) {
		warnings.push(
			`${coverage.paragraphs_with_direct_visual_overrides} paragraph(s) contain direct formatting that conservative mode preserves`,
		);
	}
	if (skippedRoles.length > 0) {
		warnings.push(`unmatched style role(s): ${skippedRoles.join(", ")}`);
	}
	return {
		stylesXml: transformed,
		stylesSha256: createHash("sha256").update(transformed).digest("hex"),
		mappings,
		updatedRoles: mappings.map((mapping) => mapping.role),
		skippedRoles,
		coverage,
		warnings,
	};
}
