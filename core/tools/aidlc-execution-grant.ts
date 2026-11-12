import {assertScopeExecutionWindows} from './aidlc-execution-window';
import {assertAttemptRepairWrite} from './aidlc-attempt-repair';
/** Workflow-facing P1-03 controller. Core approval is captured at the operator boundary. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, win32 } from "node:path";
import { autonomyDigest, autonomySource as v, canonicalAutonomyJson as json, projectAutonomyScope, ScopeReader } from "./aidlc-autonomy";
import { projectAutonomyDecisions } from "./aidlc-autonomy-policy";
import { assertSessionClaim, loadWorkflowState, saveWorkflowState, sessionBinding, withSessionPublication, GLOBAL_WORKFLOW, type SessionBinding, type WorkflowState } from "./aidlc-light-state";
import { loadWorkflowPart, loadWorkflowParts, ownerOfInstance } from "./aidlc-workflow-layout";
import { readModuleManifest } from "./aidlc-execution-context";
import { assertAutonomyDependencyAccess } from "./aidlc-autonomy-dependencies";
import { assertExecutionGrantRef, captureOperatorApproval, checkExecutionGrant, GRANT_OPERATIONS, grantFailure as fail, grantProjectIdentity, readIssuedGrant, storeGrantRevocation, storeIssuedGrant, validateGrantInputs, withGrantControl, type ExecutionGrantRef, type GrantInput, type GrantOperation, type GrantPayload, type OperatorApproval } from "./aidlc-grant-store";

type Row = Record<string, unknown>;
const PERMISSIONS = { candidate_commit: "candidate-commit", candidate_integrate: "candidate-integrate", push: "push", protected_branch_write: "protected-branch-write", deploy: "deploy" } as const;
function integer(value: unknown, name: string, min: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) fail(`${name} must be a finite safe integer >= ${min}`); return value as number;
}
function uniqueStrings(value: unknown, name: string, required = true): string[] {
  return v.unique(v.array(value, name, required).map(value => v.string(value, name)), value => value, name);
}
function writePath(value: unknown): string {
  const path = v.string(value, "approved write path");
  if (isAbsolute(path) || win32.isAbsolute(path) || /[\\:]/.test(path) || path.split("/").some(part => !part || part === "." || part === "..") || [".git", ".aidlc", "aidlc"].includes(path.split("/")[0])) fail("write scope must be bounded project-relative business paths, not control-plane paths");
  return path;
}
function current(root: string): { global: WorkflowState; binding: SessionBinding } {
  const global = loadWorkflowState(root), binding = sessionBinding();
  if (!global?.autonomy_contract_version || !binding) fail("grant issuance needs an explicitly adopted batch and live session binding");
  const part = loadWorkflowPart(root, ownerOfInstance(binding.stage_instance));
  if (!part || part.state.workflow_id !== binding.workflow_id) fail("binding does not own an active workflow"); assertSessionClaim(root, part.state, binding.stage_instance, binding);
  if (part.state.status === "parked") fail("workflow is parked; only an explicit native resume may continue it");
  return { global, binding };
}
/** Freeze actual references, never authoring passed flags or later implementation outputs. */
function collectInputs(root: string, state: WorkflowState): GrantInput[] {
  const scope = projectAutonomyScope(root, state), policy = projectAutonomyDecisions(root).policy!, reader = new ScopeReader(root, state), inputs = new Map<string, GrantInput>(), visited = new Set<string>();
  const scan = (value: unknown, depth = 0): void => {
    if (depth > 64) fail("grant source reference depth exceeded");
    if (Array.isArray(value)) { for (const item of value) scan(item, depth + 1); return; }
    if (!value || typeof value !== "object") return;
    const row = value as Row;
    if (row.sensor && typeof row.path === "string" && typeof row.digest === "string") {
      const actual = createHash("sha256").update(readFileSync(v.safeFile(root, row.path))).digest("hex");
      if (actual !== row.digest) fail(`consumed evidence changed: ${row.path}`);
      inputs.set(`evidence:${row.path}`, { path: row.path, digest: actual });
    }
    if (row.repository_id === "project" && row.digest_mode) {
      const ref = { repository_id: row.repository_id, path: row.path, digest: row.digest, digest_mode: row.digest_mode, ...(row.selector ? { selector: row.selector } : {}) };
      const key = json(ref); if (visited.has(key)) return; visited.add(key);
      const result = reader.resolve(ref); inputs.set(key, { path: result.ref.path, digest: result.ref.digest, ...(result.ref.selector ? { selector: result.ref.selector } : {}) });
      if (result.record) scan(result.record, depth + 1);
    }
    for (const item of Object.values(row)) scan(item, depth + 1);
  };
  scan(scope); scan(policy);
  const batch = v.records(root, scope.snapshot!.source_path).find(row => row.record_type === "batch")!;
  scan(batch); inputs.set("batch", { path: scope.snapshot!.source_path, digest: scope.snapshot!.record_digest, selector: { record_type: "batch", record_id: scope.snapshot!.batch_id } });
  const raw = (path: string, optional = false) => {
    const present = existsSync(join(root, path));
    inputs.set(`raw:${path}`, { path, digest: present ? createHash("sha256").update(readFileSync(v.safeFile(root, path))).digest("hex") : optional ? "absent" : fail(`missing baseline ${path}`) });
  };
  raw("docs/aidlc/ideation/module-manifest.json");
  for (const module of readModuleManifest(root)) {
    raw(`docs/aidlc/modules/${module.module_id}/inception/unit-manifest.json`, true);
    raw(`docs/aidlc/modules/${module.module_id}/inception/application-design/unit-of-work-dependency.md`, true);
    raw(`docs/aidlc/modules/${module.module_id}/inception/application-design/unit-of-work.md`, true);
  }
  if (inputs.size > 1024) fail("too many grant baseline references");
  return [...inputs.values()].sort((a, b) => json(a) < json(b) ? -1 : json(a) > json(b) ? 1 : 0);
}
export function prepareExecutionGrant(root: string, value: unknown): GrantPayload {
  const request = v.object(value, "grant request", ["run_id", "lifetime_seconds", "allowed_operations", "host", "resource_limits", "integration_permissions", "write_paths", "successor_policy"]);
  let successor: GrantPayload['successor_policy'] = 'disabled';
  if(request.successor_policy!==undefined&&request.successor_policy!=='disabled'){
    const p=v.object(request.successor_policy,'successor_policy',['version','mode','max_restarts']);
    if(p.version!=='1'||p.mode!=='same-host-session'||!Number.isSafeInteger(p.max_restarts)||Number(p.max_restarts)<1||Number(p.max_restarts)>3)fail('invalid bounded same-host-session successor policy');
    successor={version:'1',mode:'same-host-session',max_restarts:Number(p.max_restarts)};
  }
  const { global, binding } = current(root);
  if (global.execution_grant_version) fail("P1 does not replace/extend an existing grant; use an explicitly authorized new workflow");
  if (binding.workflow_id !== global.workflow_id || binding.stage_instance.includes("@module:")) fail("initial grant issuance needs the exact global project-stage claim");
  const scope = projectAutonomyScope(root, global); projectAutonomyDecisions(root);
  if (typeof request.run_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(request.run_id)) fail("run_id must be a UUID");
  const operations = uniqueStrings(request.allowed_operations, "allowed_operations"); if (operations.some(op => !GRANT_OPERATIONS.includes(op as GrantOperation))) fail("unknown operation class");
  const limits = v.object(request.resource_limits, "resource_limits", ["wall_time_seconds", "max_equivalent_retries", "max_active_units"]);
  const wall = integer(limits.wall_time_seconds, "wall_time_seconds", 1), retries = integer(limits.max_equivalent_retries, "max_equivalent_retries", 0), units = integer(limits.max_active_units, "max_active_units", 1);
  if (units !== 1) fail("P1 single-session grants support one active unit; parallel scheduling is deferred");
  const lifetime = integer(request.lifetime_seconds, "lifetime_seconds", 1); if (lifetime > wall || !Number.isSafeInteger(lifetime * 1000) || !Number.isFinite(new Date(Date.now() + lifetime * 1000).getTime())) fail("grant lifetime exceeds the finite wall-time limit");
  const permissions = v.object(request.integration_permissions, "integration_permissions", Object.keys(PERMISSIONS));
  for (const [key, op] of Object.entries(PERMISSIONS)) if (typeof permissions[key] !== "boolean" || permissions[key] !== operations.includes(op)) fail(`permission/operation must explicitly agree: ${key}`);
  const host = v.object(request.host, "HostRef", ["host_id", "version", "entrypoint", "config_digest"]);
  v.id(host.host_id, "host id"); v.string(host.version, "host version"); v.digest(host.config_digest, "host config digest"); const entry = v.string(host.entrypoint, "host entrypoint");
  if ((!isAbsolute(entry) && !win32.isAbsolute(entry)) || !existsSync(entry) || !lstatSync(entry).isFile() || lstatSync(entry).isSymbolicLink()) fail("host entrypoint must identify an existing local executable/entry file");
  const writePaths = v.unique(v.array(request.write_paths, "write_paths", true).map(writePath), path => path, "write_paths");
  const loaded = loadWorkflowParts(root), moduleIds = [...new Set(scope.units!.map(unit => unit.unit_ref.module_id))].sort();
  const refs = [...loaded.parts.values()].filter(part => part.ref.kind !== "module" || moduleIds.includes(part.ref.module_id)).map(part => ({ workflow_id: part.state.workflow_id, owner_kind: part.ref.kind, ...(part.ref.kind === "module" ? { module_id: part.ref.module_id } : {}) }));
  assertScopeExecutionWindows(root,scope.baseline_inputs as any[],request as any);
  const requestedAt = Date.now();
  const payload: GrantPayload = { grant_id: randomUUID(), run_id: request.run_id, batch_id: scope.snapshot!.batch_id, scope_revision: scope.snapshot!.scope_revision,
    project_identity: grantProjectIdentity(root), workflow_refs: refs, policy_ref: scope.policy_ref!, baseline_digest: scope.snapshot!.scope_digest, inputs: collectInputs(root, global),
    request_started_at: new Date(requestedAt).toISOString(), expires_at: new Date(requestedAt + lifetime * 1000).toISOString(), revocation_revision: 1,
    allowed_operations: operations as GrantOperation[], executor_constraints: { host, owner: binding.owner, session_id: binding.session_id, initial_binding: binding, module_ids: moduleIds, unit_keys: scope.units!.map(unit => `${unit.unit_ref.module_id}/${unit.unit_ref.unit_id}`), implementation_unit_keys: scope.units!.filter(unit => unit.role === "implement").map(unit => `${unit.unit_ref.module_id}/${unit.unit_ref.unit_id}`), write_paths: writePaths },
    successor_policy: successor, resource_limits: { wall_time_seconds: wall, max_equivalent_retries: retries, max_active_units: units }, integration_permissions: permissions as Record<string, boolean> };
  if (Buffer.byteLength(json(payload), "utf8") > 1024 * 1024) fail("grant request exceeds the bounded 1 MiB authorization payload");
  return payload;
}
export function issueExecutionGrant(root: string, payload: GrantPayload, approval: OperatorApproval): ExecutionGrantRef {
  assertExecutionGrantRef({ version: "1", grant_id: payload.grant_id, run_id: payload.run_id, digest: "0".repeat(64) });
  const started = Date.parse(payload.request_started_at), expires = Date.parse(payload.expires_at);
  if (!Number.isFinite(started) || !Number.isFinite(expires) || new Date(started).toISOString() !== payload.request_started_at || new Date(expires).toISOString() !== payload.expires_at) fail("grant request timestamps must be valid UTC instants");
  const recomputed = prepareExecutionGrant(root, { run_id: payload.run_id, lifetime_seconds: (expires - started) / 1000, allowed_operations: payload.allowed_operations, host: payload.executor_constraints.host, resource_limits: payload.resource_limits, integration_permissions: payload.integration_permissions, write_paths: payload.executor_constraints.write_paths, successor_policy:payload.successor_policy });
  const stable = (value: GrantPayload) => { const { grant_id: _, request_started_at: __, expires_at: ___, ...rest } = value; return rest; };
  if (json(stable(recomputed)) !== json(stable(payload))) fail("approved grant payload does not match the actual workflow scope/request contract");
  const { global, binding } = current(root);
  if (global.execution_grant_version || json(binding) !== json(payload.executor_constraints.initial_binding)) fail("claim or grant changed since the approved request");
  return withSessionPublication(root, GLOBAL_WORKFLOW, binding.stage_instance, () => withGrantControl(root, () => {
    const now = current(root); if (now.global.revision !== global.revision || now.global.execution_grant_version || json(now.binding) !== json(payload.executor_constraints.initial_binding) || now.global.autonomy_batch?.scope_digest !== payload.baseline_digest) fail("workflow changed before grant commit");
    projectAutonomyScope(root, now.global); projectAutonomyDecisions(root); validateGrantInputs(root, payload.inputs);
    const ref = storeIssuedGrant(root, payload, approval);
    now.global.execution_grant_version = "1"; now.global.execution_grant_ref = ref;
    saveWorkflowState(root, now.global, GLOBAL_WORKFLOW, { executionGrantActivation: true });
    return ref;
  }, true, true), binding, "grant-control");
}
export function executionGrantProjection(root: string): Row {
  const state = loadWorkflowState(root); if (!state?.execution_grant_version) return { enabled: false, execution_authorized: false, admission_evaluated: false };
  const ref = state.execution_grant_ref!, result = readIssuedGrant(root, ref);
  return { enabled: true, ref, status: result.revoked ? "revoked" : Date.now() < Date.parse(result.grant.issued_at) ? "clock-invalid" : Date.now() >= Date.parse(result.grant.expires_at) ? "expired" : "active", revocation_revision: result.revision,
    expires_at: result.grant.expires_at, allowed_operations: result.grant.allowed_operations, successor_policy: result.grant.successor_policy, execution_authorized: false, admission_evaluated: false };
}
export function bindExecutionGrant(root: string): Row {
  const { global, binding } = current(root); if (!global.execution_grant_version) fail("there is no managed grant to bind");
  checkExecutionGrant(root, global, binding, [], undefined, true);
  return { ref: global.execution_grant_ref!, session_binding: binding, host: JSON.parse(process.env.AIDLC_AUTONOMY_HOST!), message: "Pass AIDLC_EXECUTION_GRANT only to this session's Core commands; every new stage still needs its own current binding." };
}
export function checkCurrentExecutionGrant(root: string, operations: readonly GrantOperation[], path?: string, explicitResume = false): void {
  const global = loadWorkflowState(root); if (!global) return;
  if (!global.execution_grant_version) { checkExecutionGrant(root, global, sessionBinding(), operations, path); return; }
  const binding = sessionBinding();
  const state = binding ? loadWorkflowPart(root, ownerOfInstance(binding.stage_instance))?.state : null;
  if (!state || !binding || state.workflow_id !== binding.workflow_id) fail("current grant check requires a live exact binding");
  assertSessionClaim(root, state, binding.stage_instance, binding);
  if (state.status === "parked" && !(explicitResume && operations.every(op => op === "workflow-write"))) fail("workflow is parked; runtime authority does not resume user-paused work");
  checkExecutionGrant(root, global, binding, operations, path);
  assertAutonomyDependencyAccess(root, binding, operations, path);
  assertAttemptRepairWrite(root,binding,operations,path);
}
export function prepareGrantRevocation(root: string, reason: string, expectedRevision: number): Row {
  const global = loadWorkflowState(root); if (!global?.execution_grant_version) fail("no active managed grant reference");
  const result = readIssuedGrant(root, global.execution_grant_ref!);
  if (result.revoked) return { already_revoked: true, grant_digest: global.execution_grant_ref!.digest };
  if (result.revision !== expectedRevision) fail("revocation revision changed; reread grant inspect");
  return { action: "revoke", grant_id: result.grant.grant_id, grant_digest: global.execution_grant_ref!.digest, expected_revision: expectedRevision, batch_id: result.grant.batch_id, scope_revision: result.grant.scope_revision, reason: v.string(reason, "revocation reason") };
}
export function revokeExecutionGrant(root: string, request: Row, approval: OperatorApproval): Row {
  if (request.already_revoked === true) {
    const global = loadWorkflowState(root);
    if (!global?.execution_grant_ref || global.execution_grant_ref.digest !== request.grant_digest || !readIssuedGrant(root, global.execution_grant_ref).revoked) fail("revocation state changed");
    return { ...executionGrantProjection(root), already_revoked: true };
  }
  return withGrantControl(root, () => {
    const global = loadWorkflowState(root); if (!global?.execution_grant_version || global.execution_grant_ref!.digest !== request.grant_digest) fail("active grant changed before revocation");
    storeGrantRevocation(root, global.execution_grant_ref!, request, approval); return executionGrantProjection(root);
  }, true);
}
export async function executionGrantDirective(root: string, args: string[]): Promise<Row> {
  const [action, ...rest] = args, flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]; if (!["--input", "--operation", "--path", "--expect", "--reason", "--preview"].includes(key) || Object.hasOwn(flags, key)) fail("unknown/duplicate grant option");
    if (key === "--preview") flags[key] = "true"; else { if (!rest[i + 1] || rest[i + 1].startsWith("--")) fail(`${key} requires a value`); flags[key] = rest[++i]; }
  }
  const allowed: Record<string, string[]> = { inspect: [], bind: [], check: ["--operation", "--path"], issue: ["--input", "--preview"], revoke: ["--expect", "--reason", "--preview"] };
  if (!allowed[action] || Object.keys(flags).some(key => !allowed[action].includes(key))) fail("unsupported grant action/options");
  let result: Row;
  if (action === "inspect") result = executionGrantProjection(root);
  else if (action === "bind") result = bindExecutionGrant(root);
  else if (action === "check") {
    if (!flags["--operation"] || !GRANT_OPERATIONS.includes(flags["--operation"] as GrantOperation)) fail("check needs a known operation");
    if (!loadWorkflowState(root)?.execution_grant_version) fail("no grant; legacy/scope-only mode does not authorize autonomous operations");
    checkCurrentExecutionGrant(root, [flags["--operation"] as GrantOperation], flags["--path"]); result = { operation: flags["--operation"], execution_authorized: true, admission_evaluated: false };
  } else if (action === "issue") {
    if (!flags["--input"]) fail("issue requires a grant request file");
    const payload = prepareExecutionGrant(root, JSON.parse(readFileSync(v.safeFile(root, flags["--input"]), "utf8")));
    result = flags["--preview"] ? { proposed_grant: payload, request_digest: autonomyDigest(payload), execution_authorized: false } : { ref: issueExecutionGrant(root, payload, await captureOperatorApproval(root, payload as unknown as Row)), execution_authorized: false };
  } else {
    if (!/^[1-9]\d*$/.test(flags["--expect"] || "") || !flags["--reason"]) fail("revoke requires --expect <revision> and --reason");
    const request = prepareGrantRevocation(root, flags["--reason"], Number(flags["--expect"]));
    result = request.already_revoked ? { ...executionGrantProjection(root), already_revoked: true } : flags["--preview"] ? { proposed_revocation: request, execution_authorized: false } : revokeExecutionGrant(root, request, await captureOperatorApproval(root, request));
  }
  return { kind: "print", execution_grant: result, message: "Grant authorization is separate from stage claims, business approvals, admission and quality verification." };
}
