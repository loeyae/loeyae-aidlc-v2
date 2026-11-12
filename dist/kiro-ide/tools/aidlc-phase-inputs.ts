import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { unitUcdIds } from "./aidlc-execution-context";
import { normalizeUcdSources } from "./aidlc-ucd-declarations";

type RecordValue = Record<string, any>;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Only named inputs are read; historical validation must never search the repository. */
function inputFile(root: string, name: string): string {
  const path = resolve(root, name), rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`phase input escapes project: ${name}`);
  let cursor = root;
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`phase input traverses symlink: ${name}`);
  }
  if (!lstatSync(path).isFile() || relative(realpathSync(root), realpathSync(path)).startsWith(`..${sep}`)) throw new Error(`phase input must be a project file: ${name}`);
  return path;
}

function methodFile(root: string, method: string): string | undefined {
  // Both file#method and file::method are accepted, without reading source trees.
  const name = method.replace(/\\/g, "/").split(/#|::|:\d+(?::\d+)?(?:$|\s)/)[0];
  return name && existsSync(resolve(root, name)) ? relative(root, inputFile(root, name)).replace(/\\/g, "/") : undefined;
}

export interface PhaseInputBinding {
  version: "1";
  i13_digest: string;
  files: Array<{ path: string; sha256: string }>;
  unresolved_test_methods: string[];
  command_digest?: string;
}

export interface PhaseCommandInputs { argv: string[]; cwd?: string; config: string; files?: string[]; projectedConfig?: string; }
const COMMAND_CONTEXT_FILES = ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "tsconfig.json", "jest.config.js", "jest.config.cjs", "jest.config.mjs", "jest.config.ts", "vitest.config.js", "vitest.config.ts", "vitest.config.mts", "pytest.ini", "pyproject.toml", "requirements.txt", "Cargo.toml", "Cargo.lock", "go.mod", "go.sum", "pom.xml", "build.gradle", "build.gradle.kts", "gradle.lockfile"];

/** Bind the original tests and selected I13 semantics, excluding producer timestamps. */
export function phaseInputBinding(root: string, i13: RecordValue, evidence: RecordValue, unitId?: string, command?: PhaseCommandInputs): PhaseInputBinding {
  const selected = i13.status === "required" ? unitUcdIds(i13, unitId).all : [];
  const select = (value: unknown) => Object.fromEntries(Object.entries((value || {}) as RecordValue).filter(([id]) => selected.includes(id)).sort(([a], [b]) => a.localeCompare(b)));
  const sources = (normalizeUcdSources(i13.ucd_sources) || []).filter(source => source.ucd_ids.some(id => selected.includes(id)));
  const paths = new Set<string>([...(Array.isArray(i13.source_files) ? i13.source_files : []), ...sources.map(source => source.file)]);
  const unresolved = new Set<string>();
  if (command) {
    paths.add(relative(root, inputFile(root, command.config)));
    for (const file of command.files || []) paths.add(relative(root, inputFile(root, file)));
    for (const [index, argument] of command.argv.entries()) {
      const value = argument.startsWith("--") && argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : argument;
      const candidate = resolve(command.cwd || root, value);
      const rel = relative(root, candidate);
      // The allowlisted interpreter may live outside the project. Its argv identity
      // remains bound; it must not be mistaken for a project-local script input.
      if (index === 0 && (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))) continue;
      if (existsSync(candidate) && lstatSync(candidate).isFile()) paths.add(relative(root, inputFile(root, candidate)));
    }
    // A fixed list of command/dependency context files, never a repository walk.
    for (const directory of new Set([root, command.cwd || root])) for (const name of COMMAND_CONTEXT_FILES) {
      const candidate = join(directory, name);
      if (existsSync(candidate)) paths.add(relative(root, inputFile(root, candidate)));
    }
  }
  for (const row of Array.isArray(evidence.uc_mapping) ? evidence.uc_mapping : []) {
    for (const method of Array.isArray(row.test_methods) ? row.test_methods : []) {
      if (typeof method !== "string") throw new Error("phase test method must be a string");
      const path = methodFile(root, method);
      if (path) paths.add(path); else unresolved.add(method);
    }
  }
  const semantic = { status: i13.status, ids: [...selected].sort(), modes: select(i13.ucd_modes), units: select(i13.ucd_units),
    sources: sources.map(source => ({ ...source, ucd_ids: source.ucd_ids.filter(id => selected.includes(id)) })),
    deferred: (Array.isArray(i13.mapping_deferred) ? i13.mapping_deferred : []).filter((item: RecordValue) => selected.includes(item.id)),
    applicability: i13.applicability_inputs_digest, exemption: i13.status === "not_applicable" ? { reason: i13.reason, approval_ref: i13.approval_ref, validation_command: i13.validation_command } : undefined };
  const normalizedPaths = [...new Set([...paths].map(path => path.replace(/\\/g, "/")))].sort();
  return { version: "1", i13_digest: hash(JSON.stringify(semantic)), files: normalizedPaths.map(path => {
    const file = inputFile(root, path);
    const bytes = command?.projectedConfig !== undefined && file === inputFile(root, command.config) ? command.projectedConfig : readFileSync(file);
    return { path, sha256: hash(bytes) };
  }), unresolved_test_methods: [...unresolved].sort(), ...(command ? { command_digest: hash(JSON.stringify({ argv: command.argv, cwd: relative(root, command.cwd || root).replace(/\\/g, "/"), config: relative(root, command.config).replace(/\\/g, "/"), files: command.files || [] })) } : {}) };
}

export function historicalPhaseInputErrors(root: string, i13: RecordValue, evidence: RecordValue, unitId?: string, command?: PhaseCommandInputs, requireResolvedTests = true): string[] {
  const binding = evidence.phase_input_binding as PhaseInputBinding | undefined;
  if (!binding) return ["PHASE_INPUT_BINDING_MISSING: legacy historical observation has no selective test/I13 binding; retain the original evidence and diagnose historical recovery before allowing revision drift"];
  try {
    const current = phaseInputBinding(root, i13, evidence, unitId, command);
    if (binding.version !== "1") return ["PHASE_INPUT_BINDING_INVALID: unsupported version"];
    if (requireResolvedTests && current.unresolved_test_methods.length && !command?.files?.length) return ["PHASE_INPUT_BINDING_UNRESOLVED: declare the existing test source/config/helper files in command evidence_inputs.files for symbolic test methods before verifying historical revision drift; do not add tests or rename established test methods"];
    if (JSON.stringify(binding) === JSON.stringify(current)) return [];
    const prior = new Map((Array.isArray(binding.files) ? binding.files : []).map(file => [file.path, file.sha256]));
    const next = new Map(current.files.map(file => [file.path, file.sha256]));
    const changed = [...new Set([...prior.keys(), ...next.keys()])].filter(path => prior.get(path) !== next.get(path)).sort();
    const detail = changed.length ? `; changed inputs: ${changed.slice(0, 16).join(", ")}${changed.length > 16 ? ` (+${changed.length - 16} more)` : ""}` : "; selected I13 semantics or command binding changed";
    return [`PHASE_INPUT_BINDING_CHANGED: original test inputs or selected I13 sources changed; diagnose the affected observation without adding unrelated tests${detail}`];
  } catch (error) { return [`PHASE_INPUT_BINDING_INVALID: ${error instanceof Error ? error.message : String(error)}`]; }
}
