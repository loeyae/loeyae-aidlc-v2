---
slug: nfr-requirements
number: "3.2"
name: NFR 需求
phase: construction
execution: CONDITIONAL
lead_agent: aidlc-architect-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces:
  - docs/aidlc/construction/nfr-requirements.md
  - docs/aidlc/construction/{unit-name}/nfr-requirements/nfr-requirements.md
  - docs/aidlc/construction/{unit-name}/nfr-requirements/tech-stack-decisions.md
  - .aidlc/evidence/nfr-requirements/nfr-coverage.json
sensors: [nfr-coverage]
requires: [functional-design]
condition: has_nfr_needs
---

# NFR 需求

## 前置条件
- 该单元的功能设计必须完成
- 单元功能设计产物必须可用
- 执行计划必须指示 NFR 需求阶段应执行

## 概述
确定单元的非功能需求并做出技术栈选择。

## 执行步骤

### 步骤 1：分析功能设计
- 从 `docs/aidlc/construction/{unit-name}/functional-design/` 读取功能设计产物
- 理解业务逻辑复杂度和需求

### 步骤 2：创建 NFR 需求计划
- 生成包含复选框 [] 的 NFR 评估计划
- 聚焦可扩展性、性能、可用性、安全性
- 每个步骤应有复选框 []

### 步骤 3：生成上下文相关的问题
**指令**：全面分析功能设计，识别所有 NFR 澄清后能改善系统质量和架构决策的领域。主动提问以确保全面的 NFR 覆盖。

**关键**：有任何可能影响系统质量的歧义或缺失细节时，默认提出问题。宁可多问也不要做出错误的 NFR 假设。

- 使用 [回答]: 标签格式嵌入问题
- 聚焦任何歧义、缺失信息或需要澄清的领域
- 在用户输入能改善 NFR 和技术栈决策的地方生成问题
- **有疑问就提问** — 过度自信导致糟糕的系统质量

**需评估的问题类别**（考虑所有类别）：
- **可扩展性需求** — 询问预期负载、增长模式、扩展触发器和容量规划
- **性能需求** — 询问响应时间、吞吐量、延迟和性能基准
- **可用性需求** — 询问正常运行时间期望、灾难恢复、故障转移和业务连续性
- **安全需求** — 询问数据保护、合规性、认证、授权和威胁模型
- **技术栈选择** — 询问技术偏好、约束、现有系统和集成需求
- **可靠性需求** — 询问错误处理、容错、监控和告警需求
- **可维护性需求** — 询问代码质量、文档、测试和运维需求
- **可用性需求** — 询问用户体验、可访问性和界面需求

**前端 NFR 维度**（如项目包含前端）：
- **前端性能** — 首屏加载时间（FCP < 1.5s）、交互响应时间（TTI < 3s）
- **可访问性** — WCAG 基本合规、键盘导航、屏幕阅读器支持
- **浏览器兼容性** — 支持的浏览器范围和版本
- **国际化需求** — 多语言支持、RTL 布局、日期/数字格式

### 步骤 4：保存计划
- 保存为 `docs/aidlc/construction/plans/{unit-name}-nfr-requirements-plan.md`
- 包含所有 [回答]: 标签供用户输入

### 步骤 5：收集和分析答案
- 等待用户完成所有 [回答]: 标签
- **强制**：仔细审查所有回复中的模糊或含糊答案
- **关键**：对任何不清楚的回复添加后续问题 — 不带歧义继续
- 查找"取决于"、"可能"、"不确定"、"混合"、"介于之间"、"标准"、"典型"等回复
- 如检测到任何歧义则创建澄清问题文件
- **在所有歧义解决前不得继续**

### 步骤 6：生成 NFR 需求产物
- 创建 `docs/aidlc/construction/{unit-name}/nfr-requirements/nfr-requirements.md`
- 创建 `docs/aidlc/construction/{unit-name}/nfr-requirements/tech-stack-decisions.md`

### 步骤 7：展示完成消息
- 按以下结构展示完成消息：
     1. **完成公告**（强制）：始终以此开头：

```markdown
# 📊 NFR 需求完成 - [unit-name]
```

     2. **AI 摘要**（可选）：提供 NFR 需求的结构化要点摘要
        - 格式："NFR 需求评估已识别 [描述]："
        - 列出关键的可扩展性、性能、可用性需求（要点列表）
        - 列出识别的安全和合规需求
        - 提及技术栈决策和理由
        - 不要包含工作流指令
        - 保持事实性和内容聚焦
     3. **格式化工作流消息**（强制）：始终以此格式结尾：

```markdown
> **📋 <u>**需要审查：**</u>**
> 请检查 NFR 需求：`docs/aidlc/construction/[unit-name]/nfr-requirements/`



> **🚀 <u>**下一步？**</u>**
>
> **你可以：**
>
> 🔧 **请求修改** - 根据审查结果要求修改 NFR 需求
> ✅ **继续下一阶段** - 确认 NFR 需求，进入**[下一阶段名称]**
> 📋 **新 Session 继续** - 复制 `handoff.md` 中的交接提示词到新对话继续

---
```

### 步骤 8：等待明确审批
- 在用户明确审批前不得继续
- 审批必须清晰且无歧义
- 如用户请求修改，更新需求并重复审批流程

### 步骤 9：记录审批并更新进度
- 在 audit.md 中记录审批及时间戳
- 记录用户的审批回复及时间戳
- 在 handoff.md 中标记 NFR 需求阶段完成
