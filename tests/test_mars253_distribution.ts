import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { HarnessManifest } from "../scripts/manifest-types";

const root = resolve(import.meta.dirname, "..");
const files = [
  "tools/aidlc-evidence.ts", "tools/aidlc-execution-context.ts", "tools/aidlc-orchestrate.ts",
  "tools/aidlc-semantic-checks.ts", "tools/aidlc-source-deletions.ts", "tools/aidlc-ucd-declarations.ts",
  "tools/aidlc-i13-applicability.ts", "tools/data/stage-graph.json",
  "knowledge/protocols/test-case-derivation.md", "stages/construction/construction-code-generation.md",
  "stages/inception/inception-test-case-derivation.md", "skills/aidlc-test-case-derivation/SKILL.md",
  "skills/aidlc-build-test-evidence/SKILL.md",
];
let checked = 0;
for (const harness of readdirSync(join(root, "harness"))) {
  const manifest = (await import(pathToFileURL(join(root, "harness", harness, "manifest.ts")).href)).default as HarnessManifest;
  for (const file of files) {
    const mapping = manifest.coreDirs.find(mapping => file.startsWith(`${mapping.src}/`));
    assert.ok(mapping, `${harness}: mapping for ${file}`);
    const target = join(root, "dist", harness, manifest.harnessDir, mapping.dst, file.slice(mapping.src.length + 1));
    assert.ok(readFileSync(target).equals(readFileSync(join(root, "core", file))), `${harness}: ${file} drift`);
    checked++;
  }
}
assert.equal(checked, files.length * 9);
console.log(`PASS ${checked} shared engine, protocol, stage, skill and graph copies across nine distributions`);
