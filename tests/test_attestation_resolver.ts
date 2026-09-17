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

const repository = resolve(import.meta.dirname, "..");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const cli = join(repository, "bin", "cli.ts");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-attestation-"));
const now = Date.parse("2026-09-17T07:00:00.000Z");

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

function writeEvidence(
  fixture: Fixture,
  sensor: string,
  record: Record<string, unknown>,
  moduleId = "module-a",
  unitId = "unit-a",
): string {
  const sourceRevision = readSourceRevision(fixture.repo);
  assert.equal(sourceRevision.commit, fixture.source);
  const path = `.aidlc/evidence/code-review/${moduleId}/${unitId}/${sensor}.json`;
  const absolute = join(fixture.repo, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify({ ...record, source_revision: sourceRevision }, null, 2)}\n`, "utf8");
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

function controlledRecord(paths: string[], artifacts: Array<Record<string, unknown>> = []): Record<string, unknown> {
  return {
    evidence_version: "1",
    timestamp: new Date(now).toISOString(),
    status: "passed",
    producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: "controlled-run" },
    changed_paths: paths,
    artifacts,
    checks: { status: "passed" },
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
    env: process.env,
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
    assert.equal(result.changed_paths[0].path, "src/unit.ts");
    assert.equal(result.changed_paths[0].status, "verified");
    assert.equal(result.unit_attestations[0].module_id, "module-a");
    assert.equal(result.unit_attestations[0].unit_id, "unit-a");
    assert.ok(result.unit_attestations[0].trust_basis.some((item) => item.includes("controlled evidence format")));
    assert.equal(cliResolve(fixture, head, "src/unit.ts").status, "verified");
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
    assert.ok(result.changed_paths[0].unit_attestations[0].trust_basis.some((item) => item.includes("changed after source_revision")));
  }

  {
    const fixture = changedRepository("unattested");
    writeEvidence(fixture, "review-evidence", reviewRecord(["src/other.ts"]));
    const head = commit(fixture.repo, "unrelated review evidence");
    const result = resolveFixture(fixture, head, ["src/unit.ts"]);
    assert.equal(result.status, "unattested");
    assert.equal(result.changed_paths[0].status, "unattested");
    assert.deepEqual(result.unit_attestations, []);
  }

  {
    const fixture = changedRepository("controlled");
    writeEvidence(fixture, "build-test-evidence", controlledRecord(["src/unit.ts"]));
    const head = commit(fixture.repo, "controlled evidence");
    const result = resolveFixture(fixture, head, ["src/unit.ts"]);
    assert.equal(result.status, "verified");
    assert.equal(result.changed_paths[0].status, "verified");
  }

  {
    const fixture = changedRepository("uncontrolled");
    writeEvidence(fixture, "build-test-evidence", {
      evidence_version: "1",
      timestamp: new Date(now).toISOString(),
      status: "passed",
      changed_paths: ["src/unit.ts"],
    });
    const head = commit(fixture.repo, "uncontrolled evidence");
    const result = resolveFixture(fixture, head, ["src/unit.ts"]);
    assert.equal(result.status, "unverifiable");
    assert.equal(result.changed_paths[0].status, "unverifiable");
  }

  {
    const fixture = changedRepository("artifact-drift");
    writeEvidence(fixture, "build-test-evidence", controlledRecord(
      ["src/unit.ts"],
      [{ id: "unit", path: "src/unit.ts", sha256: "0".repeat(64) }],
    ));
    const head = commit(fixture.repo, "artifact evidence");
    const result = resolveFixture(fixture, head, ["src/unit.ts"]);
    assert.equal(result.status, "drifted");
    assert.equal(result.changed_paths[0].status, "drifted");
    assert.ok(result.changed_paths[0].unit_attestations[0].trust_basis.some((item) => item.includes("content digest")));
  }

  {
    const fixture = changedRepository("invalid-input");
    const invalidRevision = resolveCommitDiffAttestations({ repository_root: fixture.repo, base: "../outside", head: fixture.source, now });
    assert.equal(invalidRevision.status, "unverifiable");
    assert.ok(invalidRevision.errors.some((item) => item.includes("safe Git revision")));
  }

  console.log("Commit/diff attestation resolver tests passed");
} finally {
  assert.equal(existsSync(scratch), true);
  rmSync(scratch, { recursive: true, force: true });
}
