/**
 * harness/codex/manifest.ts — Codex distribution.
 *
 * Projects the shared AI-DLC core into Codex's global skill layout:
 *   - ~/.agents/skills/loeyae-aidlc/SKILL.md
 *   - sibling tools, stages, knowledge and sensors are loaded on demand
 *
 * Codex uses AGENTS.md for durable global/project guidance and SKILL.md for
 * reusable workflows. This harness only owns the reusable AI-DLC Skill;
 * governance remains in the shared engine and stage files.
 */

import type { HarnessManifest } from "../../scripts/manifest-types.ts";

const manifest: HarnessManifest = {
  name: "codex",
  harnessDir: ".agents/skills/loeyae-aidlc",
  skillEntryPath: ".agents/skills/loeyae-aidlc/SKILL.md",

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
