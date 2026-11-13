import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
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
const harnesses = readdirSync(join(root, "harness"))
  .filter(name => existsSync(join(root, "harness", name, "manifest.ts")));
for (const name of harnesses) {
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
  const entry=join(dist,manifest.skillEntryPath), prefix=relative(dirname(entry),base).replaceAll("\\","/");
  assert.equal(readFileSync(entry,"utf8"),readFileSync(join(root,"core/ENTRY.md"),"utf8").replaceAll("{{root}}",prefix?prefix+"/":""));expected.add(entry);count++;
  assert.deepEqual(walk(dist).sort(), [...expected].sort(), `unexpected packaged ${name} files`);
}
const methods=JSON.parse(readFileSync(join(root,"core/knowledge/methods.json"),"utf8"));
assert.equal(methods.length,21);
for(const p of walk(join(root,"core"))) assert(!/aidlc-orchestrate|stage-graph|aidlc-autonomy|legacy-skills/.test(p),`retired runtime in package: ${p}`);
console.log(`PASS installed distribution parity: ${harnesses.length} harnesses, ${count} files; ${methods.length} current methods`);
