/**
 * harness/opencode/manifest.ts — OpenCode distribution.
 *
 * Projects core/ via package.json main entry:
 *   - .opencode/plugins/loeyae-aidlc.js as plugin entry
 *   - skills injected via config.skills.paths
 */

import type { HarnessManifest } from "../../scripts/manifest-types.ts";

const manifest: HarnessManifest = {
  name: "opencode",
  harnessDir: ".opencode",
  orchestratorSkillPath: ".opencode/plugins/loeyae-aidlc.js",

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
    { src: "templates", dst: "templates" },
    { src: "skills", dst: "skills" },
  ],

  harnessFiles: [
    { src: "plugins/loeyae-aidlc.js", dst: "plugins/loeyae-aidlc.js" },
    { src: "INSTALL.md", dst: "INSTALL.md" },
  ],

  plugin: { manifestDir: ".opencode-plugin", kind: "opencode" },
};

export default manifest;
