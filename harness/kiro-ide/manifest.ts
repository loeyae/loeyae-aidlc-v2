/**
 * harness/kiro-ide/manifest.ts — Kiro IDE Agent Skill distribution.
 *
 * Kiro IDE and Kiro CLI discover the same global Skill layout:
 *   - SKILL.md as entry point
 *   - stages/ and knowledge/ loaded progressively by the Skill
 *   - hooks/ retained as the source for explicit project Hook installation
 */

import type { HarnessManifest } from "../../scripts/manifest-types.ts";

const manifest: HarnessManifest = {
  name: "kiro-ide",
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
    { src: "hooks/kiro", dst: "hooks" },
  ],

  harnessFiles: [
    { src: "SKILL.md", dst: "SKILL.md" },
    { src: "README.md", dst: "README.md" },
  ],
};

export default manifest;
