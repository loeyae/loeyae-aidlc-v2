/**
 * Deterministic progressive stage-rule loading for MARS-161 Phase 4.
 *
 * A plan is a read-only projection of the same profile-aware selector used by
 * execution.  It never changes which stages execute.  Instead, it tells a
 * hand-off consumer which selected stage instructions are relevant now and
 * which remain deferred until their own stage is dispatched.
 */

import type { ExecutionProfile } from "./aidlc-execution-profile";
import type { StageGraph, StageNode } from "./aidlc-orchestrate";
import { selectExecutableStages } from "./aidlc-stage-selection";

export type RuleLoadPlanProfileProvenance =
  | "persisted_execution_profile"
  | "legacy_standard_default";

export type RuleLoadReason = "current_stage" | "selected_dependency" | "deferred_selected_stage";

export interface RuleLoadPlanProfile {
  readonly level: ExecutionProfile["level"];
  readonly provenance: RuleLoadPlanProfileProvenance;
}

export interface RuleLoadPlanEntry {
  readonly slug: string;
  /** Repository-relative instruction path, deliberately POSIX-stable. */
  readonly stage_file: string;
  readonly mandatory: boolean;
  readonly reason: RuleLoadReason;
}

export interface RuleLoadPlan {
  readonly version: "1";
  readonly strategy: "selected_stage_rules_progressively";
  readonly scope: string;
  readonly profile: RuleLoadPlanProfile;
  /** Every rule file selected by the executor, in graph order. */
  readonly selected: readonly RuleLoadPlanEntry[];
  /** Rule files to load for this hand-off: the target and its selected ancestors. */
  readonly load_now: readonly RuleLoadPlanEntry[];
  /** Selected rule files deliberately deferred to their own future hand-off. */
  readonly deferred: readonly RuleLoadPlanEntry[];
}

export interface BuildRuleLoadPlanInput {
  readonly scope: string;
  readonly selectedOptionalStages?: readonly string[];
  readonly executionProfile?: ExecutionProfile;
  /** Omit to produce a read-only workflow-wide plan with no immediate target. */
  readonly targetStageSlug?: string;
}

function profileForPlan(profile: ExecutionProfile | undefined): RuleLoadPlanProfile {
  return profile === undefined
    ? { level: "standard", provenance: "legacy_standard_default" }
    : { level: profile.level, provenance: "persisted_execution_profile" };
}

function stageFile(stage: StageNode): string {
  // Stage graph paths are repository-relative and use '/' on every platform.
  return `core/${stage.file}`;
}

function requiredBySelectedStages(selected: readonly StageNode[]): ReadonlySet<string> {
  const required = new Set<string>();
  for (const stage of selected) {
    for (const slug of stage.requires) required.add(slug);
    for (const slug of stage.cross_module_requires ?? []) required.add(slug);
  }
  return required;
}

function mandatory(stage: StageNode, required: ReadonlySet<string>): boolean {
  return stage.completion_contract === "gated"
    || stage.approval === "block"
    || stage.sensors.length > 0
    || stage.produces.length > 0
    || required.has(stage.slug);
}

function dependencyClosure(target: StageNode, selectedBySlug: ReadonlyMap<string, StageNode>, declaredSlugs: ReadonlySet<string>): ReadonlySet<string> {
  const closure = new Set<string>();
  const visit = (stage: StageNode): void => {
    if (closure.has(stage.slug)) return;
    closure.add(stage.slug);
    for (const dependency of [...stage.requires, ...(stage.cross_module_requires ?? [])]) {
      const dependencyStage = selectedBySlug.get(dependency);
      // A selected stage whose declared dependency is absent is not safe to
      // hand off.  Fail closed rather than quietly weakening its instructions.
      if (dependencyStage === undefined) {
        // Match execution's explicit scope waiver: excluded optional stages do
        // not need rule files in express/bugfix/refactor. Selected dependencies
        // still load normally, and an undeclared omission still fails closed.
        if (declaredSlugs.has(dependency) && stage.scope_waived_requires?.includes(dependency)) continue;
        throw new Error(
          `Selected stage "${stage.slug}" requires rule file for unselected stage "${dependency}"`,
        );
      }
      visit(dependencyStage);
    }
  };
  visit(target);
  return closure;
}

/**
 * Build a typed rule-load plan from the actual Phase-3 selector output.
 *
 * Standard, complex and legacy workflows retain the complete historical
 * selected set.  A lightweight workflow has less context only when Phase 3
 * has safely removed a graph-proven instruction-only stage from that set.
 */
export function buildRuleLoadPlan(graph: StageGraph, input: BuildRuleLoadPlanInput): RuleLoadPlan {
  if (!graph || !Array.isArray(graph.stages)) {
    throw new TypeError("Rule load plan requires a graph with a stages array");
  }
  if (typeof input.scope !== "string" || input.scope.length === 0) {
    throw new TypeError("Rule load plan scope must be a non-empty string");
  }
  if (input.selectedOptionalStages !== undefined && !Array.isArray(input.selectedOptionalStages)) {
    throw new TypeError("selectedOptionalStages must be an array when provided");
  }
  if (input.targetStageSlug !== undefined && (typeof input.targetStageSlug !== "string" || input.targetStageSlug.length === 0)) {
    throw new TypeError("targetStageSlug must be a non-empty string when provided");
  }

  const selected = selectExecutableStages(
    graph.stages,
    input.scope,
    input.selectedOptionalStages,
    input.executionProfile,
  );
  const selectedBySlug = new Map(selected.map((stage) => [stage.slug, stage]));
  const target = input.targetStageSlug === undefined ? undefined : selectedBySlug.get(input.targetStageSlug);
  if (input.targetStageSlug !== undefined && target === undefined) {
    throw new Error(`Rule load target "${input.targetStageSlug}" is not selected by the current workflow`);
  }

  const required = requiredBySelectedStages(selected);
  const immediateSlugs = target === undefined ? new Set<string>() : dependencyClosure(target, selectedBySlug, new Set(graph.stages.map(stage => stage.slug)));
  const selectedEntries = selected.map((stage): RuleLoadPlanEntry => ({
    slug: stage.slug,
    stage_file: stageFile(stage),
    mandatory: mandatory(stage, required),
    reason: immediateSlugs.has(stage.slug)
      ? stage.slug === target?.slug ? "current_stage" : "selected_dependency"
      : "deferred_selected_stage",
  }));

  return {
    version: "1",
    strategy: "selected_stage_rules_progressively",
    scope: input.scope,
    profile: profileForPlan(input.executionProfile),
    selected: selectedEntries,
    load_now: selectedEntries.filter((entry) => immediateSlugs.has(entry.slug)),
    deferred: selectedEntries.filter((entry) => !immediateSlugs.has(entry.slug)),
  };
}
