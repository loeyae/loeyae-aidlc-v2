import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";

const root = resolve(import.meta.dirname, "..");
const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const cli = join(root, "bin", "cli.ts");
const sandbox = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-team-cli-v3-"));
const project = join(sandbox, "project");
const ownerTrust = join(sandbox, "owner-trust");
const memberTrust = join(sandbox, "member-trust");
mkdirSync(project, { recursive: true });

function run(trust: string, args: string[], input?: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], {
    cwd: project,
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      AIDLC_COLLABORATION_V3: "1",
      AIDLC_TRUST_DIR: trust,
      AIDLC_TRUST_SECRET: undefined,
    },
  });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function success(trust: string, args: string[], input?: string): Record<string, unknown> {
  const result = run(trust, args, input);
  assert.equal(result.status, 0, `${args.join(" ")}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

try {
  const initialized = success(ownerTrust, [
    "orchestrate", "next", "--scope", "express",
    "--actor-id", "actor:owner", "--device-id", "device:owner", "--client-id", "client:owner",
  ]);
  assert.equal(initialized.schema_version, 3);
  assert.equal(existsSync(join(ownerTrust, "trust.key")), false);

  const request = success(memberTrust, [
    "orchestrate", "next",
    "--actor-id", "actor:member", "--device-id", "device:member", "--client-id", "client:member",
  ]);
  assert.equal(request.kind, "ask");
  assert.equal(request.ask_type, "team-enrollment-confirmation");
  assert.match(String(request.confirmation_phrase), /^JOIN .+ [a-f0-9]{8}$/);
  assert.doesNotMatch(JSON.stringify(request), /AIDLC_TRUST_SECRET|private_key|approval_token/);

  const envelope = (phrase: string, extra: Record<string, unknown> = {}): string => JSON.stringify({
    schema_version: 1,
    kind: "aidlc.team.enrollment.confirmation",
    request_id: request.request_id,
    confirmation_phrase: phrase,
    ...extra,
  });
  const unknown = run(memberTrust, [
    "orchestrate", "next", "--team-enrollment-confirmation-stdin",
    "--actor-id", "actor:member", "--device-id", "device:member", "--client-id", "client:member",
  ], envelope(String(request.confirmation_phrase), { unexpected: true }));
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unknown field unexpected/);

  const wrong = run(memberTrust, [
    "orchestrate", "next", "--team-enrollment-confirmation-stdin",
    "--actor-id", "actor:member", "--device-id", "device:member", "--client-id", "client:member",
  ], envelope(`${String(request.confirmation_phrase)} `));
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /must exactly match/);

  const directive = success(memberTrust, [
    "orchestrate", "next", "--team-enrollment-confirmation-stdin",
    "--actor-id", "actor:member", "--device-id", "device:member", "--client-id", "client:member",
  ], envelope(String(request.confirmation_phrase)));
  assert.equal(directive.kind, "run-stage");
  assert.equal((directive.claim_receipt as Record<string, unknown>).device_id, "device:member");
  assert.equal(((directive.claim_receipt as Record<string, unknown>).integrity as Record<string, unknown>).algorithm, "ed25519");
  assert.equal(existsSync(join(memberTrust, "trust.key")), false);

  const ownerDevice = JSON.parse(readFileSync(join(ownerTrust, "device-signing-key.json"), "utf8")) as Record<string, unknown>;
  const memberDevice = JSON.parse(readFileSync(join(memberTrust, "device-signing-key.json"), "utf8")) as Record<string, unknown>;
  assert.notEqual(ownerDevice.key_id, memberDevice.key_id);

  console.log("Schema v3 CLI team enrollment without shared secrets passed");
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
