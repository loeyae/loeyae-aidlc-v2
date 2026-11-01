import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
import { sessionRef } from "../core/tools/aidlc-session";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";
import { write, cli } from "./mars244_fixture";

/** Arrange real producer observations for the focused global gate fixture. */
export function globalFixtureSources(root: string) {
  const modules = JSON.parse(readFileSync(join(root, "docs/aidlc/ideation/module-manifest.json"), "utf8")).modules;
  for (const module of modules) {
    const base = `docs/aidlc/modules/${module.module_id}/inception`;
    let units: Array<{ unit_id: string }>;
    try {
      units = JSON.parse(readFileSync(join(root, base, "unit-manifest.json"), "utf8")).units;
    } catch {
      units = [{ unit_id: "default" }];
      write(root, `${base}/unit-manifest.json`, {
        schema_version: 1,
        module_id: module.module_id,
        units: [
          {
            unit_id: "default",
            name: "Default",
            service_id: module.module_id,
            req_refs: ["REQ-001"],
            conditional_stages: [],
          },
        ],
      });
    }
    if (module.module_id === "other") {
      write(root, `${base}/requirements.md`, "# Requirements\nREQ-001 文件读取验收行为\n");
      write(
        root,
        `${base}/user-stories.md`,
        "# Stories\nUS-001 REQ-001\nAC-001 Given a file When reading Then return its content\n",
      );
    }
    const moduleState = loadWorkflowState(root, sessionRef(root, `units-generation@module:${module.module_id}`))!;
    moduleState.completed_stage_instances = [
      ...new Set([...moduleState.completed_stage_instances, `units-generation@module:${module.module_id}`]),
    ];
    moduleState.completed_stages = [...new Set([...moduleState.completed_stages, "units-generation"])];
    saveFixtureState(root, moduleState, sessionRef(root, `units-generation@module:${module.module_id}`));
    const run = (stage: string, unit?: string) => {
      const instance = `${stage}@module:${module.module_id}${unit ? `@unit:${unit}` : ""}`;
      const ref = sessionRef(root, instance),
        state = loadWorkflowState(root, ref)!;
      const cursor = {
        current_stage: state.current_stage,
        current_stage_instance: state.current_stage_instance,
        current_phase: state.current_phase,
        current_module: state.current_module,
        current_unit: state.current_unit,
      };
      Object.assign(state, {
        current_stage: stage,
        current_stage_instance: instance,
        current_module: module.module_id,
        current_unit: unit,
        current_phase: stage === "test-case-derivation" ? "inception" : "construction",
      });
      saveFixtureState(root, state, ref);
      const args = [
        "evidence",
        "run",
        "--stage",
        stage,
        "--module",
        module.module_id,
        ...(unit ? ["--unit", unit] : []),
        ...(stage === "test-case-derivation" ? ["--sensor", "test-case-derivation"] : []),
      ];
      const result = cli(root, args, fixtureEnvironment(root, args).AIDLC_SESSION_BINDING);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const after = loadWorkflowState(root, ref)!;
      Object.assign(after, cursor);
      saveFixtureState(root, after, ref);
    };
    units.forEach((unit, index) => {
      const id = `UC-D-${String(index + 1).padStart(3, "0")}`,
        n = String(index + 1).padStart(3, "0");
      write(
        root,
        `${base}/application-design/test-cases/${id}.md`,
        `---\nid: ${id}\nstatus: ready\nsource_ref: [REQ-${n}, US-${n}, AC-${n}]\nunit_refs: [${unit.unit_id}]\n---\n# ${id}\n文件读取返回已批准内容。\n`,
      );
      write(
        root,
        `docs/aidlc/modules/${module.module_id}/construction/${unit.unit_id}/plans/code-generation-plan.md`,
        `# Plan\nREQ-${n}: read the existing approved file; see functional-design/behavior.md.\n`,
      );
      write(root, `docs/aidlc/modules/${module.module_id}/construction/${unit.unit_id}/functional-design/behavior.md`, `# Behavior mapping\n${id}: read the existing approved file.\n`);
      const source = module.module_id === "other" ? "src/other/code.ts" : `src/shop/${unit.unit_id}/code.ts`;
      const expected = readFileSync(join(root, source), "utf8"),
        test = `checks/${module.module_id}-${unit.unit_id}.test.cjs`;
      write(
        root,
        test,
        `// ${id}\nconst assert=require('node:assert/strict'),fs=require('node:fs');\nfunction checkValue(){assert.equal(fs.readFileSync(${JSON.stringify(source)},'utf8'),${JSON.stringify(expected)});}\ncheckValue();\nconsole.log(JSON.stringify({phase:'GREEN',status:'passed',compile_status:'passed',environment_status:'passed',tests_total:1,tests_passed:1,tests_failed:0,tests_skipped:0,traceability_complete:true,uc_mapping:[{use_case:${JSON.stringify(id)},test_methods:[${JSON.stringify(test + "#checkValue")}]}]}));\n`,
      );
    });
    write(
      root,
      `${base}/application-design/test-cases/_index.md`,
      units.map((_, i) => `UC-D-${String(i + 1).padStart(3, "0")}`).join("\n"),
    );
    run("test-case-derivation");
  }
  // Retain each unit's actual command binding; production currently uses a
  // shared stage command, so the focused fixture needs one multi-unit adapter.
  const all = modules.flatMap((module: { module_id: string }) => {
    const base = `docs/aidlc/modules/${module.module_id}/inception`;
    let units;
    try {
      units = JSON.parse(readFileSync(join(root, base, "unit-manifest.json"), "utf8")).units;
    } catch {
      units = [{ unit_id: "default" }];
    }
    return units.map((unit: { unit_id: string }) => ({ module: module.module_id, unit: unit.unit_id }));
  });
  write(
    root,
    "checks/green.cjs",
    `require('./'+process.env.AIDLC_ACTIVE_MODULE+'-'+process.env.AIDLC_ACTIVE_UNIT+'.test.cjs');\n`,
  );
  write(root, ".aidlc/commands/code-generation.json", {
    version: "1",
    stage: "code-generation",
    commands: [{ id: "green", role: "green", argv: ["node", "checks/green.cjs"] }],
  });
  for (const { module, unit } of all) {
    const instance = `code-generation@module:${module}@unit:${unit}`,
      ref = sessionRef(root, instance),
      state = loadWorkflowState(root, ref)!;
    const cursor = {
      current_stage: state.current_stage,
      current_stage_instance: state.current_stage_instance,
      current_phase: state.current_phase,
      current_module: state.current_module,
      current_unit: state.current_unit,
    };
    Object.assign(state, {
      current_stage: "code-generation",
      current_stage_instance: instance,
      current_phase: "construction",
      current_module: module,
      current_unit: unit,
    });
    saveFixtureState(root, state, ref);
    const args = [
      "evidence",
      "run",
      "--stage",
      "code-generation",
      "--module",
      module,
      "--unit",
      unit,
      "--sensor",
      "green-test-evidence",
    ];
    const result = cli(root, args, fixtureEnvironment(root, args).AIDLC_SESSION_BINDING);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const after = loadWorkflowState(root, ref)!;
    Object.assign(after, cursor);
    saveFixtureState(root, after, ref);
  }
}
