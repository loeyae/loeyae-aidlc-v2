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
  skillEntryPath: "skills/loeyae-aidlc/SKILL.md",

  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "knowledge", dst: "knowledge" },
    { src: "skills", dst: "skills" },
  ],

  harnessFiles: [
    { src: "plugin.json", dst: ".claude-plugin/plugin.json" },
  ],

  plugin: { manifestDir: ".claude-plugin", kind: "claude" },
};

export default manifest;
