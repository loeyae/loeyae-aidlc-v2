import type { HarnessManifest } from "../../scripts/manifest-types.ts";

const manifest: HarnessManifest = {
  name: "qoder",
  harnessDir: ".",
  skillEntryPath: "skills/loeyae-aidlc/SKILL.md",

  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "knowledge", dst: "knowledge" },
    { src: "skills", dst: "skills" },
  ],

  harnessFiles: [
    { src: "plugin.json", dst: ".qoder-plugin/plugin.json" },
    { src: "README.md", dst: "README.md" },
  ],

  plugin: { manifestDir: ".qoder-plugin", kind: "qoder-cli" },
};

export default manifest;
