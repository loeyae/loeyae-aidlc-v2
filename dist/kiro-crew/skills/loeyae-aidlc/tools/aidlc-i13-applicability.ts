import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ucdExemption } from "./aidlc-execution-context";
import { evidenceTimeError } from "./aidlc-evidence-policy";
import { commitAncestryErrors, readSourceRevision } from "./aidlc-revision";

/** Shared provenance precondition for a no-behavior applicability claim. */
export function assertControlledI13(root: string, i13: Record<string, unknown>, moduleId: string): void {
  const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const producer = record(i13.producer), checker = record(i13.checker), revision = record(i13.source_revision);
  if (i13.evidence_version !== "1" || producer?.name !== "loeyae-aidlc-evidence" || producer.mode !== "controlled" || !producer.execution_id
    || i13.stage_instance !== `test-case-derivation@module:${moduleId}` || i13.module_id !== moduleId || i13.unit_id !== null
    || !revision || !/^[a-f0-9]{64}$/.test(String(revision.worktree_digest)) || !/^[a-f0-9]{40,64}$/.test(String(revision.commit))
    || commitAncestryErrors(root, String(revision.commit), readSourceRevision(root).commit).length
    || checker?.id !== "builtin:test-case-derivation" || checker.sensor !== "test-case-derivation" || !/^[a-f0-9]{64}$/.test(String(checker.argv_digest))
    || checker.status !== "passed" || checker.exit_code !== 0 || evidenceTimeError(i13, "test-case-derivation")) throw new Error("no-behavior applicability requires controlled valid I13 evidence");
}

/** The canonical I13 no-behavior source payload, shared by producer and deletion delivery.
 * The caller supplies its controlled project-local reader when used at a delivery gate.
 */
export function i13NonApplicable(root: string, moduleId: string, read = (path: string) => readFileSync(join(root, path), "utf8")): Record<string, unknown> {
  const base = `docs/aidlc/modules/${moduleId}/inception`;
  const sources = ["requirements.md", "user-stories.md", "application-design.md", "clarifications.md"]
    .map(name => `${base}/${name}`).filter(path => existsSync(join(root, path)));
  if (!sources.length) throw new Error("I13 requires at least one requirement, story, application-design, or clarification source artifact before declaring not_applicable");
  const path = `${base}/application-design/test-cases/non-applicable.json`;
  // Node's JSON.parse error wording varies across V8 versions; wrap it so the
  // message stays stable ("is not valid JSON") instead of leaking the engine text.
  let value: Record<string, unknown>;
  try { value = JSON.parse(read(path)) as Record<string, unknown>; } catch (error) { throw new Error(`non-applicable.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("non-applicable.json must contain a JSON object");
  if (value.schema_version !== "1" || value.status !== "not_applicable") throw new Error("I13 non-applicable record must use schema_version=1 and status=not_applicable");
  // I13 uses a display command string; unit exemptions use an argv array.
  const exemption = ucdExemption({ reason_code: value.reason_code, reason: value.reason, approval_ref: value.approval_ref,
    alternative_validation: value.alternative_validation, validation_command: [value.validation_command] }, "non-applicable");
  if (typeof value.validation_command !== "string" || !value.validation_command.trim()) throw new Error("non-applicable.validation_command must be a non-empty string");
  if (!Array.isArray(value.source_refs) || !value.source_refs.length || value.source_refs.some((ref: unknown) => typeof ref !== "string" || !ref.trim())) throw new Error("non-applicable.source_refs must be a non-empty string array");
  const label = (path: string) => relative(root, join(root, path));
  const digest = createHash("sha256").update(JSON.stringify([...sources, path].sort().map(path => [label(path), read(path)]))).digest("hex");
  return { status: "not_applicable", applicability: "not_applicable", applicability_inputs_digest: digest,
    reason_code: exemption.reason_code, reason: exemption.reason, approval_ref: exemption.approval_ref,
    alternative_validation: exemption.alternative_validation, validation_command: value.validation_command,
    source_refs: value.source_refs, source_files: sources.map(label), test_case_files: [] };
}
