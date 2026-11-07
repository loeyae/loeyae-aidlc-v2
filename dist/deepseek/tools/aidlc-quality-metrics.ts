import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { loadWorkflowView } from "./aidlc-workflow-layout";
import { controlledQualityErrors } from "./aidlc-quality-delivery";
import { qualityLineageRoot, qualityPath, type QualityContext } from "./aidlc-quality-gates";

interface Defect { id: string; delivery_id: string; primary_cause: string; secondary_causes: string[]; first_detectable_stage: string; external_fact?: { confirmed_at: string; version: string } }
function coverage(numerator: unknown, denominator: unknown): Record<string, unknown> {
  if (typeof denominator !== "number" || typeof numerator !== "number" || denominator < 0 || numerator < 0 || numerator > denominator) return { status: "unknown", numerator: null, denominator: null, ratio: null };
  return { status: denominator === 0 ? "not_applicable" : "known", numerator, denominator, ratio: denominator === 0 ? null : numerator / denominator };
}
export function qualityMetrics(ctx: QualityContext): Record<string, unknown> {
  const diagnostics: string[] = []; const valid: Record<string, unknown>[] = [];
  const walk = (dir: string) => {
    if (!existsSync(qualityPath(ctx, dir))) return;
    for (const file of readdirSync(qualityPath(ctx, dir), { withFileTypes: true })) {
      const path = `${dir}/${file.name}`; qualityPath(ctx, path);
      if (file.isDirectory()) walk(path);
      else if (file.isFile() && file.name.endsWith(".json") && (!ctx.module_id || path.split("/").includes(ctx.module_id))) {
        try {
          const evidence = JSON.parse(readFileSync(qualityPath(ctx, path), "utf8"));
          if (!evidence.quality_version || evidence.applicable !== true) continue;
          if (controlledQualityErrors({ ...ctx, stage: evidence.stage, ui_route: evidence.ui_route }, evidence.sensor, evidence).length) { diagnostics.push(`unverified/currently stale: ${path}`); continue; }
          valid.push({ ...evidence, evidence_path: path });
        } catch { diagnostics.push(`unreadable/unverified: ${path}`); }
      }
    }
  };
  walk(".aidlc/evidence");
  const latest = (sensor: string) => valid.filter(e => e.sensor === sensor).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
  const ui = latest("ui-behavior-consistency"), rules = latest("story-rule-consistency"), delivery = latest("delivery-readiness");
  const eventsPath = `${qualityLineageRoot(ctx)}/quality-events.json`;
  let events: { deliveries: Array<{ id: string; timestamp: string }>; defects: Defect[] } | null = null;
  try {
    if (existsSync(qualityPath(ctx, eventsPath))) {
      events = JSON.parse(readFileSync(qualityPath(ctx, eventsPath), "utf8"));
      if (!Array.isArray(events?.deliveries) || !Array.isArray(events?.defects)) throw new Error("event arrays missing");
    }
  } catch { events = null; diagnostics.push("events unknown: invalid event source"); }
  const defects = new Map<string, Defect>();
  for (const defect of events?.defects || []) if (defect.id && !defects.has(defect.id)) defects.set(defect.id, defect);
  const categories = ["semantic-error", "synchronization-omission", "technical-feasibility-omission", "external-fact-change"];
  const causes = Object.fromEntries(categories.map(c => [c, events ? [...defects.values()].filter(d => d.primary_cause === c).length : null]));
  const external = events ? [...defects.values()].filter(d => d.primary_cause === "external-fact-change").length : null;
  return { version: "1", workflow_id: ctx.workflow_id, module_id: ctx.module_id || null, scope: ctx.scope,
    html_errors: ui?.html_errors ?? null, unresolved_rule_conflicts: rules ? 0 : null, open_delivery_blockers: delivery ? 0 : null,
    region_traceability: coverage(ui?.traced_count, ui?.region_count), high_risk_rule_coverage: coverage(rules?.checked_count, rules?.expected_count),
    delivery_state: delivery?.delivery_state ?? "unknown", deliveries: events?.deliveries || null,
    unique_return_defects: events ? defects.size : null, return_causes: causes,
    external_change_share: coverage(external, events ? defects.size : null), defects: events ? [...defects.values()] : null,
    evidence_paths: valid.map(e => e.evidence_path), diagnostics };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); if (args[0] !== "metrics") throw new Error("usage: quality metrics [--module <id>]");
    const module = args.includes("--module") ? args[args.indexOf("--module") + 1] : undefined;
    const state = loadWorkflowView(process.cwd(), module); if (!state) throw new Error("workflow state missing");
    console.log(JSON.stringify(qualityMetrics({ root: process.cwd(), workflow_id: state.workflow_id, project_workflow_id: state.parent_workflow_id || state.workflow_id, module_id: module || state.current_module, scope: state.scope, stage: state.current_stage, ui_route: "not-selected", quality_version: state.quality_gates_version }), null, 2));
  } catch (error) { console.error(String(error)); process.exitCode = 2; }
}
