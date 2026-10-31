/**
 * Shared graph-only stage selection for MARS-161 Phase 3.
 *
 * This deliberately has no WorkflowState dependency so the executor and the
 * read-only StagePlan cannot drift.  The lightweight slice is conservative:
 * graph gates, blocking approvals, sensors, produced evidence, and dependency
 * roots are never removed.
 */

import type { ExecutionProfile } from "./aidlc-execution-profile";

export interface SelectableStage {
  readonly slug: string;
  readonly execution: string;
  readonly selection: string;
  readonly scopes: readonly string[];
  readonly completion_contract: string;
  readonly approval: string;
  readonly sensors: readonly string[];
  readonly produces: readonly string[];
  readonly requires: readonly string[];
  readonly cross_module_requires?: readonly string[];
}

/** Explicit risk facts require design and validation even in a normally small scope. */
export function riskRequiredStages(profile?: ExecutionProfile): Set<string> {
  const required = new Set<string>();
  for (const risk of profile?.active_risks || []) {
    if (risk === "provider_or_mandatory_gate") continue;
    for (const slug of ["requirements-analysis", "user-stories", "workflow-planning", "application-design", "functional-design"]) required.add(slug);
    if (["security_or_sensitive_data", "unknown_impact_boundary", "irreversible_change", "compatibility_or_rollback_risk"].includes(risk)) {
      required.add("nfr-requirements"); required.add("nfr-design");
    }
    if (["cross_module_dependency", "external_contract_changed", "architecture_or_cross_service_change", "data_schema_or_migration", "unknown_impact_boundary"].includes(risk)) required.add("units-generation");
    // Unit generation establishes whether there are shared contracts. The baseline
    // remains conditional on actual inter-unit dependencies, including single-unit changes.
  }
  return required;
}

export function selectExecutableStages<T extends SelectableStage>(
  stages: readonly T[],
  scope: string,
  selectedOptionalStages: readonly string[] = [],
  executionProfile?: ExecutionProfile,
): T[] {
  const optional = new Set(selectedOptionalStages);
  const required = riskRequiredStages(executionProfile);
  const visit = (slug: string): void => {
    const stage = stages.find(candidate => candidate.slug === slug);
    for (const dependency of [...(stage?.requires || []), ...(stage?.cross_module_requires || [])]) {
      if (!required.has(dependency)) { required.add(dependency); visit(dependency); }
    }
  };
  for (const slug of [...required]) visit(slug);
  const scopeSelected = stages.filter((stage) =>
    (required.has(stage.slug) || stage.execution === "ALWAYS" || stage.scopes.includes(scope))
    && (stage.selection !== "user" || optional.has(stage.slug)),
  );

  // Profile absence is the legacy compatibility path.  Standard and complex
  // intentionally retain exact graph semantics too.
  if (executionProfile?.level !== "lightweight") return scopeSelected;

  const requiredBySelectedStage = new Set<string>();
  for (const stage of scopeSelected) {
    for (const dependency of stage.requires) requiredBySelectedStage.add(dependency);
    for (const dependency of stage.cross_module_requires ?? []) requiredBySelectedStage.add(dependency);
  }

  return scopeSelected.filter((stage) => !(
    // The graph itself is the allowlist.  This is the only class Phase 3 may
    // elide: automatic ALWAYS instruction acknowledgements that neither
    // produce evidence, require blocking approval, nor gate another selected
    // stage.
    stage.execution === "ALWAYS"
    && stage.selection === "automatic"
    && stage.completion_contract === "instruction_only"
    && stage.approval !== "block"
    && stage.sensors.length === 0
    && stage.produces.length === 0
    && !requiredBySelectedStage.has(stage.slug)
  ));
}
