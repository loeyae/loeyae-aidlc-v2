import assert from "node:assert/strict";
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { statePath } from "../core/tools/aidlc-state";
import {
  createRegeneratedWorkflowStateV3,
  MAX_V1_REGENERATION_SOURCE_BYTES,
  validateWorkflowStateV3,
  type WorkflowStateV3,
} from "../core/tools/aidlc-state-v3";
import { readEnrollment } from "../core/tools/aidlc-trust";

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

const repositoryRoot = resolve(import.meta.dirname, "..");
const tsxCli = join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const cli = join(repositoryRoot, "bin", "cli.ts");
const sandbox = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-v1-regeneration-"));
const originalEnvironment = {
  collaboration: process.env.AIDLC_COLLABORATION_V3,
  trustDirectory: process.env.AIDLC_TRUST_DIR,
  trustSecret: process.env.AIDLC_TRUST_SECRET,
};

function environment(trust: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AIDLC_COLLABORATION_V3: "1",
    AIDLC_TRUST_DIR: trust,
    AIDLC_TRUST_SECRET: undefined,
    ...extra,
  };
}

function run(project: string, trust: string, args: string[], extra: NodeJS.ProcessEnv = {}): CliResult {
  const result = spawnSync(process.execPath, [tsxCli, cli, ...args], {
    cwd: project,
    encoding: "utf8",
    env: environment(trust, extra),
    shell: false,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function success(project: string, trust: string, args: string[], extra: NodeJS.ProcessEnv = {}): Record<string, unknown> {
  const result = run(project, trust, args, extra);
  assert.equal(result.status, 0, `${args.join(" ")}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function identityArgs(): string[] {
  return [
    "--actor-id", "actor:legacy-owner",
    "--device-id", "device:regenerator",
    "--client-id", "client:regeneration-session",
  ];
}

function regenerationArgs(...extra: string[]): string[] {
  return [
    "state", "regenerate-v3",
    "--scope", "feature",
    "--source-version", "1.37.5",
    "--with-prd",
    ...identityArgs(),
    ...extra,
  ];
}

function legacyState(project: string, content?: string): Buffer {
  const path = join(project, "docs", "aidlc", "state.md");
  mkdirSync(join(project, "docs", "aidlc"), { recursive: true });
  const markdown = content || `# AI-DLC 状态跟踪

- **状态模式版本**：2

## 项目信息
- **项目类型**：存量项目
- **执行路径**：完整流程
- **当前阶段**：Construction
- **当前步骤**：C4 代码生成

## 阶段进度
| 路由 | 步骤 | 状态 | 完成时间 | 产物/证据 |
|------|------|------|----------|-----------|
| I1 | 工作区检测 | completed | 2026-01-01 | legacy evidence |
`;
  writeFileSync(path, markdown);
  return readFileSync(path);
}

function withTrust<T>(trust: string, operation: () => T): T {
  process.env.AIDLC_COLLABORATION_V3 = "1";
  process.env.AIDLC_TRUST_DIR = trust;
  delete process.env.AIDLC_TRUST_SECRET;
  return operation();
}

try {
  const project = join(sandbox, "legacy-project");
  const trust = join(sandbox, "legacy-trust");
  mkdirSync(project, { recursive: true });
  const original = legacyState(project);
  const expectedDigest = createHash("sha256").update(original).digest("hex");

  const continuityRoute = run(project, trust, ["orchestrate", "next", "--status"]);
  assert.equal(continuityRoute.status, 2);
  const continuityDirective = JSON.parse(continuityRoute.stdout) as Record<string, unknown>;
  assert.equal(continuityDirective.kind, "error");
  assert.equal(continuityDirective.error_code, "V1_REGENERATION_REQUIRED");
  assert.equal(continuityDirective.source_path, "docs/aidlc/state.md");
  assert.equal(continuityDirective.progress_imported, false);
  assert.equal(existsSync(statePath(project)), false);
  assert.equal(existsSync(trust), false);

  const plan = success(project, trust, regenerationArgs());
  assert.equal(plan.kind, "state-v3-regeneration-plan");
  assert.equal(plan.applied, false);
  assert.equal(plan.source_generation, "v1");
  assert.equal(plan.source_format, "aidlc-state-markdown");
  assert.equal(plan.source_path, "docs/aidlc/state.md");
  assert.equal(plan.source_sha256, expectedDigest);
  assert.equal(plan.source_state_mode_version, 2);
  assert.equal(plan.source_package_version, "1.37.5");
  assert.equal(plan.target_schema_version, 3);
  assert.equal(plan.target_revision, 1);
  assert.equal(plan.progress_imported, false);
  assert.deepEqual(plan.selected_optional_stages, ["prd-generation"]);
  assert.equal(existsSync(statePath(project)), false, "dry-run must not create machine state");
  assert.equal(existsSync(trust), false, "dry-run must not create device credentials or enrollment");
  assert.ok(readFileSync(join(project, "docs", "aidlc", "state.md")).equals(original));

  const applied = success(project, trust, regenerationArgs("--apply"));
  assert.equal(applied.kind, "state-v3-regeneration-applied");
  assert.equal(applied.workflow_id, plan.workflow_id, "dry-run and apply must identify the same regenerated workflow");
  const persisted = validateWorkflowStateV3(
    JSON.parse(readFileSync(statePath(project), "utf8")) as unknown,
    true,
  );
  assert.equal(persisted.schema_version, 3);
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.scope, "feature");
  assert.deepEqual(persisted.selected_optional_stages, ["prd-generation"]);
  assert.deepEqual(persisted.completed_stages, []);
  assert.deepEqual(persisted.skipped_stages, []);
  assert.deepEqual(persisted.completed_stage_instances, []);
  assert.deepEqual(persisted.skipped_stage_instances, []);
  assert.deepEqual(persisted.history, []);
  assert.deepEqual(persisted.instances, {});
  assert.equal(persisted.events.length, 1);
  assert.equal(persisted.events[0].event_type, "workflow_regenerated");
  assert.equal(persisted.events[0].payload.progress_imported, false);
  const source = persisted.events[0].payload.source as Record<string, unknown>;
  assert.equal(source.sha256, expectedDigest);
  assert.equal(source.path, "docs/aidlc/state.md");
  assert.equal(source.generation, "v1");
  assert.equal(source.format, "aidlc-state-markdown");
  withTrust(trust, () => {
    assert.throws(() => createRegeneratedWorkflowStateV3({
      identity: {
        actor_id: "actor:legacy-owner",
        device_id: "device:regenerator",
        client_id: "client:regeneration-session",
      },
      source: {
        path: "../outside-state.md",
        sha256: expectedDigest,
        bytes: original.length,
        state_mode_version: 2,
        package_version: "1.37.5",
        project_type: "存量项目",
        execution_path: "完整流程",
        current_phase: "Construction",
        current_step: "C4 代码生成",
      },
      source_bytes: original,
      scope: "feature",
      workflow_id: "invalid-v1-source-path",
    }), /canonical project-relative POSIX path/);
  });
  assert.equal((persisted.integrity as Record<string, unknown>).algorithm, "ed25519");
  assert.ok(persisted.events.every((event) => event.integrity.algorithm === "ed25519"));
  assert.ok(readFileSync(join(project, "docs", "aidlc", "state.md")).equals(original));
  assert.equal(existsSync(join(project, "device-signing-key.json")), false);
  assert.equal(existsSync(join(trust, "trust.key")), false);
  withTrust(trust, () => {
    const enrollment = readEnrollment(project);
    assert.equal(enrollment?.workflow_id, persisted.workflow_id);
    assert.equal(enrollment?.trust_mode, "device-signature-v1");
    assert.equal(enrollment?.event_head_hash, persisted.event_head.event_hash);
  });
  const beforeInspection = readFileSync(statePath(project));
  const inspection = success(project, trust, ["recover", "inspect"]);
  assert.equal((inspection.state as Record<string, unknown>).schema_version, 3);
  assert.equal((inspection.state as Record<string, unknown>).event_chain_verified, true);
  assert.ok(readFileSync(statePath(project)).equals(beforeInspection), "inspect must not mutate regenerated state");

  const liveLockPath = `${statePath(project)}.lock`;
  writeFileSync(liveLockPath, `${JSON.stringify({
    schema_version: 1,
    pid: process.pid,
    token: "a".repeat(32),
    created_at: new Date(0).toISOString(),
  })}\n`);
  const staleTime = new Date(Date.now() - 60_000);
  utimesSync(liveLockPath, staleTime, staleTime);
  const stateBeforeLockedLoad = readFileSync(statePath(project));
  const lockedStatus = run(project, trust, ["orchestrate", "next", "--status"]);
  assert.notEqual(lockedStatus.status, 0);
  assert.match(lockedStatus.stderr, /timed out waiting for state v3 lock/);
  assert.equal(existsSync(liveLockPath), true, "a live stale lock owner must not be unlinked");
  assert.ok(readFileSync(statePath(project)).equals(stateBeforeLockedLoad), "locked load must not mutate state");
  unlinkSync(liveLockPath);

  const directive = success(project, trust, ["orchestrate", "next", ...identityArgs()]);
  assert.equal(directive.kind, "run-stage");
  assert.equal(typeof directive.stage_instance, "string");
  const continued = validateWorkflowStateV3(
    JSON.parse(readFileSync(statePath(project), "utf8")) as WorkflowStateV3,
    true,
  );
  assert.equal(continued.events[0].event_type, "workflow_regenerated");
  assert.ok(continued.events.length > 1, "normal orchestration must extend the regenerated event chain");

  const overwrite = run(project, trust, regenerationArgs("--apply"));
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /workflow state already exists.*state migrate-v3.*aidlc-continuity/s);

  const interruptedProject = join(sandbox, "interrupted-project");
  const interruptedTrust = join(sandbox, "interrupted-trust");
  mkdirSync(interruptedProject, { recursive: true });
  legacyState(interruptedProject);
  const interruptedPlan = success(interruptedProject, interruptedTrust, regenerationArgs());
  const interrupted = run(interruptedProject, interruptedTrust, regenerationArgs("--apply"), {
    AIDLC_STATE_V3_FAILPOINT: "after-enrollment",
  });
  assert.notEqual(interrupted.status, 0);
  assert.match(interrupted.stderr, /state v3 failpoint after-enrollment/);
  assert.equal(existsSync(statePath(interruptedProject)), false);
  withTrust(interruptedTrust, () => {
    const pending = readEnrollment(interruptedProject);
    assert.equal(pending?.status, "pending");
    assert.equal(pending?.initialization_kind, "workflow_regenerated");
    assert.match(String(pending?.initialization_digest), /^[a-f0-9]{64}$/);
  });
  const mismatchedIdentity = run(interruptedProject, interruptedTrust, [
    "state", "regenerate-v3",
    "--scope", "feature",
    "--source-version", "1.37.5",
    "--with-prd",
    "--apply",
    "--actor-id", "actor:different-owner",
    "--device-id", "device:regenerator",
    "--client-id", "client:regeneration-session",
  ]);
  assert.notEqual(mismatchedIdentity.status, 0);
  assert.match(mismatchedIdentity.stderr, /pending project enrollment does not match this workflow initialization intent/);
  assert.equal(existsSync(statePath(interruptedProject)), false);
  const resumed = success(interruptedProject, interruptedTrust, regenerationArgs("--apply"));
  assert.equal(resumed.workflow_id, interruptedPlan.workflow_id);
  withTrust(interruptedTrust, () => assert.equal(readEnrollment(interruptedProject)?.status, "active"));

  const afterStateProject = join(sandbox, "after-state-project");
  const afterStateTrust = join(sandbox, "after-state-trust");
  mkdirSync(afterStateProject, { recursive: true });
  legacyState(afterStateProject);
  const afterStatePlan = success(afterStateProject, afterStateTrust, regenerationArgs());
  const afterStateInterrupted = run(afterStateProject, afterStateTrust, regenerationArgs("--apply"), {
    AIDLC_STATE_V3_FAILPOINT: "after-state",
  });
  assert.notEqual(afterStateInterrupted.status, 0);
  assert.match(afterStateInterrupted.stderr, /state v3 failpoint after-state/);
  assert.equal(existsSync(statePath(afterStateProject)), true);
  withTrust(afterStateTrust, () => assert.equal(readEnrollment(afterStateProject)?.status, "pending"));
  const stateBeforeResume = readFileSync(statePath(afterStateProject));
  const afterStateResumed = success(afterStateProject, afterStateTrust, regenerationArgs("--apply"));
  assert.equal(afterStateResumed.workflow_id, afterStatePlan.workflow_id);
  assert.ok(readFileSync(statePath(afterStateProject)).equals(stateBeforeResume), "after-state retry must not rewrite state");
  withTrust(afterStateTrust, () => assert.equal(readEnrollment(afterStateProject)?.status, "active"));

  const outsideProject = join(sandbox, "outside-project");
  const outsideTrust = join(sandbox, "outside-trust");
  mkdirSync(outsideProject, { recursive: true });
  writeFileSync(join(sandbox, "outside-state.md"), "# AI-DLC 状态跟踪\n");
  const outside = run(outsideProject, outsideTrust, [
    "state", "regenerate-v3", "--scope", "feature", "--source", "../outside-state.md", ...identityArgs(),
  ]);
  assert.notEqual(outside.status, 0);
  assert.match(outside.stderr, /escapes project root/);

  const malformedProject = join(sandbox, "malformed-project");
  const malformedTrust = join(sandbox, "malformed-trust");
  mkdirSync(malformedProject, { recursive: true });
  legacyState(malformedProject, "# AI-DLC 状态跟踪\n\n## 项目信息\n- **项目类型**：存量项目\n");
  const malformed = run(malformedProject, malformedTrust, regenerationArgs());
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /missing progress section/);

  const productProgressProject = join(sandbox, "product-progress-project");
  const productProgressTrust = join(sandbox, "product-progress-trust");
  mkdirSync(productProgressProject, { recursive: true });
  legacyState(productProgressProject, `# AI-DLC 状态跟踪

## 项目信息
- **项目类型**：存量产品

## 产品级进度
| 步骤 | 状态 |
|------|------|
| 产品需求 | completed |
`);
  const productProgressPlan = success(productProgressProject, productProgressTrust, regenerationArgs());
  assert.equal(productProgressPlan.source_state_mode_version, null);
  assert.equal((productProgressPlan.legacy_hints as Record<string, unknown>).project_type, "存量产品");
  assert.equal((productProgressPlan.legacy_hints as Record<string, unknown>).execution_path, null);
  assert.equal((productProgressPlan.legacy_hints as Record<string, unknown>).current_phase, null);
  assert.equal((productProgressPlan.legacy_hints as Record<string, unknown>).current_step, null);
  assert.equal(existsSync(productProgressTrust), false);

  const invalidUtfProject = join(sandbox, "invalid-utf-project");
  const invalidUtfTrust = join(sandbox, "invalid-utf-trust");
  mkdirSync(join(invalidUtfProject, "docs", "aidlc"), { recursive: true });
  writeFileSync(join(invalidUtfProject, "docs", "aidlc", "state.md"), Buffer.from([0xff, 0xfe, 0xfd]));
  const invalidUtf = run(invalidUtfProject, invalidUtfTrust, regenerationArgs());
  assert.notEqual(invalidUtf.status, 0);
  assert.match(invalidUtf.stderr, /valid UTF-8 Markdown/);
  assert.equal(existsSync(invalidUtfTrust), false);

  const oversizedProject = join(sandbox, "oversized-project");
  const oversizedTrust = join(sandbox, "oversized-trust");
  mkdirSync(join(oversizedProject, "docs", "aidlc"), { recursive: true });
  writeFileSync(
    join(oversizedProject, "docs", "aidlc", "state.md"),
    Buffer.alloc(MAX_V1_REGENERATION_SOURCE_BYTES + 1, 0x61),
  );
  const oversized = run(oversizedProject, oversizedTrust, regenerationArgs());
  assert.notEqual(oversized.status, 0);
  assert.match(oversized.stderr, new RegExp(`exceeds ${MAX_V1_REGENERATION_SOURCE_BYTES} bytes`));
  assert.equal(existsSync(oversizedTrust), false);

  const sourceSymlinkProject = join(sandbox, "source-symlink-project");
  const sourceSymlinkTrust = join(sandbox, "source-symlink-trust");
  const externalAidlc = join(sandbox, "external-aidlc");
  mkdirSync(sourceSymlinkProject, { recursive: true });
  mkdirSync(externalAidlc, { recursive: true });
  writeFileSync(join(externalAidlc, "state.md"), original);
  let symlinkSupported = true;
  try {
    symlinkSync(
      externalAidlc,
      join(sourceSymlinkProject, "legacy-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") symlinkSupported = false;
    else throw error;
  }
  if (symlinkSupported) {
    const symlinked = run(sourceSymlinkProject, sourceSymlinkTrust, regenerationArgs("--source", "legacy-link/state.md"));
    assert.notEqual(symlinked.status, 0);
    assert.match(symlinked.stderr, /traverses a symbolic link/);
    assert.equal(existsSync(sourceSymlinkTrust), false);

    const targetSymlinkProject = join(sandbox, "target-symlink-project");
    const targetSymlinkTrust = join(sandbox, "target-symlink-trust");
    const externalTarget = join(sandbox, "external-state-target");
    mkdirSync(join(targetSymlinkProject, "legacy"), { recursive: true });
    mkdirSync(externalTarget, { recursive: true });
    writeFileSync(join(targetSymlinkProject, "legacy", "state.md"), original);
    symlinkSync(externalTarget, join(targetSymlinkProject, "docs"), process.platform === "win32" ? "junction" : "dir");
    const unsafeTarget = run(
      targetSymlinkProject,
      targetSymlinkTrust,
      regenerationArgs("--source", "legacy/state.md", "--apply"),
    );
    assert.notEqual(unsafeTarget.status, 0);
    assert.match(unsafeTarget.stderr, /state directory must be a regular non-symlink directory/);
    assert.equal(existsSync(join(externalTarget, "aidlc", "aidlc-state.json")), false);
    assert.equal(existsSync(targetSymlinkTrust), false);
  }

  const disabledProject = join(sandbox, "disabled-project");
  const disabledTrust = join(sandbox, "disabled-trust");
  mkdirSync(disabledProject, { recursive: true });
  legacyState(disabledProject);
  const disabledPlan = run(disabledProject, disabledTrust, regenerationArgs(), {
    AIDLC_COLLABORATION_V3: "0",
  });
  assert.notEqual(disabledPlan.status, 0);
  assert.match(disabledPlan.stderr, /explicitly disables collaborative state v3/);
  assert.equal(existsSync(disabledTrust), false);

  const invalidPrd = run(outsideProject, outsideTrust, [
    "state", "regenerate-v3", "--scope", "express", "--with-prd", ...identityArgs(),
  ]);
  assert.notEqual(invalidPrd.status, 0);
  assert.match(invalidPrd.stderr, /optional PRD stage is not available for scope express/);

  const v2Project = join(sandbox, "v2-project");
  const v2Trust = join(sandbox, "v2-trust");
  mkdirSync(v2Project, { recursive: true });
  legacyState(v2Project);
  success(v2Project, v2Trust, ["orchestrate", "next", "--scope", "express"], {
    AIDLC_COLLABORATION_V3: "0",
    AIDLC_TRUST_SECRET: "v2-regeneration-refusal-secret-at-least-32-bytes",
  });
  const signedV2 = run(v2Project, v2Trust, regenerationArgs("--apply"));
  assert.notEqual(signedV2.status, 0);
  assert.match(signedV2.stderr, /workflow state already exists.*use state migrate-v3/s);

  console.log("V1 Markdown to fresh signed schema v3 regeneration tests passed");
} finally {
  if (originalEnvironment.collaboration === undefined) delete process.env.AIDLC_COLLABORATION_V3;
  else process.env.AIDLC_COLLABORATION_V3 = originalEnvironment.collaboration;
  if (originalEnvironment.trustDirectory === undefined) delete process.env.AIDLC_TRUST_DIR;
  else process.env.AIDLC_TRUST_DIR = originalEnvironment.trustDirectory;
  if (originalEnvironment.trustSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
  else process.env.AIDLC_TRUST_SECRET = originalEnvironment.trustSecret;
  rmSync(sandbox, { recursive: true, force: true });
}
