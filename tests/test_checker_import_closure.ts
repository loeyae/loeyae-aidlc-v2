import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repository = resolve(import.meta.dirname, ".."), tool = mkdtempSync(join(tmpdir(), "aidlc-closed-imports-"));
cpSync(join(repository, "core/tools"), join(tool, "core/tools"), { recursive: true });
cpSync(join(repository, "package.json"), join(tool, "package.json"));
symlinkSync(join(repository, "node_modules"), join(tool, "node_modules"), "junction");
const { semanticCheckerDigest } = await import(pathToFileURL(join(tool, "core/tools/aidlc-checker-identity.ts")).href);
const checker = join(tool, "core/tools/aidlc-template-checker.ts"), original = readFileSync(checker, "utf8");
const dependency = join(tool, "core/tools/unbound-audit-dependency.ts");
writeFileSync(dependency, "export const value = 1;\n");
const statements = [
  'import "./unbound-audit-dependency";',
  'import/* audit */ "./unbound-audit-dependency";',
  'import // audit\n "./unbound-audit-dependency";',
  'import {value} from/* audit */ "./unbound-audit-dependency";',
  'import {value /* ; audit */} from "./unbound-audit-dependency";',
  'import {value /* "audit" */} from "./unbound-audit-dependency";',
  'import {"value" as named} from "./unbound-audit-dependency";',
  'export {value as "audit"} from "./unbound-audit-dependency";',
  'export * from "./unbound-audit-dependency";',
  'void import("./unbound-audit-dependency");',
  'void import/* audit */("./unbound-audit-dependency");',
  'require/* audit */("./unbound-audit-dependency");',
  'import type from "./aidlc-revision"; console.log(type);',
  'import type, {readSourceRevision} from "./aidlc-revision"; console.log(type, readSourceRevision);',
  'import type {DigestScope} from "./aidlc-revision";',
  'import {createRequire as makeLoader} from "node:module"; const load = makeLoader(import.meta.url); load("./unbound-audit-dependency");',
  'import {runInNewContext as runCode} from "node:vm"; runCode("1 + 1");',
];
for (const statement of statements) {
  writeFileSync(checker, `${original}\n${statement}\n`);
  assert.throws(() => semanticCheckerDigest(true, "template-completeness"), /undeclared.*(?:checker|dependency)/, `unsupported dependencies must fail closed: ${statement}`);
}
writeFileSync(checker, original);
const unchanged = semanticCheckerDigest(true, "template-completeness");
appendFileSync(dependency, "export const changed = true;\n");
assert.equal(semanticCheckerDigest(true, "template-completeness"), unchanged, "an unimported tool does not invalidate this checker");
appendFileSync(join(tool, "core/tools/aidlc-sensor-inputs.ts"), "\n// actual closure dependency changed\n");
assert.notEqual(semanticCheckerDigest(true, "template-completeness"), unchanged, "actual closure dependencies remain bound");
console.log(`PASS closed checker imports: ${statements.length} unsupported import/re-export forms blocked; declared dependencies remain bound`);
