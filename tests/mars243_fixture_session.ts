import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import {
	bindSession,
	claimToken,
	sessionRef,
} from "../core/tools/aidlc-session";
import {
	bindingFor,
	loadWorkflowState,
	lightStatePath,
 renderLightWorkflowState,
	type WorkflowState,
} from "../core/tools/aidlc-light-state";

/** Fixture administration only: arrange a state, then exercise production CLI gates with an explicit session. */
export function saveFixtureState(project: string, state: WorkflowState) {
  const path = lightStatePath(project);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderLightWorkflowState(state), "utf8");
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
	if (!["orchestrate", "evidence", "module"].includes(args[0]) || flags.status)
		return { ...process.env, AIDLC_SESSION_BINDING: "" };
	let instance: string | undefined;
	if (args[0] === "orchestrate" && args[1] === "next") {
		const preview = spawnSync(
			process.execPath,
			[
				resolve("node_modules/tsx/dist/cli.mjs"),
				resolve("bin/cli.ts"),
				"orchestrate",
				"next",
				"--preview",
				...(flags.module ? ["--module", flags.module] : []),
			],
			{
				cwd: project,
				encoding: "utf8",
				env: { ...process.env, AIDLC_SESSION_BINDING: "" },
			},
		);
		if (preview.status === 0)
			instance = JSON.parse(preview.stdout).stage_instance;
	} else {
		const state = loadWorkflowState(
			project,
			flags.module
				? sessionRef(project, `placeholder@module:${flags.module}`)
				: undefined,
		);
		instance = flags.instance || state?.current_stage_instance;
		if (flags.stage && state && flags.stage !== state.current_stage) {
			const axis = JSON.parse(requireGraph()).stages.find(
				(s: { slug: string }) => s.slug === flags.stage,
			)?.axis;
			instance =
				axis === "project"
					? flags.stage
					: `${flags.stage}@module:${flags.module || state.current_module || "project"}${axis === "unit" ? `@unit:${flags.unit || state.current_unit || "default"}` : ""}`;
		}
	}
	if (!instance) return { ...process.env, AIDLC_SESSION_BINDING: "" };
	const state = loadWorkflowState(project, sessionRef(project, instance));
	if (!state) return { ...process.env, AIDLC_SESSION_BINDING: "" };
	const existing = state.active_instances[instance];
	const binding = existing?.session_id
		? bindingFor(project, state, existing)
		: bindSession(project, {
				instance,
				owner: "fixture-owner",
				session: "fixture-session",
				expected: claimToken(existing),
				...(existing && existing.owner !== "fixture-owner"
					? { humanInstructionRef: "test-fixture:explicit-owner-migration" }
					: {}),
			}).binding;
	return { ...process.env, AIDLC_SESSION_BINDING: JSON.stringify(binding) };
}
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
function requireGraph() {
	return readFileSync(resolve("core/tools/data/stage-graph.json"), "utf8");
}
