import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Cli = (project: string, args: string[]) => { status: number; stdout: string; stderr: string };

/** Valid phase prerequisites for MARS-271's payload-tampering gate tests.
 * Observe an actual assertion failing, then passing after only production changes.
 * The producer alone creates provenance and selective historical input bindings. */
export function observeMars271Phases(project: string, run: Cli, mappingDebt?: Array<{ id: string; reason: string }>): void {
  mkdirSync(join(project, "tests"), { recursive: true });
  mkdirSync(join(project, "src"), { recursive: true });
  const testPath = "tests/behavior.test.cjs", sourcePath = join(project, "src/behavior.cjs");
  writeFileSync(join(project, testPath), "const assert = require('node:assert/strict');\nassert.equal(require('../src/behavior.cjs')(), true);\n");
  writeFileSync(sourcePath, "// REQ-1 UC-D-001\nmodule.exports = () => false;\n");
  const observer = `const assert = require('node:assert/strict');
const phase = process.env.AIDLC_PHASE;
let failure;
try { require('./tests/behavior.test.cjs'); }
catch (error) { if (!(error instanceof assert.AssertionError)) throw error; failure = error; }
console.log(JSON.stringify({phase, status: failure ? 'failed' : 'passed', compile_status: 'passed', environment_status: 'passed', tests_total: 1, tests_failed: failure ? 1 : 0, traceability_complete: true,
  ...(failure ? {failure_class: 'behavior', failure_signature: failure.message} : {}),
  uc_mapping: [{use_case: 'UC-D-001', test_methods: ['${testPath}#behavior']}],
  ...(phase === 'GREEN' ? ${JSON.stringify(mappingDebt ? { mapping_debt: mappingDebt } : {})} : {})}));
process.exit(failure ? 1 : 0);
`;
  // Both stable command scripts exist before RED, so the fixture never repairs
  // the observation by changing its test/command inputs after implementation.
  writeFileSync(join(project, "red-observer.js"), observer);
  writeFileSync(join(project, "green-observer.js"), observer);
  const execute = (stage: string, sensor: string) => {
    const result = run(project, ["evidence", "run", "--stage", stage, "--module", "project", "--unit", "default", "--sensor", sensor]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return JSON.parse(readFileSync(join(project, ".aidlc/evidence", stage, "project/default", `${sensor}.json`), "utf8"));
  };
  const red = execute("tdd", "red-test-evidence");
  assert.equal(red.observed_command.exit_code, 1);
  assert.deepEqual(red.phase_input_binding.unresolved_test_methods, []);
  assert(red.phase_input_binding.files.some((file: { path: string }) => file.path === testPath));
  assert.equal(execute("tdd", "baseline-test-evidence").status, "not_required");
  writeFileSync(sourcePath, "// REQ-1 UC-D-001\nmodule.exports = () => true;\n");
  const green = execute("code-generation", "green-test-evidence");
  assert.equal(green.observed_command.exit_code, 0);
  assert.equal(green.tests_failed, 0);
  assert.deepEqual(green.uc_mapping, [{ use_case: "UC-D-001", test_methods: [`${testPath}#behavior`] }]);
}
