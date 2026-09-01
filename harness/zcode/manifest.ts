import type { HarnessManifest } from "../../scripts/manifest-types.ts";

const manifest: HarnessManifest = {
  name: "zcode",
  harnessDir: "plugins/loeyae-aidlc",
  orchestratorSkillPath: "plugins/loeyae-aidlc/skills/loeyae-aidlc/SKILL.md",

  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "stages/ideation", dst: "stages/ideation" },
    { src: "stages/inception", dst: "stages/inception" },
    { src: "stages/construction", dst: "stages/construction" },
    { src: "stages/operation", dst: "stages/operation" },
    { src: "knowledge", dst: "knowledge" },
    { src: "sensors", dst: "sensors" },
    { src: "skills", dst: "skills" },
  ],

  harnessFiles: [
    { src: "SKILL.md", dst: "SKILL.md" },
    { src: "SKILL.md", dst: "skills/loeyae-aidlc/SKILL.md" },
    { src: "plugin.json", dst: ".zcode-plugin/plugin.json" },
    { src: "hooks/hooks.json", dst: "hooks/hooks.json" },
    { src: ".mcp.json", dst: ".mcp.json" },
    { src: "README.md", dst: "README.md" },
    { src: "marketplace.json", dst: "marketplace.json", projectRoot: true },
  ],

  plugin: { manifestDir: ".zcode-plugin", kind: "zcode" },
};

export default manifest;
