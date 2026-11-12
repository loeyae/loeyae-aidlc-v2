/** Core bridge to a reviewed Harness runtime. No model loop or authoring capability receipts here. */
import { existsSync, readFileSync, mkdirSync, writeFileSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash,randomUUID } from "node:crypto";
import { safeFile, canonicalAutonomyJson as json } from "./aidlc-autonomy-files";
import { bindExecutionGrant, checkCurrentExecutionGrant } from "./aidlc-execution-grant";
import { loadWorkflowState, sessionBinding, assertSessionClaim, type SessionBinding } from "./aidlc-light-state";
import { readIssuedGrant,readAttemptRepairState, readAdmissionReport, admissionEnvironment,GRANT_OPERATIONS, withGrantInputSnapshot } from "./aidlc-grant-store";
import { executionInputIdentity } from './aidlc-execution-inputs';
import { assertDecisionProposalTarget } from './aidlc-autonomy-policy';
import { projectAutonomyScope } from "./aidlc-autonomy";
import { bindSession, claimToken, releaseSession, sessionRef } from "./aidlc-session";
import { loadWorkflowParts, evidenceScopeForInstance } from "./aidlc-workflow-layout";
import { readSourceRevision } from "./aidlc-revision";
import type { AdmissionHostAdapter } from "./aidlc-autonomous-admission";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const actionPolicy = JSON.parse(readFileSync(new URL('./data/native-host-action-policy.json', import.meta.url), 'utf8'));
/** Fresh capability evidence may cover a bounded Native command; never extends the grant. */
export function nativeProbeValidUntil(observedAt: string, deadline: number, now = Date.now()): string {
  const observed = Date.parse(observedAt), until = Math.min(observed + actionPolicy.capability_window_ms, deadline);
  if (!Number.isFinite(observed) || observed > now || !Number.isFinite(deadline) || until <= now) throw Error("HOST_PROBE_WINDOW_INVALID");
  return new Date(until).toISOString();
}
export function codexRuntime(): string {
  const candidates = [
    new URL("../runtime/aidlc-codex-host.mjs", import.meta.url),
    new URL("../../harness/codex/runtime/aidlc-codex-host.mjs", import.meta.url),
  ];
  const found = candidates.map((url) => fileURLToPath(url)).find(existsSync);
  if (!found) throw Error("HOST_RUNTIME_UNAVAILABLE: install the Codex Harness runtime");
  return found;
}
export function createCodexAdmissionAdapter(root: string, ref: any): AdmissionHostAdapter {
  const file = safeFile(root, ref.path);
  if (ref.repository_id !== "project" || ref.digest_mode !== "raw-file" || sha(readFileSync(file)) !== ref.digest)
    throw Error("HOST_CONFIG_REFERENCE_CHANGED");
  const runtime = codexRuntime(),
    kernel = createRequire(import.meta.url)(join(dirname(runtime), "host-kernel.cjs"));
  const config = kernel.config(file);
  if (!/^[a-f0-9]{64}$/.test(config.native_config_digest || "")) throw Error("HOST_NATIVE_CONFIG_NOT_PREPARED");
  const host = kernel.identity(file);
  return {
    qualification_scope: 'run-config',
    revalidate(challenge){
      checkCurrentExecutionGrant(root,['validation-execute']);
      if(sha(readFileSync(safeFile(root,ref.path)))!==ref.digest||json(kernel.identity(file))!==json(challenge.host))throw Error('HOST_CAPABILITY_CURRENT_IDENTITY_CHANGED');
      const active=readIssuedGrant(root,loadWorkflowState(root)!.execution_grant_ref!).grant,deadline=Math.min(Date.parse(active.expires_at),Date.parse(active.request_started_at)+active.resource_limits.wall_time_seconds*1000);
      if(deadline<=Date.now())throw Error('HOST_PROBE_BUDGET_EXPIRED');
      const r=spawnSync(process.execPath,[runtime,'check-config',file],{cwd:root,encoding:'utf8',timeout:Math.min(15000,deadline-Date.now()),maxBuffer:1024*1024,windowsHide:true,shell:false});
      const facts=kernel.resources.parseResourceFailure(r.stderr,true);if(facts)kernel.resources.announceResourceFailure(facts);
      if(r.error||r.status!==0||facts)throw Error('HOST_CAPABILITY_CONFIG_REVALIDATION_FAILED: '+(r.stderr||r.error||r.status));
      const actual=JSON.parse(r.stdout);if(actual.native_config_digest!==config.native_config_digest||json(actual.host)!==json(challenge.host)||json(kernel.identity(file))!==json(challenge.host)||sha(readFileSync(safeFile(root,ref.path)))!==ref.digest||actual.resource_reconciliation?.reconciled!==true)throw Error('HOST_CAPABILITY_CONFIGURATION_CHANGED');
      checkCurrentExecutionGrant(root,['validation-execute']);
      const label=`.aidlc/evidence/native-host/${randomUUID()}/config-check.json`,destination=join(root,label);
      for(let p=dirname(destination);p!==root;p=dirname(p))if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw Error('HOST_LINKED_PROBE_DIRECTORY');
      mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,JSON.stringify(actual)+'\n',{flag:'wx'});
      return {host:actual.host,configuration_digest:actual.native_config_digest,observed_at:actual.started_at,resource_reconciliation:actual.resource_reconciliation,probe_refs:[{repository_id:'project',path:label,digest_mode:'raw-file',digest:sha(readFileSync(destination))}]};
    },
    observe(challenge) {
      if (json(host) !== json(challenge.host)) throw Error("HOST_IDENTITY_DIFFERS_FROM_GRANT");
      const current = loadWorkflowState(root);
      const active = current?.execution_grant_ref
        ? readIssuedGrant(root, current.execution_grant_ref).grant
        : undefined;
      const deadline = active
        ? Math.min(
            Date.parse(active.expires_at),
            Date.parse(active.request_started_at) + active.resource_limits.wall_time_seconds * 1000,
          )
        : Date.now() + challenge.limits.wall_time_seconds * 1000;
      if (deadline <= Date.now()) throw Error("HOST_PROBE_BUDGET_EXPIRED");
      const r = spawnSync(process.execPath, [runtime, "probe", file], {
        cwd: root,
        input: JSON.stringify({ ...challenge, deadline_at: deadline }),
        encoding: "utf8",
        timeout: Math.min(180000, deadline - Date.now() + 10000),
        maxBuffer: 4 * 1024 * 1024,
        shell: false,
        windowsHide: true,
      });
      const resourceFacts=kernel.resources.parseResourceFailure(r.stderr,true);if(resourceFacts)kernel.resources.announceResourceFailure(resourceFacts);
      if (r.error || r.status !== 0 || resourceFacts) throw Error(`HOST_NATIVE_PROBE_FAILED: ${r.stderr || r.error || r.status}`);
      const result = JSON.parse(r.stdout);
      if (
        result.nonce !== challenge.nonce ||
        !result.budget_denied ||
        !result.cancellation?.reconciled ||
        result.turns?.length !== 3 ||
        result.turns.slice(0, 2).some((t: any) => t.status !== "completed") ||
        result.turns[2].status !== "interrupted"
      )
        throw Error("HOST_NATIVE_OBSERVATION_INVALID");
      const label = `.aidlc/evidence/native-host/${challenge.nonce}/probe.json`;
      const destination = join(root, label);
      // The control path has no business writes. Existing ancestors must be safe.
      if (!/^[a-f0-9-]{36}$/.test(challenge.nonce)) throw Error("HOST_PROBE_NONCE_INVALID");
      for (let p = dirname(destination); p !== root; p = dirname(p)) {
        if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw Error("HOST_LINKED_PROBE_DIRECTORY");
      }
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, JSON.stringify(result) + "\n", { flag: "wx" });
      const input = {
        repository_id: "project" as const,
        path: label,
        digest_mode: "raw-file" as const,
        digest: sha(readFileSync(destination)),
      };
      return {
        nonce: challenge.nonce,
        host,
        limits: challenge.limits,
        observed_at: result.started_at,
        configuration_digest: result.native_config_digest,
        valid_until: nativeProbeValidUntil(result.started_at, deadline),
        capabilities: Object.fromEntries(
          challenge.required_capabilities.map((k) => [
            k,
            {
              status:
                ["model-turn", "continuous-session", "budget-enforcement"].includes(k) ||
                (k.startsWith("browser-") &&
                  result.browser?.status === "succeeded" &&
                  result.browser?.interaction &&
                  result.browser?.png_valid)
                  ? "supported"
                  : "unknown",
              probe_refs: [input],
            },
          ]),
        ),
      } as ReturnType<AdmissionHostAdapter["observe"]>;
    },
  };
}
export function nativeHostDirective(root: string, args: string[]): any {
  return args[0] === 'prepare' ? withGrantInputSnapshot(() => nativeHostDirectiveInner(root, args)) : nativeHostDirectiveInner(root, args);
}
function nativeHostDirectiveInner(root: string, args: string[]): any {
  bindExecutionGrant(root);
  const state = loadWorkflowState(root)!,
    binding = sessionBinding()!;
  if (!state.execution_grant_ref || !binding) throw Error("HOST_REQUIRES_MANAGED_GRANT_AND_BINDING");
  const grant = readIssuedGrant(root, state.execution_grant_ref).grant;
  if(args[0]==='prepare'){
    if(![3,4].includes(args.length)||args[1]!=='--checks'||args.length===4&&args[3]!=='--context'||args[2].length>65536)throw Error('HOST_PREPARATION_SCHEMA');
    const checks=JSON.parse(args[2]);if(!Array.isArray(checks)||checks.length<1||checks.length>65||checks.some(c=>!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['operation','path'].includes(k))||!GRANT_OPERATIONS.includes(c.operation)||c.path!==undefined&&(typeof c.path!=='string'||!c.path)))throw Error('HOST_PREPARATION_SCHEMA');
    // Same Core API as the CLI checks, in one request. No cached authority is returned.
    const context=args[3]==='--context'?nativeHostDirective(root,['context']).host_context:undefined;
    for(const c of checks)checkCurrentExecutionGrant(root,[c.operation],c.path);
    const deadline=Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000);if(Date.now()>=deadline)throw Error('HOST_PREPARATION_EXPIRED');
    return {kind:'print',host_preparation:{schema:'aidlc.host-preparation/v1',binding_digest:sha(json(binding)),grant_ref:state.execution_grant_ref,deadline_at:deadline,checked_at:new Date().toISOString(),checks,...(context?{input_context:{input_digest:context.input_digest,source_digest:context.source_digest,execution_inputs:{schema:context.execution_inputs.schema,command_digest:context.execution_inputs.command_digest}},progress_digest:context.progress_digest}:{})},message:'Current action checks only; no durable permission, lease or execution grant.'};
  }
  if (args.length === 3 && args[0] === 'proposal' && args[1] === '--path') {
    checkCurrentExecutionGrant(root,['decision-record']);
    assertDecisionProposalTarget(root,args[2]);
    return {kind:'print',proposal_target:{path:args[2],isolated:true},message:'Current decision proposal target only; this does not record or accept a decision.'};
  }
  if (args.length === 1 && args[0] === "context") {
    let environment: unknown=null;
    try {const receipt=readAdmissionReport(root,state);environment=admissionEnvironment(receipt.environment_variables as string[],receipt.executables as string[]);}
    catch(error) {if(!String(error).includes('ADMISSION_NOT_READY: managed receipt missing')) throw error;}
    const executionInputs=executionInputIdentity(root,environment);
    const scopedRevision=readSourceRevision(root,evidenceScopeForInstance(root,binding.stage_instance));
    const parts = [...loadWorkflowParts(root).parts.values()];
    const units = projectAutonomyScope(root)
      .units!.filter((u) => u.role === "implement")
      .map((u) => ({
        unit_ref: u.unit_ref,
        review_completed: parts
          .find((p) => p.state.workflow_id === u.unit_ref.workflow_ref.workflow_id)
          ?.state.completed_stage_instances.includes(
            `code-review@module:${u.unit_ref.module_id}@unit:${u.unit_ref.unit_id}`,
          ),
      }));
    const repair=readAttemptRepairState(root,state)?.requests.at(-1);
    const activePlan=repair?.status==='accepted'?{sequence:repair.sequence,classification:repair.classification,unit_ref:repair.unit_ref,failure_ref:repair.failure_ref,test_paths:repair.test_paths,steps:repair.steps,original_red_archive:repair.archives?.find((r:any)=>r.original_path===repair.red_ref.path),before_new_tdd:repair.classification==='test-correction'?['evidence','run','--stage','test-case-derivation','--module',repair.unit_ref.module_id,'--sensor','test-case-derivation','--refresh']:null}:undefined;
    return {
      kind: "print",
      host_context: {
        binding,
        control_prepare:{schema:'aidlc.host-preparation/v1',supported:true},
        coordinator_completed: state.completed_stage_instances.includes(
          grant.executor_constraints.initial_binding.stage_instance,
        ),
        grant_ref: state.execution_grant_ref,
        grant,
        implementation_units: units,
        same_attempt_repair: {schema:"aidlc.same-attempt-repair/v1",supported:true,...(activePlan?{active_plan:activePlan}:{})},
        c8_completed: parts.some((p) => p.state.completed_stage_instances.includes("build-and-test")),
        source_digest: executionInputs.source_digest,
        execution_inputs: executionInputs,
        input_digest: scopedRevision.scope_digest,
        progress_digest: sha(
          JSON.stringify([
            parts.map((p) => [
              p.state.workflow_id,
              p.state.current_stage_instance,
              p.state.completed_stage_instances,
              p.state.skipped_stage_instances,
              p.state.status,
            ]),
            scopedRevision.scope_digest,
          ]),
        ),
      },
      message: "Private host IPC context; never inject bindings into model messages.",
    };
  }
  if (args.length === 3 && args[0] === "select" && args[1] === "--instance") {
    if (!grant.allowed_operations.includes("workflow-write")) throw Error("HOST_SELECT_REQUIRES_WORKFLOW_WRITE");
    const target = args[2],
      scope = projectAutonomyScope(root),
      module = /@module:([^@]+)/.exec(target)?.[1],
      unit = /@unit:([^@]+)/.exec(target)?.[1];
    if (module && !scope.units!.some((u) => u.role === "implement" && u.unit_ref.module_id === module))
      throw Error("HOST_SELECT_OUTSIDE_IMPLEMENT_SCOPE");
    if (
      unit &&
      !scope.units!.some(
        (u) => u.role === "implement" && u.unit_ref.module_id === module && u.unit_ref.unit_id === unit,
      )
    )
      throw Error("HOST_SELECT_OUTSIDE_IMPLEMENT_SCOPE");
    if (target === binding.stage_instance) {
      if (target === grant.executor_constraints.initial_binding.stage_instance && !target.includes("@")) {
        const current = loadWorkflowState(root, sessionRef(root, target))!;
        return {
          kind: "print",
          host_context: {
            binding: bindSession(root, {
              instance: target,
              session: binding.session_id,
              owner: binding.owner,
              expected: claimToken(current.active_instances[target]),
            }).binding,
          },
        };
      }
      return { kind: "print", host_context: { binding } };
    }
    const ref = sessionRef(root, target),
      wf = loadWorkflowState(root, ref);
    if (!wf || !grant.workflow_refs.some((r) => r.workflow_id === wf.workflow_id))
      throw Error("HOST_SELECT_OUTSIDE_WORKFLOW");
    // No takeover, no stale CAS retry, no resume. Bind is the existing exact-claim protocol.
    const coordinator = grant.executor_constraints.initial_binding.stage_instance;
    const priorBinding = process.env.AIDLC_SESSION_BINDING;
    if (target === coordinator && wf.active_instances[target]) {
      const held = JSON.parse(process.env.AIDLC_COORDINATOR_BINDING || "null") as SessionBinding | null;
      if (
        !held ||
        held.stage_instance !== coordinator ||
        coordinator.includes("@") ||
        held.session_id !== binding.session_id ||
        held.owner !== binding.owner
      )
        throw Error("HOST_COORDINATOR_BINDING_REQUIRED");
      assertSessionClaim(root, wf, target, held);
      process.env.AIDLC_SESSION_BINDING = JSON.stringify(held);
    }
    let next: ReturnType<typeof bindSession>;
    try {
      next = bindSession(root, {
        instance: target,
        session: binding.session_id,
        owner: binding.owner,
        expected: claimToken(wf.active_instances[target]),
      });
    } finally {
      if (priorBinding === undefined) delete process.env.AIDLC_SESSION_BINDING;
      else process.env.AIDLC_SESSION_BINDING = priorBinding;
    }
    // Release only this host's old claim, with its original binding, after successful bind.
    const old = loadWorkflowState(root, sessionRef(root, binding.stage_instance))?.active_instances[
      binding.stage_instance
    ];
    if (old && binding.stage_instance !== coordinator) releaseSession(root, binding.stage_instance, claimToken(old));
    return { kind: "print", host_context: { binding: next.binding } };
  }
  throw Error("use autonomy host context|select --instance <exact-instance>");
}
