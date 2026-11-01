import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { sessionBinding, withSessionPublication, type WorkflowRef } from "./aidlc-light-state";

export type RepairCategory = "mapping" | "phase-evidence-stale" | "test-missing" | "test-failed" | "permission-state" | "artifact-stale" | "unknown";
export interface RepairGuidance {
  version: "1";
  category: RepairCategory;
  fingerprint: string;
  unchanged_attempts: number;
  action: "repair" | "diagnose";
  next_step: string;
  equivalent_retry_allowed: boolean;
  persistence: "recorded" | "read-only" | "unavailable";
}

export function classifyRepair(message: string): { category: RepairCategory; next_step: string } {
  if (/claim|session binding|bind the exact|generation.*mismatch|revision conflict|permission|unauthori[sz]|owner.*mismatch|stage mismatch/i.test(message)) return { category: "permission-state", next_step: "Inspect the exact workflow instance and current claim; bind or recover that state before retrying. Do not change tests." };
  if (/PHASE_INPUT_BINDING|(?:red|green|baseline)-test-evidence[^\n]*(?:source_revision|stale|epoch|allowlist|observed_command)|(?:RED|GREEN|BASELINE)[^\n]*(?:scope_digest|worktree_digest|epoch)/i.test(message)) return { category: "phase-evidence-stale", next_step: "Compare the named observation, command, selected I13 sources and test inputs. If current GREEN inputs changed, rerun only the affected allowlisted GREEN command once. For historical RED/BASELINE, preserve the original evidence and recover only the affected observation through controlled historical recovery. Do not add tests to repair metadata." };
  // Specific phase causes take precedence over wrappers such as "test-quality
  // failed". Producer tail output may retain only the phase path and recovery hint.
  if (/(?:red|green|baseline)-test-evidence[^\n]*(?:not found|missing|Run the controlled evidence producer first)|(?:Evidence not found|missing)[^\n]*(?:red|green|baseline)-test-evidence|(?:RED|GREEN|BASELINE)[^\n]*evidence[^\n]*missing/i.test(message)) return { category: "test-missing", next_step: "Run the single missing allowlisted phase observation using the existing approved tests; do not generate additional tests merely because evidence is absent." };
  if (/tests_failed|compile_status|environment_status|failure_class|controlled (?:RED|GREEN|BASELINE) command|\bAssertionError\b|\btests?\s+(?:(?:suite|assertion)\s+)?failed\b|status must be passed/i.test(message)) return { category: "test-failed", next_step: "Inspect the actual failing test output and distinguish behavior, build and environment failures; fix the smallest proven cause, then rerun that command once." };
  if (/UC-D.*(?:mapping|归属)|uc_mapping|ucd_units|unit_refs|source_coverage|mapping_debt|mapping_deferred/i.test(message)) return { category: "mapping", next_step: "Inspect only the named UC-D declarations and existing controlled phase mappings; reuse a proven mapping or fix its explicit ownership. Add a test only for a concrete uncovered behavior." };
  if (/SLICE_|CONTRACT_|scope_digest|worktree_digest|canonical consumed|produces|artifact|evidence.*(?:stale|rejected|invalid)/i.test(message)) return { category: "artifact-stale", next_step: "Compare the named canonical artifact and its derived evidence; refresh only that stale derivation under the current claim, then recheck its gate." };
  return { category: "unknown", next_step: "Diagnose the first named failing gate from its original output and required inputs. Do not infer missing tests or widen the task without evidence." };
}

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const regular = (path: string): void => {
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile())) throw new Error(`repair journal requires a regular file: ${path}`);
};
function journalPath(root: string, workflowId: string, instanceId: string): string {
  return join(root, ".aidlc", "continuation", `${digest(`${workflowId}\n${instanceId}`)}.json`);
}
function directory(path: string): void {
  if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) throw new Error(`repair journal requires a regular directory: ${path}`);
  } else mkdirSync(path);
}

function inputDigest(root: string, label: string): string {
  const path = resolve(root, label), rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return "outside-project";
  let cursor = root;
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part);
    if (!existsSync(cursor)) return "absent";
    if (lstatSync(cursor).isSymbolicLink()) return "symlink";
  }
  regular(path);
  return lstatSync(path).size <= 1024 * 1024 ? digest(readFileSync(path)) : "oversized";
}

/** One bounded control-plane record per instance; never writes business state/history. */
export function repairGuidance(root: string, ref: WorkflowRef, message: string, readOnly = false): RepairGuidance {
  const binding = sessionBinding(), classified = classifyRepair(message);
  // Gate output contains the concrete failed inputs. Commands and observations are
  // also included so replacing evidence resets the counter without a repository scan.
  const named = binding?.stage_instance.match(/^([^@]+)(?:@module:([^@]+))?(?:@unit:([^@]+))?$/);
  const labels = named ? [`.aidlc/commands/${named[1]}.json`, ".aidlc/commands/tdd.json",
    ...["red", "baseline"].map(phase => `.aidlc/evidence/tdd/${named[2]}/${named[3]}/${phase}-test-evidence.json`),
    `.aidlc/evidence/code-generation/${named[2]}/${named[3]}/green-test-evidence.json`,
    `.aidlc/evidence/test-case-derivation/${named[2]}/test-case-derivation.json`] : [];
  const inputs = labels.map(label => {
    const path = join(root, label);
    try {
      const observed = inputDigest(root, label);
      if (!/^[a-f0-9]{64}$/.test(observed) || lstatSync(path).size > 512 * 1024) return [label, observed];
      const record = JSON.parse(readFileSync(path, "utf8"));
      const files = Array.isArray(record.phase_input_binding?.files) ? record.phase_input_binding.files.slice(0, 512) : [];
      return [label, observed, files.map((file: { path?: unknown }) => typeof file.path === "string" ? [file.path, inputDigest(root, file.path)] : ["invalid-input"])];
    }
    catch { return [label, "unreadable"]; }
  });
  const stableMessage = message.replace(/\(\d+h old/gi, "(elapsed-hours old").replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, "<timestamp>");
  const fingerprint = digest(JSON.stringify([binding?.workflow_id, binding?.stage_instance, classified.category, stableMessage, inputs]));
  const guidance: RepairGuidance = { version: "1", ...classified, fingerprint, unchanged_attempts: 1, action: classified.category === "unknown" ? "diagnose" : "repair", equivalent_retry_allowed: false, persistence: readOnly ? "read-only" : "unavailable" };
  if (!binding || readOnly) return guidance;
  try {
    withSessionPublication(root, ref, binding.stage_instance, () => {
      const control = join(root, ".aidlc"), folder = join(control, "continuation");
      directory(control); directory(folder);
      const path = journalPath(root, binding.workflow_id, binding.stage_instance);
      regular(path);
      if (existsSync(path) && lstatSync(path).size <= 16 * 1024) {
        try {
          const prior = JSON.parse(readFileSync(path, "utf8"));
          if (prior.version === "1" && prior.fingerprint === fingerprint) guidance.unchanged_attempts = 2;
        } catch { /* A damaged advisory record cannot authorize or block a gate. */ }
      }
      if (guidance.unchanged_attempts >= 2) {
        guidance.action = "diagnose";
        guidance.next_step = `Same blocker and observation repeated twice. Stop equivalent retries and test expansion; inspect the original failure and take a different diagnostic step. ${classified.next_step}`;
      }
      guidance.persistence = "recorded";
      const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
      try {
        writeFileSync(temporary, `${JSON.stringify({ ...guidance, workflow_id: binding.workflow_id, stage_instance: binding.stage_instance }, null, 2)}\n`, { flag: "wx" });
        renameSync(temporary, path);
      } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    }, binding);
  } catch {
    // Stale/unbound callers cannot publish. Diagnostics are advisory and must not
    // replace the actual gate failure or create another workflow transition.
    guidance.persistence = "unavailable";
  }
  return guidance;
}

/** A passed gate ends the consecutive-failure sequence while the claim is valid. */
export function clearRepairGuidance(root: string, ref: WorkflowRef): void {
  const binding = sessionBinding();
  if (!binding) return;
  try {
    withSessionPublication(root, ref, binding.stage_instance, () => {
      const control = join(root, ".aidlc"), folder = join(control, "continuation");
      if (!existsSync(folder)) return;
      directory(control); directory(folder);
      const path = journalPath(root, binding.workflow_id, binding.stage_instance);
      regular(path);
      if (existsSync(path)) unlinkSync(path);
    }, binding);
  } catch { /* Advisory cleanup cannot turn a passed gate into a new blocker. */ }
}
