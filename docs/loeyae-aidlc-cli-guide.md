# Loeyae AI-DLC CLI 使用手册

## 新 workflow

所有新流程都从用户明确的工作描述开始：

```bash
loeyae-aidlc orchestrate next \
  --scope <feature|enterprise|mvp|classic|express|workshop|bugfix|refactor> \
  --work "<明确的工作描述>"
```

新流程控制面只使用 Markdown：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

当前 workflow 只使用 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md` 管理路由、报告和成员分工。

### scope 与阶段集合

`execution: ALWAYS` 的阶段对所有 scope 生效，其余阶段按其 `scopes` 声明生效（4.13.0 实测，单模块默认路由）。单模块下阶段数等于实例数；multi-module 下 module/unit 轴阶段按模块数和单元数展开为多个实例：

| scope | 阶段数（单模块下等于实例数） | 说明 |
|------|------|------|
| `feature` / `enterprise` / `mvp` | 39 | 完整 Inception → Construction → 条件 Operations |
| `classic` | 36 | 同上，不含 Operations 尾段 |
| `express` / `workshop` / `bugfix` / `refactor` | 8 | 轻量链路 |

Core 不再内置任何 Loeyae 专属 stage。外部 Loeyae Provider 通过通用 `code-generation` Hook 注入（`implementation-validation` capability）：未安装 Provider 时行为不变，轻量 scope 实例数为 8。

- `prd-generation` 只在完整 scope 初始化时加 `--with-prd` 才进入。
- `workspace-detection` 的 `single-module` / `multi-module` 选择只出现在 feature、enterprise、mvp、classic。
- `bugfix` 额外要求至少一个 `tdd_mode: new` 的 UC-D 复现缺陷；`refactor` 使用 characterization 基线；`express/workshop` 使用 `change_ref` 锚点。

## 继续与报告

```bash
# 获取当前 directive
loeyae-aidlc orchestrate next

# 完成普通阶段
loeyae-aidlc orchestrate report --stage <slug> --result completed

# 完成 instruction-only 阶段
loeyae-aidlc orchestrate report \
  --stage <slug> --result completed --instruction-ack <slug>

# 批准应用设计或部署决策
loeyae-aidlc orchestrate report \
  --stage <slug> --result approved --user-input Approve

# 暂停或恢复当前 Markdown workflow
loeyae-aidlc orchestrate park
loeyae-aidlc orchestrate next --resume

# 查看进度（只读）
loeyae-aidlc orchestrate next --status

# 归档已 parked/done 的 workflow 及其证据到 aidlc/archive/，为新工作腾出控制面
loeyae-aidlc orchestrate archive [--reason <text>]

# 引擎升级后列出缺失证据的已完成阶段（只读）
loeyae-aidlc orchestrate upgrade --dry-run [--module <module-id>]

# 查看或记录图表格式（默认 mermaid；切换为 svg 须带用户原话）
loeyae-aidlc orchestrate diagram-format [--set <mermaid|svg> --user-input "<用户原话>"]
```

已有 workflow 时 `--scope/--work` 不会覆盖它：运行中的先 `park` 再 `archive`，已完成的直接 `archive`。

每个 `run-stage` directive 和成功 report 都有 `handoff_prompt`。Agent 必须原样展示该提示词，提示中包含工作目标、当前阶段、当前单元、产物、review/build/test 和下一步动作。

`run-stage` 还会返回只读的 `rule_load_plan`：`load_now` 是当前阶段及其已选依赖应加载的阶段规则，`deferred` 是已选但应在后续阶段交接时再加载的规则，`selected` 是完整的执行器选中集合。可用 `loeyae-aidlc orchestrate state rules [--module <id>]` 查看不带当前目标的计划。该计划只减少交接上下文，不会跳过阶段、审批、`requires`、产物、sensor、evidence 或 Provider gate；这些 engine gate 始终具有最终约束力。

`loeyae-aidlc orchestrate state measurements [--module <id>]` 输出只读的 `execution_profile_measurements`：它对照历史 standard 选择结果，展示当前 profile 的选中/省略阶段、mandatory 规则保留情况和 legacy 迁移边界。该命令不写入 global 或 module WorkflowState，不能授予任何 report、sensor、evidence、approval 或 release gate pass；在 split 布局指定 `--module` 时，module 视图继承 global `execution_profile`。

## 项目级 Provider 与 Loeyae 迁移

安装时可显式限制 module/unit/stage/capability binding。外部 Loeyae Provider 挂到通用 `code-generation` Hook：

```bash
loeyae-aidlc provider add <git-url> --ref <tag-or-commit> \
  --subdir providers/loeyae-boot \
  --id framework.java-loeyae-boot --instance loeyae-boot \
  --stage code-generation --capability implementation-validation
```

当前 directive 给出 `provider_context.plan.path` 与 `provider_actions[].plan_node_id` 后：

```bash
loeyae-aidlc provider run --plan <plan-id-or-path> --node <node-id> \
  --input source=<project-relative-source-path>
loeyae-aidlc provider gate --plan <plan-id-or-path> --evidence <evidence-id>
loeyae-aidlc orchestrate report --stage code-generation --result completed \
  --gate-decision <gate-id>
```

`provider disable` 的语义：被停用实例不参与 Provider plan 解析（其绑定能力离开默认能力表达式，不再产生 blocked node），绑定本身保留在项目配置中，`provider status` 会列出停用实例仍绑定的能力；`provider enable` 无需重装即恢复解析。某能力唯一的 Provider 被停用时该能力从默认表达式中消失，`provider status` 的提示用于防止能力静默缺失。

兼容窗口：`kind: knowledge` 且未声明 `extensions["aidlc.knowledge"]`、但声明了已识别外部源协议（`aidlc.context-source` / `aidlc.design-resource` / `aidlc.ui-read-source`）的 Provider 仍可安装（resolver 将其按外部源处理，无知识确认动作）；安装审计与 `provider status` 会记录 deprecation 警告。既无 `aidlc.knowledge` 也无已识别协议的 knowledge manifest 仍被拒收。

Profile selector 决定是否选中该 Provider；选中时该 `implementation-validation` 动作为 required，orchestrate 在未携带通用 GateDecision 时拒绝推进。Core 不存在 compatibility/legacy/shadow/enforce 模式，也没有 Loeyae 专属 stage。完整 Profile、scope、升级和发布清单见 `docs/loeyae-boot-provider-migration.md`。

## 基线与 lineage

```bash
# 查看工作流基线（新 workflow 初始化时自动记录当前 HEAD，characterization UC-D 的 BASELINE 依赖它）
loeyae-aidlc orchestrate baseline
# 仅 4.6 之前创建、没有基线的 workflow 需要登记；--replace 更正尚未使用的基线
loeyae-aidlc orchestrate baseline --set <commit> --user-input Approve --reason <text> [--replace --expect <commit>] [--dry-run]

# 多单元依次修改同一批 code ref：推进到已完成单元的 GREEN commit
loeyae-aidlc orchestrate baseline --advance <commit> --expect <当前基线> --user-input Approve --reason <text>

# split 布局下接管已按旧流程提交的模块实现
loeyae-aidlc orchestrate baseline --adopt <commit> --module <id> --user-input Approve --approval-ref "<批准记录>" --reason <text>

# lineage 检查与裁决
loeyae-aidlc orchestrate state verify
loeyae-aidlc orchestrate state retire --lineage <id> --user-input Approve --reason <text>
loeyae-aidlc orchestrate state adopt --module <id> --from <commit> --user-input Approve --reason <text>
```

`--set` / `--replace` 的提交限制：

- 目标 commit 必须存在且是 HEAD 或其祖先，否则报 `is not the current HEAD or one of its ancestors` / `does not exist in this repository`。
- 浅克隆本身可以使用（可正常初始化 workflow、`--set` 当前 HEAD）；只有目标 commit 落在被截断的历史中、无法证明祖先关系时才拒绝，报 `the repository is a shallow clone, so its truncated history cannot prove ancestry`，执行 `git fetch --unshallow` 后重试即可。
- 目标 commit 已包含本 workflow 的状态文件（`aidlc/active/aidlc-state.md` 且 Workflow ID 相同）时拒绝，报 `already contains this workflow's state file`；该检查与 committer date 无关，回填提交日期也无法绕过。
- 目标 commit 必须早于 workflow 启动时间（按 commit 自报的 committer date 判断）。

因此 `--replace` 只能把基线更正为启动前的 commit，不能改到启动后的提交，否则报 `the baseline must predate the workflow`；启动后产生的提交只能通过 `--advance` 推进到已完成单元的 GREEN commit。已推进过的基线一律拒绝 `--replace`。

嵌套仓库的 `--repo <path>=<commit>` / `--expect-repo` 用法见 `loeyae-aidlc help` 与 README；多仓库与临时 worktree 的初始化、恢复及证据边界见 `docs/multi-repo-worktree-recovery.md`。

## 团队 unit 协作

```bash
loeyae-aidlc unit list
loeyae-aidlc unit select \
  --module <module-id> \
  --unit <unit-id> \
  --member <name> \
  --branch <branch> \
  [--note <text>] [--replace]
```

成员选择是协作声明，不是锁。重复选择会显示当前成员；团队可协商后使用 `--replace` 更新记录。

## 团队 module 协作

模块轴在 `unit select` 之上提供并发认领：

```bash
loeyae-aidlc module list
loeyae-aidlc module select --module <module-id> --owner <member/device/tool> [--branch <branch>] [--worktree <path>]
loeyae-aidlc orchestrate next --claim --module <module-id> --owner <member/device/tool>
loeyae-aidlc orchestrate report --stage <slug> --module <module-id> --owner <member/device/tool> --result completed
loeyae-aidlc module heartbeat --stage-instance <stage@module:id> --owner <member/device/tool>
loeyae-aidlc module migrate [--owner <legacy-owner>]
```

`next --claim` 只认领当前模块的就绪 module stage instance；claim 写入 `module_id`、`stage_instance`、`owner`、branch/worktree、`claimed_at`、heartbeat 和过期时间。有效 claim 不会被另一端重复认领，超时后可重新领取。模块 report 只结算自己的 claim，`application-design` 等 blocking approval 仍按实例要求真人 `--user-input Approve`。

写入 `next`/`report` 前需要显式会话绑定：`module inspect` 读 claim 与 `expected` 令牌，`module bind`（同会话续期）/ `module transfer --human-instruction-ref`（换会话/换人接手）返回的 binding JSON 以 `AIDLC_SESSION_BINDING` 只传给本会话子命令。claim TTL 30 分钟。会话中断、claim 过期、worktree 恢复的完整路径与演练见 `docs/multi-repo-worktree-recovery.md`。

`product-contracts.md` 与 `runtime-dependencies.md` 中明确的模块关系会作为跨模块准入依赖；消费方会显示等待的提供方阶段。`runtime summary` 同时展示所有活动实例、owner、就绪实例和依赖阻塞。

## 按模块独立工作流（4.3.0）

单工作流里一个模块被门禁卡住会拖住其他模块。`module-division` 完成后可以拆分为独立工作流：

```bash
# 预览：各工作流归属、状态，以及哪些旧证据已失配（不写入）
loeyae-aidlc orchestrate split --from <workflow-id 或其前 8 位以上> --dry-run
loeyae-aidlc orchestrate split --from <workflow-id>

loeyae-aidlc orchestrate next --module <module-id>            # 只推进该模块
loeyae-aidlc orchestrate report --stage <slug> --module <module-id> [--unit <unit-id>] --result completed
loeyae-aidlc orchestrate park --module <module-id>            # 只暂停该模块；next --module <id> --resume 恢复
loeyae-aidlc orchestrate next                                  # 先 global，再第一个可推进的模块，最后 integration
loeyae-aidlc orchestrate next --status                         # 所有工作流与集成屏障概览
loeyae-aidlc runtime doctor --module <module-id>
```

拆分后的布局：

| 文件 | 承载 |
|------|------|
| `aidlc/active/aidlc-state.md` | global：workspace-detection 至 state-template 等前置 project 阶段（Workflow ID 不变） |
| `aidlc/active/modules/<id>/aidlc-state.md` | 该模块全部 module/unit 阶段实例，独立 Workflow ID、revision、status 和 audit |
| `aidlc/active/integration/aidlc-state.md` | build-and-test 起的尾部 project 阶段（跨模块集成） |
| `aidlc/active/registry.md` | 模块到工作流的身份映射（权威），以及状态、跨模块依赖、共享契约和集成屏障投影（引擎刷新，勿手改） |

- 未拆分的项目行为与 4.2.x 一致；旧布局下首次执行 `next --module <id>`（不带 `--claim`）会自动拆分。
- 跨模块依赖仍以 `product-contracts.md` / `runtime-dependencies.md` 为唯一来源，registry 只做投影。共享契约的消费者在“消费者状态”表中标为 `已验证`/`verified` 后，才算 verified。
- integration 的准入条件：所有模块的 construction 已完成，且所有共享契约都已 verified；缺任何一项都保持屏障。

### 证据作用域与修复

拆分后新产出的证据会记录 `source_revision.scope`（`module:<id>` / `global`）和 `scope_digest`，按作用域内的内容校验，commit 只作溯源。其他模块的 `docs/aidlc/modules/<other>/`、module-manifest 中可选的 `paths`（模块独占代码根），以及 integration 写入的 `docs/aidlc/construction/`、`docs/aidlc/operation/`，都不会使本模块证据失配。本模块自身产物变化仍会使其失配。

`split` 会把当前仍有效的旧证据重锚定到对应作用域；已失配的旧证据列入 stale 清单，修复方式如下：

```bash
loeyae-aidlc evidence run --stage <slug> --module <module-id> [--unit <unit-id>] --refresh
loeyae-aidlc orchestrate report --stage <slug> --module <module-id> --result completed   # re-attest，模块 parked 时也可执行
```

对已完成实例执行 report 属于 re-attest：重新跑 consumes/produces/sensor 并记录 `reattested` 历史，不改变进度。

`check --sensor <name> --module <id>` 在模块上下文中运行 checker；其中 diagram-contract 只扫描该模块自己的 `.diagram.json`。不带 `--module` 时保持全仓扫描。

## Worktree 与 review

```bash
# 共享基线缓存：在当前干净 HEAD 全量 checkout 一次（<project>-aidlc-warm），prepare 硬链接复用
loeyae-aidlc worktree warmup

loeyae-aidlc worktree prepare \
  --instance <stage-instance> \
  --member <name> \
  --path <absolute-worktree-path> \
  [--branch aidlc-light/<safe-name>]

loeyae-aidlc worktree merge-plan \
  --instance <stage-instance> \
  --member <name> \
  --path <absolute-worktree-path> \
  --review-evidence <worktree-relative-review-json>

# verify 与 merge-plan 同一实现、同一批 flag：只验证不输出建议 merge 命令之外的额外动作
loeyae-aidlc worktree verify \
  --instance <stage-instance> \
  --member <name> \
  --path <absolute-worktree-path> \
  --review-evidence <worktree-relative-review-json>
```

`prepare` 创建成员选择 unit 对应的 branch/worktree，并写入 Markdown metadata。`verify` / `merge-plan` 验证已提交变更、review 的 `files_reviewed` 覆盖、branch/base 一致性，并输出建议 merge 命令（`authorized: false`）。涉及嵌套仓的实例会被 `prepare` / `merge-plan` 拒绝（`cannot isolate`）。warmup 缓存复用、worktree 中断恢复与证据失配重判见 `docs/multi-repo-worktree-recovery.md`。

不会自动 merge、push、删除 worktree、修改工作流完成状态或代替仓库权限持有者执行操作。

## Evidence、诊断与溯源

```bash
# 生成当前阶段声明的所有 semantic sensor Evidence；每个 sensor 写入 canonical evidence_path
loeyae-aidlc evidence run --stage <stage> --all-sensors

loeyae-aidlc runtime summary
loeyae-aidlc runtime doctor
loeyae-aidlc attest resolve --base origin/main --head HEAD
```

`evidence run --stage <stage> --all-sensors` 会读取编译后的 `stage-graph.json`，按阶段声明顺序依次运行 semantic checker；省略 `--sensor` 时，非 `build-and-test` 阶段也采用同一行为。`build-and-test` 使用真实命令 allowlist；build/check 默认必需，原生 Node 的来源可核验角色例外见 `core/knowledge/protocols/common-c8-role-applicability.md`（`role_applicability` + 包内批准政策，按全部模块聚合）。Node `--test --test-reporter=tap` 完整汇总可直接产证，业务测试仍须非零通过且零失败。`orchestrate report` 发现缺失 semantic Evidence 时会自动触发该受控产出器，失败仍由 report 门禁阻断。

### Evidence 是 producer 生成的，Agent 不能手写

每个 semantic sensor 的 Evidence 都由 **确定性 producer** 扫描真实产物机械生成，写到 canonical `evidence_path`（`.aidlc/evidence/<stage>/[<module>/[<unit>/]]<sensor>.json`）。以追溯矩阵为例（sensor `traceability-matrix`）：producer 扫描 `requirements.md` 的 `REQ-xxx` 及其 `track:[backend/frontend/data/infra/nfr/doc-only]` 标签，再按阶段到 `user-stories.md`、`application-design`、功能设计、UC-D、代码源文件、测试里逐层比对该 REQ / `@ReqId` 是否出现，算出 `broken_rows`。给同样的产物永远输出同样的矩阵——这是它能当客观证据的前提。

**Agent 手写证据 = 伪造证据。** 受控证据带防伪印章：`producer.name=loeyae-aidlc-evidence`、`producer.mode=controlled`、`checker.argv_digest`（SHA-256）、`source_revision.worktree_digest`（与当前 git HEAD/worktree 绑定）。手写 JSON 缺印章或印章对不上当前提交，`report` / `next` 会当场拒绝。若看到引擎提示“checkSensors 与 traceability-matrix.json：须由引擎受控 producer 生成，Agent 手写即伪造证据”，那是正常的边界提示，不是需要人工补写矩阵的错误。证据摘要绑定产出它的那棵树、换树失配后的重判路径与"可复制 vs 必须重建/重判"边界表见 `docs/multi-repo-worktree-recovery.md`。

### checkSensors 何时触发

`checkSensors`（引擎内的门禁裁判）不需你手动调用，在两个时机自动运行：

1. `orchestrate report --result completed` 时，先自动为缺失的 semantic sensor 跑 producer（等价 `evidence run --all-sensors`），再校验证据；任一 sensor 不绿则拒绝完成。
2. `orchestrate next` 推进下一步时，复验上游已完成阶段的门禁是否**仍然**满足，防止上游产物事后被改坏。

### 门禁失败处置

- **证据缺失 / provenance 不匹配** → 重新 `orchestrate report`（或显式 `evidence run --stage <stage> --all-sensors`）让 producer 重新生成。**不要手写证据 JSON。**
- **追溯矩阵断链 `REQ-xxx: BROKEN@<layer>`** → 该需求在某层真的丢了（如活到故事层却在设计层断）。去补那一层产物：让对应文档/代码里出现该 REQ 标记，再 `report`。矩阵只保证结构覆盖（无需求悄悄消失），内容是否忠实仍需 review / 测试。
- **未迁移旧项目**（`requirements.md` 无 `REQ-xxx` 或缺 `track` 标签）→ 记 `MIGRATION_REQUIRED`，降级放行并输出 `missing_track` 清单，不硬阻断。

确定性文档/源码检查及历史测试/审查观察在来源、命令、范围和基线世代仍匹配时，不因纯时间失效；`next` 的 verify 仍需门禁复验，并非免检放行。恢复状态与未知 sensor 默认 24h，外部依赖可用显式 freshness 窗口收紧；未来或畸形时间始终拒绝。完整分类及替代检查的模块/单元输入、环境声明见 `common-quality-gates.md`。

### Evidence reuse plan

`loeyae-aidlc orchestrate state evidence [--module <id>]` 输出只读 `evidence_reuse_plan`；当前 stage 的 `next` directive 也会附带同一类计划。`reuse` 是可读取的既有证据，`verify` 仍必须正常复验 mandatory gate，`revalidate` 必须重新产证。该计划不授予 gate pass、不会写入状态或 evidence。对 handoff，它只接受当前 stage instance 的规范路径，并校验受控 producer、严格 ISO 时间、module/unit/instance、source revision 与 checker；任何不匹配都转为 `revalidate`。

`diagram-contract` 的 source-only 结果在 source checker、独立 expected contract、generator closure 和几何门禁均通过时可以写成 `final_status: "STATIC_PASS"`，并足以通过不要求目标渲染的 report 门禁；只有 stage/Provider Request 将 `target_operation_required` 设为 `true`（`preview` 或 `render`）时，才必须执行 Provider 的 normal/fit/zoom 证据并达到 `PASS`。Provider 不可用只能保持 `UNVERIFIED`/`NEEDS_CAPABILITY`，不能伪造截图或视觉证据。

`v3->v4 choice reconciliation` 会比较模块 `cross-validation-report.md` 的 `prd_route`、`ui_route` 与当前 Markdown workflow 的 `selected_optional_stages`/UI history；不一致时明确阻断并要求只对齐机器摘要或当前选择，不会静默修改业务内容。

轻量模式的 Evidence 仍要求 producer、source revision、checker 或构建/测试结果，但不要求设备签名 envelope。`attest` 会保守报告无签名 Evidence 的可验证边界，不会把它提升为强授权证明。

## 受限 extension

```bash
loeyae-aidlc extension validate /absolute/path/to/extension
loeyae-aidlc extension compose /absolute/path/to/extension --project /absolute/path/to/project
loeyae-aidlc extension status <name> --project /absolute/path/to/project
```

extension 只能提供 namespaced Markdown 内容、advisory sensor 描述和 additive metadata。它不能执行任意脚本、改变 workflow state、审批、unit 选择、review/build/test 门禁或 merge 权限。

## 平台、导出与帮助

```bash
loeyae-aidlc install
loeyae-aidlc install --all
loeyae-aidlc install --harness kiro-ide --project /absolute/path/to/project
loeyae-aidlc uninstall --all

loeyae-aidlc export --help
loeyae-aidlc docx --help
loeyae-aidlc graph validate
loeyae-aidlc version
```

Stop Hook 只观察 Markdown workflow 是否仍在运行并提示继续；不会自动 report、生成签名或读取旧 JSON workflow。
