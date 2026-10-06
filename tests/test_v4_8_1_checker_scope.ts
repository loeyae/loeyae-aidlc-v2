/**
 * 4.8.1 (MARS-76) regression suite: semantic checker module scope.
 *
 * In a module / unit context, contract-baseline, nfr-coverage and
 * infrastructure-completeness used to collect every matching file of the project
 * (`projectFiles`), so an unrelated project-root document with an unresolved marker
 * blocked every unit, and the contract owner/consumers could be taken from another
 * module's contract. They now collect only the module's inception, the unit's (or,
 * without a unit, the module's) construction, the module-manifest `paths` and the
 * declared `contract_paths`; project-level contract tables contribute only the rows of
 * the active module. noUnresolved() no longer matches negated 阻断 (不/非/无阻断) and
 * nfrCoverage() cuts NFR blocks at the right offset and accepts p99.
 *
 * Checkers run through the public CLI (`check`, `evidence run`) and the gate probe;
 * evidence is only produced by the controlled producer.
 *
 * AIDLC_ONLY=<substring> runs only the matching sections; AIDLC_TRANSCRIPT=<file>
 * writes the normalized checker outputs of the compatibility section (no module
 * context) so they can be compared with the 4.8.0 engine.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";
import { moduleForValue } from "../core/tools/aidlc-contract-table";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const probe = join(repository, "tests", "gate_probe.ts");
const tsx = process.env.AIDLC_TSX || join(repository, "node_modules", "tsx", "dist", "cli.mjs");
// The scratch directory name must not contain a checker keyword (contract, schema, nfr,
// deploy, ...): the file patterns are matched against absolute paths.
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-481-scope-"));
const ONLY = process.env.AIDLC_ONLY || "";
const sections: string[] = [];
const failed: string[] = [];
let counter = 0;

type Run = { status: number; out: string; stdout: string; json: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const M01 = "m01";
const U1 = "u1";
const IN = `docs/aidlc/modules/${M01}/inception`;
const UNIT = `docs/aidlc/modules/${M01}/construction/${U1}`;
const MODULE_ARGS = ["--module", M01, "--unit", U1];

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["AIDLC_ACTIVE_MODULE", "AIDLC_ACTIVE_UNIT", "AIDLC_ACTIVE_STAGE", "AIDLC_PHASE", "AIDLC_MODULE"]) delete env[key];
  return env;
}

function parsed(stdout: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function run(project: string, args: string[]): Run {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8", env: cleanEnv() });
  const stdout = result.stdout || "";
  return { status: result.status ?? 1, stdout, out: `${stdout}\n${result.stderr || ""}`, json: parsed(stdout) };
}

/** `check --sensor <sensor> [context]`: the checker JSON on success, the error text otherwise. */
function check(project: string, sensor: string, context: string[] = MODULE_ARGS): { ok: boolean; value: Json; out: string } {
  const result = run(project, ["check", "--sensor", sensor, ...context]);
  return { ok: result.status === 0, value: result.json as Json, out: result.out.trim() };
}

function passes(project: string, sensor: string, context: string[] = MODULE_ARGS): Json {
  const result = check(project, sensor, context);
  assert.ok(result.ok, `${sensor} expected to pass\n${result.out}`);
  return result.value;
}

function fails(project: string, sensor: string, pattern: RegExp, context: string[] = MODULE_ARGS): string {
  const result = check(project, sensor, context);
  assert.ok(!result.ok, `${sensor} expected to fail with ${pattern}, but passed: ${JSON.stringify(result.value)}`);
  assert.match(result.out, pattern, `${sensor} failed for another reason: ${result.out.slice(-600)}`);
  return result.out;
}

function write(project: string, path: string, content: string): void {
  const target = join(project, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function remove(project: string, path: string): void {
  rmSync(join(project, path), { recursive: true, force: true });
}

function git(project: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

interface ModuleSpec { module_id: string; name: string; service_id: string; paths?: string[]; contract_paths?: string[] }

function manifest(project: string, m01: Partial<ModuleSpec> = {}): void {
  const modules: ModuleSpec[] = [
    { module_id: M01, name: "Orders", service_id: "order-service", paths: ["services/m01"], ...m01 },
    { module_id: "m02", name: "Payments", service_id: "payment-service", paths: ["services/m02"] },
    { module_id: "m03", name: "Reports", service_id: "report-service" },
  ];
  write(project, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules }, null, 2)}\n`);
}

/**
 * Legacy-layout project with a three-module manifest; `moduleContext` puts the workflow
 * on the unit instance shared-contract-baseline@module:m01@unit:u1.
 */
function project(moduleContext = true): string {
  const root = join(scratch, `p${++counter}`);
  mkdirSync(root, { recursive: true });
  write(root, "README.md", "# Orders\n");
  write(root, "services/m01/app.py", "def orders():\n    return []\n");
  write(root, "services/m02/app.py", "def payments():\n    return []\n");
  manifest(root);
  write(root, `${IN}/unit-manifest.json`, `${JSON.stringify({ schema_version: 1, module_id: M01, units: ["u1", "u2"].map((unit) => ({ unit_id: unit, name: `Unit ${unit}`, service_id: "order-service", conditional_stages: ["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design", "shared-contract-baseline"] })) }, null, 2)}\n`);
  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "base"]);
  const state = createInitialState("feature", "4.8.1", `workflow-p${counter}`, [], "4.8.1 checker scope") as WorkflowState;
  const done = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
  state.completed_stages = [...done, "units-generation"];
  state.completed_stage_instances = [...done, `units-generation@module:${M01}`];
  if (moduleContext) {
    state.current_stage = "shared-contract-baseline";
    state.current_stage_instance = `shared-contract-baseline@module:${M01}@unit:${U1}`;
    state.current_phase = "construction";
    state.current_module = M01;
    state.current_unit = U1;
  } else {
    delete state.current_module;
    delete state.current_unit;
  }
  saveWorkflowState(root, state);
  return root;
}

function schemaHash(root: string, files: string[]): string {
  const schema = files.map((file) => `${join(...file.split("/"))}\n${readFileSync(join(root, file), "utf8")}`).join("\n");
  return `sha256:${createHash("sha256").update(schema).digest("hex")}`;
}

/** Runs every case and reports all failing ones together (so RED shows each case). */
function cases(): { run: (label: string, body: () => void) => void; assertAll: () => void } {
  const gaps: string[] = [];
  return {
    run(label, body) {
      try {
        body();
      } catch (error) {
        gaps.push(`${label}: ${(error instanceof Error ? error.message : String(error)).split(/\r?\n/).slice(0, 3).join(" | ")}`);
      }
    },
    assertAll() {
      assert.equal(gaps.length, 0, `cases failed:\n- ${gaps.join("\n- ")}`);
    },
  };
}

async function section(name: string, body: () => void | Promise<void>): Promise<void> {
  if (ONLY && !name.includes(ONLY)) return;
  try {
    await body();
    sections.push(name);
    console.log(`  ok ${name}`);
  } catch (error) {
    failed.push(name);
    console.log(`  FAIL ${name}\n${error instanceof Error ? error.stack || error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture content
// ---------------------------------------------------------------------------

const UNRELATED_CONTRACT = "# 支付契约笔记（旧系统）\n\n字段含义待确认。\n";
const MODULE_CONTRACT = "# 订单查询契约\n\nowner: m01\nconsumers: m02, m03\nversion: 1.0.0（向后兼容）\n\nGET /orders/{id} 返回订单详情。\n";
const NFR = "# 非功能需求\n\n## NFR-001 导出性能\n\n验收：单次导出 10 万行在 30 秒内完成。\n";
const INFRA = "# 基础设施设计\n\n## deployment\n\n- 部署：蓝绿发布\n- 资源：订单数据库 已配置\n- 迁移 migration：本次无表结构变更\n- 回滚 rollback：切回上一版本镜像\n- 运行时依赖：支付网关 existing\n";

function productContracts(rows: { order: string; orderConsumer: string; pay: string; payConsumer: string }): string {
  return [
    "# 产品级契约",
    "",
    "## 契约清单",
    "",
    "| 契约 ID | 提供方 | 版本 | 说明 |",
    "| --- | --- | --- | --- |",
    `| CT-M01-ORDER | m01 | ${rows.order} | 订单查询 |`,
    `| CT-M02-PAY | m02 | ${rows.pay} | 支付确认 |`,
    "",
    "## 消费方状态",
    "",
    "| 契约 ID | 消费者 | 状态 |",
    "| --- | --- | --- |",
    `| CT-M01-ORDER | m02 | ${rows.orderConsumer} |`,
    `| CT-M02-PAY | m03 | ${rows.payConsumer} |`,
    "",
  ].join("\n");
}

try {
  // ------------------------------------------------------------------ 1
  await section("1 contract-baseline: an unrelated project-root contract file no longer blocks the unit", () => {
    const root = project();
    write(root, "docs/legacy/payment-contract-notes.md", UNRELATED_CONTRACT);
    write(root, "services/m01/contracts/orders-contract.md", MODULE_CONTRACT);
    const value = passes(root, "contract-baseline");
    console.log(`    [GREEN check] ${JSON.stringify(value)}`);
    assert.equal(value.owner, "m01");
    assert.deepEqual(value.consumers, ["m02", "m03"]);
    assert.equal(value.schema_hash, schemaHash(root, ["services/m01/contracts/orders-contract.md"]), "schema_hash covers only in-scope files");

    // The controlled producer writes the same verdict, and the gate accepts it.
    const produced = run(root, ["evidence", "run", "--stage", "shared-contract-baseline", "--module", M01, "--unit", U1, "--sensor", "contract-baseline"]);
    assert.equal(produced.status, 0, produced.out);
    const evidence = JSON.parse(readFileSync(join(root, `.aidlc/evidence/shared-contract-baseline/${M01}/${U1}/contract-baseline.json`), "utf8")) as Json;
    assert.equal(evidence.owner, "m01");
    assert.deepEqual(evidence.consumers, ["m02", "m03"]);
    assert.equal(evidence.schema_hash, value.schema_hash);
    const probed = spawnSync(process.execPath, [tsx, probe, `shared-contract-baseline@module:${M01}@unit:${U1}`, "sensors", "contract-baseline"], { cwd: root, encoding: "utf8", env: cleanEnv() });
    assert.equal(probed.status, 0, `${probed.stdout}\n${probed.stderr}`);
    const verdict = JSON.parse(probed.stdout.trim().split(/\r?\n/).pop() || "{}") as { failures?: string[]; error?: string };
    console.log(`    [gate] ${JSON.stringify(verdict)}`);
    assert.equal(verdict.error, undefined);
    assert.deepEqual(verdict.failures, []);
  });

  // ------------------------------------------------------------------ 2
  await section("2 contract-baseline negatives: in-scope markers, missing contract_paths, empty scope", () => {
    const root = project();
    write(root, "services/m01/contracts/orders-contract.md", MODULE_CONTRACT);
    write(root, `${IN}/payment-contract-notes.md`, UNRELATED_CONTRACT);
    console.log(`    [in-scope marker] ${fails(root, "contract-baseline", /unresolved marker found in project artifact/)}`);
    remove(root, `${IN}/payment-contract-notes.md`);
    passes(root, "contract-baseline");

    manifest(root, { contract_paths: ["docs/shared/missing-contract.md"] });
    console.log(`    [missing contract_paths] ${fails(root, "contract-baseline", /contract_paths\[0\].*does not exist/)}`);
    manifest(root, { contract_paths: ["../outside/contract.md"] });
    console.log(`    [escaping contract_paths] ${fails(root, "contract-baseline", /contract_paths\[0\] must be a normalized project-relative path/)}`);
    manifest(root, { contract_paths: [".aidlc/evidence"] });
    console.log(`    [control-plane contract_paths] ${fails(root, "contract-baseline", /contract_paths\[0\] must not point into the AI-DLC control plane/)}`);
    // A symlinked entry is refused; without file-symlink privilege (Windows EPERM) a
    // directory junction, which Node also reports as a symbolic link, is used instead.
    write(root, "docs/shared/real/orders-contract.md", MODULE_CONTRACT);
    let linked: string | undefined;
    try {
      symlinkSync(join(root, "docs/shared/real/orders-contract.md"), join(root, "docs/shared/linked-contract.md"), "file");
      linked = "docs/shared/linked-contract.md";
    } catch (error) {
      console.log(`    [symlink contract_paths] file symlink unavailable (${(error as NodeJS.ErrnoException).code}); using a directory junction`);
      symlinkSync(join(root, "docs/shared/real"), join(root, "docs/shared/linked"), "junction");
      linked = "docs/shared/linked";
    }
    manifest(root, { contract_paths: [linked] });
    console.log(`    [symlink contract_paths ${linked}] ${fails(root, "contract-baseline", /contract_paths\[0\].*symbolic link/)}`);
    manifest(root, { contract_paths: ["docs/shared/real"] });
    passes(root, "contract-baseline");

    manifest(root);
    remove(root, "services/m01/contracts");
    write(root, "docs/legacy/orders-contract.md", MODULE_CONTRACT);
    console.log(`    [empty scope] ${fails(root, "contract-baseline", /no contract schema file found/)}`);
  });

  // ------------------------------------------------------------------ 3
  await section("3 contract-baseline: a project-level contract table contributes only the module's rows", () => {
    const root = project();
    const table = "docs/aidlc/ideation/product-contracts.md";
    manifest(root, { contract_paths: [table] });
    write(root, table, productContracts({ order: "v1", orderConsumer: "已验证", pay: "待确认", payConsumer: "待确认" }));
    const value = passes(root, "contract-baseline");
    console.log(`    [other module rows unresolved] ${JSON.stringify(value)}`);
    assert.equal(value.owner, "m01");
    assert.deepEqual(value.consumers, ["m02"]);

    write(root, table, productContracts({ order: "v1", orderConsumer: "待确认", pay: "v2", payConsumer: "已验证" }));
    console.log(`    [own row unresolved] ${fails(root, "contract-baseline", /unresolved marker found in project artifact/)}`);

    // A table without a row of the module is not a contract source of the module.
    const other = productContracts({ order: "v1", orderConsumer: "已验证", pay: "待确认", payConsumer: "待确认" }).replace(/CT-M01-ORDER \| m01/, "CT-M03-RPT | m03").replace(/CT-M01-ORDER \| m02/, "CT-M03-RPT | m02");
    write(root, table, other);
    console.log(`    [no own row, no other source] ${fails(root, "contract-baseline", /no contract schema file found/)}`);
    write(root, "services/m01/contracts/orders-contract.md", MODULE_CONTRACT);
    const own = passes(root, "contract-baseline");
    assert.equal(own.owner, "m01");
    assert.equal(own.schema_hash, schemaHash(root, ["services/m01/contracts/orders-contract.md"]), "a table without module rows is not hashed");
  });

  // ------------------------------------------------------------------ 3b
  await section("3b contract-baseline: a provider validates every row of its contract, a consumer only its own rows", () => {
    const checks = cases();
    const table = "docs/aidlc/ideation/product-contracts.md";
    // m01 consumes CT-M02-PAY (provided by m02) next to another consumer m03.
    const consumerTable = (provider: string, m03: string, m01: string): string => [
      "# 产品级契约",
      "",
      "| 契约 ID | 提供方 | 版本 | 说明 |",
      "| --- | --- | --- | --- |",
      `| CT-M02-PAY | m02 | ${provider} | 支付确认 |`,
      "",
      "| 契约 ID | 消费者 | 状态 |",
      "| --- | --- | --- |",
      `| CT-M02-PAY | m03 | ${m03} |`,
      `| CT-M02-PAY | m01 | ${m01} |`,
      "",
    ].join("\n");
    checks.run("consumer: provider row and another consumer's row unresolved do not block m01", () => {
      const root = project();
      manifest(root, { contract_paths: [table] });
      write(root, table, consumerTable("v2 待确认", "待确认", "已验证"));
      const value = passes(root, "contract-baseline");
      console.log(`    [consumer, other rows unresolved] ${JSON.stringify(value)}`);
      assert.equal(value.owner, "m02", "the provider row still names the owner");
      assert.deepEqual(value.consumers, ["m01"], "only the module's own consumer row");
      const hashed = ["| 契约 ID | 提供方 | 版本 | 说明 |", "| CT-M02-PAY | m02 | v2 待确认 | 支付确认 |", "| 契约 ID | 消费者 | 状态 |", "| CT-M02-PAY | m01 | 已验证 |"].join("\n");
      assert.equal(value.schema_hash, `sha256:${createHash("sha256").update(`${join(...table.split("/"))}\n${hashed}`).digest("hex")}`, "the provider row (reference) and the module's own consumer row are hashed; the other consumer's row is not");
    });
    checks.run("consumer: m01's own consumer row unresolved blocks m01", () => {
      const root = project();
      manifest(root, { contract_paths: [table] });
      write(root, table, consumerTable("v2", "已验证", "待确认"));
      console.log(`    [consumer, own row unresolved] ${fails(root, "contract-baseline", /unresolved marker found in project artifact/)}`);
    });
    checks.run("consumer: a shared consumer cell (m03、m01) is m01's own row and is validated", () => {
      const root = project();
      manifest(root, { contract_paths: [table] });
      const shared = ["| 契约 ID | 提供方 | 版本 |", "| --- | --- | --- |", "| CT-M02-PAY | m02 | v2 |", "", "| 契约 ID | 消费者 | 状态 |", "| --- | --- | --- |", "| CT-M02-PAY | m03、m01 | 待确认 |", ""].join("\n");
      write(root, table, shared);
      console.log(`    [consumer, shared cell unresolved] ${fails(root, "contract-baseline", /unresolved marker found in project artifact/)}`);
      write(root, table, shared.replace("待确认", "已验证"));
      assert.deepEqual(passes(root, "contract-baseline").consumers, ["m01"], "only the module itself is reported as consumer of a consumed contract");
    });
    // m01 provides CT-M01-ORDER: every row of that contract is m01's responsibility.
    const providerTable = (m02: string, m03: string): string => [
      "# 产品级契约",
      "",
      "| 契约 ID | 提供方 | 版本 | 说明 |",
      "| --- | --- | --- | --- |",
      "| CT-M01-ORDER | m01 | v1 | 订单查询 |",
      "",
      "| 契约 ID | 消费者 | 状态 |",
      "| --- | --- | --- |",
      `| CT-M01-ORDER | m02 | ${m02} |`,
      `| CT-M01-ORDER | m03 | ${m03} |`,
      "",
    ].join("\n");
    checks.run("provider: another module's consumer row of m01's contract unresolved blocks m01", () => {
      const root = project();
      manifest(root, { contract_paths: [table] });
      write(root, table, providerTable("已验证", "待确认"));
      console.log(`    [provider, consumer row unresolved] ${fails(root, "contract-baseline", /unresolved marker found in project artifact/)}`);
    });
    checks.run("provider: every row resolved passes with all consumers", () => {
      const root = project();
      manifest(root, { contract_paths: [table] });
      write(root, table, providerTable("已验证", "已验证"));
      const value = passes(root, "contract-baseline");
      console.log(`    [provider, all rows resolved] ${JSON.stringify(value)}`);
      assert.equal(value.owner, "m01");
      assert.deepEqual(value.consumers, ["m02", "m03"]);
    });
    checks.assertAll();
  });

  // ------------------------------------------------------------------ 3c
  await section("3c moduleForValue: exact match first, then a whole-token module id, longest wins", () => {
    const checks = cases();
    const modules = [
      { module_id: "m1", name: "Short", service_id: "short-service" },
      { module_id: "m10", name: "Long", service_id: "long-service" },
      { module_id: "order", name: "订单", service_id: "order-svc" },
      { module_id: "order-ext", name: "订单扩展", service_id: "order-ext-svc" },
    ];
    const expect = (value: string, wanted: string | undefined, excluded?: string) => checks.run(`moduleForValue(${JSON.stringify(value)}${excluded ? `, excluded ${excluded}` : ""})`, () => {
      assert.equal(moduleForValue(modules, value, excluded), wanted);
    });
    // Exact module_id / service_id / name.
    expect("m10", "m10");
    expect("m1", "m1");
    expect("long-service", "m10");
    expect("订单扩展", "order-ext");
    // A module id inside a longer cell, bounded by non-alphanumerics.
    expect("m10/unit-contracts", "m10");
    expect("m1/unit-contracts", "m1");
    expect("order-ext/api", "order-ext");
    expect("order/api", "order");
    expect("order-api", "order");
    expect("订单服务 m10", "m10");
    // Not a module: a module id glued to other letters or digits.
    expect("xm10y", undefined);
    expect("m100", undefined);
    expect("orders", undefined);
    // excluded keeps working (dependency graph: consumer differs from provider).
    expect("m10", undefined, "m10");
    expect("m10/unit", undefined, "m10");

    // contract-baseline of a module m1 must not take m10's rows, and m10 must find its own.
    const table = "docs/aidlc/ideation/product-contracts.md";
    const content = [
      "# 产品级契约",
      "",
      "| 契约 ID | 提供方 | 版本 |",
      "| --- | --- | --- |",
      "| CT-M10-RPT | m10 | v1 待确认 |",
      "| CT-M1-SUM | m1 | v1 |",
      "",
      "| 契约 ID | 消费者 | 状态 |",
      "| --- | --- | --- |",
      "| CT-M1-SUM | m02 | 已验证 |",
      "",
    ].join("\n");
    const prefixProject = (active: string): string => {
      const root = project();
      const ids = ["m1", "m10", "m02"];
      write(root, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules: ids.map((id) => ({ module_id: id, name: `Module ${id}`, service_id: `${id}-service`, ...(id === active ? { contract_paths: [table] } : {}) })) }, null, 2)}\n`);
      write(root, table, content);
      return root;
    };
    const contextOf = (moduleId: string) => ["--module", moduleId, "--unit", U1];
    checks.run("contract-baseline m1 ignores m10's unresolved provider row", () => {
      const root = prefixProject("m1");
      write(root, `docs/aidlc/modules/m1/inception/unit-manifest.json`, `${JSON.stringify({ schema_version: 1, module_id: "m1", units: [{ unit_id: U1, name: "Unit u1", service_id: "m1-service", conditional_stages: ["shared-contract-baseline"] }] }, null, 2)}\n`);
      const value = passes(root, "contract-baseline", contextOf("m1"));
      console.log(`    [m1 vs m10] ${JSON.stringify({ owner: value.owner, consumers: value.consumers })}`);
      assert.equal(value.owner, "m1");
      assert.deepEqual(value.consumers, ["m02"]);
    });
    checks.run("contract-baseline m10 sees its own unresolved provider row", () => {
      const root = prefixProject("m10");
      write(root, `docs/aidlc/modules/m10/inception/unit-manifest.json`, `${JSON.stringify({ schema_version: 1, module_id: "m10", units: [{ unit_id: U1, name: "Unit u1", service_id: "m10-service", conditional_stages: ["shared-contract-baseline"] }] }, null, 2)}\n`);
      console.log(`    [m10 own row] ${fails(root, "contract-baseline", /unresolved marker found in project artifact/, contextOf("m10"))}`);
    });
    checks.assertAll();
  });

  // ------------------------------------------------------------------ 4
  await section("4 nfr-coverage and infrastructure-completeness collect only the unit scope", () => {
    const root = project();
    write(root, "docs/legacy/nfr-legacy.md", "# 旧系统 NFR\n\nNFR-900 TODO 待补\n");
    write(root, "docs/legacy/deployment-legacy.md", "# 旧部署\n\nTODO 补充部署说明\n");
    write(root, `${UNIT}/nfr-requirements.md`, NFR);
    write(root, `${UNIT}/infrastructure-design.md`, INFRA);
    const nfr = passes(root, "nfr-coverage");
    console.log(`    [nfr GREEN] ${JSON.stringify(nfr)}`);
    assert.deepEqual(nfr.nfr_items.map((item: Json) => item.id), ["NFR-001"]);
    const infra = passes(root, "infrastructure-completeness");
    console.log(`    [infrastructure GREEN] ${JSON.stringify(infra)}`);

    // Another unit of the same module and another module are out of scope as well.
    write(root, `docs/aidlc/modules/${M01}/construction/u2/nfr-requirements.md`, "NFR-002 TODO\n");
    write(root, "docs/aidlc/modules/m02/inception/nfr-requirements.md", "NFR-003 TODO\n");
    passes(root, "nfr-coverage");
    // In scope it still fails, and an empty scope still reports missing artifacts.
    write(root, `${IN}/nfr-notes.md`, "NFR-004 TODO\n");
    console.log(`    [nfr in-scope marker] ${fails(root, "nfr-coverage", /unresolved marker found in project artifact/)}`);
    remove(root, `${IN}/nfr-notes.md`);
    write(root, "services/m01/deployment-notes.md", "TODO 发布脚本\n");
    console.log(`    [infrastructure module path marker] ${fails(root, "infrastructure-completeness", /unresolved marker found in project artifact/)}`);
    remove(root, "services/m01/deployment-notes.md");
    remove(root, `${UNIT}/infrastructure-design.md`);
    console.log(`    [infrastructure empty scope] ${fails(root, "infrastructure-completeness", /infrastructure design artifacts are missing/)}`);
    // (The nfr pattern also matches "infrastructure", so the empty nfr scope is checked last.)
    remove(root, `${UNIT}/nfr-requirements.md`);
    console.log(`    [nfr empty scope] ${fails(root, "nfr-coverage", /NFR artifacts are missing/)}`);
  });

  // ------------------------------------------------------------------ 5
  await section("5 noUnresolved ignores negated 阻断 only", () => {
    const root = project();
    const gaps = cases();
    const nfr = (line: string) => write(root, `${UNIT}/nfr-requirements.md`, `# 非功能需求\n\n## NFR-001 导出性能\n\n验收：单次导出在 30 秒内完成。\n\n${line}\n`);
    for (const line of ["超时重试不阻断主流程。", "导出失败属于非阻断告警。", "当前无阻断问题。"]) {
      gaps.run(`passes [${line}]`, () => {
        nfr(line);
        passes(root, "nfr-coverage");
      });
    }
    for (const line of ["阻断", "存在阻断问题。", "阻断项：导出超时。", "TODO 补充指标", "阈值待确认", "是否阻断：是"]) {
      gaps.run(`fails [${line}]`, () => {
        nfr(line);
        console.log(`    [${line}] ${fails(root, "nfr-coverage", /unresolved marker found in project artifact/)}`);
      });
    }
    gaps.assertAll();
  });

  // ------------------------------------------------------------------ 6
  await section("6 nfrCoverage cuts blocks at the next NFR id and accepts p99", () => {
    const root = project();
    const gaps = cases();
    const nfr = (body: string) => write(root, `${UNIT}/nfr-requirements.md`, `# 非功能需求\n\n${body}`);
    gaps.run("adjacent, NFR-001 with P99 only", () => {
      nfr("NFR-001 接口响应 P99≤200ms\nNFR-002 可用性 验收：月度可用性 99.9%\n");
      const p99 = passes(root, "nfr-coverage");
      console.log(`    [adjacent, P99] ${JSON.stringify(p99.nfr_items)}`);
      assert.match(p99.nfr_items[0].acceptance_criterion, /P99≤200ms/);
    });
    // The block of NFR-001 must keep its last id.length characters (here: "延迟 p95").
    gaps.run("adjacent, NFR-001 ending with p95", () => {
      nfr("NFR-001 导出延迟 p95\nNFR-002 可用性 验收：月度可用性 99.9%\n");
      const p95 = passes(root, "nfr-coverage");
      console.log(`    [adjacent, trailing p95] ${JSON.stringify(p95.nfr_items)}`);
      assert.match(p95.nfr_items[0].acceptance_criterion, /p95/);
    });
    // NFR-1 must not take the block of NFR-10.
    gaps.run("NFR-10 before NFR-1 (P99)", () => {
      nfr("NFR-10 吞吐 验收：1000 TPS\nNFR-1 延迟 P99≤200ms\n");
      const prefix = passes(root, "nfr-coverage");
      console.log(`    [NFR-10 before NFR-1] ${JSON.stringify(prefix.nfr_items)}`);
      const one = prefix.nfr_items.find((item: Json) => item.id === "NFR-1");
      assert.match(one.acceptance_criterion, /^NFR-1 延迟 P99≤200ms$/);
    });
    gaps.run("NFR-10 before NFR-1 without a rule", () => {
      nfr("NFR-10 吞吐 验收：1000 TPS\nNFR-1 延迟要尽量低\n");
      console.log(`    [NFR-1 without rule after NFR-10] ${fails(root, "nfr-coverage", /NFR-1 has no acceptance or measurement rule/)}`);
    });
    gaps.assertAll();
  });
  // ------------------------------------------------------------------ 7
  await section("7 compat: without a module context the checkers still scan the whole project", () => {
    const root = project(false);
    const transcript: string[] = [];
    const record = (label: string, result: { ok: boolean; value: Json; out: string }) => {
      transcript.push(`${label}: ${result.ok ? JSON.stringify(result.value) : `FAIL ${result.out.split(/\r?\n/).filter((line) => /Error|unresolved|missing|found/.test(line))[0] || result.out}`}`);
    };
    write(root, "docs/legacy/orders-contract.md", MODULE_CONTRACT);
    write(root, "docs/legacy/nfr-legacy.md", NFR);
    write(root, "docs/legacy/deployment-legacy.md", INFRA);
    for (const sensor of ["contract-baseline", "nfr-coverage", "infrastructure-completeness"]) {
      const result = check(root, sensor, []);
      assert.ok(result.ok, `${sensor} scans project-root files without a module context\n${result.out}`);
      record(`${sensor} project root`, result);
    }
    assert.equal(passes(root, "contract-baseline", []).schema_hash, schemaHash(root, ["docs/legacy/orders-contract.md"]));
    write(root, "docs/legacy/payment-contract-notes.md", UNRELATED_CONTRACT);
    write(root, "docs/other/nfr-old.md", "NFR-900 TODO\n");
    write(root, "docs/other/deploy-old.md", "TODO\n");
    for (const sensor of ["contract-baseline", "nfr-coverage", "infrastructure-completeness"]) {
      const result = check(root, sensor, []);
      assert.ok(!result.ok && /unresolved marker found in project artifact/.test(result.out), `${sensor} still sees every project file\n${result.out}`);
      record(`${sensor} unrelated marker`, result);
    }
    const out = process.env.AIDLC_TRANSCRIPT;
    if (out) writeFileSync(out, `${transcript.join("\n")}\n`, "utf8");
    for (const line of transcript) console.log(`    ${line}`);
  });

  if (failed.length > 0) {
    console.log(`4.8.1 checker scope tests FAILED: ${failed.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log(`4.8.1 checker scope tests passed (${sections.length} sections)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
