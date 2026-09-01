/**
 * Harness manifest types — defines the contract for each platform distribution.
 *
 * Each harness implements this interface to declare how core/ artifacts map
 * into that platform's filesystem layout.
 */

export interface CoreDirMapping {
  /** Source directory under core/ */
  src: string;
  /** Destination directory under the harness output dir */
  dst: string;
}

export interface HarnessFile {
  /** Source file relative to harness/<name>/ */
  src: string;
  /** Destination file relative to the harness output dir */
  dst: string;
  /** If true, file lands at the project root (outside the harness dir) */
  projectRoot?: boolean;
}

export interface PluginConfig {
  /** Directory inside a plugin package that holds the harness-specific manifest */
  manifestDir: string;
  /** Plugin kind identifier for this harness */
  kind: string;
}

export interface HarnessManifest {
  /** Harness identifier (for example kiro-cli, claude, codebuddy, qoder, or zcode) */
  name: string;
  /** Target directory name in the user's project (e.g. .kiro, .claude) */
  harnessDir: string;
  /** Path to the orchestrator SKILL.md within the dist output */
  orchestratorSkillPath: string;

  /** Core directories to copy from core/ into dist/<harness>/<harnessDir>/ */
  coreDirs: CoreDirMapping[];
  /** Harness-authored files (not from core/) to copy into dist */
  harnessFiles: HarnessFile[];

  /** Plugin configuration for this harness */
  plugin?: PluginConfig;
}
