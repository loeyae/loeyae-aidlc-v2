import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve, sep } from "node:path";
import { fixture, write } from "./mars244_fixture";
import { phaseExecutionRevision } from "../core/tools/aidlc-workflow-layout";

const instance = "code-generation@module:shop@unit:api", f = fixture(instance);
const plan = "docs/aidlc/modules/shop/construction/api/plans/code-generation-plan.md";
const original = "---\nexample: |\n  - [ ] metadata\n---\n# Plan\n- [ ] Implement REQ-001.\n  - [ ] Verify boundary behavior.\n\n```md\n- [ ] literal example\n```\n\n<!--\n- [ ] hidden example\n-->\n";
const revision = (version: "1" | "2" = "2") => phaseExecutionRevision(f.root, instance, [], version).scope_digest;
try {
  write(f.root, plan, original);
  const baseline = revision(), legacy = revision("1");
  write(f.root, plan, original.replace("[ ] Implement", "[x] Implement").replace("[ ] Verify", "[X] Verify"));
  assert.equal(revision(), baseline, "only real task-list progress is projected");
  assert.notEqual(revision("1"), legacy, "historical v1 binding keeps its original strict semantics");
  for (const changed of [
    original.replace("Implement REQ-001", "Implement REQ-002"),
    original.replace("[ ] literal", "[x] literal"),
    original.replace("[ ] hidden", "[x] hidden"),
    original.replace("[ ] metadata", "[x] metadata"),
    original + "- [ ] Another requirement.\n",
  ]) {
    write(f.root, plan, changed);
    assert.notEqual(revision(), baseline, "business text and opaque examples remain bound");
  }
  const unclosed = "# Plan\n- [ ] Implement REQ-001.\n```md\nexample\n";
  write(f.root, plan, unclosed);
  const malformed = revision();
  write(f.root, plan, unclosed.replace("[ ]", "[x]"));
  assert.notEqual(revision(), malformed, "unrecognized structure keeps conservative byte binding");
  write(f.root, plan, original);
  write(f.root, "docs/business-input.md", "- [ ] approved business condition\n");
  const other = revision();
  write(f.root, "docs/business-input.md", "- [x] approved business condition\n");
  assert.notEqual(revision(), other, "other Markdown inputs are never blanket-excluded");
  f.units[0].evidence_inputs.shared_paths.push(plan);
  write(f.root, `${f.base}/unit-manifest.json`, { schema_version: 1, module_id: "shop", units: f.units });
  assert.throws(() => revision(), /must not point at docs\/aidlc/, "invalid shared-input declarations remain rejected, never silently projected");
  console.log("PASS plan progress projection, v1 compatibility, semantic/opaque edits and explicit input ownership");
} finally {
  const target = resolve(f.root);
  assert(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith("mars244-"));
  rmSync(target, { recursive: true, force: true });
}
