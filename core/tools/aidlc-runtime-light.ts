import { existsSync, lstatSync, readFileSync, readdirSync } from "fs";
import { isAbsolute, join, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { crossModuleRequires, dependencyInstances, expandStageInstances, loadGraph } from "./aidlc-orchestrate";
import { GLOBAL_WORKFLOW, lightAuditPath, lightStatePath, type WorkflowRef } from "./aidlc-light-state";
import { loadWorkflowParts, mergeWorkflowView, ownerOfInstance, registryPath, sameRef } from "./aidlc-workflow-layout";

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function evidence(projectRoot: string): { total: number; invalid: number; paths: string[] } {
  const root = resolve(projectRoot, ".aidlc", "evidence");
  if (!existsSync(root)) return { total: 0, invalid: 0, paths: [] };
  const paths: string[] = [];
  let invalid = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`lightweight evidence path must not be a symlink: ${path}`);
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile() && entry.name.endsWith(".json")) {
        if (!inside(projectRoot, path)) throw new Error(`lightweight evidence escapes project: ${path}`);
        try { JSON.parse(readFileSync(path, "utf8")); } catch { invalid++; }
        paths.push(relative(projectRoot, path).replaceAll(sep, "/"));
      }
    }
  };
  visit(root);
  return { total: paths.length, invalid, paths: paths.sort() };
}

function relativePath(root: string, path: string): string {
  return relative(root, path).replaceAll(sep, "/");
}

/**
 * Non-authoritative runtime projection. In the split layout `moduleId` narrows it to one
 * module workflow; without it the projection covers every workflow plus the registry.
 */
export function buildTeamLightRuntimeProjection(projectRoot = process.cwd(), moduleId?: string): Record<string, unknown> {
  const root = resolve(projectRoot);
  const loaded = loadWorkflowParts(root);
  if (!loaded.parts.has("global")) throw new Error("no active AWS-style lightweight workflow");
  if (moduleId && !loaded.split) throw new Error("runtime --module requires the per-module layout; split first with orchestrate split --from <workflow-id>");
  const owner: WorkflowRef = moduleId ? { kind: "module", module_id: moduleId } : GLOBAL_WORKFLOW;
  if (moduleId && !loaded.parts.has(`module:${moduleId}`)) throw new Error(`module ${moduleId} has no workflow yet; start it with orchestrate next --module ${moduleId}`);
  const state = loaded.split ? mergeWorkflowView(loaded.parts, owner) : loaded.parts.get("global")!.state;
  const completed = new Set(state.completed_stage_instances || []);
  const skipped = new Set(state.skipped_stage_instances || []);
  const claims = state.active_instances || {};
  const allInstances = expandStageInstances(loadGraph(), state);
  const scoped = moduleId ? allInstances.filter((instance) => sameRef(ownerOfInstance(instance.instance_id), owner)) : allInstances;
  const instances = scoped.map((instance) => {
    const claim = claims[instance.instance_id];
    const dependencyWaiting = [
      ...instance.stage.requires.flatMap((dependency) => dependencyInstances(instance, dependency, allInstances))
        .filter((candidate) => !completed.has(candidate.instance_id) && !skipped.has(candidate.instance_id))
        .map((candidate) => candidate.instance_id),
      ...crossModuleRequires(instance, allInstances, state),
    ].filter((value, index, values) => values.indexOf(value) === index);
    const status = completed.has(instance.instance_id)
      ? "completed"
      : skipped.has(instance.instance_id)
        ? "skipped"
        : claim && Date.parse(claim.expires_at) > Date.now()
          ? "claimed"
          : dependencyWaiting.length > 0
            ? "blocked"
            : "ready";
    return {
      stage_instance: instance.instance_id,
      stage: instance.stage.slug,
      module_id: instance.module_id || null,
      unit_id: instance.unit_id || null,
      ...(loaded.split ? { workflow: ownerOfInstance(instance.instance_id).kind === "module" ? `module:${instance.module_id}` : ownerOfInstance(instance.instance_id).kind } : {}),
      status,
      dependency_waiting: dependencyWaiting,
      ...(claim ? { owner: claim.owner, branch: claim.branch || null, worktree: claim.worktree || null, claimed_at: claim.claimed_at, heartbeat_at: claim.heartbeat_at, expires_at: claim.expires_at } : {}),
    };
  });
  const evidenceSummary = evidence(root);
  const workflows = loaded.split
    ? [...loaded.parts.values()].map((part) => ({
      workflow: part.ref.kind === "module" ? `module:${part.ref.module_id}` : part.ref.kind,
      workflow_id: part.state.workflow_id,
      status: part.state.status,
      current_stage_instance: part.state.current_stage_instance || null,
      revision: part.state.revision,
      state_path: relativePath(root, lightStatePath(root, part.ref)),
    }))
    : undefined;
  return {
    kind: "aidlc.aws-light.runtime",
    authoritative: false,
    layout: loaded.split ? "split" : "single",
    work: state.work_description,
    workflow_id: state.workflow_id,
    scope: state.scope,
    revision: state.revision,
    state_path: relativePath(root, lightStatePath(root, owner)),
    audit_path: relativePath(root, lightAuditPath(root, owner)),
    ...(loaded.split ? { registry_path: relativePath(root, registryPath(root)), registry: loaded.registry, workflows } : {}),
    ...(moduleId ? { module_id: moduleId, status: state.status, current_stage_instance: state.current_stage_instance || null } : {}),
    instances,
    unit_selections: state.unit_selections || {},
    module_selections: state.module_selections || {},
    active_instances: claims,
    ready_instances: instances.filter((instance) => instance.status === "ready").map((instance) => instance.stage_instance),
    blocked_instances: instances.filter((instance) => instance.status === "blocked").map((instance) => ({ stage_instance: instance.stage_instance, waiting_for: instance.dependency_waiting })),
    evidence: evidenceSummary,
    warnings: evidenceSummary.invalid ? [`${evidenceSummary.invalid} evidence file(s) are invalid JSON`] : [],
  };
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "summary" && command !== "doctor") throw new Error("usage: loeyae-aidlc runtime <summary|doctor> [--module <module-id>]");
  const moduleIndex = rest.indexOf("--module");
  const moduleId = moduleIndex >= 0 ? rest[moduleIndex + 1] : undefined;
  if (moduleIndex >= 0 && (!moduleId || moduleId.startsWith("--"))) throw new Error("--module requires a value");
  const projection = buildTeamLightRuntimeProjection(process.cwd(), moduleId);
  const result = command === "doctor" ? { kind: "aidlc.aws-light.runtime-doctor", healthy: projection.warnings instanceof Array && projection.warnings.length === 0, projection } : projection;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Lightweight runtime blocked: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; }
}
