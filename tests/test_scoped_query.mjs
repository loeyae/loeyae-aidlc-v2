import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { query } from "../core/tools/aidlc-query.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidlc query 中文 "));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aidlc query outside "));
const put = (file, text) => fs.writeFileSync(path.join(root, file), text);
try {
  put("handoff.md", "# Handoff\n| CR-A-001 | [Continue](cr.md#continue) | " + "UNRELATED_STATE ".repeat(300) + "|\n| CR-A-002 | other |\n");
  const located = query(root, ["locate", "handoff.md", "CR-A-001"]);
  assert.equal(located.matches.length, 1);
  assert.deepEqual(located.matches[0].links, [{ label: "Continue", target: "cr.md#continue" }]);
  assert(!JSON.stringify(located).includes("UNRELATED_STATE"), "navigation lookup must not return the full wide row");
  put("cr.md", "# CR\nIntroduction\n## Continue\nOpening\n### Implementation\nTODO behavior\n```md\n## fake heading in code\n```\n### Verification\nNot run\n## History\nOLD\n");
  assert.deepEqual(query(root, ["section", "cr.md"]).headings.map(h => h.title), ["CR"]);
  const section = query(root, ["section", "cr.md", "Continue"]);
  assert.equal(section.content, "## Continue\nOpening");
  assert.deepEqual(section.subsections.map(h => h.title), ["Implementation", "Verification"]);
  assert(!JSON.stringify(section).includes("OLD"));
  const leaf = query(root, ["section", "cr.md", "6"]);
  assert(leaf.content.includes("fake heading in code"));
  assert(!leaf.content.includes("Not run"));
  assert.throws(() => query(root, ["section", "cr.md", "999"]));
  put("duplicate.md", "## Same\nA\n## Same\nB\n");
  assert.throws(() => query(root, ["section", "duplicate.md", "Same"]), /ambiguous/);

  put("results.json", JSON.stringify({ total: 2, suites: [{ name: "affected", status: "failed", log: "LARGE_RAW_LOG".repeat(5000) }, { name: "other", status: "passed" }] }));
  assert.deepEqual(query(root, ["json", "results.json"]).schema.keys, ["total", "suites"]);
  const projected = query(root, ["json", "results.json", "total", "suites.*.name", "suites.*.status", "suites", "missing", "constructor"]);
  assert.deepEqual(projected.fields[1].values, ["affected", "other"]);
  assert.deepEqual(projected.fields[2].values, ["failed", "passed"]);
  assert.equal(projected.fields[3].values[0].type, "array");
  assert.equal(projected.fields[4].matches, 0);
  assert.equal(projected.fields[5].matches, 0);
  assert(!JSON.stringify(projected).includes("LARGE_RAW_LOG"));

  put("qa.md", "| ID | Title | Source |\n| --- | --- | --- |\n| TC-X-001 | normal | STORY-0207; AC-020702 |\n| TC-X-171 | sold out | AC-020702; AC-020703 |\n| TC-X-172 | boundary \\| limit | AC-020703 |\n| TC-X-175 | concurrent | AC-020702; TC-X-172 |\n| TC-X-176 | unrelated | AC-999999 |\nUnstructured AC-020703 needs inspection\n");
  const candidates = query(root, ["cases", "qa.md", "AC-020702", "AC-020703"]);
  assert.deepEqual(candidates.candidates.map(r => r.id), ["TC-X-001", "TC-X-171", "TC-X-172", "TC-X-175"]);
  assert.equal(candidates.candidates[2].title, "boundary | limit");
  assert(candidates.candidates[3].refs.includes("TC-X-172"));
  assert.deepEqual(candidates.unparsedReferenceLines, [8]);
  put("path-title.md", "| ID | Title | Source |\n| TC-X-901 | C:\\forms\\new | AC-020703 |\n");
  assert.equal(query(root, ["cases", "path-title.md", "AC-020703"]).candidates[0].title, "C:\\forms\\new");
  put("uc.md", "<!-- UC-D BEGIN: UC-D-066 -->\nsource_ref: AC-020701\n## UC-D-066 Previous\nPrior case\n<!-- UC-D END: UC-D-066 -->\n<!-- UC-D BEGIN: UC-D-067 -->\nsource_ref: AC-020702\n## UC-D-067 Reserve\nGiven normal\n<!-- UC-D END: UC-D-067 -->\n<!-- UC-D BEGIN: UC-D-068 -->\nsource_ref: AC-020703\n## UC-D-068 Validate\nThen reject\n<!-- UC-D END: UC-D-068 -->\n");
  assert.deepEqual(query(root, ["cases", "uc.md", "AC-020702"]).candidates.map(r => r.id), ["UC-D-067"]);
  assert.deepEqual(query(root, ["cases", "uc.md", "AC-020703"]).candidates.map(r => r.id), ["UC-D-068"]);
  assert.equal(query(root, ["locate", "uc.md", "AC-020702"]).matches[0].record.id, "UC-D-067");
  const selectedCase = query(root, ["section", "uc.md", "7"]);
  assert.equal(selectedCase.id, "UC-D-067");
  assert(selectedCase.content.includes("source_ref: AC-020702"));
  assert(!selectedCase.content.includes("AC-020701") && !selectedCase.content.includes("AC-020703"));
  put("example.md", "````md\n```example\n<!-- UC-D BEGIN: UC-D-900 -->\nAC-020703\n<!-- UC-D END: UC-D-900 -->\n```\n````\n");
  assert.equal(query(root, ["cases", "example.md", "AC-020703"]).candidates.length, 0);
  put("broken.md", "<!-- UC-D BEGIN: UC-D-001 -->\nsource_ref: AC-020703\n");
  assert.throws(() => query(root, ["cases", "broken.md", "AC-020703"]), /Unclosed/);
  assert.throws(() => query(root, ["cases", "qa.md"]));
  assert.throws(() => query(root, ["json", "."]), /explicit file/);
  fs.writeFileSync(path.join(outside, "private.json"), '{"secret":"OUTSIDE"}');
  assert.throws(() => query(root, ["json", path.join(outside, "private.json")]), /outside paths/);
  assert.throws(() => query(root, ["json", path.relative(root, path.join(outside, "private.json"))]), /outside paths/);
  try {
    fs.symlinkSync(path.join(outside, "private.json"), path.join(root, "escape.json"), "file");
    assert.throws(() => query(root, ["json", "escape.json"]), /outside paths/);
  } catch (error) {
    if (!["EPERM", "EACCES"].includes(error.code)) throw error;
    fs.symlinkSync(outside, path.join(root, "escape-junction"), "junction");
    assert.throws(() => query(root, ["json", "escape-junction/private.json"]), /outside paths/);
    console.log("File symlink privilege unavailable; tested a real directory junction escape instead");
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "results.json"))).suites[0].log.length, 65000);
  console.log("PASS scoped query: compact navigation/JSON, all reference candidates, case boundaries, unresolved references and read-only path confinement");
} finally {
  for (const dir of [root, outside]) {
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
