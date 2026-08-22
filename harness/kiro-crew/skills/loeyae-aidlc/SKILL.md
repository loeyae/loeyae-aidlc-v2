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

覆盖：39/45 stages

### 2. 准入：condition（动态条件）

Stage frontmatter 声明 `condition: <expression>`。引擎在 `next` 时评估：
- 条件为 false 时 stage 自动跳过（不阻断，不需要人工介入）
- 支持条件：`has_legacy_code`、`has_ui_requirements`、`multi_module`、`has_nfr_needs`、`has_infra_needs`

覆盖：5/45 stages

### 3. 准出：produces（产物验证）

Stage frontmatter 声明 `produces: [path1, path2]`。引擎在 `report --result completed` 时检查：
- 所有声明的文件/目录必须存在
- 不存在则 **拒绝完成**，返回 error directive

覆盖：45/45 stages (100%)

### 4. 准出：sensors（自动检查）

Stage frontmatter 声明 `sensors: [name1, name2]`。引擎在 `report` 时执行：

| Sensor | 检查内容 |
|--------|---------|
| `no-todo` | produces 文件中无 TODO/FIXME/HACK |
| `build-success` | .aidlc-build-ok 标记文件存在 |
| `test-pass` | .aidlc-test-ok 标记文件存在 |
| `traceability` | produces 文件中含需求 ID（REQ-xxx） |
| `doc-cascade` | 上游依赖文档存在（文档级联完整性） |
| `reviewer-required` | 审查记录文件存在 |

任一 sensor 失败则 **拒绝完成**。覆盖：39/45 stages

### 5. 防跳步：current_stage

`report` 验证 `--stage` 必须等于当前活跃 stage。不能越阶汇报。覆盖：45/45 stages (100%)

## Scope 过滤

不同 scope 执行不同数量的 stages：

| Scope | 约执行 | 典型场景 |
|-------|--------|---------|
| feature | 45 | 完整功能开发 |
| enterprise | 45 | 企业级完整流程 |
| classic | ~43 | 标准开发流程 |
| mvp | ~23 | 最小可行产品 |
| express | 7 | 快速迭代/小改动 |
| bugfix | 7 | Bug 修复 |
| refactor | 8 | 代码重构 |

## 仅保留的 2 个人工确认点

| Stage | 原因 |
|-------|------|
| application-design | 架构决策——影响全局，不可自动验证正确性 |
| operations | 部署决策——影响生产环境 |

其余 43 个 stage 全部门禁通过即自动推进。

## Kiro Crew 适配

- **引擎调用**：`loeyae-aidlc orchestrate next/report/park`（全局安装后）
- **子代理派发**：通过 `spawn_run` MCP 工具
- **状态持久化**：业务项目的 `docs/aidlc/aidlc-state.json`
- **会话恢复**：检查 state.json，存在则恢复，否则新建
- **人工确认**：通过 `[OPTIONS: Approve | Request Changes]` 渲染

## 安装

```bash
npm install -g git+https://github.com/loeyae/loeyae-aidlc-v2.git
loeyae-aidlc install
kirocrew restart
```

## 阶段

```
Ideation（构思） → Inception（规划） → Construction（实现与验证） → Operations（部署准备）
```

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
