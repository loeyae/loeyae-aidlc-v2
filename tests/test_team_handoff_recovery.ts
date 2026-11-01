import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
import { withSliceWorkflowMigration } from "../core/tools/aidlc-document-slices";
import { moduleContractSnapshot, equivalentModuleContracts, ledgerRef } from "../core/tools/aidlc-module-ledger";
import { fixture, cli, git, snapshot } from "./mars244_fixture";

const output = (result: ReturnType<typeof cli>) => result.stdout + result.stderr;
function success(result: ReturnType<typeof cli>) { assert.equal(result.status, 0, output(result)); return JSON.parse(result.stdout); }
function failure(result: ReturnType<typeof cli>, pattern: RegExp) { assert.notEqual(result.status, 0, output(result)); assert.match(output(result), pattern); }
const approve = ["--user-input", "Approve", "--reason", "Restore verified module checkpoint after handoff"];

// Real split + explicit human handoff, with unchanged approved mapping and views.
const split = fixture(), instance = split.state.current_stage_instance!;
const first = bindSession(split.root, { instance, owner: "alice", session: "before-split", expected: claimToken(undefined) });
success(cli(split.root, ["document-slices", "generate", "--module", "shop"], JSON.stringify(first.binding)));
const adoptionPath = join(split.root, split.base, "document-slices/adoption.json");
const manifestPath = join(split.root, split.base, "document-slices/manifest.json");
const adoption = readFileSync(adoptionPath), manifest = readFileSync(manifestPath);
const from = { root: split.root, workflow_id: split.state.workflow_id, module_id: "shop", scope: split.state.scope, stage: "units-generation", ui_route: "not-selected" };
const to = { ...from, workflow_id: "test-child-identity" };
assert.throws(() => withSliceWorkflowMigration([{ from, to }], () => { throw new Error("injected later transaction failure"); }), /injected later/);
assert.deepEqual(readFileSync(adoptionPath), adoption);
assert.deepEqual(readFileSync(manifestPath), manifest);
const sourcePath = join(split.root, split.base, "requirements.md"), source = readFileSync(sourcePath);
assert.throws(() => withSliceWorkflowMigration([{ from, to }], () => writeFileSync(sourcePath, Buffer.concat([source, Buffer.from("changed\n")]))), /SLICE_MIGRATION_SOURCE_CHANGED/);
assert.deepEqual(readFileSync(adoptionPath), adoption);
assert.deepEqual(readFileSync(manifestPath), manifest);
writeFileSync(sourcePath, source);
writeFileSync(adoptionPath, JSON.stringify({ ...JSON.parse(adoption.toString()), workflow_id: "forged-old-identity" }));
const failedSplitBefore = snapshot(split.root);
failure(cli(split.root, ["orchestrate", "split", "--from", split.state.workflow_id], JSON.stringify(first.binding)), /SLICE_INVALID_ADOPTION/);
assert.deepEqual(snapshot(split.root), failedSplitBefore, "failed migration rolls back child states, registry and metadata");
writeFileSync(adoptionPath, adoption);
const originalFiles = snapshot(split.root, split.base);
success(cli(split.root, ["orchestrate", "split", "--from", split.state.workflow_id], JSON.stringify(first.binding)));
const child = loadWorkflowState(split.root, { kind: "module", module_id: "shop" })!;
assert.notEqual(child.workflow_id, split.state.workflow_id);
assert.equal(JSON.parse(readFileSync(adoptionPath, "utf8")).workflow_id, child.workflow_id);
const expectedManifest = JSON.parse(manifest.toString()); expectedManifest.workflow_id = child.workflow_id;
assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")), expectedManifest);
const migratedFiles = snapshot(split.root, split.base);
for (const [path, bytes] of Object.entries(originalFiles)) if (!path.endsWith("/adoption.json") && !path.endsWith("/manifest.json")) assert.equal(migratedFiles[path], bytes, `split preserves ${path}`);
const transferred = bindSession(split.root, { instance, owner: "bob", session: "after-split", expected: claimToken(child.active_instances[instance]), humanInstructionRef: "user:transfer-after-split" });
success(cli(split.root, ["document-slices", "check", "--module", "shop"], ""));
success(cli(split.root, ["document-slices", "generate", "--module", "shop"], JSON.stringify(transferred.binding)));
console.log("PASS H01: adopted slices survive real split and human handoff; forged identity, source races and transaction failure roll back");

// A broken revision never implies the absence of claims. Only the explicitly
// targeted module and a verified ledger can supply a read-only repair projection.
const damaged = fixture("units-generation@module:shop", true);
const bound = bindSession(damaged.root, { instance: damaged.state.current_stage_instance!, owner: "alice", session: "checkpoint", expected: claimToken(undefined) });
const binding = JSON.stringify(bound.binding), statePath = join(damaged.root, damaged.statePath);
success(cli(damaged.root, ["orchestrate", "state", "checkpoint", "--module", "shop"], binding));
const firstHead = git(damaged.root, "rev-parse", ledgerRef("shop"));
const claimed = readFileSync(statePath, "utf8");
writeFileSync(statePath, claimed.replace(/^- Revision: \d+/m, "- Revision: conflicted"));
failure(cli(damaged.root, ["orchestrate", "state", "maintenance-plan", "--module", "shop"], ""), /still has active claims/);
writeFileSync(statePath, claimed);
// Produce another independently verified ledger head for the token-race check.
success(cli(damaged.root, ["module", "heartbeat", "--stage-instance", bound.claim.stage_instance, "--owner", "alice"], binding));
success(cli(damaged.root, ["orchestrate", "state", "checkpoint", "--module", "shop"], binding));
const secondHead = git(damaged.root, "rev-parse", ledgerRef("shop"));
assert.notEqual(firstHead, secondHead);
const renewedClaim = loadWorkflowState(damaged.root, { kind: "module", module_id: "shop" })!.active_instances[bound.claim.stage_instance];
success(cli(damaged.root, ["module", "release", "--stage-instance", bound.claim.stage_instance, "--expect", claimToken(renewedClaim)], binding));
const healthy = readFileSync(statePath, "utf8"), broken = healthy.replace(/^- Revision: \d+/m, "- Revision: conflicted");
writeFileSync(statePath, broken);
git(damaged.root, "update-ref", ledgerRef("shop"), firstHead);
const plan = () => cli(damaged.root, ["orchestrate", "state", "maintenance-plan", "--module", "shop"], "");
failure(cli(damaged.root, ["orchestrate", "state", "maintenance-plan"], ""), /Revision must/);
const token = success(plan()).maintenance_token;
const recover = (maintenance = token, module = "shop") => cli(damaged.root, ["orchestrate", "state", "recover", "--module", module, "--maintenance", maintenance, ...approve], "");
const unchanged = snapshot(damaged.root);
failure(recover("0".repeat(64)), /snapshot changed/);
assert.deepEqual(snapshot(damaged.root), unchanged);
writeFileSync(statePath, broken.replace("Revision: conflicted", "Revision: another-conflict"));
failure(recover(), /snapshot changed/);
writeFileSync(statePath, broken);
const otherPath = join(damaged.root, "aidlc/active/modules/other/aidlc-state.md"), other = readFileSync(otherPath);
writeFileSync(otherPath, Buffer.concat([other, Buffer.from("\n")]));
failure(recover(), /snapshot changed/);
writeFileSync(otherPath, other);
git(damaged.root, "update-ref", ledgerRef("shop"), secondHead);
failure(recover(), /snapshot changed/);
git(damaged.root, "update-ref", ledgerRef("shop"), firstHead);
failure(recover(token, "other"), /Revision must/);
git(damaged.root, "update-ref", ledgerRef("shop"), git(damaged.root, "rev-parse", "HEAD"));
failure(plan(), /verified ledger checkpoint/);
git(damaged.root, "update-ref", ledgerRef("shop"), firstHead);
writeFileSync(statePath, claimed.replace(/^- Revision: \d+/m, "- Revision: conflicted"));
failure(recover(), /still has active claims/);
writeFileSync(statePath, broken.replace("## Active Instances", "## Lost Claims"));
failure(plan(), /cannot prove quiescence/);
writeFileSync(statePath, broken.replace("## Active Instances", "## Active Instances hidden\n| Stage Instance | Module | Owner | Branch | Worktree | Claimed At | Heartbeat At | Expires At | Session | Generation | Handoff |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| - | - | - | - | - | - | - | - | - | - | - |\n\n## Active Instances"));
failure(plan(), /cannot prove quiescence/);
writeFileSync(statePath, broken.replace(/^- Workflow ID: .*$/m, "- Workflow ID: forged"));
failure(plan(), /identity does not match/);
writeFileSync(statePath, broken);
assert.deepEqual(snapshot(damaged.root), unchanged);
const recovered = success(recover());
assert.equal(recovered.recovered, true);
const restored = loadWorkflowState(damaged.root, { kind: "module", module_id: "shop" })!;
assert.deepEqual(restored.active_instances, {}, "checkpoint claims are never resurrected");
assert(restored.revision > Number(/^- Revision: (\d+)/m.exec(healthy)![1]), "revision stays above the last auditable local revision");
assert(recovered.backups.some((path: string) => readFileSync(join(damaged.root, path), "utf8") === broken));
assert.equal(success(recover(success(plan()).maintenance_token)).recovered, false, "repeat recovery is idempotent");
console.log("PASS H02: real ledger recovery of damaged Revision; active/hidden claims, forged identity/token, target/sibling/byte/head races rejected; no old claim resurrection");

// Old raw-digest checkpoints remain valid. Only table-cell edge whitespace may
// differ; provider/consumer/version/content/reference changes stay blocking.
const contracts = fixture("units-generation@module:shop", true);
const contractPath = join(contracts.root, "docs/aidlc/ideation/product-contracts.md");
const original = "# Contracts\n| contract id | provider | version | consumer | description |\n| --- | --- | --- | --- | --- |\n| CT-SHOP | shop | v1 | other | Exact behavior |\n| CT-OTHER | other | v1 | other | Other behavior |\n";
writeFileSync(contractPath, original);
const old = moduleContractSnapshot(contracts.root, "shop");
const cb = bindSession(contracts.root, { instance: contracts.state.current_stage_instance!, owner: "alice", session: "contracts", expected: claimToken(undefined) });
success(cli(contracts.root, ["orchestrate", "state", "checkpoint", "--module", "shop"], JSON.stringify(cb.binding)));
success(cli(contracts.root, ["module", "release", "--stage-instance", cb.claim.stage_instance, "--expect", claimToken(cb.claim)], JSON.stringify(cb.binding)));
const contractToken = success(cli(contracts.root, ["orchestrate", "state", "maintenance-plan", "--module", "shop"], "")).maintenance_token;
const cr = () => cli(contracts.root, ["orchestrate", "state", "recover", "--module", "shop", "--maintenance", contractToken, ...approve], "");
for (const changed of [original.replace("shop | v1", "other | v1"), original.replace("shop | v1", "shop | v2"), original.replace("v1 | other | Exact", "v1 | shop | Exact"), original.replace("Exact behavior", "Changed behavior"), original.replace("Exact behavior", "Exact  behavior")]) {
  writeFileSync(contractPath, changed);
  assert.equal(equivalentModuleContracts(old, moduleContractSnapshot(contracts.root, "shop")), false);
  const before = snapshot(contracts.root);
  failure(cr(), /contract view/);
  assert.deepEqual(snapshot(contracts.root), before);
}
writeFileSync(contractPath, original.replace("| CT-SHOP | shop | v1 | other | Exact behavior |", "|  CT-SHOP  |  shop  |  v1  |  other  |  Exact behavior  |"));
const formatted = moduleContractSnapshot(contracts.root, "shop");
assert.notEqual(old.digest, formatted.digest, "raw digest remains available for audit and legacy verification");
assert.equal(equivalentModuleContracts(old, formatted), true);
success(cr());
const audit = readFileSync(join(contracts.root, "aidlc/active/modules/shop/audit.md"), "utf8");
assert.match(audit, /Contract Comparison: table-cell-whitespace-v1/);
assert(audit.includes(old.digest) && audit.includes(formatted.digest));
assert.equal(existsSync(join(contracts.root, "aidlc/active/modules/shop/aidlc-state.md.lock")), false);
console.log("PASS H03: legacy checkpoint accepts table-cell edge whitespace; semantic changes still block; old/new raw digests and equivalence version audited");
