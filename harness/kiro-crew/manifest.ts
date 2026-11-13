/**
 * harness/kiro-crew/manifest.ts — Kiro Crew Dashboard distribution.
 *
 * Projects core/ into ~/.kiro/crew/skills/loeyae-aidlc/ (the skill install path).
 * Kiro Crew specifics:
 *   - Execution and delegation are owned by the host
 *   - No .kiro/hooks/ auto-trigger (hooks are advisory, executed by agent)
 *   - SKILL.md is the entry point (not AGENTS.md)
 *   - steering/ files are loaded by agent on-demand via file reads
 */

import type { HarnessManifest } from "../../scripts/manifest-types.ts";

const manifest: HarnessManifest = {
  name: "kiro-crew",
  harnessDir: "skills/loeyae-aidlc",
  skillEntryPath: "skills/loeyae-aidlc/SKILL.md",

  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "knowledge", dst: "knowledge" },
    { src: "skills", dst: "skills" },
  ],

  harnessFiles: [
    { src: "skills/loeyae-aidlc/question-rendering.md", dst: "question-rendering.md" },
    { src: "README.md", dst: "README.md", projectRoot: true },
  ],

  plugin: { manifestDir: ".kiro-plugin", kind: "kiro-crew" },
};

export default manifest;
