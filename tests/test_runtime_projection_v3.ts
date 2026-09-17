import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { LocalCoordinationProviderV3 } from "../core/tools/aidlc-coordination-local-v3";
import { buildRuntimeProjectionV3, inspectRuntimeDoctorV3 } from "../core/tools/aidlc-runtime-v3";
import { synchronizeWorkflowInstancesV3, type WorkflowInstancePlanV3 } from "../core/tools/aidlc-scheduler-v3";
import { createInitialWorkflowStateV3 } from "../core/tools/aidlc-state-v3";
import { initializeWorkflowStateV3 } from "../core/tools/aidlc-state-v3-store";
import { signTeamRecord } from "../core/tools/aidlc-trust";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), `aidlc-runtime-${process.pid}`);
mkdirSync(root, { recursive: true });
const project = join(root, "project");
const trust = join(root, "trust");
const originalTrust = process.env.AIDLC_TRUST_DIR;
const originalSecret = process.env.AIDLC_TRUST_SECRET;

function writeEvidence(relative: string, record: Record<string, unknown>): void {
  const path = join(project, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...record, integrity: signTeamRecord(record) }, null, 2)}\n`, "utf8");
}

try {
  process.env.AIDLC_TRUST_DIR = trust;
  delete process.env.AIDLC_TRUST_SECRET;
  mkdirSync(project, { recursive: true });
  const instance = "code-review@module:module-a@unit:unit-a";
  const plan: WorkflowInstancePlanV3[] = [{
    stage_instance: instance,
    stage: "code-review",
    axis: "unit",
    module_id: "module-a",
    unit_id: "unit-a",
    requires: [],
    order: 0,
  }];
  const initial = synchronizeWorkflowInstancesV3(createInitialWorkflowStateV3("feature", "3.0.0", "runtime-workflow"), plan);
  initializeWorkflowStateV3(project, initial);
  new LocalCoordinationProviderV3(project).claim(instance, {
    actor_id: "actor:runtime",
    device_id: "device:runtime",
    client_id: "client:runtime",
  });

  const valid = {
    evidence_version: "1",
    timestamp: "2026-09-17T00:00:00.000Z",
    stage_instance: instance,
    module_id: "module-a",
    unit_id: "unit-a",
    status: "passed",
    producer: {
      name: "loeyae-aidlc-evidence",
      mode: "controlled",
      execution_id: "runtime-projection-test",
    },
  };
  writeEvidence(".aidlc/evidence/code-review/module-a/unit-a/review-evidence.json", valid);

  const projection = buildRuntimeProjectionV3(project, new Date("2026-09-17T01:00:00.000Z"));
  assert.equal(projection.authoritative, false);
  assert.equal(projection.workflow.workflow_id, "runtime-workflow");
  assert.equal(projection.instances.length, 1);
  assert.equal(projection.instances[0].stage_instance, instance);
  assert.equal(projection.instances[0].claim?.actor_id, "actor:runtime");
  assert.ok(projection.instances[0].claim?.provider_receipt_digest);
  assert.equal(JSON.stringify(projection).includes("provider_receipt\""), false, "projection must not expose provider receipt bodies");
  assert.equal(projection.summary.evidence.verified, 1);
  assert.equal(projection.summary.evidence.invalid, 0);
  assert.equal(projection.evidence[0].status, "verified");

  const doctor = inspectRuntimeDoctorV3(project, new Date("2026-09-17T01:00:00.000Z"));
  assert.equal(doctor.healthy, true);
  assert.deepEqual(doctor.errors, []);

  writeFileSync(join(project, ".aidlc/evidence/code-review/module-a/unit-a/invalid.json"), "{not-json", "utf8");
  const invalidDoctor = inspectRuntimeDoctorV3(project, new Date("2026-09-17T01:00:00.000Z"));
  assert.equal(invalidDoctor.healthy, false);
  assert.equal(invalidDoctor.projection.summary.evidence.unreadable, 1);
  assert.ok(invalidDoctor.errors.some((item) => item.includes("invalid.json")));

  const cliResult = spawnSync(process.execPath, [tsx, cli, "runtime", "summary", "--project", project, "--as-of", "2026-09-17T01:00:00.000Z"], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, AIDLC_TRUST_DIR: trust },
  });
  assert.equal(cliResult.status, 0, `${cliResult.stdout || ""}\n${cliResult.stderr || ""}`);
  const cliProjection = JSON.parse(cliResult.stdout) as { kind: string; authoritative: boolean; workflow: { workflow_id: string } };
  assert.equal(cliProjection.kind, "aidlc.runtime-projection");
  assert.equal(cliProjection.authoritative, false);
  assert.equal(cliProjection.workflow.workflow_id, "runtime-workflow");

  console.log("V3 runtime projection tests passed");
} finally {
  if (originalTrust === undefined) delete process.env.AIDLC_TRUST_DIR;
  else process.env.AIDLC_TRUST_DIR = originalTrust;
  if (originalSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
  else process.env.AIDLC_TRUST_SECRET = originalSecret;
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}
