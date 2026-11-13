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
