/**
 * harness/kiro-ide/manifest.ts — Kiro IDE (Power) distribution.
 *
 * Projects core/ into the Kiro Power format:
 *   - POWER.md as entry point
 *   - steering/ auto-loaded by IDE
 *   - mcp.json declares MCP services
 */

import type { HarnessManifest } from "../../scripts/manifest-types.ts";

const manifest: HarnessManifest = {
  name: "kiro-ide",
  harnessDir: ".",
  orchestratorSkillPath: "POWER.md",

  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "stages/ideation", dst: "steering/ideation" },
    { src: "stages/inception", dst: "steering/inception" },
    { src: "stages/construction", dst: "steering/construction" },
    { src: "stages/operation", dst: "steering/operation" },
    { src: "knowledge", dst: "knowledge" },
    { src: "sensors", dst: "sensors" },
    { src: "skills", dst: "skills" },
    { src: "hooks/kiro", dst: "hooks" },
  ],

  harnessFiles: [
    { src: "POWER.md", dst: "POWER.md" },
    { src: "mcp.json", dst: "mcp.json" },
    { src: "README.md", dst: "README.md", projectRoot: true },
  ],

  plugin: { manifestDir: ".kiro-plugin", kind: "kiro" },
};

export default manifest;
