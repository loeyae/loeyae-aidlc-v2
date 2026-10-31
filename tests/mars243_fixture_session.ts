import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const fixtureRepository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import {
	bindSession,
	claimToken,
	sessionRef,
	releaseSession,
} from "../core/tools/aidlc-session";
import {
	bindingFor,
	loadWorkflowState,
 saveWorkflowState,
	lightStatePath,
 type WorkflowRef,
 renderLightWorkflowState,
 workflowMaintenancePlan,
	type WorkflowState,
} from "../core/tools/aidlc-light-state";

/** Fixture administration only: arrange a state, then exercise production CLI gates with an explicit session. */
export function saveFixtureState(project: string, state: WorkflowState, ref?: WorkflowRef) {
  const path = lightStatePath(project, ref);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderLightWorkflowState(state), "utf8");
}

/** Explicit fixture handoff using the same CAS release operation as the CLI. */
export function releaseFixtureClaims(project: string) {
  const previous = process.env.AIDLC_SESSION_BINDING;
  try {
    for (const ref of workflowMaintenancePlan(project).refs) {
      const state = loadWorkflowState(project, ref);
      for (let claim of Object.values(state?.active_instances || {})) {
        if (!claim.session_id) {
          delete process.env.AIDLC_SESSION_BINDING;
          claim = bindSession(project, { instance: claim.stage_instance, owner: claim.owner, session: "fixture-release", expected: claimToken(claim) }).claim;
        }
        process.env.AIDLC_SESSION_BINDING = JSON.stringify(bindingFor(project, loadWorkflowState(project, ref)!, claim));
        releaseSession(project, claim.stage_instance, claimToken(claim));
      }
    }
  } finally { if (previous === undefined) delete process.env.AIDLC_SESSION_BINDING; else process.env.AIDLC_SESSION_BINDING = previous; }
}

/** Positive integration fixture: explicitly record review of the real input set,
 * then run the real controlled producer. Missing-review negatives use raw CLI.
 */
export function fixtureGlobalReview(project: string) {
  const run = (args: string[], env: NodeJS.ProcessEnv = { ...process.env, AIDLC_SESSION_BINDING: "" }) => spawnSync(process.execPath, [resolve(fixtureRepository, "node_modules/tsx/dist/cli.mjs"), resolve(fixtureRepository, "bin/cli.ts"), ...args], { cwd: project, encoding: "utf8", env });
  const projected = run(["orchestrate", "state", "review-inputs"]);
  if (projected.status !== 0) throw new Error(projected.stdout + projected.stderr);
  const plan = JSON.parse(projected.stdout).global_review;
  if (!plan.required) return;
  const path = resolve(project, "docs/aidlc/construction/global-code-review.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '# Fixture integration review\n\n```aidlc-global-review\n' + JSON.stringify({ mode: "FINAL_GLOBAL", status: "passed", spec_axis: "passed", standards_axis: "passed", reviewer: "fixture-integration-review", issues_found: 0, issues_resolved: 0, issues_open: 0, covered_instances: plan.covered_instances, inputs: plan.inputs }) + '\n```\n');
  const args = ["evidence", "run", "--stage", "build-and-test", "--instance", "build-and-test", "--sensor", "global-review-evidence", "--refresh"];
  const produced = run(args, fixtureEnvironment(project, args));
  if (produced.status !== 0) throw new Error(produced.stdout + produced.stderr);
}

/** Legacy fixtures have module-wide inputs, so their reviews cover real module files. */
export function fixtureReviewFiles(project: string, roots: string[]): string[] {
  const files: string[] = [];
  const visit = (path: string) => {
    if (!existsSync(resolve(project, path))) return;
    const stat = lstatSync(resolve(project, path));
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) { files.push(path.replace(/\\/g, "/")); return; }
    for (const name of readdirSync(resolve(project, path))) if (![".git", "__pycache__", "node_modules"].includes(name)) visit(`${path}/${name}`);
  };
  roots.forEach(visit); return files.sort();
}

/** Exercise the real persistence invariants with a real fixture session. */
export function saveFixtureStateWithChecks(project: string, state: WorkflowState, ref?: WorkflowRef, options?: Parameters<typeof saveWorkflowState>[3]) {
  const previous = process.env.AIDLC_SESSION_BINDING;
  const current = loadWorkflowState(project, ref);
  const instance = ref?.kind === "module" ? `requirements-analysis@module:${ref.module_id}` : current?.current_stage_instance || current?.completed_stage_instances.at(-1);
  const env = fixtureEnvironment(project, ["orchestrate", "report", ...(instance ? ["--instance", instance] : []), ...(ref?.kind === "module" ? ["--module", ref.module_id] : [])]);
  process.env.AIDLC_SESSION_BINDING = env.AIDLC_SESSION_BINDING;
  if (current) {
    const bound = loadWorkflowState(project, ref)!;
    state.revision = bound.revision;
    state.active_instances = bound.active_instances;
    state.module_selections = bound.module_selections;
    state.unit_selections = bound.unit_selections;
  }
  try { return saveWorkflowState(project, state, ref, options); }
  finally { if (previous === undefined) delete process.env.AIDLC_SESSION_BINDING; else process.env.AIDLC_SESSION_BINDING = previous; }
}

export function fixtureEnvironment(
	project: string,
	args: string[],
): NodeJS.ProcessEnv {
	const flags = Object.fromEntries(
		args.flatMap((arg, index) =>
			arg.startsWith("--") ? [[arg.slice(2), args[index + 1]]] : [],
		),
	);
  if (args[0] === "orchestrate" && args[1] === "state" && ["recover", "adopt", "rebuild"].includes(args[2])) return { ...process.env, AIDLC_SESSION_BINDING: "" };
	if (!["orchestrate", "evidence", "module", "unit", "ui", "document-slices"].includes(args[0]) || flags.status)
		return { ...process.env, AIDLC_SESSION_BINDING: "" };
	let instance: string | undefined;
	if (args[0] === "orchestrate" && args[1] === "next") {
		const preview = spawnSync(
			process.execPath,
			[
				resolve(fixtureRepository, "node_modules/tsx/dist/cli.mjs"),
				resolve(fixtureRepository, "bin/cli.ts"),
				"orchestrate",
				"next",
				"--preview",
				...(flags.module ? ["--module", flags.module] : []),
        ...(flags.unit ? ["--unit", flags.unit] : []),
			],
			{
				cwd: project,
				encoding: "utf8",
				env: { ...process.env, AIDLC_SESSION_BINDING: "" },
			},
		);
		if (preview.status === 0)
			instance = JSON.parse(preview.stdout).stage_instance;
    if (flags.module && !flags.claim && !existsSync(resolve(project, "aidlc/active/registry.md"))) {
      const source = loadWorkflowState(project);
      instance = source?.current_stage_instance || source?.completed_stage_instances.at(-1) || instance;
    }
    if (!instance && !existsSync(resolve(project, "aidlc/active/registry.md"))) {
      const state = loadWorkflowState(project);
      instance = state?.current_stage_instance || state?.completed_stage_instances.at(-1);
    }
    if (!instance && flags.module) {
      const state = loadWorkflowState(project, sessionRef(project, `placeholder@module:${flags.module}`));
      const directive = preview.status === 0 ? JSON.parse(preview.stdout) : undefined;
      if (state && (state.status === "done" || directive?.kind === "done"
        || (directive?.kind === "print" && directive.preview === true && directive.stage_instance === null))) {
        // Preview is read-only and does not persist a fully resolved workflow's
        // done status. Bind its last real checkpoint before the mutating next.
        instance = state.completed_stage_instances.at(-1);
      }
    }
    if (!instance && !flags.module && existsSync(resolve(project, "aidlc/active/registry.md"))) {
      const integration = loadWorkflowState(project, { kind: "integration" });
      const claims = Object.values(integration?.active_instances || {});
      const directive = preview.status === 0 ? JSON.parse(preview.stdout) : undefined;
      if (directive?.workflow === "integration" && directive.preview === true && directive.stage_instance === null) {
        instance = integration?.completed_stage_instances.at(-1);
      } else if (claims.length === 1) instance = claims[0].stage_instance;
    }
    if (!instance && flags.module && !loadWorkflowState(project, sessionRef(project, `placeholder@module:${flags.module}`))) {
      const global = loadWorkflowState(project);
      instance = global?.completed_stage_instances.filter(id => !id.includes("@")).at(-1) || "workspace-detection";
    }
	} else {
		const targetModule = flags.module || /@module:([a-z0-9][a-z0-9-]*)/.exec(flags.instance || "")?.[1];
		const state = loadWorkflowState(
			project,
			targetModule
				? sessionRef(project, `placeholder@module:${targetModule}`)
				: undefined,
		);
		instance = flags.instance || flags["stage-instance"] || state?.current_stage_instance
      || (args[1] === "archive" ? Object.keys(state?.active_instances || {}).at(-1) : undefined)
      || state?.completed_stage_instances.at(-1);
    if (!instance && state) {
      const stage = state.current_stage || (flags.module ? "requirements-analysis" : "workspace-detection");
      const axis = JSON.parse(requireGraph()).stages.find((s: {slug:string}) => s.slug === stage)?.axis;
      instance = axis === "project" ? stage : `${stage}@module:${flags.module || state.current_module || "project"}${axis === "unit" ? `@unit:${flags.unit || state.current_unit || "default"}` : ""}`;
    }
		if (flags.stage && !flags.instance && state) {
			const axis = JSON.parse(requireGraph()).stages.find(
				(s: { slug: string }) => s.slug === flags.stage,
			)?.axis;
			instance =
				axis === "project"
					? flags.stage
					: `${flags.stage}@module:${flags.module || state.current_module || "project"}${axis === "unit" ? `@unit:${flags.unit || state.current_unit || "default"}` : ""}`;
		}
	}

  if (args[0] === "unit" && args[1] === "select" && flags.module && flags.unit) instance = `code-generation@module:${flags.module}@unit:${flags.unit}`;
  if (args[0] === "module" && flags.module && !flags["stage-instance"] && !flags.instance) {
    const state = loadWorkflowState(project, sessionRef(project, `placeholder@module:${flags.module}`));
    instance = Object.values(state?.active_instances || {}).find(claim => claim.module_id === flags.module)?.stage_instance
      || `requirements-analysis@module:${flags.module}`;
  }
	if (!instance) return { ...process.env, AIDLC_SESSION_BINDING: "" };
	const state = loadWorkflowState(project, sessionRef(project, instance));
	if (!state) return { ...process.env, AIDLC_SESSION_BINDING: "" };
	const existing = state.active_instances[instance];
	const binding = existing?.session_id
		? bindingFor(project, state, existing)
		: bindSession(project, {
				instance,
				owner: flags.member || flags.owner || "fixture-owner",
				session: "fixture-session",
				expected: claimToken(existing),
				...(existing && existing.owner !== "fixture-owner"
					? { humanInstructionRef: "test-fixture:explicit-owner-migration" }
					: {}),
			}).binding;
	return { ...process.env, AIDLC_SESSION_BINDING: JSON.stringify(binding) };
}
import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, readdirSync } from "node:fs";
function requireGraph() {
	return readFileSync(resolve(fixtureRepository, "core/tools/data/stage-graph.json"), "utf8");
}
