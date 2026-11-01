import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { QualityFixture } from "./mars168_fixture";
import { evidenceFreshnessBindingErrors, semanticCommandArgv } from "../core/tools/aidlc-evidence";
import { controlledQualityErrors } from "../core/tools/aidlc-quality-delivery";

const dependencyPath = ".aidlc/evidence/requirements-analysis/shop/dependency-readiness.json";
const configPath = ".aidlc/commands/requirements-analysis.json";
const external = { kind: "external", max_age_ms: 3600_000, reason: "Supplier confirmation expires after one hour" };
const config = { version: "1", stage: "requirements-analysis", commands: [], freshness: external };
const read = (f: QualityFixture, path: string): Record<string, unknown> => JSON.parse(readFileSync(join(f.root, path), "utf8"));

function prepareDelivery(f: QualityFixture): void {
  f.write(configPath, JSON.stringify(config));
  f.pass("quality-change-impact"); f.pass("dependency-readiness"); f.pass("field-capability");
  f.stage("user-stories"); f.pass("story-rule-consistency");
  f.write(`${f.base}/development-handoff.md`, "REQ-001 migration localized labels; OMS full replacement; defaults none; regression ready/draft boundaries.");
  f.delivery = { version: "1", delivery_scope: "release-a", inputs: [], package: ["requirements.md", "user-stories.md", "development-handoff.md"].map(path => ({ path: `${f.base}/${path}`, kind: "canonical" })), pending_items: [], decisions: [] };
  f.section("cross-validation-report", f.delivery); f.stage("cross-validation", "skip");
  f.syncArtifactReview(); f.pass("artifact-consistency"); f.pass("delivery-readiness");
}

await test("unchanged local quality evidence older than 24h is reused and remains gate-valid", () => {
  const f = new QualityFixture(); f.pass("dependency-readiness");
  f.state.completed_stages.push("requirements-analysis");
  f.state.completed_stage_instances.push("requirements-analysis@module:shop");
  f.stage("user-stories"); f.ctx.stage = "requirements-analysis";
  const aged = { ...read(f, dependencyPath), timestamp: new Date(Date.now() - 25 * 3600_000).toISOString() };
  f.write(dependencyPath, JSON.stringify(aged));
  const refreshed = f.run("core/tools/aidlc-evidence.ts", ["run", "--stage", "requirements-analysis", "--module", "shop", "--sensor", "dependency-readiness", "--refresh"]);
  assert.equal(refreshed.status, 0, refreshed.stdout + refreshed.stderr);
  assert.equal(JSON.parse(refreshed.stdout).action, "reused");
  assert.deepEqual(read(f, dependencyPath), aged, "reuse must preserve the observation and its original timestamp");
  assert.deepEqual(f.gate("dependency-readiness"), [], "content-bound evidence must not enter an endless refresh/reject loop");
});

await test("delivery applies each upstream stage's current external freshness policy", async t => {
  const f = new QualityFixture(); prepareDelivery(f);
  const original = read(f, dependencyPath);
  assert.deepEqual(original.freshness, external);
  const cases: Array<{ name: string; evidence?: Record<string, unknown>; configuration?: unknown; rawConfiguration?: string; error: string }> = [
    { name: "one-hour observation expires after two hours", evidence: { ...original, timestamp: new Date(Date.now() - 2 * 3600_000).toISOString() }, error: "GATE_EVIDENCE_STALE" },
    { name: "removed freshness declaration cannot disable the configured window", evidence: Object.fromEntries(Object.entries(original).filter(([key]) => key !== "freshness")), error: "freshness.*configuration" },
    { name: "weakened evidence window cannot override the stage configuration", evidence: { ...original, freshness: { ...external, max_age_ms: 48 * 3600_000 } }, error: "freshness.*configuration" },
    { name: "a tightened stage policy invalidates prior evidence", configuration: { ...config, freshness: { ...external, max_age_ms: 1800_000 } }, error: "freshness.*configuration" },
    { name: "removing the configured policy preserves the observation's external expiry", evidence: { ...original, timestamp: new Date(Date.now() - 2 * 3600_000).toISOString() }, configuration: { version: "1", stage: "requirements-analysis", commands: [] }, error: "configured freshness window 3600000ms" },
    { name: "malformed configured freshness cannot be ignored", configuration: { ...config, freshness: { ...external, max_age_ms: "unlimited" } }, error: "freshness" },
    { name: "invalid matching-stage allowlist is rejected", configuration: { ...config, commands: "invalid" }, error: "command allowlist" },
    { name: "a stage-specific allowlist cannot be relabeled as another stage", configuration: { ...config, stage: "user-stories" }, error: "command allowlist stage" },
    { name: "a non-object stage-specific allowlist cannot be ignored", configuration: [], error: "command allowlist" },
    { name: "invalid JSON in the stage allowlist is rejected", rawConfiguration: "{", error: "command allowlist" },
    { name: "future observations remain invalid", evidence: { ...original, timestamp: new Date(Date.now() + 3600_000).toISOString() }, error: "GATE_EVIDENCE_STALE" },
    { name: "invalid ISO observations remain invalid", evidence: { ...original, timestamp: "2026-02-30T00:00:00Z" }, error: "GATE_EVIDENCE_STALE" },
    { name: "controlled provenance remains mandatory", evidence: { ...original, producer: { ...(original.producer as Record<string, unknown>), mode: "manual" } }, error: "controlled provenance" },
    { name: "successful checker execution remains mandatory", evidence: { ...original, checker: { ...(original.checker as Record<string, unknown>), exit_code: 1 } }, error: "controlled provenance" },
    { name: "source input hashes remain mandatory", evidence: { ...original, inputs: (original.inputs as Array<Record<string, unknown>>).map((input, index) => index ? input : { ...input, sha256: "0".repeat(64) }) }, error: "GATE_EVIDENCE_STALE" },
  ];
  for (const scenario of cases) await t.test(scenario.name, () => {
    f.write(dependencyPath, JSON.stringify(scenario.evidence ?? original));
    f.write(configPath, scenario.rawConfiguration ?? JSON.stringify(scenario.configuration ?? config));
    f.blocked("delivery-readiness", scenario.error);
  });
  f.write(configPath, JSON.stringify(config)); f.write(dependencyPath, JSON.stringify(original));
  f.pass("delivery-readiness");
});

await test("quality refresh regenerates when the current stage freshness policy changes", () => {
  const f = new QualityFixture(); f.pass("dependency-readiness");
  f.state.completed_stages.push("requirements-analysis");
  f.state.completed_stage_instances.push("requirements-analysis@module:shop");
  f.stage("user-stories"); f.ctx.stage = "requirements-analysis";
  for (const policy of [external, { ...external, max_age_ms: 1800_000 }, undefined, external, null]) {
    if (policy === null) unlinkSync(join(f.root, configPath));
    else f.write(configPath, JSON.stringify({ version: "1", stage: "requirements-analysis", commands: [], ...(policy ? { freshness: policy } : {}) }));
    const previous = read(f, dependencyPath);
    if (!policy) {
      assert.deepEqual(f.gate("dependency-readiness"), [], "removing a configured policy does not discard the still-valid observation's own external window");
      f.write(dependencyPath, JSON.stringify({ ...previous, timestamp: new Date(Date.now() - 2 * 3600_000).toISOString() }));
      assert.match(f.gate("dependency-readiness").join("\n"), /configured freshness window/, "the prior external observation still expires after policy removal");
      f.write(dependencyPath, JSON.stringify(previous));
    }
    const refreshed = f.run("core/tools/aidlc-evidence.ts", ["run", "--stage", "requirements-analysis", "--module", "shop", "--sensor", "dependency-readiness", "--refresh"]);
    assert.equal(refreshed.status, 0, refreshed.stdout + refreshed.stderr);
    assert.equal(JSON.parse(refreshed.stdout).action, "regenerated", "a changed or removed policy requires a new controlled observation");
    const current = read(f, dependencyPath);
    assert.notEqual((current.producer as Record<string, unknown>).execution_id, (previous.producer as Record<string, unknown>).execution_id);
    assert.deepEqual(current.freshness, policy ?? undefined);
    assert.deepEqual(f.gate("dependency-readiness"), []);
  }
});

await test("explicit semantic --config freshness is accepted and enforced by the real gate", async t => {
  const f = new QualityFixture(), explicit = ".aidlc/custom-quality-commands.json";
  f.write(explicit, JSON.stringify(config));
  const produced = f.run("bin/cli.ts", ["evidence", "run", "--stage", "requirements-analysis", "--module", "shop", "--sensor", "dependency-readiness", "--config", explicit]);
  assert.equal(produced.status, 0, produced.stdout + produced.stderr);
  const original = read(f, dependencyPath);
  assert.deepEqual(original.freshness, external);
  await t.test("an observation within its explicit window passes without a default config", () => {
    assert.deepEqual(f.gate("dependency-readiness"), []);
  });
  await t.test("an expired explicit observation is rejected without a default config", () => {
    f.write(dependencyPath, JSON.stringify({ ...original, timestamp: new Date(Date.now() - 2 * 3600_000).toISOString() }));
    assert.match(f.gate("dependency-readiness").join("\n"), /configured freshness window 3600000ms/);
  });
  await t.test("an explicit observation cannot conflict with the current default policy", () => {
    f.write(dependencyPath, JSON.stringify(original));
    f.write(configPath, JSON.stringify({ ...config, freshness: { ...external, max_age_ms: 1800_000 } }));
    assert.match(f.gate("dependency-readiness").join("\n"), /freshness.*configuration/);
  });
});

await test("freshness configuration validation uses the quality context project root", () => {
  const f = new QualityFixture();
  f.write(configPath, JSON.stringify({ ...config, commands: [{ id: "config-read-check", role: "check", argv: ["node", "--version"], cwd: "docs" }], artifacts: [{ id: "source", path: `${f.base}/source.md` }] }));
  assert.deepEqual(evidenceFreshnessBindingErrors("requirements-analysis", { freshness: external }, f.root), []);
  assert.match(evidenceFreshnessBindingErrors("requirements-analysis", {}, f.root).join("\n"), /freshness.*configuration/);
});

await test("quality checker command scope follows the target project's split layout", () => {
  const f = new QualityFixture();
  f.write("aidlc/active/registry.md", "# Split workflow registry\n");
  assert.deepEqual(semanticCommandArgv("dependency-readiness", { current_module: "shop" }, f.root).slice(-2), ["--module", "shop"]);
});

await test("upstream quality observations require the current checker implementation and command", () => {
  const f = new QualityFixture(); f.pass("dependency-readiness");
  const original = read(f, dependencyPath), checker = original.checker as Record<string, unknown>;
  const aged = { ...original, timestamp: new Date(Date.now() - 25 * 3600_000).toISOString() };
  assert.deepEqual(controlledQualityErrors(f.ctx, "dependency-readiness", aged), []);
  for (const changed of [{ ...checker, implementation_digest: "0".repeat(64) }, { ...checker, identity_version: 0 }]) {
    assert.match(controlledQualityErrors(f.ctx, "dependency-readiness", { ...aged, checker: changed }).join("\n"), /checker implementation/, "removing the age limit must not extend the lifetime of evidence from an outdated or unidentified checker");
  }
  assert.match(controlledQualityErrors(f.ctx, "dependency-readiness", { ...aged, checker: { ...checker, argv_digest: "0".repeat(64) } }).join("\n"), /checker command/, "a valid digest shape does not establish the observed command");
});
