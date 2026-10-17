// Promoted from the F2/F3 audit CLI probes, with assertions reversed to require rejection.
import assert from "node:assert/strict";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bindSession, claimToken, captureModulePublication, publishScope } from "../core/tools/aidlc-session";
import { generateSlices, recoverCanonical, checkSlices, type SliceContext } from "../core/tools/aidlc-document-slices";
import { createUiGenerationLock } from "../core/tools/aidlc-ui-governance";
import { fixture, cli, snapshot } from "./mars244_fixture";
const f = fixture();
try {
  const instance = f.state.current_stage_instance!;
  const a = bindSession(f.root, { instance, owner: "same-owner", session: "A", expected: claimToken(undefined) });
  process.env.AIDLC_SESSION_BINDING = JSON.stringify(a.binding);
  const captured = captureModulePublication(f.root, "shop");
  const b = bindSession(f.root, { instance, owner: "same-owner", session: "B", expected: claimToken(a.claim), humanInstructionRef: "user:MARS-244" });
  const before = snapshot(f.root);
  const commands = [
    ["ui", "lock", "--route", "html-mock"], ["ui", "accept", "--route", "html-mock"],
    ["ui", "refresh", "--route", "html-mock"], ["ui", "reverify", "--route", "html-mock", "--review-report", "report.md"],
    ["ui", "resource-rebaseline"], ["ui", "resource-css", "--html", `${f.base}/ui-mock/page.html`],
    ["document-slices", "generate"], ["document-slices", "recover", "--apply"],
  ];
  for (const args of commands) {
    const r = cli(f.root, [...args, "--module", "shop"]);
    assert.notEqual(r.status, 0, args.join(" "));
    assert.match(r.stdout + r.stderr, /transferred|session binding conflicts/, args.join(" "));
    assert.deepEqual(snapshot(f.root), before, `stale write changed files: ${args.join(" ")}`);
  }
  const ctx: SliceContext = { root: f.root, workflow_id: f.state.workflow_id, module_id: "shop", stage: "units-generation", scope: "feature", ui_route: "not-selected" };
  assert.throws(() => createUiGenerationLock(f.root, { moduleId: "shop", route: "html-mock" }), /transferred|conflicts/);
  assert.throws(() => generateSlices(ctx), /transferred|conflicts/);
  assert.throws(() => recoverCanonical(ctx, true), /transferred|conflicts/);
  let published = false;
  assert.throws(() => publishScope(f.root, captured, () => { published = true; }), /transferred|conflicts/);
  assert.equal(published, false, "in-flight old snapshot must never publish after same-owner handoff");
  process.env.AIDLC_SESSION_BINDING = JSON.stringify(b.binding);
  const lock = cli(f.root, ["ui", "lock", "--module", "shop", "--route", "html-mock"]);
  assert.equal(lock.status, 0, lock.stderr);
  const generated = cli(f.root, ["document-slices", "generate", "--module", "shop"]);
  assert.equal(generated.status, 0, generated.stderr);
  assert.ok(existsSync(join(f.root, `${f.base}/document-slices/manifest.json`)));
  const canonical = readFileSync(join(f.root, `${f.base}/requirements.md`));
  assert.equal(recoverCanonical(ctx, true).status, "restored-revalidation-required");
  assert.deepEqual(readFileSync(join(f.root, `${f.base}/requirements.md`)), canonical);
  delete process.env.AIDLC_SESSION_BINDING;
  assert.equal(checkSlices(ctx).status, "passed");
  assert.equal(cli(f.root, ["document-slices", "check", "--module", "shop"]).status, 0);
  assert.equal(cli(f.root, ["document-slices", "recover", "--module", "shop"]).status, 0);
  console.log("MARS-244 UI/slice stale CLI and API, same-owner handoff, in-flight publication, valid B and read-only checks passed");
} finally { delete process.env.AIDLC_SESSION_BINDING; rmSync(f.root, { recursive: true, force: true }); }
