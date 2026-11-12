/** P1-07 actual command/HTTP/browser observations. Does not decide batch completion. */
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, lstatSync, existsSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from 'node:perf_hooks';
import {createRequire} from 'node:module';
const R=createRequire(import.meta.url)('./aidlc-owned-resource.cjs');
import { ScopeReader, projectAutonomyScope, type AutonomyScopeProjection } from "./aidlc-autonomy";
import {
  array,
  object,
  string,
  unique,
  canonicalAutonomyJson as json,
  autonomyDigest as digest,
  safeFile,
} from "./aidlc-autonomy-files";
import { loadWorkflowState, sessionBinding, withSessionPublication } from "./aidlc-light-state";
import { checkCurrentExecutionGrant } from "./aidlc-execution-grant";
import {
  assertAdmissionReceipt,
  admissionEnvironment,
  readIssuedGrant,
  storeObservationReport,
} from "./aidlc-grant-store";
import {
  candidateSnapshot,
  assertCandidate,
  assertions,
  compareScreenshots,
  currentObservations,
  observationCheckerDigest,
  observationHash as hash,
} from "./aidlc-observation-inputs";
import { createBrowserObserver } from "./aidlc-observation-browser";
import {startCaseService} from './aidlc-observation-service';
import { dependencyRecords, unitExtensionPath } from "./aidlc-dependency-inputs";
import { readModuleManifest } from "./aidlc-execution-context";
import { businessCommandEnvironment } from "./aidlc-spawn";
type Row = Record<string, any>;
const same = (a: unknown, b: unknown) => json(a) === json(b);
const bounded = (n: any, max: number) => {
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw Error("OBSERVATION_LIMIT_INVALID");
  return n;
};
function prepare(root: string, path: string, draftScope?: AutonomyScopeProjection): Row {
  const global = loadWorkflowState(root)!;
  if (!global || !global.autonomy_contract_version && !draftScope) throw Error("OBSERVATION_ADOPTION_REQUIRED");
  const scope = draftScope || projectAutonomyScope(root),
    reader = new ScopeReader(root, global),
    source = new Map<string, Row>();
  const capture = (path: string) => {
    const r = {
      repository_id: "project",
      path,
      digest_mode: "raw-file",
      digest: hash(readFileSync(safeFile(root, path))),
    };
    source.set(path, r);
    return r;
  };
  const planRef = capture(path);
  if (!scope.baseline_inputs!.some((r) => same(r, planRef))) throw Error("OBSERVATION_PLAN_NOT_FROZEN");
  const p = object(JSON.parse(readFileSync(safeFile(root, path), "utf8")), "observation plan", [
    "schema",
    "batch_id",
    "scope_revision",
    "lifetime_seconds",
    "environment_ref",
    "candidate_artifact_paths",
    "ui_applicability",
    "checks",
  ]);
  if (
    p.schema !== "aidlc.observation-plan/v1" ||
    p.batch_id !== scope.snapshot!.batch_id ||
    p.scope_revision !== scope.snapshot!.scope_revision
  )
    throw Error("OBSERVATION_PLAN_SCOPE_INVALID");
  bounded(p.lifetime_seconds, 300);
  const input = (v: any) => {
    const r = reader.resolve(v).ref;
    capture(r.path);
    return r;
  };
  input(p.environment_ref);
  const environment = object(
    JSON.parse(readFileSync(safeFile(root, (p.environment_ref as Row).path), "utf8")),
    "environment",
    ["schema", "isolated", "endpoints", "variables", "inputs", "browser", "case_service"],
  );
  if (environment.schema !== "aidlc.observation-environment/v1" || environment.isolated !== true)
    throw Error("ISOLATED_VALIDATION_ENVIRONMENT_REQUIRED");
  array(environment.inputs, "environment inputs").forEach(input);
  const variables = unique(
    array(environment.variables, "environment variables").map((v) => string(v, "environment variable")),
    (v) => v,
    "variables",
  );
  for (const key of variables)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /^AIDLC_/.test(key) || process.env[key] === undefined)
      throw Error("OBSERVATION_ENVIRONMENT_VARIABLE_INVALID");
  const endpoints = object(environment.endpoints, "endpoints"),
    resolved: Row = {};
  for (const [key, value] of Object.entries(endpoints)) {
    const e = object(value, "endpoint", ["origin", "version_path", "header_variables", "kind"]);
    if (!["candidate", "external"].includes(String(e.kind))) throw Error("ENDPOINT_OWNERSHIP_REQUIRED");
    const origin = string(e.origin, "origin").replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, k) => {
      if (!variables.includes(k)) throw Error("UNDECLARED_ENVIRONMENT_VARIABLE");
      return process.env[k]!;
    });
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin !== origin)
      throw Error("OBSERVATION_ENDPOINT_INVALID");
    const headers: Row = {};
    for (const [header, name] of Object.entries(object(e.header_variables, "header variables"))) {
      if (typeof name !== "string" || !variables.includes(name) || /[\r\n]/.test(process.env[name]!))
        throw Error("OBSERVATION_AUTH_VARIABLE_INVALID");
      headers[header] = process.env[name];
    }
    resolved[key] = { ...e, origin, headers };
  }
  if(environment.case_service){const service=object(environment.case_service,'case_service',['argv','timeout_ms','input_refs']);const argv=array(service.argv,'case service argv',true).map(v=>string(v,'argv element'));if(!isAbsolute(argv[0])||!lstatSync(argv[0]).isFile()||lstatSync(argv[0]).isSymbolicLink()||/^(cmd|powershell|pwsh|sh|bash)(\.exe)?$/i.test(argv[0].split(/[\\/]/).at(-1)!))throw Error('CASE_SERVICE_EXECUTABLE_INVALID');bounded(service.timeout_ms,5000);array(service.input_refs,'case service inputs',true).forEach(input);}
  const applicability = object(p.ui_applicability, "UI applicability", ["kind", "source_refs"]);
  array(applicability.source_refs, "UI applicability sources", true).forEach(input);
  if (
    !["required", "none"].includes(String(applicability.kind)) ||
    Boolean(scope.ui_refs!.length) !== (applicability.kind === "required")
  )
    throw Error("UI_APPLICABILITY_CONFLICT");
  const matrix = reader.resolve(scope.validation_matrix_ref).record!,
    ids = (matrix.checks as any[]).map((c) => (typeof c === "string" ? c : c.check_id));
  const checks = unique(
    array(p.checks, "checks", true).map(
      (v) =>
        object(v, "check", [
          "check_id",
          "kind",
          "covers",
          "endpoint",
          "path",
          "method",
          "body",
          "expected_status",
          "assertions",
          "argv",
          "timeout_ms",
          "dependency_id",
          "page_ref",
          "combination_id",
          "viewport",
          "state",
          "role",
          "initial_expectations",
          "steps",
          "expectations",
          "baseline_ref",
          "design_refs",
          "tolerance",
        ]) as Row,
    ),
    (c) => String(c.check_id),
    "checks",
  );
  if (checks.length !== ids.length || ids.some((id) => !checks.some((c) => c.check_id === id)))
    throw Error("OBSERVATION_MATRIX_INCOMPLETE");
  const executables: string[] = [];
  const edges = scope.dependency_refs!.map((ref) => {
    const { item_id, ...input } = ref;
    return reader.resolve(input).record!;
  });
  for (const c of checks) {
    c.covers = reader.items(c.covers, "acceptance coverage", true);
    if (c.covers.some((r: any) => !scope.acceptance_refs!.some((a) => same(a, r))))
      throw Error("OBSERVATION_UNKNOWN_ACCEPTANCE");
    if (!["command", "http", "ui"].includes(String(c.kind))) throw Error("OBSERVATION_KIND_INVALID");
    if (c.kind === "command") {
      c.argv = array(c.argv, "argv", true).map((v) => string(v, "argument"));
      if (!isAbsolute(c.argv[0]) || !lstatSync(c.argv[0]).isFile() || lstatSync(c.argv[0]).isSymbolicLink())
        throw Error("OBSERVATION_COMMAND_INVALID");
      executables.push(c.argv[0]);
      bounded(c.timeout_ms, 60000);
      assertions(c.assertions, {});
    } else {
      if (!resolved[String(c.endpoint)]) throw Error("OBSERVATION_ENDPOINT_MISSING");
      requestUrl(resolved[String(c.endpoint)], String(c.path));
      if (!resolved[String(c.endpoint)].version_path) throw Error("SERVING_VERSION_REQUIRED");
      requestUrl(resolved[String(c.endpoint)], resolved[String(c.endpoint)].version_path);
    }
    if (c.kind === "http") {
      if (!["GET", "POST"].includes(String(c.method)) || !Number.isInteger(c.expected_status))
        throw Error("OBSERVATION_HTTP_SCHEMA_INVALID");
      assertions(c.assertions, {});
    }
    if (c.dependency_id) {
      const edge = edges.find((e) => e.dependency_id === c.dependency_id);
      if (!edge || c.kind !== "http") throw Error("DEPENDENCY_OBSERVATION_INVALID");
      const endpoint = resolved[String(c.endpoint)];
      if (!endpoint.version_path) throw Error("DEPENDENCY_VERSION_ENDPOINT_REQUIRED");
      requestUrl(endpoint, endpoint.version_path);
      c.dependency_binding = {
        dependency_id: edge.dependency_id,
        provider: edge.provider,
        consumer: edge.consumer,
        capability_ref: edge.capability_ref,
        required_state: edge.required_state,
      };
      const capability = readModuleManifest(root)
        .flatMap((module) => dependencyRecords(root, unitExtensionPath(module.module_id)))
        .find(
          (r) =>
            r.record_type === "capability" &&
            r.capability_id === (edge.capability_ref as Row).capability_id &&
            same(r.provider_ref, edge.provider),
        );
      if (!capability) throw Error("DEPENDENCY_CAPABILITY_SOURCE_MISSING");
      array(capability.artifact_refs, "capability inputs", true).forEach(input);
    }
    if (
      ["command", "http"].includes(String(c.kind)) &&
      !array(c.assertions, "assertions", true).some(
        (a: any) => a.op !== "equal" || (a.expected !== null && typeof a.expected !== "boolean"),
      )
    )
      throw Error("SUBSTANTIVE_FUNCTION_ASSERTION_REQUIRED");
    if (c.kind === "ui") {
      if (applicability.kind !== "required") throw Error("UI_OBSERVATION_NOT_APPLICABLE");
      c.page_ref = reader.items([c.page_ref], "page refs", true)[0];
      if (!scope.ui_refs!.some((r) => same(r, c.page_ref))) throw Error("UNKNOWN_UI_PAGE");
      const combos = array(matrix.ui_combinations, "matrix UI combinations", true) as Row[];
      if (
        !combos.some(
          (r) =>
            r.combination_id === c.combination_id &&
            same(r.page_ref, c.page_ref) &&
            same(r.viewport, c.viewport) &&
            r.state === c.state &&
            r.role === c.role,
        )
      )
        throw Error("UI_COMBINATION_NOT_FROZEN");
      const vp = object(c.viewport, "viewport", ["width", "height"]);
      bounded(vp.width, 2000);
      bounded(vp.height, 2000);
      string(c.state, "UI state");
      string(c.role, "UI role");
      const expectations = (v: any) =>
        array(v, "DOM expectations", true).map((x) => {
          const e = object(x, "DOM expectation", ["selector", "property", "name", "expected"]);
          string(e.selector, "selector");
          if (
            !["exists", "text", "value", "disabled", "visible", "attribute"].includes(String(e.property)) ||
            e.expected === undefined ||
            (e.property === "attribute" && typeof e.name !== "string")
          )
            throw Error("DOM_EXPECTATION_INVALID");
          return e;
        });
      c.initial_expectations = expectations(c.initial_expectations);
      c.expectations = expectations(c.expectations);
      const combo = combos.find((r) => r.combination_id === c.combination_id)!;
      c.steps = array(c.steps, "UI steps").map((v) => {
        const s = object(v, "UI step", ["action", "selector", "text", "expectations"]);
        if (!["click", "type"].includes(String(s.action)) || (s.action === "type" && typeof s.text !== "string"))
          throw Error("UI_STEP_INVALID");
        string(s.selector, "selector");
        s.expectations = expectations(s.expectations);
        return s;
      });
      const selectors = array(combo.required_selectors, "required UI selectors", true).map((s) =>
        string(s, "required selector"),
      );
      const observedSelectors = [
        ...(c.initial_expectations as Row[]),
        ...(c.expectations as Row[]),
        ...(c.steps as Row[]).flatMap((s) => s.expectations),
      ].map((e) => e.selector);
      if (
        selectors.some((s) => !observedSelectors.includes(s)) ||
        !same(
          combo.required_actions,
          (c.steps as Row[]).map((s) => ({ action: s.action, selector: s.selector })),
        ) ||
        !same(combo.baseline_ref, c.baseline_ref) ||
        !same(combo.tolerance, c.tolerance)
      )
        throw Error("UI_CONTENT_ACTION_OR_BASELINE_INCOMPLETE");
      input(c.baseline_ref);
      array(c.design_refs, "design sources", true).forEach(input);
      compareScreenshots(
        readFileSync(safeFile(root, (c.baseline_ref as Row).path)),
        readFileSync(safeFile(root, (c.baseline_ref as Row).path)),
        c.tolerance as Row,
      );
      if (
        typeof environment.browser !== "string" ||
        !isAbsolute(environment.browser) ||
        !lstatSync(environment.browser).isFile()
      )
        throw Error("OBSERVATION_BROWSER_REQUIRED");
      executables.push(environment.browser);
    }
  }
  if (scope.acceptance_refs!.some((a) => !checks.some((c) => (c.covers as any[]).some((r) => same(r, a)))))
    throw Error("ACCEPTANCE_DENOMINATOR_INCOMPLETE");
  if (applicability.kind === "required") {
    const combos = array(matrix.ui_combinations, "matrix UI combinations", true) as Row[];
    if (
      combos.length !== checks.filter((c) => c.kind === "ui").length ||
      combos.some((r) => checks.filter((c) => c.combination_id === r.combination_id).length !== 1)
    )
      throw Error("UI_MATRIX_INCOMPLETE");
    if (
      scope.ui_refs!.some(
        (r) => !checks.some((c) => c.kind === "ui" && same(c.page_ref, r) && (c.steps as any[]).length),
      )
    )
      throw Error("UI_INTERACTION_COVERAGE_MISSING");
  } else {
    for (const module of new Set(scope.units!.map((u) => u.unit_ref.module_id))) {
      const path = `docs/aidlc/modules/${module}/inception/technical-review.json`,
        review = JSON.parse(readFileSync(safeFile(root, path), "utf8"));
      if (review.autonomous_reception?.ui !== "none") throw Error("TRUSTED_NO_UI_RECEPTION_REQUIRED");
      capture(path);
    }
  }
  return {
    global,
    scope,
    plan: p,
    checks,
    environment,
    resolved,
    source_refs: [...source.values()],
    variables,
    executables: [...new Set([...executables,...(environment.case_service?[(environment.case_service as Row).argv[0]]:[])])],
  };
}
function requestUrl(endpoint: Row, path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) throw Error("OBSERVATION_PATH_INVALID");
  const url = new URL(path, endpoint.origin);
  if (url.origin !== endpoint.origin) throw Error("OBSERVATION_ORIGIN_MISMATCH");
  return url.href;
}
async function http(endpoint: Row, path: string, method = "GET", body?: unknown, remainingMs=5000) {
  if(remainingMs<=0)throw Error('HTTP_OBSERVATION_DEADLINE');
  const started = Date.now();
  const r = await fetch(requestUrl(endpoint, path), {
    method,
    headers: { ...endpoint.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(Math.max(1,Math.min(5000,Math.floor(remainingMs)))),
    redirect: "error",
  });
  const text = await r.text();
  if (Buffer.byteLength(text) > 1048576) throw Error("HTTP_OBSERVATION_LIMIT");
  return { status: r.status, body: JSON.parse(text), elapsed_ms: Date.now() - started };
}
async function command(root: string, argv: string[], timeout: number) {
  return await R.runCommand(argv,{cwd:root,env:businessCommandEnvironment(process.env),timeout_ms:timeout,owner:'core-observation'});
}
/** Validate frozen plan semantics without executing commands, opening browsers or publishing receipts. */
export function previewObservationPlan(root: string, path: string, draftScope?: AutonomyScopeProjection): Row {
  const x = prepare(root, path, draftScope);
  return {
    kind: "observation-plan-validation",
    batch_ref: x.scope.snapshot,
    check_ids: x.checks.map((c: Row) => c.check_id),
    ui_combination_ids: x.checks.filter((c: Row) => c.kind === "ui").map((c: Row) => c.combination_id),
    source_refs: x.source_refs,
    execution_authorized: false,
    observations_executed: false,
    business_verified: false,
  };
}
export async function runObservations(root: string, path: string, dependencyPreflight = false): Promise<Row> {
  const timingOrigin=performance.now();
  checkCurrentExecutionGrant(root, ["validation-execute", "evidence-publish"]);
  const binding = sessionBinding()!;
  if (binding.stage_instance.includes("@")) throw Error("OBSERVATION_REQUIRES_GLOBAL_COORDINATOR");
  const x = prepare(root, path);
  if (!dependencyPreflight) assertAdmissionReceipt(root, x.global);
  const checks = dependencyPreflight
    ? (x.checks as Row[]).filter((c) => c.kind === "http" && c.dependency_binding?.provider.external_id)
    : (x.checks as Row[]);
  if (!checks.length)
    return { coverage: "dependency-preflight", status: "not-applicable", business_verified: false, observations: [] };
  const grant = readIssuedGrant(root, x.global.execution_grant_ref!).grant;
  const paths = dependencyPreflight
    ? [path]
    : array(x.plan.candidate_artifact_paths, "candidate paths", true).map((v) => string(v, "candidate path"));
  const candidate = candidateSnapshot(root, paths, dependencyPreflight),
    environment_binding = admissionEnvironment(x.variables, x.executables),
    checker_digest = observationCheckerDigest(),
    started = Date.now(),
    attempt = randomUUID();
  const directory = `.aidlc/evidence/autonomous-observations/${x.scope.snapshot.batch_id}/${x.scope.snapshot.scope_revision}/raw/${attempt}`;
  for (let p = join(root, directory); p !== root; p = dirname(p))
    if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw Error("LINKED_OBSERVATION_OUTPUT");
  mkdirSync(join(root, directory), { recursive: true });
  const raw_refs: Row[] = [],
    observations: Row[] = [],
    runtime_checks: Row[] = [], resourceIssues: Row[] = [];
  const raw = (name: string, value: string | Buffer) => {
    const path = `${directory}/${name}`;
    writeFileSync(join(root, path), value, { flag: "wx" });
    const ref = {
      repository_id: "project",
      path,
      digest_mode: "raw-file",
      digest: hash(readFileSync(safeFile(root, path))),
    };
    raw_refs.push(ref);
    return ref;
  };
  const valid_until = new Date(
    Math.min(
      started + Number(x.plan.lifetime_seconds) * 1000,
      Date.parse(grant.expires_at),
      Date.parse(grant.request_started_at) + grant.resource_limits.wall_time_seconds * 1000,
    ),
  ).toISOString();
  let browserObserver:ReturnType<typeof createBrowserObserver>|undefined,browserClosed:any;
  try{
  for (const [index, c] of checks.entries()) {
    checkCurrentExecutionGrant(root, ["validation-execute"]);
    if (Date.now() >= Date.parse(valid_until)) throw Error("OBSERVATION_BUDGET_EXPIRED");
    const began = new Date().toISOString();
    const checkStarted=performance.now();
    let details: Row = {},
      passed = false;
    try {
      if(resourceIssues.length)throw Object.assign(Error('SKIPPED_AFTER_RESOURCE_UNKNOWN'),{resource_reconciliation:{reconciled:false,resources:resourceIssues}});
      if (c.kind === "command") {
        const actual = await command(root, c.argv, Math.min(c.timeout_ms, Date.parse(valid_until) - Date.now()));
        if(actual.resource_reconciliation?.reconciled===false)throw Object.assign(Error('OBSERVATION_COMMAND_RESOURCES_UNRECONCILED'),{resource_reconciliation:actual.resource_reconciliation});
        const values = actual.exit_code === 0 && !actual.error ? JSON.parse(actual.stdout) : {};
        const checks = assertions(c.assertions, values);
        details = { ...actual, argv_digest: digest(c.argv), assertion_results: checks };
        passed = actual.exit_code === 0 && !actual.error && checks.every((r) => r.passed);
      }
      if (c.kind === "http") {
        const e = x.resolved[c.endpoint],
          before = await http(e, e.version_path),
          actual = await http(e, c.path, c.method, c.body),
          after = await http(e, e.version_path),
          checks = assertions(c.assertions, actual.body);
        let version =
          before.status === 200 &&
          after.status === 200 &&
          same(before.body, after.body) &&
          (e.kind === "candidate"
            ? after.body.candidate_commit === candidate.repositories[0].commit
            : !!c.dependency_binding?.provider.external_id);
        if (c.dependency_binding) {
          const expected = c.dependency_binding.capability_ref.version_digest;
          version =
            version &&
            !!before &&
            !!after &&
            before.status === 200 &&
            after.status === 200 &&
            same(before.body, after.body) &&
            after.body.ready === true &&
            after.body.version_digest === expected &&
            (c.dependency_binding.provider.external_id
              ? after.body.owner === c.dependency_binding.provider.owner
              : after.body.candidate_commit === candidate.repositories[0].commit);
        }
        if (c.dependency_binding && version)
          runtime_checks.push({
            dependency_id: c.dependency_id,
            url: requestUrl(e, e.version_path),
            header_variables: e.header_variables,
            expected: {
              version_digest: after.body.version_digest,
              ready: true,
              ...(typeof after.body.candidate_commit === "string"
                ? { candidate_commit: after.body.candidate_commit }
                : {}),
              ...(c.dependency_binding.provider.external_id
                ? { owner: after.body.owner }
                : { candidate_commit: after.body.candidate_commit }),
            },
          });
        details = {
          actual,
          assertion_results: checks,
          version_before: before || null,
          version_after: after || null,
          version_verified: version,
        };
        passed = actual.status === c.expected_status && checks.every((r) => r.passed) && version;
      }
      if (c.kind === "ui") {
        let e = x.resolved[c.endpoint];
        let service:Awaited<ReturnType<typeof startCaseService>>|undefined;const serviceStart=performance.now(),uiDeadline=Math.min(Date.parse(valid_until),Date.now()+20000);
        try{if(x.environment.case_service){checkCurrentExecutionGrant(root,['validation-execute']);service=await startCaseService(root,x.environment.case_service,grant.run_id+':'+attempt+':'+c.check_id,uiDeadline);e={...e,origin:service.origin};}
        if (e.kind !== "candidate") throw Error("UI_MUST_SERVE_CANDIDATE");
        const before = await http(e, e.version_path,"GET",undefined,uiDeadline-Date.now());
        if (before.status !== 200 || before.body.candidate_commit !== candidate.repositories[0].commit)
          throw Error("UI_SERVING_CANDIDATE_MISMATCH");
        browserObserver??=createBrowserObserver(x.environment.browser,{owner:grant.run_id+':'+attempt,deadline_at:Date.parse(valid_until)});
        if(Date.now()>=uiDeadline)throw Error('UI_CASE_DEADLINE');
        const actual=await browserObserver.observe(requestUrl(e,c.path),c,uiDeadline-Date.now());
        const imageRef = raw(`${index}.png`, actual.image),
          visual = compareScreenshots(readFileSync(safeFile(root, c.baseline_ref.path)), actual.image, c.tolerance);
        delete actual.image;
        details = {
          ...actual,
          screenshot_ref: imageRef,
          visual,
          baseline_ref: c.baseline_ref,
          page_ref: c.page_ref,
          state: c.state,
          role: c.role,
          combination_id: c.combination_id,
        };
        const after = await http(e, e.version_path,"GET",undefined,uiDeadline-Date.now());
        details.version_before = before;
        details.version_after = after;
        passed = actual.passed && visual.passed && after.status === 200 && same(before.body, after.body);
        }finally{if(service){const closed=await service.close();details.case_service={origin:service.origin,startup_ms:service.startup_ms,total_ms:performance.now()-serviceStart,resource:closed};if(!closed.reconciled)throw R.resourceError(closed);}}
      }
    } catch (e) {
      passed=false;const facts=(e as any)?.resource_reconciliation;
      if(facts?.reconciled===false)for(const resource of facts.resources||[])if(!resourceIssues.some(r=>r.resource_id===resource.resource_id&&r.kind===resource.kind))resourceIssues.push(resource);
      details = { error: String(e),...(facts?{resource_reconciliation:facts}:{}) };
    }
    const raw_output_ref = raw(`${index}.json`, JSON.stringify(details) + "\n");
    observations.push({
      observation_id: randomUUID(),
      check_id: c.check_id,
      kind: c.kind,
      covers: c.covers,
      status: passed ? "passed" : "failed",
      candidate_ref: candidate,
      environment_ref: x.plan.environment_ref,
      started_at: began,
      ended_at: new Date().toISOString(),
      timing: {clock:'monotonic',offset_ms:checkStarted-timingOrigin,duration_ms:performance.now()-checkStarted},
      raw_output_ref,
      ...(c.dependency_binding ? { dependency_binding: c.dependency_binding } : {}),
      ...(c.kind === "ui" ? { combination_id: c.combination_id, page_ref: c.page_ref } : {}),
      assertions_passed: passed,
    });
  }
  }finally{if(browserObserver){browserClosed=await browserObserver.close();if(!browserClosed.reconciled){resourceIssues.push(...browserClosed.resources.filter((r:any)=>r.reconciled===false));R.announceResourceFailure(browserClosed);}}}
  const body: Row = {
    schema: "aidlc.observation-bundle/v1",
    workflow_id: x.global.workflow_id,
    batch_ref: x.global.autonomy_batch,
    grant_ref: x.global.execution_grant_ref,
    candidate_ref: candidate,
    environment_ref: x.plan.environment_ref,
    environment_binding,
    environment_variables: x.variables,
    executables: x.executables,
    source_refs: x.source_refs,
    raw_refs,
    observations,
    runtime_checks,
    browser_reuse:browserClosed?{scope:'single-observation-bundle',...browserClosed}:{metrics:{browser_startups:0}},
    resource_reconciliation:{reconciled:resourceIssues.length===0,resources:resourceIssues},
    timing: {clock:'monotonic',duration_ms:performance.now()-timingOrigin,publication_excluded:true},
    started_at: new Date(started).toISOString(),
    ended_at: new Date().toISOString(),
    valid_until,
    checker_digest,
    producer: {
      name: "loeyae-aidlc-observations",
      mode: "controlled",
      execution_id: attempt,
      stage_instance: binding.stage_instance,
    },
    coverage: dependencyPreflight ? "dependency-preflight" : "matrix",
    status: resourceIssues.length===0&&observations.every((o) => o.status === "passed") ? (dependencyPreflight ? "partial" : "passed") : "failed",
    business_verified: false,
  };
  return withSessionPublication(
    root,
    { kind: "global" },
    binding.stage_instance,
    () => {
      checkCurrentExecutionGrant(root, ["evidence-publish"]);
      if (
        Date.now() >= Date.parse(valid_until) ||
        checker_digest !== observationCheckerDigest() ||
        !same(x.global.autonomy_batch, loadWorkflowState(root)!.autonomy_batch)
      )
        throw Error("OBSERVATION_PUBLICATION_CHANGED");
      assertCandidate(root, candidate, dependencyPreflight);
      for (const ref of [...x.source_refs, ...raw_refs])
        if (hash(readFileSync(safeFile(root, ref.path))) !== ref.digest)
          throw Error("OBSERVATION_SOURCE_OR_RAW_CHANGED");
      if (!same(environment_binding, admissionEnvironment(x.variables, x.executables)))
        throw Error("OBSERVATION_ENVIRONMENT_CHANGED");
      return { ...body, receipt_ref: storeObservationReport(root, loadWorkflowState(root)!, body) };
    },
    binding,
  );
}
export async function observationsDirective(root: string, args: string[]): Promise<Row> {
  if (args.length === 4 && args[0] === "run" && args[1] === "--dependency-preflight" && args[2] === "--input")
    return {
      kind: "print",
      autonomous_observations: await runObservations(root, args[3], true),
      message: "Dependency preflight only; no implementation admission or full-matrix pass.",
    };
  if (args.length === 3 && args[0] === "run" && args[1] === "--input")
    return {
      kind: "print",
      autonomous_observations: await runObservations(root, args[2]),
      message: "Observed checks only; candidate/batch completion remains a separate gate.",
    };
  if (args.length === 1 && args[0] === "inspect") {
    try {
      return { kind: "print", autonomous_observations: currentObservations(root, loadWorkflowState(root)) };
    } catch (e) {
      return {
        kind: "print",
        autonomous_observations: { status: "unverified", reason: String(e), business_verified: false },
      };
    }
  }
  throw Error("use autonomy observe run [--dependency-preflight] --input <frozen-plan.json>|inspect");
}
