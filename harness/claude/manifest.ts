/**
 * harness/claude/manifest.ts — Claude Code distribution.
 *
 * Projects core/ into .claude-plugin/ format:
 *   - CLAUDE.md as entry point
 *   - .claude-plugin/plugin.json declares the plugin
 *   - steering/ loaded via plugin conventions
 */

import type { HarnessManifest } from "../../scripts/manifest-types.ts";

const manifest: HarnessManifest = {
  name: "claude",
  // Claude Code plugins resolve skills and plugin files from the plugin root;
  // unlike project instructions, they must not be nested under .claude/.
  harnessDir: ".",
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
  ],

  harnessFiles: [
    { src: "CLAUDE.md", dst: "skills/loeyae-aidlc/SKILL.md" },
    { src: "plugin.json", dst: ".claude-plugin/plugin.json" },
    { src: "hooks/hooks.json", dst: "hooks/hooks.json" },
  ],

  plugin: { manifestDir: ".claude-plugin", kind: "claude" },
};

export default manifest;
