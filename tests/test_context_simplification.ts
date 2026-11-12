import assert from "node:assert/strict";
import { readFileSync, rmSync, unlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { workflowContext, artifactView } from "../core/tools/aidlc-context-view";
import { stateAuditDelta, createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { fixture, write, snapshot } from "./mars244_fixture";

const f = fixture("code-generation@module:shop@unit:api", true);
try {
  // Unrelated corrupted state and huge history must not enter the selected view.
  write(f.root, "aidlc/active/modules/other/aidlc-state.md", "unrelated broken state");
  write(f.root, "aidlc/active/modules/shop/audit.md", "historical sentinel\n" + "OLD SNAPSHOT\n".repeat(20000));
  write(f.root, "docs/aidlc/handoff.md", "obsolete stage: do not trust this");
  const before = snapshot(f.root);
  const context = workflowContext(f.root, "shop", "api");
  assert.equal(context.current_instance, f.state.current_stage_instance);
  assert.equal(context.verification, "not_checked");
  assert(Buffer.byteLength(JSON.stringify(context)) < 2500);
  assert(!JSON.stringify(context).includes("OLD SNAPSHOT"));
  assert(!JSON.stringify(context).includes("obsolete"));
  assert.equal(workflowContext(f.root, undefined, undefined, true).workflow_id === context.workflow_id, false);
  assert.throws(() => workflowContext(f.root, "other"));
  assert.throws(() => workflowContext(f.root, "shop", "missing"));
  assert.throws(() => workflowContext(f.root, undefined, "api"));
  assert.deepEqual(snapshot(f.root), before, "reading writes no state, audit, views or probes");

  const markdown = "# Design\n" + "内容😀需要保留\n".repeat(1000);
  write(f.root, "docs/aidlc/page.md", markdown);
  let offset = 0, joined = "", sha;
  do {
    const page = artifactView(f.root, "docs/aidlc/page.md", offset, 193);
    if (sha) assert.equal(page.sha256, sha); else sha = page.sha256;
    joined += page.content; offset = page.next_offset as number;
  } while (offset !== null);
  assert.equal(joined, markdown, "pagination preserves all characters including split surrogate pairs");
  const record = { status: "passed", exitCode: 0, source_sha256: Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`src/${i}`, "a".repeat(64)])), environment: { TOKEN: "never-display" } };
  write(f.root, "docs/aidlc/command.json", record);
  const summary = artifactView(f.root, "docs/aidlc/command.json");
  assert.equal(summary.verification, "not_checked");
  assert.equal((summary.fields as any).status, "passed");
  assert(!JSON.stringify(summary).includes("never-display"));
  assert(!JSON.stringify(summary).includes("src/3999"));
  assert(JSON.stringify(summary).length < 1200);
  for (const path of ["../outside.md", "docs/aidlc/../../outside.md", ".aidlc/runtime/secret.json", "aidlc/active/aidlc-state.md", "docs/aidlc/branch-snapshots/audit.md", "C:/outside.md"]) assert.throws(() => artifactView(f.root, path));
  assert.throws(() => artifactView(f.root, "docs/aidlc/page.md", -1));
  assert.throws(() => artifactView(f.root, "docs/aidlc/page.md", 0, 16001));
  // Directory links must not grant access to files outside the public subtree.
  write(f.root, "private/secret.md", "do not read");
  const link = join(f.root, "docs/aidlc/linked");
  symlinkSync(join(f.root, "private"), link, "junction");
  try { assert.throws(() => artifactView(f.root, "docs/aidlc/linked/secret.md"), /linked/); }
  finally { unlinkSync(link); }

  const state = createInitialState("feature", undefined, undefined, [], "audit scaling");
  for (let i = 0; i < 1000; i++) { const instance = `code-generation@module:shop@unit:u${i}`;
    state.active_instances![instance] = { module_id: "shop", stage_instance: instance, owner: "owner", session_id: "session", generation: "generation", handoff: "never-copy-binding".repeat(50), claimed_at: "2026-11-11T00:00:00Z", heartbeat_at: "2026-11-11T00:00:00Z", expires_at: "2026-11-12T00:00:00Z" };
  }
  const changed = structuredClone(state); changed.revision++;
  const unchanged = JSON.stringify(stateAuditDelta(changed, state));
  assert(!unchanged.includes("Claim Changes")); assert(unchanged.length < 500);
  const instance = "code-generation@module:shop@unit:u1";
  changed.active_instances![instance].generation = "new-generation";
  const delta = stateAuditDelta(changed, state), claims = JSON.parse(delta["Claim Changes"]);
  assert.equal(claims.length, 1); assert.equal(claims[0].before.generation, "generation"); assert.equal(claims[0].after.generation, "new-generation");
  assert(!JSON.stringify(delta).includes("never-copy-binding"));
  delete changed.active_instances![instance]; assert.equal(JSON.parse(stateAuditDelta(changed, state)["Claim Changes"])[0].after, null);
  console.log(JSON.stringify({ audit_claims: 1000, unchanged_event_bytes: Buffer.byteLength(unchanged), one_claim_change_bytes: Buffer.byteLength(JSON.stringify(delta)), raw_command_bytes: Buffer.byteLength(JSON.stringify(record)), projected_command_bytes: Buffer.byteLength(JSON.stringify(summary)), context_bytes: Buffer.byteLength(JSON.stringify(context)) }));

  const audit = join(f.root, "aidlc/active/modules/shop/audit.md"), original = readFileSync(audit, "utf8");
  const bound = bindSession(f.root, { instance: f.state.current_stage_instance!, owner: "fixture", session: "context-test", expected: claimToken(undefined) });
  const written = readFileSync(audit, "utf8");
  assert(written.startsWith(original)); assert.match(written.slice(original.length), /Audit Format: delta-v1/);
  assert(!written.slice(original.length).includes("Session Claims:"));
  assert.equal(loadWorkflowState(f.root, { kind: "module", module_id: "shop" })!.active_instances![f.state.current_stage_instance!].generation, bound.claim.generation);
  console.log("PASS context/artifact boundaries and actual claim publication with append-only delta audit");
} finally { rmSync(f.root, { recursive: true, force: true }); }

const simple = fixture("tdd@module:shop@unit:default");
try {
  simple.state.completed_stage_instances = ["module-division"]; simple.persist();
  unlinkSync(join(simple.root, `${simple.base}/unit-manifest.json`));
  const context = workflowContext(simple.root, "shop", "default");
  assert.equal(context.unit_basis, "default-unit-before-or-without-I14");assert.equal(context.unit_manifest, null);
  assert.throws(() => workflowContext(simple.root, "shop", "unknown"), /unknown unit/);
  simple.state.completed_stage_instances.push("units-generation@module:shop");simple.persist();
  assert.throws(() => workflowContext(simple.root, "shop", "default"), /unknown unit/);
  console.log("PASS skipped-I14 default unit and missing executed manifest are distinguished");
} finally { rmSync(simple.root, { recursive: true, force: true }); }
