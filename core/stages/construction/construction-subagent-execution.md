---
slug: subagent-execution
number: "3.5.2"
name: 子代理执行
phase: construction
execution: CONDITIONAL
lead_agent: aidlc-developer-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces: [.aidlc/evidence/subagent-execution/subagent-evidence.json]
sensors: [subagent-evidence]
requires: [code-generation]
condition: has_subagent_support
---

# 平台自适应子 Agent 执行

## 概述

通过派发独立子 Agent 执行每个单元的代码生成，保持主 Agent 上下文清洁，实现高质量快速迭代。

**核心原则**：新鲜子 Agent + 与风险匹配的双轴审查 = 高质量、低冗余迭代

**平台自适应**：检测当前平台是否支持子 Agent 派发。审查模式先由 `construction-code-review.md` 按复杂度与风险确定，再由编排方调用 `aidlc-code-review`；平台只适配单 Agent 或子 Agent 的执行方式，不得改变能力输入、输出或质量门禁。

---

## 平台检测

### 支持子 Agent 的平台

| 平台 | 子 Agent 机制 | 检测方式 |
|------|-------------|----------|
| Kiro | `invoke_sub_agent` 工具 | 检查可用工具列表 |
| Claude Code | `Task` 工具 | 检查可用工具列表 |
| Cursor | Composer Agent | 检查可用工具列表 |
| OpenCode | 子进程派发 | 检查可用工具列表 |

### 模式选择逻辑

```
先按 construction-code-review.md 确定审查模式：
  简单快速通道且无排除项 → 集成双轴审查
  其他情况 → 独立双轴审查

再检测平台能力：
  支持子 Agent → 使用子 Agent 执行选定模式
  不支持子 Agent → 当前 Agent 串行执行选定模式
```

选定模式后，编排方按 `construction-code-review.md` 的“输入要求”提供完整输入并发起审查。子 Agent 或单 Agent 只负责执行该能力：集成模式使用一个审查上下文，独立模式使用两个审查视角；实现者自审不能替代正式双轴检查。审查返回 `NEEDS_CONTEXT` 时，编排方补齐缺失输入后重新发起，不得以输入不足为由跳过审查或标记单元完成。

在工作区检测阶段记录到 state.md：
```markdown
执行模式: 子Agent模式 | 单Agent模式
审查模式: 集成双轴审查 | 独立双轴审查
```

---

## 子 Agent 模式

### 执行流程

以下流程描述 `aidlc-code-review` 的独立双轴执行适配。集成模式由同一能力在一个审查上下文中依次完成两轴并分别报告；修复后重新调用该能力时，只传递原问题、修复差异及必要回归上下文。

```
┌─────────────────────────────────────────────────────────────┐
│ 主 Agent（协调者）                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 读取代码生成计划，提取所有任务                             │
│  2. 对每个任务：                                             │
│     ┌──────────────────────────────────────────────┐        │
│     │ 派发实现者子 Agent                            │        │
│     │  - 提供：任务完整文本 + 上下文 + TDD 要求      │        │
│     │  - 实现者：TDD 循环 → 自审 → 提交             │        │
│     └──────────────────────────────────────────────┘        │
│              ↓                                              │
│     ┌──────────────────────────────────────────────┐        │
│     │ 调用 aidlc-code-review（单元独立双轴）        │        │
│     │  - Spec 视角：检查匹配、缺失、多余与偏差      │        │
│     │  - Standards 视角：检查质量、结构与测试       │        │
│     │  - 关键/重要问题 → 实现者修复 → 重新调用能力  │        │
│     └──────────────────────────────────────────────┘        │
│              ↓                                              │
│     标记任务完成                                             │
│                                                             │
│  3. 所有任务完成后：按 C7 条件决定是否以最终全局审查模式       │
│     调用 aidlc-code-review                                  │
│  4. 进入构建和测试阶段                                       │
└─────────────────────────────────────────────────────────────┘
```

### 共享契约基线与带类型依赖上下文（条件）

派发实现者前，主 Agent 必须读取 `unit-of-work-dependency.md`、`state.md` 和适用的 `construction-shared-contract-baseline.md`，并以 `common-context-optimization.md` 为带类型依赖就绪与调度处理的唯一详细规则来源。

本文件只规定子 Agent 的上下文传递：调度方提供共享规则已判定的当前就绪结论、原因、下一调度动作及其适用证据；适用的共享契约还必须提供契约 ID、基线 ID、Owner 目标代码路径、代码版本和验证证据。实现者不得自行重述或改写依赖门禁；发现状态或证据变化时，返回 `NEEDS_CONTEXT` 或 `BLOCKED`，由调度方按共享规则重新取得结论后再决定后续动作。

### 实现者子 Agent 指令模板

```markdown
## 你的角色

你是一个实现者。你的任务是按照 TDD 流程实现以下功能。

## 任务

{TASK_FULL_TEXT}

## 上下文

{RELEVANT_CONTEXT}
- 项目结构：{PROJECT_STRUCTURE}
- 相关文件：{RELATED_FILES}
- 接口契约：{CONTRACTS}
- 带类型依赖：{DEPENDENCY_CONTEXT}
- 共享契约基线（适用时）：契约 ID、基线 ID、Owner 目标代码路径、状态、代码版本和验证证据

## TDD 要求

你必须严格遵循 RED-GREEN-REFACTOR 循环：
1. 先写一个失败测试
2. 运行测试，确认失败
3. 写最少代码让测试通过
4. 运行测试，确认通过
5. 重构（可选）
6. 重复直到任务完成

## 编码规范

{CODING_STANDARDS}

## 完成标准

- 所有测试通过
- 代码符合编码规范
- 无 TODO/FIXME
- 自审完成（检查命名、结构、边界情况）

## 报告格式

完成后报告：
- 状态：DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- 实现摘要
- 测试覆盖
- 自审发现
- 关注点（如有）
```

### 代码审查能力调用模板

```markdown
## 你的角色

你是代码审查能力执行者。执行 `aidlc-code-review`，不得自行决定审查时机或模式。

## 调用输入

按 `construction-code-review.md` 的“输入要求”逐项填充，占位符仅表示传参位置：

- {REVIEW_SCOPE_AND_CHANGESET}
- {APPLICABLE_SPEC}
- {APPLICABLE_STANDARDS}
- {VERIFICATION_EVIDENCE}
- 审查模式：{INTEGRATED_DUAL_AXIS | INDEPENDENT_DUAL_AXIS | FINAL_GLOBAL}
- {IMPACT_DOMAIN}
- 复审上下文（条件）：{ORIGINAL_FINDINGS_AND_FIX_DIFF}

## 执行要求

平台提供 Skill 入口时加载 `skills/aidlc-code-review/SKILL.md` 再进入规则；平台不装载 `skills/` 时直接加载 `steering/construction-code-review.md`。集成模式在同一上下文依次完成 Spec 与 Standards；独立模式由平台适配层分别提供两个审查视角，再合并为双轴报告；最终全局模式执行规则定义的全局检查。两轴结论必须独立保留。

## 报告格式

- 状态：DONE | NEEDS_CONTEXT | BLOCKED
- 双轴或最终全局审查报告，两轴结论独立保留
- 问题定位与严重度、修复建议、复审结果
- 证据不足或技术阻断项

状态为 `NEEDS_CONTEXT` 或 `BLOCKED` 时不得给出通过结论；不写 `state.md`、审计文件，也不判定完成。编排方按以下方式处理：`NEEDS_CONTEXT` 补齐缺失输入后重新发起；`BLOCKED` 按“处理实现者状态”表中 BLOCKED 的同一策略评估原因，解决后重新发起，不得跳过审查或标记单元完成。
```

### 处理实现者状态

| 状态 | 含义 | 处理方式 |
|------|------|----------|
| DONE | 任务完成 | 进入规格审查 |
| DONE_WITH_CONCERNS | 完成但有疑虑 | 评估疑虑，决定是否处理后再审查 |
| NEEDS_CONTEXT | 需要更多信息 | 提供缺失上下文，重新派发 |
| BLOCKED | 无法完成 | 评估阻塞原因（见下方） |

**BLOCKED 处理策略：**
1. 上下文问题 → 提供更多上下文，重新派发
2. 任务太复杂 → 拆分为更小的子任务
3. 计划本身有问题 → 暂停，向用户说明并建议修改计划
4. 架构问题 → 暂停，触发系统化调试流程

---

## 单 Agent 自适应审查模式

当平台不支持子 Agent 时，主 Agent 自己执行选定的审查模式：快速通道在一次审查视角中依次完成两轴；其他路径按以下独立两阶段流程执行。

### 执行流程

```
对每个单元：
  1. 执行 TDD 循环（RED-GREEN-REFACTOR）
  2. 以选定模式调用 aidlc-code-review：
     - 集成模式：在同一审查上下文中依次执行 Spec 与 Standards
     - 独立模式：先切换到规格审查视角，再切换到质量审查视角
  3. 任一轴出现关键或重要问题时，修复后使用原问题、修复差异和必要回归证据重新调用
  4. 两轴都通过后，标记任务完成
所有单元完成后：
  5. 由编排方按 C7 条件决定是否以 FINAL_GLOBAL 调用 aidlc-code-review；未触发时按现有审计规则记录跳过依据
```

### 视角切换标记

在审计日志中明确标记视角切换：

```markdown
## 规格合规审查（单Agent模式）
**时间戳**: [ISO 时间戳]
**视角**: 规格审查员
**审查对象**: 单元 X 的实现
**审查结果**: ✅ 合规 / ❌ 不合规
**详情**: ...

---

## 代码质量审查（单Agent模式）
**时间戳**: [ISO 时间戳]
**视角**: 质量审查员
**审查对象**: 单元 X 的实现
**审查结果**: ✅ 通过 / ⚠️ 有问题
**详情**: ...
```

### 单 Agent 模式的额外纪律

因为没有独立审查者的"新鲜视角"，单 Agent 模式需要额外纪律：

1. **强制重读规格**：审查前必须重新读取原始规格文件，不依赖记忆
2. **逐项检查**：不允许"整体看起来没问题"，必须逐项对照
3. **记录证据**：每个审查结论必须附带具体代码引用
4. **自我质疑**：主动寻找自己可能遗漏的问题

---

## 连续执行原则

**不要在任务之间暂停询问用户。** 连续执行计划中的所有任务。

**例外**：如果 state.md 中审批模式为`严格`，则在 `core-workflow.md` 定义的 🔴 强制审批点仍需等待用户确认。

唯一停止的理由：
- BLOCKED 状态且无法自行解决
- 发现计划本身有歧义，无法继续
- 所有任务完成
- 严格模式下遇到强制审批点

**禁止：**
- "要继续吗？"
- "任务 1 完成，要开始任务 2 吗？"
- 进度汇报（除非用户主动询问）

用户让你执行计划，就执行它。

---

## 与 AI-DLC 工作流的集成

### 在 Construction 阶段的位置

```
Construction 阶段：
  Per-Unit 循环：
    1. 功能设计（条件）
    2. NFR 需求/设计（条件）
    3. 基础设施设计（条件）
    4. 代码生成 — 规划阶段（必执行）
       ↓ 用户批准计划
    5. 代码生成 — TDD 执行阶段（必执行）  ← 本文件控制
       - 集成模式：实现者 + 单次双轴审查
       - 独立模式：实现者 + 规格审查 + 质量审查
       - 无子 Agent：当前 Agent 串行执行对应模式
    6. 代码审查（必执行）                  ← aidlc-code-review；规则由 construction-code-review.md 定义
```

### 上下文传递

主 Agent 向实现者子 Agent 传递的上下文：

| 内容 | 来源 |
|------|------|
| 任务完整文本 | 代码生成计划 |
| 接口契约 | `docs/aidlc/product/contracts.md` 或应用设计 |
| 带类型依赖与就绪结论 | `unit-of-work-dependency.md` + state.md |
| 共享契约基线上下文（适用时） | state.md 的基线表 + `construction-shared-contract-baseline.md` |
| 编码规范 | MCP Skill（如适用）或 steering 文件 |
| 相关现有代码 | 工作区扫描结果 |
| TDD 执行序列 | 代码生成计划中的 TDD 规划 |

**禁止传递**：
- 主 Agent 的会话历史
- 其他单元的实现细节（除非有依赖）
- 完整的 Inception 产出物（只传递相关部分）

---

## 红旗信号

**绝不：**
- 跳过 Spec 或 Standards 任一审查轴
- 将集成模式用于不满足快速通道条件的任务
- 带着未修复的关键或重要问题继续下一个任务
- 并行派发多个实现者子 Agent（会冲突）
- 让子 Agent 自己读取计划文件（提供完整文本）
- 忽略子 Agent 的问题（回答后再让它继续）
- 接受"差不多合规"（规格审查发现问题 = 未完成）
- 跳过重新审查（审查发现关键或重要问题 → 修复 → 必须重新审查）
- 在规格合规通过之前开始质量审查（顺序错误）
- 让实现者自审替代正式审查（两者都需要）

---

## 最终规则

```
每个任务 = 独立实现上下文 + TDD + 与风险匹配的双轴审查
审查未通过 = 任务未完成
简单任务减少审查调用，不减少检查维度。
```
