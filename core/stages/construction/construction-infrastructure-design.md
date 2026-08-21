---
slug: infrastructure-design
number: "3.4"
name: 基础设施设计
phase: construction
execution: CONDITIONAL
lead_agent: aidlc-architect-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces: []
sensors: []
---

# 基础设施设计

## 前置条件
- 该单元的功能设计必须完成
- 建议完成 NFR 设计（提供需映射的逻辑组件）
- 执行计划必须指示基础设施设计阶段应执行

## 概述
将逻辑软件组件映射到实际基础设施选择，用于部署环境。

## 执行步骤

### 步骤 1：分析设计产物
- 从 `docs/aidlc/construction/{unit-name}/functional-design/` 读取功能设计
- 从 `docs/aidlc/construction/{unit-name}/nfr-design/` 读取 NFR 设计（如存在）
- 识别需要基础设施的逻辑组件

### 步骤 2：创建基础设施设计计划
- 生成包含复选框 [] 的基础设施设计计划
- 聚焦映射到实际服务（AWS、Azure、GCP、本地部署）
- 每个步骤应有复选框 []

### 步骤 3：生成上下文相关的问题
**指令**：分析功能和 NFR 设计，仅生成与此特定单元基础设施需求相关的问题。使用以下类别作为灵感，而非强制清单。如不适用则跳过整个类别。

- 使用 [回答]: 标签格式嵌入问题
- 聚焦此单元特有的歧义和缺失信息
- 仅在需要用户输入进行基础设施决策时生成问题

**示例问题类别**（按需调整）：
- **部署环境** — 仅当云提供商或环境设置不清楚时
- **计算基础设施** — 仅当计算服务选择需要澄清时
- **存储基础设施** — 仅当数据库或存储选择含糊时
- **消息基础设施** — 仅当消息/队列服务需要指定时
- **网络基础设施** — 仅当负载均衡或 API 网关方式不清楚时
- **监控基础设施** — 仅当可观测性工具需要澄清时
- **共享基础设施** — 仅当基础设施共享策略含糊时

**前端基础设施维度**（如项目包含前端）：
- **前端构建配置** — Vite 配置、构建优化、代码分割策略
- **静态资源部署** — CDN 配置、Nginx 配置、资源缓存策略
- **环境变量管理** — .env 文件配置、环境区分（dev/staging/prod）

### 步骤 4：保存计划
- 保存为 `docs/aidlc/construction/plans/{unit-name}-infrastructure-design-plan.md`
- 包含所有 [回答]: 标签供用户输入

### 步骤 5：收集和分析答案
- 等待用户完成所有 [回答]: 标签
- 审查模糊或含糊的回复
- 如需要则添加后续问题

### 步骤 6：生成基础设施设计产物
- 创建 `docs/aidlc/construction/{unit-name}/infrastructure-design/infrastructure-design.md`
- 创建 `docs/aidlc/construction/{unit-name}/infrastructure-design/deployment-architecture.md`
- 如有共享基础设施：创建 `docs/aidlc/construction/shared-infrastructure.md`

**前端基础设施产物**（如为前端单元）：
- 创建 `docs/aidlc/construction/{unit-name}/infrastructure-design/frontend-build-config.md`（前端构建配置）
- 创建 `docs/aidlc/construction/{unit-name}/infrastructure-design/frontend-deployment.md`（前端部署方案）

### 步骤 7：展示完成消息
- 按以下结构展示完成消息：
     1. **完成公告**（强制）：始终以此开头：

```markdown
# 🏢 基础设施设计完成 - [unit-name]
```

     2. **AI 摘要**（可选）：提供基础设施设计的结构化要点摘要
        - 格式："基础设施设计已映射 [描述]："
        - 列出关键基础设施服务和组件（要点列表）
        - 列出部署架构决策和理由
        - 提及云提供商选择和服务映射
        - 不要包含工作流指令
        - 保持事实性和内容聚焦
     3. **格式化工作流消息**（强制）：始终以此格式结尾：

```markdown
> **📋 <u>**需要审查：**</u>**
> 请检查基础设施设计：`docs/aidlc/construction/[unit-name]/infrastructure-design/`



> **🚀 <u>**下一步？**</u>**
>
> **你可以：**
>
> 🔧 **请求修改** - 根据审查结果要求修改基础设施设计
> ✅ **继续下一阶段** - 确认基础设施设计，进入**代码生成**
> 📋 **新 Session 继续** - 复制 `state.md` 中的交接提示词到新对话继续

---
```

### 步骤 8：等待明确审批
- 在用户明确审批前不得继续
- 审批必须清晰且无歧义
- 如用户请求修改，更新设计并重复审批流程

### 步骤 9：记录审批并更新进度
- 在 audit.md 中记录审批及时间戳
- 记录用户的审批回复及时间戳
- 在 state.md 中标记基础设施设计阶段完成
