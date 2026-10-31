import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { fixture, cli } from "./mars244_fixture";

const f = fixture("functional-design@module:shop@unit:api");
try {
  const instance = f.state.current_stage_instance!;
  const a = bindSession(f.root, { instance, owner: "member", session: "tool-a", expected: claimToken(undefined) });
  const invoke = (binding: unknown) => cli(f.root, ["document-slices", "generate", "--module", "shop"], JSON.stringify(binding));
  // A unit session cannot adopt slicing on behalf of the module.
  assert.notEqual(invoke(a.binding).status, 0);
  // Adopt with a module session, then resume the already completed unit chain.
  const module = "units-generation@module:shop";
  const m = bindSession(f.root, { instance: module, owner: "member", session: "module", expected: claimToken(undefined) });
  assert.equal(invoke(m.binding).status, 0);
  const generated = invoke(a.binding); assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  const b = bindSession(f.root, { instance, owner: "member", session: "tool-b", expected: claimToken(a.claim), humanInstructionRef: "user:continue-with-tool-b" });
  assert.notEqual(invoke(a.binding).status, 0, "transferred session must not publish");
  const resumed = invoke(b.binding); assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  console.log("PASS adopted slice refresh across unit session handoff");
} finally { rmSync(f.root, { recursive: true, force: true }); }
