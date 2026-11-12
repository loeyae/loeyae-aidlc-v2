import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

let count = 0;
const skills = fs.readdirSync("core/skills").filter(name => fs.existsSync(`core/skills/${name}/SKILL.md`));
assert.equal(skills.length, 21);
for (const name of skills) {
  const file = path.resolve("core/skills", name, "SKILL.md");
  const source = fs.readFileSync(file, "utf8");
  assert(Buffer.byteLength(source) < 8192, `${name}: default body must remain focused`);
  assert(source.includes("host-execution.md"), name);
  const metadata = source.split("---")[1];
  assert(!/所有进入代码生成|必须执行 I13|stage_instance|directive_id/.test(metadata), name);
  for (const match of source.matchAll(/\]\((\.\.\/[^)]+)\)/g)) {
    assert(fs.existsSync(path.resolve(path.dirname(file), match[1])), `${name}: unresolved ${match[1]}`);
  }
}
for (const name of ["claude", "codex", "codebuddy", "qoder", "zcode"]) {
  assert.deepEqual(JSON.parse(fs.readFileSync(`harness/${name}/hooks/hooks.json`, "utf8")).hooks, {});
}
assert.deepEqual(JSON.parse(fs.readFileSync("core/hooks/kiro/aidlc-gates.json", "utf8")).hooks, []);
for (const name of fs.readdirSync("harness")) {
  const manifest = path.resolve("harness", name, "manifest.ts");
  if (!fs.existsSync(manifest)) continue;
  const { default: m } = await import(pathToFileURL(manifest).href);
  const base = path.resolve("dist", name);
  const entry = path.resolve(base, m.orchestratorSkillPath);
  const source = fs.readFileSync(entry, "utf8");
  assert(source.includes("宿主") && source.includes("work"), name);
  const protocol = path.resolve(base, m.harnessDir, "knowledge/protocols/host-execution.md");
  assert(fs.existsSync(protocol), name);
  assert(fs.existsSync(path.resolve(base, m.harnessDir, "tools/aidlc-host-work.ts")), name);
  if (name !== "opencode") {
    const link = source.match(/\[宿主执行协议\]\(([^)]+)\)/)![1];
    assert.equal(path.resolve(path.dirname(entry), link), protocol, name);
    assert(!source.includes("必须展示 directive"), name);
  } else {
    const { LoeyaeAidlcPlugin } = await import(pathToFileURL(entry).href);
    const plugin = await LoeyaeAidlcPlugin({});
    assert.equal(plugin.event, undefined, "no idle guard or continuation loop");
    const config = { instructions: ["keep-other-instructions", path.resolve(base, m.harnessDir, "tools/aidlc-orchestrate.ts")] };
    await plugin.config(config);
    assert.deepEqual(config.instructions, ["keep-other-instructions", protocol]);
    const output = { messages: [{ info: { role: "user" }, parts: [{ type: "text", text: "implement" }] }] };
    await plugin["experimental.chat.messages.transform"]({}, output);
    await plugin["experimental.chat.messages.transform"]({}, output);
    assert.equal(output.messages[0].parts.length, 2, "bootstrap injected once");
  }
  count++;
}
assert.equal(count, 10);
console.log(`PASS: ${count} default host entries, protocol resolution and OpenCode native lifecycle`);
