---
id: red-test-evidence
name: Controlled RED Test Evidence
description: Verifies that tests exist before GREEN and fail because the target behavior is not implemented.
evidence_path: .aidlc/evidence/<stage-slug>/red-test-evidence.json
---

# red-test-evidence Sensor

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

受控 producer 写入的证据中，`checker` 是内置检查（`id: builtin:red-test-evidence`，`exit_code: 0`，表示观察对象已通过校验）；被观察的测试命令单独记录在 `observed_command`（`id`、`phase`、`argv_digest`、`exit_code: 1`）。门禁要求两者同时存在且一致，缺任一项或 `observed_command.exit_code` 不为 1 都会拒绝。

门禁还会把证据绑定到本阶段的命令清单：按与 producer 相同的查找顺序（`.aidlc/commands/<stage>.json` → `.aidlc/evidence-commands.json`，不考虑 `--config`）解析并做 stage 锁定校验，取其中唯一一条 `role: red` 命令，要求 `observed_command.argv_digest` 等于该命令 `argv` 的 SHA-256（`JSON.stringify(argv)`）、`observed_command.id` 等于命令 id，且 `checker.argv_digest` 等于 `SHA-256(JSON.stringify(["RED-observation", observed_command.argv_digest]))`。命令清单缺失、无法解析、stage 不匹配或不是恰好一条 red 命令时一律拒绝。producer 也会提前拒绝指向其他清单的 `--config`：`evidence run --sensor red-test-evidence`（或 `--all-sensors`）的 `--config` 与默认查找结果不是同一文件时直接报错，不执行命令、不写证据（not_applicable 分支同样适用）；指向同一文件的不同写法允许。

`code-generation` 完成时会复验本单元的 RED 与 BASELINE 证据：两者必然产生于实现之前的代码树，因此此处只容忍工作区漂移（`dirty`、`worktree_digest`，split 布局为 `scope_digest`；格式仍须合法），producer、checker、`observed_command`（含命令清单绑定）与观察内容的校验不变。`source_revision.commit` 仍须是当前 HEAD 或其祖先（`git merge-base --is-ancestor`，提交 id 须为 40 或 64 位十六进制）；提交不存在、不是祖先或 git 不可用时拒绝。非 git 项目（`commit: unavailable`）要求记录值与当前值完全相同。
