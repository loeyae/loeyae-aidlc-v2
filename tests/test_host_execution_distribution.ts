import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

let count = 0;
// Regression contracts for prompt resources: default and managed obligations
// must stay distinct even when the host follows the CR link from its entry.
const protocolRoot = "core/knowledge/protocols/";
const cr = fs.readFileSync(protocolRoot + "change-request-process.md", "utf8");
const host = fs.readFileSync(protocolRoot + "host-execution.md", "utf8");
const managed = fs.readFileSync(protocolRoot + "change-request-managed.md", "utf8");
assert(!/CR 完成 =|CR 暂态文件已删除|任一必需项失败或未验证时保持 CR 活跃并回到 CR4|CR 完成后不应存在任何 CR 专属文件/.test(cr));
assert(cr.includes("不重启 CR4") && cr.includes("提交前保留唯一记录"));
assert(cr.includes("change-request-managed.md") && !cr.includes('"observation_reuse"'));
assert(managed.includes('"observation_reuse"') && managed.includes("change_requested") && managed.includes("签名保护"));
assert(host.includes("不构成受管模式选择") && host.includes("实施、验收、提交/合并"));
assert(host.includes("多单元引用同一运行结果") && host.includes("不自动删除历史文件"));
assert(host.includes("不能把整个 Markdown 文件或目录排除") && host.includes("保留现有保守校验"));
for (const stage of ["construction/construction-code-generation", "construction/construction-build-and-test", "inception/inception-user-stories", "inception/inception-cross-validation"]) {
  const body = fs.readFileSync(`core/stages/${stage}.md`, "utf8");
  assert(body.includes("适用范围：显式受管执行"), stage);
  assert(!body.includes("## 自主宿主执行摘要"), stage);
}
const generation = fs.readFileSync("core/stages/construction/construction-code-generation.md", "utf8");
assert(!generation.includes("最终报告使用的证据必须晚于最后一次源输入编辑"));
assert(generation.includes("纯计划勾选、进度及交付说明") && generation.includes("不凭此规则跳过来源检查"));
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
  for (const doc of ["host-execution.md", "change-request-process.md", "change-request-managed.md"]) {
    assert.equal(fs.readFileSync(path.resolve(path.dirname(protocol), doc), "utf8"), fs.readFileSync(protocolRoot + doc, "utf8"), `${name}: ${doc}`);
  }
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
