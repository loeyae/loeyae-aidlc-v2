import {assertAttemptRepairFinalization} from './aidlc-attempt-repair';
/** P1-08 convergence. A signed historical verdict is distinct from current applicability. */
import { readFileSync, existsSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { projectAutonomyScope, ScopeReader } from "./aidlc-autonomy";
import { projectAutonomyDecisions } from "./aidlc-autonomy-policy";
import { projectAutonomyDependencies, assertAutonomyDependencyAccess } from "./aidlc-autonomy-dependencies";
import { loadWorkflowState, saveWorkflowState, sessionBinding, withSessionPublication } from "./aidlc-light-state";
import { loadWorkflowParts } from "./aidlc-workflow-layout";
import { checkCurrentExecutionGrant } from "./aidlc-execution-grant";
import {
  assertAdmissionReceipt,
  checkExecutionGrant,
  readObservationReport,
  readObservationAt,
  readBatchResult,
  storeBatchResult,
} from "./aidlc-grant-store";
import {
  currentObservations,
  assertCandidate,
  candidateSnapshot,
  observationHash as hash,
  observationCheckerDigest,
} from "./aidlc-observation-inputs";
import { canonicalAutonomyJson as json, autonomyDigest as digest, array, safeFile } from "./aidlc-autonomy-files";
import { evidenceTimeError } from "./aidlc-evidence-policy";
import { sensorRepairDiagnostics } from "./aidlc-repair-guidance";
import { readSourceRevision } from "./aidlc-revision";
import {
  dependencyRecords,
  unitExtensionPath,
  declaredDependencyWrites,
  withinDependencyPath,
} from "./aidlc-dependency-inputs";
type Row = Record<string, any>;
const same = (a: unknown, b: unknown) => json(a) === json(b);
const FINAL_STAGES = new Set([
  "test-case-derivation",
  "tdd",
  "code-generation",
  "code-review",
  "build-and-test",
  "ui-page-planning",
  "ui-mock-generation",
  "ui-figma-generation",
]);
function stateFacts(root: string) {
  return [...loadWorkflowParts(root).parts.values()]
    .map((p) => ({
      workflow_id: p.state.workflow_id,
      kind: p.ref,
      baseline: p.state.baseline_commit || null,
      adoption: p.state.adoption_baseline || null,
      profile: p.state.execution_profile || null,
      completed: p.state.completed_stage_instances.filter((s) => FINAL_STAGES.has(s.split("@")[0])).sort(),
      skipped: p.state.skipped_stage_instances.filter((s) => FINAL_STAGES.has(s.split("@")[0])).sort(),
      choices: p.state.history.filter(
        (h) => h.user_input !== undefined && !["implementation-report", "merge-planning"].includes(h.stage),
      ),
    }))
    .sort((a, b) => a.workflow_id.localeCompare(b.workflow_id));
}
/** Bind mutable validation configuration and supporting Native proof topology, not host logs. */
function nativeContext(root: string) {
  const rows: Row[] = [];
  const visit = (label: string) => {
    const p = join(root, label);
    if (!existsSync(p)) return;
    if (lstatSync(p).isSymbolicLink()) throw Error("LINKED_NATIVE_CONTEXT");
    if (lstatSync(p).isDirectory()) {
      for (const e of readdirSync(p).sort()) if (!/\.lock$|\.tmp-/.test(e)) visit(label + "/" + e);
    } else rows.push({ path: label, digest: hash(readFileSync(safeFile(root, label))) });
  };
  visit(".aidlc/commands");
  visit(".aidlc/approvals");
  for (const s of new Set([
    ...FINAL_STAGES,
    "shared-contract-baseline",
    "ui-implementation-bridge",
    "ui-page-planning",
    "ui-mock-generation",
    "ui-figma-generation",
    "units-generation",
    "cross-validation",
  ]))
    visit(".aidlc/evidence/" + s);
  for (const p of [".aidlc/providers.json", ".aidlc/providers.lock.json"]) visit(p);
  return digest(rows);
}
function nativeCheck(root: string, deadline: number): Row {
  const argv = [
    createRequire(import.meta.url).resolve("tsx/cli"),
    fileURLToPath(new URL("./aidlc-batch-native.ts", import.meta.url)),
  ];
  const r = spawnSync(process.execPath, argv, {
    cwd: root,
    encoding: "utf8",
    timeout: Math.max(1, Math.min(120000, deadline - Date.now())),
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (r.error || r.status !== 0)
    return {
      status: "blocked",
      refs: [],
      checked: [],
      failures: [{ status: r.error ? "incomplete" : "blocked", message: String(r.error || r.stderr || r.stdout) }],
    };
  const value = JSON.parse(r.stdout);
  if (!Array.isArray(value.refs) || !Array.isArray(value.failures) || !Array.isArray(value.checked))
    throw Error("NATIVE_CONVERGENCE_INVALID");
  return value;
}
function rawRef(root: string, path: string) {
  return { repository_id: "project", path, digest_mode: "raw-file", digest: hash(readFileSync(safeFile(root, path))) };
}
function checkTracked(root: string, path: string) {
  const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", path], {
    cwd: root,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  if (r.status !== 0 || r.error) throw Error("UNTRACKED_DELIVERY_INPUT: " + path);
}
function decisionsAtCandidate(root: string, decisions: Row, observation: Row, native: Row): Row[] {
  const reader = new ScopeReader(root, loadWorkflowState(root)!);
  const scope = projectAutonomyScope(root);
  return decisions.decisions.map((d: Row) => {
    if (d.completion_blockers.length)
      throw Error("DECISION_INCOMPLETE: " + d.decision_id + ":" + d.completion_blockers.join(","));
    const unit = projectAutonomyDependencies(root).units.find((u) => same(u.unit_ref, d.unit_ref));
    if (!unit) throw Error("DECISION_UNIT_NOT_SELECTED");
    for (const input of d.implementation_refs) {
      const resolved = reader.resolve(input);
      checkTracked(root, resolved.ref.path);
      if (!declaredDependencyWrites(root, unit).some((p) => withinDependencyPath(resolved.ref.path, p)))
        throw Error("DECISION_IMPLEMENTATION_OUTSIDE_UNIT");
    }
    const owner = dependencyRecords(root, unitExtensionPath(d.unit_ref.module_id)).find(
      (r) => r.record_type === "unit-extension" && same(r.unit_ref, d.unit_ref),
    );
    const acceptance =
      owner?.acceptance_refs ||
      (scope.units!.filter((u) => u.role === "implement").length === 1 ? scope.acceptance_refs : []);
    const validation = d.validation_refs.map((v: Row) => {
      if (
        !observation.observations.some(
          (o: Row) =>
            o.check_id === v.check_id &&
            o.status === "passed" &&
            o.covers.some((r: Row) => acceptance.some((a: Row) => same(a, r))),
        )
      )
        throw Error("DECISION_CURRENT_CHECK_MISSING: " + v.check_id);
      if (v.sensor === "runtime-observation") {
        const prior = readObservationAt(root, v.path, v.digest);
        if (
          prior.coverage !== "matrix" ||
          !same(prior.batch_ref, observation.batch_ref) ||
          prior.workflow_id !== observation.workflow_id ||
          !prior.observations.some((o: Row) => o.check_id === v.check_id && o.status === "passed")
        )
          throw Error("DECISION_OBSERVATION_NOT_CONTROLLED");
      } else if (
        !native.refs.some(
          (r: Row) =>
            r.path === v.path &&
            r.digest === v.digest &&
            r.sensor === v.sensor &&
            r.workflow_id === v.workflow_id &&
            r.stage_instance === v.stage_instance,
        )
      )
        throw Error("DECISION_NATIVE_REF_NOT_VERIFIED");
      return {
        check_id: v.check_id,
        observation_ids: observation.observations
          .filter((o: Row) => o.check_id === v.check_id)
          .map((o: Row) => o.observation_id),
        receipt_ref: observation.receipt_ref,
      };
    });
    return { ...d, record_status: "verified", current_validation: validation };
  });
}
function humanSummary(decisions: Row) {
  const counts = decisions.human_review_summary || {};
  return {
    ...counts,
    status: !decisions.decisions.length
      ? "not-required"
      : counts["change-requested"] || counts.rejected
        ? "changes-requested"
        : counts.pending
          ? "pending"
          : "accepted",
  };
}

export function finalizeBatch(root: string, preview = false): Row {
  checkCurrentExecutionGrant(root, ["validation-execute", "evidence-publish"]);
  const global = loadWorkflowState(root)!,
    binding = sessionBinding()!;
  if (!global.autonomy_contract_version || binding.stage_instance.includes("@"))
    throw Error("BATCH_FINALIZE_REQUIRES_GLOBAL_COORDINATOR");
  checkExecutionGrant(root, global, binding, ["workflow-write"]);
  const scope = projectAutonomyScope(root),
    reader = new ScopeReader(root, global),
    checks: Row[] = [],
    source = new Map<string, Row>();
  const capture = (path: string) => {
    const r = rawRef(root, path);
    source.set(path, r);
    return r;
  };
  const check = (check_id: string, fn: () => any, status = "incomplete") => {
    try {
      const value = fn();
      checks.push({ check_id, status: "passed" });
      return value;
    } catch (error) {
      checks.push({ check_id, status, reason: String(error) });
      return undefined;
    }
  };
  check("attempt-repair",()=>assertAttemptRepairFinalization(root),"blocked");
  const decisions = check("delegated-records", () => projectAutonomyDecisions(root), "blocked") || {
    effective_revision: 0,
    decisions: [],
    human_review_summary: {},
    completion_blockers: [],
  };
  if (decisions.completion_blockers.length)
    checks.push({
      check_id: "delegated-completeness",
      status: decisions.completion_blockers.some((r: string) => r.includes("rework")) ? "blocked" : "incomplete",
      reason: decisions.completion_blockers.join("; "),
    });
  check("admission", () => assertAdmissionReceipt(root, global), "blocked");
  const snapshot = stateFacts(root),
    context = nativeContext(root),
    checker_digest = observationCheckerDigest();
  const working = readSourceRevision(root),
    working_revision = { commit: working.commit, worktree_digest: working.worktree_digest };
  const started_at = new Date().toISOString();
  const rawObservation = check("observation-receipt", () => readObservationReport(root, global));
  const observation = check("current-matrix", () => {
    const r = currentObservations(root, global);
    if (r.coverage !== "matrix") throw Error("COMPLETE_MATRIX_REQUIRED");
    return r;
  });
  let candidate: Row | null = null;
  if (rawObservation?.coverage === "matrix")
    candidate =
      check("final-candidate", () =>
        candidateSnapshot(
          root,
          rawObservation.candidate_ref.artifacts.map((r: Row) => r.path),
        ),
      ) || null;
  if (!candidate && !checks.some((c) => c.check_id === "final-candidate"))
    checks.push({ check_id: "final-candidate", status: "incomplete", reason: "No fixed clean final candidate" });
  let dependencies: Row | undefined;
  dependencies = check(
    "dependency-consumption",
    () => {
      const p = assertAutonomyDependencyAccess(root, binding, ["validation-execute"], undefined, "build-and-test");
      return p;
    },
    "blocked",
  );
  const matrix = reader.resolve(scope.validation_matrix_ref).record!,
    ids = array(matrix.checks, "matrix checks", true).map((r: any) => (typeof r === "string" ? r : r.check_id));
  if (observation) {
    check("matrix-denominator", () => {
      if (
        observation.observations.length !== ids.length ||
        ids.some((id) => observation.observations.filter((o: Row) => o.check_id === id).length !== 1)
      )
        throw Error("MATRIX_DENOMINATOR_CHANGED");
      for (const ac of scope.acceptance_refs!)
        if (!observation.observations.some((o: Row) => o.covers.some((r: Row) => same(r, ac))))
          throw Error("ACCEPTANCE_UNCOVERED");
      const combos = (matrix.ui_combinations as Row[]) || [];
      if (
        combos.some(
          (c) =>
            observation.observations.filter(
              (o: Row) => o.combination_id === c.combination_id && same(o.page_ref, c.page_ref),
            ).length !== 1,
        )
      )
        throw Error("UI_COMBINATION_UNCOVERED");
      for (const c of scope.consumer_closure!)
        for (const id of (c.required_checks as string[]) || [])
          if (!observation.observations.some((o: Row) => o.check_id === id && o.status === "passed"))
            throw Error("CONSUMER_CHECK_MISSING");
    });
    for (const o of observation.observations)
      if (o.status !== "passed")
        checks.push({
          check_id: o.check_id,
          status: "failed",
          reason: "Actual candidate observation failed",
          raw_output_ref: o.raw_output_ref,
        });
    for (const r of [...observation.source_refs, ...observation.raw_refs]) capture(r.path);
    capture(observation.receipt_ref.path);
  }
  const deadline = rawObservation?.valid_until ? Date.parse(rawObservation.valid_until) : Date.now() + 120000;
  const native = preview
    ? {
        status: "not-checked",
        failures: [{ status: "incomplete", message: "preview never invokes Native convergence" }],
        refs: [],
        checked: [],
      }
    : nativeCheck(root, deadline);
  for (const f of native.failures)
    checks.push({
      check_id: "native:" + (f.stage_instance || "convergence") + ":" + (f.sensor || "checker"),
      status: f.status || "blocked",
      reason: f.message,
    });
  for (const r of native.refs) capture(r.path);
  const boundDecisions =
    observation && native.status === "passed" && !decisions.completion_blockers.length
      ? check("decision-evidence", () => decisionsAtCandidate(root, decisions, observation, native), "blocked")
      : undefined;
  if (existsSync(join(root, "docs/aidlc/handoff.md"))) capture("docs/aidlc/handoff.md");
  const artifacts = scope.delivery_artifacts!.map((a) => {
    const path = String(a.target_path || (a.source_ref as Row)?.path || "");
    if (!path) {
      if (a.required)
        checks.push({
          check_id: "artifact:" + a.artifact_id,
          status: "incomplete",
          reason: "Required delivery target is unspecified",
        });
      return { ...a, status: "missing" };
    }
    const ref = check("artifact:" + a.artifact_id, () => {
      if (a.source_ref) reader.resolve(a.source_ref);
      const r = capture(path);
      if (!readFileSync(safeFile(root, path)).length) throw Error("EMPTY_ARTIFACT");
      checkTracked(root, path);
      return r;
    });
    if (!a.required) {
      const c = checks.at(-1)!;
      if (c.status !== "passed") c.status = "not-required";
    }
    return { ...a, status: ref ? "present" : "missing", input_ref: ref || null };
  });
  const engineering_result = checks.some((c) => c.status === "failed")
    ? "failed"
    : checks.some((c) => c.status === "blocked")
      ? "blocked"
      : checks.some((c) => c.status === "incomplete")
        ? "incomplete"
        : "verified";
  const body: Row = {
    schema: "aidlc.batch-result/v1",
    workflow_id: global.workflow_id,
    batch_ref: global.autonomy_batch,
    scope_revision: global.autonomy_batch!.scope_revision,
    effective_revision: decisions.effective_revision,
    grant_ref: global.execution_grant_ref,
    candidate_ref: candidate,
    environment_refs: observation ? [observation.environment_ref] : [],
    acceptance_observations: observation?.observations || [],
    ui_observations: observation?.observations.filter((o: Row) => o.kind === "ui") || [],
    observation_ref: observation?.receipt_ref || null,
    native,
    review_refs: native.refs.filter(
      (r: Row) => r.stage_instance.startsWith("code-review") || r.sensor === "global-review-evidence",
    ),
    build_refs: native.refs.filter((r: Row) => r.sensor === "build-test-evidence"),
    test_refs: native.refs.filter((r: Row) => r.sensor.includes("test")),
    risk_refs: native.refs.filter((r: Row) => r.stage_instance === "build-and-test"),
    decision_refs: boundDecisions || decisions.decisions,
    human_review_summary: humanSummary(decisions),
    decision_digest: digest(decisions),
    delivery_artifacts: artifacts,
    dependency_refs: dependencies?.evidence_refs || [],
    checks,
    source_refs: [...source.values()],
    state_facts: snapshot,
    native_context: context,
    working_revision,
    checker_digest,
    started_at,
    ended_at: new Date().toISOString(),
    valid_until: observation?.valid_until || new Date().toISOString(),
    engineering_result,
    lifecycle_status: engineering_result === "failed" ? "verifying" : engineering_result,
    batch_completed: engineering_result === "verified",
    workflow_completed: false,
    business_verified: engineering_result === "verified",
    producer: {
      name: "loeyae-aidlc-batch-result",
      mode: "controlled",
      execution_id: randomUUID(),
      stage_instance: binding.stage_instance,
    },
  };
  body.convergence_digest = digest({
    scope: body.batch_ref,
    grant: body.grant_ref,
    candidate,
    observation: body.observation_ref,
    native: body.native,
    source: body.source_refs,
    decisions: body.decision_digest,
    artifacts: body.delivery_artifacts,
    checks,
    context,
    snapshot,
    working_revision,
    checker_digest,
  });
  if (preview) return { ...body, preview: true, execution_authorized: false };
  return withSessionPublication(
    root,
    { kind: "global" },
    binding.stage_instance,
    () => {
      checkCurrentExecutionGrant(root, ["evidence-publish"]);
      checkExecutionGrant(root, loadWorkflowState(root)!, binding, ["workflow-write"]);
      if (
        checker_digest !== observationCheckerDigest() ||
        !same(snapshot, stateFacts(root)) ||
        context !== nativeContext(root)
      )
        throw Error("BATCH_RESULT_INPUT_CHANGED");
      const now = readSourceRevision(root);
      if (!same(working_revision, { commit: now.commit, worktree_digest: now.worktree_digest }))
        throw Error("BATCH_WORKING_INPUT_CHANGED");
      for (const r of source.values())
        if (hash(readFileSync(safeFile(root, r.path))) !== r.digest) throw Error("BATCH_RESULT_SOURCE_CHANGED");
      if (candidate) assertCandidate(root, candidate);
      if (engineering_result === "verified") {
        const fresh = currentObservations(root, loadWorkflowState(root));
        if (!same(fresh.receipt_ref, observation!.receipt_ref)) throw Error("BATCH_OBSERVATION_CHANGED");
        assertAutonomyDependencyAccess(root, binding, ["validation-execute"], undefined, "build-and-test");
        if (Date.now() >= Date.parse(body.valid_until)) throw Error("BATCH_OBSERVATION_EXPIRED_DURING_PUBLICATION");
      }
      const current = loadWorkflowState(root)!;
      if (current.autonomy_batch_result_ref) {
        const prior = readBatchResult(root, current.autonomy_batch_result_ref);
        if (prior.convergence_digest === body.convergence_digest)
          return { ...prior, result_ref: current.autonomy_batch_result_ref, idempotent: true };
      }
      const ref = storeBatchResult(root, current, body);
      saveWorkflowState(root, { ...current, autonomy_batch_result_ref: ref });
      return { ...body, result_ref: ref };
    },
    binding,
  );
}
export function projectBatchResult(root: string): Row {
  const global = loadWorkflowState(root);
  if (!global?.autonomy_contract_version)
    return {
      enabled: false,
      engineering_result: "incomplete",
      current_status: "unknown",
      batch_completed: false,
      workflow_completed: false,
    };
  if (!global.autonomy_batch_result_ref)
    return {
      enabled: true,
      engineering_result: "incomplete",
      current_status: "unknown",
      batch_completed: false,
      workflow_completed: false,
      reason: "No controlled batch result",
    };
  let body: Row;
  try {
    body = readBatchResult(root, global.autonomy_batch_result_ref);
  } catch (e) {
    return {
      enabled: true,
      engineering_result: "incomplete",
      current_status: "unknown",
      batch_completed: false,
      workflow_completed: false,
      reason: String(e),
    };
  }
  const reasons: string[] = [];
  const validate = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      reasons.push(String(e));
    }
  };
  validate(() => {
    if (body.checker_digest !== observationCheckerDigest() || !same(body.batch_ref, global.autonomy_batch))
      throw Error("RESULT_SCOPE_OR_CHECKER_CHANGED");
    if (!same(body.state_facts, stateFacts(root)) || body.native_context !== nativeContext(root))
      throw Error("RESULT_NATIVE_CONTEXT_CHANGED");
  });
  validate(() => {
    const now = readSourceRevision(root);
    if (!same(body.working_revision, { commit: now.commit, worktree_digest: now.worktree_digest }))
      throw Error("RESULT_WORKING_INPUT_CHANGED");
  });
  validate(() => {
    for (const r of body.source_refs)
      if (hash(readFileSync(safeFile(root, r.path))) !== r.digest) throw Error("RESULT_SOURCE_CHANGED: " + r.path);
  });
  if (body.candidate_ref) validate(() => assertCandidate(root, body.candidate_ref));
  validate(() => {
    if (digest(projectAutonomyDecisions(root)) !== body.decision_digest) throw Error("RESULT_DECISION_CHANGED");
  });
  if (body.engineering_result === "verified")
    validate(() => {
      const o = currentObservations(root, global);
      if (o.status !== "passed" || o.coverage !== "matrix" || !same(o.receipt_ref, body.observation_ref))
        throw Error("RESULT_OBSERVATION_CHANGED");
      for (const r of body.native.refs) {
        const error = evidenceTimeError(JSON.parse(readFileSync(safeFile(root, r.path), "utf8")), r.sensor);
        if (error) throw Error(error);
      }
      assertAutonomyDependencyAccess(root, undefined, ["validation-execute"], undefined, "build-and-test");
    });
  const current_status = reasons.length ? "stale" : "current";
  return {
    enabled: true,
    ...body,
    result_ref: global.autonomy_batch_result_ref,
    current_status,
    current_blockers: reasons,
    execution_authorized: false,
    batch_completed: body.engineering_result === "verified" && current_status === "current",
    workflow_completed: false,
  };
}
export function batchResultDirective(root: string, args: string[]): Row {
  if (args[0] === "finalize" && (args.length === 1 || (args.length === 2 && args[1] === "--preview")))
    {
      const result = finalizeBatch(root, args.includes("--preview"));
      // Advisory work derived from actual Native failures; never alter the
      // signed historical verdict or treat a command as execution permission.
      const diagnostics = args.includes("--preview") ? [] : sensorRepairDiagnostics(result.native?.failures || [], {
        completed_stage_instances: (result.state_facts || []).flatMap((fact: Row) => fact.completed || []),
      });
      return { kind: "print", autonomous_batch_result: result, ...(diagnostics.length ? { repair_diagnostics: diagnostics } : {}) };
    }
  if (args.length === 1 && args[0] === "inspect")
    return { kind: "print", autonomous_batch_result: projectBatchResult(root) };
  throw Error("use autonomy batch finalize [--preview]|inspect");
}
