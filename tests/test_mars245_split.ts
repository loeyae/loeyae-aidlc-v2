import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { lightStatePath, loadWorkflowState, saveWorkflowState, createInitialState } from "../core/tools/aidlc-light-state";
import { loadRegistry, evidenceScopeForInstance } from "../core/tools/aidlc-workflow-layout";
import { readSourceRevision } from "../core/tools/aidlc-revision";
import { fixture, cli, snapshot, write, expire } from "./mars245_fixture";

function split(f: ReturnType<typeof fixture>, fault?: string) { return cli(f.root, ["orchestrate", "split", "--from", f.state.workflow_id], f.session.binding, fault); }
function dispose(root: string) { delete process.env.AIDLC_SESSION_BINDING; rmSync(root, { recursive: true, force: true }); }

// Public CLI: a genuine single layout becomes a complete split, retaining source
// baseline chains, approvals/history, completions/skips and valid scoped evidence.
const f = fixture();
try {
  const beforeDryRun = snapshot(f.root);
  const dryRun = cli(f.root, ["orchestrate", "split", "--from", f.state.workflow_id, "--dry-run"], f.session.binding);
  assert.equal(dryRun.status, 0, JSON.stringify(dryRun.directive));
  assert.deepEqual(snapshot(f.root), beforeDryRun);
  assert.equal(existsSync(join(f.root, "aidlc/active/registry.md")), false);
  const result = split(f);
  assert.equal(result.status, 0, JSON.stringify(result.directive));
  const registry = loadRegistry(f.root)!;
  assert.deepEqual(registry.modules.map(row => row.module_id), ["alpha", "beta"]);
  const global = loadWorkflowState(f.root)!;
  assert.deepEqual(global.baseline_history, f.state.baseline_history);
  assert.equal(global.baseline_commit, f.state.baseline_commit);
  assert.deepEqual(global.active_instances, f.state.active_instances, "split never grants any child claim");
  const alpha = loadWorkflowState(f.root, { kind: "module", module_id: "alpha" })!;
  const beta = loadWorkflowState(f.root, { kind: "module", module_id: "beta" })!;
  const integration = loadWorkflowState(f.root, { kind: "integration" })!;
  for (const state of [alpha, beta, integration]) {
    assert.equal(state.parent_workflow_id, global.workflow_id);
    assert.notEqual(state.workflow_id, global.workflow_id);
    assert.deepEqual(state.active_instances, {});
    assert.equal(state.baseline_commit, undefined);
  }
  assert.deepEqual(alpha.history, f.state.history.filter(row => row.module_id === "alpha"));
  assert.deepEqual(global.history, f.state.history.filter(row => !row.module_id));
  assert.ok(alpha.completed_stage_instances.includes("application-design@module:alpha"));
  assert.ok(beta.skipped_stage_instances.includes("reverse-engineering@module:beta"));
  const proof = JSON.parse(readFileSync(join(f.root, ".aidlc/evidence/application-design/alpha/evidence.json"), "utf8"));
  assert.equal(proof.sentinel, "valid legacy proof");
  assert.equal(proof.source_revision.scope_digest, readSourceRevision(f.root, evidenceScopeForInstance(f.root, "application-design@module:alpha")).scope_digest);
  assert.equal(result.directive.split.evidence.anchored.length, 2);
  assert.equal(result.directive.split.evidence.stale.length, 1);
  const sibling = readFileSync(lightStatePath(f.root, { kind: "module", module_id: "beta" }), "utf8");
  const staleAttempt = cli(f.root, ["orchestrate", "next", "--module", "alpha"], f.session.binding);
  assert.equal(staleAttempt.status, 2); assert.match(staleAttempt.directive.message, /binding/);
  // Bind via the public module CLI, then route the exact target without touching beta.
  const preview = cli(f.root, ["orchestrate", "next", "--module", "alpha", "--preview"]);
  assert.equal(preview.status, 0);
  const bound = cli(f.root, ["module", "bind", "--stage-instance", preview.directive.stage_instance, "--owner", "alpha-owner", "--session-id", "alpha-session", "--expect", preview.directive.expected]);
  assert.equal(bound.status, 0, JSON.stringify(bound.directive));
  const next = cli(f.root, ["orchestrate", "next", "--module", "alpha"], bound.directive.binding);
  assert.equal(next.status, 0, JSON.stringify(next.directive));
  assert.equal(readFileSync(lightStatePath(f.root, { kind: "module", module_id: "beta" }), "utf8"), sibling);
  console.log("PASS public split, inherited baseline/history/approvals/evidence and explicit target bind");
} finally { dispose(f.root); }

const active = fixture("requirements-analysis@module:alpha");
try {
  const result = split(active);
  assert.equal(result.status, 0, JSON.stringify(result.directive));
  const part = loadWorkflowState(active.root, { kind: "module", module_id: "alpha" })!;
  assert.deepEqual(part.active_instances, active.state.active_instances, "the original module claim is relocated without forging ownership");
  assert.deepEqual(loadWorkflowState(active.root)!.active_instances, {});
  const rejected = cli(active.root, ["orchestrate", "next", "--module", "alpha"], active.session.binding);
  assert.equal(rejected.status, 2, "a source workflow binding cannot authorize the relocated claim");
  const rebound = bindSession(active.root, { instance: "requirements-analysis@module:alpha", owner: "alpha-owner", session: "alpha-new-session", expected: claimToken(active.session.claim), humanInstructionRef: "user:post-split-handoff" });
  assert.equal(rebound.binding.workflow_id, part.workflow_id);
} finally { dispose(active.root); }

for (const mode of ["missing", "owner", "session", "generation", "project", "workflow", "expired", "transferred", "other-claim"]) {
  const f = fixture();
  try {
    let binding = { ...f.session.binding };
    if (["owner", "session", "generation", "project", "workflow"].includes(mode)) {
      const key = ({ session: "session_id", project: "project_root", workflow: "workflow_id" } as Record<string, string>)[mode] || mode;
      binding = { ...binding, [key]: "wrong" };
    }
    if (mode === "expired") expire(f.root, binding.stage_instance);
    if (mode === "transferred") bindSession(f.root, { instance: binding.stage_instance, owner: "new-owner", session: "new-session", expected: claimToken(f.session.claim), humanInstructionRef: "user:transfer" });
    if (mode === "other-claim") bindSession(f.root, { instance: "module-division", owner: "other-owner", session: "other-session", expected: claimToken(undefined) });
    const before = snapshot(f.root);
    const result = cli(f.root, ["orchestrate", "split", "--from", f.state.workflow_id], mode === "missing" ? undefined : binding);
    assert.equal(result.status, 2, mode);
    assert.deepEqual(snapshot(f.root), before, `${mode}: rejected writes must preserve managed bytes`);
  } finally { dispose(f.root); }
}
console.log("PASS missing/wrong/expired/transferred bindings and nonquiescent source refuse without writes");

// Default initialization guard remains strict; the new capability is not a flag
// that ordinary callers can use to initialize unrelated workflows.
const guard = fixture();
try {
  process.env.AIDLC_SESSION_BINDING = JSON.stringify(guard.session.binding);
  assert.throws(() => saveWorkflowState(guard.root, createInitialState("feature", "4.22.0", undefined, [], "unrelated initialization"), { kind: "module", module_id: "unrelated" }), /unrelated session binding/);
} finally { dispose(guard.root); }

// Every injected failure restores all original files, including an existing audit
// in a destination directory. A clean retry runs the SAME split successfully.
for (const fault of ["child", "registry", "evidence", "final"]) {
  const f = fixture();
  try {
    write(f.root, "aidlc/active/modules/alpha/audit.md", "preexisting audit, retain me\n");
    write(f.root, "aidlc/active/modules/alpha/owner-notes.md", "unmanaged owner notes\n");
    const before = snapshot(f.root);
    const failed = split(f, fault);
    assert.equal(failed.status, 2, JSON.stringify(failed.directive));
    assert.match(failed.directive.message, new RegExp(`injected ${fault} failure`));
    assert.deepEqual(snapshot(f.root), before, `${fault}: rollback must restore bytes and remove lock/temp artifacts`);
    const retry = split(f);
    assert.equal(retry.status, 0, JSON.stringify(retry.directive));
    assert.ok(readFileSync(join(f.root, "aidlc/active/modules/alpha/audit.md"), "utf8").startsWith("preexisting audit, retain me\n"));
  } finally { dispose(f.root); }
}
console.log("PASS multi-file/registry/evidence/final-commit rollback and retry");

for (const fault of ["handoff", "revision", "target-race", "registry-race", "locked-handoff"]) {
  const f = fixture();
  try {
    const result = split(f, fault);
    if (fault === "locked-handoff") {
      assert.equal(result.status, 0, JSON.stringify(result.directive));
      assert.equal(loadWorkflowState(f.root)!.active_instances["state-template"].session_id, "split-A");
      bindSession(f.root, { instance: "state-template", owner: "maintainer", session: "split-B", expected: claimToken(f.session.claim), humanInstructionRef: "user:after-split" });
    } else {
      assert.equal(result.status, 2, JSON.stringify(result.directive));
      if (fault === "handoff") assert.equal(loadWorkflowState(f.root)!.active_instances["state-template"].session_id, "split-B");
      if (fault === "revision") assert.equal(loadWorkflowState(f.root)!.work_description, "concurrent source edit");
      if (fault === "target-race") assert.equal(readFileSync(join(f.root, "aidlc/active/modules/beta/aidlc-state.md"), "utf8"), "other maintainer state");
      if (fault === "registry-race") assert.equal(readFileSync(join(f.root, "aidlc/active/registry.md"), "utf8"), "other maintainer registry");
      assert.equal(existsSync(lightStatePath(f.root, { kind: "module", module_id: "alpha" })), false);
      assert.equal(existsSync(lightStatePath(f.root, { kind: "integration" })), false);
    }
  } finally { dispose(f.root); }
}
console.log("PASS planning handoff/CAS, competing targets/registry and publication-lock handoff exclusion");

const auto = fixture();
try {
  const result = cli(auto.root, ["orchestrate", "next", "--module", "alpha"], auto.session.binding);
  assert.equal(result.status, 0, JSON.stringify(result.directive));
  assert.equal(result.directive.binding_required, true);
  assert.ok(loadRegistry(auto.root));
  assert.deepEqual(loadWorkflowState(auto.root, { kind: "module", module_id: "alpha" })!.active_instances, {});
  // A later manifest addition follows the same controlled initialization path.
  const manifest = JSON.parse(readFileSync(join(auto.root, "docs/aidlc/ideation/module-manifest.json"), "utf8"));
  manifest.modules.push({ module_id: "gamma", name: "Gamma", service_id: "gamma" });
  write(auto.root, "docs/aidlc/ideation/module-manifest.json", manifest);
  const betaBefore = readFileSync(lightStatePath(auto.root, { kind: "module", module_id: "beta" }), "utf8");
  const beforeCreation = snapshot(auto.root);
  const failed = cli(auto.root, ["orchestrate", "next", "--module", "gamma", "--work", "New gamma scope"], auto.session.binding, "registry");
  assert.equal(failed.status, 2, JSON.stringify(failed.directive));
  assert.deepEqual(snapshot(auto.root), beforeCreation, "later module initialization restores the existing registry and sibling workflows");
  const created = cli(auto.root, ["orchestrate", "next", "--module", "gamma", "--work", "New gamma scope"], auto.session.binding);
  assert.equal(created.status, 0, JSON.stringify(created.directive));
  assert.equal(created.directive.binding_required, true);
  assert.equal(loadWorkflowState(auto.root, { kind: "module", module_id: "gamma" })!.work_description, "New gamma scope");
  assert.equal(readFileSync(lightStatePath(auto.root, { kind: "module", module_id: "beta" }), "utf8"), betaBefore);
  assert.ok(loadRegistry(auto.root)!.modules.some(row => row.module_id === "gamma"));
} finally { dispose(auto.root); }
console.log("PASS real next --module auto-split and later module creation require explicit target binding");
