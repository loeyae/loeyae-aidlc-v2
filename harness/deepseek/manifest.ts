import type { HarnessManifest } from "../../scripts/manifest-types.ts";

// DeepSeek Harness discovers directory bundles directly under .dsh/skills.
// Keep stage tools and subordinate skills inside the bundle for on-demand reads.
const manifest: HarnessManifest = {
  name: "deepseek",
  harnessDir: ".",
  skillEntryPath: "SKILL.md",
  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "knowledge", dst: "knowledge" },
    { src: "skills", dst: "skills" },
  ],
  harnessFiles: [
    { src: "README.md", dst: "README.md" },
  ],
};

export default manifest;
