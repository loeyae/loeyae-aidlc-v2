import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
	createInitialState,
	saveWorkflowState,
	lightStatePath,
} from "../core/tools/aidlc-light-state";
const project = mkdtempSync(join(tmpdir(), "aidlc-mars243-stop-"));
try {
	const state = createInitialState(
		"feature",
		"4.20.0",
		undefined,
		[],
		"B/C missing design evidence",
	);
	state.current_stage = "application-design";
	state.current_stage_instance = "application-design@module:m11-recommend";
	state.current_module = "m11-recommend";
	saveWorkflowState(project, state);
	const before = readFileSync(lightStatePath(project));
	for (const format of [
		"claude",
		"codex",
		"codebuddy",
		"zcode",
		"qoder-cli",
		"opencode",
		"kiro",
	]) {
		const result = spawnSync(
			process.execPath,
			[
				resolve("node_modules/tsx/dist/cli.mjs"),
				resolve("core/tools/aidlc-platform-hook.ts"),
				"--format",
				format,
			],
			{
				cwd: project,
				input: JSON.stringify({
					cwd: project,
					session_id: "provider-install-A",
				}),
				encoding: "utf8",
				env: {
					...process.env,
					AIDLC_ACTIVE_MODULE: "m02-other",
					AIDLC_SESSION_BINDING: "",
				},
			},
		);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(
			result.stdout,
			"",
			`${format}: unrelated session must be allowed: ${result.stdout}`,
		);
		assert.deepEqual(readFileSync(lightStatePath(project)), before);
	}
	console.log("MARS-243 Stop isolation passed (7 formats; state unchanged)");
} finally {
	rmSync(project, { recursive: true, force: true });
}
