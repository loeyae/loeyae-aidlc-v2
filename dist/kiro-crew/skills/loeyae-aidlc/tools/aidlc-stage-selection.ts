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

export function selectExecutableStages<T extends SelectableStage>(
  stages: readonly T[],
  scope: string,
  selectedOptionalStages: readonly string[] = [],
  executionProfile?: ExecutionProfile,
): T[] {
  const optional = new Set(selectedOptionalStages);
  const scopeSelected = stages.filter((stage) =>
    (stage.execution === "ALWAYS" || stage.scopes.includes(scope))
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
