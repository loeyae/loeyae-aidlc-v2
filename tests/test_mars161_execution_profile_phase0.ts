import assert from "node:assert/strict";
import {
  createInitialState,
  parseLightWorkflowState,
  renderLightWorkflowState,
  type WorkflowState,
} from "../core/tools/aidlc-light-state";
import {
  extractOwnedState,
  mergeWorkflowView,
  type WorkflowPart,
} from "../core/tools/aidlc-workflow-layout";

/*
 * Phase 0 characterization coverage for the execution-profile rollout.
 *
 * No execution_profile parser or renderer exists yet. These checks pin the
 * compatibility and ownership contracts that Phase 1 must retain:
 * - Markdown created before the field was introduced remains readable and an
 *   ordinary parse/render cycle does not synthesize the field.
 * - Global-lineage scalars remain from the global state in a merged module
 *   view, and extractOwnedState does not copy them into module state.
 */

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * A Phase 0-only structural stand-in for the persisted shape introduced in
 * Phase 1. Keeping it local ensures this characterization test does not
 * prematurely change production WorkflowState types.
 */
interface FutureExecutionProfileSentinel {
  readonly level: "standard";
  readonly source: "scope_default";
  readonly primary_reason: "scope_default";
  readonly active_risks: readonly [];
  readonly events: readonly [];
}

type WorkflowStateWithFutureExecutionProfile = WorkflowState & {
  readonly execution_profile: FutureExecutionProfileSentinel;
};

const EXECUTION_PROFILE_SENTINEL: FutureExecutionProfileSentinel = {
  level: "standard",
  source: "scope_default",
  primary_reason: "scope_default",
  active_risks: [],
  events: [],
};

const EXECUTION_PROFILE_MARKER = "## Execution Profile";

// This is deliberately a literal document from before the execution-profile
// rollout. Do not generate it with createInitialState/renderLightWorkflowState:
// that would make the compatibility assertion circular.
const HISTORICAL_WORKFLOW_STATE = `# AI-DLC Lightweight Workflow

> AWS-style lightweight collaboration controlled by this Markdown state and its audit log.

- Workflow ID: workflow-phase0-historical
- Work: Fix legacy retry behaviour
- Scope: bugfix
- Status: running
- Revision: 7
- Engine Version: 4.13.0
- Depth: light
- Current Phase: implementation
- Current Stage: code-generation
- Current Instance: -
- Current Module: -
- Current Unit: -
- Created At: 2026-01-15T08:30:00.000Z
- Updated At: 2026-01-15T09:45:00.000Z

## Selected Optional Stages
- (none)

## Completed Stages
- workspace-detection

## Skipped Stages
- (none)

## Completed Stage Instances
- (none)

## Skipped Stage Instances
- (none)

## Unit Selections
| Unit | Member | Selected At | Branch | Note |
| --- | --- | --- | --- | --- |
| - | - | - | - | - |

## Module Selections
| Module | Owner | Selected At | Branch | Worktree | Note |
| --- | --- | --- | --- | --- | --- |
| - | - | - | - | - | - |

## Active Instances
| Stage Instance | Module | Owner | Branch | Worktree | Claimed At | Heartbeat At | Expires At |
| --- | --- | --- | --- | --- | --- | --- | --- |
| - | - | - | - | - | - | - | - |

## History
| Stage | Instance | Module | Unit | Result | Timestamp | Input |
| --- | --- | --- | --- | --- | --- | --- |
| workspace-detection | - | - | - | complete | 2026-01-15T08:35:00.000Z | - |
`;

{
  const parsed = parseLightWorkflowState(HISTORICAL_WORKFLOW_STATE);
  const parsedRecord = parsed as WorkflowState & Record<string, unknown>;
  const rendered = renderLightWorkflowState(parsed);

  assert.equal(
    hasOwn(parsedRecord, "execution_profile"),
    false,
    "legacy WorkflowState must remain readable without execution_profile",
  );
  assert.equal(
    rendered.includes(EXECUTION_PROFILE_MARKER),
    false,
    "ordinary legacy state rendering must not synthesize the execution_profile marker",
  );
  assert.equal(
    hasOwn(
      parseLightWorkflowState(rendered) as WorkflowState & Record<string, unknown>,
      "execution_profile",
    ),
    false,
    "parse/render round-trip must retain execution_profile absence",
  );
}

{
  const global: WorkflowState = {
    ...createInitialState(
      "feature",
      "4.14.1",
      "workflow-phase0-global",
      [],
      "Global workflow",
    ),
    workflow_kind: "global",
    baseline_commit: "a".repeat(40),
    baseline_source: "created",
    retired_lineages: ["retired-lineage-01"],
  };
  const globalWithProfile = {
    ...global,
    execution_profile: EXECUTION_PROFILE_SENTINEL,
  } as WorkflowStateWithFutureExecutionProfile;
  const moduleState: WorkflowState = {
    ...createInitialState(
      "feature",
      "4.14.1",
      "workflow-phase0-module",
      [],
      "Module workflow",
    ),
    workflow_kind: "module",
    module_id: "m01-core",
    parent_workflow_id: global.workflow_id,
    current_stage: "requirements-analysis",
  };
  const parts = new Map<string, WorkflowPart>([
    ["global", { ref: { kind: "global" }, state: globalWithProfile }],
    ["module:m01-core", { ref: { kind: "module", module_id: "m01-core" }, state: moduleState }],
  ]);

  const view = mergeWorkflowView(parts, { kind: "module", module_id: "m01-core" });
  const futureView = view as WorkflowState & {
    readonly execution_profile?: FutureExecutionProfileSentinel;
  };
  assert.equal(view.workflow_id, moduleState.workflow_id, "the current owner supplies workflow identity");
  assert.equal(view.baseline_commit, global.baseline_commit, "global lineage scalar survives merged module view");
  assert.deepEqual(view.retired_lineages, global.retired_lineages, "global lineage list survives merged module view");
  assert.deepEqual(
    futureView.execution_profile,
    EXECUTION_PROFILE_SENTINEL,
    "global execution_profile is visible in a merged module view",
  );

  const owned = extractOwnedState(view, moduleState, { kind: "module", module_id: "m01-core" });
  const ownedRecord = owned as WorkflowState & Record<string, unknown>;
  assert.equal(hasOwn(ownedRecord, "baseline_commit"), false, "module persistence must not receive global baseline fields");
  assert.equal(hasOwn(ownedRecord, "retired_lineages"), false, "module persistence must not receive global lineage fields");
  assert.equal(
    hasOwn(ownedRecord, "execution_profile"),
    false,
    "module persistence must not receive the global execution_profile",
  );

  const globalOwned = extractOwnedState(view, globalWithProfile, { kind: "global" });
  const futureGlobalOwned = globalOwned as WorkflowState & {
    readonly execution_profile?: FutureExecutionProfileSentinel;
  };
  assert.deepEqual(
    futureGlobalOwned.execution_profile,
    EXECUTION_PROFILE_SENTINEL,
    "global-owned persistence retains execution_profile",
  );

  const freshModuleState = createInitialState(
    "feature",
    "4.14.1",
    "workflow-phase0-fresh-module",
    [],
    "Fresh module workflow",
  );
  assert.equal(
    hasOwn(freshModuleState, "execution_profile"),
    false,
    "fresh module state must not synthesize execution_profile before Phase 1",
  );
}

console.log("execution profile phase-0 characterization tests passed");
