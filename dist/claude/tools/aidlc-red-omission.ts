import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unitUcdIds } from "./aidlc-execution-context";
import { phaseInputBinding } from "./aidlc-phase-inputs";

type RecordValue = Record<string, any>;
export interface OmissionIdentity { workflow_id: string; module_id: string; unit_id: string }
export const RED_OMISSION_LIMITATION = "原始 RED 未登记；以 GREEN 全通过作为验收依据，不宣称原始 RED 存在。";
export type OmissionPhase = "RED" | "BASELINE";
export const BASELINE_OMISSION_LIMITATION = "原始 BASELINE 未登记；未证明实现前特征化测试通过；以当前 GREEN 全通过作为验收依据，不宣称原始 BASELINE 存在。";
export const omissionHash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

export function phaseRecordPath(stage: string, module: string, unit: string, sensor: string): string {
  if (![module, unit].every(value => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value))) throw new Error("historical omission requires exact valid module_id and unit_id");
  return `.aidlc/evidence/${stage}/${module}/${unit}/${sensor}.json`;
}

/** Only canonical, bounded regular files may participate in an approval binding. */
export function omissionFile(root: string, path: string): Buffer {
  let cursor = root;
  for (const part of path.split("/")) {
    if (!part || part === "." || part === ".." || part.includes("\\") || part.includes(":")) throw new Error("invalid historical omission evidence path");
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`historical omission evidence traverses a symlink: ${path}`);
  }
  const stat = lstatSync(cursor);
  if (!stat.isFile() || stat.size > 512 * 1024) throw new Error(`historical omission evidence must be a regular file of at most 512 KiB: ${path}`);
  return readFileSync(cursor);
}

export function tddOmissionRecord(root: string, module: string, unit: string, phase: OmissionPhase): RecordValue | null {
  const path = phaseRecordPath("tdd", module, unit, `${phase.toLowerCase()}-test-evidence`);
  if (!existsSync(join(root, path))) return null;
  const record = JSON.parse(omissionFile(root, path).toString("utf8"));
  return record?.status === "not_recorded" || record?.evidence_mode === "historical_omission" ? record : null;
}

export function omissionRegistrationCommand(module = "<module-id>", unit = "<unit-id>", phase: OmissionPhase = "RED"): string {
  return `loeyae-aidlc evidence run --stage tdd --module ${module} --unit ${unit} --sensor ${phase.toLowerCase()}-test-evidence --refresh --historical-omission --approval-ref "<human approval reference>" --approved-by "<name>" --approved-at "<ISO-8601 with timezone>"`;
}

export function tddOmissionPayload(root: string, identity: OmissionIdentity, i13: RecordValue, approval: RecordValue, phase: OmissionPhase): RecordValue {
  const scope = unitUcdIds(i13, identity.unit_id);
  const path = phaseRecordPath("code-generation", identity.module_id, identity.unit_id, "green-test-evidence");
  return { phase, status: "not_recorded", evidence_mode: "historical_omission", reason_code: "HISTORICAL_OMISSION", ...identity,
    ucd_ids: [...(phase === "RED" ? scope.new : scope.characterization)].sort(), i13_binding: phaseInputBinding(root, i13, {}, identity.unit_id),
    green_evidence: { path, sha256: omissionHash(omissionFile(root, path)) },
    approval_ref: approval.approval_ref, approved_by: approval.approved_by, approved_at: approval.approved_at, limitation: phase === "RED" ? RED_OMISSION_LIMITATION : BASELINE_OMISSION_LIMITATION };
}

/** Checker success verifies the exception; it never claims an original TDD test ran. */
export function tddOmissionDigest(record: RecordValue): string {
  return omissionHash(JSON.stringify([`${record.phase === "BASELINE" ? "BASELINE" : "RED"}-historical-omission-v1`, record.workflow_id, record.module_id, record.unit_id,
    record.ucd_ids, record.i13_binding, record.green_evidence, record.approval_ref, record.approved_by, record.approved_at, record.limitation,
    ...(record.phase === "BASELINE" ? [record.baseline_commit, record.baseline_kind, record.baseline_repos, record.baseline_refs] : [])]));
}

export function tddOmissionErrors(root: string, record: RecordValue, identity: OmissionIdentity, i13: RecordValue, phase: OmissionPhase): string[] {
  const errors: string[] = [];
  const reject = (message: string) => errors.push(`${phase}_OMISSION_INVALID: ${message}`);
  const allowed = new Set(["phase", "status", "evidence_mode", "reason_code", "workflow_id", "module_id", "unit_id", "ucd_ids", "i13_binding", "green_evidence", "approval_ref", "approved_by", "approved_at", "limitation", "stage_instance", "evidence_version", "timestamp", "producer", "source_revision", "checker", "publication_claim", "supersedes"]);
  if (phase === "BASELINE") for (const field of ["baseline_commit", "baseline_kind", "baseline_repos", "baseline_refs"]) allowed.add(field);
  for (const field of Object.keys(record)) if (!allowed.has(field)) reject(`unsupported field ${field}`);
  if (record.phase !== phase || record.status !== "not_recorded" || record.reason_code !== "HISTORICAL_OMISSION" || record.evidence_mode !== "historical_omission") reject("invalid phase, status, reason_code or evidence_mode");
  for (const [key, value] of Object.entries(identity)) if (record[key] !== value) reject(`${key} does not match current workflow/module/unit`);
  for (const key of ["approval_ref", "approved_by"]) if (typeof record[key] !== "string" || !record[key].trim()) reject(`${key} must be non-empty`);
  if (typeof record.approved_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(record.approved_at) || !Number.isFinite(Date.parse(record.approved_at))) reject("approved_at must be an ISO-8601 timestamp with timezone");
  else if (new Date(`${record.approved_at.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== record.approved_at.slice(0, 10)) reject("approved_at contains an invalid calendar date");
  if (record.limitation !== (phase === "RED" ? RED_OMISSION_LIMITATION : BASELINE_OMISSION_LIMITATION)) reject(`limitation must explicitly acknowledge the missing original ${phase}`);
  for (const field of ["observed_command", "failure_class", "failure_signature", "tests_total", "tests_failed", "historical_replay", "code_ref_digests"]) if (record[field] !== undefined) reject(`${field} cannot claim an observed ${phase} in an omission record`);
  try {
    const scope = unitUcdIds(i13, identity.unit_id);
    const mode = phase === "RED" ? "new" : "characterization";
    if (i13.status !== "required" || !scope[mode].length) reject(`requires tdd_mode ${mode} UC-Ds in the current unit scope; existing not_required semantics apply otherwise`);
    const expected = [...scope[mode]].sort();
    if (!Array.isArray(record.ucd_ids) || record.ucd_ids.some((id: unknown) => typeof id !== "string") || JSON.stringify([...record.ucd_ids].sort()) !== JSON.stringify(expected)) reject(`UC-D set does not match current I13 unit ${mode} UC-D set`);
    if (JSON.stringify(record.i13_binding) !== JSON.stringify(phaseInputBinding(root, i13, {}, identity.unit_id))) reject("I13 unit semantics or source inputs changed");
    const path = phaseRecordPath("code-generation", identity.module_id, identity.unit_id, "green-test-evidence");
    if (record.green_evidence?.path !== path) reject("green_evidence.path must be the canonical GREEN path of this unit");
    else if (!/^[a-f0-9]{64}$/.test(String(record.green_evidence.sha256)) || record.green_evidence.sha256 !== omissionHash(omissionFile(root, path))) reject("GREEN sha256 changed; explicit renewed approval is required");
  } catch (error) { reject(error instanceof Error ? error.message : String(error)); }
  if (record.supersedes !== undefined) {
    try {
      const prefix = `.aidlc/evidence/historical-${phase.toLowerCase()}-omission-history/${identity.workflow_id}/${identity.module_id}/${identity.unit_id}/`;
      if (typeof record.supersedes?.path !== "string" || !record.supersedes.path.startsWith(prefix) || !/^[a-f0-9-]{36}\.json$/.test(record.supersedes.path.slice(prefix.length))) reject("supersedes must identify this unit's archived approval");
      else if (!/^[a-f0-9]{64}$/.test(String(record.supersedes.sha256)) || record.supersedes.sha256 !== omissionHash(omissionFile(root, record.supersedes.path))) reject("superseded approval archive is missing or changed");
    } catch (error) { reject(error instanceof Error ? error.message : String(error)); }
  }
  if (record.checker && record.checker.argv_digest !== tddOmissionDigest(record)) reject("checker digest does not match the approved omission binding");
  return errors;
}

export function tddOmissionSummary(root: string, record: RecordValue): RecordValue {
  const path = phaseRecordPath("tdd", record.module_id, record.unit_id, `${record.phase === "BASELINE" ? "baseline" : "red"}-test-evidence`);
  return { path, sha256: omissionHash(omissionFile(root, path)), workflow_id: record.workflow_id, module_id: record.module_id, unit_id: record.unit_id,
    status: "not_recorded", reason_code: record.reason_code, ucd_ids: record.ucd_ids, green_evidence: record.green_evidence,
    approval_ref: record.approval_ref, approved_by: record.approved_by, approved_at: record.approved_at, limitation: record.limitation,
    ...(record.phase === "BASELINE" ? { baseline_commit: record.baseline_commit, baseline_refs: record.baseline_refs, ...(record.baseline_kind ? { baseline_kind: record.baseline_kind } : {}), ...(record.baseline_repos ? { baseline_repos: record.baseline_repos } : {}) } : {}) };
}

// Keep the RED API and digest compatible with already approved records.
export const redOmissionRecord = (root: string, module: string, unit: string) => tddOmissionRecord(root, module, unit, "RED");
export const redOmissionPayload = (root: string, identity: OmissionIdentity, i13: RecordValue, approval: RecordValue) => tddOmissionPayload(root, identity, i13, approval, "RED");
export const redOmissionErrors = (root: string, record: RecordValue, identity: OmissionIdentity, i13: RecordValue) => tddOmissionErrors(root, record, identity, i13, "RED");
export const redOmissionDigest = tddOmissionDigest;
export const redOmissionSummary = tddOmissionSummary;
