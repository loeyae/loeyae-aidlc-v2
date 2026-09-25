import { createHash, randomBytes } from "crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GRAPH_PATH = join(PACKAGE_ROOT, "core", "tools", "data", "stage-graph.json");
const EXTENSION_ROOT = join(".aidlc", "extensions");
const MANIFEST_FILE = "aidlc-extension.json";
const OWNERSHIP_FILE = "ownership.json";
const PROJECTION_FILE = "projection.json";
const MAX_FILES = 2_000;
const SAFE_NAME = /^[a-z][a-z0-9-]{1,62}$/;
const SAFE_ID = /^[a-z][a-z0-9-]{0,62}$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PHASES = new Set(["ideation", "inception", "construction", "operation"]);
const AXES = new Set(["project", "module", "unit"]);
const SCOPES = new Set(["feature", "enterprise", "mvp", "classic", "express", "workshop", "bugfix", "refactor", "poc"]);
const BLOCKED_FIELDS = new Set([
  "approval",
  "completion_contract",
  "condition",
  "requires",
  "requires_stage",
  "runtime_command",
  "tool",
  "command",
  "script",
]);

export interface ExtensionStage {
  slug: string;
  phase: string;
  axis: "project" | "module" | "unit";
  scopes: string[];
  produces: string[];
  consumes: string[];
  sensors: string[];
}

export interface ExtensionContribution {
  target: string;
  produces: string[];
  consumes: string[];
  sensors: string[];
  fragments: string[];
}

export interface RestrictedExtensionManifest {
  schema_version: 1;
  kind: "aidlc.restricted-extension";
  name: string;
  version: string;
  stages: ExtensionStage[];
  contributions: ExtensionContribution[];
  advisory_sensors: Array<{ id: string; description: string }>;
}

interface GraphStage {
  slug: string;
  produces: string[];
}

interface ManagedEntry {
  path: string;
  sha256: string;
}

interface OwnershipRecord {
  schema_version: 1;
  kind: "aidlc.extension.ownership";
  name: string;
  source_sha256: string;
  entries: ManagedEntry[];
}

export interface ExtensionValidationResult {
  valid: true;
  manifest: RestrictedExtensionManifest;
  source_sha256: string;
  source_files: string[];
  graph_closure: { producer_count: number; checked_consumes: number };
}

export interface ExtensionComposeResult {
  status: "composed" | "unchanged";
  name: string;
  target: string;
  source_sha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (BLOCKED_FIELDS.has(key)) throw new Error(`${field} cannot declare restricted field ${key}`);
    if (!known.has(key)) throw new Error(`${field} has unknown field ${key}`);
  }
}

function safeName(value: unknown, field: string): string {
  const name = text(value, field);
  if (!SAFE_NAME.test(name) || name === "core" || name === "aidlc") throw new Error(`${field} must be a non-reserved kebab-case extension name`);
  return name;
}

function safeId(value: unknown, field: string): string {
  const id = text(value, field);
  if (!SAFE_ID.test(id)) throw new Error(`${field} must be kebab-case`);
  return id;
}

function unique(values: string[], field: string): string[] {
  if (new Set(values).size !== values.length) throw new Error(`${field} contains duplicates`);
  return values;
}

function stringList(value: unknown, field: string): string[] {
  return unique(array(value, field).map((item, index) => text(item, `${field}[${index}]`)), field);
}

function safeArtifact(value: string, field: string): string {
  const path = value.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = path.split("/");
  if (!path || path.startsWith("/") || path.includes("\0") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${field} must be a safe relative artifact path`);
  }
  return path;
}

function extensionArtifact(value: string, extension: string, field: string): string {
  const path = safeArtifact(value, field);
  const prefix = `.aidlc/extensions/${extension}/`;
  if (!path.startsWith(prefix)) throw new Error(`${field} must be namespaced under ${prefix}`);
  return path;
}

function parseStage(value: unknown, extension: string, index: number): ExtensionStage {
  const field = `stages[${index}]`;
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  exact(value, ["slug", "phase", "axis", "scopes", "produces", "consumes", "sensors"], field);
  const slug = safeId(value.slug, `${field}.slug`);
  if (!slug.startsWith(`${extension}-`)) throw new Error(`${field}.slug must start with ${extension}-`);
  const phase = text(value.phase, `${field}.phase`);
  if (!PHASES.has(phase)) throw new Error(`${field}.phase is invalid`);
  const axis = text(value.axis, `${field}.axis`);
  if (!AXES.has(axis)) throw new Error(`${field}.axis is invalid`);
  const scopes = stringList(value.scopes, `${field}.scopes`);
  if (scopes.some((scope) => !SCOPES.has(scope))) throw new Error(`${field}.scopes contains an unsupported scope`);
  return {
    slug,
    phase,
    axis: axis as ExtensionStage["axis"],
    scopes,
    produces: unique(stringList(value.produces, `${field}.produces`).map((item, itemIndex) => extensionArtifact(item, extension, `${field}.produces[${itemIndex}]`)), `${field}.produces`),
    consumes: unique(stringList(value.consumes, `${field}.consumes`).map((item, itemIndex) => safeArtifact(item, `${field}.consumes[${itemIndex}]`)), `${field}.consumes`),
    sensors: stringList(value.sensors, `${field}.sensors`).map((sensor, sensorIndex) => safeId(sensor, `${field}.sensors[${sensorIndex}]`)),
  };
}

function parseContribution(value: unknown, extension: string, index: number): ExtensionContribution {
  const field = `contributions[${index}]`;
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  exact(value, ["target", "produces", "consumes", "sensors", "fragments"], field);
  return {
    target: safeId(value.target, `${field}.target`),
    produces: unique(stringList(value.produces, `${field}.produces`).map((item, itemIndex) => extensionArtifact(item, extension, `${field}.produces[${itemIndex}]`)), `${field}.produces`),
    consumes: unique(stringList(value.consumes, `${field}.consumes`).map((item, itemIndex) => safeArtifact(item, `${field}.consumes[${itemIndex}]`)), `${field}.consumes`),
    sensors: stringList(value.sensors, `${field}.sensors`).map((sensor, sensorIndex) => safeId(sensor, `${field}.sensors[${sensorIndex}]`)),
    fragments: stringList(value.fragments, `${field}.fragments`),
  };
}

export function parseRestrictedExtensionManifest(value: unknown): RestrictedExtensionManifest {
  if (!isRecord(value)) throw new Error("extension manifest must be an object");
  exact(value, ["schema_version", "kind", "name", "version", "stages", "contributions", "advisory_sensors"], "extension manifest");
  if (value.schema_version !== 1) throw new Error("extension manifest schema_version must be 1");
  if (value.kind !== "aidlc.restricted-extension") throw new Error('extension manifest kind must be "aidlc.restricted-extension"');
  const name = safeName(value.name, "extension manifest.name");
  const version = text(value.version, "extension manifest.version");
  if (!SEMVER.test(version)) throw new Error("extension manifest.version must be semver");
  const stages = array(value.stages, "extension manifest.stages").map((stage, index) => parseStage(stage, name, index));
  unique(stages.map((stage) => stage.slug), "extension manifest.stages");
  const contributions = array(value.contributions, "extension manifest.contributions").map((entry, index) => parseContribution(entry, name, index));
  unique(contributions.map((entry) => entry.target), "extension manifest.contributions");
  const advisorySensors = array(value.advisory_sensors, "extension manifest.advisory_sensors").map((entry, index) => {
    const field = `extension manifest.advisory_sensors[${index}]`;
    if (!isRecord(entry)) throw new Error(`${field} must be an object`);
    exact(entry, ["id", "description"], field);
    const id = safeId(entry.id, `${field}.id`);
    if (!id.startsWith(`${name}-`)) throw new Error(`${field}.id must start with ${name}-`);
    return { id, description: text(entry.description, `${field}.description`) };
  });
  unique(advisorySensors.map((sensor) => sensor.id), "extension manifest.advisory_sensors");
  return { schema_version: 1, kind: "aidlc.restricted-extension", name, version, stages, contributions, advisory_sensors: advisorySensors };
}

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function regularDirectory(path: string, label: string): string {
  const candidate = resolve(path);
  if (!existsSync(candidate)) throw new Error(`${label} does not exist: ${candidate}`);
  const stat = lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink directory: ${candidate}`);
  return candidate;
}

function safeRelative(value: string, label: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return normalized;
}

function sourceFiles(root: string): Array<{ relative: string; absolute: string }> {
  const files: Array<{ relative: string; absolute: string }> = [];
  const visit = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`extension source cannot contain symlinks: ${absolute}`);
      if (stat.isDirectory()) {
        if (prefix === "" && entry.name !== "stages" && entry.name !== "knowledge") {
          throw new Error(`extension source has unsupported top-level directory: ${entry.name}`);
        }
        visit(absolute, relativePath);
      } else if (stat.isFile()) {
        if (relativePath !== MANIFEST_FILE && !relativePath.startsWith("stages/") && !relativePath.startsWith("knowledge/")) {
          throw new Error(`extension source has unsupported file: ${relativePath}`);
        }
        if (relativePath !== MANIFEST_FILE && !relativePath.endsWith(".md")) {
          throw new Error(`extension source content must be Markdown: ${relativePath}`);
        }
        if (files.length >= MAX_FILES) throw new Error(`extension source exceeds ${MAX_FILES} files`);
        files.push({ relative: safeRelative(relativePath, "extension source path"), absolute });
      } else {
        throw new Error(`extension source has unsupported entry: ${absolute}`);
      }
    }
  };
  visit(root, "");
  if (!files.some((entry) => entry.relative === MANIFEST_FILE)) throw new Error(`extension source is missing ${MANIFEST_FILE}`);
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceDigest(files: readonly { relative: string; absolute: string }[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relative).update("\0").update(readFileSync(file.absolute)).update("\0");
  }
  return hash.digest("hex");
}

function coreGraphArtifact(value: unknown, field: string): string {
  const path = text(value, field).replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.startsWith("/") || path.includes("\0") || path.split("/").some((segment) => segment === "..")) {
    throw new Error(`${field} is not a safe core graph artifact path`);
  }
  return path;
}

function graphStages(): GraphStage[] {
  const raw = JSON.parse(readFileSync(GRAPH_PATH, "utf8")) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw.stages)) throw new Error("core stage graph is invalid");
  return raw.stages.map((value, index) => {
    if (!isRecord(value)) throw new Error(`core graph stage ${index} is invalid`);
    return {
      slug: safeId(value.slug, `core graph stages[${index}].slug`),
      produces: Array.isArray(value.produces) ? value.produces.map((item, itemIndex) => coreGraphArtifact(item, `core graph stages[${index}].produces[${itemIndex}]`)) : [],
    };
  });
}

function checkGraphClosure(manifest: RestrictedExtensionManifest): { producer_count: number; checked_consumes: number } {
  const core = graphStages();
  const targets = new Set(core.map((stage) => stage.slug));
  for (const contribution of manifest.contributions) {
    if (!targets.has(contribution.target)) throw new Error(`extension contribution target does not exist in core graph: ${contribution.target}`);
  }
  const producers = new Set<string>();
  for (const stage of core) for (const produced of stage.produces) producers.add(produced);
  for (const stage of manifest.stages) for (const produced of stage.produces) producers.add(produced);
  for (const contribution of manifest.contributions) for (const produced of contribution.produces) producers.add(produced);
  const consumers = [
    ...manifest.stages.flatMap((stage) => stage.consumes),
    ...manifest.contributions.flatMap((contribution) => contribution.consumes),
  ];
  for (const consume of consumers) {
    if (!producers.has(consume)) throw new Error(`extension graph closure failed: no core or extension stage produces required artifact ${consume}`);
  }
  return { producer_count: producers.size, checked_consumes: consumers.length };
}

function loadSource(source: string): { root: string; files: Array<{ relative: string; absolute: string }>; manifest: RestrictedExtensionManifest; source_sha256: string } {
  const root = regularDirectory(source, "extension source");
  const files = sourceFiles(root);
  const manifestFile = files.find((entry) => entry.relative === MANIFEST_FILE)!;
  const manifest = parseRestrictedExtensionManifest(JSON.parse(readFileSync(manifestFile.absolute, "utf8")) as unknown);
  return { root, files, manifest, source_sha256: sourceDigest(files) };
}

export function validateRestrictedExtension(source: string): ExtensionValidationResult {
  const loaded = loadSource(source);
  return {
    valid: true,
    manifest: loaded.manifest,
    source_sha256: loaded.source_sha256,
    source_files: loaded.files.map((file) => file.relative),
    graph_closure: checkGraphClosure(loaded.manifest),
  };
}

function atomicWrite(path: string, content: string): void {
  const temp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(temp, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function copySource(files: readonly { relative: string; absolute: string }[], target: string): void {
  for (const file of files) {
    const destination = join(target, "content", ...file.relative.split("/"));
    if (!inside(target, destination)) throw new Error(`extension destination escapes target: ${file.relative}`);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(file.absolute, destination);
  }
}

function managedEntries(root: string): ManagedEntry[] {
  const entries: ManagedEntry[] = [];
  const visit = (directory: string, prefix: string): void => {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, item.name);
      const relativePath = prefix ? `${prefix}/${item.name}` : item.name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`managed extension cannot contain symlinks: ${absolute}`);
      if (stat.isDirectory()) visit(absolute, relativePath);
      else if (stat.isFile() && relativePath !== OWNERSHIP_FILE) entries.push({ path: safeRelative(relativePath, "managed extension path"), sha256: sha256(readFileSync(absolute)) });
      else if (!stat.isFile()) throw new Error(`managed extension contains unsupported entry: ${absolute}`);
    }
  };
  visit(root, "");
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function readOwnership(target: string): OwnershipRecord {
  const path = join(target, OWNERSHIP_FILE);
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(value) || value.schema_version !== 1 || value.kind !== "aidlc.extension.ownership") throw new Error(`extension ownership record is invalid: ${path}`);
  const name = safeName(value.name, "extension ownership.name");
  const sourceHash = text(value.source_sha256, "extension ownership.source_sha256");
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error("extension ownership.source_sha256 must be a SHA-256 digest");
  const entries = array(value.entries, "extension ownership.entries").map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`extension ownership.entries[${index}] must be an object`);
    exact(entry, ["path", "sha256"], `extension ownership.entries[${index}]`);
    const pathValue = safeRelative(text(entry.path, `extension ownership.entries[${index}].path`), `extension ownership.entries[${index}].path`);
    const hash = text(entry.sha256, `extension ownership.entries[${index}].sha256`);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`extension ownership.entries[${index}].sha256 must be a SHA-256 digest`);
    return { path: pathValue, sha256: hash };
  });
  return { schema_version: 1, kind: "aidlc.extension.ownership", name, source_sha256: sourceHash, entries: entries.sort((left, right) => left.path.localeCompare(right.path)) };
}

function verifyManagedTarget(target: string, expectedName?: string): OwnershipRecord {
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`managed extension target must be a regular non-symlink directory: ${target}`);
  const ownership = readOwnership(target);
  if (expectedName && ownership.name !== expectedName) throw new Error(`managed extension ownership name mismatch: ${target}`);
  const actual = managedEntries(target);
  if (JSON.stringify(actual) !== JSON.stringify(ownership.entries)) throw new Error(`managed extension was modified; refusing to replace: ${target}`);
  return ownership;
}

function acquireLock(directory: string): { path: string; fd: number } {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, ".extension.lock");
  const started = Date.now();
  while (true) {
    try {
      return { path, fd: openSync(path, "wx", 0o600) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - started > 3_000) throw new Error(`timed out waiting for extension lock: ${path}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

function releaseLock(lock: { path: string; fd: number }): void {
  closeSync(lock.fd);
  if (existsSync(lock.path)) unlinkSync(lock.path);
}

export function composeRestrictedExtension(source: string, projectRoot = process.cwd()): ExtensionComposeResult {
  const loaded = loadSource(source);
  const closure = checkGraphClosure(loaded.manifest);
  void closure;
  const root = regularDirectory(projectRoot, "project root");
  const parent = resolve(root, EXTENSION_ROOT);
  if (!inside(root, parent)) throw new Error("extension root escapes project root");
  const target = join(parent, loaded.manifest.name);
  const lock = acquireLock(parent);
  let staging: string | undefined;
  let backup: string | undefined;
  try {
    if (existsSync(target)) {
      const existing = verifyManagedTarget(target, loaded.manifest.name);
      if (existing.source_sha256 === loaded.source_sha256) {
        return { status: "unchanged", name: loaded.manifest.name, target, source_sha256: loaded.source_sha256 };
      }
    }
    staging = join(parent, `.${loaded.manifest.name}.stage-${process.pid}-${randomBytes(4).toString("hex")}`);
    mkdirSync(staging, { mode: 0o700 });
    copySource(loaded.files, staging);
    const projection = {
      schema_version: 1,
      kind: "aidlc.restricted-extension.projection",
      authoritative: false,
      name: loaded.manifest.name,
      version: loaded.manifest.version,
      source_sha256: loaded.source_sha256,
      stages: loaded.manifest.stages,
      contributions: loaded.manifest.contributions,
      advisory_sensors: loaded.manifest.advisory_sensors,
      graph_closure: closure,
      restrictions: [
        "does not modify workflow state, approval, completion contracts, or controlled semantic Evidence",
        "does not activate extension stages in the canonical workflow graph",
        "extension-provided sensors are advisory only and never become controlled Evidence producers",
      ],
    };
    atomicWrite(join(staging, PROJECTION_FILE), `${JSON.stringify(projection, null, 2)}\n`);
    const ownership: OwnershipRecord = {
      schema_version: 1,
      kind: "aidlc.extension.ownership",
      name: loaded.manifest.name,
      source_sha256: loaded.source_sha256,
      entries: managedEntries(staging),
    };
    atomicWrite(join(staging, OWNERSHIP_FILE), `${JSON.stringify(ownership, null, 2)}\n`);
    if (existsSync(target)) {
      backup = join(parent, `.${loaded.manifest.name}.backup-${process.pid}-${randomBytes(4).toString("hex")}`);
      renameSync(target, backup);
    }
    renameSync(staging, target);
    staging = undefined;
    if (backup && existsSync(backup)) rmSync(backup, { recursive: true, force: true });
    return { status: "composed", name: loaded.manifest.name, target, source_sha256: loaded.source_sha256 };
  } catch (error) {
    if (staging && existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (backup && existsSync(backup) && !existsSync(target)) renameSync(backup, target);
    throw error;
  } finally {
    releaseLock(lock);
  }
}

export function inspectRestrictedExtension(name: string, projectRoot = process.cwd()): Record<string, unknown> {
  const root = regularDirectory(projectRoot, "project root");
  const safe = safeName(name, "extension name");
  const target = join(root, EXTENSION_ROOT, safe);
  if (!existsSync(target)) throw new Error(`managed extension is not installed: ${safe}`);
  const ownership = verifyManagedTarget(target, safe);
  const projection = JSON.parse(readFileSync(join(target, PROJECTION_FILE), "utf8")) as unknown;
  if (!isRecord(projection) || projection.kind !== "aidlc.restricted-extension.projection") throw new Error(`extension projection is invalid: ${target}`);
  return { status: "current", target, ownership, projection };
}

function usage(): void {
  process.stdout.write("Usage: loeyae-aidlc extension <validate|compose|status> <source-or-name> [--project <path>]\n");
}

function main(): void {
  const [command, subject, ...rest] = process.argv.slice(2);
  if (command === "--help" || command === "-h" || !command) {
    usage();
    return;
  }
  if (!subject) throw new Error(`extension ${command} requires a source path or extension name`);
  let project: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    if (rest[index] !== "--project" || !rest[index + 1]) throw new Error(`unknown extension argument: ${rest[index]}`);
    project = rest[++index];
  }
  if (command === "validate") {
    process.stdout.write(`${JSON.stringify(validateRestrictedExtension(subject), null, 2)}\n`);
  } else if (command === "compose") {
    process.stdout.write(`${JSON.stringify(composeRestrictedExtension(subject, project), null, 2)}\n`);
  } else if (command === "status") {
    process.stdout.write(`${JSON.stringify(inspectRestrictedExtension(subject, project), null, 2)}\n`);
  } else {
    throw new Error(`unknown extension command: ${command}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Extension command blocked: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
