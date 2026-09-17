import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  resolveCommitDiffAttestations,
  type AttestationResolution,
} from "../core/tools/aidlc-attestation-resolver";
import { readSourceRevision } from "../core/tools/aidlc-revision";
import { signTeamRecord } from "../core/tools/aidlc-trust";

const repository = resolve(import.meta.dirname, "..");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const cli = join(repository, "bin", "cli.ts");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-attestation-"));
const trust = join(scratch, "trust");
const now = Date.parse("2026-09-17T07:00:00.000Z");
const originalTrustDirectory = process.env.AIDLC_TRUST_DIR;
const originalTrustSecret = process.env.AIDLC_TRUST_SECRET;
process.env.AIDLC_TRUST_DIR = trust;
delete process.env.AIDLC_TRUST_SECRET;

interface Fixture {
  repo: string;
  base: string;
  source: string;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "AI-DLC Attestation Tests",
      GIT_AUTHOR_EMAIL: "attestation-tests@example.invalid",
      GIT_COMMITTER_NAME: "AI-DLC Attestation Tests",
      GIT_COMMITTER_EMAIL: "attestation-tests@example.invalid",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stdout || ""}\n${result.stderr || ""}`);
  return (result.stdout || "").trim();
}

function initRepository(name: string): string {
  const repo = join(scratch, name);
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "attestation-tests@example.invalid"]);
  git(repo, ["config", "user.name", "AI-DLC Attestation Tests"]);
  return repo;
}

function commit(repo: string, message: string): string {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function changedRepository(name: string, paths = ["src/unit.ts"]): Fixture {
  const repo = initRepository(name);
  for (const path of paths) {
    const absolute = join(repo, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, "baseline\n", "utf8");
  }
  const base = commit(repo, "baseline");
  for (const path of paths) writeFileSync(join(repo, path), "changed\n", "utf8");
  const source = commit(repo, "source change");
  return { repo, base, source };
}

function signedRecord(record: Record<string, unknown>): Record<string, unknown> {
  return { ...record, integrity: signTeamRecord(record) };
}

function writeEvidence(
  fixture: Fixture,
  sensor: string,
  record: Record<string, unknown>,
  moduleId = "module-a",
  unitId = "unit-a",
): string {
  const sourceRevision = readSourceRevision(fixture.repo);
  assert.equal(sourceRevision.commit, fixture.source);
  const unsigned = { ...record, source_revision: sourceRevision };
  const path = `.aidlc/evidence/code-review/${moduleId}/${unitId}/${sensor}.json`;
  const absolute = join(fixture.repo, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(signedRecord(unsigned), null, 2)}\n`, "utf8");
  return path;
}

function reviewRecord(files: string[]): Record<string, unknown> {
  return {
    evidence_version: "1",
    timestamp: new Date(now).toISOString(),
    status: "passed",
    spec_axis: "passed",
    standards_axis: "passed",
    reviewer: "reviewer:attestation-test",
    files_reviewed: files,
    issues_found: 0,
    issues_resolved: 0,
    issues_open: 0,
  };
}

function resolveFixture(fixture: Fixture, head: string, changedPaths?: string[]): AttestationResolution {
  return resolveCommitDiffAttestations({
    repository_root: fixture.repo,
    base: fixture.base,
    head,
    changed_paths: changedPaths,
    now,
  });
}

function cliResolve(fixture: Fixture, head: string, path: string): Record<string, unknown> {
  const result = spawnSync(process.execPath, [tsx, cli, "attestation", "resolve", "--base", fixture.base, "--head", head, "--repo", fixture.repo, "--path", path, "--as-of", new Date(now).toISOString()], {
    cwd: fixture.repo,
    encoding: "utf8",
    shell: false,
    env: { ...process.env, AIDLC_TRUST_DIR: trust },
  });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

try {
  {
    const fixture = changedRepository("verified");
    writeEvidence(fixture, "review-evidence", reviewRecord(["src/unit.ts"]));
    const head = commit(fixture.repo, "review evidence");
    const result = resolveFixture(fixture, head, ["src/unit.ts"]);
    assert.equal(result.status, "verified");
    assert.equal(result.history.complete, true);
    assert.equal(result.changed_paths.length, 1);
    assert.equal(result.changed_paths[0].path, "src/unit.ts");
    assert.equal(result.changed_paths[0].status, "verified");
    assert.equal(result.unit_claims[0].module_id, "module-a");
    assert.equal(result.unit_claims[0].unit_id, "unit-a");
    assert.ok(result.changed_paths[0].trust_basis.some((item) => item.includes("signature")));
    const cliResult = cliResolve(fixture, head, "src/unit.ts");
    assert.equal(cliResult.status, "verified");
  }

  {
    const fixture = changedRepository("drifted");
    writeEvidence(fixture, "review-evidence", reviewRecord(["src/unit.ts"]));
    commit(fixture.repo, "review evidence");
    writeFileSync(join(fixture.repo, "src/unit.ts"), "drifted after review\n", "utf8");
    const head = commit(fixture.repo, "post-review source drift");
    const result = resolveFixture(fixture, head, ["src/unit.ts"]);
    assert.equal(result.status, "drifted");
    assert.equal(result.changed_paths[0].status, "drifted");
    assert.ok(result.changed_paths[0].unit_claims[0].trust_basis.some((item) => item.includes("changed after source_revision")));
  }

  {
    const fixture = changedRepository("unattested");
    writeEvidence(fixture, "review-evidence", reviewRecord(["src/other.ts"]));
    const head = commit(fixture.repo, "unrelated review evidence");
    const result = resolveFixture(fixture, head, ["src/unit.ts"]);
    assert.equal(result.status, "unattested");
    assert.equal(result.changed_paths[0].status, "unattested");
    assert.deepEqual(result.unit_claims, []);
  }

  {
    const fixture = changedRepository("unsigned");
    const unsigned = {
      evidence_version: "1",
      timestamp: new Date(now).toISOString(),
      status: "passed",
      producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: "unsigned-run" },
      source_revision: readSourceRevision(fixture.repo),
      changed_paths: ["src/unit.ts"],
      checks: { status: "passed" },
    };
    const path = join(fixture.repo, ".aidlc/evidence/code-review/module-a/unit-a/build-test-evidence.json");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(unsigned)}\n`, "utf8");
    const head = commit(fixture.repo, "unsigned evidence");
    const result = resolveFixture(fixture, head, ["src/unit.ts"]);
    assert.equal(result.status, "unverifiable");
    assert.equal(result.changed_paths[0].status, "unverifiable");
    assert.ok(result.changed_paths[0].unit_claims[0].trust_basis.some((item) => item.includes("integrity")));
  }

  {
    const fixture = changedRepository("uncontrolled");
    const unsigned = {
      evidence_version: "1",
      timestamp: new Date(now).toISOString(),
      status: "passed",
      source_revision: readSourceRevision(fixture.repo),
      changed_paths: ["src/unit.ts"],
    };
    const path = join(fixture.repo, ".aidlc/evidence/code-review/module-a/unit-a/build-test-evidence.json");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(signedRecord(unsigned))}\n`, "utf8");
    const head = commit(fixture.repo, "signed but uncontrolled evidence");
    const result = resolveFixture(fixture, head, ["src/unit.ts"]);
    assert.equal(result.status, "unverifiable");
    assert.equal(result.changed_paths[0].status, "unverifiable");
  }

  {
    const fixture = changedRepository("controlled");
    writeEvidence(fixture, "build-test-evidence", {
      evidence_version: "1",
      timestamp: new Date(now).toISOString(),
      status: "passed",
      producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: "controlled-run" },
      changed_paths: ["src/unit.ts"],
      artifacts: [{ id: "unit", path: "src/unit.ts", sha256: createHash("sha256").update("changed\n").digest("hex") }],
      checks: { status: "passed" },
    });
    const head = commit(fixture.repo, "controlled evidence");
    const result = resolveFixture(fixture, head, ["src/unit.ts"]);
    assert.equal(result.status, "verified");
    assert.equal(result.changed_paths[0].status, "verified");
    assert.equal(result.unit_claims[0].authorities[0].coverage, "artifacts");
  }

  {
    const fixture = changedRepository("artifact-drift");
    writeEvidence(fixture, "build-test-evidence", {
      evidence_version: "1",
      timestamp: new Date(now).toISOString(),
      status: "passed",
      producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: "artifact-run" },
      changed_paths: ["src/unit.ts"],
      artifacts: [{ id: "unit", path: "src/unit.ts", sha256: "0".repeat(64) }],
      checks: { status: "passed" },
    });
    const head = commit(fixture.repo, "artifact evidence");
    const result = resolveFixture(fixture, head, ["src/unit.ts"]);
    assert.equal(result.status, "drifted");
    assert.equal(result.changed_paths[0].status, "drifted");
    assert.ok(result.changed_paths[0].unit_claims[0].trust_basis.some((item) => item.includes("content digest")));
  }

  {
    const origin = changedRepository("shallow-origin");
    writeEvidence(origin, "review-evidence", reviewRecord(["src/unit.ts"]));
    const head = commit(origin.repo, "review evidence");
    const shallow = join(scratch, "shallow-clone");
    git(scratch, ["clone", "--quiet", "--depth", "3", `file://${origin.repo}`, shallow]);
    const result = resolveCommitDiffAttestations({
      repository_root: shallow,
      base: origin.base,
      head,
      now,
      changed_paths: ["src/unit.ts"],
    });
    assert.equal(result.history.shallow, true);
    assert.equal(result.status, "indeterminate");
    assert.equal(result.changed_paths[0].status, "indeterminate");
  }

  {
    const fixture = changedRepository("invalid-input");
    const head = fixture.source;
    const invalidRevision = resolveCommitDiffAttestations({ repository_root: fixture.repo, base: "../outside", head, now });
    assert.equal(invalidRevision.status, "unverifiable");
    assert.ok(invalidRevision.errors.some((item) => item.includes("safe Git revision")));
    const invalidPath = resolveFixture(fixture, head, ["../outside"]);
    assert.equal(invalidPath.status, "unverifiable");
    assert.equal(invalidPath.changed_paths[0].status, "unverifiable");
  }

  {
    const repo = initRepository("missing-merge-base");
    writeFileSync(join(repo, "main.txt"), "main\n", "utf8");
    const base = commit(repo, "main root");
    git(repo, ["switch", "--orphan", "unrelated"]);
    writeFileSync(join(repo, "unrelated.txt"), "unrelated\n", "utf8");
    const head = commit(repo, "unrelated root");
    const result = resolveCommitDiffAttestations({ repository_root: repo, base, head, now });
    assert.equal(result.status, "unverifiable");
    assert.ok(result.errors.some((item) => item.includes("merge base")));
  }

  {
    const fixture = changedRepository("aggregate", ["src/a.ts", "src/b.ts"]);
    writeEvidence(fixture, "review-evidence", reviewRecord(["src/a.ts"]));
    const head = commit(fixture.repo, "partial review evidence");
    const result = resolveFixture(fixture, head);
    assert.equal(result.changed_paths.find((item) => item.path === "src/a.ts")?.status, "verified");
    assert.equal(result.changed_paths.find((item) => item.path === "src/b.ts")?.status, "unattested");
    assert.equal(result.status, "unattested");
    assert.equal(result.summary.verified, 1);
    assert.equal(result.summary.unattested, 1);
  }

  console.log("Commit/diff attestation resolver tests passed");
} finally {
  if (originalTrustDirectory === undefined) delete process.env.AIDLC_TRUST_DIR;
  else process.env.AIDLC_TRUST_DIR = originalTrustDirectory;
  if (originalTrustSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
  else process.env.AIDLC_TRUST_SECRET = originalTrustSecret;
  assert.equal(existsSync(scratch), true);
  rmSync(scratch, { recursive: true, force: true });
}
