import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { createInitialWorkflowStateV3 } from "../core/tools/aidlc-state-v3";
import { initializeWorkflowStateV3 } from "../core/tools/aidlc-state-v3-store";
import { synchronizeWorkflowInstancesV3 } from "../core/tools/aidlc-scheduler-v3";
import { LocalCoordinationProviderV3 } from "../core/tools/aidlc-coordination-local-v3";

const repository = resolve(import.meta.dirname, "..");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const tool = join(repository, "core", "tools", "aidlc-evidence.ts");
const originalCwd = process.cwd();
const sandbox = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-evidence-team-v3-"));
const project = join(sandbox, "project");
const trust = join(sandbox, "trust");
mkdirSync(project, { recursive: true });
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  AIDLC_COLLABORATION_V3: "1",
  AIDLC_TRUST_DIR: trust,
};
delete environment.AIDLC_TRUST_SECRET;

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: project, env: environment, encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout || ""}\n${result.stderr || ""}`);
}

try {
  process.env.AIDLC_COLLABORATION_V3 = "1";
  process.env.AIDLC_TRUST_DIR = trust;
  delete process.env.AIDLC_TRUST_SECRET;
  run("git", ["init", "-q"]);
  run("git", ["config", "user.email", "aidlc-tests@example.invalid"]);
  run("git", ["config", "user.name", "AI-DLC Tests"]);
  run("git", ["commit", "--allow-empty", "-qm", "baseline"]);

  const created = createInitialWorkflowStateV3("express", "3.0.0", "workflow-evidence-team-v3");
  const planned = synchronizeWorkflowInstancesV3(created, [{
    stage_instance: "build-and-test",
    stage: "build-and-test",
    axis: "project",
    requires: [],
    order: 0,
  }]);
  initializeWorkflowStateV3(project, planned);
  new LocalCoordinationProviderV3(project).claim("build-and-test", {
    actor_id: "actor:evidence",
    device_id: "device:evidence",
    client_id: "client:evidence",
  });

  mkdirSync(join(project, ".aidlc"), { recursive: true });
  mkdirSync(join(project, "dist"), { recursive: true });
  writeFileSync(join(project, "dist", "app.js"), "substantive build artifact");
  writeFileSync(join(project, ".aidlc", "evidence-commands.json"), JSON.stringify({
    version: "1",
    stage: "build-and-test",
    commands: [
      { id: "build", role: "build", argv: ["node", "-e", "process.stdout.write('build ok')"] },
      { id: "test", role: "test", argv: ["node", "-e", "process.stdout.write('1 passed, 0 failed')"] },
      { id: "check", role: "check", argv: ["node", "-e", "process.stdout.write('check ok')"] },
    ],
    artifacts: [{ id: "bundle", path: "dist/app.js" }],
  }));

  const result = spawnSync(process.execPath, [tsx, tool, "run", "--stage", "build-and-test"], {
    cwd: project,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  const evidencePath = join(project, ".aidlc", "evidence", "build-and-test", "build-test-evidence.json");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
  assert.equal((evidence.integrity as Record<string, unknown>).algorithm, "ed25519");
  assert.equal(evidence.stage_instance, "build-and-test");
  assert.equal(evidence.module_id, null);
  assert.equal(evidence.unit_id, null);
  assert.equal(environment.AIDLC_TRUST_SECRET, undefined);
  assert.equal(existsSync(join(trust, "trust.key")), false);

  process.chdir(project);
  const { checkSensors } = await import("../core/tools/aidlc-orchestrate");
  const sensorState = JSON.parse(readFileSync(join(project, "docs", "aidlc", "aidlc-state.json"), "utf8"));
  sensorState.current_stage = "build-and-test";
  sensorState.current_stage_instance = "build-and-test";
  const sensorFailures = await checkSensors({
    instance_id: "build-and-test",
    stage: { slug: "build-and-test", sensors: ["build-test-evidence"] },
    axis: "project",
  } as never, sensorState);
  assert.deepEqual(sensorFailures, []);
  process.chdir(originalCwd);

  console.log("Schema v3 Evidence Producer and sensor work without a shared secret");
} finally {
  process.chdir(originalCwd);
  rmSync(sandbox, { recursive: true, force: true });
}
