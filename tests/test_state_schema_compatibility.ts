import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  createInitialState,
  saveWorkflowState,
  statePath,
} from "../core/tools/aidlc-state";
import {
  appendWorkflowEventV3,
  createInitialWorkflowStateV3,
  type WorkflowStateV3,
} from "../core/tools/aidlc-state-v3";
import {
  initializeWorkflowStateV3,
  mutateWorkflowStateV3,
} from "../core/tools/aidlc-state-v3-store";
import {
  registerEnrollment,
  registerTeamEnrollment,
} from "../core/tools/aidlc-trust";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = resolve(ROOT, "bin", "cli.ts");
const SEMANTIC = resolve(ROOT, "core", "tools", "aidlc-semantic-checks.ts");
const require = createRequire(import.meta.url);
const TSX = require.resolve("tsx/cli");
const SCRATCH = process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir();
const V2_SECRET = "schema-aware-v2-test-secret-at-least-32-bytes";

interface Result {
  status: number;
  stdout: string;
  stderr: string;
}

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function environment(
  trust: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    "AIDLC_TRUST_SECRET",
    "AIDLC_RECOVERY_SECRET",
    "AIDLC_RECOVERY_KEY_FILE",
    "AIDLC_RECOVERY_ENROLLMENT_FILE",
    "AIDLC_ACTIVE_MODULE",
    "AIDLC_ACTIVE_UNIT",
  ]) {
    delete env[key];
  }
  return {
    ...env,
    AIDLC_COLLABORATION_V3: "1",
    AIDLC_TRUST_DIR: trust,
    ...extra,
  };
}

function withEnvironment<T>(
  env: NodeJS.ProcessEnv,
  operation: () => T,
): T {
  const keys = [
    "AIDLC_COLLABORATION_V3",
    "AIDLC_TRUST_DIR",
    "AIDLC_TRUST_SECRET",
    "AIDLC_RECOVERY_SECRET",
    "AIDLC_RECOVERY_KEY_FILE",
    "AIDLC_RECOVERY_ENROLLMENT_FILE",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (keys.includes(key) && value !== undefined) process.env[key] = value;
  }
  try {
    return operation();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function run(
  script: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Result {
  const result = spawnSync(process.execPath, [TSX, script, ...args], {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function runCli(
  cwd: string,
  env: NodeJS.ProcessEnv,
  ...args: string[]
): Result {
  return run(CLI, args, cwd, env);
}

function runSemantic(
  cwd: string,
  env: NodeJS.ProcessEnv,
  sensor = "recovery-evidence",
): Result {
  return run(SEMANTIC, ["--sensor", sensor], cwd, env);
}

function stateBytes(project: string): Buffer {
  return readFileSync(statePath(project));
}

function writeState(project: string, state: unknown): void {
  writeFileSync(statePath(project), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function writeRecoveryArtifacts(project: string): void {
  mkdirSync(resolve(project, ".aidlc"), { recursive: true });
  mkdirSync(resolve(project, "docs", "aidlc"), { recursive: true });
  writeFileSync(resolve(project, ".aidlc", "context-compacted"), "true\n", "utf8");
  writeFileSync(
    resolve(project, "docs", "aidlc", "handoff.md"),
    "Signed state restored and handoff recorded.\n",
    "utf8",
  );
}

function expectBlocked(result: Result, pattern: RegExp, label: string): void {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
  assert.match(`${result.stderr}\n${result.stdout}`, pattern, label);
}

function createV2Fixture(project: string, trust: string): void {
  mkdirSync(project, { recursive: true });
  const env = environment(trust, { AIDLC_TRUST_SECRET: V2_SECRET });
  withEnvironment(env, () => {
    const state = createInitialState(
      "express",
      "3.2.0",
      "schema-aware-recovery-v2",
    );
    delete state.routing_model;
    delete state.completed_stage_instances;
    delete state.skipped_stage_instances;
    delete state.selected_optional_stages;
    state.current_phase = "construction";
    state.current_stage = "compact-recovery";
    saveWorkflowState(project, state);
  });
  writeRecoveryArtifacts(project);
}

function createV3Fixture(
  project: string,
  trust: string,
): WorkflowStateV3 {
  mkdirSync(project, { recursive: true });
  const env = environment(trust);
  const state = withEnvironment(env, () =>
    initializeWorkflowStateV3(
      project,
      createInitialWorkflowStateV3(
        "feature",
        "3.2.0",
        "schema-aware-recovery-v3",
      ),
    ),
  );
  writeRecoveryArtifacts(project);
  return state;
}

function main(): void {
  const base = resolve(
    SCRATCH,
    `aidlc-schema-aware-state-${process.pid}-${Date.now()}`,
  );
  const v2Project = resolve(base, "v2-project");
  const v2Trust = resolve(base, "v2-trust");
  const v3Project = resolve(base, "v3-project");
  const ownerTrust = resolve(base, "owner-trust");
  const readerTrust = resolve(base, "reader-trust");
  const emptyProject = resolve(base, "empty-project");
  const emptyTrust = resolve(base, "empty-trust");
  mkdirSync(base, { recursive: true });

  try {
    createV2Fixture(v2Project, v2Trust);
    const v2Env = environment(v2Trust, {
      AIDLC_TRUST_SECRET: V2_SECRET,
    });
    const v2Before = stateBytes(v2Project);
    const v2Inspect = runCli(v2Project, v2Env, "recover", "inspect");
    assert.equal(v2Inspect.status, 0, v2Inspect.stderr);
    const v2Inspection = JSON.parse(v2Inspect.stdout) as Record<string, any>;
    assert.equal(v2Inspection.state.schema_version, 2);
    assert.equal(v2Inspection.state.integrity_algorithm, "hmac-sha256");
    assert.equal(digest(stateBytes(v2Project)), digest(v2Before));
    const v2Semantic = runSemantic(v2Project, v2Env);
    assert.equal(v2Semantic.status, 0, v2Semantic.stderr);
    assert.equal(JSON.parse(v2Semantic.stdout).state_restored, true);
    const v2MissingModule = runSemantic(
      v2Project,
      environment(v2Trust, {
        AIDLC_TRUST_SECRET: V2_SECRET,
        AIDLC_ACTIVE_MODULE: "",
        AIDLC_ACTIVE_UNIT: "",
      }),
      "diagram-contract",
    );
    expectBlocked(
      v2MissingModule,
      /active module is required/i,
      "controlled schema v2 semantic checker must require module context",
    );

    const initial = createV3Fixture(v3Project, ownerTrust);
    const ownerEnv = environment(ownerTrust);
    const readerEnv = environment(readerTrust);
    const initialBytes = stateBytes(v3Project);
    const initialRevision = initial.revision;
    const initialHead = initial.event_head.event_hash;

    const v3Inspect = runCli(v3Project, ownerEnv, "recover", "inspect");
    assert.equal(v3Inspect.status, 0, v3Inspect.stderr);
    const inspection = JSON.parse(v3Inspect.stdout) as Record<string, any>;
    assert.equal(inspection.state.schema_version, 3);
    assert.equal(inspection.state.integrity_algorithm, "ed25519");
    assert.equal(inspection.state.signature_verified, true);
    assert.equal(inspection.state.event_chain_verified, true);
    assert.equal(inspection.state.revision, initialRevision);
    assert.equal(inspection.state.event_head.event_hash, initialHead);
    assert.equal(digest(stateBytes(v3Project)), digest(initialBytes));

    const publicSemantic = runSemantic(v3Project, readerEnv);
    assert.equal(publicSemantic.status, 0, publicSemantic.stderr);
    assert.equal(JSON.parse(publicSemantic.stdout).state_restored, true);
    assert.equal(digest(stateBytes(v3Project)), digest(initialBytes));
    assert.equal(
      existsSync(resolve(readerTrust, "device-signing-key.json")),
      false,
      "public semantic verification must not create a local device credential",
    );

    const enrolledSemantic = runSemantic(v3Project, ownerEnv);
    assert.equal(enrolledSemantic.status, 0, enrolledSemantic.stderr);
    assert.equal(digest(stateBytes(v3Project)), digest(initialBytes));

    mkdirSync(emptyProject, { recursive: true });
    const missingState = runSemantic(emptyProject, environment(emptyTrust));
    expectBlocked(
      missingState,
      /signed workflow state is missing/i,
      "semantic checker must fail explicitly without signed state",
    );

    const missingModule = runSemantic(
      v3Project,
      environment(readerTrust, {
        AIDLC_ACTIVE_MODULE: "",
        AIDLC_ACTIVE_UNIT: "",
      }),
      "diagram-contract",
    );
    expectBlocked(
      missingModule,
      /active module is required/i,
      "v3 module semantic checker must not silently scan without context",
    );

    const reEnrollEnv = environment(readerTrust, {
      AIDLC_RECOVERY_KEY_FILE: resolve(base, "must-not-be-read.key"),
    });
    const reEnroll = runCli(v3Project, reEnrollEnv, "recover", "re-enroll");
    expectBlocked(
      reEnroll,
      /schema v3.*JOIN.*TAKEOVER.*continuity/is,
      "schema v3 re-enroll must fail closed with the continuity path",
    );
    assert.doesNotMatch(reEnroll.stderr, /must-not-be-read|recovery trust key/i);
    assert.equal(digest(stateBytes(v3Project)), digest(initialBytes));

    assert.throws(
      () =>
        withEnvironment(readerEnv, () =>
          mutateWorkflowStateV3(v3Project, (state) =>
            appendWorkflowEventV3(state, {
              event_type: "workflow_frozen",
              occurred_at: "2026-09-12T12:00:00.000Z",
              payload: { reason: "unauthorized reader mutation" },
            }),
          ),
        ),
      /local team enrollment|JOIN phrase/i,
    );
    assert.equal(digest(stateBytes(v3Project)), digest(initialBytes));

    const frozen = withEnvironment(ownerEnv, () =>
      mutateWorkflowStateV3(v3Project, (state) =>
        appendWorkflowEventV3(state, {
          event_type: "workflow_frozen",
          occurred_at: "2026-09-12T12:01:00.000Z",
          payload: { reason: "schema-aware recovery fixture" },
        }),
      ),
    );
    const frozenBytes = stateBytes(v3Project);

    writeFileSync(statePath(v3Project), initialBytes);
    expectBlocked(
      runCli(v3Project, ownerEnv, "recover", "inspect"),
      /accepted event head|rollback or fork/i,
      "accepted-head rollback must be rejected",
    );

    const fork = withEnvironment(ownerEnv, () =>
      appendWorkflowEventV3(initial, {
        event_type: "workflow_frozen",
        occurred_at: "2026-09-12T12:02:00.000Z",
        payload: { reason: "alternate signed fork" },
      }),
    );
    writeState(v3Project, fork);
    expectBlocked(
      runCli(v3Project, ownerEnv, "recover", "inspect"),
      /accepted event head|rollback or fork/i,
      "a valid alternate event-chain fork must be rejected by local enrollment",
    );

    const tampered = structuredClone(frozen) as Record<string, any>;
    tampered.integrity.signature = `${String(tampered.integrity.signature).slice(0, -1)}A`;
    writeState(v3Project, tampered);
    expectBlocked(
      runCli(v3Project, ownerEnv, "recover", "inspect"),
      /integrity|signature/i,
      "tampered v3 state signature must be rejected",
    );

    writeFileSync(statePath(v3Project), frozenBytes);
    withEnvironment(ownerEnv, () =>
      registerTeamEnrollment(
        v3Project,
        "wrong-team-workflow",
        frozen.event_head.event_hash,
      ),
    );
    expectBlocked(
      runCli(v3Project, ownerEnv, "recover", "inspect"),
      /workflow_id does not match/i,
      "wrong workflow enrollment must be rejected",
    );

    withEnvironment(ownerEnv, () =>
      registerTeamEnrollment(
        v3Project,
        frozen.workflow_id,
        frozen.event_head.event_hash,
      ),
    );
    const legacyEnrollmentEnv = environment(ownerTrust, {
      AIDLC_TRUST_SECRET: V2_SECRET,
    });
    withEnvironment(legacyEnrollmentEnv, () =>
      registerEnrollment(v3Project, frozen.workflow_id),
    );
    expectBlocked(
      runCli(v3Project, legacyEnrollmentEnv, "recover", "inspect"),
      /device-signature-v1 local enrollment/i,
      "team-signed v3 state must reject a legacy HMAC enrollment",
    );

    withEnvironment(ownerEnv, () =>
      registerTeamEnrollment(
        v3Project,
        frozen.workflow_id,
        frozen.event_head.event_hash,
      ),
    );
    writeFileSync(statePath(v3Project), frozenBytes);
    const finalInspect = runCli(v3Project, ownerEnv, "recover", "inspect");
    assert.equal(finalInspect.status, 0, finalInspect.stderr);
    assert.equal(digest(stateBytes(v3Project)), digest(frozenBytes));

    console.log(
      "Schema-aware recovery and semantic compatibility tests passed",
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

main();
