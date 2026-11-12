/** Opt-in CR execution observations. Admission and stage publication remain with their callers. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { sealPhaseExecution, verifyPhaseExecution } from "./aidlc-grant-store";

export interface PhaseReuse {
  version: "1";
  cr_id: string;
  units: string[];
  max_age_ms: number;
  isolation: "read-only";
}
export interface PhaseExecution {
  argv: string[]; cwd: string; timeout_ms: number; env: NodeJS.ProcessEnv;
}
export const observationHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function parsePhaseReuse(value: unknown): PhaseReuse {
  const row = value as Partial<PhaseReuse>;
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(key => !["version", "cr_id", "units", "max_age_ms", "isolation"].includes(key))
    || row.version !== "1" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(String(row.cr_id || ""))
    || !Array.isArray(row.units) || !row.units.length || row.units.length > 256 || row.units.some(unit => !/^[a-z0-9][a-z0-9-]*$/.test(unit))
    || new Set(row.units).size !== row.units.length || row.isolation !== "read-only"
    || !Number.isSafeInteger(row.max_age_ms) || row.max_age_ms! < 1 || row.max_age_ms! > 86400000) throw Error("CR_OBSERVATION_CONFIG_INVALID: explicit CR, units, read-only isolation and max_age_ms <= 24h required");
  return { ...row, units: [...row.units].sort() } as PhaseReuse;
}
export function localObservationFile(root: string, label: string): string {
  const file = resolve(root, label), rel = relative(root, file);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw Error("CR_OBSERVATION_PATH_ESCAPE");
  let cursor = resolve(root);
  for (const part of rel.split(sep)) { cursor = join(cursor, part); if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw Error("CR_OBSERVATION_SYMLINK"); }
  return file;
}
function executable(argv0: string, cwd: string, env: NodeJS.ProcessEnv): string {
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === "PATH");
  const paths = argv0.includes("/") || argv0.includes("\\") ? [resolve(cwd, argv0)]
    : (env[pathKey || "PATH"] || "").split(delimiter).flatMap(directory => process.platform === "win32"
      ? ["", ...(env.PATHEXT || ".EXE;.CMD;.BAT").split(";")].map(ext => join(directory, argv0 + ext)) : [join(directory, argv0)]);
  const found = paths.find(file => existsSync(file) && lstatSync(file).isFile());
  if (!found) throw Error("CR_OBSERVATION_EXECUTABLE_UNKNOWN: " + argv0);
  return realpathSync(found);
}
export function phaseObservationBinding(root: string, reuse: PhaseReuse, execution: PhaseExecution, inputs: unknown) {
  const binary = executable(execution.argv[0], execution.cwd, execution.env);
  return { version: "1", cr: reuse, root: realpathSync(root), cwd: realpathSync(execution.cwd), phase: "GREEN",
    argv: execution.argv, timeout_ms: execution.timeout_ms, inputs,
    environment_digest: observationHash(JSON.stringify(Object.entries(execution.env).sort(([a], [b]) => a.localeCompare(b)))),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, binary, binary_sha256: observationHash(readFileSync(binary)),
      executor_sha256: observationHash(readFileSync(fileURLToPath(import.meta.url))) } };
}
export interface PhaseObservationRef { version: "1"; path: string; sha256: string; observation_id: string; executed_at: string; key: string; reused: boolean; }
export function phaseObservationPath(key: string): string { return `.aidlc/phase-observations/${key}.json`; }
export function loadPhaseObservation(root: string, binding: unknown, now = Date.now()): any | undefined {
  const key = observationHash(JSON.stringify(binding)), path = localObservationFile(root, phaseObservationPath(key));
  if (!existsSync(path)) return undefined;
  // An existing corrupt observation is a diagnosis, never a reason to silently rerun a side effect.
  let pointer: any;
  try { if (lstatSync(path).size > 4096) throw Error(); pointer = JSON.parse(readFileSync(path, "utf8")); } catch { throw Error("CR_OBSERVATION_CORRUPT: index invalid"); }
  if (pointer.version !== "1" || !/^\.aidlc\/phase-observations\/records\/[a-f0-9-]{36}\.json$/.test(pointer.path) || !/^[a-f0-9]{64}$/.test(pointer.sha256)) throw Error("CR_OBSERVATION_CORRUPT: index invalid");
  const recordPath = localObservationFile(root, pointer.path);
  if (!existsSync(recordPath)) throw Error("CR_OBSERVATION_CORRUPT: raw result missing");
  if (lstatSync(recordPath).size > 16 * 1024 * 1024) throw Error("CR_OBSERVATION_TOO_LARGE");
  const bytes = readFileSync(recordPath);
  if (observationHash(bytes) !== pointer.sha256) throw Error("CR_OBSERVATION_CORRUPT: raw digest mismatch");
  let saved: any; try { saved = JSON.parse(bytes.toString("utf8")); } catch { throw Error("CR_OBSERVATION_CORRUPT"); }
  try { verifyPhaseExecution(root, saved); } catch { throw Error("CR_OBSERVATION_CORRUPT: execution signature invalid"); }
  if (saved.version !== "1" || saved.producer !== "loeyae-aidlc-evidence" || !/^[a-f0-9-]{36}$/.test(saved.observation_id)
    || JSON.stringify(saved.binding) !== JSON.stringify(binding) || saved.key !== key || saved.exit_code !== 0
    || typeof saved.stdout !== "string" || typeof saved.stderr !== "string" || !Number.isFinite(saved.duration_ms) || saved.duration_ms < 0
    || !Number.isFinite(Date.parse(saved.executed_at)) || !Number.isFinite(Date.parse(saved.completed_at))
    || Date.parse(saved.completed_at) < Date.parse(saved.executed_at) || Date.parse(saved.completed_at) > now) throw Error("CR_OBSERVATION_CORRUPT");
  let maxAge = saved.binding.cr.max_age_ms;
  const freshness = saved.binding.inputs?.freshness;
  if (freshness) {
    if (freshness.kind !== "external" || !Number.isSafeInteger(freshness.max_age_ms) || freshness.max_age_ms < 0) throw Error("CR_OBSERVATION_CORRUPT: invalid environment freshness");
    maxAge = Math.min(maxAge, freshness.max_age_ms);
  }
  if (now - Date.parse(saved.executed_at) > maxAge) return undefined;
  return { saved, ref: { version: "1", path: pointer.path, sha256: observationHash(bytes), observation_id: saved.observation_id,
    executed_at: saved.executed_at, key, reused: true } as PhaseObservationRef };
}
export function executePhaseObservation(execution: PhaseExecution) {
  const started = Date.now();
  const result = spawnSync(execution.argv[0], execution.argv.slice(1), { cwd: execution.cwd, env: execution.env, timeout: execution.timeout_ms,
    encoding: "utf8", shell: false, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return { result, duration_ms: Date.now() - started, executed_at: new Date(started).toISOString(), completed_at: new Date().toISOString() };
}
export function newPhaseObservation(root: string, binding: unknown, run: ReturnType<typeof executePhaseObservation>) {
  const key = observationHash(JSON.stringify(binding));
  const saved = sealPhaseExecution(root, { schema: "aidlc.phase-execution/v1", version: "1", producer: "loeyae-aidlc-evidence", key, binding, observation_id: randomUUID(), executed_at: run.executed_at,
    completed_at: run.completed_at, duration_ms: run.duration_ms, exit_code: run.result.status, stdout: run.result.stdout || "", stderr: run.result.stderr || "" });
  const bytes = JSON.stringify(saved, null, 2) + "\n";
  return { saved, bytes, ref: { version: "1", path: `.aidlc/phase-observations/records/${saved.observation_id}.json`, key, sha256: observationHash(bytes), observation_id: saved.observation_id, executed_at: saved.executed_at, reused: false } as PhaseObservationRef };
}
/** Exact supplemental tests are supplied by the existing runner, not inferred from a tag. */
export function regressionCoverageErrors(required: string[], payload: Record<string, any>): string[] {
  if (!required.length) return [];
  const actual = payload.regression_test_methods;
  return !Array.isArray(actual) || required.some(method => !actual.includes(method))
    ? ["CR_REGRESSION_COVERAGE_MISSING: runner must report all selected regression_test_methods"] : [];
}
