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
  harnessDir: ".claude",
  orchestratorSkillPath: ".claude/CLAUDE.md",

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
    { src: "CLAUDE.md", dst: "CLAUDE.md", projectRoot: true },
    { src: "plugin.json", dst: "../.claude-plugin/plugin.json" },
  ],

  plugin: { manifestDir: ".claude-plugin", kind: "claude" },
};

export default manifest;
