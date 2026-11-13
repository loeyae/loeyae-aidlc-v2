import type { HarnessManifest } from "../../scripts/manifest-types.ts";

const manifest: HarnessManifest = {
  name: "codebuddy",
  harnessDir: "plugins/loeyae-aidlc",
  skillEntryPath: "plugins/loeyae-aidlc/skills/loeyae-aidlc/SKILL.md",

  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "knowledge", dst: "knowledge" },
    { src: "skills", dst: "skills" },
  ],

  harnessFiles: [
    { src: "plugin.json", dst: ".codebuddy-plugin/plugin.json" },
    { src: "README.md", dst: "README.md" },
    { src: "marketplace.json", dst: ".codebuddy-plugin/marketplace.json", projectRoot: true },
  ],

  plugin: { manifestDir: ".codebuddy-plugin", kind: "codebuddy" },
};

export default manifest;
