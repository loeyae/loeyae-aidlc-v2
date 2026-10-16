import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
const core = resolve(import.meta.dirname, "..");
const provider = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "pass the actual receiving Provider checkout for source-span audit");
const mapping = JSON.parse(readFileSync(join(provider, "tests/fixtures/core-tech-extraction.json"), "utf8")) as Array<{package: string; source: string; source_digest: string; start: number; end: number; path: string; digest: string}>;
const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const baseline = "13d4010468faa25d13790c5c6ed77d34bc7e50b1";
assert.equal(mapping.length, 63);
for (const source of new Set(mapping.map(item => item.source))) {
  const git = spawnSync("git", ["show", `${baseline}:${source}`], { cwd: core, shell: false });
  assert.equal(git.status, 0, git.stderr.toString());
  const original = git.stdout;
  const characters = Array.from(original.toString("utf8"));
  const spans = mapping.filter(item => item.source === source).sort((a, b) => a.start - b.start);
  for (const item of spans) {
    assert.equal(digest(original), item.source_digest, source);
    const expected = Buffer.from(characters.slice(item.start, item.end).join(""));
    const external = readFileSync(join(provider, "providers", item.package, item.path));
    assert.equal(digest(expected), item.digest, `${source}: source span differs`);
    assert.ok(external.equals(expected), `${source}: transferred content differs from baseline`);
  }
  const target = join(core, source);
  if (!existsSync(target)) {
    assert.equal(spans[0].start, 0);
    assert.equal(spans.at(-1)!.end, characters.length);
    for (let i = 1; i < spans.length; i++) assert.equal(spans[i-1].end, spans[i].start, source);
  } else {
    const content = readFileSync(target, "utf8");
    for (const item of spans) {
      const removed = characters.slice(item.start, item.end).join("").trim();
      assert.ok(!removed || !content.includes(removed), `${source}: transferred production span still present`);
    }
  }
}
const deleted = ["common-tech-frontend-pc.md", "common-tech-frontend-uniapp.md", "common-tech-spring-cloud-nacos.md"];
function walk(path: string): string[] { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(path, entry.name)) : entry.name.endsWith(".md") ? [join(path, entry.name)] : []); }
for (const path of walk(join(core, "core"))) {
  const content = readFileSync(path, "utf8");
  for (const name of deleted) assert.ok(!content.includes(name), `dangling production reference ${name} in ${path}`);
}
const security = readFileSync(join(core, "core/knowledge/tech/common-tech-security.md"), "utf8");
assert.match(security, /明文存储密码|密码/);
assert.match(security, /硬编码密钥/);
assert.ok(!security.includes("SecureUtil.md5"));
assert.match(readFileSync(join(core, "core/knowledge/tech/common-tech-testing.md"), "utf8"), /测试可重复执行/);
console.log(`Exact extraction audit: ${mapping.length} spans match baseline bytes and external chapters; complete-file coverage, removed production references, generic security/testing preserved`);
