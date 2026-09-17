import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  composeRestrictedExtension,
  inspectRestrictedExtension,
  validateRestrictedExtension,
} from "../core/tools/aidlc-extension";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), `aidlc-extension-${process.pid}`);
const project = join(root, "project");
const source = join(root, "quality-pack");

function manifest(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    kind: "aidlc.restricted-extension",
    name: "quality-pack",
    version: "1.0.0",
    stages: [{
      slug: "quality-pack-review",
      phase: "construction",
      axis: "unit",
      scopes: ["feature"],
      produces: [".aidlc/extensions/quality-pack/review.json"],
      consumes: [],
      sensors: ["quality-pack-advisory"],
    }],
    contributions: [{
      target: "code-review",
      produces: [".aidlc/extensions/quality-pack/report.json"],
      consumes: [],
      sensors: ["quality-pack-advisory"],
      fragments: ["Add an advisory review checklist."],
    }],
    advisory_sensors: [{ id: "quality-pack-advisory", description: "Advisory-only extension signal" }],
    ...extra,
  };
}

function writeSource(value = manifest()): void {
  mkdirSync(join(source, "knowledge"), { recursive: true });
  mkdirSync(join(source, "stages", "construction"), { recursive: true });
  writeFileSync(join(source, "aidlc-extension.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  writeFileSync(join(source, "knowledge", "quality-pack.md"), "# Quality Pack\n", "utf8");
  writeFileSync(join(source, "stages", "construction", "quality-pack-review.md"), "# Advisory Review\n", "utf8");
}

try {
  mkdirSync(project, { recursive: true });
  writeSource();

  const validation = validateRestrictedExtension(source);
  assert.equal(validation.valid, true);
  assert.equal(validation.manifest.name, "quality-pack");
  assert.equal(validation.graph_closure.checked_consumes, 0);
  assert.ok(validation.source_files.includes("knowledge/quality-pack.md"));

  const first = composeRestrictedExtension(source, project);
  assert.equal(first.status, "composed");
  assert.ok(existsSync(join(project, ".aidlc", "extensions", "quality-pack", "ownership.json")));
  const second = composeRestrictedExtension(source, project);
  assert.equal(second.status, "unchanged");
  const status = inspectRestrictedExtension("quality-pack", project) as { status: string; projection: Record<string, unknown> };
  assert.equal(status.status, "current");
  assert.equal(status.projection.authoritative, false);
  assert.match(JSON.stringify(status.projection.restrictions), /does not modify canonical state/);

  const cliResult = spawnSync(process.execPath, [tsx, cli, "extension", "status", "quality-pack", "--project", project], {
    cwd: project,
    encoding: "utf8",
  });
  assert.equal(cliResult.status, 0, `${cliResult.stdout || ""}\n${cliResult.stderr || ""}`);
  assert.equal((JSON.parse(cliResult.stdout) as { status: string }).status, "current");

  writeFileSync(join(project, ".aidlc", "extensions", "quality-pack", "content", "knowledge", "quality-pack.md"), "user modification\n", "utf8");
  assert.throws(() => composeRestrictedExtension(source, project), /managed extension was modified/);

  const forbidden = join(root, "forbidden");
  mkdirSync(forbidden, { recursive: true });
  writeFileSync(join(forbidden, "aidlc-extension.json"), `${JSON.stringify(manifest({ approval: "block" }))}\n`, "utf8");
  assert.throws(() => validateRestrictedExtension(forbidden), /restricted field approval/);

  const missingProducer = join(root, "missing-producer");
  mkdirSync(missingProducer, { recursive: true });
  writeFileSync(join(missingProducer, "aidlc-extension.json"), `${JSON.stringify(manifest({
    stages: [{
      slug: "quality-pack-consumer",
      phase: "construction",
      axis: "unit",
      scopes: ["feature"],
      produces: [],
      consumes: [".aidlc/extensions/quality-pack/missing.json"],
      sensors: [],
    }],
    contributions: [],
  }))}\n`, "utf8");
  assert.throws(() => validateRestrictedExtension(missingProducer), /graph closure failed/);

  const ownership = JSON.parse(readFileSync(join(project, ".aidlc", "extensions", "quality-pack", "ownership.json"), "utf8")) as { entries: unknown[] };
  assert.ok(ownership.entries.length > 0);
  console.log("Restricted extension foundation tests passed");
} finally {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}
