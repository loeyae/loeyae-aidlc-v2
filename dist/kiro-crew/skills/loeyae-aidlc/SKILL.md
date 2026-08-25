---
name: loeyae-aidlc
description: >
  Loeyae AI-DLC v2 workflow orchestrator. Engine-driven development lifecycle
  with gate-enforced completeness (no manual approval gates). Activate with
  "使用 AI-DLC" or "aidlc" keywords.
triggers: aidlc, AI-DLC, 使用 AI-DLC, 继续上次的工作, 认领单元, 功能设计, 用户故事, 架构设计, 单元生成, 代码审查, 逆向工程, 根因分析, 修改功能, 变更需求
---

# Loeyae AI-DLC v2 Orchestrator (Kiro Crew Harness)

## 核心原则

**准入门禁（requires + condition）+ 准出门禁（produces + sensors）= 自动推进**

门禁保证完整性，因此不需要人工审批阻断。引擎验证通过后自动推进到下一阶段。
仅 2 个不可自动验证的决策点保留人工确认（架构决策 + 部署决策）。

## 架构

确定性 TypeScript 引擎驱动。Agent 不自主路由——只执行引擎返回的指令。

```
Agent ←→ aidlc-orchestrate.ts next   → 返回下一步 JSON directive
Agent ←→ aidlc-orchestrate.ts report → 验证门禁 + 记录结果 + 自动推进
Agent ←→ aidlc-orchestrate.ts park   → 保存状态供下次恢复
```

## 转发循环

```
Loop:
  1. directive = loeyae-aidlc orchestrate next
  2. 按 directive.kind 执行（见下表）
  3. 执行完成后: loeyae-aidlc orchestrate report --stage <slug> --result completed
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

## 五层门禁体系

### 1. 准入：requires（依赖检查）

Stage frontmatter 声明 `requires: [slug1, slug2]`。引擎在 `next` 时验证：
- 所有依赖 stage 必须已 completed 或 skipped
- **Scope-aware**：被当前 scope 排除的依赖视为自动满足

覆盖：41/46 stages

### 2. 准入：condition（动态条件）

Stage frontmatter 声明 `condition: <expression>`。引擎在 `next` 时评估：
- 条件为 false 时 stage 自动跳过（不阻断，不需要人工介入）
- 支持条件：`has_legacy_code`、`has_ui_requirements`、`multi_module`、`has_nfr_needs`、`has_infra_needs`、`has_test_case_sources`、`has_contract_dependencies`、`has_subagent_support`、`is_loeyae_boot`
- 未知条件 fail-closed（视为阻断而非放行）

覆盖：14/46 stages

### 3. 准出：produces（产物验证）

Stage frontmatter 声明 `produces: [path1, path2]`。引擎在 `report --result completed` 时检查：
- 所有声明的文件必须存在且非空，声明的目录必须存在且包含非隐藏条目
- 不满足则 **拒绝完成**，返回 error directive

覆盖：32/46 stages

### 4. 准出：sensors（自动检查）

Stage frontmatter 声明 `sensors: [name1, name2]`。引擎在 `report` 时执行。

**Evidence 协议**：所有 evidence-based sensor 从 `.aidlc/evidence/<stage-slug>/<sensor>.json` 读取机器生成的结构化证据，不接受手写或 agent 直接编辑的证据文件。

证据文件约束：
- 格式：合法 JSON object，含 `evidence_version: "1"`
- 大小：≤ 512 KB
- 时效：`timestamp` 为合法 ISO 日期，≤ 24 小时
- 来源：由受控 evidence producer（CI 脚本、构建工具、测试 runner）写入；所有 evidence 必须带 `producer.mode: "controlled"`、执行 ID 和最近时间戳。`build-test-evidence` 使用 `loeyae-aidlc evidence run --stage build-and-test`；其他语义 sensor 使用 `--sensor <sensor>` 执行 allowlist 中唯一的 `role: "semantic"` checker。checker 只能在 stdout 返回 sensor-specific JSON，Producer 注入 provenance、时间戳和 checker 执行记录，不能由 Agent 直接编辑 evidence 文件。

#### Inception Sensors

| Sensor | 适用 Stage | 阻断语义 |
|--------|-----------|----------|
| `prd-completeness` | prd-generation | PRD 章节、功能验收、非目标、待确认项、来源索引或一致性不完整 |
| `diagram-contract` | requirements-methods, application-design | SVG 源 ID/端口/方向/图例/分组/viewBox/FR 映射不完整 |
| `design-intent-coverage` | units-generation | 设计意图未被工作单元承接，或存在未覆盖意图 |

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
| `implementation-report` | implementation-report | 证据引用不存在、all_gates_passed≠true |
| `frontend-platform-spec` | ui-implementation-bridge | 缺少布局原语、组件映射或 CSS 约束 |
| `framework-compliance` | loeyae-compliance | 框架 skill 未加载、检查失败或检查数为 0 |
| `subagent-evidence` | subagent-execution | 无执行 agent、任务未完成或存在失败 |
| `template-completeness` | build-and-test-templates | 模板清单为空或存在未解决项 |
| `recovery-evidence` | compact-recovery | state 未恢复或交接未记录 |
| `ui-design-alignment` | code-review | HTML Mock/Figma 页面或组件未映射、存在多余 UI、样式/可见性/平台约束不一致 |
| `no-todo` | 所有含 produces 的 stage（编译时自动注入） | 所有 produces 文件含 TODO/FIXME/HACK，或产物不可读取 |
| `traceability` | 所有含 produces 的 stage（编译时自动注入） | 非 evidence produces 文件无 REQ-xxx/R-xxx；纯 evidence stage 必须声明 `traceability: not_applicable` |

覆盖：21/46 stages（含 PRD、图表设计和 Construction 关键 stage）

### 5. 防跳步：current_stage

`report` 验证 `--stage` 必须等于当前活跃 stage。不能越阶汇报。覆盖：46/46 stages (100%)

## Scope 过滤

不同 scope 执行不同数量的 stages（总计 46 stages）：

| Scope | 约执行 | 典型场景 |
|-------|--------|---------|
| feature | 46 | 完整功能开发 |
| enterprise | 46 | 企业级完整流程 |
| classic | ~44 | 标准开发流程 |
| mvp | ~23 | 最小可行产品 |
| express | 7 | 快速迭代/小改动 |
| bugfix | 7 | Bug 修复 |
| refactor | 8 | 代码重构 |

## 仅保留的 2 个人工确认点

| Stage | 原因 |
|-------|------|
| application-design | 架构决策——影响全局，不可自动验证正确性 |
| operations | 部署决策——影响生产环境 |

其余 44 个 stage 全部门禁通过即自动推进（notify 仅通知，不阻断）。

## 不适用条件的处理

- condition 评估为 false → 引擎自动标记 `skipped`，下游 requires 视为满足
- 被跳过 stage 的 sensor 不触发，doc-cascade 感知跳过状态
- 无需手动记录——引擎 condition 评估结果即为依据

## Kiro Crew 适配

- **引擎调用**：`loeyae-aidlc orchestrate next/report/park`（全局安装后）
- **子代理派发**：通过 `spawn_run` MCP 工具
- **状态持久化**：业务项目的 `docs/aidlc/aidlc-state.json`
- **会话恢复**：检查 state.json，存在则恢复，否则新建
- **人工确认**：通过 `[OPTIONS: Approve | Request Changes]` 渲染
- **证据目录**：业务项目的 `.aidlc/evidence/<stage-slug>/` 存放 sensor 证据
- **MCP 能力**：默认安装会将 V1 的 `loeyae-skills`、`awesome-design`、`figma`、`ssot` 和 `chrome-devtools` 只补缺失地合并到 Kiro Crew 全局配置；服务不可用时必须按对应流程的 `NEEDS_CAPABILITY` 或通用规范降级，不得伪造调用结果

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
