import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const configRoot = path.resolve(pluginDir, "..");
const bundledRoot = path.join(configRoot, "loeyae-aidlc");
const harnessRoot = fs.existsSync(path.join(configRoot, "tools")) ? configRoot : bundledRoot;
const enginePath = path.join(harnessRoot, "tools", "aidlc-orchestrate.ts");
const stagePath = path.join(harnessRoot, "stages");

function bootstrap() {
  return `<EXTREMELY_IMPORTANT>\nLoeyae AI-DLC v2 已启用。使用 ${enginePath} 的确定性引擎获取下一阶段；不得自行跳步。阶段规则位于 ${stagePath}。完成后必须报告结果，所有准入、准出和传感器门禁必须通过。\n</EXTREMELY_IMPORTANT>`;
}

export const LoeyaeAidlcPlugin = async ({ client }) => ({
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
  event: async ({ event }) => {
    if (event.type !== "session.idle") return;

    const sessionId = event.properties?.sessionID || event.properties?.session_id;
    let result;
    try {
      result = Bun.spawnSync(["loeyae-aidlc", "hook", "--format", "opencode"], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      if (!sessionId) return;
      await client.session.prompt({
        path: { id: sessionId },
        body: { parts: [{ type: "text", text: `AI-DLC lifecycle guard could not start: ${String(error)}` }] },
      });
      return;
    }

    if (result.exitCode === 0 || !sessionId) return;
    const message = new TextDecoder().decode(result.stderr || result.stdout).trim() || "AI-DLC stage gate rejected stopping.";
    await client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: `${message}\nContinue the active stage and report it through the AI-DLC engine before stopping.` }] },
    });
  },
});
