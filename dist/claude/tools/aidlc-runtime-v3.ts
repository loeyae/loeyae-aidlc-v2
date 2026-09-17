import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "fs";
import { isAbsolute, join, relative, resolve, sep } from "path";
import { loadWorkflowStateV3 } from "./aidlc-state-v3-store";
import type { WorkflowClaimV3, WorkflowInstanceV3, WorkflowStateV3 } from "./aidlc-state-v3";
import { verifyRecord } from "./aidlc-trust";

const MAX_EVIDENCE_FILES = 10_000;
const MAX_EVIDENCE_BYTES = 512 * 1024;

export type RuntimeEvidenceStatus = "verified" | "invalid" | "unreadable";

export interface RuntimeClaimProjectionV3 {
  actor_id: string;
  device_id: string;
  client_id: string;
  provider_id: string;
  provider_receipt_digest: string;
  claimed_at: string;
  renewed_at: string;
  lease_expires_at: string | null;
  compatibility_lock?: true;
}

export interface RuntimeInstanceProjectionV3 {
  stage_instance: string;
  stage: string;
  axis: "project" | "module" | "unit";
  module_id: string | null;
  unit_id: string | null;
  requires: string[];
  status: WorkflowInstanceV3["status"];
  revision: number;
  updated_at: string;
  result: WorkflowInstanceV3["result"] | null;
  assignment: {
    actor_id: string;
    provider_id: string;
    assigned_at: string;
    external_work_item_id: string | null;
  } | null;
  claim: RuntimeClaimProjectionV3 | null;
}

export interface RuntimeEvidenceProjectionV3 {
  path: string;
  status: RuntimeEvidenceStatus;
  error: string | null;
  timestamp: string | null;
  stage_instance: string | null;
  module_id: string | null;
  unit_id: string | null;
}

export interface RuntimeProjectionV3 {
  schema_version: 1;
  kind: "aidlc.runtime-projection";
  authoritative: false;
  generated_at: string;
  workflow: {
    workflow_id: string;
    scope: string;
    status: WorkflowStateV3["status"];
    revision: number;
    event_head: WorkflowStateV3["event_head"];
  };
  instances: RuntimeInstanceProjectionV3[];
  summary: {
    instances_by_status: Record<string, number>;
    events_by_type: Record<string, number>;
    evidence: {
      total: number;
      verified: number;
      invalid: number;
      unreadable: number;
    };
  };
  evidence: RuntimeEvidenceProjectionV3[];
  warnings: string[];
}

export interface RuntimeDoctorReportV3 {
  schema_version: 1;
  kind: "aidlc.runtime-doctor";
  healthy: boolean;
  projection: RuntimeProjectionV3;
  errors: string[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isoTimestamp(value: unknown): string | null {
  const text = nonEmptyString(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

function safeEvidenceDirectory(projectRoot: string): string | null {
  const candidate = resolve(projectRoot, ".aidlc", "evidence");
  if (!isInside(projectRoot, candidate) || !existsSync(candidate)) return null;
  const stat = lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`runtime evidence directory must be a regular non-symlink directory: ${candidate}`);
  }
  const real = realpathSync(candidate);
  if (!isInside(projectRoot, real)) throw new Error(`runtime evidence directory resolves outside project root: ${candidate}`);
  return real;
}

function safeEvidenceFiles(projectRoot: string): string[] {
  const root = safeEvidenceDirectory(projectRoot);
  if (!root) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const candidate = join(directory, entry.name);
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error(`runtime evidence path must not be a symlink: ${candidate}`);
      if (stat.isDirectory()) {
        const real = realpathSync(candidate);
        if (!isInside(root, real)) throw new Error(`runtime evidence directory resolves outside its root: ${candidate}`);
        visit(real);
      } else if (stat.isFile() && entry.name.endsWith(".json")) {
        if (files.length >= MAX_EVIDENCE_FILES) throw new Error(`runtime evidence file count exceeds ${MAX_EVIDENCE_FILES}`);
        const real = realpathSync(candidate);
        if (!isInside(root, real)) throw new Error(`runtime evidence file resolves outside its root: ${candidate}`);
        files.push(real);
      }
    }
  };
  visit(root);
  return files;
}

function projectionClaim(claim: WorkflowClaimV3): RuntimeClaimProjectionV3 {
  return {
    actor_id: claim.actor_id,
    device_id: claim.device_id,
    client_id: claim.client_id,
    provider_id: claim.provider_id,
    provider_receipt_digest: claim.provider_receipt_digest,
    claimed_at: claim.claimed_at,
    renewed_at: claim.renewed_at,
    lease_expires_at: claim.lease_expires_at,
    ...(claim.compatibility_lock ? { compatibility_lock: true } : {}),
  };
}

function projectionInstance(instance: WorkflowInstanceV3): RuntimeInstanceProjectionV3 {
  return {
    stage_instance: instance.stage_instance,
    stage: instance.stage,
    axis: instance.axis,
    module_id: instance.module_id || null,
    unit_id: instance.unit_id || null,
    requires: [...instance.requires],
    status: instance.status,
    revision: instance.revision,
    updated_at: instance.updated_at,
    result: instance.result || null,
    assignment: instance.assignment
      ? {
          actor_id: instance.assignment.actor_id,
          provider_id: instance.assignment.provider_id,
          assigned_at: instance.assignment.assigned_at,
          external_work_item_id: instance.assignment.external_work_item_id || null,
        }
      : null,
    claim: instance.claim ? projectionClaim(instance.claim) : null,
  };
}

function projectionEvidence(projectRoot: string, file: string): RuntimeEvidenceProjectionV3 {
  const path = relative(projectRoot, file).replaceAll(sep, "/");
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("evidence entry is not a regular file");
    if (stat.size > MAX_EVIDENCE_BYTES) throw new Error(`evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
    const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!isRecord(value)) throw new Error("evidence JSON is not an object");
    const integrity = verifyRecord(value);
    return {
      path,
      status: integrity ? "invalid" : "verified",
      error: integrity,
      timestamp: isoTimestamp(value.timestamp),
      stage_instance: nonEmptyString(value.stage_instance),
      module_id: nonEmptyString(value.module_id),
      unit_id: nonEmptyString(value.unit_id),
    };
  } catch (error) {
    return {
      path,
      status: "unreadable",
      error: error instanceof Error ? error.message : String(error),
      timestamp: null,
      stage_instance: null,
      module_id: null,
      unit_id: null,
    };
  }
}

function countBy<T extends string>(values: readonly T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

export function buildRuntimeProjectionV3(projectRoot = process.cwd(), now = new Date()): RuntimeProjectionV3 {
  const root = realpathSync(resolve(projectRoot));
  const state = loadWorkflowStateV3(root);
  if (!state) throw new Error("schema v3 runtime projection requires an initialized workflow state");
  const instances = Object.values(state.instances)
    .map(projectionInstance)
    .sort((left, right) => left.stage_instance.localeCompare(right.stage_instance));
  const evidence = safeEvidenceFiles(root)
    .map((file) => projectionEvidence(root, file))
    .sort((left, right) => left.path.localeCompare(right.path));
  const warnings: string[] = [];
  for (const instance of instances) {
    if (instance.claim?.lease_expires_at && Date.parse(instance.claim.lease_expires_at) <= now.getTime()) {
      warnings.push(`claim lease expired for ${instance.stage_instance}`);
    }
  }
  for (const item of evidence) {
    if (item.status !== "verified") warnings.push(`evidence ${item.status}: ${item.path}`);
  }
  return {
    schema_version: 1,
    kind: "aidlc.runtime-projection",
    authoritative: false,
    generated_at: now.toISOString(),
    workflow: {
      workflow_id: state.workflow_id,
      scope: state.scope,
      status: state.status,
      revision: state.revision,
      event_head: { ...state.event_head },
    },
    instances,
    summary: {
      instances_by_status: countBy(instances.map((instance) => instance.status)),
      events_by_type: countBy(state.events.map((event) => event.event_type)),
      evidence: {
        total: evidence.length,
        verified: evidence.filter((item) => item.status === "verified").length,
        invalid: evidence.filter((item) => item.status === "invalid").length,
        unreadable: evidence.filter((item) => item.status === "unreadable").length,
      },
    },
    evidence,
    warnings,
  };
}

export function inspectRuntimeDoctorV3(projectRoot = process.cwd(), now = new Date()): RuntimeDoctorReportV3 {
  const projection = buildRuntimeProjectionV3(projectRoot, now);
  const errors = projection.evidence
    .filter((item) => item.status !== "verified")
    .map((item) => `evidence ${item.status}: ${item.path}${item.error ? ` (${item.error})` : ""}`);
  return {
    schema_version: 1,
    kind: "aidlc.runtime-doctor",
    healthy: errors.length === 0,
    projection,
    errors,
    warnings: [...projection.warnings],
  };
}

function parseArgs(args: string[]): { command: "summary" | "doctor"; projectRoot?: string; now?: Date } {
  const command = args[0];
  if (command !== "summary" && command !== "doctor") {
    throw new Error("usage: loeyae-aidlc runtime <summary|doctor> [--project <path>] [--as-of <ISO timestamp>]");
  }
  let projectRoot: string | undefined;
  let now: Date | undefined;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    const value = args[++index];
    if (!value) throw new Error(`${arg} requires a value`);
    if (arg === "--project") projectRoot = value;
    else if (arg === "--as-of") {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) throw new Error("--as-of must be a valid ISO timestamp");
      now = parsed;
    } else throw new Error(`unknown runtime argument: ${arg}`);
  }
  return { command, projectRoot, now };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const value = args.command === "summary"
    ? buildRuntimeProjectionV3(args.projectRoot, args.now)
    : inspectRuntimeDoctorV3(args.projectRoot, args.now);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`Runtime projection blocked: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
