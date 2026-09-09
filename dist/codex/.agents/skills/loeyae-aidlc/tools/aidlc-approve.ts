import { createInterface } from "readline/promises";
import { stdin, stdout } from "process";
import { existsSync, readFileSync, realpathSync } from "fs";
import { approvalToken } from "./aidlc-trust";
import { buildApprovalProviderRequest } from "./aidlc-approval-provider";
import { loadWorkflowState, saveWorkflowState, statePath, type WorkflowState } from "./aidlc-state";
import { loadWorkflowStateV3 } from "./aidlc-state-v3-store";
import type { WorkflowStateV3 } from "./aidlc-state-v3";

function flag(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function schemaVersion(root: string): 2 | 3 {
  const filename = statePath(root);
  if (!existsSync(filename)) throw new Error("no workflow state found");
  const value = JSON.parse(readFileSync(filename, "utf8")) as { schema_version?: unknown };
  if (value.schema_version !== 2 && value.schema_version !== 3) throw new Error("workflow state has an unsupported schema_version");
  return value.schema_version;
}

function compatibilityState(state: WorkflowStateV3, stage: string, stageInstance: string): WorkflowState {
  const instance = state.instances[stageInstance];
  if (!instance || instance.stage !== stage || instance.status !== "in_progress") {
    throw new Error(`stage instance ${stageInstance} is not an active running ${stage} instance`);
  }
  const challenge = instance.approval?.challenge;
  return {
    schema_version: 2,
    version: state.version,
    workflow_id: state.workflow_id,
    revision: state.revision,
    scope: state.scope,
    depth: state.depth,
    current_phase: state.current_phase,
    current_stage: stage,
    current_stage_instance: stageInstance,
    current_module: instance.module_id,
    current_unit: instance.unit_id,
    status: state.status,
    completed_stages: [],
    skipped_stages: [],
    approval_challenges: challenge ? { [stageInstance]: challenge } : {},
    history: structuredClone(state.history),
    created_at: state.created_at,
    updated_at: state.updated_at,
    routing_model: "module-unit-v1",
    completed_stage_instances: [...state.completed_stage_instances],
    skipped_stage_instances: [...state.skipped_stage_instances],
    selected_optional_stages: [...state.selected_optional_stages],
  };
}

async function main(): Promise<void> {
  const stage = flag("stage");
  if (!stage) throw new Error("approval requires --stage <slug>");
  const root = realpathSync(process.cwd());
  const schema = schemaVersion(root);
  const requestedInstance = flag("instance");
  let state: WorkflowState;
  let persistExpiredChallenge = false;
  if (schema === 3) {
    if (!requestedInstance) throw new Error("schema v3 approval requires --instance <stage-instance>");
    const collaborative = loadWorkflowStateV3(root);
    if (!collaborative || collaborative.status !== "running") throw new Error("schema v3 workflow is not running");
    state = compatibilityState(collaborative, stage, requestedInstance);
  } else {
    const legacy = loadWorkflowState(root);
    if (!legacy || legacy.status !== "running" || legacy.current_stage !== stage) {
      throw new Error(`stage ${stage} is not the active running stage`);
    }
    state = legacy;
    persistExpiredChallenge = true;
  }
  const approvalStage = state.current_stage_instance || stage;
  const challenge = state.approval_challenges[approvalStage];
  if (!challenge) throw new Error(`stage instance ${approvalStage} has no active approval challenge; run orchestrate next first`);
  const issuedAt = Number(challenge.split(".", 1)[0]);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 15 * 60 * 1000 || issuedAt > Date.now() + 60 * 1000) {
    if (persistExpiredChallenge) {
      delete state.approval_challenges[approvalStage];
      saveWorkflowState(root, state);
    }
    throw new Error("approval challenge expired; run orchestrate next again");
  }

  const request = buildApprovalProviderRequest(state, stage);
  if (hasFlag("request")) {
    stdout.write(`${JSON.stringify(request, null, 2)}\n`);
    return;
  }

  if (!stdin.isTTY || !stdout.isTTY) throw new Error("approval token issuance requires an interactive human terminal");
  const phrase = request.confirmation_phrase;
  stdout.write(`Review the stage artifacts and decision before approving.\nActive context: module=${request.module_id || "-"}, unit=${request.unit_id || "-"}\nType exactly: ${phrase}\n`);
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    const response = await reader.question("> ");
    if (response.trim() !== phrase) throw new Error("approval phrase did not match; no token issued");
  } finally {
    reader.close();
  }
  stdout.write(`${JSON.stringify({ stage, stage_instance: request.stage_instance, module_id: request.module_id, unit_id: request.unit_id, approval_token: approvalToken(request.workflow_id, request.stage_instance, request.challenge), expires_in_seconds: Math.max(0, Math.floor((new Date(request.expires_at).getTime() - Date.now()) / 1000)) }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ kind: "error", message: error instanceof Error ? error.message : String(error) })}\n`);
  process.exit(2);
});
