import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { sessionBinding, withSessionPublication, type WorkflowRef } from "./aidlc-light-state";

export type RepairCategory = "input-defect" | "mapping" | "phase-evidence-stale" | "test-missing" | "test-failed" | "permission-state" | "artifact-stale" | "approval-required" | "unknown";
export interface RepairDiagnostic {
  code: string;
  category: RepairCategory;
  stage_instance?: string;
  sensor?: string;
  artifact?: string;
  message: string;
  action: "inspect" | "refresh-evidence" | "run-phase-observation" | "repair-inputs" | "human-approval";
  requires_human_approval: boolean;
  /** Advisory argv only. Approval placeholders never constitute approval or execute a command. */
  command?: string[];
  next_step: string;
}
export interface RepairContext { stage_instance?: string; completed_stage_instances?: readonly string[] }
export interface RepairGuidance {
  version: "1";
  category: RepairCategory;
  fingerprint: string;
  unchanged_attempts: number;
  action: "repair" | "diagnose";
  next_step: string;
  equivalent_retry_allowed: boolean;
  persistence: "recorded" | "read-only" | "unavailable";
  diagnostics: RepairDiagnostic[];
}

export function classifyRepair(message: string): { category: RepairCategory; next_step: string } {
  if (/CR_(?:CANONICAL_SCOPE_INVALID|MODULE_MISMATCH|WORKTREE_|ENGINE_(?:VERSION|CONTENT)_MISMATCH|CONFIG_INVALID|EXTENSION_INVALID|REGRESSION_COVERAGE_MISSING|TEST_IMPACT_INVALID|OBSERVATION_(?:CORRUPT|PAYLOAD_MISMATCH|EXECUTION_MISMATCH|CONFIG_|COVERAGE_MISSING|UNIT_MISMATCH|INVALID))/i.test(message)) return { category: "input-defect", next_step: "Inspect the named CR config, runner output, original execution observation and selected engine. Repair the specific compatibility/coverage/provenance defect; do not refresh the business chain or silently rerun a corrupt observation." };
  if (/CR_OBSERVATION_INPUTS_CHANGED|CR_OBSERVATION_INPUTS_CHANGED_OR_MISSING/i.test(message)) return { category: "phase-evidence-stale", next_step: "Compare the CR execution inputs and child environment; run only the affected declared GREEN command. Preserve the original execution observation and independently requalify each unit." };
  if (/claim|session binding|bind the exact|generation.*mismatch|revision conflict|permission|unauthori[sz]|owner.*mismatch|stage mismatch/i.test(message)) return { category: "permission-state", next_step: "Inspect the exact workflow instance and current claim; bind or recover that state before retrying. Do not change tests." };
  if (/(?:RED|BASELINE)_OMISSION_INVALID|(?:RED|BASELINE) evidence is missing and no approved historical-omission record exists/i.test(message)) return { category: "approval-required", next_step: "Restore the original controlled phase evidence if available. For a historical RED/BASELINE omission, verify the current GREEN, I13 and applicable baseline, obtain explicit human approval, then register or renew the exact unit's phase omission record. Do not manufacture historical observations or reuse an old approval for changed GREEN." };
  if (/PHASE_INPUT_BINDING|(?:red|green|baseline)-test-evidence[^\n]*(?:source_revision|stale|epoch|allowlist|observed_command)|(?:RED|GREEN|BASELINE)[^\n]*(?:scope_digest|worktree_digest|epoch)/i.test(message)) return { category: "phase-evidence-stale", next_step: "Compare the named observation, command, selected I13 sources and test inputs. If current GREEN inputs changed, rerun only the affected allowlisted GREEN command once. For historical RED/BASELINE, preserve the original evidence and recover only the affected observation through controlled historical recovery. Do not add tests to repair metadata." };
  // Specific phase causes take precedence over wrappers such as "test-quality
  // failed". Producer tail output may retain only the phase path and recovery hint.
  if (/(?:red|green|baseline)-test-evidence[^\n]*(?:not found|missing|Run the controlled evidence producer first)|(?:Evidence not found|missing)[^\n]*(?:red|green|baseline)-test-evidence|(?:RED|GREEN|BASELINE)[^\n]*evidence[^\n]*missing/i.test(message)) return { category: "test-missing", next_step: "Run the single missing allowlisted phase observation using the existing approved tests; do not generate additional tests merely because evidence is absent." };
  if (/tests_failed|compile_status|environment_status|failure_class|controlled (?:RED|GREEN|BASELINE) command|\bAssertionError\b|\btests?\s+(?:(?:suite|assertion)\s+)?failed\b|status must be passed/i.test(message)) return { category: "test-failed", next_step: "Inspect the actual failing test output and distinguish behavior, build and environment failures; fix the smallest proven cause, then rerun that command once." };
  if (/UC-D.*(?:mapping|归属)|uc_mapping|ucd_units|unit_refs|source_coverage|mapping_debt|mapping_deferred/i.test(message)) return { category: "mapping", next_step: "Inspect only the named UC-D declarations and existing controlled phase mappings; reuse a proven mapping or fix its explicit ownership. Add a test only for a concrete uncovered behavior." };
  if (/CANONICAL_INPUT_MISSING|CANONICAL_DESIGN_SECTION_REQUIRED|unresolved marker found in project artifact|SLICE_(?:ENCODING|INVALID_ADOPTION|COVERAGE|MAPPING|REQ_RECONCILIATION)\b/i.test(message)) return { category: "input-defect", next_step: "Repair the named canonical input or declaration first. Regenerating evidence from unchanged defective inputs cannot resolve this failure; preserve the original diagnostics and verify only after the input is corrected." };
  if (/SLICE_|CONTRACT_|scope_digest|worktree_digest|canonical consumed|produces|artifact|evidence.*(?:stale|rejected|invalid|missing|not found)/i.test(message)) return { category: "artifact-stale", next_step: "Compare the named canonical artifact and its derived evidence; refresh only that missing or stale derivation under the current claim, then recheck its gate." };
  return { category: "unknown", next_step: "Diagnose the first named failing gate from its original output and required inputs. Do not infer missing tests or widen the task without evidence." };
}

/** Translate actual sensor failures into exact, advisory repair work. */
export function sensorRepairDiagnostics(failures: readonly { sensor?: string; message: string; stage_instance?: string }[], context: RepairContext = {}): RepairDiagnostic[] {
  const diagnostics = failures.map(failure => {
    const classified = classifyRepair(failure.message);
    const path = /\.aidlc[\\/]evidence[\\/]([A-Za-z0-9_-]+)[\\/](?:([A-Za-z0-9_-]+)[\\/](?:([A-Za-z0-9_-]+)[\\/])?)?([A-Za-z0-9_-]+)\.json/.exec(failure.message);
    const named = /^(?<stage>[A-Za-z0-9_-]+)(?:@module:(?<module>[A-Za-z0-9_-]+))?(?:@unit:(?<unit>[A-Za-z0-9_-]+))?$/.exec(failure.stage_instance || context.stage_instance || "")?.groups;
    let stage = path?.[1] || named?.stage, module = path ? path[2] : named?.module, unit = path ? path[3] : named?.unit;
    let sensor = path?.[4] || failure.sensor || /built-in semantic checker ([A-Za-z0-9_-]+) failed/.exec(failure.message)?.[1];
    const omissionPhase = /BASELINE_OMISSION_INVALID|BASELINE evidence is missing and no approved historical-omission record exists/i.test(failure.message) ? "BASELINE" : "RED";
    if (classified.category === "approval-required") { stage = "tdd"; sensor = `${omissionPhase.toLowerCase()}-test-evidence`; }
    else if (!path) {
      const phase = /\b(RED|GREEN|BASELINE)\b|\b(red|green|baseline)-test-evidence/.exec(failure.message);
      if (phase) { const name = (phase[1] || phase[2]).toLowerCase(); sensor = `${name}-test-evidence`; stage = name === "green" ? "code-generation" : "tdd"; }
    }
    const instance = stage ? `${stage}${module ? `@module:${module}` : ""}${unit ? `@unit:${unit}` : ""}` : undefined;
    const diagnostic: RepairDiagnostic = { code: classified.category === "approval-required"
      ? /(?:RED|BASELINE)_OMISSION_INVALID/.test(failure.message) ? `${omissionPhase}_OMISSION_INVALID` : `HISTORICAL_${omissionPhase}_APPROVAL_REQUIRED`
      : classified.category.toUpperCase().replaceAll("-", "_"), ...classified,
      ...(instance ? { stage_instance: instance } : {}), ...(sensor ? { sensor } : {}),
      ...(path ? { artifact: path[0].replace(/\\/g, "/") } : {}), message: failure.message, action: "inspect", requires_human_approval: classified.category === "approval-required" };
    const command = stage && sensor ? ["loeyae-aidlc", "evidence", "run", "--stage", stage, ...(module ? ["--module", module] : []), ...(unit ? ["--unit", unit] : []), "--sensor", sensor] : undefined;
    if (classified.category === "approval-required") {
      diagnostic.action = "human-approval";
      if (command && module && unit) diagnostic.command = [...command, "--refresh", "--historical-omission", "--approval-ref", "<human approval reference>", "--approved-by", "<name>", "--approved-at", "<ISO-8601 with timezone>"];
    } else if (classified.category === "mapping" || classified.category === "input-defect") diagnostic.action = "repair-inputs";
    else if (command && (classified.category === "artifact-stale" || classified.category === "test-missing")) {
      diagnostic.action = classified.category === "test-missing" ? "run-phase-observation" : "refresh-evidence";
      // A stale derivation does not prove that its GREEN input is stale. Keep
      // repair scoped to the named semantics; their producer validates GREEN.
      // A separate phase-input failure must remain a separate stop/diagnosis.
      const completed = Boolean(instance && context.completed_stage_instances?.includes(instance));
      diagnostic.command = [...command, ...(completed && !module ? ["--instance", instance!] : []), ...(completed ? ["--refresh"] : [])];
    }
    return diagnostic;
  });
  // Batch only the failed semantic derivations of one completed instance.
  // Never mix historical phases, approvals, behavior failures or other units.
  // The producer still validates every sensor, claim and publication separately.
  for (const diagnostic of diagnostics) {
    if (diagnostic.action !== "refresh-evidence" || diagnostic.requires_human_approval || !diagnostic.command?.includes("--refresh") || !diagnostic.command.includes("--sensor") || /^(red|green|baseline)-/.test(diagnostic.sensor || "")) continue;
    const siblings = diagnostics.filter(d => d.stage_instance === diagnostic.stage_instance && d.action === "refresh-evidence" && !d.requires_human_approval && d.command?.includes("--refresh") && d.command.includes("--sensor") && d.sensor && !/^(red|green|baseline)-/.test(d.sensor));
    const sensors = [...new Set(siblings.map(d => d.sensor!))];
    if (sensors.length < 2) continue;
    const command = diagnostic.command.slice();
    command.splice(command.indexOf("--sensor"), 2, "--sensors", sensors.join(","));
    for (const sibling of siblings) sibling.command = command.slice();
  }
  return diagnostics;
}

/** Display-only timing cannot distinguish two otherwise equivalent blockers. */
export function stableRepairMessage(message: string): string {
  let stable = message.replace(/\[aidlc\][^\r\n]*(?:\r?\n|$)/g, "");
  // Automatic batches may make progress before the same remaining sensor fails.
  // Producer/checker transport wrappers are not part of that sensor's cause.
  for (const marker of ["Evidence producer blocked:", "Semantic checker blocked:"]) {
    const index = stable.lastIndexOf(marker);
    if (index >= 0) stable = stable.slice(index + marker.length);
  }
  return stable
    .replace(/\(\d+h old/gi, "(elapsed-hours old")
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)/g, "<timestamp>")
    .replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
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
export function repairGuidance(root: string, ref: WorkflowRef, message: string, readOnly = false, failures?: readonly RepairDiagnostic[]): RepairGuidance {
  let binding: ReturnType<typeof sessionBinding>;
  try { binding = sessionBinding(); } catch { binding = undefined; }
  const diagnostics = failures?.length ? [...failures] : sensorRepairDiagnostics([{ message }], { stage_instance: binding?.stage_instance });
  const priority: RepairCategory[] = ["permission-state", "approval-required", "phase-evidence-stale", "test-missing", "test-failed", "mapping", "artifact-stale", "unknown"];
  const primary = [...diagnostics].sort((a, b) => priority.indexOf(a.category) - priority.indexOf(b.category))[0];
  const classified = { category: primary.category, next_step: primary.next_step };
  // Gate output contains the concrete failed inputs. Commands and observations are
  // also included so replacing evidence resets the counter without a repository scan.
  const named = binding?.stage_instance.match(/^([^@]+)(?:@module:([^@]+))?(?:@unit:([^@]+))?$/);
  const labels = [...new Set([...(named ? [`.aidlc/commands/${named[1]}.json`, ".aidlc/commands/tdd.json",
    ...(named[2] && named[3] ? [
    ...["red", "baseline"].map(phase => `.aidlc/evidence/tdd/${named[2]}/${named[3]}/${phase}-test-evidence.json`),
    `.aidlc/evidence/code-generation/${named[2]}/${named[3]}/green-test-evidence.json`] : []),
    ...(named[2] ? [`.aidlc/evidence/test-case-derivation/${named[2]}/test-case-derivation.json`] : [])] : []),
    ...diagnostics.flatMap(diagnostic => diagnostic.artifact ? [diagnostic.artifact] : [])])].sort();
  const inputs = labels.map(label => {
    const path = join(root, label);
    try {
      const observed = inputDigest(root, label);
      if (!/^[a-f0-9]{64}$/.test(observed) || lstatSync(path).size > 512 * 1024) return [label, observed];
      const record = JSON.parse(readFileSync(path, "utf8"));
      const files = [...(Array.isArray(record.phase_input_binding?.files) ? record.phase_input_binding.files : []), ...(Array.isArray(record.i13_binding?.files) ? record.i13_binding.files : [])].slice(0, 512);
      return [label, observed, files.map((file: { path?: unknown }) => typeof file.path === "string" ? [file.path, inputDigest(root, file.path)] : ["invalid-input"])];
    }
    catch { return [label, "unreadable"]; }
  });
  const reasons = diagnostics.map(item => [item.code, item.stage_instance, item.sensor, item.artifact, stableRepairMessage(item.message)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const fingerprint = digest(JSON.stringify([binding?.workflow_id, binding?.stage_instance, reasons, inputs]));
  const guidance: RepairGuidance = { version: "1", ...classified, diagnostics, fingerprint, unchanged_attempts: 1, action: classified.category === "unknown" ? "diagnose" : "repair", equivalent_retry_allowed: false, persistence: readOnly ? "read-only" : "unavailable" };
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
        // Full diagnostics stay in the response; the bounded journal needs only
        // the failure identity and retry state, regardless of log size.
        const { diagnostics: _diagnostics, ...journal } = guidance;
        writeFileSync(temporary, `${JSON.stringify({ ...journal, workflow_id: binding.workflow_id, stage_instance: binding.stage_instance }, null, 2)}\n`, { flag: "wx" });
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
