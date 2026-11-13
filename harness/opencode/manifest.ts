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
  skillEntryPath: ".opencode/SKILL.md",

  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "knowledge", dst: "knowledge" },
    { src: "skills", dst: "skills" },
  ],

  harnessFiles: [
    { src: "plugins/loeyae-aidlc.js", dst: "plugins/loeyae-aidlc.js" },
    { src: "INSTALL.md", dst: "INSTALL.md" },
  ],

  plugin: { manifestDir: ".opencode-plugin", kind: "opencode" },
};

export default manifest;
