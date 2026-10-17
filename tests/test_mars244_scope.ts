// Formal successor of the F4 Git digest probe. Narrowing requires versioned ownership.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { evidenceScopeForInstance, evidenceSourceRevision } from "../core/tools/aidlc-workflow-layout";
import { fixture, write, git } from "./mars244_fixture";
for (const split of [false, true]) {
  const f = fixture("code-generation@module:shop@unit:api", split);
  try {
    const scope = () => evidenceScopeForInstance(f.root, f.state.current_stage_instance!);
    const digest = () => evidenceSourceRevision(f.root, f.state.current_stage_instance!).scope_digest;
    assert.match(scope().label, /^inputs-v2:/);
    const original = digest();
    write(f.root, "src/other/code.ts", "other changed");
    write(f.root, "docs/aidlc/modules/other/construction/a/design.md", "other module design");
    assert.equal(digest(), original, "unrelated module does not invalidate single or split evidence");
    write(f.root, "src/shop/web/code.ts", "sibling changed");
    write(f.root, "docs/aidlc/modules/shop/construction/web/design.md", "sibling design");
    assert.equal(digest(), original, "declared independent unit does not invalidate evidence");
    f.units[1].name = "Unrelated renamed unit";
    write(f.root, `${f.base}/unit-manifest.json`, { schema_version: 1, module_id: "shop", units: f.units });
    assert.equal(digest(), original, "sibling business metadata is projected out while source ownership remains bound");
    git(f.root, "rm", "--cached", `${f.base}/unit-manifest.json`);
    write(f.root, ".gitignore", `${f.base}/unit-manifest.json\n`);
    assert.equal(digest(), original, "tracking/ignoring a manifest does not change the versioned input meaning");
    f.units[0].name = "Relevant unit metadata changed";
    write(f.root, `${f.base}/unit-manifest.json`, { schema_version: 1, module_id: "shop", units: f.units });
    assert.notEqual(digest(), original, "ignored current input declarations remain bound");
    for (const p of ["shared/api.json", "package-lock.json", "src/shop/api/code.ts", "src/shop/api/test.ts", "docs/aidlc/modules/shop/construction/api/design.md", "unknown-shared.config"]) {
      const before = digest(); write(f.root, p, `changed ${p}`); assert.notEqual(digest(), before, `real input must invalidate: ${p}`);
    }
    f.units[0].evidence_inputs.shared_paths.push("src/other/consumer-contract.json");
    write(f.root, `${f.base}/unit-manifest.json`, { schema_version: 1, module_id: "shop", units: f.units });
    write(f.root, "src/other/consumer-contract.json", "shared v1");
    const consumer = digest(); write(f.root, "src/other/consumer-contract.json", "shared v2");
    assert.notEqual(digest(), consumer, "explicit cross-module consumer input overrides another module's private-root exclusion");
    f.units[0].evidence_inputs.depends_on_units = ["web"];
    write(f.root, `${f.base}/unit-manifest.json`, { schema_version: 1, module_id: "shop", units: f.units });
    assert.equal(scope().exclude("src/shop/web/code.ts"), false);
    assert.equal(scope().exclude("docs/aidlc/modules/shop/construction/web/design.md"), false);
    const dependency = digest(); write(f.root, "src/shop/web/code.ts", "dependency changed"); assert.notEqual(digest(), dependency);
    f.units[0].evidence_inputs.depends_on_units = [];
    const legacyUnits = f.units.map(({ evidence_inputs, ...unit }) => unit);
    write(f.root, `${f.base}/unit-manifest.json`, { schema_version: 1, module_id: "shop", units: legacyUnits });
    assert.equal(scope().exclude("src/shop/web/code.ts"), false, "legacy unknown dependencies remain conservative");
    assert.equal(scope().exclude("docs/aidlc/modules/shop/construction/web/design.md"), false);
    write(f.root, `${f.base}/unit-manifest.json`, { schema_version: 1, module_id: "shop", units: f.units.map(u => ({ ...u, evidence_inputs: { ...u.evidence_inputs, paths: ["src/shop"] } })) });
    assert.throws(scope, /overlapping/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
}
console.log("MARS-244 freshness passed: single/split, unrelated module/unit, shared contract/lock/source/test, dependency and conservative legacy fallback");
