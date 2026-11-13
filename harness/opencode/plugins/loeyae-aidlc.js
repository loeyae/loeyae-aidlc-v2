import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
const configRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.existsSync(path.join(configRoot, "tools")) ? configRoot : path.join(configRoot, "loeyae-aidlc");
const entry = path.join(root, "SKILL.md");
export const LoeyaeAidlcPlugin = async () => ({
  config: async (config) => {
    config.instructions = config.instructions || [];
    // Remove only the obsolete AIDLC instruction previously owned by this plugin.
    config.instructions = config.instructions.filter(value => value !== path.join(root, "tools/aidlc-orchestrate.ts") && value !== path.join(root, "knowledge/protocols/host-execution.md"));
    if (fs.existsSync(entry) && !config.instructions.includes(entry)) config.instructions.push(entry);
  },
});
