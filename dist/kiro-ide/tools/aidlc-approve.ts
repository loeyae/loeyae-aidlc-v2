import { createInterface } from "readline/promises";
import { stdin, stdout } from "process";
import { realpathSync } from "fs";
import { approvalToken } from "./aidlc-trust";
import { buildApprovalProviderRequest } from "./aidlc-approval-provider";
import { loadWorkflowState, saveWorkflowState } from "./aidlc-state";

function flag(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

async function main(): Promise<void> {
  const stage = flag("stage");
  if (!stage) throw new Error("approval requires --stage <slug>");
  const root = realpathSync(process.cwd());
  const state = loadWorkflowState(root);
  if (!state || state.status !== "running" || state.current_stage !== stage) {
    throw new Error(`stage ${stage} is not the active running stage`);
  }
  const approvalStage = state.current_stage_instance || stage;
  const challenge = state.approval_challenges[approvalStage];
  if (!challenge) throw new Error(`stage instance ${approvalStage} has no active approval challenge; run orchestrate next first`);
  const issuedAt = Number(challenge.split(".", 1)[0]);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 15 * 60 * 1000 || issuedAt > Date.now() + 60 * 1000) {
    delete state.approval_challenges[approvalStage];
    saveWorkflowState(root, state);
    throw new Error("approval challenge expired; run orchestrate next again");
  }

  const request = buildApprovalProviderRequest(state, stage);
  if (hasFlag("request")) {
    stdout.write(`${JSON.stringify(request, null, 2)}\n`);
    return;
  }

  if (!stdin.isTTY || !stdout.isTTY) throw new Error("approval token issuance requires an interactive human terminal");
  const phrase = `APPROVE ${request.stage_instance} ${request.challenge.slice(-8)}`;
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
