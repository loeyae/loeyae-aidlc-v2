/** Engineering fixture: seeded workflow rows/reviewer, real Native producers and functions. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { observationFixture, put, ref } from "./observation-fixture";
import { observationHash } from "../../core/tools/aidlc-observation-inputs";
import { bindSession, claimToken, releaseSession } from "../../core/tools/aidlc-session";
import { renderLightWorkflowState } from "../../core/tools/aidlc-light-state";
import { runObservations } from "../../core/tools/aidlc-observations";
import { prepareNativeUi } from "./it07-native-ui";
const repository = resolve(import.meta.dirname, "../..");
export function plannedLayoutDecision(f: any) {
  const refs = [f.item("GAP-002"), ...f.policy.hard_constraints, ...f.policy.validation_requirements];
  return Object.assign(f.decision(), { policy_clause: "category:layout", question: "Preserve the public async exportOrders signature?", chosen_option: "Keep the existing async exportOrders API", action: "choose-compatible-layout", source_refs: [...new Map(refs.map((r: any) => [JSON.stringify(r), r])).values()], affected_refs: [f.item("GAP-002")] });
}

export async function batchFixture(scratch: string, name: string, options: { future?: boolean; beforeC8?: boolean; writePaths?: string[]; plannedDecision?: boolean; incorrectNativeExpectation?: boolean; nativeUi?: boolean; observation?: Omit<Parameters<typeof observationFixture>[2], "mutate">; configure?: (plan: any, f: any, admission: any) => void; configureRequest?: (f: any) => void } = {}) {
  let correct = "";
  const base = "docs/aidlc/modules/orders",
    unit = base + "/construction/publish";
  const f = observationFixture(scratch, name, {
    ...options.observation,
    mutate: (_p: any, f: any, admission: any) => {
      if (options.plannedDecision || options.incorrectNativeExpectation) {
        // Match the real pilot's declared src/tests ownership BEFORE adoption.
        const path = 'docs/aidlc/ideation/module-manifest.json';
        const manifest = JSON.parse(readFileSync(join(f.root, path), 'utf8'));
        manifest.modules[0].paths = ['src', 'tests'];
        put(f.root, path, manifest);
      }
      const path = base + "/inception/requirements.md",
        old = f.input.digest;
      put(
        f.root,
        path,
        "# SCENARIO-001 Order export\n\n## REQ-001 Ordered order export\nFetch the complete ordered upstream list, preserve each row, paginate at 50, return [] for empty, propagate upstream timeouts.\n\n## AC-001 Pagination acceptance\n120 rows produce 50/50/20; 1/50/51 and empty boundaries preserve exact order and values.\n\n## GAP-001 Recoverable error presentation\n\n## GAP-002 Compatible internal layout is delegated\n",
      );
      if(options.incorrectNativeExpectation)admission.lifetime_seconds=600;
      if (options.future)
        put(
          f.root,
          path,
          readFileSync(join(f.root, path), "utf8") +
            "\n## REQ-002 Future unrelated delivery\nA separate future unit will validate a different order source.\n",
        );
      const next = observationHash(readFileSync(join(f.root, path)));
      const update = (v: any) => {
        if (!v || typeof v !== "object") return;
        if (v.path === path && v.digest === old) v.digest = next;
        for (const x of Object.values(v)) update(x);
      };
      [f.batch, f.policy, f.matrix, f.input, _p, admission].forEach(update);
      put(
        f.root,
        "delivery/candidate.txt",
        "Order export candidate; canonical identity comes from the Core signed BatchResult.\n",
      );
      const cases = base + "/inception/application-design/test-cases";
      put(
        f.root,
        cases + "/_index.md",
        "# UC-D index\n- UC-D-001 Ordered pagination | status: ready | source_ref: REQ-001\n",
      );
      put(
        f.root,
        cases + "/UC-D-001.md",
        "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-001\ntdd_mode: new\nunit_refs: [publish]\n---\n# UC-D-001 Ordered pagination\nGiven 120 ordered rows, When exportOrders runs, Then preserve all values and emit 50/50/20; empty returns [].\n",
      );
      for (const p of ["src/server.cjs", "src/orders.cjs", "src/observe.cjs"])
        put(f.root, p, "// REQ-001 UC-D-001\n" + readFileSync(join(f.root, p), "utf8"));
      put(f.root, "src/web.html", readFileSync(join(f.root, "src/web.html"), "utf8") + "<!-- REQ-001 UC-D-001 -->");
      if (options.future) {
        const path = base + "/inception/unit-manifest.json",
          m = JSON.parse(readFileSync(join(f.root, path), "utf8"));
        m.units.push({
          unit_id: "future",
          name: "Future delivery",
          service_id: "orders",
          conditional_stages: [],
          req_refs: ["REQ-002"],
        });
        put(f.root, path, m);
        put(
          f.root,
          cases + "/UC-D-002.md",
          "---\nid: UC-D-002\nstatus: ready\nsource_ref: REQ-002\ntdd_mode: new\nunit_refs: [future]\n---\n# UC-D-002 Future source\nGiven future data, When queried, Then return the separate source.\n",
        );
        put(
          f.root,
          cases + "/_index.md",
          readFileSync(join(f.root, cases + "/_index.md"), "utf8") +
            "- UC-D-002 Future source | status: ready | source_ref: REQ-002\n",
        );
      }
      let server = readFileSync(join(f.root, "src/server.cjs"), "utf8");
      server = server
        .replace("const server=http.createServer", "let injectFault=false;const server=http.createServer")
        .replace(
          "res.setHeader('content-type','application/json');",
          "res.setHeader('content-type','application/json');res.setHeader('connection','close');if(u.pathname==='/control'){injectFault=u.searchParams.get('fail')==='1';return res.end('{}');}",
        )
        .replace("length:120", "length:injectFault?119:120");
      put(f.root, "src/server.cjs", server);
      put(f.root, "fixtures/pretend.json", { status: "passed" });
      correct = readFileSync(join(f.root, "src/orders.cjs"), "utf8");
      if(options.incorrectNativeExpectation)correct=correct.replace("i+=50","i+=40").replace("i+50","i+40");
      put(
        f.root,
        "src/orders.cjs",
        "// REQ-001 UC-D-001 Initial implementation before real RED\nexports.exportOrders=async up=>[await up()];\n",
      );
      put(
        f.root,
        "tests/orders-native.cjs",
        `const assert=require('node:assert/strict');exports.pagination=async()=>{const {exportOrders}=require('../src/orders.cjs'),rows=Array.from({length:120},(_,i)=>i),pages=await exportOrders(async()=>rows);assert.deepEqual(pages.map(p=>p.length),[${options.incorrectNativeExpectation?"40,40,40":"50,50,20"}]);assert.deepEqual(pages.flat(),rows);assert.deepEqual(await exportOrders(async()=>[]),[]);};`,
      );
      put(
        f.root,
        "tests/orders-phase.cjs",
        `const assert=require('node:assert/strict');(async()=>{let failure;try{await require('./orders-native.cjs').pagination();}catch(e){if(!(e instanceof assert.AssertionError))throw e;failure=e;}console.log(JSON.stringify({phase:process.env.AIDLC_PHASE,status:failure?'failed':'passed',compile_status:'passed',environment_status:'passed',tests_total:1,tests_failed:failure?1:0,traceability_complete:true,...(failure?{failure_class:'behavior',failure_signature:failure.message}:{}),uc_mapping:[{use_case:'UC-D-001',test_methods:['tests/orders-native.cjs#pagination']}]}));process.exitCode=failure?1:0;})();`,
      );
      put(
        f.root,
        "tests/orders-suite.cjs",
        `require('./orders-native.cjs').pagination().then(()=>console.log('Tests: 1 passed, 1 total')).catch(e=>{console.error(e);process.exitCode=1;});`,
      );
      put(
        f.root,
        "tests/source-check.cjs",
        `const fs=require('node:fs');const s=fs.readFileSync('src/orders.cjs','utf8');if(!s.includes('exportOrders'))process.exit(1);console.log('source checked');`,
      );
      for (const stage of ["tdd", "code-generation"]) {
        put(f.root, ".aidlc/commands/" + stage + ".json", {
          version: "1",
          stage,
          commands: [
            {
              id: stage === "tdd" ? "red" : "green",
              role: stage === "tdd" ? "red" : "green",
              argv: ["node", "tests/orders-phase.cjs"],
            },
          ],
        });
        f.batch.baseline_inputs.push(ref(f.root, ".aidlc/commands/" + stage + ".json"));
      }
      put(f.root, ".aidlc/commands/build-and-test.json", {
        version: "1",
        stage: "build-and-test",
        commands: [
          { id: "build", role: "build", argv: ["node", "--check", "src/orders.cjs"] },
          { id: "tests", role: "test", argv: ["node", "tests/orders-suite.cjs"] },
          { id: "lint", role: "check", argv: ["node", "tests/source-check.cjs"] },
        ],
      });
      f.batch.baseline_inputs.push(ref(f.root, ".aidlc/commands/build-and-test.json"));
      put(
        f.root,
        unit + "/functional-design.md",
        "# REQ-001 / UC-D-001 Design\nPreserve order and values, pages of 50, no page for empty input. Propagate upstream errors.\n",
      );
      put(
        f.root,
        unit + "/plans/code-generation-plan.md",
        "# REQ-001 / UC-D-001 Plan\nImplement src/orders.cjs and run tests/orders-native.cjs#pagination with real RED then GREEN.\n",
      );
      put(
        f.root,
        unit + "/implementation-summary.md",
        "# REQ-001 / UC-D-001 Implementation\nThe controlled observations determine pagination behavior; no status here overrides evidence.\n",
      );
      put(
        f.root,
        unit + "/code-review.md",
        'Spec Axis: passed\nStandards Axis: passed\nreviewer: fixture-engineering-reviewer\nissues_found: 0\nissues_resolved: 0\nissues_open: 0\nfiles_reviewed: ["src/server.cjs","src/orders.cjs","src/observe.cjs","src/web.html","tests/orders-native.cjs","tests/orders-phase.cjs","tests/orders-suite.cjs","tests/source-check.cjs"]\nREQ-001 UC-D-001 fixture review protocol.\n',
      );
      if(options.nativeUi)prepareNativeUi(f,_p);
      options.configure?.(_p, f, admission);
    },
  });
  options.configureRequest?.(f);
  if(options.incorrectNativeExpectation){const observe=f.adapter.observe;f.adapter.observe=challenge=>({...observe(challenge),valid_until:new Date(Date.now()+600000).toISOString()});} // Explicit seeded capability window; the original grant remains 600s.
  const git = (args: string[]) => {
    const r = spawnSync("git", args, { cwd: f.root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const seed = (instance: string) => {
    const s = f.current();
    if (!s.completed_stage_instances.includes(instance)) s.completed_stage_instances.push(instance);
    if (!s.completed_stages.includes(instance.split("@")[0])) s.completed_stages.push(instance.split("@")[0]);
    writeFileSync(join(f.root, "aidlc/active/aidlc-state.md"), renderLightWorkflowState(s));
  };
  const bindings = new Map<string, string>();
  const bind = (instance: string) => {
    const prior = bindings.get(instance);
    if (prior) process.env.AIDLC_SESSION_BINDING = prior;
    const b = bindSession(f.root, {
      instance,
      owner: "agent",
      session: "test-session",
      expected: claimToken(f.current().active_instances[instance]),
    }).binding;
    const serialized = JSON.stringify(b);
    bindings.set(instance, serialized);
    process.env.AIDLC_SESSION_BINDING = serialized;
    return b;
  };
  const produce = (stage: string, sensor: string, unitId?: string) => {
    console.log("NATIVE_PRODUCER " + stage + "/" + sensor);
    const instance = stage + (stage === "build-and-test" ? "" : "@module:orders" + (unitId ? "@unit:" + unitId : ""));
    const context = f.current(),
      refresh = context.completed_stage_instances.includes(instance);
    context.current_stage = refresh ? "implementation-report" : stage;
    context.current_stage_instance = refresh ? "implementation-report" : instance;
    context.current_phase = stage.startsWith('ui-') ? 'inception' : "construction";
    context.current_module = refresh || stage === "build-and-test" ? undefined : "orders";
    context.current_unit = refresh ? undefined : unitId;
    writeFileSync(join(f.root, "aidlc/active/aidlc-state.md"), renderLightWorkflowState(context));
    bind(instance);
    const r = spawnSync(
      process.execPath,
      [
        join(repository, "node_modules/tsx/dist/cli.mjs"),
        join(repository, "bin/cli.ts"),
        "evidence",
        "run",
        "--stage",
        stage,
        "--instance",
        instance,
        ...(sensor === 'all' ? ['--all-sensors'] : ["--sensor", sensor]),
        ...(refresh ? ["--refresh"] : []),
      ],
      { cwd: f.root, encoding: "utf8", env: process.env, timeout: 120000 },
    );
    assert.equal(r.status, 0, stage + "/" + sensor + "\n" + r.stdout + r.stderr);
    if(sensor === 'all')return JSON.parse(r.stdout);
    return JSON.parse(
      readFileSync(
        join(
          f.root,
          `.aidlc/evidence/${stage}/${stage === "build-and-test" ? "" : "orders/" + (unitId ? unitId + "/" : "")}${sensor}.json`,
        ),
        "utf8",
      ),
    );
  };
  const s = f.current();
  s.baseline_commit = git(["rev-parse", "HEAD"]);
  s.baseline_source = "created";
  seed("units-generation@module:orders");
  writeFileSync(
    join(f.root, "aidlc/active/aidlc-state.md"),
    renderLightWorkflowState({ ...f.current(), baseline_commit: s.baseline_commit, baseline_source: "created" }),
  );
  let child = await f.start();
  let plannedDecision: any;
  try {
    if (options.plannedDecision) {
      plannedDecision = plannedLayoutDecision(f);
      assert.ok(f.record(plannedDecision).completion_blockers.length);
    }
    if (options.writePaths) f.request.write_paths = [...options.writePaths];
    await f.issue();
    {
      const reception = f.run();
      assert.equal(
        reception.admission_result,
        options.plannedDecision ? "ready-with-delegated-decisions" : "ready",
        JSON.stringify(reception.checks.filter((c: any) => c.status !== "passed")),
      );
    }
    const coordinator = process.env.AIDLC_SESSION_BINDING!;
    if(options.nativeUi)for(const stage of ['ui-page-planning','ui-mock-generation']) {
      produce(stage,'all');
      seed(stage+'@module:orders');
    }
    produce("test-case-derivation", "test-case-derivation");
    seed("test-case-derivation@module:orders");
    assert.equal(produce("tdd", "red-test-evidence", "publish").observed_command.exit_code, 1);
    produce("tdd", "baseline-test-evidence", "publish");
    seed("tdd@module:orders@unit:publish");
    put(f.root, "src/orders.cjs", correct);
    f.commit();
    child.kill();
    await new Promise<void>((r) => child.once("close", () => r()));
    child = await f.start();
    process.env.AIDLC_SESSION_BINDING = coordinator;
    assert.equal(f.run().admission_result, options.plannedDecision ? "ready-with-delegated-decisions" : "ready");
    produce("code-generation", "green-test-evidence", "publish");
    produce("code-generation", "test-quality", "publish");
    produce("code-generation", "traceability-matrix", "publish");
    produce("code-generation", "structural-invariants", "publish");
    seed("code-generation@module:orders@unit:publish");
    produce("code-review", "review-evidence", "publish");
    produce("code-review", "test-quality", "publish");
    produce("code-review", "traceability-matrix", "publish");
    if(options.nativeUi)produce('code-review','ui-design-alignment','publish');
    seed("code-review@module:orders@unit:publish");
    if (options.beforeC8) {
      // Engineering-only upstream workflow arrangement. The actual producers
      // above remain responsible for I13/RED/GREEN/C7; this callback tests the
      // host's public C8 route, not Inception or human design choices.
      const graph = JSON.parse(readFileSync(join(repository, 'core/tools/data/stage-graph.json'), 'utf8'));
      for (const node of graph.stages.filter((node: any) => ['ideation', 'inception'].includes(node.phase)))
        seed(node.slug + (node.axis === 'module' ? '@module:orders' : ''));
      // Real completed reports release their claims. The seeded fixture must do
      // likewise, using only its original in-memory bindings, before host select.
      for (const [instance, held] of bindings) {
        if (instance === 'code-review@module:orders@unit:publish' && !options.incorrectNativeExpectation) continue;
        const binding = JSON.parse(held), claim = f.current().active_instances[instance];
        assert.equal(claim?.generation, binding.generation);
        process.env.AIDLC_SESSION_BINDING = held;
        releaseSession(f.root, instance, claimToken(claim));
      }
      const completed = f.current();
      delete completed.current_stage;
      delete completed.current_stage_instance;
      delete completed.current_module;
      delete completed.current_unit;
      writeFileSync(join(f.root, 'aidlc/active/aidlc-state.md'), renderLightWorkflowState(completed));
    }
    if (!options.beforeC8) {
      produce("build-and-test", "build-test-evidence");
      produce("build-and-test", "test-quality");
      seed("build-and-test");
    }
    process.env.AIDLC_SESSION_BINDING = coordinator;
    const observations = options.beforeC8 ? undefined : await runObservations(f.root, "fixtures/observation-plan.json");
    if (observations) assert.equal(observations.status, "passed");
    const result = {
      ...f,
      child,
      bind,
      produce,
      seed,
      coordinator,
      observations,
      plannedDecision,
      restart: async () => {
        child.kill();
        await new Promise<void>((r) => child.once("close", () => r()));
        child = await f.start();
        result.child = child;
      },
    };
    return result;
  } catch (error) {
    if (child.exitCode === null) {
      child.kill();
      await new Promise<void>((r) => child.once("close", () => r()));
    }
    throw error;
  }
}
