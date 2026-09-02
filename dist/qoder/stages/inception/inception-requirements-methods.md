---
slug: requirements-methods
number: "2.2.3"
name: 需求方法
phase: inception
execution: CONDITIONAL
lead_agent: aidlc-product-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces:
  - docs/aidlc/inception/requirements/business-flows.md
  - .aidlc/evidence/requirements-methods/diagram-contract.json
sensors: [diagram-contract]
requires: [requirements-analysis]
---
# 需求方法论与业务流程图

**加载条件**：所有深度加载“业务流程图”；仅全面深度继续加载其他专业方法论。

**核心原则**：先用可追溯流程表达业务路径，再在全面深度使用专业需求工程方法发现隐含需求。

---

## 业务流程图（所有深度强制）

**产物**：`<inception-root>/requirements/business-flows.md`

按场景适用性生成：

| 图 | 条件 | 必须覆盖 |
|----|------|----------|
| 运营端操作流程图 | 存在后台或运营侧操作 | 从入口到完成，包含分支和异常 |
| C 端/最终用户流程图 | 存在最终用户交互 | 完整用户路径、反馈和异常 |
| 跨系统端到端流程图 | 涉及外部系统 | 系统边界、调用方向和数据流向 |

全部流程图通过调用 `aidlc-diagram-design` 生成。每张流程图单独调用，Diagram Request 包含：
- `source/context`：已确认的业务需求和业务规则；
- `diagram intent`：明确希望读者理解的业务行为（如"展示运营端从入口到完成的操作流程"）；
- `approved facts`：已确认的角色、步骤、系统、判定条件和异常路径；
- `diagram_type`：Flowchart（默认）或 Sequence（跨系统时序场景）；
- `target artifact`：`<inception-root>/requirements/business-flows.md`；
- `constraints`：`delivery-business-flow`。

若宿主未独立发现 `aidlc-diagram-design` capability，则直接加载随附的 `skills/aidlc-diagram-design/SKILL.md` 执行。Phase 不重复定义图类型选择、SVG 源格式或布局规则；没有已验证 Provider 时返回 `NEEDS_CAPABILITY` 或经用户同意使用文字/表格。

内容约束：

1. 每个节点使用稳定节点 ID，并映射至少一个 FR 或明确的外部系统动作；
2. 每个 FR 至少映射一个流程节点；
3. 禁止“处理业务逻辑”“进行相关操作”等无信息节点；
4. 分支边必须标注判定条件；
5. 异常路径必须在图中表达，不得只写正文；
6. `requirements.md` 必须引用本文件，并在每个 FR 标注所属节点 ID。

完成前输出节点与 FR 双向映射表；存在孤立节点或无图 FR 时不得通过 I5。

---

## 5.1 利益相关者分析（仅全面深度）

**目的**：识别所有受影响的角色，确保不遗漏关键干系人。

**Power-Interest 矩阵**：

![Power-Interest 矩阵](assets/power-interest.svg)

可审阅源：`assets/diagram-library.diagram.json`。矩阵中的角色、利益与权力判断必须基于已确认的利益相关者信息。

**产出**：利益相关者列表 + 每个角色的关注点

**执行**：
1. 识别所有受影响的角色（用户、管理者、运维、外部系统）
2. 按 Power-Interest 矩阵分类
3. 为高优先级角色列出关注点和需求来源
4. 向用户确认是否遗漏角色

---

## 5.2 用户画像

**目的**：为每个关键角色创建具体画像，理解其目标、痛点和行为。

**画像模板**：

```markdown
## 用户画像：[角色名]

### 基本信息
- **角色/职位**：[描述]
- **技术熟练度**：新手 / 中级 / 专家
- **使用频率**：每日 / 每周 / 偶尔

### 目标与动机
- 主要目标：[核心需求]
- 次要目标：[辅助需求]

### 痛点与挫折
- [痛点 1 — 严重程度：高/中/低]
- [痛点 2 — 严重程度：高/中/低]

### 使用场景
- **何时**：[使用时机/频率]
- **何地**：[环境 — 办公室、移动端等]
- **如何**：[设备、访问方式]

### 推导出的需求
1. [从该画像推导的需求]
2. [从该画像推导的需求]
```

**执行**：
1. 为每个高优先级角色创建画像（3-5 个）
2. 向用户确认画像准确性
3. 从画像中推导隐含需求

---

## 5.3 竞品分析

**目的**：了解市场现有方案，发现差异化机会。

**执行**：
1. 识别 1-3 个竞品（向用户确认）
2. 创建功能对比矩阵：

```markdown
## 竞品分析

### 功能对比矩阵

| 功能 | 我们的产品 | 竞品 A | 竞品 B |
|------|-----------|--------|--------|
| [功能 1] | ❓ 规划中 | ✅ 有 | ❌ 无 |
| [功能 2] | ❓ 规划中 | ✅ 有 | ✅ 有 |

### 差异化机会
1. [市场空白点]
2. [未被满足的用户需求]
3. [可以做得更好的地方]
```

3. 向用户确认差异化方向
