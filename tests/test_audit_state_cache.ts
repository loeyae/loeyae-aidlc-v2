import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
	createInitialState,
	lightStatePath,
	loadWorkflowState,
	renderLightWorkflowState,
} from "../core/tools/aidlc-light-state";
import {
	loadRegistry,
	registryPath,
	renderRegistry,
	type WorkflowRegistry,
} from "../core/tools/aidlc-workflow-layout";

const root = mkdtempSync(join(tmpdir(), "aidlc-state-cache-"));
const version = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const initial = createInitialState(
	"express",
	version,
	randomUUID(),
	[],
	"alpha",
);
const file = lightStatePath(root);
const fixed = new Date("2024-01-01T00:00:00.000Z");
// The workflow directory is an explicit test arrangement, not a production stage report.
mkdirSync(dirname(file), { recursive: true });
const publish = (state: typeof initial, target = file) => {
	writeFileSync(target, renderLightWorkflowState(state));
	utimesSync(target, fixed, fixed);
};
publish(initial);
const first = loadWorkflowState(root)!;
const before = statSync(file);
const changed = { ...first, work_description: "bravo" };
publish(changed);
assert.equal(statSync(file).mtimeMs, before.mtimeMs);
assert.equal(
	statSync(file).size,
	before.size,
	"same-length content must invalidate the parse cache too",
);
assert.equal(
	loadWorkflowState(root)!.work_description,
	"bravo",
	"same mtime and size must never return stale workflow bytes",
);

changed.status = "parked";
changed.completed_stage_instances = [
	"code-generation@module:project@unit:default",
	"code-review@module:project@unit:default",
];
publish(changed);
const parked = loadWorkflowState(root)!;
assert.equal(parked.status, "parked");
assert.deepEqual(
	parked.completed_stage_instances,
	changed.completed_stage_instances,
);
parked.status = "done";
parked.completed_stage_instances.length = 0;
assert.equal(
	loadWorkflowState(root)!.status,
	"parked",
	"cache results remain independent clones",
);
assert.deepEqual(
	loadWorkflowState(root)!.completed_stage_instances,
	changed.completed_stage_instances,
);

const replacement = file + ".replacement";
publish({ ...changed, work_description: "delta" }, replacement);
renameSync(replacement, file);
assert.equal(statSync(file).mtimeMs, before.mtimeMs);
assert.equal(
	loadWorkflowState(root)!.work_description,
	"delta",
	"atomic replacement with the same timestamp is fresh",
);
console.log(
	"PASS workflow cache: equal mtime/size, completion and parked state, clone isolation and atomic replacement",
);

const registry: WorkflowRegistry = {
	version: "1",
	global_workflow_id: initial.workflow_id,
	split_from_workflow_id: initial.workflow_id,
	split_at: fixed.toISOString(),
	updated_at: fixed.toISOString(),
	modules: [],
	integration: {
		workflow_id: randomUUID(),
		state_path: "aidlc/active/integration/aidlc-state.md",
		status: "running",
		current_stage: "-",
		barrier_ready: false,
		blocking: [],
	},
	shared_contracts: [],
	cross_module_requires: [],
};
const registryFile = registryPath(root);
writeFileSync(registryFile, renderRegistry(registry));
utimesSync(registryFile, fixed, fixed);
assert.equal(
	loadRegistry(root)!.global_workflow_id,
	registry.global_workflow_id,
);
const registrySize = statSync(registryFile).size;
const changedRegistry = { ...registry, global_workflow_id: randomUUID() };
writeFileSync(registryFile, renderRegistry(changedRegistry));
utimesSync(registryFile, fixed, fixed);
assert.equal(statSync(registryFile).size, registrySize);
assert.equal(
	loadRegistry(root)!.global_workflow_id,
	changedRegistry.global_workflow_id,
	"registry identities must reflect equal-mtime/size external writes",
);
const clone = loadRegistry(root)!;
clone.global_workflow_id = "mutated";
assert.equal(
	loadRegistry(root)!.global_workflow_id,
	changedRegistry.global_workflow_id,
);
console.log(
	"PASS registry cache: equal mtime/size identity updates and clone isolation",
);
