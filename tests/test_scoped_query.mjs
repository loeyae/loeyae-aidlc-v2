import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query, reconcile } from "../core/tools/aidlc-query.mjs";

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
  put("stories.md", "# Stories\n## STORY-0207 Checkout\n### AC-020701 Submit\nSENSITIVE_BODY\n### AC-020702 Stock\n```md\n### AC-999998 Example only\n```\n### AC-020703 Concurrent\n## STORY-9999 Other\n### AC-999999 Unrelated\n");
  const refs = query(root, ["references", "stories.md", "STORY-0207"]);
  assert.deepEqual(refs.references, ["STORY-0207", "AC-020701", "AC-020702", "AC-020703"]);
  assert(!JSON.stringify(refs).includes("SENSITIVE_BODY"));
  assert.deepEqual(query(root, ["cases", "qa.md", "STORY-0207"]).candidates.map(r => r.id), ["TC-X-001"]);
  assert.deepEqual(query(root, ["cases", "qa.md", ...refs.references]).candidates, candidates.candidates, "AC-only references must not disappear when starting from a STORY");
  assert.deepEqual(query(root, ["references", "stories.md", "AC-020702"]).references, ["AC-020702"]);
  assert.throws(() => query(root, ["references", "stories.md", "STORY-404"]), /Missing/);
  assert.throws(() => query(root, ["references", "stories.md"]));
  put("duplicate-stories.md", "## STORY-0207 A\n## STORY-0207 B\n");
  assert.throws(() => query(root, ["references", "duplicate-stories.md", "STORY-0207"]), /ambiguous/);

  const pending = "# CR\n## Continue\n### Cases\n| Source | Disposition |\n| TC-X-001; TC-X-171/172 | Preserve after new setup |\n```md\nTC-X-175 example, not a disposition\n```\n## History\nTC-X-175\n";
  put("record.md", pending);
  const snapshot = structuredClone(candidates);
  const missing = reconcile(root, "record.md", "Continue", [candidates]);
  assert.deepEqual(missing.unrecorded, ["TC-X-175"], "Compare actual results, not a manually selected subset or history/example mentions");
  assert.deepEqual(missing.sources[0].unresolvedLines, [8]);
  put("record.md", pending.replace("TC-X-171/172", "TC-X-171/172；L337：175"));
  const reconciled = reconcile(root, "record.md", "Continue", [candidates, candidates]);
  assert.equal(reconciled.candidates, 4, "Repeated queries must not duplicate candidates");
  assert.deepEqual(reconciled.unrecorded, []);
  assert.match(reconciled.meaning, /no acceptance, authorization or completeness/);
  assert.deepEqual(candidates, snapshot, "Do not mutate retained query evidence");
  put("ranges.md", "## Continue\nTC-X-001; TC-X-171-TC-X-175\n");
  assert.deepEqual(reconcile(root, "ranges.md", "Continue", [candidates]).unrecorded, []);
  put("named-cases.md", "| TC-L001 | Named suffix | AC-020703 |\n| TC-123-001 | Numeric prefix | AC-020703 |\n| TC-123-002 | Numeric prefix | AC-020703 |\n");
  put("named-record.md", "## Continue\nTC-L001; TC-123-001-TC-123-002\n");
  assert.deepEqual(reconcile(root, "named-record.md", "Continue", [query(root, ["cases", "named-cases.md", "AC-020703"])]).unrecorded, []);
  put("ranges.md", "## Continue\nTC-X-001; TC-X-175～171\n");
  assert.equal(reconcile(root, "ranges.md", "Continue", [candidates]).unresolvedNotation.length, 1);
  assert.throws(() => reconcile(root, "record.md", "Continue", []), /nonempty/);
  assert.throws(() => reconcile(root, "record.md", "Continue", ["TC-X-001"]), /complete cases/);
  assert.throws(() => reconcile(root, "record.md", "Missing", [candidates]), /missing/i);
  const empty = query(root, ["cases", "qa.md", "AC-404"]);
  assert.equal(reconcile(root, "record.md", "Continue", [empty]).candidates, 0);
  assert.match(reconcile(root, "record.md", "Continue", [empty]).meaning, /including when candidates or unrecorded are empty/);
  const cli = fileURLToPath(new URL("../core/tools/aidlc-query.mjs", import.meta.url));
  const pipe = input => spawnSync(process.execPath, [cli, "reconcile", "record.md", "Continue"], { cwd: root, input, encoding: "utf8" });
  const piped = pipe(JSON.stringify(candidates) + "\n" + JSON.stringify(empty));
  assert.equal(piped.status, 0, piped.stderr);
  assert.deepEqual(JSON.parse(piped.stdout).unrecorded, []);
  for (const input of ["", "[]", '["TC-X-001"]', JSON.stringify(candidates) + "\nBROKEN"]) assert.equal(pipe(input).status, 1, "Invalid/partial input must not become empty success");
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
  assert.throws(() => reconcile(root, path.join(outside, "private.json"), "Continue", [candidates]), /outside paths/);
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
  console.log("PASS scoped query: compact reads, STORY/AC expansion, actual-result reconciliation, case boundaries, unresolved references, CLI input and read-only path confinement");
} finally {
  for (const dir of [root, outside]) {
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
