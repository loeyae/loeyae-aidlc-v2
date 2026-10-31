import assert from "node:assert/strict";
import { rmSync, renameSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
import { fixture, write, cli } from "./mars244_fixture";

const instance = "code-review@module:shop@unit:api";
const f = fixture(instance);
try {
  const binding = bindSession(f.root, { instance, owner: "auditor", session: "audit-review", expected: claimToken(undefined) }).binding;
  const report = (axes: string, files = "src/shop/api/code.ts") => `# Review\nreviewer: audit-review\n${axes}\nissues_found: 0\nissues_resolved: 0\nissues_open: 0\nReviewed files: ${files}\n`;
  const produce = (content: string) => {
    write(f.root, "docs/aidlc/modules/shop/construction/api/code-review.md", content);
    return cli(f.root, ["evidence", "run", "--stage", "code-review", "--module", "shop", "--unit", "api", "--sensor", "review-evidence"], JSON.stringify(binding));
  };
  for (const axes of [
    "Spec result: failed\nStandards result: passed",
    "Spec result: passed\nStandards result: failed",
    "Spec result: 不合规\nStandards result: 通过",
    "Spec result: passed\nStandards result: passed\nSpec result: failed",
    "Spec result: passed\nStandards result: unknown",
    "Spec result: passed\n## Standards\n",
  ]) assert.notEqual(produce(report(axes)).status, 0, `must reject ${axes}`);
  assert.notEqual(produce(report("Spec result: passed\nStandards result: passed", "src/does-not-exist.ts")).status, 0);
  write(f.root, "src/shop/api/added.ts", "export const added = 1;\n");
  assert.notEqual(produce(report("Spec result: passed\nStandards result: passed")).status, 0, "new source must be reviewed");
  const valid = produce(report("Spec result: passed\nStandards result: passed", "src/shop/api/code.ts src/shop/api/added.ts"));
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  renameSync(join(f.root, "src/shop/api/code.ts"), join(f.root, "src/shop/api/renamed.ts"));
  const renamed = produce(report("Spec result: passed\nStandards result: passed", "src/shop/api/renamed.ts src/shop/api/added.ts"));
  assert.equal(renamed.status, 0, renamed.stdout + renamed.stderr);
  write(f.root, "core/tool.ts", "export const tool = 1;\n");
  const modulePath = "docs/aidlc/ideation/module-manifest.json";
  const modules = JSON.parse(readFileSync(join(f.root, modulePath), "utf8"));
  modules.modules.find((module: {module_id:string}) => module.module_id === "shop").paths = ["core", "src/shop"];
  write(f.root, modulePath, modules);
  const unitPath = `${f.base}/unit-manifest.json`;
  const units = JSON.parse(readFileSync(join(f.root, unitPath), "utf8"));
  units.units.find((unit: {unit_id:string}) => unit.unit_id === "api").evidence_inputs.paths = ["core"];
  write(f.root, unitPath, units);
  assert.notEqual(produce(report("Spec result: passed\nStandards result: passed", "src/shop/api/added.ts")).status, 0, "declared non-default source roots remain covered");
  const core = produce(report("Spec result: passed\nStandards result: passed", "core/tool.ts"));
  assert.equal(core.status, 0, core.stdout + core.stderr);
  console.log("PASS audit review: independent axes, missing/conflicting results, real paths and changed-file coverage");
} finally { rmSync(f.root, { recursive: true, force: true }); }

const parallel = fixture("tdd@module:shop@unit:api");
try {
  bindSession(parallel.root, { instance: "tdd@module:shop@unit:api", owner: "api-owner", session: "api-session", expected: claimToken(undefined) });
  const web = bindSession(parallel.root, { instance: "tdd@module:shop@unit:web", owner: "web-owner", session: "web-session", expected: claimToken(undefined) }).binding;
  const before = loadWorkflowState(parallel.root)!;
  const reported = cli(parallel.root, ["orchestrate", "report", "--stage", "tdd", "--module", "shop", "--unit", "web", "--result", "revised"], JSON.stringify(web));
  assert.equal(reported.status, 0, reported.stdout + reported.stderr);
  const after = loadWorkflowState(parallel.root)!;
  assert.equal(after.history.at(-1)?.instance_id, "tdd@module:shop@unit:web");
  assert.deepEqual(after.active_instances["tdd@module:shop@unit:api"], before.active_instances["tdd@module:shop@unit:api"]);
  assert.equal(after.current_stage_instance, before.current_stage_instance, "report preserves the sibling global pointer");
} finally { rmSync(parallel.root, { recursive: true, force: true }); }
console.log("PASS parallel report selects the exact bound unit among same-stage claims");
