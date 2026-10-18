/** Shared semantic policy. Reuse always requires the normal provenance/content gates. */
export const HISTORICAL_EVIDENCE = new Set([
  "red-test-evidence", "green-test-evidence", "baseline-test-evidence",
  "build-test-evidence", "review-evidence", "test-case-derivation", "test-quality",
]);

/** Local deterministic checks: content, command and provenance gates, not age, govern reuse.
 * Recovery/provider/external observations and unknown sensors retain the 24h default.
 */
export const CONTENT_BOUND_EVIDENCE = new Set([
  ...HISTORICAL_EVIDENCE,
  "document-slice-consistency", "contract-baseline", "functional-design-completeness",
  "nfr-coverage", "infrastructure-completeness", "implementation-report",
  "frontend-platform-spec", "template-completeness", "prd-completeness",
  "diagram-contract", "design-intent-coverage", "ui-design-alignment",
  "ui-artifact-consistency", "inception-consistency", "traceability-matrix", "structural-invariants",
  "quality-change-impact", "dependency-readiness", "field-capability",
  "story-rule-consistency", "ui-behavior-consistency", "artifact-consistency", "delivery-readiness",
]);

export function isEvidenceTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && hour < 24 && minute < 60 && second < 60 && Number.isFinite(Date.parse(value));
}

/** Explicit external/environment windows may tighten any content-bound observation. */
export function evidenceTimeError(record: Record<string, unknown>, sensor: string, now = Date.now(), maxAgeMs?: number): string | null {
  if (!isEvidenceTimestamp(record.timestamp)) return "evidence timestamp is not a valid ISO date";
  const age = now - Date.parse(record.timestamp);
  if (age < -60_000) return "evidence timestamp is in the future";
  let limit = maxAgeMs ?? (CONTENT_BOUND_EVIDENCE.has(sensor) ? Infinity : 24 * 3600_000);
  if (record.freshness !== undefined) {
    const policy = record.freshness as Record<string, unknown> | null;
    if (!policy || policy.kind !== "external" || typeof policy.reason !== "string" || !policy.reason.trim()
      || !Number.isSafeInteger(policy.max_age_ms) || Number(policy.max_age_ms) < 0) return "invalid evidence freshness policy";
    limit = Math.min(limit, Number(policy.max_age_ms));
  }
  return age > limit ? `evidence is stale (configured freshness window ${limit}ms)` : null;
}

/** Legacy open findings remain blocking. New reports partition open findings by severity. */
export function reviewIssueErrors(record: Record<string, unknown>): string[] {
  const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const errors: string[] = [];
  for (const key of ["issues_found", "issues_resolved", "issues_open"]) if (!count(record[key])) errors.push(`${key} must be a non-negative integer`);
  if (errors.length) return errors;
  const found = Number(record.issues_found), resolved = Number(record.issues_resolved), open = Number(record.issues_open);
  // Preserve legacy all-resolved evidence (some historical reports counted repeat fixes).
  if (record.issues_by_severity === undefined) {
    if (open !== 0 || resolved < found) errors.push("legacy review issues_open must be 0 and issues_resolved must be >= issues_found; severity is unknown");
    return errors;
  }
  const severity = record.issues_by_severity as Record<string, unknown> | null;
  if (!severity || !["critical_open", "important_open", "suggestion_open"].every(key => count(severity[key]))) return ["issues_by_severity requires critical_open, important_open, suggestion_open counts"];
  if (resolved + open !== found || Number(severity.critical_open) + Number(severity.important_open) + Number(severity.suggestion_open) !== open) errors.push("review severity counts must partition issues_open and issues_found = issues_resolved + issues_open");
  if (Number(severity.critical_open) + Number(severity.important_open) > 0) errors.push("review has unresolved blocking issues (critical/important)");
  return errors;
}
