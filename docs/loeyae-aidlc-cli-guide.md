> 默认入口已调整：由宿主原生工具实施，可选 `loeyae-aidlc work` 读取 Git/选定输入；不要求 H5、claim 或逐阶段 report。见 [宿主执行协议](../core/knowledge/protocols/host-execution.md)。下文 orchestrate/autonomy 的强制规则仅用于显式选择的旧受管兼容路径。

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

单工作流使用 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md` 管理状态和审计；拆分后还使用 registry 及各模块、集成工作流的状态与领取记录。

### scope 与阶段集合

阶段选择由当前阶段图、scope、条件及已批准的选择决定；模块和单元轴会按实际数量展开，不能用固定阶段数判断项目进度。支持 `feature`、`enterprise`、`mvp`、`classic`、`express`、`workshop`、`bugfix` 和 `refactor`。使用 `orchestrate state plan` 查看当前计划，实际执行以 `orchestrate next` 返回的 directive 为准。

Core 不内置 Loeyae 专属 stage。外部 Loeyae Provider 可通过通用 `code-generation` Hook 注入 `implementation-validation` capability；未安装 Provider 时使用 Core 流程。

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

## 自主实施批次范围（P1-01）

P1-01 提供显式采用、范围校验和只读投影。未采用的 workflow 保持既有流程，即使设计文档已包含自主实施记录也不会自动启用。

```bash
# 读取已采用范围；未采用时 enabled=false，不扫描来源文件
loeyae-aidlc orchestrate autonomy inspect

# 使用刚读取的 global WorkflowState revision 校验拟采用的唯一批次
loeyae-aidlc orchestrate autonomy adopt --batch <batch-id> --expect <revision> --preview

# 持有当前 global 项目阶段的有效 session binding 后，正式采用
loeyae-aidlc orchestrate autonomy adopt --batch <batch-id> --expect <revision>
```

批次位于 `docs/aidlc/ideation/scenario-module-mapping.md` 或轻量流程的 `docs/aidlc/handoff.md`，只能有一处 batch 来源。来源为唯一闭合的 `aidlc-autonomy` JSON 围栏，顶层包含 `schema: "aidlc.autonomy-source/v1"` 与 `records`。完整字段见[契约 v1](aidlc-autonomous-contracts-v1.md)；采用前需已有真实模块和单元清单、场景/AC 定义、policy 与验证矩阵引用，不会自动生成这些输入。

正式采用将 `Autonomy Contract Version: 1` 和批次摘要写入既有 global Markdown state，并在既有 audit 中记录批次版本与范围摘要；不新建进度控制面。preview 和 inspect 均不领取阶段、不修改 state/audit。重复采用同一未变化批次为幂等读取；过期 revision、跨 workflow 引用、路径越界、摘要变化、上游依赖遗漏或下游消费者缺少验证/排除记录均拒绝。

采用后的 `next` 返回 `autonomy_scope` 并重新核验固定分母；CLI `report` 也先复核。修改已绑定的 AC、UI 引用、单元定义、基线或相关依赖后，必须先恢复来源或显式建立新 workflow，不能原地静默缩减范围。采用前须完成布局选择，采用后拒绝会改变 UnitRef 归属的 split。追加无关 decision 或调整 JSON 对象键顺序不会使未变化的 record 引用失效。

`validation_level=scope-only`、`execution_authorized=false`、`gates_evaluated=false` 描述范围投影本身的边界。consume 就绪性另由 dependencies 核验，空 UI 列表也不证明无 UI。当前分别通过 policy/decisions、grant、admission、dependencies、observe 和 batch 读取与执行后续受控能力；范围采用本身不启动无人值守交付，原阶段门禁继续生效。

## 自主策略与委托决策（P1-02）

采用批次后可以读取完整策略与决策投影：

```bash
loeyae-aidlc orchestrate autonomy policy
loeyae-aidlc orchestrate autonomy decisions
loeyae-aidlc orchestrate autonomy record --input proposal.json --expect <handoff-sha256|absent> --preview
loeyae-aidlc orchestrate autonomy record --input proposal.json --expect <handoff-sha256|absent>
```

`--expect` 取 decisions 返回的 handoff_digest；没有 handoff 时使用 absent。正式发布需要目标 implement 单元所属 workflow 的精确有效 binding，recorded_by 使用 `<owner>/<session_id>`。记录位于 handoff 的唯一 autonomy 段，不新建进度或审批状态。若 handoff 已被 raw-file 冻结，必须在新 workflow 的采用前使用段级引用，不能靠追加记录破坏基线。

策略与 proposal 的完整结构、合法类别、AuthorityRef、更新修订规则见[契约第 4.3 节](aidlc-autonomous-contracts-v1.md#43-p1-02-实现契约)。category/fallback 只允许既定空白的细化，不允许反转明确产品回答或删减 AC/UI；策略来源须由宿主核实为真实人类确认。已有 P1-01 的简化 policy 不能冒充完整策略，缺字段会拒绝，需要按显式新 workflow/策略基线迁移，不能绕过已冻结摘要。

next 的 handoff 和 state summary 会区分 pending 事后复核与缺失实施/验证。pending 本身不暂停实施；缺项或 change-requested/rejected 会显示阻断/返工原因，并阻止工程完成报告跳过这些缺项。引用齐全仅为 recorded-not-verified，继续执行原有受控质量门禁；本步不签发运行授权、不启动持久宿主循环。

## 单会话 ExecutionGrant（P1-03）

先完成批次采用、完整策略和 global 项目阶段的精确 session binding，再由真实操作人确认一次运行授权。request JSON 只描述请求，不是批准凭据；字段与枚举见[契约第 5.3 节](aidlc-autonomous-contracts-v1.md#53-p1-03-实现契约)。

```bash
# 只读校验与展示；需要已有执行会话 binding，不创建新的领取
loeyae-aidlc orchestrate autonomy grant issue --input grant-request.json --preview

# 真实操作终端确认完整请求摘要；不能用管道或 --user-input 代替
loeyae-aidlc orchestrate autonomy grant issue --input grant-request.json

# 当前会话传入实际 AIDLC_AUTONOMY_HOST 后，取得 ref
loeyae-aidlc orchestrate autonomy grant bind

# 将 ref 作为 AIDLC_EXECUTION_GRANT 仅传给本会话 Core 子进程
loeyae-aidlc orchestrate autonomy grant check --operation code-write --path src/orders/publish.ts
loeyae-aidlc orchestrate autonomy grant inspect

# 独立的实际操作输入撤销；无须依赖已过期的运行 grant
loeyae-aidlc orchestrate autonomy grant revoke --expect 1 --reason "停止本次运行"
```

Agent 不得代输终端确认，也不能把模拟 TTY、普通文档、Provider 输出或测试记录当作人类批准。当前实现的是可信操作端约定下的终端入口，不宣称终端证明人类身份或已接入 Codex 原生聊天回执。

bind 返回 `execution_grant.ref`，同时返回 current session_binding 与 host。每个新阶段仍需 inspect/bind 原生领取，更新 AIDLC_SESSION_BINDING；同一 owner/session 的 grant 不因此续期。新 session、host/config、越界模块/单元、过期或撤销均拒绝，P1 不自动继承、不替换或延长既有 grant。

state 中的 Execution Grant Version/引用只由受管签发激活；普通保存不能修改或移除。签名 grant/approval/revocation 在 `.aidlc/autonomy/grants/`；私钥与撤销锚点位于 Git common directory，不能复制进业务产物。删除撤销 JSON 不会使旧授权恢复。已提交的重复撤销返回原状态，不再要求批准。

宿主在真实工具副作用前检查具体操作及目标；Core 在状态、决策和证据发布时再次检查。提交/整合、push、受保护分支和部署各自独立。inspect 的 active 只描述签名记录和期限，不能代替具体 check、原有审批、P1-04 准入或功能/UI 门禁。并发与重试预算由后续宿主驱动落实，不能从配置字段推定已经执行。

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
# 先由各领取人 release 全部精确 claim，并清除维护子进程 binding
loeyae-aidlc orchestrate state maintenance-plan --module <id>
loeyae-aidlc orchestrate state adopt --module <id> --from <commit> --maintenance <maintenance_token> --user-input Approve --reason <text>
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
# 共享基线缓存：在当前干净 HEAD 全量 checkout 一次（<project>-aidlc-warm），prepare 用独立文件复制复用
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
# 从现有状态及证据引用生成只读摘要，不写文件、不重跑测试
loeyae-aidlc orchestrate state summary
loeyae-aidlc orchestrate state summary --module <id> --format markdown

# 生成当前阶段声明的所有 semantic sensor Evidence；每个 sensor 写入 canonical evidence_path
loeyae-aidlc evidence run --stage <stage> --all-sensors

loeyae-aidlc runtime summary
loeyae-aidlc runtime doctor
loeyae-aidlc attest resolve --base origin/main --head HEAD
```

`state summary` 默认输出 JSON；`--format markdown` 仅改变展示格式。`verification: not_checked` 表示本次查看没有重新验证门禁，文件存在不等于证据当前有效。只有完成命令的受控验证才能给出交付结论。默认无需保存摘要；明确要求导出时可保存到 `.aidlc/views/`。Core 自动维护 state/audit，单元只保留一份人工 `code-review.md`，无需手抄阶段计数、测试统计或另写重复实施/构建汇总。

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
loeyae-aidlc install --harness deepseek
loeyae-aidlc install --harness deepseek --project /absolute/path/to/project
loeyae-aidlc uninstall --all

loeyae-aidlc export --help
loeyae-aidlc docx --help
loeyae-aidlc graph validate
loeyae-aidlc version
```

Stop Hook 只观察 Markdown workflow 是否仍在运行并提示继续；不会自动 report、生成签名或读取旧 JSON workflow。

DeepSeek Harness（`deepseek`）使用原生 Skill：用户级安装遵循 `DSH_HOME`（默认 `~/.dsh`），项目级安装写入 `<项目>/.dsh/skills/loeyae-aidlc/`。安装器通过 PATH 中的 `dsh` 自动探测；此适配不注册 Stop Hook，启动与续作使用显式 session binding。详见[安装指南](loeyae-aidlc-v2-installation.md#deepseek-harness)。

## 自主批次多单元依赖（P1-05）

显式采用后可运行 orchestrate autonomy dependencies inspect，只读显示能力版本、consume/verify、分阶段依赖、共享输入/写范围与 dependency_frontier。消费检查调用 orchestrate autonomy dependencies check --checkpoint <实际 stage 或矩阵 check ID>，要求当前有效 grant、精确活动 session binding 及 validation-execute 权限。

多单元交接前在 canonical 单元清单显式设置 autonomy_version="1" 并冻结 unit-extension/capability/dependency，契约见 docs/aidlc-autonomous-contracts-v1.md 第 13 节。inspect 不授权，runtime/external 未有实际运行观察时不会 ready。consume/verify 不进入实施候选；scope-exhausted 不代表批次/项目完成，仍需候选与完整验收。Codex 宿主执行工具前校验，observe 提供实际运行/UI 生产者，batch 汇合最终结果；其他宿主的实际适配不能由共享分发推导。

## Codex 宿主运行入口（P1-06）

使用已安装 Codex Skill 的 runtime/aidlc-codex-host.mjs：prepare <seed-config> <new-frozen-config> 输出可复用 thread_id、配置及 HostRef；identity <config> 只计算身份；run <config> <same-thread-id> 消费已签发的实际单会话授权。运行前仍须现有精确 binding 和批准的 HostRef/接收计划。详见 harness/codex/README.md 与 contracts-v1 第 14 节。

orchestrate autonomy host context / select --instance <exact-instance> 是宿主私有控制 IPC；不将 binding 注入模型，也不用于授予新权限。阶段路由、审批、证据和最终批次完成保持原门禁。当前入口只接入 Codex；不推导其他 Harness 已具备相同工具拦截或取消能力。

## 候选实际观察（P1-07）

`orchestrate autonomy observe run --input <冻结计划.json>` 在原全局协调 binding、实际 validation-execute/evidence-publish 授权及有效准入下执行 command/HTTP/UI 检查。计划须事先冻结，矩阵检查与 AC/UI 组合不能删减。候选须为真实 clean commit，实际服务版本须对应候选；UI 执行坐标交互、DOM 及 PNG 整页/关键区域差异检查。计划 schema、环境变量/外部版本身份与容差要求见 contracts-v1 第 15 节。

`orchestrate autonomy observe inspect` 只读核验当前签名、候选、环境、来源、原始文件及有效期；缺失/漂移为 unverified。runtime/external 只有对应真实观察通过才可 ready，实际消费仍重查服务版本/健康。观察 passed 不发布 batch verified，原 Native gates 和 P1-08 最终候选/决策/完整矩阵汇合仍须完成。

前置外部依赖可先执行 `orchestrate autonomy observe run --dependency-preflight --input <同一冻结计划.json>`，在实际 grant 和全局准备领取下只执行 ExternalRef HTTP 子集，不要求已取得完整实施准入；结果仅 partial，无相应检查时 not-applicable 且不签凭据。随后重新运行 admission，其他硬条件必须通过。消费者普通编码不改未变外部契约的就绪依据；完整矩阵仍要求当前 clean 候选，不能消费 partial 冒充通过。

## 最终批次结果（P1-08）

在原全局协调实例、同会话 grant 与有效准入下执行：

```sh
loeyae-aidlc orchestrate autonomy batch finalize --preview
loeyae-aidlc orchestrate autonomy batch finalize
loeyae-aidlc orchestrate autonomy batch inspect
```

preview 不运行 Native 汇合或发布凭据，不能当作验收。finalize 同时核验实际最终候选、完整 matrix、Native I13/TDD/审查/C8/适用 UI 与全局审查、依赖消费、交付物和委托决策；结果为 verified/failed/blocked/incomplete。pending 人类评审单独保留，验证引用和实施缺项仍阻塞。引用和签名格式见契约第 16 节。

inspect、next 和 state summary 只读投影历史工程结论与 current/stale/unknown。只有 current verified 才给出 batch_completed=true；结果不自动令项目 done。范围耗尽、观察 passed、模型 final 和宿主正常退出均不能替代终结。

Codex 宿主可配置冻结 candidate_command，必须指向 operation=candidate-commit/candidate-integrate 的既有 command ID；命令负责按授权准备 clean 最终候选及实际版本匹配环境，原 grant、工具前校验和预算不变。宿主串行进入正式 C8、执行完整观察、终结后以 Core 当前结果退出。细节见 harness/codex/README.md。

## 自主与未采用模式的执行语义（P1-09）

自主批次的完整操作顺序为：人类完成有限范围及 H1–H3 → 显式 adopt → prepare 得到原生 thread 并按协议绑定 → 真实操作端签发同会话 grant → 原协调实例执行 admission → 选定 Codex runtime run 持续消费正式 next/report/evidence → 当前完整矩阵及 Native 门禁汇合 → batch inspect 的 current verified。具体冻结顺序和 HostRef/AdmissionPlan 绑定以契约第 14～16 节为准；不能用此概览省略真实接收、授权或实际探针。

`next.autonomous_execution` 是只读指导，`execution_authorized=false`；它声明普通阶段不要求逐阶段确认，并指向 `core/knowledge/protocols/common-autonomous-execution.md`。`rule_load_plan.supplemental_protocols` 在已采用模式显式加载同一协议。notify/none 的展示后继续、已有确定来源直接复用、合法 policy/fallback 记录后实现与验证；human_review=pending 留待后续复核。真实 block、明确暂停/审阅、来源冲突且无合法兜底、授权不足和全部质量门禁仍阻断。

已冻结 implement 单元的模块选择由受支持宿主在正式路由候选内完成，复用原 select/bind，不再重复询问已确认分工；不选择未来/consume/verify 实施或他人领取。Core 的普通多模块路由仍返回 module-selection，未采用模式继续由用户选择。旧 workflow 不增加自主协议字段、grant 或 admission 门禁，也不会因加载 Skill 获得运行权限。

宿主保留 CLI 正常退出 2 的结构化 next 诊断，只有明确无需人工审批的 Native 刷新才可有界修复；进程中断、未知退出、伪造文本或其他命令失败均不转换为修复许可。遇到真实 block/选择问题停止，不允许模型代填 Approve。P1 已有 attempt 或新会话不自动恢复；完整真实双试点仍按 P1-10 验收。
