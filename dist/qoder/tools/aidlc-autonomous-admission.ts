/** P1-04. Design reception and bounded execution preflight; no model supervisor. */
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { projectAutonomyScope, readAutonomyBatch, ScopeReader, type AutonomyInputRef, type AutonomyScopeProjection } from "./aidlc-autonomy";
import { projectAutonomyDecisions } from "./aidlc-autonomy-policy";
import { array, autonomyDigest as digest, canonicalAutonomyJson as json, id, object, safeFile, string, unique } from "./aidlc-autonomy-files";
import { ADMISSION_CHECKS, IMPLEMENTATION_ENTRY_STAGES, admissionDecisions, admissionEnvironment, assertAdmissionReceipt, checkExecutionGrant, readIssuedGrant, storeAdmissionReport, storeHostCapabilityReport, readHostCapabilityReport, validateGrantInputs, withGrantControl, type GrantInput } from "./aidlc-grant-store";
import { assertSessionClaim, lightStatePath, loadWorkflowState, sessionBinding, withWorkflowFileLock } from "./aidlc-light-state";
import { loadWorkflowParts } from "./aidlc-workflow-layout";
import { developmentAcceptanceErrors } from "./aidlc-quality-delivery";
import { qualityBase, qualitySection, type QualityContext } from "./aidlc-quality-gates";
import { semanticCheckerDigest } from "./aidlc-checker-identity";
import { projectAutonomyDependencies } from "./aidlc-autonomy-dependencies";
import { createCodexAdmissionAdapter } from "./aidlc-native-host";
import { previewObservationPlan } from './aidlc-observations';
import {reusableHostCapability,validateHostObservation,hostCapabilityCheckerDigest,capabilityReuseReason} from './aidlc-host-capabilities';
import {businessCommandEnvironment} from './aidlc-spawn';

import {inspectExecutionWindow} from './aidlc-execution-window';
import {createRequire} from 'node:module';
const {decideExecutionContinuation}=createRequire(import.meta.url)('./aidlc-execution-continuation.cjs');
type Row = Record<string, any>;
export type AdmissionOutcome = "ready" | "ready-with-delegated-decisions" | "not-ready";
export interface AdmissionCheck { check_id: string; required: true; status: "passed" | "failed" | "not-applicable" | "unverified"; reason: string; input_refs: GrantInput[]; }
/** A trusted in-process host adapter executes native probes. Not a JSON/CLI approval surface.
 * P1-06 supplies the real adapter. Fixture adapters test this protocol, not actual host capability. */
export interface AdmissionHostAdapter {
  /** Trusted adapter negotiation, never a user-supplied permission or receipt. */
  qualification_scope?: 'run-config';
  observe(challenge: { nonce: string; host: Row; required_capabilities: string[]; limits: Row }): {
    nonce: string; host: Row; observed_at: string; valid_until: string;
    capabilities: Record<string, { status: "supported" | "unsupported" | "unknown"; probe_refs: AutonomyInputRef[] }>;
    limits: Row; configuration_digest?: string;
  };
  revalidate?(challenge:{host:Row;limits:Row}):{host:Row;configuration_digest:string;observed_at:string;resource_reconciliation:{reconciled:boolean};probe_refs:AutonomyInputRef[]};
}
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
function fail(s: string): never { throw new Error(`ADMISSION_NOT_READY: ${s}`); }
const finite = (v: unknown, max: number, label: string) => { if (!Number.isSafeInteger(v) || Number(v) < 1 || Number(v) > max) fail(`${label} must be bounded 1..${max}`); return Number(v); };
const same = (a: unknown, b: unknown) => json(a) === json(b);
function refs(value: unknown, reader: ScopeReader): AutonomyInputRef[] { return unique(array(value, "input_refs", true).map(v => reader.resolve(v).ref), r => json(r), "input refs"); }

/** No commands, probes, locks, keys or receipt writes. It never fabricates a passed preflight. */
export function previewAutonomousAdmission(root: string, path: string): Row {
  return evaluate(root, path, false);
}
function evaluate(root: string, path: string, execute: boolean, adapter?: AdmissionHostAdapter, draftScope?: AutonomyScopeProjection): Row {
  const checks: AdmissionCheck[] = ADMISSION_CHECKS.map(check_id => ({ check_id, required: true, status: "unverified", reason: "not evaluated", input_refs: [] }));
  const inputs = new Map<string, GrantInput>(), capture = (p: string) => {
    const file = safeFile(root, p), ref = { repository_id: "project" as const, path: p, digest_mode: "raw-file" as const, digest: hash(readFileSync(file)) };
    inputs.set(p, ref); return ref;
  };
  const check = (name: typeof ADMISSION_CHECKS[number], fn: () => string | void) => {
    const c = checks.find(c => c.check_id === name)!;
    try { c.reason = fn() || "current inputs checked"; c.status = "passed"; }
    catch (e) { c.reason = String(e instanceof Error ? e.message : e); c.status = /UNVERIFIED|preview does not/.test(c.reason) ? "unverified" : "failed"; }
    c.input_refs = [...inputs.values()];
  };
  const global = loadWorkflowState(root);
  let scope!: ReturnType<typeof projectAutonomyScope>, decisions!: ReturnType<typeof projectAutonomyDecisions>, reader!: ScopeReader, config!: Row, grant!: ReturnType<typeof readIssuedGrant>["grant"];
  let environment!: Row, hostObservation: Row | undefined, decisionDigest!: string, configDigest!: string;
  let hostReuse:Row={mode:'unavailable',reason:'not-evaluated'},windowCompatibility:Row|null=null;
  const executables: string[] = [], variables: string[] = [], observations: Row[] = [];
  const environmentRefs: AutonomyInputRef[] = [], capabilityRefs: AutonomyInputRef[] = [];
  let dependencyPlan: ReturnType<typeof projectAutonomyDependencies> | undefined;
  const started = Date.now(), checkerDigest = semanticCheckerDigest(true);
  check("scope-policy", () => {
    if (!global || !global.autonomy_contract_version && !draftScope) fail("explicit autonomous batch adoption required");
    scope = draftScope || projectAutonomyScope(root, global); decisions = projectAutonomyDecisions(root,draftScope); reader = new ScopeReader(root, global);
    if (decisions.decisions.some(d => d.record_status === "rework-required")) fail("rejected/change-requested delegated decision requires rework");
    const input = capture(path);
    if (!scope.baseline_inputs!.some(ref => ref.digest_mode === "raw-file" && ref.path === path && ref.digest === input.digest)) fail("preflight configuration must be frozen in batch baseline_inputs before authorization");
    config = object(JSON.parse(readFileSync(safeFile(root, path), "utf8")), "AdmissionPlan", ["schema", "batch_id", "scope_revision", "lifetime_seconds", "reception", "commands", "validation_bindings", "resources", "environment_variables", "native_host_ref"]);
    if (config.schema !== "aidlc.admission-plan/v1" || config.batch_id !== scope.snapshot!.batch_id || config.scope_revision !== scope.snapshot!.scope_revision) fail("preflight configuration scope differs");
    finite(config.lifetime_seconds, 900, "receipt lifetime");
    if(config.native_host_ref){reader.resolve(config.native_host_ref);capture(config.native_host_ref.path);if(draftScope)createCodexAdmissionAdapter(root,config.native_host_ref);}
    configDigest = digest(config); decisionDigest = admissionDecisions(root);
    // Authoring records and projected receipts are distinct. All semantic policy rules were re-read above.
  });
  check("execution-grant", () => {
    if(draftScope)fail('preview does not evaluate execution authorization or live claims');
    if (!global?.execution_grant_version) fail("actual managed ExecutionGrant required");
    const binding = sessionBinding(), part = [...loadWorkflowParts(root).parts.values()].find(p => p.state.workflow_id === binding?.workflow_id);
    if (!part || !binding) fail("live coordinator binding required");
    assertSessionClaim(root, part.state, binding.stage_instance, binding);
    if (part.state.status === "parked" || binding.workflow_id !== global.workflow_id || /@module:|@unit:/.test(binding.stage_instance)) fail("run reception under the live global batch coordinator; no sibling write authority");
    grant = checkExecutionGrant(root, global, binding, ["validation-execute", "evidence-publish"])!;
    if(config)windowCompatibility=inspectExecutionWindow(root,path,grant);
  });
  const modules = () => [...new Set(scope!.units!.filter(u => u.role === "implement").map(u => u.unit_ref.module_id))].sort();
  check("design-reception", () => {
    if (!config || !scope) fail("scope/configuration unavailable");
    const reception = unique(array(config.reception, "reception", true).map(v => object(v, "reception", ["module_id", "ui", "source_refs", "ui_baseline"])), r => String(r.module_id), "module reception");
    if (!same(reception.map(r => r.module_id).sort(), modules())) fail("exact implementation-module reception inventory required");
    for (const r of reception) {
      const module = id(r.module_id, "module_id"), sourceRefs = refs(r.source_refs, reader!);
      const part = [...loadWorkflowParts(root).parts.values()].find(p => p.state.workflow_kind === "module" && p.state.module_id === module)?.state || global!;
      const uiChoice = [...part.history].reverse().find(h => h.stage === "ui-mock" && ["completed", "approved"].includes(h.result) && h.module_id === module)?.user_input;
      const ctx: QualityContext = { root, workflow_id: part.workflow_id, project_workflow_id: global!.workflow_id, module_id: module, stage: "cross-validation", scope: part.scope, ui_route: uiChoice || "not-selected", prd_selected: part.selected_optional_stages?.includes("prd-generation") };
      capture(`${qualityBase(ctx)}/cross-validation-report.md`);
      const delivery = qualitySection(ctx, "cross-validation-report");
      delivery.inputs.forEach(i => capture(i.path));
      const pkg = array(delivery.value.package, "reception package", true) as Row[];
      for (const canonical of ["requirements.md", "user-stories.md", "development-handoff.md"]) if (!pkg.some(p => p.path === `${qualityBase(ctx)}/${canonical}`)) fail(`reception package missing ${canonical}`);
      for (const p of pkg) capture(string(p.path, "package path"));
      const acceptancePath = string(delivery.value.development_acceptance, "development_acceptance"); capture(acceptancePath);
      const acceptance = JSON.parse(readFileSync(safeFile(root, acceptancePath), "utf8"));
      const reviewPath = string(acceptance.technical_review, "technical_review"); capture(reviewPath);
      const review = JSON.parse(readFileSync(safeFile(root, reviewPath), "utf8"));
      const errors = developmentAcceptanceErrors(ctx); if (errors.length) fail(errors.join("; "));
      const a = object(review.autonomous_reception, "autonomous_reception", ["batch_id", "scope_revision", "ui", "source_refs", "unresolved_decisions"]);
      if (a.batch_id !== config.batch_id || a.scope_revision !== config.scope_revision || a.ui !== r.ui || !same(a.source_refs, sourceRefs)) fail("technical reception must bind exact batch, UI applicability and design sources");
      for (const source of sourceRefs) { if (source.digest_mode !== "raw-file") fail("reception source must bind exact file bytes"); capture(source.path); }
      for (const item of array(a.unresolved_decisions, "unresolved_decisions")) if (!decisions!.decisions.some(d => d.decision_id === item && d.record_status !== "rework-required")) fail(`unresolved product/design question ${item} has no lawful fallback decision`);
      if (!["none", "required"].includes(String(r.ui))) fail("UI applicability is unknown");
      if (r.ui === "none") {
        if (r.ui_baseline !== undefined || scope.ui_refs!.some(ref => !String(ref.path).includes("/modules/") || String(ref.path).includes(`/modules/${module}/`)) || ["html-mock", "figma-create", "figma-existing"].includes(ctx.ui_route)) fail("no-UI reception contradicts selected UI design");
      } else {
        const ui = object(r.ui_baseline, "ui_baseline", ["design_refs", "asset_refs", "viewports", "states", "tolerances"]);
        for (const ref of [...refs(ui.design_refs, reader!), ...refs(ui.asset_refs, reader!)]) capture(ref.path);
        for (const v of array(ui.viewports, "viewports", true)) { const viewport = object(v, "viewport", ["width", "height"]); finite(viewport.width, 16384, "width"); finite(viewport.height, 16384, "height"); }
        unique(array(ui.states, "states", true).map(v => string(v, "UI state")), v => v, "UI states");
        const tolerance = object(ui.tolerances, "UI tolerances", ["max_diff_ratio"]); if (typeof tolerance.max_diff_ratio !== "number" || tolerance.max_diff_ratio < 0 || tolerance.max_diff_ratio > 0.1) fail("explicit UI difference tolerance 0..0.1 required");
        if (!scope.ui_refs!.length || !scope.ui_refs!.every(ref => (ui.design_refs as Row[]).some(d => d.path === ref.path && d.digest === ref.digest))) fail("UI baseline must bind selected UI scope");
      }
    }
  });
  check("dependency-readiness", () => {
    if (!scope) fail("scope unavailable");
    dependencyPlan = projectAutonomyDependencies(root, { session_id: sessionBinding()?.session_id,...(draftScope?{draft_scope:draftScope,validate_evidence:false,preparation_only:true}:{}) });
    dependencyPlan.definition_refs.forEach(ref => capture(ref.path));
    // Only immutable consume evidence is pinned at admission; planned in-batch outputs
    // are re-read at their actual checkpoint and can be produced without editing design.
    for (const selected of scope.units!.filter(u => u.role === "consume")) selected.evidence_refs.forEach(ref => capture(String(ref.path)));
    if (!draftScope && !dependencyPlan.admission_ready) fail("dependency plan has no admissible staged consumption");
    if(draftScope)return 'dependency definitions/write scopes checked; Native provenance, live conflicts and runtime readiness remain unverified';
    return "unit ownership, versioned capabilities, staged dependencies and transitive inputs checked; pending runtime is not runtime_ready";
  });
  let commands: Row[] = [];
  check("validation-plan", () => {
    if (!config || !scope) fail("configuration unavailable");
    commands = unique(array(config.commands, "commands", true).map(v => object(v, "command", ["command_id", "argv", "timeout_ms", "input_refs"])), c => id(c.command_id, "command_id"), "commands");
    for (const c of commands) {
      const argv = array(c.argv, "argv", true).map(v => string(v, "argv element")); if (!isAbsolute(argv[0]) || !lstatSync(argv[0]).isFile() || lstatSync(argv[0]).isSymbolicLink()) fail("command executable must be a real absolute file, never a shell string");
      if (/^(cmd|powershell|pwsh|sh|bash)(\.exe)?$/i.test(argv[0].split(/[\\/]/).at(-1)!)) fail("preflight shell dispatch is not supported; use executable and argv");
      finite(c.timeout_ms, 30_000, "command timeout"); refs(c.input_refs, reader!).forEach(r => capture(r.path)); executables.push(argv[0]);
    }
    if (commands.reduce((n, c) => n + c.timeout_ms, 0) > 60_000) fail("preflight command timeout total exceeds 60 seconds");
    const matrix = reader!.resolve(scope.validation_matrix_ref).record!;
    const bindings = unique(array(config.validation_bindings, "validation_bindings", true).map(v => object(v, "validation binding", ["check_id", "covers", "command_id", "assertion", "kind"])), r => string(r.check_id, "check_id"), "validation bindings");
    const matrixIds = array(matrix.checks, "matrix checks", true).map(v => typeof v === "string" ? v : string(object(v, "matrix check").check_id, "matrix check_id"));
    if (!same(bindings.map(b => b.check_id).sort(), matrixIds.sort())) fail("validation plan must map the complete frozen matrix inventory");
    for (const b of bindings) { string(b.assertion, "assertion"); if (!["behavior", "ui-visual", "ui-interaction"].includes(String(b.kind)) || !commands.some(c => c.command_id === b.command_id)) fail("validation binding kind/command unavailable"); array(b.covers, "covers", true).forEach(v => reader!.item(v)); }
    for (const ref of [...scope.acceptance_refs!, ...scope.ui_refs!]) if (!bindings.some(b => (b.covers as Row[]).some(r => same(r, ref)))) fail(`acceptance/UI denominator omitted: ${ref.item_id}`);
    if ((config.reception as Row[]).some(r => r.ui === "required") && !["ui-visual", "ui-interaction"].every(kind => bindings.some(b => b.kind === kind))) fail("UI visual and interaction validation plans both required");
  });
  check("environment", () => {
    if (!config || !grant && !draftScope) fail("configuration/actual grant unavailable");
    if (!existsSync(join(root, ".git"))) fail("grant-bound Git checkout required");
    const resources = array(config.resources, "resources", true).map(v => object(v, "resource", ["kind", "input_ref"]));
    if (!["environment", "test-data"].every(kind => resources.some(r => r.kind === kind))) fail("environment and test-data resources must be explicit");
    for (const r of resources) { if (!["environment", "test-data", "design-asset"].includes(String(r.kind))) fail("unknown resource kind"); refs([r.input_ref], reader!).forEach(r => { capture(r.path); environmentRefs.push(r); }); }
    for (const name of unique(array(config.environment_variables, "environment_variables").map(v => string(v, "environment variable")), v => v, "environment variables")) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /^AIDLC_(SESSION_BINDING|EXECUTION_GRANT|AUTONOMY_HOST)$/.test(name)) fail("invalid environment variable declaration");
      if (process.env[name] === undefined) fail(`required environment variable unavailable: ${name}`); variables.push(name);
    }
    // Only inspect existing safe ancestors. Do not create business files before admission.
    for (const prefix of grant?.executor_constraints.write_paths || []) {
      let target = realpathSync(root);
      for (const component of prefix.split("/")) { const next = join(target, component); if (!existsSync(next)) break; if (lstatSync(next).isSymbolicLink()) fail("linked write root"); target = next; }
      accessSync(target, constants.W_OK);
    }
    if(grant)executables.push(String(grant.executor_constraints.host.entrypoint));
    environment = admissionEnvironment(variables, [...new Set(executables)]);
  });
  check("host-capabilities", () => {
    if (!execute) fail("preview does not execute native host probes");
    if (checks.some(c => ["scope-policy", "execution-grant", "design-reception", "dependency-readiness", "validation-plan", "environment"].includes(c.check_id) && c.status !== "passed")) fail("native host probe prerequisites failed");
    if(!adapter&&config?.native_host_ref)adapter=createCodexAdmissionAdapter(root,config.native_host_ref);
    if (!adapter || !config || !grant) fail("HOST_CAPABILITY_UNVERIFIED: trusted native host adapter/probe unavailable; CLI presence is insufficient");
    const required = ["model-turn", "continuous-session", "budget-enforcement", ...((config.reception as Row[]).some(r => r.ui === "required") ? ["browser-dom", "browser-screenshot", "browser-interaction"] : [])];
    checkExecutionGrant(root, loadWorkflowState(root)!, sessionBinding(), ["validation-execute"]);
    const requiredWindow=(current:Row)=>config.native_host_ref?inspectExecutionWindow(root,path,current).required_ms:0;
    const reuse=reusableHostCapability(root,global!,grant,required,adapter,requiredWindow);hostReuse={mode:reuse.mode,reason:reuse.reason,qualification_scope:adapter.qualification_scope||'observation-window',freshness:reuse.freshness||null,capability_receipt_ref:reuse.receipt_ref||null,configuration_check:reuse.configuration_check||null,required_capabilities:required,continuation:reuse.continuation,fresh_probes:reuse.mode==='reused'?0:1};
    if(reuse.mode==='reused')hostObservation=reuse.observation;
    else {const nonce=randomUUID();hostObservation=adapter.observe({nonce,host:grant.executor_constraints.host,required_capabilities:required,limits:grant.resource_limits});if(hostObservation.nonce!==nonce||Date.parse(hostObservation.observed_at)<started)fail('native host probe nonce/time mismatch');}
    const deadline=Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000);
    validateHostObservation(hostObservation!,grant.executor_constraints.host,grant.resource_limits,required,deadline,reuse.freshness?Date.parse(hostObservation!.observed_at):Date.now());
    windowCompatibility=inspectExecutionWindow(root,path,grant,reuse.freshness||hostObservation);
    for (const key of required) {
      const c = hostObservation!.capabilities[key]; if (!c || c.status !== "supported") fail(`required host capability ${key} is ${c?.status || "unknown"}`);
      refs(c.probe_refs, reader!).forEach(r => { capture(r.path); capabilityRefs.push(r); });
    }
    if(reuse.configuration_check)refs(reuse.configuration_check.probe_refs,reader!).forEach(r=>capture(r.path));
  });
  check("execution-preflight", () => {
    if (!execute) fail("preview does not execute project commands");
    if (!grant || checks.some(c => ["scope-policy", "execution-grant", "design-reception", "dependency-readiness", "validation-plan", "environment", "host-capabilities"].includes(c.check_id) && c.status !== "passed")) fail("command execution prerequisites failed");
    for (const c of commands) {
      // Recheck actual session/permission immediately before every external side effect.
      checkExecutionGrant(root, loadWorkflowState(root)!, sessionBinding(), ["validation-execute"]);
      const result = spawnSync(c.argv[0], c.argv.slice(1), { cwd: root, env:businessCommandEnvironment(process.env), encoding: "utf8", timeout: c.timeout_ms, maxBuffer: 1024 * 1024, shell: false, windowsHide: true });
      observations.push({ command_id: c.command_id, argv_digest: digest(c.argv), exit_code: result.status, signal: result.signal, error: result.error?.message || null, stdout_digest: hash(result.stdout || ""), stderr_digest: hash(result.stderr || ""), observed_at: new Date().toISOString() });
      if (result.error || result.status !== 0 || result.signal) fail(`execution preflight failed: ${c.command_id} (${(result.error as NodeJS.ErrnoException)?.code || result.status || result.signal})`);
    }
  });
  let outcome: AdmissionOutcome = checks.every(c => c.status === "passed" || c.status === "not-applicable") ? decisions!.decisions.length ? "ready-with-delegated-decisions" : "ready" : "not-ready";
  // Preview and all failed checks use the same three-result vocabulary, with explicit unevaluated checks.
  const now = Date.now(), ttl = Number.isSafeInteger(config?.lifetime_seconds) && config.lifetime_seconds > 0 && config.lifetime_seconds <= 900 ? config.lifetime_seconds : 900;
  const hostExpiry = Date.parse(hostReuse.freshness?.valid_until || hostObservation?.valid_until || "");
  const validUntil = Math.min(started + ttl * 1000, grant ? Date.parse(grant.expires_at) : started + 900_000, Number.isFinite(hostExpiry) && hostExpiry > now ? hostExpiry : started + 900_000);
  if (validUntil <= now) outcome = "not-ready";
  let continuation:Row=decideExecutionContinuation({now,deadline_at:grant?Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000):NaN,available_until:validUntil,status:outcome==='not-ready'?'blocked':'current',refreshable:false,phase:'admission-completion'});
  if(execute&&grant&&outcome!=='not-ready'){
    try{const window=config.native_host_ref?inspectExecutionWindow(root,path,grant):{required_ms:0};continuation=decideExecutionContinuation({deadline_at:Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000),required_ms:window.required_ms,available_until:Math.min(validUntil,hostExpiry),refreshable:false,refresh_attempts:hostReuse.fresh_probes||0,phase:'publication'});}
    catch(error){continuation={schema:'aidlc.execution-continuation/v1',decision:'stop',reason:String(error),phase:'admission-completion',execution_authorized:false};}
    if(continuation.decision!=='continue'){outcome='not-ready';Object.assign(checks.find(c=>c.check_id==='host-capabilities')!,{status:'failed',reason:'HOST_CAPABILITY_CONTINUATION_STOP: '+continuation.reason});}
  }
  return { schema: "aidlc.admission-receipt/v1", admission_result: outcome, preview: !execute, batch_ref: global?.autonomy_batch || null, grant_ref: global?.execution_grant_ref || null, policy_ref: scope?.policy_ref || null,
    baseline_inputs: [...inputs.values()], unit_definition_digests: scope?.units?.map(u => u.unit_ref) || [], dependency_versions: dependencyPlan?.dependencies || [], dependency_plan: dependencyPlan || null, environment_refs: environmentRefs, capability_probe_refs: [...new Map(capabilityRefs.map(ref => [json(ref), ref])).values()], host_observation: hostObservation || null,
    command_config_digest: configDigest || null, checks, host_window_compatibility:windowCompatibility, host_capability_reuse:hostReuse, execution_continuation:continuation, delegated_decision_refs: decisions?.decisions.map(d => ({ decision_id: d.decision_id, effective_revision: d.effective_revision })) || [], decision_digest: decisionDigest || null,
    environment_variables: variables, executables: [...new Set(executables)], environment_binding: environment || null,
    command_observations: observations, issued_at: new Date(now).toISOString(), valid_until: new Date(validUntil).toISOString(),
    producer: { name: "loeyae-aidlc-admission", mode: "controlled", execution_id: randomUUID() }, checker: { id: "builtin:autonomous-admission", version: "1" }, checker_digest: checkerDigest, execution_authorized: false, business_verified: false };
}
/** Execute first, then publish under fixed workflow-file order followed by grant-control lock.
 * This grants no sibling business writes; only the global coordinator owns the receipt. */
export function runAutonomousAdmission(root: string, path: string, adapter?: AdmissionHostAdapter): Row {
  const report = evaluate(root, path, true, adapter), global = loadWorkflowState(root);
  if (!global?.execution_grant_version || report.checks.some((c: AdmissionCheck) => ["scope-policy", "execution-grant"].includes(c.check_id) && c.status !== "passed")) return { ...report, receipt_ref: null };
  const paths = [...new Set([...loadWorkflowParts(root).parts.values()].map(p => lightStatePath(root, p.ref)))].sort();
  const lock = (i: number): Row => i < paths.length ? withWorkflowFileLock(paths[i], () => lock(i + 1)) : withGrantControl(root, () => {
    const current = loadWorkflowState(root)!, binding = sessionBinding()!;
    assertSessionClaim(root, current, binding.stage_instance, binding);
    checkExecutionGrant(root, current, binding, ["evidence-publish"]);
    projectAutonomyScope(root, current); projectAutonomyDecisions(root);
    if (report.dependency_plan) projectAutonomyDependencies(root, { session_id: binding.session_id });
    if (!same(current.autonomy_batch, report.batch_ref) || !same(current.execution_grant_ref, report.grant_ref) || report.decision_digest !== admissionDecisions(root) || report.checker_digest !== semanticCheckerDigest(true)) fail("sources changed during preflight; rerun");
    validateGrantInputs(root, report.baseline_inputs);
    if (report.environment_binding && !same(report.environment_binding, admissionEnvironment(report.environment_variables, report.executables))) fail("environment changed during preflight");
    if (Date.now() >= Date.parse(report.valid_until)) fail("preflight evidence expired before publication");
    const required=report.host_capability_reuse.required_capabilities||[],grant=readIssuedGrant(root,current.execution_grant_ref!).grant;
    const minimumWindow=report.admission_result!=='not-ready'?inspectExecutionWindow(root,path,grant).required_ms||0:0;
    if(report.admission_result!=='not-ready'){
      const continuation=decideExecutionContinuation({deadline_at:Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000),required_ms:minimumWindow,available_until:Math.min(Date.parse(report.valid_until),Date.parse(report.host_capability_reuse.freshness?.valid_until||report.host_observation?.valid_until)),refreshable:false,refresh_attempts:report.host_capability_reuse.fresh_probes||0,phase:'publication'});
      if(continuation.decision!=='continue')throw Object.assign(Error('HOST_CAPABILITY_CONTINUATION_STOP: '+continuation.reason),{continuation});
      report.execution_continuation=continuation;
    }
    if(report.host_capability_reuse.mode==='reused'){
      const capability=readHostCapabilityReport(root,current);if(!capability||!same(capability.receipt_ref,report.host_capability_reuse.capability_receipt_ref)||capabilityReuseReason(capability,current,grant,required,Date.now(),minimumWindow))fail('host capability changed before publication');
      validateGrantInputs(root,capability.probe_inputs);
    }else if(report.checks.find((c:AdmissionCheck)=>c.check_id==='host-capabilities')?.status==='passed'&&/^[a-f0-9]{64}$/.test(report.host_observation?.configuration_digest||'')){
      report.host_capability_reuse.capability_receipt_ref=storeHostCapabilityReport(root,current,{schema:'aidlc.host-capability-receipt/v1',qualification_scope:report.host_capability_reuse.qualification_scope,batch_ref:current.autonomy_batch,grant_ref:current.execution_grant_ref,grant_constraints_digest:digest(grant),checker_digest:hostCapabilityCheckerDigest(),observation:report.host_observation,probe_inputs:report.capability_probe_refs,issued_at:new Date().toISOString()});
    }
    return { ...report, receipt_ref: storeAdmissionReport(root, current, report) };
  });
  try { return lock(0); }
  catch (error) {
    const reason = String(error instanceof Error ? error.message : error);
    const continuation=(error as Row)?.continuation||{schema:'aidlc.execution-continuation/v1',decision:'stop',reason,phase:'publication',execution_authorized:false};
    return { ...report, admission_result: "not-ready", receipt_ref: null, execution_continuation:continuation, checks: report.checks.map((c: AdmissionCheck) => c.check_id === ((error as Row)?.continuation?'host-capabilities':"scope-policy") ? { ...c, status: "failed", reason } : c), publication_error: reason };
  }
}
export function admissionProjection(root: string): Row {
  const global = loadWorkflowState(root); if (!global?.autonomy_contract_version) return { enabled: false, admission_result: "not-ready", execution_authorized: false };
  try { const report = assertAdmissionReceipt(root, global)!; projectAutonomyDependencies(root); return { enabled: true, ...report, execution_authorized: false, business_verified: false }; }
  catch (e) { return { enabled: true, admission_result: "not-ready", reason: String(e instanceof Error ? e.message : e), execution_authorized: false, business_verified: false }; }
}
/** Explicit draft context; no synthetic adopted state, credentials, native gates or publication. */
export function previewAutonomyDraft(root:string,batchId:string,path:string,observationsPath?:string,grantRequestPath?:string):Row {
  const global=loadWorkflowState(root);if(!global||global.workflow_kind==='module'||global.workflow_kind==='integration')fail('draft requires an existing global workflow');
  if(global.autonomy_contract_version)fail('draft is pre-adoption only; use admission run --preview for an adopted batch');
  const scope=readAutonomyBatch(root,global,batchId),report=evaluate(root,path,false,undefined,scope),checks=report.checks as AdmissionCheck[];
  let observationPlan:Row|null=null;
  const plan=JSON.parse(readFileSync(safeFile(root,path),'utf8'));
  if(plan.native_host_ref){try{if(!grantRequestPath)throw Error('HOST_GRANT_WINDOW_UNVERIFIED: provide --grant-request for selected host');const file=safeFile(root,grantRequestPath),bytes=readFileSync(file),ref={path:grantRequestPath,digest:hash(bytes),repository_id:'project',digest_mode:'raw-file'};if(!scope.baseline_inputs!.some(r=>r.path===ref.path&&r.digest===ref.digest&&r.digest_mode==='raw-file'))fail('grant request must be a frozen draft input');const window=inspectExecutionWindow(root,path,JSON.parse(bytes.toString()));checks.push({check_id:'handoff-window',required:true,status:'passed',reason:JSON.stringify(window),input_refs:[ref as any]});}catch(error){checks.push({check_id:'handoff-window',required:true,status:'failed',reason:String(error),input_refs:[]});}}
  if(observationsPath){try{observationPlan=previewObservationPlan(root,observationsPath,scope);checks.push({check_id:'observation-plan',required:true,status:'passed',reason:'complete frozen observation semantics checked without execution',input_refs:observationPlan.source_refs});}catch(error){checks.push({check_id:'observation-plan',required:true,status:'failed',reason:String(error),input_refs:[]});}}
  return {schema:'aidlc.autonomy-draft-preflight/v1',validation_level:'draft-static',enabled:false,batch_ref:scope.snapshot,static_result:checks.some(c=>c.status==='failed')?'invalid':'valid',checks,source_refs:report.baseline_inputs,observation_plan:observationPlan,admission_result:'not-ready',execution_authorized:false,gates_evaluated:false,commands_executed:false,probes_executed:false,business_verified:false,pending_validation:['explicit-adoption','execution-grant-and-live-claim','dependency-native-provenance-and-runtime','current-host-capabilities','execution-preflight','final-acceptance']};
}
export function admissionDirective(root: string, args: string[]): Row {
  const [action, ...rest] = args;
  if(action==='draft'){
    const flags:Record<string,string>={};if(rest.length%2)fail('use admission draft --batch <id> --input <plan.json> [--observations <plan.json>] [--grant-request <request.json>]');for(let i=0;i<rest.length;i+=2){if(!['--batch','--input','--observations','--grant-request'].includes(rest[i])||flags[rest[i]]!==undefined||!rest[i+1]||rest[i+1].startsWith('--'))fail('use admission draft with unique known options');flags[rest[i]]=rest[i+1];}if(!flags['--batch']||!flags['--input'])fail('use admission draft --batch <id> --input <plan.json>');
    return {kind:'print',autonomy_draft:previewAutonomyDraft(root,flags['--batch'],flags['--input'],flags['--observations'],flags['--grant-request']),message:'Read-only pre-adoption semantics only; no grant, readiness, claim or evidence publication.'};
  }
  if (action === "inspect" && rest.length === 0) return { kind: "print", autonomous_admission: admissionProjection(root), message: "Admission is separate from execution authorization and final acceptance." };
  if (action === "check" && rest.length === 0) { const global = loadWorkflowState(root); if (!global?.execution_grant_version) fail("managed grant required"); checkExecutionGrant(root, global, sessionBinding(), []); return { kind: "print", autonomous_admission: assertAdmissionReceipt(root, global) }; }
  if (action !== "run" || rest[0] !== "--input" || !rest[1] || ![2, 3].includes(rest.length) || rest.length === 3 && rest[2] !== "--preview") fail("use admission inspect|check|run --input <frozen-plan.json> [--preview]");
  return { kind: "print", autonomous_admission: rest.includes("--preview") ? previewAutonomousAdmission(root, rest[1]) : runAutonomousAdmission(root, rest[1]), message: "Only a managed ready receipt permits controlled implementation; unknown capabilities remain not-ready." };
}
