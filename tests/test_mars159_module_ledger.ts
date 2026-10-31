import { workflowMaintenancePlan } from "../core/tools/aidlc-light-state";
import { releaseFixtureClaims } from "./mars243_fixture_session";
import { saveFixtureState, saveFixtureStateWithChecks } from "./mars243_fixture_session";
import { fixtureEnvironment } from "./mars243_fixture_session";
/**
 * MARS-159 B + C.
 *
 * B: the module checkpoint ledger (refs/heads/aidlc/modules/<id>) keeps the latest module
 *    state and contract view recoverable after the feature branch that carried it was
 *    merged/squashed and deleted, also from a fresh clone; broken chains, contract drift and
 *    overwrites of a local state fail closed or need explicit approval.
 * C: binary produce (NUL bytes) no longer trips no-todo as "unreadable"; traceability still
 *    requires text and a real read failure is still reported.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, parseLightWorkflowState, saveWorkflowState, type WorkflowRef, type WorkflowState } from "../core/tools/aidlc-light-state";
import { checkpointModule, ledgerRef, verifyLedgerChain } from "../core/tools/aidlc-module-ledger";
import { readProducedArtifact } from "../core/tools/aidlc-orchestrate";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const probe = join(repository, "tests", "gate_probe.ts");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars159-ledger-"));
const M01 = "m01-trade";
const M02 = "m02-product";
const M01_REF: WorkflowRef = { kind: "module", module_id: M01 };
const M02_REF: WorkflowRef = { kind: "module", module_id: M02 };
const LINEAGE = "0b6f3c2a-7d41-4e8b-9a52-1c3d5e7f9a01";
const GLOBAL_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" };
const CONTRACTS = "docs/aidlc/ideation/product-contracts.md";

function run(cwd: string, args: string[]): { status: number; directive: Record<string, unknown> } {
  if (args[0] === "state" && ["recover", "adopt", "rebuild"].includes(args[1])) {
    const module = args.includes("--module") ? args[args.indexOf("--module")+1] : undefined;
    args = [...args, "--maintenance", workflowMaintenancePlan(cwd, module).token];
  }
  const env = { ...process.env };
  delete env.AIDLC_MODULE;
  const result = spawnSync(process.execPath, [tsx, cli, "orchestrate", ...args], { cwd, encoding: "utf8", env: {...fixtureEnvironment(cwd, ["orchestrate", ...args]), ...(env)} });
  const text = (result.stdout || "").trim() || (result.stderr || "").trim();
  const directive = JSON.parse(text) as Record<string, unknown>;
  if (directive.binding_required && args[0] === "next" && args.includes("--module")) {
    const retry = args.filter((arg, i) => arg !== "--work" && args[i - 1] !== "--work");
    return run(cwd, retry);
  }
  return { status: result.status ?? 1, directive };
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function write(project: string, path: string, content: string | Buffer): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), content);
}

function commitAll(project: string, message: string): string {
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", message]);
  return git(project, ["rev-parse", "HEAD"]);
}

function contracts(version = "v1"): string {
  return `# 产品级契约索引

## 契约清单
| 契约 ID | 类型 | 提供方 | 权威来源 | 版本/策略 | 兼容状态 | Owner |
|---------|------|--------|----------|-----------|----------|-------|
| CT-M01-ORDER | API | m01-trade | openapi | ${version} | 兼容 | trade |

## 消费者状态
| 契约 ID | 消费者 | 影响 | 状态 | 验证证据 |
|---------|--------|------|------|----------|
| CT-M01-ORDER | m02-product | 下单 | 未验证 | - |
`;
}

function bump(project: string, ref: WorkflowRef, times: number): number {
  for (let index = 0; index < times; index++) {
    const state = loadWorkflowState(project, ref)!;
    state.revision += 1;
    saveFixtureState(project, state, ref);
  }
  return loadWorkflowState(project, ref)!.revision;
}

const sections: string[] = [];
function section(name: string, body: () => void): void {
  body();
  sections.push(name);
  console.log(`PASS ${name}`);
}

try {
  // ---- origin (bare) + team checkout with a split workflow ----
  const origin = join(root, "origin.git");
  git(root, ["init", "-q", "--bare", origin]);
  const project = join(root, "team");
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q", "-b", "main"]);
  git(project, ["config", "core.autocrlf", "false"]);
  git(project, ["remote", "add", "origin", origin]);
  write(project, "README.md", "REQ-BASE ledger fixture\n");
  write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({
    schema_version: 1,
    modules: [
      { module_id: M01, name: "Trade", service_id: "trade-service" },
      { module_id: M02, name: "Product", service_id: "product-service" },
    ],
  }));
  write(project, CONTRACTS, contracts());
  commitAll(project, "fixture");
  const state = createInitialState("feature", "4.1.0", LINEAGE, [], "Deliver modules");
  state.completed_stages = [...GLOBAL_STAGES];
  state.completed_stage_instances = [...GLOBAL_STAGES];
  state.skipped_stage_instances = [`reverse-engineering@module:${M01}`, `reverse-engineering@module:${M02}`];
  saveFixtureState(project, state);
  const split = run(project, ["split", "--from", LINEAGE]);
  assert.equal(split.status, 0, JSON.stringify(split.directive));
  releaseFixtureClaims(project);
  const mainCommit = commitAll(project, "split");
  git(project, ["push", "-q", "origin", "main"]);
  const baseM01 = loadWorkflowState(project, M01_REF)!.revision;
  const baseM02 = loadWorkflowState(project, M02_REF)!.revision;

  // ---- two modules advance in parallel on feature branches and checkpoint ----
  git(project, ["checkout", "-q", "-b", "feat/m01"]);
  bump(project, M01_REF, 4);
  const m01Checkpoint = run(project, ["state", "checkpoint", "--module", M01]);
  assert.equal(m01Checkpoint.directive.kind, "print", JSON.stringify(m01Checkpoint.directive));
  assert.match(String(m01Checkpoint.directive.message), /not published/);
  assert.match(String(m01Checkpoint.directive.message), /git push origin refs\/heads\/aidlc\/modules\/m01-trade:refs\/heads\/aidlc\/modules\/m01-trade/);
  const m01Revision = loadWorkflowState(project, M01_REF)!.revision;
  const m01StateText = readFileSync(join(project, "aidlc/active/modules", M01, "aidlc-state.md"), "utf8");
  commitAll(project, "m01 progress");
  assert.equal(checkpointModule(project, M01, "again").status, "unchanged", "an unchanged state appends nothing");
  git(project, ["checkout", "-q", "main"]);
  git(project, ["checkout", "-q", "-b", "feat/m02"]);
  bump(project, M02_REF, 2);
  assert.equal(checkpointModule(project, M02, "test").status, "created");
  const m02Revision = loadWorkflowState(project, M02_REF)!.revision;
  commitAll(project, "m02 progress");
  git(project, ["checkout", "-q", "main"]);

  // Publish the ledger refs only (the feature branches are never pushed), then delete
  // the feature branches: their commits are unreachable from any ordinary branch.
  git(project, ["push", "-q", "origin", `${ledgerRef(M01)}:${ledgerRef(M01)}`, `${ledgerRef(M02)}:${ledgerRef(M02)}`]);
  git(project, ["branch", "-D", "feat/m01", "feat/m02"]);
  assert.equal(loadWorkflowState(project, M01_REF)!.revision, baseM01);

  section("unpublished-then-published checkpoints chain and verify", () => {
    const head = git(project, ["rev-parse", ledgerRef(M01)]);
    const verified = verifyLedgerChain(project, M01, head);
    assert.equal(verified.checkpoint.state_revision, m01Revision);
    assert.equal(verified.checkpoint.lineage, LINEAGE);
    assert.equal(verified.checkpoint.contracts.documents.length, 1, "the module's contract view is captured");
    assert.equal(git(project, ["rev-parse", "HEAD"]), mainCommit, "checkpointing never touches HEAD");
  });

  section("recover over an older local state needs approval, then restores the ledger head", () => {
    const refused = run(project, ["state", "recover", "--module", M01]);
    assert.equal(refused.directive.kind, "error");
    assert.match(String(refused.directive.message), /older than the checkpoint revision.*--user-input Approve/);
    const recovered = run(project, ["state", "recover", "--module", M01, "--user-input", "Approve", "--reason", "feature branch deleted"]);
    assert.equal(recovered.directive.kind, "print", JSON.stringify(recovered.directive));
    assert.equal(recovered.directive.revision, m01Revision + 1);
    assert.equal(recovered.directive.previous_local_revision, baseM01);
    assert.ok(Array.isArray(recovered.directive.backups) && (recovered.directive.backups as string[]).length >= 1, "the local state is backed up");
    assert.ok(Array.isArray(recovered.directive.evidence_missing), "missing evidence is listed for targeted re-verification");
    const restored = readFileSync(join(project, "aidlc/active/modules", M01, "aidlc-state.md"), "utf8");
    const restoredState = loadWorkflowState(project, M01_REF)!;
    assert.equal(restoredState.workflow_id, parseLightWorkflowState(m01StateText).workflow_id);
    assert.deepEqual(restoredState.active_instances, {}, "historical claims are not restored");
    assert.equal(restoredState.revision, m01Revision + 1);
    for (const field of ["history", "completed_stage_instances", "current_stage_instance", "work_description"] as const) assert.deepEqual(restoredState[field], parseLightWorkflowState(m01StateText)[field], `checkpoint content preserved: ${field}`);
    assert.match(readFileSync(join(project, "aidlc/active/audit.md"), "utf8"), /Event: STATE_RECOVERED/);
    assert.equal(run(project, ["state", "recover", "--module", M01]).directive.kind, "print", "a recovered module is up to date");
    git(project, ["checkout", "-q", "--", "."]);
    git(project, ["clean", "-qfd", "aidlc"]);
  });

  // ---- a fresh clone recovers from the remote-tracking ledger ----
  const clone = join(root, "clone");
  git(root, ["clone", "-q", origin, clone]);
  git(clone, ["config", "core.autocrlf", "false"]);

  section("a missing target state recovers while preserving its orphan audit and sibling", () => {
    const missing = join(root, "missing-target");
    git(root, ["clone", "-q", origin, missing]);
    const statePath = join(missing, "aidlc/active/modules", M01, "aidlc-state.md");
    const auditPath = join(missing, "aidlc/active/modules", M01, "audit.md");
    const orphanAudit = readFileSync(auditPath, "utf8") + "\n## Orphan local history\nkeep this uncheckpointed observation\n";
    writeFileSync(auditPath, orphanAudit);
    rmSync(statePath);
    const sibling = readFileSync(join(missing, "aidlc/active/modules", M02, "aidlc-state.md"));
    const restored = run(missing, ["state", "recover", "--module", M01, "--user-input", "Approve", "--reason", "restore missing target without discarding audit"]);
    assert.equal(restored.directive.kind, "print", JSON.stringify(restored.directive));
    const backup = (restored.directive.backups as string[]).find(path => path.includes("audit.md.bak-"));
    assert(backup, "existing orphan audit is backed up even without a local state");
    assert.equal(readFileSync(join(missing, backup), "utf8"), orphanAudit);
    assert.deepEqual(loadWorkflowState(missing, M01_REF)!.active_instances, {});
    assert.deepEqual(readFileSync(join(missing, "aidlc/active/modules", M02, "aidlc-state.md")), sibling);
  });

  section("a fresh clone recovers both modules from the fetched ledger", () => {
    assert.ok(git(clone, ["rev-parse", "--verify", `refs/remotes/origin/aidlc/modules/${M02}`]));
    const m02 = run(clone, ["state", "recover", "--module", M02, "--user-input", "Approve", "--reason", "fresh clone"]);
    assert.equal(m02.directive.kind, "print", JSON.stringify(m02.directive));
    assert.equal(m02.directive.revision, m02Revision + 1);
    assert.equal(loadWorkflowState(clone, M02_REF)!.revision, m02Revision + 1);
    const m01 = run(clone, ["state", "recover", "--module", M01, "--user-input", "Approve", "--reason", "fresh clone"]);
    assert.equal(m01.directive.kind, "print", JSON.stringify(m01.directive));
    assert.equal(loadWorkflowState(clone, M01_REF)!.revision, m01Revision + 1);
    assert.notEqual(m02Revision, baseM02);
  });

  section("a newer local state is not silently overwritten", () => {
    bump(clone, M02_REF, 3);
    const refused = run(clone, ["state", "recover", "--module", M02]);
    assert.equal(refused.directive.kind, "error");
    assert.match(String(refused.directive.message), /newer than the checkpoint revision/);
  });

  section("contract drift against the checkpoint fails closed", () => {
    git(clone, ["checkout", "-q", "--", "."]);
    write(clone, CONTRACTS, contracts("v2"));
    const blocked = run(clone, ["state", "recover", "--module", M02, "--user-input", "Approve", "--reason", "x"]);
    assert.equal(blocked.directive.kind, "error");
    assert.match(String(blocked.directive.message), /contract view of m02-product .* differs from checkpoint/);
    git(clone, ["checkout", "-q", "--", "."]);
  });

  section("a corrupted or discontinuous ledger blocks recovery", () => {
    const remoteHead = git(clone, ["rev-parse", `refs/remotes/origin/aidlc/modules/${M01}`]);
    const bad = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: clone, input: "{\"version\":\"1\",\"kind\":\"aidlc.module-checkpoint\"}\n", encoding: "utf8" }).stdout.trim();
    const tree = spawnSync("git", ["mktree"], { cwd: clone, input: `100644 blob ${bad}\tcheckpoint.json\n`, encoding: "utf8" }).stdout.trim();
    const commit = spawnSync("git", ["commit-tree", tree, "-p", remoteHead, "-m", "tampered"], { cwd: clone, encoding: "utf8", env: GIT_ENV }).stdout.trim();
    git(clone, ["update-ref", ledgerRef(M01), commit]);
    const blocked = run(clone, ["state", "recover", "--module", M01, "--user-input", "Approve", "--reason", "x"]);
    assert.equal(blocked.directive.kind, "error");
    assert.match(String(blocked.directive.message), /failed verification; nothing was recovered/);
    git(clone, ["update-ref", "-d", ledgerRef(M01)]);
  });

  section("no ledger means no promise: recovery reports the module as unrecoverable", () => {
    const empty = run(clone, ["state", "recover", "--module", "m09-none"]);
    assert.equal(empty.directive.kind, "error");
  });

  section("a later module checkpoint chains onto the published head", () => {
    const before = git(project, ["rev-parse", ledgerRef(M02)]);
    git(project, ["checkout", "-q", "-b", "feat/m02-next"]);
    const recovered = run(project, ["state", "recover", "--module", M02, "--user-input", "Approve", "--reason", "continue m02"]);
    assert.equal(recovered.directive.kind, "print", JSON.stringify(recovered.directive));
    bump(project, M02_REF, 1);
    const result = checkpointModule(project, M02, "report test");
    assert.equal(result.status, "created", JSON.stringify(result));
    assert.equal(git(project, ["rev-parse", `${result.commit}^`]), before);
    assert.equal(verifyLedgerChain(project, M02, result.commit!).chain_length, 2);
    assert.equal(result.published, false);
    // A checkpoint whose recorded predecessor is missing is a discontinuous chain.
    const orphan = spawnSync("git", ["commit-tree", `${result.commit}^{tree}`, "-m", "orphan"], { cwd: project, encoding: "utf8", env: GIT_ENV }).stdout.trim();
    assert.throws(() => verifyLedgerChain(project, M02, orphan), /discontinuous/);
    git(project, ["checkout", "-q", "-f", "main"]);
  });

  // ---- C: binary produce and no-todo ----
  section("binary produce does not trip no-todo; traceability still fails closed; read errors stay unreadable", () => {
    const single = join(root, "binary");
    mkdirSync(single, { recursive: true });
    git(single, ["init", "-q"]);
    const workflow: WorkflowState = createInitialState("feature", "4.13.2", "workflow-binary", [], "MARS-159 binary");
    workflow.completed_stages = ["workspace-detection"];
    workflow.completed_stage_instances = ["workspace-detection"];
    workflow.current_stage = "product-inception";
    workflow.current_phase = "ideation";
    workflow.current_stage_instance = "product-inception";
    saveFixtureState(single, workflow);
    write(single, "docs/aidlc/ideation/product-inception.md", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x54, 0x4f, 0x44, 0x4f]));
    const probeSensor = (sensor: string): string[] => {
      const result = spawnSync(process.execPath, [tsx, probe, "product-inception", "sensors", sensor], { cwd: single, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const value = JSON.parse((result.stdout || "").trim()) as { failures?: string[]; error?: string };
      assert.ok(!value.error, `gate_probe error: ${value.error}`);
      return value.failures || [];
    };
    assert.deepEqual(probeSensor("no-todo"), [], "binary produce is skipped by no-todo");
    assert.ok(probeSensor("traceability").some((failure) => /unreadable produced files/.test(failure)), "traceability does not accept binary as traced text");
    write(single, "docs/aidlc/ideation/product-inception.md", "# Product inception\n\nTODO: 补充定位\n");
    assert.ok(probeSensor("no-todo").some((failure) => /TODO\/FIXME\/HACK in/.test(failure)), "text TODO is still flagged");
    assert.equal(readProducedArtifact(join(single, "docs")).kind, "unreadable", "a real read failure is not treated as binary");
    assert.equal(readProducedArtifact(join(single, "docs/aidlc/ideation/product-inception.md")).kind, "text");
  });

  console.log(`\nAll ${sections.length} MARS-159 ledger/binary sections passed.`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
