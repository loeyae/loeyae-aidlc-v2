import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { InspectionReport, CoverageReport, StyleMapping } from "./types";
import {
	loadEditableDocx,
	assertRegularDocxInput,
	snapshotPackage,
	validateStyleOnlyBuffer,
	type InvariantSummary,
	type OutputArtifact,
} from "./package";
import { dispatchDocx } from "../aidlc-docx-provider";
const hash = (p: string) => {
	assertRegularDocxInput(p);
	return createHash("sha256").update(readFileSync(p)).digest("hex");
};
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

/** Compatibility library entry: explicit authorization also applies to library callers. */
export async function beautifyDocx(
	options: BeautifyOptions,
	_inspection?: InspectionReport,
	_inspect?: (path: string) => Promise<InspectionReport>,
): Promise<BeautifyReport> {
	if (_inspection)
		await loadEditableDocx(options.input, _inspection.input.sha256);
	return dispatchDocx({ ...options, command: "beautify" });
}
export async function validateDocxAgainst(
	output: string,
	against: string,
	outputInspection?: InspectionReport,
	againstInspection?: InspectionReport,
): Promise<ValidateReport> {
	const baseline = await loadEditableDocx(
		against,
		againstInspection?.input.sha256 ?? hash(against),
	);
	const candidate = await loadEditableDocx(
		output,
		outputInspection?.input.sha256 ?? hash(output),
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
	if (
		hash(against) !== baseline.inputSha256 ||
		hash(output) !== candidate.inputSha256
	)
		throw new Error("DOCX input changed during validation; retry the command");

	return {
		schema_version: "1",
		operation: "validate",
		status: "STATIC_PASS",
		against: {
			path: against,
			sha256: baseline.inputSha256,
		},
		output: {
			path: output,
			sha256: candidate.inputSha256,
		},
		changed_parts: validation.changedParts,
		invariants: validation.invariants,
		visual_validation: "not_run",
	};
}
