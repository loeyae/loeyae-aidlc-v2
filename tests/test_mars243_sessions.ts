import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import {
	appendAuditEvent,
 createInitialState,
	saveWorkflowState,
	loadWorkflowState,
	lightStatePath,
	lightAuditPath,
	renderLightWorkflowState,
	parseLightWorkflowState,
	withSessionPublication,
	assertSessionClaim,
	type SessionBinding,
} from "../core/tools/aidlc-light-state";
import {
	bindSession,
	claimToken,
	captureScopeSession,
	publishScope,
} from "../core/tools/aidlc-session";
const root = mkdtempSync(join(tmpdir(), "aidlc-mars243-"));
const tsx = resolve("node_modules/tsx/dist/cli.mjs"),
	cli = resolve("bin/cli.ts");
function write(project: string, path: string, body: string) {
	mkdirSync(dirname(join(project, path)), { recursive: true });
	writeFileSync(join(project, path), body);
}
function fixture(
	name: string,
	instance = "application-design@module:m11-recommend",
) {
	const project = join(root, name);
	mkdirSync(project, { recursive: true });
	write(
		project,
		"docs/aidlc/ideation/module-manifest.json",
		JSON.stringify({
			schema_version: 1,
			modules: [
				{
					module_id: "m11-recommend",
					name: "Recommend",
					service_id: "recommend",
				},
			],
		}),
	);
	const state = createInitialState(
		"feature",
		"4.20.0",
		undefined,
		[],
		"session fixture",
	);
	state.current_stage = instance.split("@")[0];
	state.current_stage_instance = instance;
	if (instance.includes("@module:")) state.current_module = "m11-recommend";
	if (instance.includes("@module:")) {
		state.completed_stages = ["module-division"];
		state.completed_stage_instances = ["module-division"];
	}
	saveWorkflowState(project, state);
	return project;
}
function run(project: string, args: string[], binding?: SessionBinding) {
	return spawnSync(process.execPath, [tsx, cli, ...args], {
		cwd: project,
		encoding: "utf8",
		env: {
			...process.env,
			AIDLC_SESSION_BINDING: binding ? JSON.stringify(binding) : "",
		},
	});
}
function snapshot(project: string) {
	return [
		readFileSync(lightStatePath(project), "utf8"),
		readFileSync(lightAuditPath(project), "utf8"),
	];
}
function request(
	project: string,
	session: string,
	owner = "alice",
	extra = {},
) {
	const state = loadWorkflowState(project)!;
	const instance = state.current_stage_instance!;
	return {
		instance,
		session,
		owner,
		expected: claimToken(state.active_instances[instance]),
		...extra,
	};
}
async function child(
	project: string,
	args: string[],
	binding?: SessionBinding,
) {
	return new Promise<{ status: number; out: string }>(
		(resolveResult, reject) => {
			const proc = spawn(process.execPath, [tsx, cli, ...args], {
				cwd: project,
				env: {
					...process.env,
					AIDLC_SESSION_BINDING: binding ? JSON.stringify(binding) : "",
				},
			});
			let out = "";
			proc.stdout.on("data", (data) => (out += data));
			proc.stderr.on("data", (data) => (out += data));
			proc.on("error", reject);
			proc.on("close", (status) => resolveResult({ status: status ?? 1, out }));
		},
	);
}
try {
	const project = fixture("handoff");
	const instance = loadWorkflowState(project)!.current_stage_instance!;
	const a = bindSession(project, request(project, "A"));
	assert.deepEqual(
		parseLightWorkflowState(
			renderLightWorkflowState(loadWorkflowState(project)!),
		).active_instances,
		loadWorkflowState(project)!.active_instances,
	);
	process.env.AIDLC_SESSION_BINDING = JSON.stringify(a.binding);
	const captured = captureScopeSession(project, {
		stage: "application-design",
		module_id: "m11-recommend",
	});
	delete process.env.AIDLC_SESSION_BINDING;
	const before = snapshot(project);
	assert.throws(
		() => bindSession(project, request(project, "B")),
		/human instruction/,
	);
	assert.deepEqual(snapshot(project), before);
	bindSession(
		project,
		request(project, "B", "alice", {
			humanInstructionRef: "human:loeye/MARS-243",
			preview: true,
		}),
	);
	assert.deepEqual(snapshot(project), before);
	const b = bindSession(
		project,
		request(project, "B", "alice", {
			humanInstructionRef: "human:loeye/MARS-243",
		}),
	);
	process.env.AIDLC_SESSION_BINDING = JSON.stringify(b.binding);
	assert.throws(
		() =>
			publishScope(project, captured, () =>
				write(project, "stale-provider.txt", "bad"),
			),
		/transferred|conflict/,
	);
	delete process.env.AIDLC_SESSION_BINDING;
	assert.equal(existsSync(join(project, "stale-provider.txt")), false);
	assert.equal(b.claim.owner, "alice");
	assert.equal(b.claim.session_id, "B");
	assert.notEqual(a.claim.generation, b.claim.generation);
	for (const args of [
		[
			"orchestrate",
			"report",
			"--stage",
			"application-design",
			"--result",
			"completed",
			"--module",
			"m11-recommend",
			"--owner",
			"alice",
		],
		["orchestrate", "park"],
		["orchestrate", "next"],
		["module", "heartbeat", "--stage-instance", instance, "--owner", "alice"],
		[
			"module",
			"claim",
			"--module",
			"m11-recommend",
			"--stage-instance",
			instance,
			"--owner",
			"alice",
		],
		[
			"module",
			"select",
			"--module",
			"m11-recommend",
			"--owner",
			"alice",
			"--replace",
		],
		[
			"evidence",
			"run",
			"--stage",
			"application-design",
			"--module",
			"m11-recommend",
		],
	]) {
		const current = snapshot(project),
			result = run(project, args, a.binding);
		assert.notEqual(
			result.status,
			0,
			`${args}: ${result.stdout} ${result.stderr}`,
		);
		assert.match(
			result.stdout + result.stderr,
			/transferred|binding|conflict/i,
		);
		assert.deepEqual(snapshot(project), current);
	}
	const denied = run(
		project,
		[
			"orchestrate",
			"report",
			"--stage",
			"application-design",
			"--result",
			"approved",
			"--user-input",
			"Approve",
			"--module",
			"m11-recommend",
		],
		b.binding,
	);
	assert.notEqual(denied.status, 0);
	assert.doesNotMatch(
		denied.stdout + denied.stderr,
		/binding required|claim transferred/,
	);
	assert.match(
		denied.stdout + denied.stderr,
		/artifact|sensor|approval|Approve|produce|consum/i,
	);
	assert.throws(
		() =>
			assertSessionClaim(project, loadWorkflowState(project)!, instance, {
				...b.binding,
				project_root: root,
			}),
		/conflicts/,
	);
	process.env.AIDLC_SESSION_BINDING = JSON.stringify(a.binding);
	assert.throws(
		() =>
			withSessionPublication(project, { kind: "global" }, instance, () =>
				write(project, "stale.txt", "bad"),
			),
		/transferred/,
	);
	assert.equal(existsSync(join(project, "stale.txt")), false);
	delete process.env.AIDLC_SESSION_BINDING;
  const beforeAudit = snapshot(project);
  process.env.AIDLC_SESSION_BINDING = JSON.stringify(a.binding);
  assert.throws(() => appendAuditEvent(project, {kind: "global"}, "STALE", {owner: "alice"}), /transferred|conflict/);
  const attempted = loadWorkflowState(project)!;
  attempted.status = "parked";
  assert.throws(() => saveWorkflowState(project, attempted, {kind: "global"}, {claimWrite: Symbol("forged")}), /transferred|conflict/);
  delete process.env.AIDLC_SESSION_BINDING;
  assert.deepEqual(snapshot(project), beforeAudit);
	const expected = claimToken(
		loadWorkflowState(project)!.active_instances[instance],
	);
	const transfer = (session: string) => [
		"module",
		"transfer",
		"--stage-instance",
		instance,
		"--owner",
		"alice",
		"--session-id",
		session,
		"--expect",
		expected,
		"--human-instruction-ref",
		"human:loeye/race",
	];
	const race = await Promise.all([
		child(project, transfer("C")),
		child(project, transfer("D")),
	]);
	assert.equal(
		race.filter((result) => result.status === 0).length,
		1,
		JSON.stringify(race),
	);
	// A real controlled command transfers ownership while its evidence producer is in flight.
	const evidence = fixture("inflight", "build-and-test");
	spawnSync("git", ["init", "-q"], { cwd: evidence });
	write(evidence, "README.md", "controlled producer fixture");
	spawnSync("git", ["add", "README.md"], { cwd: evidence });
	spawnSync(
		"git",
		[
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"-qm",
			"fixture",
		],
		{ cwd: evidence },
	);
	const ea = bindSession(evidence, request(evidence, "producer-A"));
	const command =
		"require('fs').writeFileSync('started','yes'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1500); console.log('1 passed');";
	write(
		evidence,
		".aidlc/evidence-commands.json",
		JSON.stringify({
			version: "1",
			stage: "build-and-test",
			commands: [
				{ id: "build", role: "build", argv: ["node", "-e", command] },
				{
					id: "test",
					role: "test",
					argv: ["node", "-e", "console.log('1 passed')"],
				},
				{ id: "check", role: "check", argv: ["node", "-e", "process.exit(0)"] },
			],
		}),
	);
	const underway = child(
		evidence,
		["evidence", "run", "--stage", "build-and-test"],
		ea.binding,
	);
	const started = Date.now();
	while (!existsSync(join(evidence, "started")) && Date.now() - started < 15000)
		await new Promise((r) => setTimeout(r, 50));
	if (!existsSync(join(evidence, "started")))
		throw new Error(
			"controlled command did not start: " + JSON.stringify(await underway),
		);
	bindSession(
		evidence,
		request(evidence, "producer-B", "alice", {
			humanInstructionRef: "human:loeye/inflight",
		}),
	);
	const transferred = snapshot(evidence);
	const result = await underway;
	assert.notEqual(result.status, 0, result.out);
	assert.match(result.out, /transferred|conflict/);
	assert.deepEqual(snapshot(evidence), transferred);
	assert.equal(
		existsSync(
			join(evidence, ".aidlc/evidence/build-and-test/build-test-evidence.json"),
		),
		false,
	);
	console.log(
		"MARS-243 session claims passed: roundtrip, preview, same-owner transfer, stale write paths, race, in-flight evidence",
	);
} finally {
	delete process.env.AIDLC_SESSION_BINDING;
	rmSync(root, { recursive: true, force: true });
}
