/**
 * harness/kiro-crew/manifest.ts — Kiro Crew Dashboard distribution.
 *
 * Projects core/ into ~/.kiro/crew/skills/loeyae-aidlc/ (the skill install path).
 * Kiro Crew specifics:
 *   - Orchestration via spawn_run MCP tool (not kiro-cli subagent)
 *   - No .kiro/hooks/ auto-trigger (hooks are advisory, executed by agent)
 *   - SKILL.md is the entry point (not AGENTS.md)
 *   - steering/ files are loaded by agent on-demand via file reads
 */

import type { HarnessManifest } from "../../scripts/manifest-types.ts";

const manifest: HarnessManifest = {
  name: "kiro-crew",
  harnessDir: "skills/loeyae-aidlc",
  orchestratorSkillPath: "skills/loeyae-aidlc/SKILL.md",

  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "stages/ideation", dst: "stages/ideation" },
    { src: "stages/inception", dst: "stages/inception" },
    { src: "stages/construction", dst: "stages/construction" },
    { src: "stages/operation", dst: "stages/operation" },
    { src: "knowledge", dst: "knowledge" },
    { src: "sensors", dst: "sensors" },
    { src: "skills", dst: "skills" },
    { src: "scopes", dst: "scopes" },
    { src: "agents", dst: "agents" },
    { src: "memory", dst: "memory" },
    { src: "templates", dst: "templates" },
  ],

  harnessFiles: [
    { src: "skills/loeyae-aidlc/SKILL.md", dst: "SKILL.md" },
    { src: "skills/loeyae-aidlc/question-rendering.md", dst: "question-rendering.md" },
    { src: "README.md", dst: "README.md", projectRoot: true },
  ],

  rulesRename: "steering",

  plugin: { manifestDir: ".kiro-plugin", kind: "kiro-crew" },
};

export default manifest;
