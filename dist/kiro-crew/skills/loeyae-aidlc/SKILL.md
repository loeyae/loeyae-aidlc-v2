---
name: loeyae-aidlc
description: >
  Loeyae AI-DLC v2 workflow orchestrator with collaborative schema v3 by default. Engine-driven development lifecycle
  with deterministic multi-instance gates, signed provenance, and two token-bound human approval points. Activate with
  "使用 AI-DLC" or "aidlc" keywords.
triggers: aidlc, AI-DLC, 使用 AI-DLC, 继续上次的工作, 接手当前项目, 查看当前进度, 查看可接手任务, 在这台设备继续, 暂停并交接, 认领单元, 审批当前阶段, 确认架构方案, 批准架构方案, 批准部署方案, 驳回当前方案, 功能设计, 用户故事, 用户场景, 验收标准, PRD, 产品需求文档, 需求文档合成, 架构设计, 应用设计, 组件设计, 服务设计, 单元生成, 工作单元, 单元拆分, 依赖矩阵, 代码审查, 代码评审, Code Review, 逆向工程, 存量系统分析, 代码库分析, 根因分析, 系统化调试, 故障定位, 测试用例派生, UC-D, 测试场景, 构建测试证据, 画图, 图表设计, 业务流程图, 系统架构图, 流程图, Figma, UI 原型, HTML Mock, 组件映射, 前端平台规范, 需求估算, 工作量估算, 人天估算, 功能点估算, 功能点分析, FPA, 项目排期, 粗粒度排期, 排期预测, 交付预测, 发布预测, 交付配置, 部署配置生成, 部署配置验证, 发布配置检查
---

# Loeyae AI-DLC v2 Orchestrator (Kiro Crew Harness)

## 核心原则

**准入门禁（requires + condition）+ 准出门禁（produces + sensors）= 自动推进**

门禁保证可机器验证的完整性；仅 2 个不可自动判定的决策点保留 `approval: block`（架构决策 + 部署决策），且只在对应 condition=true 时出现。`gate: true` 不是口头确认：完成当前实例产物与 sensor 后，人类必须在交互式终端签发绑定 workflow/stage_instance/challenge、最长 15 分钟且消费后不可重放的 token。模块级 `application-design` 每个模块实例分别审批。平台适配器和 Agent 不得自行签发；没有受信宿主 provider 且无人类 TTY 时按设计 fail-closed。

## 架构

确定性 TypeScript 引擎驱动。Agent 不自主路由——只执行引擎返回的指令。

```
Agent ←→ aidlc-orchestrate.ts next   → 返回下一步 JSON directive
Agent ←→ aidlc-orchestrate.ts report → 验证门禁 + 记录结果 + 自动推进
Agent ←→ aidlc-orchestrate.ts park   → 主动冻结 workflow（非日常交接前提）
```

## 转发循环

```
Loop:
  1. directive = loeyae-aidlc orchestrate next --actor-id <actor> --device-id <device> --client-id <client>
  2. 按 directive.kind 执行；run-stage 只操作其 stage_instance/artifact_root/evidence_root
  3. 执行完成后按契约报告（receipt 只走安全 stdin）：
     - 普通 stage：`... | report --stage <slug> --instance <id> --result completed --claim-receipt-stdin`
     - instruction-only：追加 `--instruction-ack <slug>`
     - approval:block：先由受信 Provider/真人 TTY 签发 instance-bound token，再与 receipt 一起定向报告
  4. 重复直到 directive.kind == done
```

## Directive 类型

| kind | 动作 |
|------|------|
| `run-stage` | 读取 stage 文件，执行 stage 主体，生成产物 |
| `ask` | 向用户提问，等待回答 |
| `print` | 输出消息 |
| `error` | 输出错误并 **停止**（门禁阻断） |
| `done` | 工作流完成 |
| `parked` | 工作流已暂停，下次 `--resume` 恢复 |

### run-stage directive 附带字段

除 `kind` 外，run-stage directive 还携带：

| 字段 | 类型 | 含义 | agent 动作 |
|------|------|------|-----------|
| `stage_instance` | string | 当前机器执行实例 ID | 报告、审批与 Evidence 均绑定此实例，不得只按 slug 推断 |
| `claim_receipt` | object | Provider ACK 后签发并写入签名 state 的当前 lease 回执 | 只通过安全 stdin 回传，不写 argv、handoff 或聊天 |
| `ready_instances` / `client_focus` | string[] / string | 稳定 ready set 与当前 client 的局部 focus | 不得改写为 workflow 全局游标 |
| `axis` | "project"\|"module"\|"unit" | 实例化范围 | 按对应上下文执行 |
| `module_id` / `unit_id` | string\|null | 当前稳定上下文 ID | 非空时只读写该上下文 |
| `artifact_root` / `evidence_root` | string | 当前实例规范根目录 | 所有产物和 Evidence 写入该目录 |
| `gate` | boolean | `true` = 本 stage 为审批阻断点（approval:block） | 完成后必须携带受信的一次性 token 报告 `approved`，不得使用 `completed` |
| `approval` | "block"\|"confirm"\|"notify" | 审批类型 | `block` 必须由人类终端或受信宿主 provider 签发 token；`notify` 仅通知 |
| `completion_contract` | "artifact"\|"evidence"\|"instruction_only" | 完成契约 | `instruction_only` 必须追加 `--instruction-ack <slug>`，Stop Hook 不得代确认 |
| `produces` | string[] | 准出需存在的产物路径 | report 前确保已生成 |
| `sensors` | string[] | 准出需通过的 sensor | report 前确保 evidence 就绪 |
| `mode` | "inline"\|... | 执行模式 | 参考 stage 文件 |
| `consumes` | string[] | 上游产物输入 | 读取这些文件作为输入 |

**审批点处理**：`gate:true`（仅 application-design / operations）时，先完成产物与 sensor，再加载 `skills/aidlc-approval/SKILL.md`。schema v3 的 request/TTY 均必须传 `--instance`；只有宿主明确提供符合 `trusted-approval-provider.md` 的受信 Provider 时，才能在 Agent 上下文之外组合 claim receipt 与 approval response stdin envelope。普通聊天、`ask_question`、`[OPTIONS:]` 和 Agent 复制确认语都不能生成 `approved`。宿主 Provider 不可用时，由人类在业务项目的交互式终端执行：

```bash
loeyae-aidlc approve --stage <slug> --instance <stage-instance>
claim-receipt.json | loeyae-aidlc orchestrate report \
  --stage <slug> --instance <stage-instance> --result approved \
  --approval-token <token> --claim-receipt-stdin
```

Token 绑定当前 workflow、stage_instance 和 challenge，最长 15 分钟且成功消费后不可重放。误用 `completed`、缺 token、上下文不匹配、伪造、过期或重放都会返回 error directive；修复后重新获取 challenge/token，不得改 state 绕过。

## 五层门禁体系

### 1. 准入：requires（依赖检查）

Stage frontmatter 声明 `requires: [slug1, slug2]`。引擎在 `next` 时验证：
- 所有依赖 stage 必须已 completed，或由图谱 condition=false 记录为内部 `condition_skipped`
- **Scope-aware**：被当前 scope 排除的依赖仅在图谱 scope closure/显式 waiver 合法时满足

覆盖：45/46 stages

### 2. 准入：condition（动态条件）

Stage frontmatter 声明 `condition: <expression>`。引擎在 `next` 时评估：
- 条件为 false 时 stage 自动跳过（不阻断，不需要人工介入）
- 支持条件：`has_legacy_code`、`has_ui_requirements`、`ui_design_selected`、`ui_mode_html_mock`、`ui_mode_figma`、`multi_module`、`has_product_contract_needs`、`has_application_design_needs`、`has_unit_generation_needs`、`has_test_case_sources`、`has_functional_design_needs`、`has_nfr_needs`、`has_infra_needs`、`has_contract_dependencies`、`has_subagent_support`、`is_loeyae_boot`、`needs_ui_implementation_bridge`、`context_compacted`、`has_deployment_needs`、`has_operations_template_needs`
- 未知条件 fail-closed（视为阻断而非放行）

覆盖：26/46 stages

### 3. 准出：produces（产物验证）

Stage frontmatter 声明 `produces: [path1, path2]`。引擎在 `report --result completed` 时检查：
- 所有声明文件必须是项目根内的常规非 symlink 文件，逐段路径不得穿越 symlink，且至少 16 字节；目录必须安全存在并含非隐藏条目
- `consumes` 在 `next` 与 `report` 都复核，防止阶段执行窗口内删除或替换上游产物
- 不满足则 **拒绝完成**，返回 error directive

覆盖：34/46 stages

### 4. 准出：sensors（自动检查）

Stage frontmatter 声明 `sensors: [name1, name2]`。引擎在 `report` 时执行。

**Evidence 协议**：所有 evidence-based sensor 按当前实例读取机器生成的结构化证据：project 为 `.aidlc/evidence/<stage-slug>/<sensor>.json`，module 追加 `<module-id>/`，unit 再追加 `<unit-id>/`。不接受手写、agent 直接编辑或其他模块/单元的证据文件。

证据文件约束：
- 格式：合法 JSON object，含 `evidence_version: "1"`
- 大小：≤ 512 KB
- 时效：`timestamp` 为合法 ISO 日期，≤ 24 小时
- 来源与完整性：`producer.name` 必须为 `loeyae-aidlc-evidence`，并带 `mode: "controlled"`、执行 ID、当前 `commit + dirty + worktree_digest` 以及合法 HMAC-SHA256 `integrity`
- secret：需要 Evidence 的工作流必须在第一次 `next` 前由宿主注入至少 32 字节且跨 orchestrator/Producer/Hook 一致的 `AIDLC_TRUST_SECRET`
- 构建证据：`loeyae-aidlc evidence run --stage build-and-test`；命令只持久化 `argv_digest`，stdout/stderr 尾部脱敏
- 语义证据：`--sensor <sensor>` 的 allowlist 只能声明精确的 `loeyae-aidlc check --sensor <sensor>`；Producer 固定执行发行包内置 checker，拒绝项目 Node/Python/shell checker
- 路径与并发：config/cwd/artifact/output 均做根边界和逐段 symlink 检查；同 stage/sensor 的锁覆盖完整执行及原子写窗口

#### Inception Sensors

| Sensor | 适用 Stage | 阻断语义 |
|--------|-----------|----------|
| `prd-completeness` | prd-generation | PRD 章节、功能验收、非目标、待确认项、来源索引或一致性不完整 |
| `diagram-contract` | requirements-methods, application-design | SVG 源 ID/端口/方向/图例/分组/viewBox/FR 映射不完整 |
| `design-intent-coverage` | units-generation | 设计意图未被工作单元承接，或存在未覆盖意图 |
| `ui-artifact-consistency` | ui-page-planning, ui-mock-generation, ui-figma-generation | 当前模块页面计划未对齐需求/故事，HTML skeleton/content 集合不一致，或 Figma 来源、Page/Frame/nodeId/截图/只读约束不一致 |
| `inception-consistency` | cross-validation | 需求与故事不一致，或签名选择的 PRD/UI canonical 产物未纳入当前模块最终交叉验证 |

#### Construction Sensors

| Sensor | 适用 Stage | 阻断语义 |
|--------|-----------|----------|
| `functional-design-completeness` | functional-design | 数据源验证未通过、存在未解决歧义、用例未覆盖、接口未指定 |
| `nfr-coverage` | nfr-requirements, nfr-design | NFR 未全部覆盖、缺少验收标准、nfr_item.verified≠true |
| `infrastructure-completeness` | infrastructure-design | 缺少必需小节、资源未枚举或未 provisioned |
| `contract-baseline` | shared-contract-baseline | 契约未 verified、缺少 owner/consumers/schema_hash |
| `doc-cascade` | code-generation, functional-design, build-and-test, nfr-design, implementation-report | 文档级联断裂（上游产物不存在） |
| `test-quality` | tdd | tests_failed≠0、无 green 证据、TDD 循环不完整、UC-D 映射缺失 |
| `review-evidence` | code-review | 双轴审查未通过、存在未关闭 issue、缺少 reviewer |
| `reviewer-required` | code-review | produces 中不含审查记录文件 |
| `build-test-evidence` | build-and-test | 构建 exit_code≠0、测试 failed>0、静态检查未通过 |
| `implementation-report` | implementation-report | 证据引用不存在、all_gates_passed≠true、模块未全部覆盖，或已选 PRD/UI Evidence 未聚合 |
| `frontend-platform-spec` | ui-implementation-bridge | 缺少布局原语、组件映射或 CSS 约束 |
| `framework-compliance` | loeyae-compliance | 框架 skill 未加载、检查失败或检查数为 0 |
| `subagent-evidence` | subagent-execution | 无执行 agent、任务未完成或存在失败 |
| `template-completeness` | build-and-test-templates | 模板清单为空或存在未解决项 |
| `recovery-evidence` | compact-recovery | state 未恢复或交接未记录 |
| `ui-design-alignment` | code-review | HTML Mock/Figma 页面或组件未映射、存在多余 UI、样式/可见性/平台约束不一致 |
| `no-todo` | 所有含 produces 的 stage（编译时自动注入） | 所有 produces 文件含 TODO/FIXME/HACK，或产物不可读取 |
| `traceability` | 所有含 produces 的 stage（编译时自动注入） | 非 evidence produces 文件无 REQ-xxx/R-xxx；纯 evidence stage 必须声明 `traceability: not_applicable` |

覆盖：frontmatter 手写 25 / 编译后 34（含自动注入的 no-todo + traceability）/ 46 stages。
所有 `produces` 非空的 stage 在编译时自动追加 `no-todo` 与 `traceability` sensor，故实际准出 sensor 覆盖 = 34/46。下表列为 frontmatter 显式声明的 sensor；自动注入的两项见末两行。

### 5. 防跳步：instance + receipt

schema v3 `report` 同时验证 `--stage`、`--instance` 和当前有效 claim receipt。相同 slug 的不同 module/unit 实例可并行，但任一 client 只能凭自己 actor/device/client lease 提交。覆盖：所有 v3 实例。

## Scope 过滤

不同 scope 进入不同数量的默认候选 stages（总计 46 stages；`prd-generation` 为用户选择 Stage，未选择时不进入实例；实际执行数还会依项目条件动态减少）：

| Scope | 候选 stages | 典型场景 |
|-------|------------|---------|
| feature | 45（`--with-prd` 时 46） | 完整功能开发 |
| enterprise | 45（`--with-prd` 时 46） | 企业级完整流程 |
| mvp | 45（`--with-prd` 时 46） | 最小可行产品 |
| classic | 43（`--with-prd` 时 44） | 标准开发流程 |
| express | 7 | 快速迭代/小改动 |
| workshop | 7 | 工作坊/探索 |
| bugfix | 7 | Bug 修复 |
| refactor | 7 | 代码重构 |
| poc | 7 | 概念验证 |

`prd-generation` 不是 Inception 强制门禁。只有用户明确选择 PRD 时，初始化完整 scope 才使用 `loeyae-aidlc orchestrate next --scope <scope> --with-prd`；选择写入签名状态且活动工作流中不可变。未选择时不生成占位文件，后续 Inception 正常继续。用户也可通过 `aidlc-prd-synthesis` 独立生成 PRD。

完整 scope 的 `workspace-detection` 也是运行时 choice：directive 返回 `choice_required: true` 时，必须向用户展示 `single-module`、`multi-module`，并以 `report --stage workspace-detection --result completed --instruction-ack workspace-detection --user-input <choice>` 写入签名 history。单模块跳过产品级 Inception 但仍登记唯一模块；产品契约仅在多模块或存在跨边界事实时执行。快速 scope 不要求该 choice；不得从 `handoff.md` 推断或改变机器路由。

I9 UI 设计不是初始化选项，而是运行时 choice。`ui-mock` directive 返回 `choice_required: true` 时，必须向用户展示 `choices`，并以 `report --stage ui-mock --result completed --instruction-ack ui-mock --user-input <choice>` 记录 `html-mock`、`figma-create`、`figma-existing`、`skip` 中唯一值。`skip` 不创建 UI 产物，HTML/Figma 分支互斥；不得从 `handoff.md` 推断或改变机器路由。选择设计后，页面计划、HTML 两段或 Figma manifest、模块交叉验证、适用单元代码审查和最终项目报告必须逐层纳入 canonical 产物与 Evidence；未选择时这些门禁不得出现。

`application-design`、`units-generation`、`functional-design` 和 `operations` 根据 `workflow-plan.md` 的 `execute / skip + evidence` 自动路由；旧计划缺行时才保守推断。I14 跳过后使用 `default` 单元；I14 执行时，新签名 `unit-manifest.json` 必须为每个单元声明 `conditional_stages`（允许空数组），防止其他单元的 NFR、基础设施、契约、框架或 UI 事实扩散，旧清单缺字段时保守回退。Operations condition=false 不出现审批；`operations-templates` 只在明确要求保留可复用模板时执行。

## 仅保留的 2 个人工确认点

| Stage | 原因 |
|-------|------|
| application-design | 架构决策——影响全局，不可自动验证正确性 |
| operations | 部署决策——影响生产环境 |

进入签名工作流的非审批 stage 在各自门禁通过后自动推进（notify 仅通知，不阻断）；用户未选择的 PRD Stage 不属于当前工作流。

## 不适用条件的处理

- condition 评估为 false → 引擎记录内部 `condition_skipped`，下游 requires 视为满足
- 被条件排除 stage 的 sensor 不触发，doc-cascade 感知该内部状态
- 公开 report 不接受 `skipped`；Agent/用户不得手工跳过，condition 结果本身即为依据

## Kiro Crew 适配

- **引擎调用**：`loeyae-aidlc orchestrate next/report/park`（全局安装后）
- **子代理派发**：通过 `spawn_run` MCP 工具
- **状态持久化**：新 workflow 默认 schema v3；签名 event/instance map/ready set/claim receipt 是唯一机器状态，外部 enrollment 绑定项目路径
- **协调 Provider**：Local 仅同工作树；Git 用专用 coordination ref 远端 CAS；External 当前仅通用接口/reference implementation，不虚构厂商连接器
- **定向 report**：必须绑定 `stage_instance` 和安全 stdin receipt；assignment、handoff、聊天或 Slash Command 都不能授权
- **会话恢复**：只从已验证签名 state 恢复；`docs/aidlc/handoff.md` 是派生人类视图，无权改变路由状态
- **连续工作**：继续、接手、查看进度或换设备请求加载 `skills/aidlc-continuity/SKILL.md`；`aidlc-handoff` 仅为兼容别名，日常交接不自动 park
- **人工确认**：`[OPTIONS: Approve | Request Changes]` 只呈现审阅选择；Approve 后仍须由人类 TTY/受信 provider 签发 token，不能把聊天回答直接作为 token
- **instruction-only**：执行正文后显式传 `--instruction-ack <slug>`；生命周期 Hook 不自动推进
- **证据目录**：业务项目的 `.aidlc/evidence/<stage-slug>/` 存放 sensor 证据
- **MCP 能力**：默认安装会将 V1 的 `loeyae-skills`、`awesome-design`、`figma`、`ssot` 和 `chrome-devtools` 合并到 Kiro Crew 全局配置；无自定义字段的旧版本化 Chrome DevTools 默认项会安全收敛为不指定版本的 `chrome-devtools-mcp`；带自定义字段、环境变量、非默认参数或禁用状态的同名配置均保留。服务不可用时必须按对应流程的 `NEEDS_CAPABILITY` 或通用规范降级，不得伪造调用结果

## Chrome DevTools 浏览器验收 Provider

本 Skill 随附的 `chrome-devtools` MCP（不指定版本的 `chrome-devtools-mcp`）仅用于 `diagram-contract` sensor 的浏览器几何验收：加载独立 SVG 或目标预览 URL，采集 DOM/属性、几何、viewport 截图和控制台证据。

使用规则：
- 不生成 SVG、`.diagram.json` 或 PNG/PDF，不重新布局，不替代源级 `diagram-contract` 检查
- 独立 SVG 优先用 `file://` URL；若 Chrome 呈现为 XML 查看器，运行器用只含当前 SVG 的临时本地 HTML wrapper 检查，结束后删除
- 无法启动 Chrome 或 MCP 时，记录 `NEEDS_CAPABILITY`，不得伪造浏览器验证通过
- `UNVERIFIED` 等验收状态记录在外部 evidence 或验收报告中，不写入 SVG 图片内容

## 安装

```bash
npm install -g git+https://github.com/loeyae/loeyae-aidlc-v2.git
loeyae-aidlc install
kirocrew restart
```

## 阶段

```
Ideation（构思，5 stages） → Inception（规划，24 stages） → Construction（实现与验证，15 stages） → Operations（部署准备，2 stages）
```

总计 46 stages。

## 使用

在 Kiro Crew 新会话中输入：

```
使用 AI-DLC 开发用户认证模块
```

引擎会：
1. 初始化 workflow（选择 scope）
2. 返回第一个 stage directive
3. Agent 执行 stage → 生成产物 → report
4. 引擎验证门禁 → 自动推进 → 返回下一个 directive
5. 直到 done
