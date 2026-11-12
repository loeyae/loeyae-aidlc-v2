import { createAdmissionFixture } from "./autonomy-admission-fixture";
import { autonomyDigest } from "../../core/tools/aidlc-autonomy-files";
import { observationHash } from "../../core/tools/aidlc-observation-inputs";
import { observeBrowser } from "../../core/tools/aidlc-observation-browser";
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
export const chrome =
  process.env.AIDLC_TEST_BROWSER ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].find((p) => existsSync(p)) ||
  "";
export const put = (root: string, p: string, v: any) => {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  writeFileSync(join(root, p), typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v, null, 2));
};
export const ref = (root: string, p: string) => ({
  repository_id: "project",
  path: p,
  digest_mode: "raw-file",
  digest: observationHash(readFileSync(join(root, p))),
});
const style =
  "body{margin:0;background:#f3f4f6;color:#162032;font:16px Arial}main{margin:40px auto;padding:32px;background:white;border:1px solid #d8dce3;border-radius:12px;max-width:280px}h1{font-size:24px;margin:0 0 20px}button{background:#2159c5;color:white;border:0;border-radius:6px;padding:12px 24px;font:16px Arial}button:disabled{background:#8392a8}#result{margin-top:20px;min-height:24px}a{color:#2159c5}";
export function design(state: string) {
  return `<!doctype html><html><head><style>${style}</style></head><body data-role="editor" data-state="${state}"><main data-page="PAGE-001"><h1>Publish item</h1><button id="publish" ${state === "draft" || state === "published" ? "disabled" : ""}>${state === "published" ? "Published" : state === "error" ? "Retry" : "Publish"}</button><div id="result">${state === "published" ? '<a href="/result">View result</a>' : state === "error" ? "Failed. Please retry." : state === "draft" ? "Draft cannot publish." : "Ready to publish."}</div></main></body></html>`;
}
const application = design("ready").replace(
  "</body>",
  `<script>
const q=new URLSearchParams(location.search),state=q.get('state')||'ready',b=document.querySelector('#publish'),r=document.querySelector('#result');let attempts=0;
if(state==='draft'){document.body.dataset.state='draft';b.disabled=true;r.textContent='Draft cannot publish.';}
b.onclick=async()=>{b.disabled=true;try{const res=await fetch('/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:state==='draft'?'draft':'ready',fail:q.get('fail')==='once'&&attempts++===0})});if(!res.ok)throw Error('publish');document.body.dataset.state='published';b.textContent='Published';r.innerHTML='<a href="/result">View result</a>';}catch{document.body.dataset.state='error';b.disabled=false;b.textContent='Retry';r.textContent='Failed. Please retry.';}};
</script></body>`,
);
const service = `const http=require('http'),fs=require('fs'),cp=require('child_process');const commit=cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();let published=false;
const server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://local');res.setHeader('content-type','application/json');if(u.pathname==='/version')return res.end(JSON.stringify({ready:true,version_digest:process.env.CAP_VERSION||'v1',candidate_commit:commit,owner:'external-team'}));if(u.pathname==='/slow')return setTimeout(()=>res.end('{}'),150);if(u.pathname==='/upstream')return res.end(JSON.stringify(Array.from({length:120},(_,i)=>i)));if(u.pathname==='/publish'){let body='';for await(const b of req)body+=b;const data=JSON.parse(body||'{}');if(data.state!=='ready'){res.statusCode=400;return res.end(JSON.stringify({error:'not-ready'}));}if(data.fail){res.statusCode=503;return res.end(JSON.stringify({error:'retryable'}));}published=true;return res.end(JSON.stringify({state:'published',result:'/result'}));}if(u.pathname==='/result')return res.end(JSON.stringify({published,state:published?"published":"pending"}));res.setHeader('content-type','text/html');res.end(fs.readFileSync('src/web.html'));});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`;
const exporter = `exports.exportOrders=async function(upstream){const rows=await upstream();const pages=[];for(let i=0;i<rows.length;i+=50)pages.push(rows.slice(i,i+50));return pages;};`;
const observer = `const {exportOrders}=require('./orders.cjs');(async()=>{const rows=await (await fetch(process.env.OBS_ORIGIN+'/upstream')).json();const pages=await exportOrders(async()=>rows);let timeout;try{await exportOrders(async()=>{try{await fetch(process.env.OBS_ORIGIN+'/slow',{signal:AbortSignal.timeout(20)});}catch(e){throw Object.assign(new Error('upstream timeout'),{code:'ETIMEDOUT',cause:e});}return [];});}catch(e){timeout=e.code;}console.log(JSON.stringify({sizes:pages.map(p=>p.length),flattened:pages.flat(),empty:await exportOrders(async()=>[]),one:(await exportOrders(async()=>[1])).map(p=>p.length),fifty:(await exportOrders(async()=>rows.slice(0,50))).map(p=>p.length),fiftyone:(await exportOrders(async()=>rows.slice(0,51))).map(p=>p.length),timeout}));})();`;
const eq = (id: string, pointer: string, expected: any) => ({ assertion_id: id, pointer, op: "equal", expected });
export async function prepareDesign(root: string) {
  assert.ok(chrome, "Install Chromium/Chrome or set AIDLC_TEST_BROWSER to an actual executable");
  const baselines: any = {};
  for (const viewport of [
    { width: 800, height: 600 },
    { width: 390, height: 844 },
  ])
    for (const state of ["ready", "draft", "published", "error"]) {
      const p = `design/${state}-${viewport.width}.html`;
      put(root, p, design(state));
      const actual = await observeBrowser(chrome, pathToFileURL(join(root, p)).href, {
        viewport,
        initial_expectations: [{ selector: "h1", property: "text", expected: "Publish item" }],
        steps: [],
        expectations: [{ selector: "body", property: "attribute", name: "data-state", expected: state }],
      });
      assert.equal(actual.passed, true);
      const image = `design/${state}-${viewport.width}.png`;
      put(root, image, actual.image);
      baselines[`${state}-${viewport.width}`] = image;
    }
  return baselines;
}
export function observationFixture(scratch: string, name: string, options: any = {}) {
  let plan: any;
  const f = createAdmissionFixture(scratch, name, (admission, f) => {
    put(f.root, "src/server.cjs", service);
    put(f.root, "src/orders.cjs", exporter);
    put(f.root, "src/observe.cjs", observer);
    put(f.root, "src/web.html", application);
    admission.environment_variables = ["OBS_ORIGIN"];
    const environment = {
      schema: "aidlc.observation-environment/v1",
      isolated: true,
      endpoints: {
        app: { origin: "${OBS_ORIGIN}", version_path: "/version", kind: "candidate", header_variables: {} },
      },
      variables: ["OBS_ORIGIN"],
      inputs: [],
      ...(options.ui ? { browser: chrome } : {}),
      ...(options.isolateCases ? {case_service:{argv:[process.execPath,'src/server.cjs'],timeout_ms:5000,input_refs:[ref(f.root,'src/server.cjs')]}} : {}),
    };
    put(f.root, "fixtures/observation-environment.json", environment);
    const check = (check_id: string) => ({
      check_id,
      kind: "command",
      covers: [f.item("AC-001")],
      argv: [process.execPath, "src/observe.cjs"],
      timeout_ms: 5000,
      assertions: [
        eq("sizes", "/sizes", [50, 50, 20]),
        eq(
          "all-rows",
          "/flattened",
          Array.from({ length: 120 }, (_, i) => i),
        ),
        eq("empty", "/empty", []),
        eq("one", "/one", [1]),
        eq("fifty", "/fifty", [50]),
        eq("fiftyone", "/fiftyone", [50, 1]),
        eq("timeout", "/timeout", "ETIMEDOUT"),
      ],
    });
    plan = {
      schema: "aidlc.observation-plan/v1",
      batch_id: "publish",
      scope_revision: 1,
      lifetime_seconds: 300,
      environment_ref: ref(f.root, "fixtures/observation-environment.json"),
      candidate_artifact_paths: ["src/server.cjs", "src/orders.cjs", "src/observe.cjs", "src/web.html"],
      ui_applicability: { kind: "none", source_refs: [f.input] },
      checks: [check("recoverable"), check("ready")],
    };
    if (options.ui) {
      cpSync(join(options.designRoot, "design"), join(f.root, "design"), { recursive: true });
      put(
        f.root,
        "docs/aidlc/modules/orders/inception/ui-plan.md",
        "# PAGE-001 Publish\nEditor can publish ready items, draft is disabled, failures can retry.",
      );
      const page = ref(f.root, "docs/aidlc/modules/orders/inception/ui-plan.md"),
        pageRef = { ...page, item_id: "PAGE-001" };
      f.batch.ui_refs.push(pageRef);
      f.policy.hard_constraints.push(pageRef);
      const cases = options.cases || ["ready", "draft", "published", "error", "retry"];
      plan.checks = [];
      f.matrix.checks = [];
      f.matrix.ui_combinations = [];
      for (const viewport of options.viewports || [
        { width: 800, height: 600 },
        { width: 390, height: 844 },
      ])
        for (const scenario of cases) {
          const id = `ui-${scenario}-${viewport.width}`,
            final = scenario === "retry" ? "published" : scenario,
            baseline = ref(f.root, options.baselines[`${final}-${viewport.width}`]),
            tolerance = {
              pixel_delta: 0,
              max_diff_ratio: 0.001,
              regions: [
                {
                  region_id: "publish-panel",
                  rect: { x: (viewport.width - 346) / 2, y: 40, width: 346, height: 240 },
                  pixel_delta: 0,
                  max_diff_ratio: 0,
                },
              ],
            };
          const expect = (selector: string, property: string, expected: any, name?: string) => ({
            selector,
            property,
            expected,
            ...(name ? { name } : {}),
          });
          const successful = [
              expect("body", "attribute", "published", "data-state"),
              expect("#result", "text", "View result"),
            ],
            failed = [
              expect("body", "attribute", "error", "data-state"),
              expect("#result", "text", "Failed. Please retry."),
            ];
          const steps = ["published", "error", "retry"].includes(scenario)
            ? [{ action: "click", selector: "#publish", expectations: scenario === "published" ? successful : failed }]
            : [];
          if (scenario === "retry") steps.push({ action: "click", selector: "#publish", expectations: successful });
          const c = {
            check_id: id,
            kind: "ui",
            covers: [f.item("AC-001")],
            endpoint: "app",
            path: `/?state=${scenario === "draft" ? "draft" : "ready"}${["error", "retry"].includes(scenario) ? "&fail=once" : ""}`,
            page_ref: pageRef,
            combination_id: id,
            viewport,
            state: scenario,
            role: "editor",
            initial_expectations: [
              expect("[data-page]", "visible", true),
              expect("#result", "visible", true),
              expect("#publish", "disabled", scenario === "draft"),
              expect("body", "attribute", "editor", "data-role"),
            ],
            steps,
            expectations: [expect("body", "attribute", final, "data-state")],
            baseline_ref: baseline,
            design_refs: [page, ref(f.root, options.baselines[`${final}-${viewport.width}`].replace(".png", ".html"))],
            tolerance,
          };
          plan.checks.push(c);
          f.matrix.checks.push(id);
          f.matrix.ui_combinations.push(
            JSON.parse(
              JSON.stringify({
                combination_id: id,
                page_ref: pageRef,
                viewport,
                state: scenario,
                role: "editor",
                required_selectors: ["[data-page]", "#publish", "#result"],
                required_actions: steps.map((s) => ({ action: s.action, selector: s.selector })),
                baseline_ref: baseline,
                tolerance,
              }),
            ),
          );
        }
      // Preserve the policy's named check requirements as actual direct API assertions.
      for (const id of ["recoverable", "ready"]) {
        f.matrix.checks.push(id);
        plan.checks.push({
          check_id: id,
          kind: "http",
          covers: [f.item("AC-001")],
          endpoint: "app",
          path: "/publish",
          method: "POST",
          body: { state: id === "ready" ? "ready" : "draft" },
          expected_status: id === "ready" ? 200 : 400,
          assertions: [
            eq("api-rule", id === "ready" ? "/state" : "/error", id === "ready" ? "published" : "not-ready"),
          ],
        });
      }
      f.matrix.checks.push("publish-result");
      plan.checks.push({
        check_id: "publish-result",
        kind: "http",
        covers: [f.item("AC-001")],
        endpoint: "app",
        path: "/result",
        method: "GET",
        expected_status: 200,
        assertions: [eq("published-backend", "/published", true), eq("result-state", "/state", "published")],
      });
      plan.ui_applicability = { kind: "required", source_refs: [page] };
      admission.reception[0].ui = "required";
      admission.reception[0].ui_baseline = {
        design_refs: [page],
        asset_refs: [plan.checks[0].baseline_ref],
        viewports: [
          { width: 800, height: 600 },
          { width: 390, height: 844 },
        ],
        states: cases,
        tolerances: { max_diff_ratio: 0.001 },
      };
      admission.validation_bindings = f.matrix.checks.map((check_id: string, i: number) => ({
        check_id,
        covers: [f.item("AC-001"), pageRef],
        command_id: "fixture-baseline",
        assertion: "Fixture reception protocol only; browser/HTTP execution happens in the P1-07 producer",
        kind: i === 0 ? "ui-visual" : i === 1 ? "ui-interaction" : "behavior",
      }));
    }
    options.mutate?.(plan, f, admission);
    put(f.root, "fixtures/observation-plan.json", plan);
    f.batch.baseline_inputs.push(ref(f.root, "fixtures/observation-plan.json"));
  },{draft:options.draft});
  const g = (args: string[]) => {
    const r = spawnSync("git", args, { cwd: f.root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const commit = () => {
    g(["add", "."]);
    g([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "isolated observation candidate",
    ]);
  };
  commit();
  const start = async () => {
    const child = spawn(process.execPath, ["src/server.cjs"], {
      cwd: f.root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let error = "";
    child.stderr.on("data", (b) => (error += b));
    const port = await new Promise<string>((r, j) => {
      const t = setTimeout(() => j(Error("service start timeout " + error)), 5000);
      child.stdout.once("data", (b) => {
        clearTimeout(t);
        r(String(b).trim());
      });
      child.once("error", j);
    });
    process.env.OBS_ORIGIN = "http://127.0.0.1:" + port;
    return child;
  };
  return { ...f, observationPlan: plan, commit, start };
}

export function saveObservationEvidence(f: any, r: any, destination: string) {
  mkdirSync(destination, { recursive: true });
  put(destination, "receipt.json", readFileSync(join(f.root, r.receipt_ref.path)));
  const issuer = JSON.parse(readFileSync(join(f.root, ".git/aidlc/autonomy/issuer.json"), "utf8"));
  put(destination, "fixture-public-key.json", { key_id: issuer.key_id, public_key: issuer.public_key });
  const files = spawnSync("git", ["ls-files", "-z"], { cwd: f.root, encoding: "utf8" })
    .stdout.split("\0")
    .filter(Boolean);
  for (const p of files) put(destination, "source/" + p, readFileSync(join(f.root, p)));
  const mapping = r.raw_refs.map((ref: any) => {
    const saved = "observed/" + ref.path.split("/").at(-1);
    put(destination, saved, readFileSync(join(f.root, ref.path)));
    return { ...ref, saved_path: saved };
  });
  put(destination, "manifest.json", {
    kind: "isolated-fixture-engineering-observation",
    candidate_ref: r.candidate_ref,
    raw_files: mapping,
    operator_approval: "simulated fixture; not actual business authorization",
    status: r.status,
  });
}
