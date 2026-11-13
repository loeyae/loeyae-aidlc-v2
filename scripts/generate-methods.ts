import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
/** Generated from method front matter: descriptions have one maintenance location. */
export function generateMethods(root: string) {
  const skills = resolve(root, "core/skills");
  const methods = readdirSync(skills).sort().map(id => {
    const text = readFileSync(resolve(skills, id, "SKILL.md"), "utf8");
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!front) throw Error(`Missing method front matter: ${id}`);
    const data = parse(front[1]);
    if (data.name !== id || typeof data.description !== "string" || !data.description.trim()) throw Error(`Invalid method identity: ${id}`);
    return { id, description: data.description, path: `skills/${id}/SKILL.md` };
  });
  writeFileSync(resolve(root, "core/knowledge/methods.json"), JSON.stringify(methods, null, 2) + "\n");
  writeFileSync(resolve(root, "core/knowledge/methods.md"), "# 方法目录\n\n由技能元信息生成；只选择当前问题需要的方法，不按顺序执行或批量加载。质量、权限和完成边界见[执行规则](protocols/host-execution.md)。\n\n"
    + methods.map(m => `- [${m.id}](../${m.path})：${m.description}`).join("\n") + "\n");
}
