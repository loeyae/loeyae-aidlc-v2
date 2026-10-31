import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { applyExecutionProfile, classifyExecutionProfile } from "../core/tools/aidlc-execution-profile";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { fixture, write, cli, repository } from "./mars244_fixture";
const f = fixture("build-and-test");
delete f.state.current_module; delete f.state.current_unit;
f.state.execution_profile = applyExecutionProfile({ classified: classifyExecutionProfile({ scope: "bugfix", signals: new Set(["security_or_sensitive_data"]) }), at: new Date().toISOString() });
f.persist();
const binding = JSON.stringify(bindSession(f.root, { instance: "build-and-test", owner: "auditor", session: "security", expected: claimToken(undefined) }).binding);
write(f.root, "auth.cjs", "exports.allowed=(subject,resource)=>Boolean(subject&&subject.id===resource.owner);\n");
write(f.root, "auth.test.cjs", "const {test}=require('node:test');const assert=require('node:assert/strict');const {allowed}=require('./auth.cjs');test('anonymous denied',()=>assert.equal(allowed(null,{owner:'a'}),false));test('other owner denied',()=>assert.equal(allowed({id:'b'},{owner:'a'}),false));\n");
const source = "docs/security-acceptance.md";
write(f.root, source, "NFR-SEC-001: deny anonymous and cross-owner access; verify using auth.test.cjs.\n");
const config = { version: "1", stage: "build-and-test", commands: [
  { id: "build", role: "build", argv: ["node", "--check", "auth.cjs"] },
  { id: "security", role: "test", argv: ["node", "--test", "--test-reporter=tap", "auth.test.cjs"] },
  { id: "check", role: "check", argv: ["node", "--check", "auth.test.cjs"] },
] };
const configPath = ".aidlc/commands/build-and-test.json";
write(f.root, configPath, config);
const produce = () => cli(f.root, ["evidence", "run", "--stage", "build-and-test"], binding);
assert.notEqual(produce().status, 0, "recorded security risk cannot pass without validation coverage");
write(f.root, configPath, { ...config, risk_validation: [{ risk: "security_or_sensitive_data", sources: [source], command_ids: ["security"] }] });
const passed = produce(); assert.equal(passed.status, 0, passed.stdout + passed.stderr);
const gate = () => {
  const result = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "tests/gate_probe.ts"), "build-and-test", "sensors", "build-test-evidence"], { cwd: f.root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).failures;
};
assert.deepEqual(gate(), []);
write(f.root, source, "NFR-SEC-001 changed acceptance boundary.\n");
assert.ok(gate().length, "changed acceptance sources invalidate security observation");
console.log("PASS risk-derived security: real project tests, missing verification and source drift blocked");
