import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const configRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harnessRoot = fs.existsSync(path.join(configRoot, "tools")) ? configRoot : path.join(configRoot, "loeyae-aidlc");
const protocolPath = path.join(harnessRoot, "knowledge/protocols/host-execution.md");

// Native host owns execution and idle/continuation. No lifecycle guard or Core dispatch.
export const LoeyaeAidlcPlugin = async () => ({
  config: async (config) => {
    config.instructions = config.instructions || [];
    config.instructions = config.instructions.filter(value => value !== path.join(harnessRoot, "tools/aidlc-orchestrate.ts"));
    if (fs.existsSync(protocolPath) && !config.instructions.includes(protocolPath)) config.instructions.push(protocolPath);
  },
  "experimental.chat.messages.transform": async (_input, output) => {
    const firstUser = output.messages.find(message => message.info.role === "user");
    if (!firstUser?.parts.length) return;
    const marker = "Loeyae AI-DLC：宿主直接实施";
    if (firstUser.parts.some(part => part.type === "text" && part.text.includes(marker))) return;
    firstUser.parts.unshift({ ...firstUser.parts[0], type: "text", text:
      `${marker}。按用户已确认目标和验收标准使用原生工具连续实施、测试、审查和返修。可选 work 命令只读查看 Git/选定输入，不创建 workflow/claim/grant，不要求 H5 或逐阶段 report。流程记录缺失不阻止开发，测试失败继续修复且不得宣称完成。按需读取 ${protocolPath}；旧受管协议只在用户明确选择维护旧流程时使用。` });
  },
});
