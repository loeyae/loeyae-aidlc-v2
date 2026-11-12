import assert from "node:assert/strict";
import { driveBatch, coreResponse } from "../harness/codex/runtime/aidlc-codex-host.mjs";
import { sensorRepairDiagnostics } from "../core/tools/aidlc-repair-guidance";
let count = 0;
const inherited = process.env.AIDLC_SESSION_BINDING;
const inheritedCoordinator = process.env.AIDLC_COORDINATOR_BINDING;
async function test(name: string, fn: () => unknown) {
  await fn();
  count++;
  console.log("PASS " + name);
}
function fixture(options: any = {}) {
  const phases = ["tdd@module:orders@unit:publish", "code-generation@module:orders@unit:publish"];
  let index = 0,
    turns = 0,
    selected: string[] = [];
  const binding = { stage_instance: phases[0], session_id: "native-thread", owner: "agent", generation: "initial" };
  const context = {
    binding,
    grant: {
      resource_limits: { max_equivalent_retries: 1 },
      executor_constraints: { initial_binding: { stage_instance: "workspace-detection" } },
    },
  };
  const gateway = { budget: { deadline: Date.now() + 3600000, check() {} }, abort: new AbortController() };
  const core = async (args: string[]) => {
      if(args[2] === "admission" && args[3] === "inspect") return {autonomous_admission:{admission_result:"ready",valid_until:new Date(Date.now()+900000).toISOString()}};
    if (args[1] === "next")
      return options.error
        ? { kind: "error" }
        : index >= phases.length
          ? { kind: "print", execution_status: "scope-exhausted" }
          : {
              kind: "run-stage",
              stage_instance: phases[index],
              autonomous_admission: { admission_result: options.notReady ? "not-ready" : "ready" },
            };
    if (args.includes("select")) {
      const stage_instance = args.at(-1)!;
      selected.push(stage_instance);
      return { host_context: { binding: { ...binding, stage_instance, generation: String(selected.length) } } };
    }
    if (args.includes("admission")) return { autonomous_admission: { admission_result: "not-ready" } };
    if (args.includes("context"))
      return {
        host_context: {
          binding: context.binding,
          progress_digest: options.stuck ? "unchanged" : String(turns),
          implementation_units: [],
        },
      };
    throw Error("unexpected " + args.join(" "));
  };
  const client = {
    async turn(text: string) {
      turns++;
      assert.equal(text.includes('"generation":'), false);
      if (!options.stuck) index++;
      return { status: options.interrupted ? "interrupted" : "completed" };
    },
  };
  return {
    context,
    gateway,
    core,
    client,
    get turns() {
      return turns;
    },
    selected,
  };
}
try {
  await test("formal routes continue through stages without human continue prompts", async () => {
    const f = fixture();
    assert.equal(await driveBatch({}, f.context, f.core, f.client, f.gateway), "scope-exhausted");
    assert.equal(f.turns, 2);
    assert.deepEqual(f.selected, ["code-generation@module:orders@unit:publish"]);
  });
  await test("unchanged input route stops within the equivalent retry budget", async () => {
    const f = fixture({ stuck: true });
    assert.equal(await driveBatch({}, f.context, f.core, f.client, f.gateway), "no-progress");
    assert.equal(f.turns, 2);
  });
  await test("new source progress can continue without resetting the wall deadline", async () => {
    const f = fixture();
    let checks = 0;
    f.gateway.budget.check = () => {
      checks++;
    };
    await driveBatch({}, f.context, f.core, f.client, f.gateway);
    assert.ok(checks >= 3);
    assert.equal(f.turns, 2);
  });
  await test("formal errors never start a model turn or fabricate completion", async () => {
    const f = fixture({ error: true });
    assert.equal(await driveBatch({}, f.context, f.core, f.client, f.gateway), "formal-route-blocked");
    assert.equal(f.turns, 0);
  });
  await test("missing reception plan stops before implementation", async () => {
    const f = fixture({ notReady: true });
    assert.equal(await driveBatch({}, f.context, f.core, f.client, f.gateway), "admission-plan-required");
    assert.equal(f.turns, 0);
  });
  await test("not-ready refresh returns to coordinator and never extends the grant", async () => {
    const f = fixture({ notReady: true });
    const original = JSON.stringify(f.context.grant);
    assert.equal(
      await driveBatch({ admission_plan: "frozen.json" }, f.context, f.core, f.client, f.gateway),
      "admission-not-ready",
    );
    assert.deepEqual(f.selected, ["workspace-detection"]);
    assert.equal(JSON.stringify(f.context.grant), original);
    assert.equal(f.turns, 0);
  });
  await test("not-ready coordinator requests external dependency preflight before admission refresh", async () => {
    const f = fixture({ notReady: true });
    let observed = false;
    const core = async (args: string[]) => {
      if(args[2] === "admission" && args[3] === "inspect") return {autonomous_admission:{admission_result:"ready",valid_until:new Date(Date.now()+900000).toISOString()}};
      if (args.includes("observe")) {
        assert.ok(args.includes("--dependency-preflight"));
        observed = true;
        return { autonomous_observations: { status: "partial" } };
      }
      if (args.includes("admission")) assert.equal(observed, true);
      return f.core(args);
    };
    assert.equal(
      await driveBatch(
        { admission_plan: "frozen.json", observation_plan: "observations.json" },
        f.context,
        core,
        f.client,
        f.gateway,
      ),
      "admission-not-ready",
    );
    assert.equal(f.turns, 0);
  });
  await test("a transient native probe timeout is retried with a real new admission attempt inside the original budget", async () => {
    const f=fixture();let attempts=0,ready=false;const grant=JSON.stringify(f.context.grant);
    const core=async(args:string[])=>{
      if(args[1]==='next'&&!ready)return {kind:'error',autonomous_admission:{admission_result:'not-ready'}};
      if(args.includes('admission')){attempts++;if(attempts===1)return {autonomous_admission:{admission_result:'not-ready',checks:[{check_id:'host-capabilities',status:'failed',reason:'HOST_NATIVE_PROBE_FAILED: Error: HOST_TURN_TIMEOUT'}]}};ready=true;return {autonomous_admission:{admission_result:'ready'}};}
      return f.core(args);
    };
    assert.equal(await driveBatch({admission_plan:'frozen.json'},f.context,core,f.client,f.gateway),'scope-exhausted');assert.equal(attempts,2);assert.equal(f.turns,2);assert.equal(JSON.stringify(f.context.grant),grant);
  });
  for(const timeout of [true,false])await test("admission retries stop for "+(timeout?'repeated timeout':'unsupported host'),async()=>{
    const f=fixture({notReady:true});let attempts=0;
    const core=async(args:string[])=>{if(args.includes('admission')){attempts++;return {autonomous_admission:{admission_result:'not-ready',checks:[{check_id:'host-capabilities',status:'failed',reason:timeout?'HOST_NATIVE_PROBE_FAILED: HOST_TURN_TIMEOUT':'HOST_NATIVE_PROBE_FAILED: unsupported host'}]}};}return f.core(args);};
    assert.equal(await driveBatch({admission_plan:'frozen.json'},f.context,core,f.client,f.gateway),'admission-not-ready');assert.equal(attempts,timeout?2:1);assert.equal(f.turns,0);
  });
  await test("interrupted native turns are not automatically resumed", async () => {
    const f = fixture({ interrupted: true });
    assert.equal(await driveBatch({}, f.context, f.core, f.client, f.gateway), "native-turn-interrupted");
    assert.equal(f.turns, 1);
  });
  await test("model final is insufficient to complete a batch", async () => {
    const f = fixture({ stuck: true });
    const reason = await driveBatch({}, f.context, f.core, f.client, f.gateway);
    assert.equal(reason, "no-progress");
    assert.notEqual(reason, "verified");
  });
  for (const passed of [true, false])
    await test("coordinator executes frozen observations and preserves " +
      (passed ? "incomplete" : "failed") +
      " batch outcome", async () => {
      const f = fixture();
      f.context.binding.stage_instance = "code-review@module:orders@unit:publish";
      let observed = false;
      const calls: string[][] = [];
      const core = async (args: string[]) => {
      if(args[2] === "admission" && args[3] === "inspect") return {autonomous_admission:{admission_result:"ready",valid_until:new Date(Date.now()+900000).toISOString()}};
        calls.push(args);
        if (args.includes("select"))
          return { host_context: { binding: { ...f.context.binding, stage_instance: args.at(-1) } } };
        if (args.includes("context"))
          return { host_context: { binding: f.context.binding, implementation_units: [{ review_completed: true }] } };
        if (args.includes("batch")) return { autonomous_batch_result: { engineering_result: "failed" } };
        if (args.includes("decisions")) return { autonomy_decisions: { decisions: [], completion_blockers: [] } };
        if (args.includes("observe")) {
          if (args.includes("run")) {
            observed = true;
            assert.equal(f.context.binding.stage_instance, "workspace-detection");
            assert.equal(args.at(-1), "frozen-observation.json");
          }
          return { autonomous_observations: { status: observed && passed ? "passed" : "unverified" } };
        }
        return { kind: "print", execution_status: "scope-exhausted" };
      };
      assert.equal(
        await driveBatch({ observation_plan: "frozen-observation.json" }, f.context, core, f.client, f.gateway),
        passed ? "scope-exhausted" : "batch-failed",
      );
      assert.equal(observed, true);
      assert.equal(f.turns, 0);
      assert.ok(calls.some((a) => a.includes("inspect")));
    });
  await test("exhausted unit switches to another unfinished implement unit", async () => {
    const f = fixture();
    f.context.binding.stage_instance = "code-review@module:orders@unit:a";
    let done = false;
    const selected: string[] = [];
    const core = async (args: string[]) => {
      if(args[2] === "admission" && args[3] === "inspect") return {autonomous_admission:{admission_result:"ready",valid_until:new Date(Date.now()+900000).toISOString()}};
      if (args.includes("select")) {
        selected.push(args.at(-1)!);
        return { host_context: { binding: { ...f.context.binding, stage_instance: args.at(-1) } } };
      }
      if (args.includes("context"))
        return {
          host_context: {
            binding: f.context.binding,
            progress_digest: String(done),
            implementation_units: done
              ? []
              : [{ unit_ref: { module_id: "orders", unit_id: "b" }, review_completed: false }],
          },
        };
      if (f.context.binding.stage_instance.endsWith("@unit:a") || done)
        return { kind: "print", execution_status: "scope-exhausted" };
      return { kind: "run-stage", stage_instance: f.context.binding.stage_instance };
    };
    const client = {
      async turn() {
        done = true;
        return { status: "completed" };
      },
    };
    assert.equal(await driveBatch({}, f.context, core, client, f.gateway), "scope-exhausted");
    assert.deepEqual(selected, ["code-generation@module:orders@unit:b"]);
  });
  await test("dependency providers with the same unit ID in another module are still selected", async () => {
    const f = fixture();
    f.context.binding.stage_instance = "code-generation@module:front@unit:api";
    let done = false;
    const selected: string[] = [];
    const core = async (args: string[]) => {
      if(args[2] === "admission" && args[3] === "inspect") return {autonomous_admission:{admission_result:"ready",valid_until:new Date(Date.now()+900000).toISOString()}};
      if (args.includes("select")) {
        selected.push(args.at(-1)!);
        return { host_context: { binding: { ...f.context.binding, stage_instance: args.at(-1) } } };
      }
      if (args.includes("context"))
        return {
          host_context: { binding: f.context.binding, progress_digest: String(done), implementation_units: [] },
        };
      if (done) return { kind: "print", execution_status: "scope-exhausted" };
      return {
        kind: "run-stage",
        stage: "code-generation",
        stage_instance: f.context.binding.stage_instance,
        autonomy_dependencies: {
          dependency_frontier: [
            {
              checkpoint: "code-generation",
              unit_ref: { module_id: "front", unit_id: "api" },
              dependencies_ready: false,
            },
            {
              checkpoint: "shared-contract-baseline",
              unit_ref: { module_id: "back", unit_id: "api" },
              dependencies_ready: true,
            },
          ],
        },
      };
    };
    const client = {
      async turn() {
        done = true;
        return { status: "completed" };
      },
    };
    await driveBatch({}, f.context, core, client, f.gateway);
    assert.equal(selected[0], "shared-contract-baseline@module:back@unit:api");
  });
  for (const result of ["verified", "failed", "blocked", "incomplete"])
    await test("Core " + result + " verdict controls the single batch endpoint", async () => {
      const f = fixture();
      let finalized = 0;
      const core = async (args: string[]) => {
      if(args[2] === "admission" && args[3] === "inspect") return {autonomous_admission:{admission_result:"ready",valid_until:new Date(Date.now()+900000).toISOString()}};
        if (args.includes("context"))
          return {
            host_context: {
              binding: f.context.binding,
              c8_completed: true,
              implementation_units: [{ review_completed: true }],
            },
          };
        if (args.includes("select"))
          return { host_context: { binding: { ...f.context.binding, stage_instance: args.at(-1) } } };
        if (args.includes("observe")) return { autonomous_observations: { status: "passed" } };
        if (args.includes("batch")) {
          finalized++;
          return { autonomous_batch_result: { engineering_result: result } };
        }
        return { kind: "print", execution_status: "scope-exhausted" };
      };
      assert.equal(
        await driveBatch({ observation_plan: "frozen.json" }, f.context, core, f.client, f.gateway),
        "batch-" + result,
      );
      assert.equal(finalized, 1);
      assert.equal(f.turns, 0);
    });
  await test("unreconciled operations cannot start final convergence", async () => {
    const f = fixture();
    const gateway = { ...f.gateway, pending: new Set([1]), unknown: [] };
    const core = async (args: string[]) => {
      if(args[2] === "admission" && args[3] === "inspect") return {autonomous_admission:{admission_result:"ready",valid_until:new Date(Date.now()+900000).toISOString()}};
      if (args.includes("context"))
        return {
          host_context: {
            binding: f.context.binding,
            c8_completed: true,
            implementation_units: [{ review_completed: true }],
          },
        };
      if (args.includes("batch")) throw Error("must not finalize");
      return { kind: "print", execution_status: "scope-exhausted" };
    };
    assert.equal(
      await driveBatch({ observation_plan: "frozen.json" }, f.context, core, f.client, gateway),
      "operations-unreconciled",
    );
  });
  for (const actualPublicPreview of [false, true]) await test("last unit enters formal C8 after candidate preparation: " + (actualPublicPreview ? "actual public empty preview" : "scope-exhausted"), async () => {
    const f = fixture();
    f.context.binding.stage_instance = "code-review@module:orders@unit:publish";
    let c8 = false,
      formal = 0;
    const selected: string[] = [];
    let candidates = 0;
    const gateway: any = { ...f.gateway, invoke: async (action: any) => {
      assert.deepEqual(action, { action: 'command', id: 'candidate' });
      assert.equal(f.context.binding.stage_instance, 'workspace-detection');
      candidates++;
      return { status: 'succeeded' };
    } };
    const core = async (args: string[]) => {
      if(args[2] === "admission" && args[3] === "inspect") return {autonomous_admission:{admission_result:"ready",valid_until:new Date(Date.now()+900000).toISOString()}};
      if (args.includes("select")) {
        selected.push(args.at(-1)!);
        return { host_context: { binding: { ...f.context.binding, stage_instance: args.at(-1) } } };
      }
      if (args.includes("context"))
        return {
          host_context: {
            binding: f.context.binding,
            c8_completed: c8,
            source_digest: 'unchanged',
            progress_digest: String(c8),
            implementation_units: [{ review_completed: true }],
          },
        };
      if (args.includes("observe")) return { autonomous_observations: { status: "passed" } };
      if (args.includes("decisions")) return { autonomy_decisions: { decisions: [], completion_blockers: [] } };
      if (args.includes("batch")) {
        assert.equal(c8, true);
        return { autonomous_batch_result: { engineering_result: "verified" } };
      }
      if (c8 || f.context.binding.stage_instance !== "build-and-test")
        return actualPublicPreview
          ? { kind: 'print', preview: true, stage_instance: null, next_stage: null, next_stage_status: 'none' }
          : { kind: "print", execution_status: "scope-exhausted" };
      if (!args.includes("--preview")) formal++;
      return { kind: "run-stage", stage: "build-and-test", stage_instance: "build-and-test" };
    };
    const client = {
      async turn() {
        assert.equal(gateway.readyInstance, "build-and-test");
        c8 = true;
        return { status: "completed" };
      },
    };
    assert.equal(
      await driveBatch({ observation_plan: "frozen.json", candidate_command: 'candidate' }, f.context, core, client, gateway),
      "batch-verified",
    );
    assert.ok(selected.includes("build-and-test"));
    assert.equal(formal, 1);
    assert.equal(candidates, 1);
  });
  await test("Core groups completed C7 repairs before the host re-enters C8", async () => {
    const instance="code-review@module:orders@unit:publish",sensors=["review-evidence","test-quality","ui-design-alignment","traceability-matrix"];
    const counts:any[]=[];
    for(const grouped of [false,true]){
      const f=fixture();f.context.binding.stage_instance=instance;
      const pending=new Set(sensors),calls:string[][]=[];let producers=0;
      const gateway:any={...f.gateway,invoke:async(a:any)=>{
        assert.equal(gateway.readyInstance,null);producers++;
        const flag=a.args.includes('--sensors')?'--sensors':'--sensor';
        for(const sensor of a.args[a.args.indexOf(flag)+1].split(','))pending.delete(sensor);
        return {status:'passed'};
      }};
      const core=async(args:string[])=>{
        calls.push(args);
        if(args.includes('select'))return {host_context:{binding:{...f.context.binding,stage_instance:args.at(-1)}}};
        const failures=[...pending].map(sensor=>({sensor,stage_instance:instance,message:'source_revision.scope_digest changed'}));
        const diagnostics=grouped?sensorRepairDiagnostics(failures,{completed_stage_instances:[instance]}):failures.flatMap(failure=>sensorRepairDiagnostics([failure],{completed_stage_instances:[instance]}));
        return pending.size?{kind:'error',stage_instance:'build-and-test',repair_diagnostics:diagnostics}:{kind:'done'};
      };
      await driveBatch({},f.context,core,{turn:async()=>{throw Error('repair must not request a model turn');}},gateway);
      counts.push({grouped,producers,control_calls:calls.length});
      assert.equal(pending.size,0);assert.equal(producers,grouped?1:4);
    }
    assert(counts[1].control_calls<counts[0].control_calls);
    console.log(JSON.stringify({same_tail_driver_comparison:counts,real_trial:false}));
  });
  await test("Native evidence repair is bounded and never enables source writes", async () => {
    const f = fixture();
    let turns = 0, repairs = 0;
    const gateway:any={...f.gateway,invoke:async(a:any)=>{assert.equal(gateway.readyInstance,null);assert.deepEqual(a,{action:'core',args:['evidence','run','--stage','code-generation']});repairs++;return {status:'passed'};}};
    const diagnostic = {
      stage_instance: "code-generation@module:orders@unit:publish",
      sensor: "green-test-evidence",
      action: "refresh-evidence",
      requires_human_approval: false,
      code: "ARTIFACT_STALE",
      message: "same source proof",
      command: ["loeyae-aidlc", "evidence", "run", "--stage", "code-generation"],
    };
    const core = async (args: string[]) =>
      args.includes("select")
        ? { host_context: { binding: { ...f.context.binding, stage_instance: args.at(-1) } } }
        : { kind: "error", repair_diagnostics: [diagnostic] };
    const client = {
      async turn() {
        turns++;
        assert.equal(gateway.readyInstance, null);
        return { status: "completed" };
      },
    };
    assert.equal(await driveBatch({}, f.context, core, client, gateway), "native-repair-exhausted");
    assert.equal(turns, 0);assert.equal(repairs,2);
  });
  await test("frozen candidate preparation uses the original coordinator and precedes C8", async () => {
    const f = fixture();
    f.context.binding.stage_instance = "code-review@module:orders@unit:publish";
    let prepared = false,
      c8 = false,
      commands = 0;
    const core = async (args: string[]) => {
      if(args[2] === "admission" && args[3] === "inspect") return {autonomous_admission:{admission_result:"ready",valid_until:new Date(Date.now()+900000).toISOString()}};
      if (args.includes("context"))
        return {
          host_context: {
            binding: f.context.binding,
            c8_completed: c8,
            source_digest: prepared ? "committed" : "dirty",
            implementation_units: [{ review_completed: true }],
          },
        };
      if (args.includes("select"))
        return { host_context: { binding: { ...f.context.binding, stage_instance: args.at(-1) } } };
      if (args.includes("observe")) {
        assert.equal(prepared, true);
        return { autonomous_observations: { status: "passed" } };
      }
      if (args.includes("decisions")) return { autonomy_decisions: { decisions: [], completion_blockers: [] } };
      if (args.includes("batch")) return { autonomous_batch_result: { engineering_result: "verified" } };
      return c8 || f.context.binding.stage_instance.startsWith("code-review")
        ? { kind: "print", execution_status: "scope-exhausted" }
        : { kind: "run-stage", stage: "build-and-test", stage_instance: "build-and-test" };
    };
    const gateway = {
      ...f.gateway,
      async invoke(action: any) {
        assert.deepEqual(action, { action: "command", id: "candidate" });
        assert.equal(f.context.binding.stage_instance, "workspace-detection");
        commands++;
        prepared = true;
        return { status: "succeeded" };
      },
    };
    const client = {
      async turn() {
        assert.equal(prepared, true);
        assert.equal(gateway.readyInstance, "build-and-test");
        c8 = true;
        return { status: "completed" };
      },
    };
    assert.equal(
      await driveBatch(
        { observation_plan: "frozen.json", candidate_command: "candidate" },
        f.context,
        core,
        client,
        gateway,
      ),
      "batch-verified",
    );
    assert.equal(commands, 1);
  });
  await test("human-approval diagnostics do not enter automatic evidence repair", async () => {
    const f = fixture();
    const core = async () => ({
      kind: "error",
      repair_diagnostics: [
        {
          stage_instance: "code-review",
          sensor: "review-evidence",
          action: "refresh-evidence",
          requires_human_approval: true,
          command: ["loeyae-aidlc", "evidence", "run"],
        },
      ],
    });
    assert.equal(await driveBatch({}, f.context, core, f.client, f.gateway), "formal-route-blocked");
    assert.equal(f.turns, 0);
  });
  await test("module selection follows frozen implement order within real route candidates", async () => {
    const f = fixture();
    let selected = false,
      done = false;
    const core = async (args: string[]) => {
      if(args[2] === "admission" && args[3] === "inspect") return {autonomous_admission:{admission_result:"ready",valid_until:new Date(Date.now()+900000).toISOString()}};
      if (args.includes("context"))
        return {
          host_context: {
            binding: f.context.binding,
            progress_digest: String(done),
            implementation_units: [{ unit_ref: { module_id: "orders", unit_id: "publish" }, review_completed: done }],
          },
        };
      if (args.includes("select")) {
        assert.equal(args.at(-1), "code-generation@module:orders@unit:publish");
        selected = true;
        return { host_context: { binding: { ...f.context.binding, stage_instance: args.at(-1) } } };
      }
      if (done) return { kind: "print", execution_status: "scope-exhausted" };
      return selected
        ? { kind: "run-stage", stage_instance: f.context.binding.stage_instance }
        : {
            kind: "ask",
            ask_type: "module-selection",
            modules: [
              { module_id: "future", stage_instance: "code-generation@module:future@unit:a" },
              { module_id: "orders", stage_instance: "code-generation@module:orders@unit:publish" },
            ],
          };
    };
    const client = {
      async turn() {
        assert.equal(selected, true);
        done = true;
        return { status: "completed" };
      },
    };
    assert.equal(await driveBatch({}, f.context, core, client, f.gateway), "scope-exhausted");
  });
  for (const stage_instance of [
    "code-generation@module:future@unit:a",
    "code-generation@module:orders-extra@unit:publish",
    "code-generation@module:orders@unit:future",
  ])
    await test("module selection rejects out-of-scope route " + stage_instance, async () => {
      const f = fixture();
      const core = async (args: string[]) =>
        args.includes("context")
          ? {
              host_context: {
                implementation_units: [
                  { unit_ref: { module_id: "orders", unit_id: "publish" }, review_completed: false },
                ],
              },
            }
          : { kind: "ask", ask_type: "module-selection", modules: [{ module_id: "orders", stage_instance }] };
      assert.equal(await driveBatch({}, f.context, core, f.client, f.gateway), "batch-module-selection-unavailable");
      assert.equal(f.turns, 0);
    });
  await test("a real block stage stops without a model approval or source permission", async () => {
    const f = fixture();
    const core = async (args: string[]) =>
      args.includes("context")
        ? { host_context: { binding: f.context.binding } }
        : { kind: "run-stage", stage_instance: f.context.binding.stage_instance, approval: "block" };
    assert.equal(await driveBatch({}, f.context, core, f.client, f.gateway), "approval-required");
    assert.equal(f.gateway.readyInstance, null);
    assert.equal(f.turns, 0);
  });
  await test("unresolved human choices stop and are not reinterpreted as notify", async () => {
    const f = fixture();
    assert.equal(
      await driveBatch(
        {},
        f.context,
        async () => ({ kind: "ask", ask_type: "choice", options: ["a", "b"] }),
        f.client,
        f.gateway,
      ),
      "human-decision-required",
    );
    assert.equal(f.turns, 0);
  });
  await test("transported exit-2 diagnostics reach bounded evidence repair", async () => {
    const f = fixture();
    let turns = 0, repairs = 0;
    const gateway:any={...f.gateway,invoke:async(a:any)=>{assert.equal(gateway.readyInstance,null);assert.deepEqual(a,{action:'core',args:['evidence','run']});repairs++;return {status:'passed'};}};
    const diagnostic = {
      stage_instance: f.context.binding.stage_instance,
      sensor: "green-test-evidence",
      action: "refresh-evidence",
      requires_human_approval: false,
      code: "ARTIFACT_STALE",
      command: ["loeyae-aidlc", "evidence", "run"],
    };
    const core = async (args: string[]) =>
      args.includes("select")
        ? { host_context: { binding: f.context.binding } }
        : coreResponse(
            {
              status: "failed",
              exit_code: 2,
              reconciled: true,
              stdout: JSON.stringify({
                kind: "error",
                repair_diagnostics: [{ ...diagnostic, message: String(repairs) }],
              }),
            },
            args,
          );
    const client = {
      async turn() {
        turns++;
        assert.equal(gateway.readyInstance, null);
        return { status: "completed" };
      },
    };
    assert.equal(await driveBatch({}, f.context, core, client, gateway), "native-repair-exhausted");
    assert.equal(turns, 0);assert.equal(repairs,2);
  });
  await test("notify stages with genuine user choices retain their choice boundary", async () => {
    const f = fixture();
    const core = async () => ({
      kind: "run-stage",
      stage_instance: f.context.binding.stage_instance,
      approval: "notify",
      choices: ["single-module", "multi-module"],
    });
    assert.equal(await driveBatch({}, f.context, core, f.client, f.gateway), "human-decision-required");
    assert.equal(f.turns, 0);
    assert.equal(f.gateway.readyInstance, null);
  });
  await test("a single ready split module is located and bound without a user prompt", async () => {
    const f = fixture();
    let selected = false,
      done = false,
      located = false;
    const core = async (args: string[]) => {
      if(args[2] === "admission" && args[3] === "inspect") return {autonomous_admission:{admission_result:"ready",valid_until:new Date(Date.now()+900000).toISOString()}};
      if (args.includes("context"))
        return {
          host_context: {
            binding: f.context.binding,
            progress_digest: String(done),
            implementation_units: [{ unit_ref: { module_id: "orders", unit_id: "publish" }, review_completed: done }],
          },
        };
      if (args.includes("select")) {
        assert.equal(args.at(-1), "code-generation@module:orders@unit:publish");
        selected = true;
        return { host_context: { binding: { ...f.context.binding, stage_instance: args.at(-1) } } };
      }
      if (done) return { kind: "print", execution_status: "scope-exhausted" };
      if (selected) return { kind: "run-stage", stage_instance: f.context.binding.stage_instance };
      if (args.includes("--module")) {
        located = true;
        assert.equal(args[args.indexOf("--module") + 1], "orders");
        return { kind: "print", stage_instance: "code-generation@module:orders@unit:publish" };
      }
      return { kind: "print", binding_required: true, workflow: "module:orders" };
    };
    const client = {
      async turn() {
        assert.equal(located, true);
        assert.equal(selected, true);
        done = true;
        return { status: "completed" };
      },
    };
    assert.equal(await driveBatch({}, f.context, core, client, f.gateway), "scope-exhausted");
  });
  await test("a binding-required route cannot select a module outside the batch", async () => {
    const f = fixture();
    const core = async (args: string[]) =>
      args.includes("context")
        ? {
            host_context: {
              implementation_units: [
                { unit_ref: { module_id: "orders", unit_id: "publish" }, review_completed: false },
              ],
            },
          }
        : { kind: "print", binding_required: true, workflow: "module:future" };
    assert.equal(await driveBatch({}, f.context, core, f.client, f.gateway), "batch-module-selection-unavailable");
    assert.equal(f.turns, 0);
  });
  console.log(`Native host driver: ${count} scenarios passed; routing fixtures do not verify a business batch`);
} finally {
  if (inheritedCoordinator === undefined) delete process.env.AIDLC_COORDINATOR_BINDING;
  else process.env.AIDLC_COORDINATOR_BINDING = inheritedCoordinator;
  if (inherited === undefined) delete process.env.AIDLC_SESSION_BINDING;
  else process.env.AIDLC_SESSION_BINDING = inherited;
}
