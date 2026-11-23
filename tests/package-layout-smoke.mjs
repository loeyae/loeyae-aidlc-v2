import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const [root] = process.argv.slice(2);
const req = createRequire(join(root, "package.json"));
for (const name of Object.keys(req("./package.json").dependencies)) {
  const entry = req.resolve(name);
  assert(entry.startsWith(join(root, "node_modules")) || entry.startsWith(join(root, "..")), `dependency resolved outside installation: ${name}: ${entry}`);
}
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const resolveLinks=(text,from)=>text.replace(/\]\(([^)]+)\)/g,(link,target)=>/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)?link:`](${resolve(from,target)})`);
const sourceEntry=readFileSync(join(root,"core/ENTRY.md"),"utf8");
const sourceRules=readFileSync(join(root,"core/knowledge/protocols/host-execution.md"),"utf8").trim().replace(/^# /gm,"## ");
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
  const parts=sourceEntry.replaceAll("{{root}}",prefix?prefix+"/":"").split("{{execution}}");assert.equal(parts.length,2);
  const rendered=readFileSync(entry,"utf8");assert(rendered.startsWith(parts[0])&&rendered.endsWith(parts[1]));
  const embedded=rendered.slice(parts[0].length,-parts[1].length);
  assert.equal(resolveLinks(embedded,dirname(entry)),resolveLinks(sourceRules,join(base,"knowledge/protocols")));
  assert(!rendered.includes("{{"),`unresolved entry template: ${entry}`);expected.add(entry);count++;
  assert.deepEqual(walk(dist).sort(), [...expected].sort(), `unexpected packaged ${name} files`);
}
const methods=JSON.parse(readFileSync(join(root,"core/knowledge/methods.json"),"utf8"));
assert.equal(methods.length,22);
assert(methods.some(method=>method.id==='aidlc-acceptance-validation'));
for(const p of walk(join(root,"core"))) assert(!/aidlc-orchestrate|stage-graph|aidlc-autonomy|legacy-skills/.test(p),`retired runtime in package: ${p}`);
console.log(`PASS installed distribution parity: ${harnesses.length} harnesses, ${count} files; ${methods.length} current methods`);
