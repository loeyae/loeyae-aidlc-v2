/** Shared semantic policy. Reuse always requires the normal provenance/content gates. */
export const HISTORICAL_EVIDENCE = new Set([
  "red-test-evidence", "green-test-evidence", "baseline-test-evidence",
  "build-test-evidence", "review-evidence", "test-case-derivation", "test-quality",
]);

/** Local deterministic checks: content, command and provenance gates, not age, govern reuse.
 * Recovery/provider/external observations and unknown sensors retain the 24h default.
 */
export const CONTENT_BOUND_EVIDENCE = new Set([
  "global-review-evidence",
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
export function reviewAxisErrors(content: string): string[] {
  const lines = content.split(/\r?\n/).map(line => line.replace(/[*`]/g, "").trim().replace(/^[-+]\s+/, ""));
  const axes = [
    ["Spec", /^(?:#{1,6}\s*)?(?:Spec(?:\s+Axis)?|规格(?:合规)?)(?:\s*(?:result|结果|审查结果|审查))?\s*[:：]\s*(.+)$/i],
    ["Standards", /^(?:#{1,6}\s*)?(?:Standards(?:\s+Axis)?|规范|质量)(?:\s*(?:result|结果|审查结果|审查))?\s*[:：]\s*(.+)$/i],
  ] as const;
  const errors: string[] = [];
  for (const [name, expression] of axes) {
    let section = false;
    const values: string[] = [];
    for (const line of lines) {
      const inline = expression.exec(line);
      if (inline) { values.push(inline[1]); continue; }
      if (/^#{1,6}\s/.test(line)) {
        section = name === "Spec" ? /\bSpec\b|规格/.test(line) : /\bStandards\b|规范|质量/.test(line);
      } else if (section) {
        const status = /^(?:状态|status|结果|result)\s*[:：]\s*(.+)$/i.exec(line);
        if (status) values.push(status[1]);
      }
    }
    if (!values.length) errors.push(`${name} axis requires an explicit conclusion`);
    for (const value of values) {
      if (/failed|blocked|unknown|needs?\s+(?:fix|repair)|未通过|不合规|不通过|需要修复|阻断/i.test(value)
        || !/^(?:[✅✔]\s*)?(?:passed|通过|合规|无需修复|已修复并复审通过)(?:\s*[（(][^()（）\r\n]*[）)])?(?:\s*[。.!！]?\s*)$/i.test(value)) {
        errors.push(`${name} axis is not passed: ${value}`);
      }
    }
  }
  return errors;
}

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

export type DeliveryConsistencySensor = "prd-completeness" | "inception-consistency" | "ui-design-alignment";
export interface DeliveryConsistencyContext {
  module_id?: string;
  prd_selected?: boolean;
  ui_route?: string;
}
const PAYLOAD_COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const payloadNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const payloadInteger = (value: unknown): number | null => {
  const number = payloadNumber(value);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
};
const payloadStrings = (value: unknown): string[] | null => Array.isArray(value) && value.every(item => typeof item === "string") ? value as string[] : null;
const payloadText = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/** One payload gate for stored evidence and current read-only delivery checks.
 * Provenance/freshness remain the caller's responsibility; a checker exiting zero
 * with status=passed does not establish that every measured criterion passed. */
export function deliveryConsistencyPayloadErrors(sensor: DeliveryConsistencySensor, evidence: Record<string, unknown>, context: DeliveryConsistencyContext): string[] {
  switch (sensor) {
    case "prd-completeness": {
      const errors: string[] = [];
      if (evidence.status !== "passed") errors.push('status must be "passed"');
      if (!payloadText(evidence.prd_path)) errors.push("prd_path is required");
      const sections = payloadStrings(evidence.required_sections);
      if (!sections || sections.length < 6) errors.push("required_sections must list at least 6 PRD sections");
      if (payloadInteger(evidence.functional_requirements) === null || (evidence.functional_requirements as number) < 1) errors.push("functional_requirements must be >= 1");
      // B3:这 4 项从"硬编码 true"升为确定性判定(required_sections 已保证节存在,这里查节内容充实)。
      if (evidence.acceptance_criteria_complete !== true) errors.push("acceptance_criteria_complete must be true");
      if (evidence.non_goals_complete !== true) errors.push("non_goals_complete must be true");
      if (evidence.pending_questions_indexed !== true) errors.push("pending_questions_indexed must be true");
      if (evidence.source_index_complete !== true) errors.push("source_index_complete must be true");
      if (evidence.clarification_consistency !== "passed") errors.push('clarification_consistency must be "passed"');
      if (!["passed", "not_applicable"].includes(String(evidence.business_flow_validation))) errors.push('business_flow_validation must be "passed" or "not_applicable"');
      if (payloadNumber(evidence.unresolved_blockers) !== 0) errors.push("unresolved_blockers must be 0");
      return errors;
    }
    case "inception-consistency": {
      const errors: string[] = [];
      if (evidence.status !== "passed") errors.push('status must be "passed"');
      if (evidence.module_id !== context.module_id) errors.push(`module_id must be ${context.module_id || "(none)"}`);
      if (payloadInteger(evidence.requirements_checked) === null || (evidence.requirements_checked as number) < 1) errors.push("requirements_checked must be >= 1");
      if (payloadInteger(evidence.stories_checked) === null || (evidence.stories_checked as number) < 1) errors.push("stories_checked must be >= 1");
      const expectedPrd = context.prd_selected === true;
      if (evidence.prd_selected !== expectedPrd) errors.push(`prd_selected must be ${expectedPrd}`);
      const prdItems = payloadNumber(evidence.prd_items_checked);
      if (prdItems === null || (expectedPrd ? prdItems < 1 : prdItems !== 0)) errors.push(`prd_items_checked is inconsistent with selected PRD route`);
      const expectedUiRoute = context.ui_route || "not-selected";
      if (evidence.ui_route !== expectedUiRoute) errors.push(`ui_route must match selected UI choice ${expectedUiRoute}`);
      const uiPages = payloadNumber(evidence.ui_pages_checked);
      const uiSelected = expectedUiRoute === "html-mock" || expectedUiRoute === "figma-create" || expectedUiRoute === "figma-existing";
      if (uiPages === null || (uiSelected ? uiPages < 1 : uiPages !== 0)) errors.push("ui_pages_checked is inconsistent with selected UI route");
      if (payloadNumber(evidence.unresolved_conflicts) !== 0) errors.push("unresolved_conflicts must be 0");
      const freshnessVerified = evidence.ui_freshness_verified === true;
      const fullAcceptanceRuns = payloadNumber(evidence.ui_full_acceptance_runs);
      if (uiSelected) {
        if (!freshnessVerified) errors.push("ui_freshness_verified must be true for selected UI routes");
        if (!/^[a-f0-9]{64}$/.test(String(evidence.ui_generation_lock_digest || ""))) errors.push("ui_generation_lock_digest must be SHA-256");
        if (!/^[a-f0-9]{64}$/.test(String(evidence.ui_generation_acceptance_digest || ""))) errors.push("ui_generation_acceptance_digest must be SHA-256");
        if (!payloadText(evidence.ui_upstream_ref)) errors.push("ui_upstream_ref is required");
        if (!PAYLOAD_COMMIT_ID.test(String(evidence.ui_baseline_upstream_commit || ""))) errors.push("ui_baseline_upstream_commit must be a git commit id");
        if (!PAYLOAD_COMMIT_ID.test(String(evidence.ui_current_upstream_commit || ""))) errors.push("ui_current_upstream_commit must be a git commit id");
        if (!Array.isArray(evidence.ui_changed_paths)) errors.push("ui_changed_paths must be an array");
        if (!Array.isArray(evidence.ui_affected_pages)) errors.push("ui_affected_pages must be an array");
        if (payloadNumber(evidence.ui_impact_unmapped) !== 0) errors.push("ui_impact_unmapped must be 0");
        if (fullAcceptanceRuns !== 1) errors.push("ui_full_acceptance_runs must be exactly 1");
        const targetedRuns = payloadInteger(evidence.ui_targeted_reverification_runs);
        if (targetedRuns === null) errors.push("ui_targeted_reverification_runs must be a non-negative integer");
      } else {
        if (freshnessVerified) errors.push("ui_freshness_verified must be false when no UI route is selected");
        if (fullAcceptanceRuns !== 0) errors.push("ui_full_acceptance_runs must be 0 when no UI route is selected");
      }
      const artifacts = payloadStrings(evidence.artifacts_checked);
      if (!artifacts || artifacts.length < (uiSelected ? 5 : 3)) errors.push("artifacts_checked must list canonical consistency inputs and UI governance artifacts when selected");
      return errors;
    }
    case "ui-design-alignment": {
      const errors: string[] = [];
      if (!["passed", "not_applicable"].includes(String(evidence.status))) errors.push('status must be "passed" or "not_applicable"');
      const selectedChoice = context.ui_route;
      const uiSelected = selectedChoice === "html-mock" || selectedChoice === "figma-create" || selectedChoice === "figma-existing";
      if (evidence.status === "not_applicable") {
        if (uiSelected && !payloadText(evidence.reason)) errors.push("selected UI routes require a reason when the current unit is not applicable");
        return errors;
      }
      const expectedMode = selectedChoice === "html-mock" ? "html-mock" : "figma";
      if (uiSelected && evidence.design_mode !== expectedMode) errors.push(`design_mode must be ${expectedMode} for selected choice ${selectedChoice}`);
      if (!["html-mock", "figma"].includes(String(evidence.design_mode))) errors.push('design_mode must be "html-mock" or "figma"');
      for (const field of ["styles_aligned", "conditional_visibility_aligned", "platform_constraints_respected"]) if (evidence[field] !== true) errors.push(`${field} must be true`);
      if (payloadNumber(evidence.unmapped_elements) !== 0) errors.push("unmapped_elements must be 0");
      if (payloadNumber(evidence.extra_elements) !== 0) errors.push("extra_elements must be 0");
      if (payloadInteger(evidence.pages_checked) === null || (evidence.pages_checked as number) < 1) errors.push("pages_checked must be >= 1");
      if (payloadInteger(evidence.elements_checked) === null || (evidence.elements_checked as number) < 1) errors.push("elements_checked must be >= 1");
      // MARS-125: a passed alignment must enumerate the pages it covered so implementation-report can
      // reconcile per-page forward coverage across units; the id list must match pages_checked.
      const pagesCovered = payloadStrings(evidence.pages_covered);
      if (!pagesCovered || pagesCovered.length < 1) errors.push("pages_covered must list the covered PAGE identifiers");
      else if (pagesCovered.length !== (evidence.pages_checked as number)) errors.push("pages_covered length must equal pages_checked");
      return errors;
    }
    default: return ["unsupported delivery consistency sensor"];
  }
}
