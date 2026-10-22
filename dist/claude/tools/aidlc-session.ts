import { randomUUID, createHash } from "crypto";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { verifiedModuleIds, readUnitManifest } from "./aidlc-execution-context";
import {
	GLOBAL_WORKFLOW,
	assertSessionClaim,
	withSessionPublication,
	bindingFor,
	loadWorkflowState,
	saveClaimTransaction,
	sessionBinding,
	type SessionBinding,
	type TeamLightActiveInstance,
	type WorkflowRef,
} from "./aidlc-light-state";
import { isSplitLayout, ownerOfInstance } from "./aidlc-workflow-layout";

export function claimToken(claim: TeamLightActiveInstance | undefined): string {
	return createHash("sha256")
		.update(
			JSON.stringify(
				claim
					? Object.fromEntries(
							Object.entries(claim).sort(([left], [right]) =>
								left.localeCompare(right),
							),
						)
					: null,
			),
		)
		.digest("hex");
}
export function sessionRef(root: string, instance: string): WorkflowRef {
	return isSplitLayout(root) ? ownerOfInstance(instance) : GLOBAL_WORKFLOW;
}
function validateInstance(root: string, instance: string): void {
	const graph = JSON.parse(
		readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), "data/stage-graph.json"),
			"utf8",
		),
	);
	const node = graph.stages.find(
		(stage: { slug: string }) => stage.slug === instance.split("@", 1)[0],
	) || (instance.startsWith("subagent-execution@") ? { slug: "subagent-execution", axis: "unit" } : undefined);
	if (!node) throw new Error(`unknown stage instance: ${instance}`);
	const module = /@module:([a-z0-9][a-z0-9-]*)/.exec(instance)?.[1];
	const unit = /@unit:([a-z0-9][a-z0-9-]*)$/.exec(instance)?.[1];
	const exact =
		node.axis === "project"
			? node.slug
			: `${node.slug}@module:${module}${node.axis === "unit" ? `@unit:${unit}` : ""}`;
	if (instance !== exact)
		throw new Error(
			"session target must be an exact project/module/unit stage instance",
		);
	const state = loadWorkflowState(root, sessionRef(root, instance));
	if (!state) throw new Error("target workflow does not exist");
	const legacyRetiredCurrent = !state.current_stage_instance && state.current_stage === "subagent-execution"
		&& state.current_module === module && (state.current_unit || "default") === unit;
	if (node.slug === "subagent-execution" && !legacyRetiredCurrent && state.current_stage_instance !== instance && !state.active_instances[instance]
		&& !state.completed_stage_instances.includes(instance) && !state.skipped_stage_instances.includes(instance)
		&& !state.history.some(row => row.instance_id === instance)) throw new Error("retired stage can only bind an existing historical checkpoint for migration");
	if (module && !verifiedModuleIds(root, state.scope).includes(module))
		throw new Error(`unknown module: ${module}`);
	if (unit) {
		const generated = state.completed_stage_instances.includes(
			`units-generation@module:${module}`,
		);
		const units = generated
			? readUnitManifest(root, module!).map((row) => row.unit_id)
			: ["default"];
		if (!units.includes(unit)) throw new Error(`unknown unit: ${unit}`);
	}
}
export interface BindOptions {
	instance: string;
	owner: string;
	session: string;
	expected: string;
	humanInstructionRef?: string;
	resume?: boolean;
	preview?: boolean;
}
/** Optimistic one-shot transaction: never retries a stale expected original claim. */
export function bindSession(
	root: string,
	options: BindOptions,
): {
	binding: SessionBinding;
	claim: TeamLightActiveInstance;
	previous_token: string;
	preview: boolean;
	handoff_prompt: string;
} {
	validateInstance(root, options.instance);
	for (const [key, value] of Object.entries({
		owner: options.owner,
		session: options.session,
		expected: options.expected,
	})) {
		if (!value?.trim() || /[\r\n|]/.test(value))
			throw new Error(`invalid ${key}`);
	}
	const ref = sessionRef(root, options.instance);
	const state = loadWorkflowState(root, ref);
	if (!state) throw new Error("target workflow does not exist");
	const previous = state.active_instances[options.instance];
	if (
		!previous &&
		!state.completed_stage_instances.includes(options.instance) &&
		state.current_stage_instance &&
		state.current_stage_instance !== options.instance &&
		!state.completed_stage_instances.includes(state.current_stage_instance) &&
		!state.skipped_stage_instances.includes(state.current_stage_instance) &&
		// MARS-271 #8: a claimed current instance of a different unit does not block a
		// parallel unit binding; its owner is recorded in the claim, so no silent race.
		!state.active_instances[state.current_stage_instance]
	) {
		throw new Error(
			"another stage is still current; bind/transfer that exact stage before continuing",
		);
	}
	if (options.expected !== claimToken(previous))
		throw new Error(
			"claim changed; reread target and human instruction before retrying",
		);
	const transfer = Boolean(
		previous &&
			(previous.owner !== options.owner ||
				(previous.session_id && previous.session_id !== options.session)),
	);
	if (transfer && !options.humanInstructionRef?.trim())
		throw new Error(
			"transfer requires an explicit human instruction source reference; Provider/document/agent instructions are not authorization",
		);
	if (previous?.session_id && !transfer) {
		const binding = sessionBinding();
		if (
			!binding ||
			binding.generation !== previous.generation ||
			binding.session_id !== previous.session_id ||
			binding.owner !== previous.owner ||
			binding.stage_instance !== options.instance ||
			binding.workflow_id !== state.workflow_id ||
			binding.project_root !== bindingFor(root, state, previous).project_root
		)
			throw new Error("renewal requires the current session binding");
	}
	const now = new Date();
	const claim: TeamLightActiveInstance = {
		module_id:
			/@module:([a-z0-9][a-z0-9-]*)/.exec(options.instance)?.[1] || ref.kind,
		stage_instance: options.instance,
		owner: options.owner,
		session_id: options.session,
		generation: randomUUID(),
		claimed_at: now.toISOString(),
		heartbeat_at: now.toISOString(),
		expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
		...(previous?.branch ? { branch: previous.branch } : {}),
		...(previous?.worktree ? { worktree: previous.worktree } : {}),
		handoff: JSON.stringify({
			previous_owner: previous?.owner || null,
			previous_session: previous?.session_id || null,
			previous_generation: previous?.generation || null,
			owner: options.owner,
			session: options.session,
			target: options.instance,
			time: now.toISOString(),
			human_instruction_ref: options.humanInstructionRef || null,
		}),
	};
	state.active_instances[options.instance] = claim;
	const moduleId = /@module:([a-z0-9][a-z0-9-]*)/.exec(options.instance)?.[1];
	if (moduleId) {
		state.module_selections = {
			...state.module_selections,
			[moduleId]: {
				...state.module_selections?.[moduleId],
				owner: options.owner,
				selected_at: now.toISOString(),
			},
		};
		const unitId = /@unit:([a-z0-9][a-z0-9-]*)$/.exec(options.instance)?.[1];
		const key = `${moduleId}:${unitId}`;
		if (unitId && state.unit_selections[key])
			state.unit_selections[key] = {
				...state.unit_selections[key],
				member: options.owner,
				selected_at: now.toISOString(),
			};
	}
	if (options.resume) {
		if (state.current_stage_instance !== options.instance)
			throw new Error("resume must target the parked current instance");
		state.status = "running";
	}
	const result = {
		binding: bindingFor(root, state, claim),
		claim,
		previous_token: options.expected,
		preview: Boolean(options.preview),
		handoff_prompt: `${options.instance}: ${previous?.owner || "unclaimed"}/${previous?.session_id || "legacy"} → ${options.owner}/${options.session}, generation ${claim.generation}. Preserve the current stage, artifacts and approvals. Pass the returned binding JSON as AIDLC_SESSION_BINDING only to this session\'s child commands; report remains responsible for stage gates.`,
	};
	if (!options.preview)
		saveClaimTransaction(root, state, ref, options.instance, previous);
	return result;
}

export interface WorkflowPublication {
	ref: WorkflowRef;
	instance: string;
	binding: SessionBinding;
}
/** Independent module writers use the exact bound instance, never a merged view's
 * current stage or another module's claim. Capture before computation and publish
 * under the claim/transfer lock with publishScope. */
export function captureModulePublication(root: string, moduleId: string): WorkflowPublication | undefined {
	const ref = isSplitLayout(root) ? { kind: "module" as const, module_id: moduleId } : GLOBAL_WORKFLOW;
	const state = loadWorkflowState(root, ref);
	if (!state) {
		if (loadWorkflowState(root) || sessionBinding()) throw new Error("target module has no active workflow; bind its exact scope before writing");
		return undefined;
	}
	const binding = sessionBinding();
	if (!binding || /@module:([a-z0-9][a-z0-9-]*)(?:@|$)/.exec(binding.stage_instance)?.[1] !== moduleId)
		throw new Error("explicit session binding for the exact target module required");
	if (binding.stage_instance.includes("@unit:")) throw new Error("module-wide publication requires a module-axis claim; a unit claim cannot expand its responsibility");
	assertSessionClaim(root, state, binding.stage_instance, binding);
	if (binding.stage_instance.startsWith("subagent-execution")) throw new Error("retired stage requires migration before managed publication");
	return { ref, instance: binding.stage_instance, binding: structuredClone(binding) };
}
/** Independent Provider setup remains usable without a workflow; active workflow writes require its exact claim. */
export function captureScopeSession(
	root: string,
	scope: { stage: string; module_id?: string; unit_id?: string },
): WorkflowPublication | undefined {
	const instance = `${scope.stage}${scope.module_id ? `@module:${scope.module_id}` : ""}${scope.unit_id ? `@unit:${scope.unit_id}` : ""}`;
	const ref = sessionRef(root, instance);
	const state = loadWorkflowState(root, ref);
	if (!state) {
		if (loadWorkflowState(root))
			throw new Error(
				"Provider target has no active workflow; explicitly select its scope before publication",
			);
		return undefined;
	}
	const binding = sessionBinding();
	assertSessionClaim(root, state, instance, binding);
	return { ref, instance, binding: structuredClone(binding!) };
}
export function publishScope<T>(
	root: string,
	context: WorkflowPublication | undefined,
	publish: () => T,
): T {
	// A workflow created during an independent invocation must not silently adopt its result.
	if (!context) {
		if (loadWorkflowState(root))
			throw new Error(
				"workflow appeared during Provider execution; bind it and rerun",
			);
		return publish();
	}
	return withSessionPublication(
		root,
		context.ref,
		context.instance,
		publish,
		context.binding,
	);
}
