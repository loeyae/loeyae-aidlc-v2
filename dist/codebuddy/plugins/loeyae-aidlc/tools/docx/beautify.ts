import type { InspectionReport } from "../aidlc-docx";
import {
	type CoverageReport,
	type StyleMapping,
	transformStyles,
} from "./beautify-styles";
import {
	type InvariantSummary,
	type OutputArtifact,
	generateStyledPackage,
	loadEditableDocx,
	snapshotPackage,
	validateStyleOnlyBuffer,
	writeAtomicOutput,
} from "./package";
import { loadStyleSpec, styleSpecDigest } from "./style-spec";

export interface BeautifyOptions {
	input: string;
	output?: string;
	preset?: string;
	styleSpecPath?: string;
	dryRun: boolean;
	force: boolean;
}

export interface BeautifyReport {
	schema_version: "1";
	operation: "beautify";
	status: "DRY_RUN" | "STATIC_PASS";
	input: {
		path: string;
		size_bytes: number;
		sha256: string;
	};
	output: OutputArtifact | null;
	policy: {
		preset: string;
		mode: "conservative";
		spec_sha256: string;
	};
	planned_changed_parts: string[];
	changed_parts: string[];
	styles: {
		mappings: StyleMapping[];
		updated_roles: string[];
		skipped_roles: string[];
	};
	coverage: CoverageReport;
	invariants: InvariantSummary | null;
	visual_validation: "not_run";
	warnings: string[];
}

export interface ValidateReport {
	schema_version: "1";
	operation: "validate";
	status: "STATIC_PASS";
	against: {
		path: string;
		sha256: string;
	};
	output: {
		path: string;
		sha256: string;
	};
	changed_parts: string[];
	invariants: InvariantSummary;
	visual_validation: "not_run";
}

type InspectFunction = (path: string) => Promise<InspectionReport>;

function assertTextUnchanged(
	input: InspectionReport,
	output: InspectionReport,
): void {
	if (input.document.text_sha256 !== output.document.text_sha256) {
		throw new Error("DOCX invariant failed: visible text changed");
	}
}

export async function beautifyDocx(
	options: BeautifyOptions,
	inputInspection: InspectionReport,
	inspect: InspectFunction,
): Promise<BeautifyReport> {
	if (!options.dryRun && !options.output) {
		throw new Error("docx beautify requires --output unless --dry-run is used");
	}
	if (options.dryRun && options.force) {
		throw new Error("--force cannot be combined with --dry-run");
	}
	const spec = loadStyleSpec(options.preset, options.styleSpecPath);
	const loaded = await loadEditableDocx(
		options.input,
		inputInspection.input.sha256,
	);
	const transformation = transformStyles(
		loaded.documentXml,
		loaded.stylesXml,
		loaded.stylesPart,
		spec,
	);
	const base: Omit<
		BeautifyReport,
		"status" | "output" | "changed_parts" | "invariants"
	> = {
		schema_version: "1",
		operation: "beautify",
		input: {
			path: inputInspection.input.path,
			size_bytes: inputInspection.input.size_bytes,
			sha256: inputInspection.input.sha256,
		},
		policy: {
			preset: spec.id,
			mode: "conservative",
			spec_sha256: styleSpecDigest(spec),
		},
		planned_changed_parts: [loaded.stylesPart],
		styles: {
			mappings: transformation.mappings,
			updated_roles: transformation.updatedRoles,
			skipped_roles: transformation.skippedRoles,
		},
		coverage: transformation.coverage,
		visual_validation: "not_run",
		warnings: transformation.warnings,
	};
	if (options.dryRun) {
		return {
			...base,
			status: "DRY_RUN",
			output: null,
			changed_parts: [],
			invariants: null,
		};
	}
	const inputSnapshot = await snapshotPackage(loaded.zip);
	const outputData = await generateStyledPackage(
		loaded,
		transformation.stylesXml,
	);
	const validation = await validateStyleOnlyBuffer(
		inputSnapshot,
		outputData,
		loaded.stylesPart,
		true,
	);
	let temporaryInspection: InspectionReport | undefined;
	const output = await writeAtomicOutput(
		loaded.input,
		options.output as string,
		outputData,
		options.force,
		async (temporaryPath) => {
			temporaryInspection = await inspect(temporaryPath);
			assertTextUnchanged(inputInspection, temporaryInspection);
		},
	);
	if (!temporaryInspection) {
		throw new Error("DOCX output validation did not run");
	}
	return {
		...base,
		status: "STATIC_PASS",
		output,
		changed_parts: validation.changedParts,
		invariants: validation.invariants,
	};
}

export async function validateDocxAgainst(
	output: string,
	against: string,
	outputInspection: InspectionReport,
	againstInspection: InspectionReport,
): Promise<ValidateReport> {
	const baseline = await loadEditableDocx(
		against,
		againstInspection.input.sha256,
	);
	const candidate = await loadEditableDocx(
		output,
		outputInspection.input.sha256,
	);
	if (baseline.stylesPart !== candidate.stylesPart) {
		throw new Error(
			"DOCX invariant failed: styles relationship target changed",
		);
	}
	const baselineSnapshot = await snapshotPackage(baseline.zip);
	const validation = await validateStyleOnlyBuffer(
		baselineSnapshot,
		candidate.inputData,
		baseline.stylesPart,
		false,
	);
	assertTextUnchanged(againstInspection, outputInspection);
	return {
		schema_version: "1",
		operation: "validate",
		status: "STATIC_PASS",
		against: {
			path: againstInspection.input.path,
			sha256: againstInspection.input.sha256,
		},
		output: {
			path: outputInspection.input.path,
			sha256: outputInspection.input.sha256,
		},
		changed_parts: validation.changedParts,
		invariants: validation.invariants,
		visual_validation: "not_run",
	};
}
