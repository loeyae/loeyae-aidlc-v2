---
id: green-test-evidence
name: Controlled GREEN Test Evidence
description: Verifies that code generation consumes RED evidence and the target tests pass with complete UC-D traceability.
evidence_path: .aidlc/evidence/<stage-slug>/green-test-evidence.json
---

# green-test-evidence Sensor

历史 RED/BASELINE 漏登恢复不改变 GREEN 的测试与来源校验。登记审批前须有本单元有效的受控 GREEN；审批绑定其完整文件 SHA-256。阶段级 `evidence run --stage code-generation` 会在验证合法漏登记录后复用该 GREEN，不重新生成时间戳或 execution ID。显式 `--sensor green-test-evidence` 仍执行原受控测试命令，新字节使对应审批失效，须分别重新审阅并登记。完整恢复顺序见 [历史 TDD 协议](../knowledge/protocols/historical-red-replay.md)。

适用于 `code-generation` GREEN 门禁。可执行业务行为必须由受控命令产生：

```json
{
  "phase": "GREEN",
  "status": "passed",
  "compile_status": "passed",
  "environment_status": "passed",
  "tests_total": 1,
  "tests_failed": 0,
  "traceability_complete": true,
  "uc_mapping": [{"use_case": "UC-D-001", "test_methods": ["Test#behavior"]}]
}
```

GREEN 命令必须退出码为 0，且测试计数为非零/零失败。代码审查和构建测试继续消费该证据并重新验证 UC-D 覆盖。无业务行为时只能消费 I13 的 `not_applicable` 证据和其中声明的确定性替代验证。

GREEN 观察本单元改动后的全部适用行为：I13 为 `required` 时，`uc_mapping` 必须恰好覆盖下述单元范围的全部 UC-D——`tdd_mode: new`（RED→GREEN）与 `characterization`（BASELINE→GREEN）都要包含，漏写、多写或重复都会被拒。

按单元收敛：I13 有 `ucd_units`（显式或唯一需求归属推导）时，`uc_mapping` 必须恰好覆盖其中归属本单元的全部 UC-D（报错 `GREEN uc_mapping must cover every UC-D of unit <id>`）；缺少该字段的旧证据保留模块全集兼容含义。GREEN 的 `not_required` 只允许出现在本单元子集为空且 `ucd_exemption` 的 `validation_command` 已执行通过的情况（见 `red-test-evidence.md`）；子集非空时一律拒绝。模块完整性由 build-and-test 的 `test-quality` 对账和集成屏障 `ucd-coverage:<module>` 保证：每个 UC-D 都必须出现在其 `ucd_units` 中每个 unit 的 GREEN 里。

GREEN 证据必须完成当前单元批准的验证矩阵（MARS-271），不因“全量”字样自动扩成全仓库测试。只有 RED 收敛迭代允许 `--test-filter` 过滤（见 `red-test-evidence.md`），GREEN 与 BASELINE 证据携带 `test_filter` 一律被门禁拒绝。

新的 GREEN 观察记录 `execution_input_binding`，沿用本单元的来源范围，仅排除规范命名的下游审查记录（当前 `code-review.md`，以及为旧工作流兼容保留的 `audit.md`、`audit/test-case-reconciliation.md` 和 `audit/{unit-id}.md`；这些历史路径不是新增产物要求）。在 test-quality 复用映射时，该摘要仍匹配才能容忍这些报告带来的普通来源摘要变化；显式声明为 shared/contract 的输入优先保持绑定。源码、测试、需求、设计与命令输入变化仍拒绝；无此摘要的旧 GREEN 不会自动获得漂移豁免。C8 对已完成单元验证其原历史基线，不要求已完成单元追随后续单元合法推进的 epoch 重跑。

新生成的绑定采用 version `2`：额外规范化当前单元代码生成计划中真实 Markdown 任务列表的勾选标记，保留全部正文、条目、空白、前置数据、代码示例及 HTML。未闭合结构保留原字节；其他 Markdown 不获得此投影。命令显式输入仍由 `phase_input_binding` 独立逐文件核验，声明为业务输入的文件不能借进度投影绕过验证。version `1` 使用原执行范围重新核验，不重签旧 GREEN；语义审查证据需要更新时仅刷新相应审查，不隐式执行 GREEN 命令。

标准位置 `inception/artifact-review.json` 的一致性收据可能间接引用这些报告。只有格式和 workflow/module 身份有效时，执行摘要按同一范围规则投影其 `inputs`，避免收据把已排除的报告或已证明私有的兄弟单元输入重新引入；结论、审阅人、未解决问题及其他字段完整保留。共享/契约输入优先，收据自身被声明为共享输入时保留原始绑定；无完整单元输入归属时仍采用保守范围。非法收据保留原绑定，符号链接或越界拒绝；实际质量门禁照常独立核验收据。

上游模块规划/I13 也按自身范围投影同一收据，避免只新增下游报告就要求重新派生 UC-D。GREEN 的执行摘要复验沿用原 `source_revision` 记录的嵌套仓库结构；旧记录没有 `repos` 时不会因后来登记嵌套仓库而被静默改用新算法。

替代验证使用真实项目命令的环境。工具自动开启的进度标记和语义检查子进程的路由上下文不应使刚生成的 GREEN 立即失效；用户实际设置的环境变量、当前基线和输入仍须匹配。真正的输入变化只重新执行受影响的批准检查，不通过新增测试修复观察元数据。

分级映射准入（MARS-271）：I13 声明 `mapping_deferred` 的 UC-D 暂不进入 GREEN 覆盖 universe，但 GREEN 证据必须以 `mapping_debt: [{id, reason}]` 恰好申报同一批暂缓用例——漏报、多报都会被拒；映射债在门禁报告与 `test-quality` 的 `mapping_debt` 中独立可见，不得静默消失。P0 与 `contract`/`api` 类 UC-D 禁止暂缓（见 `test-case-derivation.md`）。

受控证据中 `checker` 为内置检查（`id: builtin:green-test-evidence`，`exit_code: 0`），被观察的测试命令记录在 `observed_command`（`exit_code: 0`）；缺少 `observed_command` 或其退出码不为 0 时门禁拒绝。

与 RED 相同，门禁把 `observed_command.argv_digest` / `id` 绑定到 `code-generation` 命令清单（`.aidlc/commands/code-generation.json` → `.aidlc/evidence-commands.json`，stage 锁定）中唯一一条 `role: green` 命令，并要求 `checker.argv_digest` 等于 `SHA-256(JSON.stringify(["GREEN-observation", observed_command.argv_digest]))`；命令清单缺失、无法解析、stage 不匹配或不是恰好一条 green 命令时拒绝。producer 会拒绝指向其他清单的 `--config`（与默认查找结果不是同一文件时直接报错，不执行命令、不写证据）。

`code-generation` 完成时复验 RED 与 BASELINE 证据（只容忍工作区漂移，见 `red-test-evidence.md`），读取的是 `tdd` 阶段的命令清单。多阶段共用 `.aidlc/evidence-commands.json` 时，改写为 `code-generation` 后 RED 复验会因 stage 不匹配被拒，请改用 `.aidlc/commands/tdd.json` 与 `.aidlc/commands/code-generation.json`。
