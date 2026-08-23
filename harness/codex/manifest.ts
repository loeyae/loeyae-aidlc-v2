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
  orchestratorSkillPath: ".agents/skills/loeyae-aidlc/SKILL.md",

  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "stages/ideation", dst: "stages/ideation" },
    { src: "stages/inception", dst: "stages/inception" },
    { src: "stages/construction", dst: "stages/construction" },
    { src: "stages/operation", dst: "stages/operation" },
    { src: "knowledge", dst: "knowledge" },
    { src: "scopes", dst: "scopes" },
    { src: "agents", dst: "agents" },
    { src: "memory", dst: "memory" },
    { src: "sensors", dst: "sensors" },
    { src: "skills", dst: "skills" },
    { src: "templates", dst: "templates" },
  ],

  harnessFiles: [
    { src: "skills/loeyae-aidlc/SKILL.md", dst: "SKILL.md" },
    { src: "README.md", dst: "README.md" },
  ],
};

export default manifest;
