---
slug: requirement-clarification
number: "2.2.1"
name: 需求澄清
phase: inception
axis: module
execution: CONDITIONAL
lead_agent: aidlc-product-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes:
  - docs/aidlc/modules/{module-id}/inception/requirements.md
produces: [docs/aidlc/modules/{module-id}/inception/clarifications.md]
sensors: [clarification-traceability]
completion_contract: gated
requires: [requirements-analysis]
---
# 需求澄清流程

## 概述

在 Inception 阶段编写 requirements.md 之前，通过系统性追问澄清用户需求，确保需求完整、准确、无歧义。

**核心原则**：逐问题追问，依赖树解析，推荐答案先行，代码探索优先。

---

## 触发条件

### 触发

| 场景 | 条件 |
|------|------|
| 新模块开发 | 用户描述模糊或存在歧义 |
| 功能优化 | 优化目标/范围不明确 |
| Bug 修复 | 根因/影响范围不清晰 |
| 重构 | 重构动机/目标状态不明确 |

### 不触发（跳过条件）

- 用户需求已非常清晰（有完整 PRD 或详细描述）
- 简单配置修改/文案修改
- 用户明确表示"不需要澄清，直接开始"

---

## 澄清流程

### 步骤 1：依赖树分解

将用户需求分解为决策树结构：

```
用户需求：[原始描述]
    ↓
Q1: [核心问题1]（目标/范围）
    → 推荐: [基于代码探索的推荐答案]
    ↓
Q2: [核心问题2]（依赖 Q1 答案）
    → 推荐: ...
    ↓
Q3: [核心问题3]（依赖 Q2 答案）
    → 推荐: ...
```

**分解规则**：
1. 从最核心问题开始（目标 → 范围 → 方案 → 约束）
2. 后续问题依赖前面问题的答案
3. 每次只问一个问题（不并发）
4. 树深度一般不超过 5 层

### 步骤 2：逐问题追问

**追问规则**：

1. **每次只问一个问题**

2. **代码探索优先**：能通过探索代码库回答的问题，先探索再问，探索结果作为推荐答案依据

3. **提供推荐答案**：
   - 基于代码探索结果提供推荐答案
   - 如无法通过代码探索回答，提供 2-3 个常见选项
   - 推荐 ≠ 强制，用户可选择其他答案

   ```
   Q1: 优化目标是什么？

   推荐答案：查询响应时间 < 200ms (P99)
   （探索代码发现当前 P99 ≈ 500ms，基于业务场景推荐此目标）

   您可以选择：
   A. 采纳推荐答案
   B. 其他（请说明）
   ```

4. **等待用户反馈**：用户确认后再继续下一个问题

### 步骤 3：记录澄清结果

将澄清结果记录到 `docs/aidlc/modules/{module-id}/inception/requirements/requirement-clarification.md`：

```markdown
# 需求澄清记录

**模块**: [模块名称]
**时间戳**: [ISO 时间戳]
**初始需求**: [用户原始描述]

---

## 澄清过程

### Q1: [问题]
**推荐答案**: [推荐]
**依据**: [代码探索发现 / 行业实践]
**用户确认**: ✅ 采纳 | ✅ 采纳并补充: [...] | ❌ 用户选择: [...]

### Q2: [问题]
...

---

## 强制产物：clarifications.md（追溯链入口）

澄清完成后**必须**生成 `docs/aidlc/modules/{module-id}/inception/clarifications.md`，把每条已确认的澄清结论登记为稳定 `CL-xxx` ID，供下游 user-stories / application-design / cross-validation 对账遵循。这是澄清进入追溯链的唯一载体（ID 规范见 `knowledge/common-traceability-id-chain.md`）。

模板：

```markdown
# 需求澄清结论

## CL-001 <一句话澄清主题>
- 问题：<澄清了什么歧义/缺口>
- 结论：<用户确认的答案，实质内容，不少于一句>
- 影响：<影响哪些 REQ/后续设计>（可选）

## CL-002 <...>
- 问题：...
- 结论：...
```

若澄清后确认需求本无歧义、无需任何澄清结论，则文件必须显式写明一行 `无澄清项`（或 `no clarifications`），不得留空文件。`clarification-traceability` 门禁会校验:每个 CL-xxx 有实质结论内容;无 CL 时必须有显式"无澄清项"声明。

---

## 最终需求确认

### 目标
- [确认的目标列表]

### 范围
- [确认的范围列表]

### 方案
- [确认的方案要点]

### 约束
- [确认的约束条件]

---

## 附录：代码探索发现

[澄清过程中的代码探索发现，供后续复用]
```

---

## 与需求分析流程的关系

本文件是 `inception-requirements-analysis.md` 步骤 2（分析用户请求）的前置增强：

```
用户需求描述
    ↓
需求澄清流程（本文件）— 当请求清晰度为"模糊"或"不完整"时触发
    ↓
inception-requirements-analysis.md 步骤 3+（正常流程继续）
    ↓
requirements.md
```

**复用**：澄清过程中的代码探索发现可直接作为需求分析步骤 4（评估当前需求）的输入。

---

## 红旗信号

**绝不**：
- 用户需求模糊时直接开始编写 requirements.md
- 一次问多个问题
- 不提供推荐答案
- 不等待用户确认就继续
- 忽略代码探索发现（凭空猜测）
