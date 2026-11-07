import type { HarnessManifest } from "../../scripts/manifest-types.ts";

// DeepSeek Harness discovers directory bundles directly under .dsh/skills.
// Keep stage tools and subordinate skills inside the bundle for on-demand reads.
const manifest: HarnessManifest = {
  name: "deepseek",
  harnessDir: ".",
  orchestratorSkillPath: "SKILL.md",
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
    { src: "README.md", dst: "README.md" },
  ],
};

export default manifest;
