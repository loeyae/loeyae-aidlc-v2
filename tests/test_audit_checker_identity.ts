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
const gate = () =>
  JSON.parse(run(["build-and-test-templates", "sensors", "template-completeness"], "tests/gate_probe.ts").stdout)
    .failures as string[];
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
const checker = join(tool, "core/tools/aidlc-semantic-checks.ts");
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
console.log("PASS RA-02: unchanged reuse, legacy refresh, dependency bytes and same-path checker upgrade");
