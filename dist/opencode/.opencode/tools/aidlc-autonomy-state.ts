/** Persisted P1-01 scope identity. This is neither an execution grant nor evidence. */
export interface AutonomyBatchSnapshot {
  version: "1";
  batch_id: string;
  scope_revision: number;
  source_path: string;
  record_digest: string;
  scope_digest: string;
}

/** Sole current pointer; outcome and provenance live in the signed immutable receipt. */
export interface AutonomyBatchResultRef {
  version: "1"; result_id: string; batch_id: string; scope_revision: number; path: string; digest: string;
}
export function assertAutonomyBatchResultRef(value: unknown): asserts value is AutonomyBatchResultRef {
  const r=value as AutonomyBatchResultRef;
  if(!r||typeof r!=="object"||Array.isArray(r)||Object.keys(r).sort().join(",")!=="batch_id,digest,path,result_id,scope_revision,version"
    ||r.version!=="1"||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(r.batch_id)||!Number.isSafeInteger(r.scope_revision)||r.scope_revision<1
    ||!/^[a-f0-9-]{36}$/.test(r.result_id)||r.path!==`.aidlc/evidence/autonomous-results/${r.batch_id}/${r.scope_revision}/${r.result_id}.json`
    ||!/^[a-f0-9]{64}$/.test(r.digest))throw Error("BATCH_RESULT_REF_INVALID");
}

export function assertAutonomySnapshot(value: unknown): asserts value is AutonomyBatchSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AUTONOMY_SCHEMA_INVALID: batch snapshot must be an object");
  const row = value as Record<string, unknown>;
  const keys = ["version", "batch_id", "scope_revision", "source_path", "record_digest", "scope_digest"];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))
    || row.version !== "1" || typeof row.batch_id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(row.batch_id)
    || !Number.isSafeInteger(row.scope_revision) || (row.scope_revision as number) < 1
    || typeof row.source_path !== "string" || !["docs/aidlc/ideation/scenario-module-mapping.md", "docs/aidlc/handoff.md"].includes(row.source_path)
    || ![row.record_digest, row.scope_digest].every(digest => typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest))) {
    throw new Error("AUTONOMY_SCHEMA_INVALID: invalid batch snapshot fields/version");
  }
}
