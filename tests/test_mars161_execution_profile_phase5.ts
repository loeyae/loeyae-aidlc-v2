import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyExecutionProfile, classifyExecutionProfile } from "../core/tools/aidlc-execution-profile";
import { buildEvidenceReusePlan } from "../core/tools/aidlc-evidence-reuse-plan";
import { loadGraph, type StageGraph, type StageNode } from "../core/tools/aidlc-orchestrate";
import { buildRuleLoadPlan } from "../core/tools/aidlc-rule-load-plan";
import { fixtureEnvironment } from "./mars243_fixture_session";

const NOW = "2026-10-14T12:00:00.000Z";
const root = mkdtempSync(join(tmpdir(), "aidlc-mars161-phase5-"));
const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");

function stage(overrides: Partial<StageNode> & Pick<StageNode, "slug">): StageNode {
  return {
    slug: overrides.slug, number: overrides.number ?? "1", name: overrides.name ?? overrides.slug,
    phase: overrides.phase ?? "fixture", axis: overrides.axis ?? "project", execution: overrides.execution ?? "ALWAYS",
    selection: overrides.selection ?? "automatic", choices: overrides.choices ?? [], scopes: overrides.scopes ?? ["bugfix"],
    requires: overrides.requires ?? [], cross_module_requires: overrides.cross_module_requires ?? [], scope_waived_requires: overrides.scope_waived_requires ?? [],
    consumes: overrides.consumes ?? [], produces: overrides.produces ?? [], sensors: overrides.sensors ?? [], traceability: overrides.traceability ?? "not_applicable",
    completion_contract: overrides.completion_contract ?? "gated", condition: overrides.condition ?? "", approval: overrides.approval ?? "notify",
    file: overrides.file ?? `stages/fixture/${overrides.slug}.md`,
  };
}

const graph: StageGraph = { version: "fixture", stage_count: 2, stages: [
  stage({ slug: "advisory", sensors: ["advisory-evidence"], completion_contract: "instruction_only" }),
  stage({ slug: "gate", sensors: ["gate-evidence"] }),
] };
const expectedRevision = { commit: "fixture", dirty: false, worktree_digest: "a".repeat(64) };
const targetFor = (stage_slug: string) => ({ stage_slug, instance_id: stage_slug, axis: "project" as const });

function evidence(stageSlug: string, sensor: string, options: { timestamp?: string; scope?: string; controlled?: boolean; version?: string } = {}): void {
  const dir = join(root, ".aidlc", "evidence", stageSlug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sensor}.json`), JSON.stringify({
    evidence_version: options.version ?? "1", timestamp: options.timestamp ?? "2026-10-14T11:30:00.000Z",
    stage_instance: stageSlug, module_id: null, unit_id: null,
    producer: { name: options.controlled === false ? "other" : "loeyae-aidlc-evidence", mode: options.controlled === false ? "uncontrolled" : "controlled", execution_id: "fixture" },
    source_revision: { commit: "fixture", dirty: false, worktree_digest: "a".repeat(64), ...(options.scope === undefined ? {} : { scope: options.scope }) },
    checker: { id: `builtin:${sensor}`, sensor, status: "passed", exit_code: 0, argv_digest: "b".repeat(64) },
  }), "utf8");
}

try {
  evidence("advisory", "advisory-evidence");
  evidence("gate", "gate-evidence");
  const ruleLoadPlan = buildRuleLoadPlan(graph, { scope: "bugfix" });
  const valid = buildEvidenceReusePlan(graph, { projectRoot: root, scope: "bugfix", now: NOW, ruleLoadPlan, target: targetFor("advisory"), expectedSourceRevision: expectedRevision });
  assert.deepEqual(valid.selected_rule_stages, ruleLoadPlan.selected.map((entry) => entry.slug), "Phase 5 derives solely from the Phase-4 selected rules");
  assert.equal(valid.reuse.length, 1, "valid non-mandatory evidence is reusable");
  assert.equal(valid.reuse[0]?.stage_slug, "advisory");
  const gatePlan = buildEvidenceReusePlan(graph, { projectRoot: root, scope: "bugfix", now: NOW, target: targetFor("gate"), expectedSourceRevision: expectedRevision });
  assert.equal(gatePlan.verify.length, 1, "valid evidence of a gate is explicitly verified, never blindly reused");
  assert.equal(gatePlan.verify[0]?.stage_slug, "gate");
  assert.equal(gatePlan.verify[0]?.evidence?.source_scope, "worktree");

  evidence("advisory", "advisory-evidence", { timestamp: "2026-10-12T11:30:00.000Z" });
  const stale = buildEvidenceReusePlan(graph, { projectRoot: root, scope: "bugfix", now: NOW, target: targetFor("advisory"), expectedSourceRevision: expectedRevision });
  assert.equal(stale.revalidate.find((entry) => entry.stage_slug === "advisory")?.reason, "stale_evidence");
  evidence("advisory", "advisory-evidence", { scope: "module:other" });
  const incompatible = buildEvidenceReusePlan(graph, { projectRoot: root, scope: "bugfix", evidenceScope: "worktree", now: NOW, target: targetFor("advisory"), expectedSourceRevision: expectedRevision });
  assert.equal(incompatible.revalidate.find((entry) => entry.stage_slug === "advisory")?.reason, "incompatible_scope");
  evidence("advisory", "advisory-evidence", { controlled: false });
  const invalid = buildEvidenceReusePlan(graph, { projectRoot: root, scope: "bugfix", now: NOW, target: targetFor("advisory"), expectedSourceRevision: expectedRevision });
  assert.equal(invalid.revalidate.find((entry) => entry.stage_slug === "advisory")?.reason, "invalid_evidence");

  // Exact canonical paths eliminate the old "fresh after stale" candidate
  // ambiguity: only the current target instance's path is ever considered.
  const unitGraph: StageGraph = { version: "fixture", stage_count: 1, stages: [stage({ slug: "unit-stage", axis: "unit", sensors: ["unit-evidence"] })] };
  const unitDir = join(root, ".aidlc", "evidence", "unit-stage", "m", "u1");
  mkdirSync(unitDir, { recursive: true });
  writeFileSync(join(unitDir, "unit-evidence.json"), JSON.stringify({ evidence_version: "1", timestamp: "2026-10-14T11:30:00.000Z", stage_instance: "unit-stage:m:u1", module_id: "m", unit_id: "u1", producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: "u1" }, source_revision: expectedRevision, checker: { id: "builtin:unit-evidence", sensor: "unit-evidence", status: "passed", exit_code: 0, argv_digest: "b".repeat(64) } }));
  const u2 = buildEvidenceReusePlan(unitGraph, { projectRoot: root, scope: "bugfix", now: NOW, target: { stage_slug: "unit-stage", instance_id: "unit-stage:m:u2", axis: "unit", module_id: "m", unit_id: "u2" }, expectedSourceRevision: expectedRevision });
  assert.equal(u2.revalidate[0]?.reason, "missing_evidence", "u1 evidence can never serve u2");

  // Strict ISO, revision/digest and checker binding failures all fail closed.
  evidence("advisory", "advisory-evidence", { timestamp: "2026-10-14 11:30:00" });
  assert.equal(buildEvidenceReusePlan(graph, { projectRoot: root, scope: "bugfix", now: NOW, target: targetFor("advisory"), expectedSourceRevision: expectedRevision }).revalidate.find((entry) => entry.stage_slug === "advisory")?.reason, "invalid_evidence");
  evidence("advisory", "advisory-evidence", { timestamp: "2026-02-30T11:30:00.000Z" });
  assert.equal(buildEvidenceReusePlan(graph, { projectRoot: root, scope: "bugfix", now: NOW, target: targetFor("advisory"), expectedSourceRevision: expectedRevision }).revalidate.find((entry) => entry.stage_slug === "advisory")?.reason, "invalid_evidence", "overflow calendar dates are rejected");
  evidence("advisory", "advisory-evidence");
  const revisionMismatch = buildEvidenceReusePlan(graph, { projectRoot: root, scope: "bugfix", now: NOW, target: targetFor("advisory"), expectedSourceRevision: { ...expectedRevision, worktree_digest: "c".repeat(64) } });
  assert.equal(revisionMismatch.revalidate.find((entry) => entry.stage_slug === "advisory")?.reason, "invalid_evidence");
  const evidencePath = join(root, ".aidlc", "evidence", "advisory", "advisory-evidence.json");
  const validAdvisoryRecord = (identity: Record<string, unknown>) => ({ evidence_version: "1", timestamp: "2026-10-14T11:30:00.000Z", stage_instance: "advisory", module_id: null, unit_id: null, ...identity, producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: "x" }, source_revision: expectedRevision, checker: { id: "builtin:advisory-evidence", sensor: "advisory-evidence", status: "passed", exit_code: 0, argv_digest: "b".repeat(64) } });
  for (const [label, identity] of [
    ["wrong stage_instance", { stage_instance: "other" }],
    ["missing stage_instance", { stage_instance: null }],
    ["wrong module_id", { module_id: "other" }],
    ["wrong unit_id", { unit_id: "other" }],
  ] as const) {
    writeFileSync(evidencePath, JSON.stringify(validAdvisoryRecord(identity)));
    const result = buildEvidenceReusePlan(graph, { projectRoot: root, scope: "bugfix", now: NOW, target: targetFor("advisory"), expectedSourceRevision: expectedRevision });
    assert.equal(result.revalidate.find((entry) => entry.stage_slug === "advisory")?.reason, "invalid_evidence", `${label} must fail closed`);
  }
  writeFileSync(evidencePath, JSON.stringify({ evidence_version: "1", timestamp: "2026-10-14T11:30:00.000Z", producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: "x" }, source_revision: expectedRevision, checker: { id: "builtin:wrong", sensor: "wrong", status: "failed", exit_code: 1, argv_digest: "bad" } }));
  assert.equal(buildEvidenceReusePlan(graph, { projectRoot: root, scope: "bugfix", now: NOW, target: targetFor("advisory"), expectedSourceRevision: expectedRevision }).revalidate.find((entry) => entry.stage_slug === "advisory")?.reason, "invalid_evidence");
  const outside = join(root, "outside.json");
  writeFileSync(outside, "{}");
  try {
    rmSync(evidencePath); symlinkSync(outside, evidencePath, "file");
    assert.equal(buildEvidenceReusePlan(graph, { projectRoot: root, scope: "bugfix", now: NOW, target: targetFor("advisory"), expectedSourceRevision: expectedRevision }).revalidate.find((entry) => entry.stage_slug === "advisory")?.reason, "invalid_evidence", "symlink evidence is ignored");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
  }

  const refreshGraph: StageGraph = { version: "fixture", stage_count: 1, stages: [stage({ slug: "tdd", sensors: ["green-test-evidence"] })] };
  evidence("tdd", "green-test-evidence");
  const refresh = buildEvidenceReusePlan(refreshGraph, { projectRoot: root, scope: "bugfix", now: NOW, target: targetFor("tdd"), expectedSourceRevision: expectedRevision });
  assert.equal(refresh.revalidate[0]?.reason, "mandatory_refresh");
  assert.equal(refresh.revalidate[0]?.mandatory_refresh, true);

  const actualGraph = loadGraph();
  const light = applyExecutionProfile({ classified: classifyExecutionProfile({ scope: "bugfix" }), at: NOW });
  const standard = applyExecutionProfile({ classified: classifyExecutionProfile({ scope: "bugfix", requested_level: "standard" }), at: NOW });
  const complex = applyExecutionProfile({ classified: classifyExecutionProfile({ scope: "bugfix", signals: new Set(["security_or_sensitive_data"]) }), at: NOW });
  const legacy = buildEvidenceReusePlan(actualGraph, { projectRoot: root, scope: "bugfix", now: NOW });
  const standardPlan = buildEvidenceReusePlan(actualGraph, { projectRoot: root, scope: "bugfix", executionProfile: standard, now: NOW });
  const complexPlan = buildEvidenceReusePlan(actualGraph, { projectRoot: root, scope: "bugfix", executionProfile: complex, now: NOW });
  const lightweightPlan = buildEvidenceReusePlan(actualGraph, { projectRoot: root, scope: "bugfix", executionProfile: light, now: NOW });
  assert.deepEqual(standardPlan.selected_rule_stages, legacy.selected_rule_stages, "standard preserves legacy evidence scheduling surface");
  assert.deepEqual(complexPlan.selected_rule_stages, legacy.selected_rule_stages, "complex preserves legacy evidence scheduling surface");
  assert.deepEqual(legacy.selected_rule_stages.filter((slug) => !lightweightPlan.selected_rule_stages.includes(slug)), ["state-template"], "lightweight mirrors only the Phase-3 safe slice");
  const escalated = applyExecutionProfile({ current: light, classified: classifyExecutionProfile({ scope: "bugfix", current: light, signals: new Set(["security_or_sensitive_data"]) }), at: "2026-10-14T12:01:00.000Z" });
  const restored = buildEvidenceReusePlan(actualGraph, { projectRoot: root, scope: "bugfix", executionProfile: escalated, now: NOW });
  assert.ok(restored.selected_rule_stages.includes("state-template"), "escalation restores the Phase-4/5 stage surface");

  const project = join(root, "cli-project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "fixture\n");
  for (const args of [["init", "-q"], ["config", "user.name", "AIDLC"], ["config", "user.email", "aidlc@example.invalid"], ["add", "README.md"], ["commit", "-qm", "fixture"]]) {
    const result = spawnSync("git", args, { cwd: project, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const run = (args: string[]): Record<string, unknown> => {
    const result = spawnSync(process.execPath, [tsx, cli, "orchestrate", ...args], { cwd: project, encoding: "utf8", env: fixtureEnvironment(project, ["orchestrate", ...args]) });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return JSON.parse(result.stdout) as Record<string, unknown>;
  };
  run(["next", "--scope", "bugfix", "--work", "Phase 5 fixture"]);
  const handoff = run(["next"]);
  const handoffPlan = handoff.evidence_reuse_plan as { selected_rule_stages: string[]; entries: unknown[] };
  assert.ok(Array.isArray(handoffPlan.entries), "run-stage hand-off carries the read-only Phase-5 plan");
  assert.equal(handoffPlan.selected_rule_stages.includes("state-template"), false, "Phase-5 hand-off mirrors Phase-4 lightweight selection");
  const readOnly = run(["state", "evidence"]);
  assert.ok(Array.isArray((readOnly.evidence_reuse_plan as { entries: unknown[] }).entries), "state evidence exposes the same planning surface without writes");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("execution profile phase-5 evidence reuse scheduling tests passed");
