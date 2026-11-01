/**
 * Advisory stage planning for MARS-161 Phase 2.
 *
 * This module mirrors existing graph selection semantics. It does not decide
 * whether a stage may execute, waive a gate, or alter evidence requirements.
 */

import type { StageGraph, StageNode } from "./aidlc-orchestrate";
import type { ExecutionProfile, ExecutionProfileLevel } from "./aidlc-execution-profile";
import { riskRequiredStages, selectExecutableStages } from "./aidlc-stage-selection";

export type StagePlanProfileProvenance =
  | "persisted_execution_profile"
  | "legacy_standard_default";

export type StagePlanReason =
  | "required_by_graph"
  | "risk_required"
  | "risk_dependency"
  | "scope_matches"
  | "optional_stage_selected"
  | "scope_not_applicable"
  | "optional_stage_not_selected"
  | "lightweight_instruction_only";

export interface StagePlanProfile {
  readonly level: ExecutionProfileLevel;
  readonly provenance: StagePlanProfileProvenance;
  readonly source: ExecutionProfile["source"] | "legacy_conservative";
  readonly primary_reason: ExecutionProfile["primary_reason"] | "legacy_conservative";
  readonly active_risks: readonly ExecutionProfile["active_risks"][number][];
}

export interface StagePlanEntry {
  readonly slug: string;
  readonly number: string;
  readonly phase: string;
  readonly axis: StageNode["axis"];
  readonly disposition: "selected" | "skipped";
  readonly required: boolean;
  readonly reason: StagePlanReason;
}

export interface StagePlan {
  readonly version: "1";
  readonly advisory: true;
  readonly selection_policy: "profile_aware_graph_semantics";
  readonly scope: string;
  readonly profile: StagePlanProfile;
  readonly selected: readonly StagePlanEntry[];
  readonly required: readonly StagePlanEntry[];
  readonly skipped: readonly StagePlanEntry[];
}

export interface BuildStagePlanInput {
  readonly scope: string;
  readonly selectedOptionalStages?: readonly string[];
  readonly executionProfile?: ExecutionProfile;
}

function profileForPlan(profile: ExecutionProfile | undefined): StagePlanProfile {
  if (profile !== undefined) {
    return {
      level: profile.level,
      provenance: "persisted_execution_profile",
      source: profile.source,
      primary_reason: profile.primary_reason,
      active_risks: [...profile.active_risks],
    };
  }

  // A state without a profile predates Phase 1. Interpret it conservatively
  // without writing a migration back to the Markdown workflow state.
  return {
    level: "standard",
    provenance: "legacy_standard_default",
    source: "legacy_conservative",
    primary_reason: "legacy_conservative",
    active_risks: [],
  };
}

function entry(
  stage: StageNode,
  disposition: StagePlanEntry["disposition"],
  required: boolean,
  reason: StagePlanReason,
): StagePlanEntry {
  return {
    slug: stage.slug,
    number: stage.number,
    phase: stage.phase,
    axis: stage.axis,
    disposition,
    required,
    reason,
  };
}

/**
 * Build a deterministic, read-only projection of graph selection.
 *
 * The production selector owns the candidate set, including risk dependency
 * closure and the lightweight slice. This projection only explains selection;
 * stage conditions and user choices are still evaluated by the executor.
 */
export function buildStagePlan(graph: StageGraph, input: BuildStagePlanInput): StagePlan {
  if (!graph || !Array.isArray(graph.stages)) {
    throw new TypeError("Stage plan requires a graph with a stages array");
  }
  if (typeof input.scope !== "string" || input.scope.length === 0) {
    throw new TypeError("Stage plan scope must be a non-empty string");
  }
  if (input.selectedOptionalStages !== undefined && !Array.isArray(input.selectedOptionalStages)) {
    throw new TypeError("selectedOptionalStages must be an array when provided");
  }

  const optional = new Set(input.selectedOptionalStages ?? []);
  const requiredByRisk = riskRequiredStages(input.executionProfile);
  const executable = new Set(
    selectExecutableStages(
      graph.stages,
      input.scope,
      input.selectedOptionalStages,
      input.executionProfile,
    ).map((stage) => stage.slug),
  );
  const selected: StagePlanEntry[] = [];
  const required: StagePlanEntry[] = [];
  const skipped: StagePlanEntry[] = [];

  for (const stage of graph.stages) {
    const scopeEligible = stage.execution === "ALWAYS" || stage.scopes.includes(input.scope);
    const optionalSelected = stage.selection !== "user" || optional.has(stage.slug);
    if (!executable.has(stage.slug)) {
      const reason: StagePlanReason = !scopeEligible
        ? "scope_not_applicable"
        : !optionalSelected
          ? "optional_stage_not_selected"
          : "lightweight_instruction_only";
      skipped.push(entry(stage, "skipped", false, reason));
      continue;
    }

    // Scope-external candidates can only be introduced by the selector's risk
    // closure. Do not independently traverse that closure or reapply scope
    // eligibility: either would let the advisory view drift from execution.
    const isRequired = stage.execution === "ALWAYS" || requiredByRisk.has(stage.slug) || !scopeEligible;
    const reason: StagePlanReason = stage.execution === "ALWAYS"
      ? "required_by_graph"
      : requiredByRisk.has(stage.slug)
        ? "risk_required"
        : !scopeEligible
          ? "risk_dependency"
          : stage.selection === "user"
            ? "optional_stage_selected"
            : "scope_matches";
    const planned = entry(stage, "selected", isRequired, reason);
    selected.push(planned);
    if (isRequired) required.push(planned);
  }

  return {
    version: "1",
    advisory: true,
    selection_policy: "profile_aware_graph_semantics",
    scope: input.scope,
    profile: profileForPlan(input.executionProfile),
    selected,
    required,
    skipped,
  };
}
