/**
 * Read-only release measurements for MARS-161 Phase 6.
 *
 * These measurements make selector parity, legacy compatibility, and the
 * lightweight reduction observable. They are deliberately not a release gate:
 * report, evidence, sensor, and approval authority remains in the workflow
 * engine.
 */

import type { ExecutionProfile } from "./aidlc-execution-profile";
import type { StageGraph } from "./aidlc-orchestrate";
import { buildRuleLoadPlan } from "./aidlc-rule-load-plan";
import { selectExecutableStages } from "./aidlc-stage-selection";

export type ExecutionProfileMeasurementProvenance =
  | "persisted_execution_profile"
  | "legacy_standard_default";

export interface ExecutionProfileMigrationMeasurement {
  /** Whether this WorkflowState physically contains execution_profile. */
  readonly execution_profile_present: boolean;
  /** Legacy state is interpreted conservatively without a write-back migration. */
  readonly policy: "legacy_read_without_migration";
  readonly state_write_performed: false;
}

export interface ExecutionProfileRegressionMeasurement {
  /** Historical selector output, which legacy/standard/complex must retain. */
  readonly historical_selected_stage_slugs: readonly string[];
  readonly measured_selected_stage_slugs: readonly string[];
  readonly omitted_stage_slugs: readonly string[];
  readonly historical_selected_stage_count: number;
  readonly measured_selected_stage_count: number;
  readonly legacy_standard_parity: boolean;
  /** Every currently selected mandatory rule remains in the selected rule plan. */
  readonly mandatory_rule_slugs: readonly string[];
  readonly mandatory_rules_retained: boolean;
}

export interface ExecutionProfileReleaseMeasurements {
  readonly version: "1";
  readonly strategy: "read_only_execution_profile_release_measurements";
  readonly advisory: true;
  readonly scope: string;
  readonly profile: {
    readonly level: ExecutionProfile["level"];
    readonly provenance: ExecutionProfileMeasurementProvenance;
  };
  readonly migration: ExecutionProfileMigrationMeasurement;
  readonly regression: ExecutionProfileRegressionMeasurement;
  /** Informational only: no field in this object authorizes a workflow transition. */
  readonly release_authority: "not_a_gate";
}

export interface BuildExecutionProfileReleaseMeasurementsInput {
  readonly scope: string;
  readonly selectedOptionalStages?: readonly string[];
  readonly executionProfile?: ExecutionProfile;
}

function selectedSlugs(
  graph: StageGraph,
  input: BuildExecutionProfileReleaseMeasurementsInput,
  profile: ExecutionProfile | undefined,
): string[] {
  const optionalStages = input.selectedOptionalStages ?? [];
  return selectExecutableStages(
    graph.stages,
    input.scope,
    optionalStages,
    profile,
  ).map((stage) => stage.slug);
}

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function historicalMandatoryRuleSlugs(graph: StageGraph, input: BuildExecutionProfileReleaseMeasurementsInput): string[] {
  return buildRuleLoadPlan(graph, {
    scope: input.scope,
    ...(input.selectedOptionalStages !== undefined
      ? { selectedOptionalStages: input.selectedOptionalStages }
      : {}),
    // Measure retention against the complete historical rule surface rather
    // than against the current profile's already-reduced result. Deliberately
    // omit executionProfile rather than assigning undefined: this is also
    // compatible with exactOptionalPropertyTypes.
  }).selected.filter((entry) => entry.mandatory).map((entry) => entry.slug);
}

/**
 * Produce a deterministic, non-mutating release observation. The historical
 * baseline intentionally omits executionProfile: that is the same
 * conservative legacy interpretation used by the executor.
 */
export function buildExecutionProfileReleaseMeasurements(
  graph: StageGraph,
  input: BuildExecutionProfileReleaseMeasurementsInput,
): ExecutionProfileReleaseMeasurements {
  if (!graph || !Array.isArray(graph.stages)) {
    throw new TypeError("Execution-profile measurements require a graph with a stages array");
  }
  if (typeof input.scope !== "string" || input.scope.length === 0) {
    throw new TypeError("Execution-profile measurements scope must be a non-empty string");
  }
  if (input.selectedOptionalStages !== undefined && !Array.isArray(input.selectedOptionalStages)) {
    throw new TypeError("selectedOptionalStages must be an array when provided");
  }

  const historical = selectedSlugs(graph, input, undefined);
  const measured = selectedSlugs(graph, input, input.executionProfile);
  const mandatory = historicalMandatoryRuleSlugs(graph, input);
  const measuredSet = new Set(measured);

  return {
    version: "1",
    strategy: "read_only_execution_profile_release_measurements",
    advisory: true,
    scope: input.scope,
    profile: input.executionProfile === undefined
      ? { level: "standard", provenance: "legacy_standard_default" }
      : { level: input.executionProfile.level, provenance: "persisted_execution_profile" },
    migration: {
      execution_profile_present: input.executionProfile !== undefined,
      policy: "legacy_read_without_migration",
      state_write_performed: false,
    },
    regression: {
      historical_selected_stage_slugs: historical,
      measured_selected_stage_slugs: measured,
      omitted_stage_slugs: historical.filter((slug) => !measuredSet.has(slug)),
      historical_selected_stage_count: historical.length,
      measured_selected_stage_count: measured.length,
      legacy_standard_parity: input.executionProfile === undefined || input.executionProfile.level !== "lightweight"
        ? sameSequence(historical, measured)
        : true,
      mandatory_rule_slugs: mandatory,
      mandatory_rules_retained: mandatory.every((slug) => measuredSet.has(slug)),
    },
    release_authority: "not_a_gate",
  };
}
