import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import JSZip from "jszip";
import {
	RELATIONSHIPS_NS,
	WORDPROCESSINGML_NS,
	elements,
	parseXmlStrict,
	wordAttribute,
} from "./xml";

export interface LoadedEditableDocx {
	input: string;
	inputData: Buffer;
	inputSha256: string;
	zip: JSZip;
	documentPart: string;
	documentRelsPart: string;
	documentXml: string;
	stylesPart: string;
	stylesXml: string;
	settingsPart?: string;
	settingsXml?: string;
}

export interface PackageSnapshot {
	partNames: string[];
	partHashes: Record<string, string>;
}

export interface InvariantSummary {
	part_set: "unchanged";
	non_style_parts: "byte-identical";
	document_xml: "byte-identical";
	relationships: "byte-identical";
	text: "unchanged";
	media: "unchanged";
	comments_and_revisions: "unchanged";
}

export interface OutputArtifact {
	path: string;
	size_bytes: number;
	sha256: string;
}

interface FileState {
	dev: number;
	ino: number;
	size: number;
	mtimeMs: number;
	sha256: string;
}

function sha256(data: Buffer): string {
	return createHash("sha256").update(data).digest("hex");
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
	if (/<!DOCTYPE\b|<!ENTITY\b/i.test(text)) {
		throw new Error(`unsafe XML declaration in ${name}`);
	}
	return text;
}

async function xmlPart(
	zip: JSZip,
	name: string,
	required = true,
): Promise<string | undefined> {
	const entry = zip.file(name);
	if (!entry) {
		if (required)
			throw new Error(`DOCX package is missing required part: ${name}`);
		return undefined;
	}
	return decodeXmlBuffer(await entry.async("nodebuffer"), name);
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

function relationshipByType(
	xml: string,
	label: string,
	typeSuffix: string,
): Element | undefined {
	const document = parseXmlStrict(xml, label);
	return elements(document, RELATIONSHIPS_NS, "Relationship").find((entry) =>
		(entry.getAttribute("Type") || "").endsWith(typeSuffix),
	);
}

function relationshipPart(documentPart: string): string {
	return posix.join(
		posix.dirname(documentPart),
		"_rels",
		`${posix.basename(documentPart)}.rels`,
	);
}

function assertNoEnforcedProtection(
	settingsXml: string | undefined,
	label: string,
): void {
	if (!settingsXml) return;
	const document = parseXmlStrict(settingsXml, label);
	const protection = elements(
		document,
		WORDPROCESSINGML_NS,
		"documentProtection",
	)[0];
	const enforcement = wordAttribute(protection, "enforcement")?.toLowerCase();
	if (enforcement && !["0", "false", "off"].includes(enforcement)) {
		throw new Error(
			"DOCX document protection is enforced; beautify refuses to modify it",
		);
	}
}

export async function loadEditableDocx(
	input: string,
	expectedSha256: string,
): Promise<LoadedEditableDocx> {
	const resolvedInput = resolve(input);
	const inputData = readFileSync(resolvedInput);
	const inputSha256 = sha256(inputData);
	if (inputSha256 !== expectedSha256) {
		throw new Error("DOCX input changed after inspection; retry the command");
	}
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(inputData);
	} catch (error) {
		throw new Error(
			`invalid DOCX ZIP package: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const rootRelsXml = (await xmlPart(zip, "_rels/.rels")) as string;
	const officeRelationship = relationshipByType(
		rootRelsXml,
		"_rels/.rels",
		"/officeDocument",
	);
	const officeTarget = officeRelationship?.getAttribute("Target");
	if (!officeTarget)
		throw new Error("DOCX package has no officeDocument relationship");
	if (
		officeRelationship?.getAttribute("TargetMode")?.toLowerCase() === "external"
	) {
		throw new Error("DOCX officeDocument relationship cannot be external");
	}
	const documentPart = relationshipTarget("", officeTarget);
	const documentXml = (await xmlPart(zip, documentPart)) as string;
	const documentRelsPart = relationshipPart(documentPart);
	const documentRelsXml = (await xmlPart(zip, documentRelsPart)) as string;
	const stylesRelationship = relationshipByType(
		documentRelsXml,
		documentRelsPart,
		"/styles",
	);
	if (!stylesRelationship) {
		throw new Error(
			"DOCX document has no styles relationship; conservative beautify cannot continue",
		);
	}
	if (
		stylesRelationship.getAttribute("TargetMode")?.toLowerCase() === "external"
	) {
		throw new Error("DOCX styles relationship cannot be external");
	}
	const stylesTarget = stylesRelationship.getAttribute("Target");
	if (!stylesTarget) throw new Error("DOCX styles relationship has no target");
	const documentRoot = posix.dirname(documentPart);
	const stylesPart = relationshipTarget(documentRoot, stylesTarget);
	const stylesXml = (await xmlPart(zip, stylesPart)) as string;
	const settingsRelationship = relationshipByType(
		documentRelsXml,
		documentRelsPart,
		"/settings",
	);
	let settingsPart: string | undefined;
	let settingsXml: string | undefined;
	if (settingsRelationship) {
		if (
			settingsRelationship.getAttribute("TargetMode")?.toLowerCase() ===
			"external"
		) {
			throw new Error("DOCX settings relationship cannot be external");
		}
		const target = settingsRelationship.getAttribute("Target");
		if (!target) throw new Error("DOCX settings relationship has no target");
		settingsPart = relationshipTarget(documentRoot, target);
		settingsXml = await xmlPart(zip, settingsPart);
		assertNoEnforcedProtection(settingsXml, settingsPart);
	}
	return {
		input: resolvedInput,
		inputData,
		inputSha256,
		zip,
		documentPart,
		documentRelsPart,
		documentXml,
		stylesPart,
		stylesXml,
		settingsPart,
		settingsXml,
	};
}

export async function snapshotPackage(zip: JSZip): Promise<PackageSnapshot> {
	const partNames = Object.values(zip.files)
		.filter((entry) => !entry.dir)
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right, "en"));
	const partHashes: Record<string, string> = {};
	for (const name of partNames) {
		const entry = zip.file(name);
		if (!entry) throw new Error(`DOCX package part disappeared: ${name}`);
		partHashes[name] = sha256(await entry.async("nodebuffer"));
	}
	return { partNames, partHashes };
}

export async function generateStyledPackage(
	loaded: LoadedEditableDocx,
	stylesXml: string,
): Promise<Buffer> {
	const stylesEntry = loaded.zip.file(loaded.stylesPart);
	if (!stylesEntry)
		throw new Error(`DOCX styles part disappeared: ${loaded.stylesPart}`);
	loaded.zip.file(loaded.stylesPart, stylesXml, {
		date: stylesEntry.date,
		createFolders: false,
	});
	return loaded.zip.generateAsync({
		type: "nodebuffer",
		compression: "DEFLATE",
		compressionOptions: { level: 6 },
		platform: "UNIX",
	});
}

export async function validateStyleOnlyBuffer(
	inputSnapshot: PackageSnapshot,
	outputData: Buffer,
	stylesPart: string,
	requireStyleChange: boolean,
): Promise<{ changedParts: string[]; invariants: InvariantSummary }> {
	let outputZip: JSZip;
	try {
		outputZip = await JSZip.loadAsync(outputData);
	} catch (error) {
		throw new Error(
			`DOCX invariant failed: output is not a valid ZIP package: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const outputSnapshot = await snapshotPackage(outputZip);
	if (
		inputSnapshot.partNames.length !== outputSnapshot.partNames.length ||
		inputSnapshot.partNames.some(
			(name, index) => name !== outputSnapshot.partNames[index],
		)
	) {
		throw new Error("DOCX invariant failed: package part set changed");
	}
	const changedParts = inputSnapshot.partNames.filter(
		(name) =>
			inputSnapshot.partHashes[name] !== outputSnapshot.partHashes[name],
	);
	const unexpected = changedParts.filter((name) => name !== stylesPart);
	if (unexpected.length) {
		throw new Error(
			`DOCX invariant failed: unexpected changed part(s): ${unexpected.join(", ")}`,
		);
	}
	if (requireStyleChange && !changedParts.includes(stylesPart)) {
		throw new Error("DOCX invariant failed: styles part did not change");
	}
	return {
		changedParts,
		invariants: {
			part_set: "unchanged",
			non_style_parts: "byte-identical",
			document_xml: "byte-identical",
			relationships: "byte-identical",
			text: "unchanged",
			media: "unchanged",
			comments_and_revisions: "unchanged",
		},
	};
}

function fileState(path: string): FileState | undefined {
	if (!existsSync(path)) return undefined;
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error(
			`output exists and is not a regular non-symlink file: ${path}`,
		);
	}
	return {
		dev: stat.dev,
		ino: stat.ino,
		size: stat.size,
		mtimeMs: stat.mtimeMs,
		sha256: sha256(readFileSync(path)),
	};
}

function sameState(
	left: FileState | undefined,
	right: FileState | undefined,
): boolean {
	if (!left || !right) return left === right;
	return (
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.size === right.size &&
		left.mtimeMs === right.mtimeMs &&
		left.sha256 === right.sha256
	);
}

export function assertDistinctOutput(input: string, output: string): void {
	const resolvedInput = resolve(input);
	const resolvedOutput = resolve(output);
	if (resolvedInput === resolvedOutput) {
		throw new Error("output path must differ from input path");
	}
	if (existsSync(resolvedOutput)) {
		const inputStat = lstatSync(resolvedInput);
		const outputStat = lstatSync(resolvedOutput);
		if (inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) {
			throw new Error("output path must differ from input path");
		}
	}
}

export async function writeAtomicOutput(
	input: string,
	output: string,
	data: Buffer,
	force: boolean,
	validateTemporary: (path: string) => Promise<void>,
): Promise<OutputArtifact> {
	const resolvedOutput = resolve(output);
	assertDistinctOutput(input, resolvedOutput);
	mkdirSync(dirname(resolvedOutput), { recursive: true });
	const initialState = fileState(resolvedOutput);
	if (initialState && !force) {
		throw new Error(
			`output already exists; use --force to replace it: ${resolvedOutput}`,
		);
	}
	const temporary = join(
		dirname(resolvedOutput),
		`.${basename(resolvedOutput)}.${process.pid}.${randomUUID()}.tmp`,
	);
	const backup = join(
		dirname(resolvedOutput),
		`.${basename(resolvedOutput)}.${process.pid}.${randomUUID()}.backup`,
	);
	let descriptor: number | undefined;
	let backedUp = false;
	let installed = false;
	try {
		descriptor = openSync(temporary, "wx", 0o644);
		writeFileSync(descriptor, data);
		fsyncSync(descriptor);
		closeSync(descriptor);
		descriptor = undefined;
		await validateTemporary(temporary);
		const currentState = fileState(resolvedOutput);
		if (!sameState(initialState, currentState)) {
			throw new Error("output changed while DOCX beautification was running");
		}
		if (currentState) {
			renameSync(resolvedOutput, backup);
			backedUp = true;
		}
		renameSync(temporary, resolvedOutput);
		installed = true;
		if (backedUp) {
			rmSync(backup, { force: true });
			backedUp = false;
		}
	} catch (error) {
		if (installed && backedUp && existsSync(resolvedOutput)) {
			rmSync(resolvedOutput, { force: true });
			installed = false;
		}
		if (backedUp && existsSync(backup) && !existsSync(resolvedOutput)) {
			renameSync(backup, resolvedOutput);
			backedUp = false;
		}
		throw error;
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
		if (existsSync(temporary)) rmSync(temporary, { force: true });
	}
	const outputData = readFileSync(resolvedOutput);
	return {
		path: resolvedOutput,
		size_bytes: outputData.length,
		sha256: sha256(outputData),
	};
}
