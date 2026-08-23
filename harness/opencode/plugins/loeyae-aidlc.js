import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const harnessRoot = path.resolve(pluginDir, "..");
const enginePath = path.join(harnessRoot, "tools", "aidlc-orchestrate.ts");
const stagePath = path.join(harnessRoot, "stages");

function bootstrap() {
  return `<EXTREMELY_IMPORTANT>\nLoeyae AI-DLC v2 已启用。使用 ${enginePath} 的确定性引擎获取下一阶段；不得自行跳步。阶段规则位于 ${stagePath}。完成后必须报告结果，所有准入、准出和传感器门禁必须通过。\n</EXTREMELY_IMPORTANT>`;
}

export const LoeyaeAidlcPlugin = async () => ({
  config: async (config) => {
    config.instructions = config.instructions || [];
    if (!config.instructions.includes(enginePath)) config.instructions.push(enginePath);
  },
  "experimental.chat.messages.transform": async (_input, output) => {
    if (!fs.existsSync(enginePath) || !output.messages.length) return;
    const firstUser = output.messages.find((message) => message.info.role === "user");
    if (!firstUser || !firstUser.parts.length) return;
    if (firstUser.parts.some((part) => part.type === "text" && part.text.includes("Loeyae AI-DLC v2 已启用"))) return;
    const firstPart = firstUser.parts[0];
    firstUser.parts.unshift({ ...firstPart, type: "text", text: bootstrap() });
  },
});
