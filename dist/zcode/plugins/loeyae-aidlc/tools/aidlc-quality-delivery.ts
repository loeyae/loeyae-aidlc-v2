import { existsSync, readFileSync } from "fs";
import { qualityBase, qualityChangeIssues, qualityEvidenceErrors, qualityInput, qualityLegacyResult, qualityPath, qualityResult, qualitySection, type QualityContext, type QualityInput, type QualityIssue } from "./aidlc-quality-gates";
import { artifactConsistency, dependencyReadiness, fieldCapability, storyRuleConsistency } from "./aidlc-quality-checks";
import { qualityUiCheck } from "./aidlc-quality-ui";

export function deliveryEvidencePath(ctx: QualityContext, stage: string, sensor: string): string {
  return `.aidlc/evidence/${stage}/${ctx.module_id ? `${ctx.module_id}/` : ""}${sensor}.json`;
}
export function controlledQualityErrors(ctx: QualityContext, sensor: string, evidence: Record<string, unknown>): string[] {
  const errors = qualityEvidenceErrors(ctx, sensor, evidence);
  try {
    const current = sensor === "dependency-readiness" ? dependencyReadiness(ctx) : sensor === "field-capability" ? fieldCapability(ctx) : sensor === "story-rule-consistency" ? storyRuleConsistency(ctx) : sensor === "ui-behavior-consistency" ? qualityUiCheck(ctx) : sensor === "artifact-consistency" ? artifactConsistency(ctx) : sensor === "delivery-readiness" ? deliveryReadiness(ctx, true) : null;
    if (current) for (const input of current.inputs as QualityInput[]) if (!(evidence.inputs as QualityInput[] | undefined)?.some(i => i.path === input.path && i.sha256 === input.sha256)) errors.push(`GATE_EVIDENCE_MISSING: actual checker input ${input.path}`);
  } catch (error) { errors.push(`DELIVERY_GATE_NOT_READY: ${String(error)}`); }
  const producer = evidence.producer as Record<string, unknown> | undefined;
  const checker = evidence.checker as Record<string, unknown> | undefined;
  if (evidence.evidence_version !== "1" || producer?.name !== "loeyae-aidlc-evidence" || producer.mode !== "controlled" || !producer.execution_id || checker?.id !== `builtin:${sensor}` || checker.sensor !== sensor || checker.exit_code !== 0 || checker.status !== "passed" || !/^[a-f0-9]{64}$/.test(String(checker.argv_digest))) errors.push("GATE_EVIDENCE_MISSING: controlled provenance/execution invalid");
  const time = Date.parse(String(evidence.timestamp));
  if (!Number.isFinite(time) || time > Date.now() + 60000 || Date.now() - time > 24 * 3600000) errors.push("GATE_EVIDENCE_STALE: freshness policy (24h)");
  const expectedInstance = ctx.module_id ? `${ctx.stage}@module:${ctx.module_id}` : ctx.stage;
  if (evidence.stage_instance !== expectedInstance) errors.push("GATE_SCOPE_MISMATCH: stage instance");
  return errors;
}

export function deliveryReadiness(ctx: QualityContext, includeArtifacts = false): Record<string, unknown> {
  const sensor = "delivery-readiness"; const legacy = qualityLegacyResult(ctx, sensor); if (legacy) return legacy;
  const req = qualitySection(ctx, "requirements"), stories = qualitySection(ctx, "user-stories"), delivery = qualitySection(ctx, "cross-validation-report");
  const issues: QualityIssue[] = [...qualityChangeIssues(ctx, req.value)];
  const issue = (code: string, location: string, message: string) => issues.push({ code, location, message });
  const required: Array<[string, string]> = [
    ["requirements-analysis", "quality-change-impact"], ["requirements-analysis", "dependency-readiness"],
    ["requirements-analysis", "field-capability"], ["user-stories", "story-rule-consistency"],
  ];
  const uiSelected = ["html-mock", "figma-create", "figma-existing"].includes(ctx.ui_route);
  const docs = [req, stories, delivery];
  const packagePaths = new Set([`${qualityBase(ctx)}/requirements.md`, `${qualityBase(ctx)}/user-stories.md`, `${qualityBase(ctx)}/development-handoff.md`]);
  if (uiSelected) {
    required.push([ctx.ui_route === "html-mock" ? "ui-mock-generation" : "ui-figma-generation", "ui-behavior-consistency"]);
    const plan = qualitySection(ctx, "ui-design/page-plan"); docs.push(plan);
    packagePaths.add(`${qualityBase(ctx)}/ui-design/page-plan.md`);
    const manifestPath = `${qualityBase(ctx)}/${ctx.ui_route === "html-mock" ? "ui-mock/ui-mock-manifest.json" : "ui-design/figma-manifest.json"}`;
    delivery.inputs.push(qualityInput(ctx, manifestPath)); packagePaths.add(manifestPath);
    const manifest = JSON.parse(readFileSync(qualityPath(ctx, manifestPath), "utf8"));
    if (ctx.ui_route === "html-mock") for (const page of manifest.pages || []) { if (page.html) packagePaths.add(page.html); if (page.page_specs) packagePaths.add(page.page_specs); }
    // Existing canonical UI acceptance remains independently enforced by inception-consistency.
    for (const file of ["ui-design/ui-generation-lock.json", "ui-design/ui-generation-acceptance.json", "ui-design/ui-generation-checkpoints.json"]) {
      const path = `${qualityBase(ctx)}/${file}`; if (existsSync(qualityPath(ctx, path))) delivery.inputs.push(qualityInput(ctx, path));
    }
  }
  if (includeArtifacts) required.push(["cross-validation", "artifact-consistency"]);
  const consumed: string[] = [];
  for (const [stage, checker] of required) {
    const path = deliveryEvidencePath(ctx, stage, checker);
    if (!existsSync(qualityPath(ctx, path))) { issue("DELIVERY_GATE_NOT_READY", path, "applicable specialized evidence missing"); continue; }
    const evidence = JSON.parse(readFileSync(qualityPath(ctx, path), "utf8")) as Record<string, unknown>;
    // Early evidence precedes signed UI selection; do not retrofit UI identity onto requirements.
    const origin = { ...ctx, stage, ui_route: ["requirements-analysis", "user-stories"].includes(stage) ? String(evidence.ui_route) : ctx.ui_route };
    for (const error of controlledQualityErrors(origin, checker, evidence)) issue("DELIVERY_GATE_NOT_READY", path, error);
    if (evidence.delivery_scope !== delivery.value.delivery_scope) issue("GATE_SCOPE_MISMATCH", path, "delivery scope differs");
    delivery.inputs.push(qualityInput(ctx, path), ...(evidence.inputs as QualityInput[] || [])); consumed.push(path);
  }
  const packageList = delivery.value.package as Array<{ path: string; kind: string }> | undefined;
  if (!Array.isArray(packageList)) issue("DELIVERY_PACKAGE_INCOMPLETE", "package", "canonical development package index required");
  else {
    for (const path of packagePaths) if (!packageList.some(p => p.path === path)) issue("DELIVERY_PACKAGE_INCOMPLETE", path, "canonical artifact absent from handoff index");
    for (const entry of packageList) { try { delivery.inputs.push(qualityInput(ctx, entry.path)); } catch (error) { issue("DELIVERY_PACKAGE_INCOMPLETE", entry.path, String(error)); } }
  }
  const pending = delivery.value.pending_items as Array<{ id: string; blocking: boolean; status: string; reason: string }> | undefined;
  if (!Array.isArray(pending)) issue("DELIVERY_BLOCKER_OPEN", "pending_items", "explicit pending inventory required");
  else for (const item of pending) if (item.blocking && item.status !== "closed" || !item.reason) issue("DELIVERY_BLOCKER_OPEN", item.id, "blocking or unexplained pending item");
  if (!Array.isArray(delivery.value.decisions)) issue("DELIVERY_PACKAGE_INCOMPLETE", "decisions", "effective/superseded decision index required");
  return qualityResult(ctx, sensor, docs, issues, { delivery_state: "product-ui-ready", consumed_evidence: consumed, development_accepted: Boolean(delivery.value.development_acceptance), package_paths: [...packagePaths] });
}

export function developmentAcceptanceErrors(ctx: QualityContext): string[] {
  const delivery = qualitySection(ctx, "cross-validation-report");
  const path = delivery.value.development_acceptance;
  if (typeof path !== "string" || !path) return ["DEVELOPMENT_ENTRY_NOT_READY: development reception/technical review missing"];
  const record = JSON.parse(readFileSync(qualityPath(ctx, path), "utf8")) as { accepted_by: string; technical_review: string; workflow_id: string; module_id: string | null; inputs: QualityInput[] };
  const errors: string[] = [];
  if (!record.accepted_by || !record.technical_review || record.workflow_id !== ctx.workflow_id && record.workflow_id !== ctx.project_workflow_id || record.module_id !== (ctx.module_id || null)) errors.push("DEVELOPMENT_ENTRY_NOT_READY: acceptance identity/technical review invalid");
  if (!Array.isArray(record.inputs)) return [...errors, "DEVELOPMENT_ENTRY_NOT_READY: acceptance bindings missing"];
  try {
    const review = JSON.parse(readFileSync(qualityPath(ctx, record.technical_review), "utf8")) as { workflow_id: string; module_id: string | null; reviewer: string; conclusion: string; inputs: QualityInput[]; findings: unknown[] };
    if (review.workflow_id !== ctx.workflow_id && review.workflow_id !== ctx.project_workflow_id || review.module_id !== (ctx.module_id || null) || !review.reviewer || review.conclusion !== "supported" || !Array.isArray(review.findings) || review.findings.length) errors.push("DEVELOPMENT_ENTRY_NOT_READY: technical review missing/failed/out of scope");
    for (const entry of delivery.value.package as Array<{ path: string }>) if (!review.inputs?.some(i => i.path === entry.path && i.sha256 === qualityInput(ctx, entry.path).sha256)) errors.push(`DEVELOPMENT_ENTRY_NOT_READY: technical review stale for ${entry.path}`);
  } catch (error) { errors.push(`DEVELOPMENT_ENTRY_NOT_READY: technical review unavailable: ${String(error)}`); }
  for (const entry of delivery.value.package as Array<{ path: string }>) if (!record.inputs.some(i => i.path === entry.path && i.sha256 === qualityInput(ctx, entry.path).sha256)) errors.push(`DEVELOPMENT_ENTRY_NOT_READY: acceptance stale for ${entry.path}`);
  if (ctx.prd_selected) {
    try {
      const path = String(delivery.value.prd_review || "");
      const review = JSON.parse(readFileSync(qualityPath(ctx, path), "utf8"));
      const prd = qualityInput(ctx, "docs/aidlc/ideation/prd.md");
      if (review.workflow_id !== (ctx.project_workflow_id || ctx.workflow_id) || review.kind !== "prd" || !review.reviewer || review.conclusion !== "supported" || !Array.isArray(review.findings) || review.findings.length || !review.inputs?.some((i: QualityInput) => i.path === prd.path && i.sha256 === prd.sha256)) errors.push("DEVELOPMENT_ENTRY_NOT_READY: selected PRD I16 review unverified/stale");
    } catch (error) { errors.push(`DEVELOPMENT_ENTRY_NOT_READY: selected PRD I16 review missing: ${String(error)}`); }
  }
  return errors;
}
