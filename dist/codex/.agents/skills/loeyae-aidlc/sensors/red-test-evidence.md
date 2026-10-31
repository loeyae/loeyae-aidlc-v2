---
id: red-test-evidence
name: Controlled RED Test Evidence
description: Verifies that tests exist before GREEN and fail because the target behavior is not implemented.
evidence_path: .aidlc/evidence/<stage-slug>/red-test-evidence.json
---

# red-test-evidence Sensor

## 历史原件丢失后的受控重放

原始 RED 原件缺失时，可使用 `evidence run --stage tdd --module <module> --unit <unit> --sensor red-test-evidence --refresh --historical-replay`。它只能针对已完成的 TDD 实例，使用该实例的精确领取，或同一 workflow/module/unit 的 code-generation 领取发布。原始 RED 或诊断文件已存在时拒绝覆盖；同范围受控历史补证可以正式刷新，旧文件逐字节归档并以路径及 SHA-256 追溯，新记录仍由真实重跑产生。命令不接受 `--config`、`--output` 或测试过滤，也不会重写全局 TDD 命令。配置与字段见 [历史 RED 重放协议](../knowledge/protocols/historical-red-replay.md)。

证据显式记录 `evidence_mode: historical_replay`，与省略模式字段的旧版原始 RED 及 `original` 模式区分。普通日志或诊断报告不能导入。该模式当前提供受控 Vitest 适配器：生产器在固定历史工作树真实执行，单独收集未处理异常及 suite 编译/环境错误，要求全部实际测试无跳过、至少一个业务 AssertionError，并以实际执行的方法覆盖当前 I13 单元映射。

门禁复验独立源码仓库、完整提交、严格祖先关系、干净的稀疏工作树、源码/测试/配置/锁文件与实际依赖摘要、执行命令、原始报告及其 SHA-256、I13 和当前需求摘要。任一漂移或不可核验条件均拒绝；不把工具升级解释为放行。RED gate 仍会校验原有的受控 envelope、来源提交、checker、观察值与用例覆盖。

历史模式 v2 把逐文件清单放入 `source-inputs.json` 旁证，并在主文件仅记录摘要与数量；详细断言保留在原始 Vitest JSON，主记录保存方法、状态与失败摘要。主文件继续遵守原有 512 KiB 读取上限。v1 历史模式按原有完整字段验证，不因格式升级放宽或篡改。

`next` 的 `red_evidence` 与 code-generation 报告明确展示补证模式及局限。补证只证明本次对历史版本的重放结果，不能证明测试曾在生产实现之前执行，不能恢复原始执行时间，也不能证明跨域联调、业务验收或 U8 全部代码完成。BASELINE `not_required` 仍表示没有 characterization 用例，不表示基线测试通过。

适用于 `tdd` RED 门禁。可执行业务行为必须由受控命令产生：

```json
{
  "phase": "RED",
  "status": "failed",
  "failure_class": "behavior",
  "failure_signature": "assertion failure summary",
  "compile_status": "passed",
  "environment_status": "passed",
  "tests_total": 1,
  "tests_failed": 1,
  "traceability_complete": true,
  "uc_mapping": [{"use_case": "UC-D-001", "test_methods": ["Test#behavior"]}]
}
```

命令必须退出码为 1，并输出上述 JSON 观察对象。命令找不到、编译失败、环境失败、测试通过、失败分类不是 `behavior` 或缺少 UC-D 映射都会阻断。无业务行为时只能消费 I13 的 `not_applicable` 证据，不得手写 RED 豁免。

RED 只覆盖新行为：`uc_mapping` 必须恰好覆盖 I13 `ucd_modes` 中全部 `tdd_mode: new` 的 UC-D（缺 `ucd_modes` 的旧 I13 视为全部 `new`），不得包含 `characterization` UC-D——存量行为由 `baseline-test-evidence` 覆盖（见 `baseline-test-evidence.md`）。I13 没有 `new` UC-D 时（如全部为 characterization 的重构），producer 写 `status: "not_required"`、`ucd_ids: []`，不执行命令；有 `new` UC-D 时 `not_required` 被拒。

按单元收敛（4.8.0）：I13 有 `ucd_units`（UC-D 声明了 `unit_refs`）时，unit 实例只覆盖 `unit_refs` 指向本单元的 `new` UC-D，producer 在证据中写入该子集 `ucd_ids`；本单元没有 `new` UC-D 时写 `not_required`。本单元子集为空（不被任何 `unit_refs` 指向）时，RED / BASELINE / GREEN 都必须走 `unit-manifest.json` 中该 unit 的 `ucd_exemption`：producer 先执行其 `validation_command`（退出 0），再写 `not_required` 并记录 `ucd_exemption` 与 `exemption_validation_execution`，`checker.argv_digest` 为 `SHA-256(JSON.stringify(["RED-ucd-exemption", <命令 argv 摘要>]))`；没有豁免或命令失败时拒绝。没有 `ucd_units` 时行为与 4.7.1 相同。

收敛过滤（MARS-271）：RED 迭代可用 `evidence run --sensor red-test-evidence --test-filter <expr>` 让测试命令只跑受影响用例——producer 校验后通过环境变量 `AIDLC_TEST_FILTER` 传给受控命令（argv 绑定命令清单，不做修改），并在证据 payload 写入 `test_filter`。过滤仅允许用于 RED：GREEN 与 BASELINE 证据携带 `test_filter` 会被门禁拒绝（最终证据必须全量跑）。

受控 producer 写入的证据中，`checker` 是内置检查（`id: builtin:red-test-evidence`，`exit_code: 0`，表示观察对象已通过校验）；被观察的测试命令单独记录在 `observed_command`（`id`、`phase`、`argv_digest`、`exit_code: 1`）。门禁要求两者同时存在且一致，缺任一项或 `observed_command.exit_code` 不为 1 都会拒绝。

门禁还会把证据绑定到本阶段的命令清单：按与 producer 相同的查找顺序（`.aidlc/commands/<stage>.json` → `.aidlc/evidence-commands.json`，不考虑 `--config`）解析并做 stage 锁定校验，取其中唯一一条 `role: red` 命令，要求 `observed_command.argv_digest` 等于该命令 `argv` 的 SHA-256（`JSON.stringify(argv)`）、`observed_command.id` 等于命令 id，且 `checker.argv_digest` 等于 `SHA-256(JSON.stringify(["RED-observation", observed_command.argv_digest]))`。命令清单缺失、无法解析、stage 不匹配或不是恰好一条 red 命令时一律拒绝。producer 也会提前拒绝指向其他清单的 `--config`：`evidence run --sensor red-test-evidence`（或 `--all-sensors`）的 `--config` 与默认查找结果不是同一文件时直接报错，不执行命令、不写证据（not_applicable 分支同样适用）；指向同一文件的不同写法允许。

`code-generation` 完成时会复验本单元的 RED 与 BASELINE 证据：两者必然产生于实现之前的代码树，因此此处只容忍工作区漂移（`dirty`、`worktree_digest`，split 布局为 `scope_digest`；格式仍须合法），producer、checker、`observed_command`（含命令清单绑定）与观察内容的校验不变。`source_revision.commit` 仍须是当前 HEAD 或其祖先（`git merge-base --is-ancestor`，提交 id 须为 40 或 64 位十六进制）；提交不存在、不是祖先或 git 不可用时拒绝。非 git 项目（`commit: unavailable`）要求记录值与当前值完全相同。
