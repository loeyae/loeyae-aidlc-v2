import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const [root] = process.argv.slice(2);
const req = createRequire(join(root, "package.json"));
for (const name of Object.keys(req("./package.json").dependencies)) {
  // The MCP SDK intentionally exposes subpaths; it has no root index module.
  const entry = req.resolve(name === "@modelcontextprotocol/sdk" ? `${name}/client/index.js` : name);
  assert(entry.startsWith(join(root, "node_modules")) || entry.startsWith(join(root, "..")), `dependency resolved outside installation: ${name}: ${entry}`);
}
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
let count = 0;
for (const name of ["kiro-crew", "kiro-ide", "kiro-cli", "claude", "opencode", "codex", "codebuddy", "qoder", "zcode"]) {
  const { default: manifest } = await import(pathToFileURL(join(root, "harness", name, "manifest.ts")).href);
  const dist = join(root, "dist", name), base = join(dist, manifest.harnessDir), expected = new Set();
  for (const { src, dst } of manifest.coreDirs) for (const source of walk(join(root, "core", src))) {
    const target = join(base, dst, relative(join(root, "core", src), source));
    assert(existsSync(target), `tarball omitted ${target}`);
    assert.deepEqual(readFileSync(target), readFileSync(source), `packaged dist differs: ${target}`);
    expected.add(target); count++;
  }
  for (const file of manifest.harnessFiles) {
    const source = join(root, "harness", name, file.src), target = join(file.projectRoot ? dist : base, file.dst);
    assert.deepEqual(readFileSync(target), readFileSync(source), `packaged harness file differs: ${target}`);
    expected.add(target); count++;
  }
  assert.deepEqual(walk(dist).sort(), [...expected].sort(), `unexpected packaged ${name} files`);
}
// Load real runtime schema data rather than merely checking the directory exists.
const schema = join(root, "core/tools/data/provider-schema-ownership.json");
assert(Object.keys(JSON.parse(readFileSync(schema, "utf8"))).length);
const schemas = walk(join(root, "core/tools/data/provider-schemas")).filter(p => p.endsWith(".json"));
assert(schemas.length > 0);
for (const p of schemas) JSON.parse(readFileSync(p, "utf8"));
console.log(`PASS installed distribution parity: 9 harnesses, ${count} files; ${schemas.length} provider schemas`);
