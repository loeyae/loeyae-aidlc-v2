import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

// Limited to production roots, not migration history, generic SSOT invariant ids or tests.
const forbidden = /ssot\.dev\.loeyae\.com|SSOT_API_KEY|common-ssot-integration|\b(?:search_documents|retrieve_context|list_projects|write_formal_document|archive_document)\b/;
function scan(root: string): string[] {
  const found: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (forbidden.test(relative(root, path)) || forbidden.test(readFileSync(path, "utf8"))) found.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  for (const dir of ["core", "harness", "bin", "scripts"]) walk(join(root, dir));
  return found;
}
const root = resolve(import.meta.dirname, "..");
assert.deepEqual(scan(root), [], "production must not contain service endpoints, tool mappings or credential conventions");
const fixture = mkdtempSync(join(tmpdir(), "aidlc-context-scan-"));
try {
  for (const dir of ["core", "harness", "bin", "scripts"]) mkdirSync(join(fixture, dir));
  for (const value of ["https://ssot.dev.loeyae.com/mcp/", "SSOT_API_KEY", "search_documents", "list_projects", "common-ssot-integration.md"]) {
    writeFileSync(join(fixture, "core", "regression.md"), value);
    assert.deepEqual(scan(fixture), ["core/regression.md"]);
  }
} finally { rmSync(fixture, { recursive: true, force: true }); }
console.log("Context-source production boundary scan passed (with negative controls)");
