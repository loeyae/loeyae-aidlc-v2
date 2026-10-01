import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState, type WorkflowRef } from "../core/tools/aidlc-light-state";
import { saveRegistry } from "../core/tools/aidlc-workflow-layout";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-archive-"));

function run(cwd: string, args: string[]): { status: number; directive: Record<string, unknown> } {
  const result = spawnSync(process.execPath, [tsx, cli, "orchestrate", ...args], { cwd, encoding: "utf8" });
  const text = (result.stdout || "").trim() || (result.stderr || "").trim();
  return { status: result.status ?? 1, directive: JSON.parse(text) as Record<string, unknown> };
}

function archiveDirs(project: string): string[] {
  const dir = join(project, "aidlc", "archive");
  return existsSync(dir) ? readdirSync(dir) : [];
}

function setStatus(project: string, status: "running" | "parked" | "done", ref?: WorkflowRef): void {
  const state = loadWorkflowState(project, ref);
  assert.ok(state);
  state!.status = status;
  saveWorkflowState(project, state!, ref);
}

try {
  // Single layout: running -> park -> archive -> new workflow.
  const project = join(root, "single");
  mkdirSync(project, { recursive: true });
  assert.equal(run(project, ["next", "--scope", "express", "--work", "First work"]).directive.kind, "print");
  const first = loadWorkflowState(project)!;

  const duplicate = run(project, ["next", "--scope", "express", "--work", "Second work"]);
  assert.equal(duplicate.directive.kind, "error");
  assert.equal(duplicate.directive.workflow_id, first.workflow_id);
  assert.match(String(duplicate.directive.message), /already exists \(status: running\).*orchestrate park.*orchestrate archive/);
  assert.equal(run(project, ["next", "--work", "Only work"]).directive.kind, "error");

  mkdirSync(join(project, ".aidlc", "evidence", "requirements-analysis"), { recursive: true });
  writeFileSync(join(project, ".aidlc", "evidence", "requirements-analysis", "traceability-matrix.json"), "{}\n", "utf8");
  writeFileSync(join(project, ".aidlc", "evidence-commands.json"), "{}\n", "utf8");

  const running = run(project, ["archive"]);
  assert.equal(running.directive.kind, "error");
  assert.match(String(running.directive.message), /Only parked or done workflows can be archived.*is running.*orchestrate park/);

  assert.equal(run(project, ["park"]).directive.kind, "parked");
  const state = loadWorkflowState(project)!;
  state.active_instances["requirements-analysis"] = { module_id: "", stage_instance: "requirements-analysis", owner: "alice", claimed_at: state.updated_at, heartbeat_at: state.updated_at, expires_at: "2999-01-01T00:00:00.000Z" };
  saveWorkflowState(project, state);
  const claimed = run(project, ["archive"]);
  assert.equal(claimed.directive.kind, "error");
  assert.match(String(claimed.directive.message), /unreleased claims: requirements-analysis=alice/);
  const released = loadWorkflowState(project)!;
  released.active_instances = {};
  saveWorkflowState(project, released);

  writeFileSync(join(project, ".aidlc", "evidence", "requirements-analysis", "traceability-matrix.json.producer.lock"), "", "utf8");
  const locked = run(project, ["archive"]);
  assert.equal(locked.directive.kind, "error");
  assert.match(String(locked.directive.message), /locks are held: .*producer\.lock/);
  unlinkSync(join(project, ".aidlc", "evidence", "requirements-analysis", "traceability-matrix.json.producer.lock"));

  const archived = run(project, ["archive", "--reason", "switch to new work"]);
  assert.equal(archived.status, 0, JSON.stringify(archived.directive));
  assert.equal(archived.directive.kind, "print");
  assert.equal(archived.directive.evidence_archived, true);
  assert.match(String(archived.directive.message), /orchestrate next --scope <scope> --work/);
  const archivePath = join(project, String(archived.directive.archive_path));
  assert.match(String(archived.directive.archive_path), new RegExp(`^aidlc/archive/${first.workflow_id}-\\d{8}T\\d{6}Z$`));
  assert.equal(existsSync(join(project, "aidlc", "active")), false);
  assert.equal(existsSync(join(project, ".aidlc", "evidence")), false);
  assert.ok(existsSync(join(project, ".aidlc", "evidence-commands.json")), "evidence-commands.json is project configuration and stays in place");
  assert.ok(existsSync(join(archivePath, "aidlc-state.md")));
  assert.ok(existsSync(join(archivePath, "evidence", "requirements-analysis", "traceability-matrix.json")));
  const audit = readFileSync(join(archivePath, "audit.md"), "utf8");
  assert.match(audit, /Event: WORKFLOW_ARCHIVED/);
  assert.match(audit, /Reason: switch to new work/);
  assert.match(audit, new RegExp(`Target: aidlc/archive/${first.workflow_id}-`));

  assert.equal(run(project, ["archive"]).directive.kind, "error", "nothing left to archive");
  assert.equal(run(project, ["next", "--scope", "express", "--work", "Second work"]).directive.kind, "print");
  const second = loadWorkflowState(project)!;
  assert.notEqual(second.workflow_id, first.workflow_id);
  assert.equal(second.work_description, "Second work");

  // A done workflow is archivable.
  setStatus(project, "done");
  const done = run(project, ["archive"]);
  assert.equal(done.directive.kind, "print", JSON.stringify(done.directive));
  assert.equal(done.directive.evidence_archived, false);
  assert.equal(archiveDirs(project).length, 2);

  // Split layout: registry, modules/ and integration/ move with aidlc/active.
  const split = join(root, "split");
  mkdirSync(split, { recursive: true });
  const moduleRef: WorkflowRef = { kind: "module", module_id: "module-a" };
  const integrationRef: WorkflowRef = { kind: "integration" };
  const global = createInitialState("feature", undefined, undefined, [], "Split work");
  global.workflow_kind = "global";
  global.status = "done";
  saveWorkflowState(split, global);
  const moduleState = createInitialState("feature", undefined, undefined, [], "Split work");
  moduleState.workflow_kind = "module";
  moduleState.module_id = "module-a";
  moduleState.parent_workflow_id = global.workflow_id;
  saveWorkflowState(split, moduleState, moduleRef);
  const integration = createInitialState("feature", undefined, undefined, [], "Split work");
  integration.workflow_kind = "integration";
  integration.parent_workflow_id = global.workflow_id;
  integration.status = "parked";
  saveWorkflowState(split, integration, integrationRef);
  const now = new Date().toISOString();
  saveRegistry(split, {
    version: "1",
    global_workflow_id: global.workflow_id,
    split_from_workflow_id: global.workflow_id,
    split_at: now,
    updated_at: now,
    modules: [{ module_id: "module-a", workflow_id: moduleState.workflow_id, state_path: "aidlc/active/modules/module-a/aidlc-state.md", status: "running", current_stage: "", inception_done: false, construction_done: false, owner: "-" }],
    integration: { workflow_id: integration.workflow_id, state_path: "aidlc/active/integration/aidlc-state.md", status: "parked", current_stage: "", barrier_ready: false, blocking: [] },
    shared_contracts: [],
    cross_module_requires: [],
  });

  const splitDuplicate = run(split, ["next", "--scope", "feature", "--work", "Other work"]);
  assert.equal(splitDuplicate.directive.kind, "error");
  assert.equal(splitDuplicate.directive.workflow_id, global.workflow_id);

  const moduleRunning = run(split, ["archive"]);
  assert.equal(moduleRunning.directive.kind, "error");
  assert.match(String(moduleRunning.directive.message), /module-a.*is running.*orchestrate park --module module-a/);
  setStatus(split, "parked", moduleRef);

  const splitArchived = run(split, ["archive", "--reason", "split cleanup"]);
  assert.equal(splitArchived.directive.kind, "print", JSON.stringify(splitArchived.directive));
  const splitArchive = join(split, String(splitArchived.directive.archive_path));
  assert.equal(existsSync(join(split, "aidlc", "active")), false);
  for (const path of ["aidlc-state.md", "audit.md", "registry.md", "modules/module-a/aidlc-state.md", "integration/aidlc-state.md"]) {
    assert.ok(existsSync(join(splitArchive, path)), `split archive must contain ${path}`);
  }

  console.log("orchestrate archive tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
