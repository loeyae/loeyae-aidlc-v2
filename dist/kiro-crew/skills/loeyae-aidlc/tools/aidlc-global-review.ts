/** Stable FINAL_GLOBAL checklist. Results belong to the reviewer, never the projection. */
import { normalizeUcdSources } from "./aidlc-ucd-declarations";

/** Adapt FINAL_GLOBAL's current producer snapshots to the normalized file-list contract. */
export function globalReviewUcdSources(
	value: unknown,
): ReturnType<typeof normalizeUcdSources> {
	const record =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	if (
		record &&
		!Object.hasOwn(record, "files") &&
		Object.keys(record).length &&
		Object.keys(record).every((key) => /\.md$/i.test(key))
	) {
		return normalizeUcdSources({
			files: Object.entries(record).map(([file, entry]) => ({
				...(entry as Record<string, unknown>),
				file,
			})),
		});
	}
	return normalizeUcdSources(value);
}

export const GLOBAL_REVIEW_ITEMS = [
	"interfaces",
	"shared_models",
	"error_handling",
	"naming",
	"integration",
	"dependencies",
	"configuration",
	"performance",
	"security",
	"observability",
	"test_policy",
	"integration_tests",
	"boundary_tests",
	"design_coverage",
	"blocked_cases",
	"test_mapping",
	"test_execution",
] as const;

export interface GlobalCoverage {
	status: "passed" | "blocked";
	total: number;
	covered: number;
	design_covered: number;
	units: Array<{
		module_id: string;
		unit_id: string;
		ucd_ids: string[];
		covered_ucd_ids: string[];
		design_ucd_ids: string[];
		deferred_ucd_ids: string[];
	}>;
	blocking: string[];
}

export function globalChecklistErrors(
	value: unknown,
	coverage: GlobalCoverage,
	inputPaths: string[],
): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return ["FINAL_GLOBAL checklist is required"];
	const checklist = value as Record<string, unknown>,
		errors: string[] = [];
	const mandatory = new Set([
		"security",
		"blocked_cases",
		...(coverage.total
			? ["design_coverage", "test_mapping", "test_execution"]
			: []),
	]);
	for (const key of Object.keys(checklist))
		if (
			!GLOBAL_REVIEW_ITEMS.includes(key as (typeof GLOBAL_REVIEW_ITEMS)[number])
		)
			errors.push(`unknown FINAL_GLOBAL checklist item ${key}`);
	for (const key of GLOBAL_REVIEW_ITEMS) {
		const raw = checklist[key];
		const item =
			raw && typeof raw === "object" && !Array.isArray(raw)
				? (raw as Record<string, unknown>)
				: undefined;
		if (!item || !["passed", "not_applicable"].includes(String(item.status))) {
			errors.push(
				`FINAL_GLOBAL checklist.${key} must be passed or justified not_applicable`,
			);
			continue;
		}
		if (
			!Array.isArray(item.evidence) ||
			!item.evidence.length ||
			!item.evidence.every(
				(path) =>
					typeof path === "string" && inputPaths.includes(path.split("#")[0]),
			)
		)
			errors.push(
				`FINAL_GLOBAL checklist.${key} must cite current input files`,
			);
		if (
			item.status === "not_applicable" &&
			(mandatory.has(key) ||
				typeof item.reason !== "string" ||
				!item.reason.trim())
		)
			errors.push(
				`FINAL_GLOBAL checklist.${key} cannot waive an applicable requirement`,
			);
	}
	return errors;
}
