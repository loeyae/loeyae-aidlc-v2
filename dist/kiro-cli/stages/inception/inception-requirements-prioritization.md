---
slug: requirements-prioritization
number: "2.2.4"
name: 需求优先级
phase: inception
execution: CONDITIONAL
lead_agent: aidlc-product-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces: []
sensors: []
completion_contract: instruction_only
requires: [requirements-analysis]
---
# 优先级排序（标准 + 全面深度）

**加载条件**：标准深度和全面深度时加载本文件。最小深度跳过。

**核心原则**：需求必须有明确的优先级，指导后续设计和实现的顺序。

---

## MoSCoW 模型（标准 + 全面深度）

将所有需求分为四类：

| 级别 | 含义 | 标准 |
|------|------|------|
| **Must Have** | 必须有 | 没有它系统无法上线，核心业务流程依赖 |
| **Should Have** | 应该有 | 重要但非关键，可以在第二版本加入 |
| **Could Have** | 可以有 | 锦上添花，有时间就做 |
| **Won't Have** | 不做 | 明确排除，避免范围蔓延 |

**执行**：
1. 列出所有已识别的需求
2. 向用户展示分类建议，逐项确认
3. 记录分类结果和决策理由

---

## RICE 评分（仅全面深度）

对 Must Have 和 Should Have 的需求进一步排序：

| 维度 | 含义 | 评分方式 |
|------|------|----------|
| **R**each（触达） | 影响多少用户 | 用户数/时间段 |
| **I**mpact（影响） | 对用户的影响程度 | 3=大 / 2=中 / 1=小 / 0.5=微小 |
| **C**onfidence（信心） | 对估计的信心 | 100%=高 / 80%=中 / 50%=低 |
| **E**ffort（工作量） | 实现所需人月 | 人月数 |

**RICE 分数 = (Reach × Impact × Confidence) / Effort**

**执行**：
1. 为每个 Must/Should 需求评估 RICE 四维度
2. 计算分数并排序
3. 向用户展示排序结果，确认优先级

**产出**：优先级排序表，写入需求文档
