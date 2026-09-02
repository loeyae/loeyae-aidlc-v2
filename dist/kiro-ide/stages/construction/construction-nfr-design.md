---
slug: nfr-design
number: "3.3"
name: NFR 设计
phase: construction
execution: CONDITIONAL
lead_agent: aidlc-architect-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces:
  - docs/aidlc/construction/nfr-design.md
  - docs/aidlc/construction/{unit-name}/nfr-design/nfr-design-patterns.md
  - docs/aidlc/construction/{unit-name}/nfr-design/logical-components.md
  - .aidlc/evidence/nfr-design/nfr-coverage.json
sensors: [doc-cascade, nfr-coverage]
requires: [nfr-requirements]
condition: has_nfr_needs
---

# NFR 设计

## 前置条件
- 该单元的 NFR 需求必须完成
- NFR 需求产物必须可用
- 执行计划必须指示 NFR 设计阶段应执行

## 概述
使用模式和逻辑组件将 NFR 需求融入单元设计。

## 执行步骤

### 步骤 1：分析 NFR 需求
- 从 `docs/aidlc/construction/{unit-name}/nfr-requirements/` 读取 NFR 需求
- 理解可扩展性、性能、可用性、安全需求

### 步骤 2：创建 NFR 设计计划
- 生成包含复选框 [] 的 NFR 设计计划
- 聚焦设计模式和逻辑组件
- 每个步骤应有复选框 []

### 步骤 3：生成上下文相关的问题
**指令**：分析 NFR 需求，仅生成与此特定单元 NFR 设计相关的问题。使用以下类别作为灵感，而非强制清单。如不适用则跳过整个类别。

- 使用 [回答]: 标签格式嵌入问题
- 聚焦此单元特有的歧义和缺失信息
- 仅在需要用户输入进行模式和组件决策时生成问题

**示例问题类别**（按需调整）：
- **弹性模式** — 仅当容错方式需要澄清时
- **可扩展性模式** — 仅当扩展机制不清楚时
- **性能模式** — 仅当性能优化策略含糊时
- **安全模式** — 仅当安全实现方式需要输入时
- **逻辑组件** — 仅当基础设施组件（队列、缓存等）需要澄清时

**前端 NFR 设计模式**（如项目包含前端）：
- **懒加载** — 路由懒加载、组件懒加载、图片懒加载
- **虚拟滚动** — 大列表性能优化（如 1000+ 条数据）
- **防抖/节流** — 搜索输入防抖、滚动事件节流、窗口 resize 节流
- **缓存策略** — API 响应缓存、组件缓存（keep-alive）、Store 持久化

### 步骤 4：保存计划
- 保存为 `docs/aidlc/construction/plans/{unit-name}-nfr-design-plan.md`
- 包含所有 [回答]: 标签供用户输入

### 步骤 5：收集和分析答案
- 等待用户完成所有 [回答]: 标签
- 审查模糊或含糊的回复
- 如需要则添加后续问题

### 步骤 6：生成 NFR 设计产物
- 创建 `docs/aidlc/construction/{unit-name}/nfr-design/nfr-design-patterns.md`
- 创建 `docs/aidlc/construction/{unit-name}/nfr-design/logical-components.md`

**前端 NFR 设计产物**（如为前端单元）：
- 创建 `docs/aidlc/construction/{unit-name}/nfr-design/frontend-performance-patterns.md`（前端性能模式）

### 步骤 7：展示完成消息
- 按以下结构展示完成消息：
     1. **完成公告**（强制）：始终以此开头：

```markdown
# 🎨 NFR 设计完成 - [unit-name]
```

     2. **AI 摘要**（可选）：提供 NFR 设计的结构化要点摘要
        - 格式："NFR 设计已融入 [描述]："
        - 列出实现的关键设计模式（要点列表）
        - 列出逻辑组件和基础设施元素
        - 提及应用的弹性、可扩展性和性能模式
        - 不要包含工作流指令
        - 保持事实性和内容聚焦
     3. **格式化工作流消息**（强制）：始终以此格式结尾：

```markdown
> **📋 <u>**需要审查：**</u>**
> 请检查 NFR 设计：`docs/aidlc/construction/[unit-name]/nfr-design/`



> **🚀 <u>**下一步？**</u>**
>
> **你可以：**
>
> 🔧 **请求修改** - 根据审查结果要求修改 NFR 设计
> ✅ **继续下一阶段** - 确认 NFR 设计，进入**[下一阶段名称]**
> 📋 **新 Session 继续** - 复制 `handoff.md` 中的交接提示词到新对话继续

---
```

### 步骤 8：等待明确审批
- 在用户明确审批前不得继续
- 审批必须清晰且无歧义
- 如用户请求修改，更新设计并重复审批流程

### 步骤 9：记录审批并更新进度
- 在 audit.md 中记录审批及时间戳
- 记录用户的审批回复及时间戳
- 在 handoff.md 中标记 NFR 设计阶段完成
