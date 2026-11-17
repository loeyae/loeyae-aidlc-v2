import type { HarnessManifest } from "../../scripts/manifest-types.ts";

const manifest: HarnessManifest = {
  name: "kiro-cli",
  harnessDir: ".",
  skillEntryPath: "SKILL.md",

  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "knowledge", dst: "knowledge" },
    { src: "skills", dst: "skills" },
  ],

  harnessFiles: [
    { src: "../kiro-ide/README.md", dst: "README.md" },
  ],
};

export default manifest;
