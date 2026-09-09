import { createHash, randomBytes } from "crypto";
import { readFileSync, realpathSync } from "fs";
import { join } from "path";
import {
  architectureChoice,
  artifactRoot,
  buildConditionContext,
  checkConsumes,
  checkProduces,
  checkSensors,
  dependencyInstances,
  evaluateCondition,
  evidenceRoot,
  expandStageInstances,
  instanceArtifactPattern,
  loadGraph,
  runtimeChoices,
  runtimeInstance,
  type Directive,
  type StageGraph,
  type StageInstance,
} from "./aidlc-orchestrate";
import {
  findReadyInstances,
  nextReadyInstanceV3,
  reportInstanceV3,
  submitInstanceV3,
  synchronizeWorkflowInstancesV3,
  type WorkflowInstancePlanV3,
} from "./aidlc-scheduler-v3";
import {
  appendWorkflowEventV3,
  createInitialWorkflowStateV3,
  type WorkflowStateV3,
} from "./aidlc-state-v3";
import {
  initializeWorkflowStateV3,
  loadWorkflowStateV3,
  mutateWorkflowStateV3,
} from "./aidlc-state-v3-store";
import {
  LocalCoordinationProviderV3,
  assertClaimReceiptForStateV3,
  claimReceiptDigestV3,
  claimReceiptFromStateV3,
  validateClaimReceiptV3,
  type ClaimReceiptV3,
  type CoordinationIdentityV3,
} from "./aidlc-coordination-local-v3";
import { GitCoordinationProviderV3 } from "./aidlc-coordination-git-v3";
import {
  buildApprovalProviderRequest,
  validateApprovalConversationConfirmation,
  validateApprovalProviderResponse,
} from "./aidlc-approval-provider";
import { readEnrollment, verifyApprovalToken } from "./aidlc-trust";
import { readModuleManifest, readUnitManifest } from "./aidlc-execution-context";
import type { WorkflowState } from "./aidlc-state";

const PROJECT_ROOT = realpathSync(process.cwd());
const VALID_SCOPES = new Set(["feature", "enterprise", "mvp", "classic", "express", "workshop", "bugfix", "refactor", "poc"]);
const PRD_ELIGIBLE_SCOPES = new Set(["feature", "enterprise", "mvp", "classic"]);
const VALID_RESULTS = new Set(["completed", "approved", "rejected", "revised"]);
const APPROVAL_TTL_MS = 15 * 60 * 1000;

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      flags.text = `${flags.text ? `${flags.text} ` : ""}${argument}`;
      continue;
    }
    const key = argument.slice(2);
    if (flags[key] !== undefined) throw new Error(`duplicate option --${key}`);
    flags[key] = args[index + 1] && !args[index + 1].startsWith("--") ? args[++index] : "true";
  }
  return flags;
}

function booleanFlag(flags: Record<string, string>, name: string): boolean {
  if (!(name in flags)) return false;
  if (flags[name] !== "true") throw new Error(`--${name} is a boolean flag and does not accept a value`);
  return true;
}

function resolvedStatus(status: string): boolean {
  return status === "completed" || status === "skipped";
}

function stageSummaries(
  state: WorkflowStateV3,
  instances?: readonly StageInstance[],
): { completed: string[]; skipped: string[] } {
  const byStage = new Map<string, string[]>();
  if (instances) {
    for (const instance of instances) {
      const values = byStage.get(instance.stage.slug) || [];
      values.push(instance.instance_id);
      byStage.set(instance.stage.slug, values);
    }
  } else {
    for (const instance of Object.values(state.instances)) {
      const values = byStage.get(instance.stage) || [];
      values.push(instance.stage_instance);
      byStage.set(instance.stage, values);
    }
  }
  const completed: string[] = [];
  const skipped: string[] = [];
  for (const [stage, ids] of byStage) {
    if (ids.length === 0 || ids.some((id) => !state.instances[id] || !resolvedStatus(state.instances[id].status))) continue;
    if (ids.every((id) => state.instances[id].status === "skipped")) skipped.push(stage);
    else completed.push(stage);
  }
  return { completed, skipped };
}

function compatibilityState(
  state: WorkflowStateV3,
  focus?: StageInstance,
  expanded?: readonly StageInstance[],
): WorkflowState {
  const summaries = stageSummaries(state, expanded);
  return {
    schema_version: 2,
    version: state.version,
    workflow_id: state.workflow_id,
    revision: state.revision,
    scope: state.scope,
    depth: state.depth,
    current_phase: focus?.stage.phase || state.current_phase,
    current_stage: focus?.stage.slug || "",
    status: state.status,
    completed_stages: summaries.completed,
    skipped_stages: summaries.skipped,
    approval_challenges: { ...state.approval_challenges },
    history: structuredClone(state.history),
    created_at: state.created_at,
    updated_at: state.updated_at,
    routing_model: "module-unit-v1",
    ...(focus ? { current_stage_instance: focus.instance_id } : {}),
    ...(focus?.module_id ? { current_module: focus.module_id } : {}),
    ...(focus?.unit_id ? { current_unit: focus.unit_id } : {}),
    completed_stage_instances: [...state.completed_stage_instances],
    skipped_stage_instances: [...state.skipped_stage_instances],
    selected_optional_stages: [...state.selected_optional_stages],
  };
}

function buildPlan(state: WorkflowStateV3, graph: StageGraph): {
  plans: WorkflowInstancePlanV3[];
  instances: StageInstance[];
  compatibility: WorkflowState;
} {
  let compatibility = compatibilityState(state);
  let instances = expandStageInstances(graph, compatibility);
  compatibility = compatibilityState(state, undefined, instances);
  instances = expandStageInstances(graph, compatibility);
  compatibility = compatibilityState(state, undefined, instances);
  const plans = instances.map((instance, order) => {
    const requires: string[] = [];
    for (const dependency of instance.stage.requires || []) {
      const candidates = dependencyInstances(instance, dependency, instances);
      if (candidates.length === 0) {
        if (!instance.stage.scope_waived_requires.includes(dependency)) {
          throw new Error(`stage instance ${instance.instance_id} has unavailable required dependency ${dependency}`);
        }
        continue;
      }
      requires.push(...candidates.map((candidate) => candidate.instance_id));
    }
    const condition = instance.stage.condition?.trim();
    const conditionResult = condition
      ? evaluateCondition(condition, buildConditionContext(compatibility, instance))
      : true;
    if (conditionResult === undefined) throw new Error(`unknown stage condition "${condition}" on ${instance.instance_id}`);
    return {
      stage_instance: instance.instance_id,
      stage: instance.stage.slug,
      axis: instance.axis,
      module_id: instance.module_id,
      unit_id: instance.unit_id,
      requires: [...new Set(requires)],
      order,
      condition_met: conditionResult,
    };
  });
  return { plans, instances, compatibility };
}

function syncReadyFrontier(graph: StageGraph, occurredAt = new Date().toISOString()): WorkflowStateV3 {
  return mutateWorkflowStateV3(PROJECT_ROOT, (state) => {
    const { plans } = buildPlan(state, graph);
    return synchronizeWorkflowInstancesV3(state, plans, occurredAt, { registration: "ready-frontier" });
  });
}

function identityFromFlags(flags: Record<string, string>): CoordinationIdentityV3 {
  const actor = flags["actor-id"] || process.env.AIDLC_ACTOR_ID;
  const device = flags["device-id"] || process.env.AIDLC_DEVICE_ID;
  const client = flags["client-id"] || process.env.AIDLC_CLIENT_ID;
  if (!actor || !device || !client) {
    throw new Error("collaborative next requires actor/device/client identity via --actor-id/--device-id/--client-id or AIDLC_ACTOR_ID/AIDLC_DEVICE_ID/AIDLC_CLIENT_ID");
  }
  return { actor_id: actor, device_id: device, client_id: client };
}

function sameHolder(receipt: ClaimReceiptV3, identity: CoordinationIdentityV3): boolean {
  return receipt.actor_id === identity.actor_id
    && receipt.device_id === identity.device_id
    && receipt.client_id === identity.client_id;
}

function providerMode(flags: Record<string, string>): "local" | "git" {
  const value = flags["coordination-provider"] || process.env.AIDLC_COORDINATION_PROVIDER || "local";
  if (value !== "local" && value !== "git") throw new Error("coordination provider must be local or git");
  return value;
}

function gitProvider(flags: Record<string, string>, workflowId: string): GitCoordinationProviderV3 {
  const remote = flags["coordination-remote"] || process.env.AIDLC_COORDINATION_REMOTE;
  if (!remote) throw new Error("Git coordination requires --coordination-remote <url-or-path> or AIDLC_COORDINATION_REMOTE");
  return new GitCoordinationProviderV3({ remote, workflow_id: workflowId });
}

function ensureGitTerminalStatus(
  provider: GitCoordinationProviderV3,
  receipt: ClaimReceiptV3,
  expected: "completed" | "released",
  occurredAt: string,
): void {
  let terminal = provider.receiptTerminalStatus(receipt);
  if (terminal === expected) return;
  if (terminal) throw new Error(`Git coordination receipt is already ${terminal}, expected ${expected}`);
  try {
    if (expected === "completed") provider.complete(receipt, occurredAt);
    else provider.release(receipt, "Stage revision returned instance to ready", occurredAt);
  } catch (error) {
    terminal = provider.receiptTerminalStatus(receipt);
    if (terminal !== expected) throw error;
  }
}

function mirrorGitClaim(state: WorkflowStateV3, receipt: ClaimReceiptV3, occurredAt: string): WorkflowStateV3 {
  const current = state.instances[receipt.stage_instance];
  if (!current) throw new Error(`Git claim targets an unregistered local instance ${receipt.stage_instance}`);
  if (current.status === "in_progress" && current.claim?.claim_id === receipt.claim_id) return state;
  if (current.status !== "ready") throw new Error(`cannot mirror Git claim into local instance ${receipt.stage_instance} (${current.status})`);
  let next = appendWorkflowEventV3(state, {
    event_type: "instance_claimed",
    stage_instance: receipt.stage_instance,
    occurred_at: occurredAt,
    payload: {
      claim: {
        claim_id: receipt.claim_id,
        actor_id: receipt.actor_id,
        device_id: receipt.device_id,
        client_id: receipt.client_id,
        provider_id: receipt.provider_id,
        provider_receipt_digest: claimReceiptDigestV3(receipt),
        provider_receipt: receipt,
        claimed_at: receipt.issued_at,
        renewed_at: receipt.issued_at,
        lease_expires_at: receipt.lease_expires_at,
      },
    },
  });
  next = appendWorkflowEventV3(next, {
    event_type: "instance_started",
    stage_instance: receipt.stage_instance,
    occurred_at: occurredAt,
    payload: {},
  });
  return next;
}

function claimSelected(
  state: WorkflowStateV3,
  selected: string,
  identity: CoordinationIdentityV3,
  flags: Record<string, string>,
  occurredAt: string,
): { state: WorkflowStateV3; receipt: ClaimReceiptV3 } {
  if (providerMode(flags) === "local") {
    const provider = new LocalCoordinationProviderV3(PROJECT_ROOT);
    return provider.claim(selected, identity, provider.default_lease_ms, occurredAt);
  }
  const provider = gitProvider(flags, state.workflow_id);
  let receipt = provider.currentReceipt(selected, identity);
  if (!receipt) receipt = provider.claim(selected, identity, undefined, occurredAt).receipt;
  const mirrored = mutateWorkflowStateV3(PROJECT_ROOT, (current) => mirrorGitClaim(current, receipt!, occurredAt));
  return { state: mirrored, receipt };
}

function ensureApprovalChallenge(
  stage: StageInstance,
  stateValue: WorkflowStateV3,
  occurredAt: string,
): WorkflowStateV3 {
  if (stage.stage.approval !== "block") return stateValue;
  const existing = stateValue.instances[stage.instance_id]?.approval;
  const issuedAt = existing ? Number(existing.challenge.split(".", 1)[0]) : Number.NaN;
  if (existing && Number.isFinite(issuedAt) && Date.parse(occurredAt) - issuedAt <= APPROVAL_TTL_MS) return stateValue;
  return mutateWorkflowStateV3(PROJECT_ROOT, (state) => appendWorkflowEventV3(state, {
    event_type: "approval_requested",
    stage_instance: stage.instance_id,
    occurred_at: occurredAt,
    payload: { challenge: `${Date.parse(occurredAt)}.${randomBytes(24).toString("hex")}` },
  }));
}

function directiveFor(
  state: WorkflowStateV3,
  instanceValue: StageInstance,
  graph: StageGraph,
  allInstances: StageInstance[],
  receipt: ClaimReceiptV3,
  readyInstances: string[],
): Directive {
  const compatibility = compatibilityState(state, instanceValue, allInstances);
  const instance = runtimeInstance(instanceValue, compatibility);
  const stage = instance.stage;
  const consumeFailures = checkConsumes(instance, compatibility, graph, allInstances);
  if (consumeFailures.length > 0) {
    return {
      kind: "error",
      message: `🚫 Stage instance "${instance.instance_id}" is missing canonical consumed artifacts:\n${consumeFailures.map((failure) => `  ❌ ${failure}`).join("\n")}`,
    };
  }
  const choices = runtimeChoices(stage, compatibility);
  return {
    kind: "run-stage",
    schema_version: 3,
    stage: stage.slug,
    stage_instance: instance.instance_id,
    axis: instance.axis,
    module_id: instance.module_id || null,
    unit_id: instance.unit_id || null,
    artifact_root: artifactRoot(instance),
    evidence_root: evidenceRoot(instance),
    stage_file: join("core", stage.file),
    name: stage.name,
    number: stage.number,
    phase: stage.phase,
    lead_agent: stage.lead_agent,
    support_agents: stage.support_agents,
    mode: stage.mode,
    gate: stage.approval === "block",
    approval: stage.approval,
    completion_contract: stage.completion_contract,
    approval_challenge: state.instances[instance.instance_id]?.approval?.challenge,
    consumes: stage.consumes.map((pattern) => instanceArtifactPattern(pattern, instance, true)),
    produces: stage.produces.map((pattern) => instanceArtifactPattern(pattern, instance)),
    sensors: stage.sensors,
    choices,
    choice_required: choices.length > 0,
    ready_instances: readyInstances,
    client_focus: instance.instance_id,
    claim_receipt: receipt,
    report_transport: "Pass claim_receipt through --claim-receipt-stdin; do not substitute chat text.",
  };
}

async function handleNext(args: string[]): Promise<Directive> {
  const flags = parseFlags(args);
  const graph = loadGraph();
  const withPrd = booleanFlag(flags, "with-prd");
  const resume = booleanFlag(flags, "resume");
  const statusOnly = booleanFlag(flags, "status");
  const scope = flags.scope;
  if (scope && !VALID_SCOPES.has(scope)) throw new Error(`unknown scope ${scope}`);
  if (withPrd && (!scope || !PRD_ELIGIBLE_SCOPES.has(scope))) {
    throw new Error("--with-prd is only valid when initializing feature, enterprise, mvp, or classic scope");
  }

  let state = loadWorkflowStateV3(PROJECT_ROOT);
  if (!state) {
    if (!scope) {
      return {
        kind: "ask",
        question: "No active workflow found. Which scope should this workflow use?",
        options: [...VALID_SCOPES],
        ask_type: "scope-selection",
      } as unknown as Directive;
    }
    const enrollment = readEnrollment(PROJECT_ROOT);
    const pendingWorkflowId = enrollment?.status === "pending" ? enrollment.workflow_id : undefined;
    state = initializeWorkflowStateV3(
      PROJECT_ROOT,
      createInitialWorkflowStateV3(scope, "3.0.0", pendingWorkflowId, withPrd ? ["prd-generation"] : []),
    );
    return {
      kind: "print",
      schema_version: 3,
      message: `✅ Collaborative workflow initialized with schema v3 and scope: ${scope}. Run next again to claim a ready instance.`,
    };
  }
  if (scope || withPrd) throw new Error("scope and --with-prd can only be selected when initializing a new workflow");

  if (state.status === "parked") {
    if (!resume) return { kind: "parked", message: "Workflow is frozen. Pass --resume to resume scheduling." };
    state = mutateWorkflowStateV3(PROJECT_ROOT, (current) => appendWorkflowEventV3(current, {
      event_type: "workflow_resumed",
      occurred_at: new Date().toISOString(),
      payload: {},
    }));
  }
  if (state.status === "done") return { kind: "done", message: "Workflow is already complete." };

  state = new LocalCoordinationProviderV3(PROJECT_ROOT).expire(new Date().toISOString());
  state = syncReadyFrontier(graph);
  let plan = buildPlan(state, graph);
  const ready = findReadyInstances(state, plan.plans);
  const active = plan.plans.filter((candidate) => {
    const instance = state!.instances[candidate.stage_instance];
    return instance?.status === "in_progress" && instance.claim?.provider_receipt;
  });

  if (statusOnly) {
    return {
      kind: "print",
      schema_version: 3,
      workflow_id: state.workflow_id,
      status: state.status,
      revision: state.revision,
      ready_instances: ready.map((item) => item.stage_instance),
      active_instances: active.map((item) => item.stage_instance),
      completed_instances: [...state.completed_stage_instances],
      skipped_instances: [...state.skipped_stage_instances],
      message: `Schema v3 workflow: ${ready.length} ready, ${active.length} active, ${state.completed_stage_instances.length} completed.`,
    };
  }

  const identity = identityFromFlags(flags);
  const requested = flags.instance;
  let selectedId: string | undefined;
  let receipt: ClaimReceiptV3 | undefined;
  if (requested) {
    const current = state.instances[requested];
    if (current?.status === "in_progress" && current.claim?.provider_receipt) {
      const stored = claimReceiptFromStateV3(state, requested);
      if (!sameHolder(stored, identity)) throw new Error(`stage instance ${requested} is claimed by another actor/device/client`);
      selectedId = requested;
      receipt = stored;
    } else {
      selectedId = nextReadyInstanceV3(state, plan.plans, requested).selected.stage_instance;
    }
  } else {
    const owned = active
      .map((item) => ({ item, receipt: claimReceiptFromStateV3(state!, item.stage_instance) }))
      .find((item) => sameHolder(item.receipt, identity));
    if (owned) {
      selectedId = owned.item.stage_instance;
      receipt = owned.receipt;
    } else if (ready.length > 0) {
      selectedId = ready[0].stage_instance;
    }
  }

  if (!selectedId) {
    const allResolved = plan.plans.length > 0 && plan.plans.every((candidate) => resolvedStatus(state!.instances[candidate.stage_instance]?.status || ""));
    if (allResolved) {
      state = mutateWorkflowStateV3(PROJECT_ROOT, (current) => appendWorkflowEventV3(current, {
        event_type: "workflow_completed",
        occurred_at: new Date().toISOString(),
        payload: {},
      }));
      return { kind: "done", schema_version: 3, message: `🎉 All ${plan.plans.length} stage instances resolved. Workflow finished.` };
    }
    return {
      kind: "print",
      schema_version: 3,
      ready_instances: [],
      active_instances: active.map((item) => item.stage_instance),
      message: "No unclaimed ready instance is available. Wait for an active lease to complete, transfer, release, or expire.",
    };
  }

  const selectedInstance = plan.instances.find((instance) => instance.instance_id === selectedId);
  if (!selectedInstance) throw new Error(`selected stage instance disappeared from the deterministic plan: ${selectedId}`);
  const preflight = directiveFor(state, selectedInstance, graph, plan.instances, receipt || ({ } as ClaimReceiptV3), ready.map((item) => item.stage_instance));
  if (preflight.kind === "error") return preflight;
  const occurredAt = new Date().toISOString();
  if (!receipt) {
    const claimed = claimSelected(state, selectedId, identity, flags, occurredAt);
    state = claimed.state;
    receipt = claimed.receipt;
  }
  state = ensureApprovalChallenge(selectedInstance, state, occurredAt);
  plan = buildPlan(state, graph);
  return directiveFor(state, selectedInstance, graph, plan.instances, receipt, findReadyInstances(state, plan.plans).map((item) => item.stage_instance));
}

interface StdinPayload {
  claimReceipt: ClaimReceiptV3;
  approvalResponseRaw?: string;
  approvalConfirmationRaw?: string;
}

function readReportStdin(flags: Record<string, string>): StdinPayload {
  const claimStdin = booleanFlag(flags, "claim-receipt-stdin");
  const approvalStdin = booleanFlag(flags, "approval-response-stdin");
  const confirmationStdin = booleanFlag(flags, "approval-confirmation-stdin");
  if (!claimStdin) throw new Error("schema v3 report requires --claim-receipt-stdin");
  if (approvalStdin && confirmationStdin) {
    throw new Error("use exactly one approval stdin channel: --approval-confirmation-stdin or --approval-response-stdin");
  }
  const raw = readFileSync(0, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("claim receipt stdin must be valid JSON");
  }
  if (approvalStdin || confirmationStdin) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("combined report stdin must be an object");
    const envelope = value as Record<string, unknown>;
    const approvalKey = confirmationStdin ? "approval_confirmation" : "approval_response";
    for (const key of Object.keys(envelope)) {
      if (key !== "claim_receipt" && key !== approvalKey) throw new Error(`combined report stdin has unknown field ${key}`);
    }
    if (!("claim_receipt" in envelope)) throw new Error("combined report stdin requires claim_receipt");
    if (!(approvalKey in envelope)) throw new Error(`combined report stdin requires ${approvalKey}`);
    return {
      claimReceipt: validateClaimReceiptV3(envelope.claim_receipt, true),
      ...(confirmationStdin
        ? { approvalConfirmationRaw: JSON.stringify(envelope.approval_confirmation) }
        : { approvalResponseRaw: JSON.stringify(envelope.approval_response) }),
    };
  }
  return { claimReceipt: validateClaimReceiptV3(value, true) };
}

async function handleReport(args: string[]): Promise<Directive> {
  const flags = parseFlags(args);
  const stageSlug = flags.stage;
  const instanceId = flags.instance;
  const result = flags.result;
  if (!stageSlug) throw new Error("report requires --stage <slug>");
  if (!instanceId) throw new Error("schema v3 report requires --instance <stage-instance>");
  if (!result || !VALID_RESULTS.has(result)) throw new Error("report requires --result completed|approved|rejected|revised");
  if ((booleanFlag(flags, "approval-response-stdin") || booleanFlag(flags, "approval-confirmation-stdin")) && result !== "approved") {
    throw new Error("approval stdin is only valid with --result approved");
  }
  const input = readReportStdin(flags);
  const state = loadWorkflowStateV3(PROJECT_ROOT);
  if (!state) throw new Error("no schema v3 workflow state found");
  if (state.status !== "running") throw new Error(`workflow is ${state.status}, not running`);
  const graph = loadGraph();
  const plan = buildPlan(state, graph);
  const declared = plan.instances.find((instance) => instance.instance_id === instanceId);
  if (!declared || declared.stage.slug !== stageSlug) throw new Error(`stage/instance mismatch or unknown instance: ${stageSlug}/${instanceId}`);
  const compatibility = compatibilityState(state, declared, plan.instances);
  const instance = runtimeInstance(declared, compatibility);
  if (flags.module && flags.module !== instance.module_id) throw new Error(`module mismatch for ${instanceId}`);
  if (flags.unit && flags.unit !== instance.unit_id) throw new Error(`unit mismatch for ${instanceId}`);
  const now = Date.now();
  assertClaimReceiptForStateV3(state, input.claimReceipt, instanceId, now);

  let approvalProviderId = "";
  let approvalHumanEventId = "";
  if (result === "completed" && instance.stage.approval === "block") {
    throw new Error(`stage ${stageSlug} requires --result approved with the exact active approval confirmation`);
  }
  if (result === "approved") {
    if (instance.stage.approval !== "block") throw new Error(`stage ${stageSlug} is not an approval gate`);
    const challenge = state.instances[instanceId]?.approval?.challenge;
    if (!challenge) throw new Error(`stage instance ${instanceId} has no approval challenge; run next first`);
    const issuedAt = Number(challenge.split(".", 1)[0]);
    if (!Number.isFinite(issuedAt) || now - issuedAt > APPROVAL_TTL_MS || issuedAt > now + 60_000) {
      throw new Error(`approval challenge expired for ${instanceId}; run next to obtain a new challenge`);
    }
    let token = flags["approval-token"] || process.env.AIDLC_APPROVAL_TOKEN;
    if (input.approvalConfirmationRaw) {
      if (token) throw new Error("use exactly one approval channel: conversation confirmation stdin, provider response stdin, --approval-token, or AIDLC_APPROVAL_TOKEN");
      const request = buildApprovalProviderRequest(compatibility, stageSlug);
      const confirmation = validateApprovalConversationConfirmation(input.approvalConfirmationRaw, request);
      token = confirmation.approval_token;
      approvalProviderId = confirmation.provider_id;
      approvalHumanEventId = confirmation.human_event_id;
    }
    if (input.approvalResponseRaw) {
      if (token) throw new Error("use exactly one approval channel: conversation confirmation stdin, provider response stdin, --approval-token, or AIDLC_APPROVAL_TOKEN");
      const request = buildApprovalProviderRequest(compatibility, stageSlug);
      const response = validateApprovalProviderResponse(input.approvalResponseRaw, request);
      token = response.approval_token;
      approvalProviderId = response.provider_id;
      approvalHumanEventId = response.human_event_id;
    }
    if (!token || !verifyApprovalToken(state.workflow_id, instanceId, challenge, token)) {
      throw new Error(`invalid or stale approval confirmation/token for ${instanceId}`);
    }
    if (!approvalProviderId) {
      approvalProviderId = "human-tty";
      approvalHumanEventId = `tty-${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;
    }
  }

  if (instance.stage.completion_contract === "instruction_only" && result === "completed" && flags["instruction-ack"] !== stageSlug) {
    throw new Error(`instruction-only stage requires --instruction-ack ${stageSlug}`);
  }
  const choices = runtimeChoices(instance.stage, compatibility);
  const userInput = flags["user-input"];
  if ((result === "completed" || result === "approved") && choices.length > 0 && (!userInput || !choices.includes(userInput))) {
    throw new Error(`stage ${stageSlug} requires --user-input with one of: ${choices.join(", ")}`);
  }

  if (result === "completed" || result === "approved") {
    const consumeFailures = checkConsumes(instance, compatibility, graph, plan.instances);
    if (consumeFailures.length > 0) throw new Error(`canonical consumed artifacts are invalid for ${instanceId}: ${consumeFailures.join("; ")}`);
    const missingProduces = checkProduces(instance);
    if (missingProduces.length > 0) throw new Error(`required produces are missing for ${instanceId}: ${missingProduces.join("; ")}`);
    if (stageSlug === "module-division") readModuleManifest(PROJECT_ROOT);
    if (stageSlug === "units-generation") {
      if (!instance.module_id) throw new Error("units-generation requires module context");
      const units = readUnitManifest(PROJECT_ROOT, instance.module_id);
      if (architectureChoice(compatibility)) {
        const missing = units.filter((unit) => unit.conditional_stages === undefined).map((unit) => unit.unit_id);
        if (missing.length > 0) throw new Error(`unit conditional_stages are required for: ${missing.join(", ")}`);
      }
    }
    const sensorFailures = await checkSensors(instance, compatibility);
    if (sensorFailures.length > 0) throw new Error(`sensor checks failed for ${instanceId}: ${sensorFailures.map((failure) => `[${failure.sensor}] ${failure.message}`).join("; ")}`);
  }

  const occurredAt = new Date().toISOString();
  if (input.claimReceipt.provider_id.startsWith("git-coordination:")) {
    const provider = gitProvider(flags, state.workflow_id);
    if (provider.provider_id !== input.claimReceipt.provider_id) throw new Error("configured Git provider does not match claim receipt");
    if (result === "completed" || result === "approved") {
      ensureGitTerminalStatus(provider, input.claimReceipt, "completed", occurredAt);
    }
    if (result === "revised") {
      ensureGitTerminalStatus(provider, input.claimReceipt, "released", occurredAt);
    }
  }

  let next = mutateWorkflowStateV3(PROJECT_ROOT, (current) => {
    let updated = current;
    assertClaimReceiptForStateV3(updated, input.claimReceipt, instanceId, Date.parse(occurredAt));
    if (result === "revised") {
      if (updated.instances[instanceId]?.status !== "rejected") throw new Error(`revised requires rejected status for ${instanceId}`);
      return appendWorkflowEventV3(updated, {
        event_type: "instance_ready",
        stage_instance: instanceId,
        occurred_at: occurredAt,
        payload: { reason: "Stage revision completed; instance is ready for a new claim" },
      });
    }
    if (result === "approved") {
      updated = appendWorkflowEventV3(updated, {
        event_type: "approval_granted",
        stage_instance: instanceId,
        occurred_at: occurredAt,
        payload: { provider_id: approvalProviderId, human_event_id: approvalHumanEventId },
      });
    }
    updated = submitInstanceV3(updated, plan.plans, instanceId, input.claimReceipt, occurredAt);
    return reportInstanceV3(
      updated,
      plan.plans,
      instanceId,
      input.claimReceipt,
      result as "completed" | "approved" | "rejected",
      occurredAt,
      userInput,
    );
  });

  if (result === "completed" || result === "approved") {
    next = syncReadyFrontier(graph, new Date().toISOString());
    const after = buildPlan(next, graph);
    const allResolved = after.plans.length > 0
      && after.plans.every((candidate) => resolvedStatus(next.instances[candidate.stage_instance]?.status || ""));
    if (allResolved) {
      next = mutateWorkflowStateV3(PROJECT_ROOT, (current) => appendWorkflowEventV3(current, {
        event_type: "workflow_completed",
        occurred_at: new Date().toISOString(),
        payload: {},
      }));
    }
  }

  return {
    kind: "print",
    schema_version: 3,
    stage: stageSlug,
    stage_instance: instanceId,
    result,
    revision: next.revision,
    message: next.status === "done"
      ? `🎉 Stage instance ${instanceId} ${result}; all workflow instances are resolved.`
      : result === "revised"
        ? `📝 Stage instance ${instanceId} revised and returned to ready; claim it again before execution.`
        : `✅ Stage instance ${instanceId} ${result}. Run next for a ready instance.`,
  };
}

async function handlePark(args: string[]): Promise<Directive> {
  const flags = parseFlags(args);
  const reason = flags.reason || "Workflow explicitly frozen by user";
  const state = loadWorkflowStateV3(PROJECT_ROOT);
  if (!state) throw new Error("no schema v3 workflow to freeze");
  if (state.status !== "running") throw new Error(`workflow is ${state.status}, not running`);
  const frozen = mutateWorkflowStateV3(PROJECT_ROOT, (current) => appendWorkflowEventV3(current, {
    event_type: "workflow_frozen",
    occurred_at: new Date().toISOString(),
    payload: { reason },
  }));
  return {
    kind: "parked",
    schema_version: 3,
    status: frozen.status,
    message: "Workflow frozen. Existing lease events remain auditable; scheduling resumes only with next --resume.",
  };
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  let directive: Directive;
  if (command === "next") directive = await handleNext(rest);
  else if (command === "report") directive = await handleReport(rest);
  else if (command === "park") directive = await handlePark(rest);
  else if (command === "continue") directive = { kind: "print", message: `Continue token "${rest[0] || ""}" acknowledged.` };
  else throw new Error("usage: aidlc-orchestrate-v3.ts <next|report|park|continue> [flags]");
  process.stdout.write(`${JSON.stringify(directive, null, 2)}\n`);
  if (directive.kind === "error") process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    kind: "error",
    message: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  process.exit(2);
});
