import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import {
	createInitialState,
	saveWorkflowState,
	loadWorkflowState,
	lightStatePath,
	lightAuditPath,
	renderLightWorkflowState,
	parseLightWorkflowState,
	type WorkflowRef,
} from "../core/tools/aidlc-light-state";
import {
	saveRegistry,
	registryPath,
} from "../core/tools/aidlc-workflow-layout";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
const project = mkdtempSync(join(tmpdir(), "aidlc-mars243-layout-"));
const tsx = resolve("node_modules/tsx/dist/cli.mjs"),
	hook = resolve("core/tools/aidlc-platform-hook.ts");
const refs: WorkflowRef[] = [
	{ kind: "global" },
	{ kind: "module", module_id: "m02-design" },
	{ kind: "module", module_id: "m11-recommend" },
	{ kind: "integration" },
];
try {
	const manifest = join(project, "docs/aidlc/ideation/module-manifest.json");
	mkdirSync(dirname(manifest), { recursive: true });
	writeFileSync(
		manifest,
		JSON.stringify({
			schema_version: 1,
			modules: [
				{ module_id: "m02-design", name: "Design", service_id: "design" },
				{
					module_id: "m11-recommend",
					name: "Recommend",
					service_id: "recommend",
				},
			],
		}),
	);
	for (const ref of refs) {
		const state = createInitialState(
			"feature",
			"4.20.0",
			undefined,
			[],
			"split isolation",
		);
		state.workflow_kind = ref.kind;
		if (ref.kind === "module") state.module_id = ref.module_id;
		state.current_stage =
			ref.kind === "global"
				? "workspace-detection"
				: ref.kind === "integration"
					? "build-and-test"
					: "application-design";
		state.current_stage_instance =
			ref.kind === "module"
				? `${state.current_stage}@module:${ref.module_id}`
				: state.current_stage;
		if (ref.kind === "module") state.current_module = ref.module_id;
		saveWorkflowState(project, state, ref);
	}
	const global = loadWorkflowState(project)!;
	saveRegistry(project, {
		version: "1",
		global_workflow_id: global.workflow_id,
		split_from_workflow_id: global.workflow_id,
		split_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		modules: refs
			.filter((ref) => ref.kind === "module")
			.map((ref) => ({
				module_id: (ref as { module_id: string }).module_id,
				workflow_id: loadWorkflowState(project, ref)!.workflow_id,
				state_path: `aidlc/active/modules/${(ref as { module_id: string }).module_id}/aidlc-state.md`,
				status: "running",
				current_stage: "-",
				inception_done: false,
				construction_done: false,
				owner: "-",
			})),
		integration: {
			workflow_id: loadWorkflowState(project, { kind: "integration" })!
				.workflow_id,
			state_path: "aidlc/active/integration/aidlc-state.md",
			status: "running",
			current_stage: "-",
			barrier_ready: false,
			blocking: [],
		},
		shared_contracts: [],
		cross_module_requires: [],
	});
	function snapshot() {
		return [
			...refs.flatMap((ref) => [
				readFileSync(lightStatePath(project, ref), "utf8"),
				readFileSync(lightAuditPath(project, ref), "utf8"),
			]),
			readFileSync(registryPath(project), "utf8"),
		];
	}
	for (const ref of refs) {
		const state = loadWorkflowState(project, ref)!;
		const instance = state.current_stage_instance!;
		const a = bindSession(project, {
			instance,
			session: `A-${ref.kind}`,
			owner: "alice",
			expected: claimToken(undefined),
		});
		const before = snapshot();
		for (const payload of [
			{ session_id: a.binding.session_id },
			{ thread_id: a.binding.session_id },
			{ sessionID: a.binding.session_id },
			{},
			{ session_id: "other" },
			{ stop_hook_active: true },
		]) {
			const result = spawnSync(
				process.execPath,
				[tsx, hook, "--format", "claude"],
				{
					cwd: project,
					input: JSON.stringify({ cwd: project, ...payload }),
					encoding: "utf8",
					env: {
						...process.env,
						AIDLC_SESSION_BINDING: JSON.stringify(a.binding),
						AIDLC_ACTIVE_MODULE: "m02-design",
					},
				},
			);
			assert.equal(result.status, 0);
			assert.equal(result.stdout, "");
			assert.deepEqual(snapshot(), before);
		}
		const b = bindSession(project, {
			instance,
			session: `B-${ref.kind}`,
			owner: "alice",
			expected: claimToken(a.claim),
			humanInstructionRef: "human:loeye/layout-transfer",
		});
		const after = snapshot();
		const stale = spawnSync(process.execPath, [tsx, hook], {
			cwd: project,
			input: JSON.stringify({ cwd: project, session_id: a.binding.session_id }),
			encoding: "utf8",
			env: { ...process.env, AIDLC_SESSION_BINDING: JSON.stringify(a.binding) },
		});
		assert.equal(stale.status, 0);
		assert.match(stale.stderr, /transferred|conflicts/);
		assert.deepEqual(snapshot(), after);
		const parked = loadWorkflowState(project, ref)!;
		parked.status = "parked";
		writeFileSync(lightStatePath(project, ref), renderLightWorkflowState(parked));
		const resumed = bindSession(project, {
			instance,
			session: `C-${ref.kind}`,
			owner: "bob",
			expected: claimToken(b.claim),
			humanInstructionRef: "human:loeye/continue",
			resume: true,
		});
		assert.equal(loadWorkflowState(project, ref)!.status, "running");
		assert.equal(
			loadWorkflowState(project, ref)!.current_stage_instance,
			instance,
		);
		// An expired lease keeps its generation; only its exact current binding can renew.
		const expired = loadWorkflowState(project, ref)!;
		expired.active_instances[instance].expires_at = "2000-01-01T00:00:00.000Z";
		writeFileSync(lightStatePath(project, ref), renderLightWorkflowState(expired));
		process.env.AIDLC_SESSION_BINDING = JSON.stringify(resumed.binding);
		const renewed = bindSession(project, {
			instance,
			session: resumed.binding.session_id,
			owner: "bob",
			expected: claimToken(expired.active_instances[instance]),
		});
		assert.notEqual(renewed.claim.generation, resumed.claim.generation);
		delete process.env.AIDLC_SESSION_BINDING;
	}
	// Eight-column legacy claims remain readable and roundtrip without silent assignment.
	const legacy = createInitialState(
		"feature",
		"4.20.0",
		undefined,
		[],
		"legacy fixture",
	);
	const now = new Date().toISOString();
	legacy.active_instances["application-design@module:m11-recommend"] = {
		module_id: "m11-recommend",
		stage_instance: "application-design@module:m11-recommend",
		owner: "legacy",
		claimed_at: now,
		heartbeat_at: now,
		expires_at: now,
	};
	const markdown = renderLightWorkflowState(legacy)
		.split("\n")
		.map((line) =>
			line.startsWith("|") &&
			line.includes("application-design@module:m11-recommend")
				? line.split("|").slice(0, 9).join("|") + "|"
				: line,
		)
		.join("\n");
	assert.equal(
		parseLightWorkflowState(markdown).active_instances[
			"application-design@module:m11-recommend"
		].session_id,
		undefined,
	);
	console.log(
		"MARS-243 split/global/integration/parked/expiry/legacy tests passed; Stop preserves all states, audits and registry",
	);
} finally {
	delete process.env.AIDLC_SESSION_BINDING;
	rmSync(project, { recursive: true, force: true });
}
