import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readSourceRevision } from "../core/tools/aidlc-revision";
import { evidenceScopeForInstance, phaseExecutionRevision } from "../core/tools/aidlc-workflow-layout";
import { fixture, git, write } from "./mars244_fixture";

const f = fixture();
try {
  const nested = join(f.root, "nested");
  write(f.root, "nested/source.txt", "tracked and dirty\n");
  git(nested, "init", "-q"); git(nested, "add", "."); git(nested, "commit", "-qm", "nested");
  write(f.root, "nested/source.txt", "tracked and dirty changed\n");
  write(f.root, "nested/new.txt", "untracked\n");
  const scoped = readSourceRevision(f.root, { label: "nested-only", exclude: path => !path.startsWith("nested/") }, ["nested"]);
  const expected = (prefix: string) => {
    const digest = createHash("sha256");
    for (const [name, content] of [["new.txt", "untracked\n"], ["source.txt", "tracked and dirty changed\n"]]) {
      digest.update(`${prefix}${name}\0file\0`).update(createHash("sha256").update(content).digest()).update("\0");
    }
    return digest.digest("hex");
  };
  assert.equal(scoped.repos?.nested.worktree_digest, expected(""));
  assert.equal(scoped.scope_digest, expected("nested/"));
  assert.equal(scoped.repos?.nested.dirty, true);
  console.log("PASS nested scoped and worktree digests preserve dirty and untracked content");

  const instance = "code-generation@module:shop@unit:api";
  const legacyExecution = phaseExecutionRevision(f.root, instance);
  write(f.root, ".aidlc/source-roots.json", { version: "1", source_roots: [{ path: "nested", repo: "nested" }] });
  assert.deepEqual(phaseExecutionRevision(f.root, instance, []), legacyExecution, "old GREEN without repos keeps its recorded legacy digest algorithm after a later nested declaration");
  const nestedExecution = phaseExecutionRevision(f.root, instance);
  assert.notDeepEqual(nestedExecution, legacyExecution, "new producer observations bind declared nested sources");
  write(f.root, "nested/source.txt", "nested behavior changed again\n");
  assert.notDeepEqual(phaseExecutionRevision(f.root, instance, ["nested"]), nestedExecution, "validated recorded nested keys protect nested source changes");
  assert.deepEqual(phaseExecutionRevision(f.root, instance, []), legacyExecution, "legacy evidence does not retroactively gain nested repositories");
  write(f.root, "shared/api.json", "{\"contract\":\"changed\"}");
  assert.notDeepEqual(phaseExecutionRevision(f.root, instance, []), legacyExecution, "legacy selection still binds real workflow repository inputs");
  console.log("PASS GREEN execution binding follows recorded legacy or validated nested repository structure");

  const receiptPath = `${f.base}/artifact-review.json`, reportPath = "docs/aidlc/modules/shop/construction/api/code-review.md";
  const requirementPath = `${f.base}/requirements.md`, sourcePath = "src/shop/api/code.ts";
  const receipt = { version: "1", kind: "artifact", workflow_id: f.state.workflow_id, module_id: "shop", delivery_scope: "approved-scope", reviewer: "reviewer",
    inputs: [{ path: requirementPath, sha256: "a".repeat(64) }], items: [{ id: requirementPath, conclusion: "supported", rationale: "verified", references: [requirementPath], examples: ["approved example"] }], open_findings: [] };
  const baselineScope = () => evidenceScopeForInstance(f.root, "test-case-derivation@module:shop");
  const baselineDigest = () => readSourceRevision(f.root, baselineScope()).scope_digest;
  write(f.root, receiptPath, receipt);
  const baseline = baselineDigest();
  write(f.root, reportPath, "Completed downstream code review\n");
  const downstreamReceipt = { ...receipt, inputs: [...receipt.inputs, { path: reportPath, sha256: "b".repeat(64) }, { path: sourcePath, sha256: "c".repeat(64) }] };
  write(f.root, receiptPath, downstreamReceipt);
  assert.equal(baselineDigest(), baseline, "I13 baseline cannot indirectly bind excluded downstream construction or owned implementation through receipt input rows");
  for (const changed of [
    { ...downstreamReceipt, reviewer: "another reviewer" },
    { ...downstreamReceipt, items: [{ ...receipt.items[0], conclusion: "conflict" }] },
    { ...downstreamReceipt, inputs: [{ ...receipt.inputs[0], sha256: "d".repeat(64) }, ...downstreamReceipt.inputs.slice(1)] },
  ]) { write(f.root, receiptPath, changed); assert.notEqual(baselineDigest(), baseline, "review semantics and upstream inputs remain bound to I13"); }
  write(f.root, receiptPath, { ...downstreamReceipt, workflow_id: "foreign" });
  assert.equal(baselineScope().projectedInputs?.[receiptPath], undefined, "invalid receipt identity retains raw byte binding");
  write(f.root, receiptPath, downstreamReceipt);
  const manifestPath = "docs/aidlc/ideation/module-manifest.json", manifestText = readFileSync(join(f.root, manifestPath), "utf8");
  const manifest = JSON.parse(manifestText); manifest.modules[0].contract_paths.push(sourcePath);
  write(f.root, manifestPath, manifest);
  assert.ok(JSON.parse(baselineScope().projectedInputs![receiptPath]).inputs.some((input: { path: string }) => input.path === sourcePath), "shared contract inputs override baseline source exclusion");
  manifest.modules[0].contract_paths.push("docs"); write(f.root, manifestPath, manifest);
  assert.equal(baselineScope().projectedInputs?.[receiptPath], undefined, "an explicitly shared receipt stays fully bound in the baseline");
  write(f.root, manifestPath, manifestText);
  console.log("PASS I13 baseline receipt projects only already excluded inputs and preserves shared contracts, identity and review semantics");
} finally { rmSync(f.root, { recursive: true, force: true }); }
