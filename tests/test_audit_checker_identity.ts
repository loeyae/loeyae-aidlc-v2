import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  appendFileSync,
  statSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fixture, write, repository } from "./mars244_fixture";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
const tool = mkdtempSync(join(tmpdir(), "aidlc-checker-version-"));
for (const name of ["core", "bin", "package.json", "tsconfig.json"])
  cpSync(join(repository, name), join(tool, name), { recursive: true });
mkdirSync(join(tool, "tests"));
cpSync(join(repository, "tests/gate_probe.ts"), join(tool, "tests/gate_probe.ts"));
mkdirSync(join(tool, "node_modules"));
for (const name of readdirSync(join(repository, "node_modules"))) {
  if (name.startsWith(".")) continue;
  const source = join(repository, "node_modules", name),
    target = join(tool, "node_modules", name);
  if (name === "yaml") cpSync(source, target, { recursive: true });
  else symlinkSync(source, target, "junction");
}
const f = fixture("build-and-test-templates");
delete f.state.current_module;
delete f.state.current_unit;
f.persist();
for (const name of ["build-instructions.md", "unit-test-instructions.md"])
  write(
    f.root,
    `docs/aidlc/construction/build-and-test/${name}`,
    "# Instructions\nREQ-001: Run the actual project command and inspect its result before delivery.\n",
  );
const binding = JSON.stringify(
  bindSession(f.root, {
    instance: "build-and-test-templates",
    owner: "auditor",
    session: "checker-identity",
    expected: claimToken(undefined),
  }).binding,
);
const run = (args: string[], entry = "bin/cli.ts") =>
  spawnSync(process.execPath, [join(tool, "node_modules/tsx/dist/cli.mjs"), join(tool, entry), ...args], {
    cwd: f.root,
    encoding: "utf8",
    env: { ...process.env, AIDLC_SESSION_BINDING: binding },
  });
const args = [
  "evidence",
  "run",
  "--stage",
  "build-and-test-templates",
  "--instance",
  "build-and-test-templates",
  "--sensor",
  "template-completeness",
];
const initial = run(args);
assert.equal(initial.status, 0, initial.stdout + initial.stderr);
const evidencePath = join(f.root, ".aidlc/evidence/build-and-test-templates/template-completeness.json");
const completed = loadWorkflowState(f.root)!;
completed.completed_stage_instances.push("build-and-test-templates");
completed.completed_stages.push("build-and-test-templates");
delete completed.current_stage_instance;
completed.current_stage = "";
f.persist(completed);
const unchanged = run([...args, "--refresh"]);
assert.equal(unchanged.status, 0, unchanged.stderr);
assert.match(unchanged.stdout, /"action": "reused"/);
const manifest = join(tool, "package.json"), packageMetadata = JSON.parse(readFileSync(manifest, "utf8"));
writeFileSync(manifest, JSON.stringify({ ...packageMetadata, version: "99.0.0" }));
assert.match(run([...args, "--refresh"]).stdout, /"action": "reused"/, "package version alone does not change isolated checker behavior");
const template = join(f.root, "docs/aidlc/construction/build-and-test/build-instructions.md");
const stamp = statSync(template), templateBefore = readFileSync(template, "utf8");
utimesSync(template, new Date(), new Date());
assert.match(run([...args, "--refresh"]).stdout, /"action": "reused"/, "timestamp-only changes do not rerun a content check");
writeFileSync(join(f.root, "src/shop/api/code.ts"), "unrelated source edit");
assert.match(run([...args, "--refresh"]).stdout, /"action": "reused"/, "unrelated implementation is outside the template contract");
appendFileSync(join(tool, "core/tools/aidlc-semantic-checks.ts"), "\n// Unrelated checker edit.\n");
assert.match(run([...args, "--refresh"]).stdout, /"action": "reused"/, "unrelated checker code is outside the isolated implementation");
writeFileSync(template, templateBefore.replace("actual", "edited")); utimesSync(template, stamp.atime, stamp.mtime);
const templateChanged = run([...args, "--refresh"]);
assert.equal(templateChanged.status, 0, templateChanged.stderr);
assert.match(templateChanged.stdout, /"action": "regenerated"/, "same-size content edit with restored mtime invalidates");
assert.match(templateChanged.stdout, /build-instructions.md/, "changed content is identified");
writeFileSync(join(f.root, "shared/api.json"), "{\"changed\":true}");
assert.match(run([...args, "--refresh"]).stdout, /"action": "regenerated"/, "declared shared inputs remain dependencies");
const gate = () =>
  JSON.parse(run(["build-and-test-templates", "sensors", "template-completeness"], "tests/gate_probe.ts").stdout)
    .failures as string[];
assert.deepEqual(gate(), [], "narrow input scope is accepted by the real gate after unrelated source/checker changes");
for (const [name, corrupt] of [
  ["failed payload", (value: any) => { value.status = "failed"; }],
  ["unresolved templates", (value: any) => { value.unresolved = 1; }],
  ["wrong checker sensor", (value: any) => { value.checker.sensor = "test-quality"; }],
  ["wrong checker id", (value: any) => { value.checker.id = "builtin:test-quality"; }],
  ["wrong producer", (value: any) => { value.producer.name = "untrusted-producer"; }],
  ["missing execution id", (value: any) => { delete value.producer.execution_id; }],
  ["wrong template paths", (value: any) => { value.templates = ["other.md", "unexpected.md"]; }],
  ["invalid source digest", (value: any) => { value.source_revision.worktree_digest = "invalid"; }],
  ["invalid source commit", (value: any) => { value.source_revision.commit = "invalid"; }],
  ["unverifiable source commit", (value: any) => { value.source_revision.commit = "f".repeat(40); }],
] as const) {
  const corrupted = JSON.parse(readFileSync(evidencePath, "utf8")); corrupt(corrupted);
  writeFileSync(evidencePath, JSON.stringify(corrupted));
  const repaired = run([...args, "--refresh"]);
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  assert.match(repaired.stdout, /"action": "regenerated"/, `${name} must be repaired instead of returning success with an unusable record`);
  assert.deepEqual(gate(), [], `${name} is restored through a controlled observation`);
}
const legacy = JSON.parse(readFileSync(evidencePath, "utf8"));
delete legacy.checker.implementation_digest;
writeFileSync(evidencePath, JSON.stringify(legacy));
assert(
  gate().some((error) => error.includes("implementation")),
  "old evidence without checker identity cannot pass",
);
const migrated = run([...args, "--refresh"]);
assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
assert.match(migrated.stdout, /"action": "regenerated"/);
const yaml = createRequire(join(tool, "package.json")).resolve("yaml");
appendFileSync(yaml, "\n// Actual dependency bytes changed, package version retained.\n");
assert(
  gate().some((error) => error.includes("implementation")),
  "dependency bytes invalidate the old observation",
);
const dependencyUpgrade = run([...args, "--refresh"]);
assert.equal(dependencyUpgrade.status, 0, dependencyUpgrade.stderr);
assert.match(dependencyUpgrade.stdout, /"action": "regenerated"/);
const before = readFileSync(evidencePath);
const checker = join(tool, "core/tools/aidlc-template-checker.ts");
writeFileSync(
  checker,
  'process.stderr.write("CHECKER_UPGRADE_REJECTS\\n");process.exit(45);\n' +
    readFileSync(checker, "utf8").replace(/^#![^\n]*\n/, ""),
);
assert(
  gate().some((error) => error.includes("implementation")),
  "same-path checker upgrade invalidates the gate",
);
const upgraded = run([...args, "--refresh"]);
assert.notEqual(upgraded.status, 0, "refresh must execute the changed checker");
assert.match(upgraded.stderr, /CHECKER_UPGRADE_REJECTS/);
assert.deepEqual(readFileSync(evidencePath), before, "failed new checker does not replace earlier evidence");
appendFileSync(checker, '\nimport "./undeclared-checker-dependency.ts";\n');
const undeclared = run([...args, "--refresh"]);
assert.notEqual(undeclared.status, 0);
assert.match(undeclared.stderr, /undeclared checker dependency/, "new imports cannot escape the declared implementation closure");
assert.deepEqual(readFileSync(evidencePath), before);
writeFileSync(join(tool, "core/tools/undeclared-checker-dependency.ts"), "export const observed = true;\n");
writeFileSync(checker, readFileSync(join(repository, "core/tools/aidlc-template-checker.ts"), "utf8") + '\nimport/* closure audit */ "./undeclared-checker-dependency";\n');
const commentedImport = run([...args, "--refresh"]);
assert.notEqual(commentedImport.status, 0, "a valid commented import cannot produce an observation with unbound dependencies");
assert.match(commentedImport.stderr, /undeclared checker dependency/);
assert.deepEqual(readFileSync(evidencePath), before, "blocked import cannot replace controlled evidence");
for (const statement of [
  'import type from "./aidlc-revision"; console.log(typeof type);',
  'import {createRequire as makeLoader} from "node:module"; const load = makeLoader(import.meta.url); load("./undeclared-checker-dependency");',
]) {
  writeFileSync(checker, readFileSync(join(repository, "core/tools/aidlc-template-checker.ts"), "utf8") + `\n${statement}\n`);
  const unsafe = run([...args, "--refresh"]);
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /undeclared checker dependency/);
  assert.deepEqual(readFileSync(evidencePath), before, "unbound runtime loads cannot replace controlled evidence");
}
console.log("PASS RA-02: unchanged reuse, legacy refresh, dependency bytes and same-path checker upgrade");
