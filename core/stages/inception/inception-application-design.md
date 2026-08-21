---
slug: application-design
number: "2.7"
name: 应用设计
phase: inception
execution: CONDITIONAL
lead_agent: aidlc-architect-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces: []
sensors: []
---
# 应用设计 - 详细步骤

## 目的
**高层组件识别和应用服务/编排器设计**

应用设计聚焦于：
- 识别主要功能组件及其职责
- 定义组件接口（非详细业务逻辑）
- 设计应用服务/编排器
- 建立组件依赖和通信模式

**注意**：应用服务/编排器位于单个部署服务或应用边界内，不等同于系统基线中的独立部署服务。详细业务逻辑设计在后续功能设计中进行。

## 前置条件
- 上下文评估必须完成
- 建议完成需求评估（提供功能上下文）
- 建议完成故事开发（用户故事指导设计决策）
- 执行计划必须指示应用设计阶段应执行

## 逐步执行

### 1. 分析上下文
- 读取 `docs/aidlc/inception/requirements/requirements.md` 和 `docs/aidlc/inception/user-stories/stories.md`
- 识别关键业务能力和功能领域
- 确定设计范围和复杂度

### 2. 创建应用设计计划
- 生成包含复选框 [] 的应用设计计划
- 聚焦组件、职责、方法、业务规则和应用服务/编排器
- 每个步骤和子步骤应有复选框 []

### 3. 在计划中包含强制设计产物
- **始终**在设计计划中包含这些强制产物：
  - [ ] 生成 components.md，包含组件定义和高层职责
  - [ ] 生成 component-methods.md，包含方法签名（详细业务规则在功能设计中定义）
  - [ ] 生成 application-services.md，包含应用服务/编排器定义和编排模式
  - [ ] 生成 component-dependency.md，包含依赖关系和通信模式
  - [ ] 验证设计完整性和一致性

**分布式系统产物**（按条件）：
  - [ ] 存在跨进程调用时，引用 `<system-baseline-root>/runtime-dependencies.md` 并明确提供方、消费者和调用失败边界
  - [ ] 存在契约变化时，加载 `common-contract-governance.md`，更新机器契约及产品级索引，不在设计文档复制完整 Schema
  - [ ] 存在共享/远程配置时，加载 `common-configuration-governance.md`，设计配置作用域、消费者、版本组合和回滚
  - [ ] 存在跨数据所有权写入时，加载 `common-distributed-consistency.md`，设计业务不变量、状态转换、幂等、补偿和对账
  - [ ] 存在外部系统时，明确责任边界、超时/重复/乱序/不可用行为和验证证据

以上条件项只引用系统级基线并生成当前设计所需的增量；项目未触发时不创建空产物。检测到技术适配标志时按需加载对应适配规则，通用设计不得写死框架组件。

**前端设计产物**（如项目包含前端）：
  - [ ] 生成 frontend-components.md，包含前端组件设计：
    - 页面组件拆分（页面 → 区块 → 组件）
    - 组件层级关系和复用策略
  - [ ] 生成 frontend-routes.md，包含前端路由设计：
    - 路由结构和嵌套关系
    - 路由守卫和权限控制
    - 动态路由配置
  - [ ] 生成 api-contracts.md，包含前后端接口契约：
    - API 路径和方法
    - 请求/响应数据结构
    - 错误码定义
    - 分页/排序约定
  - [ ] 生成 state-management.md，包含状态管理设计：
    - Pinia Store 划分策略
    - 全局状态 vs 局部状态
    - Store 间依赖关系
  - [ ] **前端平台规范**（跨端项目必须）：生成 `docs/aidlc/frontend-platform-spec.md`
    - 触发条件：前端目标平台为跨端（Taro/RN/Flutter/UniApp 跨端模式等），且该文件尚不存在或 state.md 标记为"待创建"
    - 跳过条件：纯 Web 项目（PC 端 Vue3/React SPA），或文件已存在且 state.md 标记为"已就绪"
    - 执行方式：按 `construction-ui-implementation-bridge.md` 第一部分的创建引导流程
    - 产出后更新 state.md：`前端平台规范: 已就绪`

### 4. 生成上下文相关的问题
**指令**：分析需求和故事，仅生成与此特定应用设计相关的问题。使用以下类别作为灵感，而非强制清单。如不适用则跳过整个类别。

- 使用 [回答]: 标签格式嵌入问题
- 聚焦此上下文特有的歧义和缺失信息
- 仅在需要用户输入进行设计决策时生成问题

**示例问题类别**（按需调整）：
- **组件识别** — 仅当组件边界或组织不清楚时
- **组件方法** — 仅当方法签名需要澄清时（详细业务规则后续定义）
- **应用服务/编排器设计** — 仅当组件编排或边界含糊时
- **组件依赖** — 仅当通信模式或依赖管理不清楚时
- **设计模式** — 仅当架构风格或模式选择需要用户输入时
- **前端组件拆分** — 仅当页面组件层级或复用策略不清楚时
- **前后端接口契约** — 仅当 API 设计需要澄清时
- **状态管理策略** — 仅当 Store 划分或状态管理方式不清楚时

### 5. 保存应用设计计划
- 保存为 `docs/aidlc/inception/plans/application-design-plan.md`
- 包含所有 [回答]: 标签供用户输入
- 确保计划覆盖所有设计方面

### 6. 请求用户输入
- 请用户直接在计划文档中填写 [回答]: 标签
- 强调设计决策的重要性
- 提供完成 [回答]: 标签的清晰说明

### 7. 收集答案
- 等待用户使用文档中的 [回答]: 标签提供所有问题的答案
- 在所有 [回答]: 标签完成前不得继续
- 审查文档确保没有 [回答]: 标签留空

### 8. 分析答案（强制）
在继续之前，必须仔细审查所有用户答案：
- **模糊或含糊的回复**："混合"、"介于之间"、"不确定"、"取决于"
- **未定义的标准或术语**：引用未明确定义的概念
- **矛盾的答案**：相互冲突的回复
- **缺失的设计细节**：缺乏具体指导的答案
- **合并选项的答案**：混合不同方式但无清晰决策规则的回复

### 9. 强制后续问题
如果步骤 8 的分析发现任何含糊答案，必须：
- 使用 [回答]: 标签在计划文档中添加具体的后续问题
- 在所有歧义解决前不得继续审批
- **需求歧义回退**：如果发现的歧义本质上是**业务需求不清晰**（如核心业务规则未定义、用户角色职责不明、验收标准缺失），而非设计方案的技术选型，必须告知用户"此问题属于需求层面歧义，建议回到需求文档补充澄清后再继续设计"，并标记为需求回退项。不得在设计阶段自行假设需求答案。
- 需要后续问题的示例：
  - "你提到'混合 A 和 B' — 什么具体标准决定何时使用 A vs B？"
  - "你说'介于 A 和 B 之间' — 能定义确切的中间方式吗？"
  - "你表示'不确定' — 什么额外信息能帮助你决定？"
  - "你提到'取决于复杂度' — 如何定义复杂度级别？"

### 10. 生成应用设计产物
- 执行批准的计划生成设计产物
- 创建 `docs/aidlc/inception/application-design/components.md`，包含：
  - 组件名称和用途
  - 组件职责
  - 组件接口
- 创建 `docs/aidlc/inception/application-design/component-methods.md`，包含：
  - 每个组件的方法签名
  - 每个方法的高层用途
  - 输入/输出类型
  - 注意：详细业务规则将在功能设计中定义（按单元，CONSTRUCTION 阶段）
- 创建 `docs/aidlc/inception/application-design/application-services.md`，包含：
  - 应用服务/编排器定义
  - 边界内编排职责
  - 组件交互和用例编排
- 创建 `docs/aidlc/inception/application-design/component-dependency.md`，包含：
  - 显示关系的依赖矩阵（表格）
  - 组件间通信模式
  - 组件依赖图和数据流图——调用 `aidlc-diagram-design`：
    - 依赖图：`intent` = 展示组件依赖方向和职责边界；`diagram_type` = auto
    - 数据流图：`intent` = 展示数据在组件、服务和存储之间的流转；`diagram_type` = auto
    - `approved facts` = 步骤 10 已生成的组件、方法和服务定义
    - Kiro 降级：加载 `common-diagram-design-standards.md` 执行

**变更意图标记**（存量项目，按条件执行）：

触发条件：项目为存量改造（逆向工程产物存在），且设计中存在对现有组件、方法或服务的结构性变更意图。

在 `components.md`、`component-methods.md`、`component-dependency.md`、`application-services.md` 中，对每个涉及结构性变更的条目，在其名称后标注变更意图标签：

| 标签 | 含义 | 示例 |
|------|------|------|
| `[意图:删除]` | 该条目将被完全移除 | `XxxController [意图:删除]` |
| `[意图:局部重构]` | 保留条目但内部实现需重构 | `YyyService.processOrder [意图:局部重构]` |
| `[意图:收敛]` | 多个条目合并为一个 | `AaaService [意图:收敛] → BbbService` |
| `[意图:迁出]` | 迁移到其他模块或服务 | `CccHelper [意图:迁出] → common-module` |
| `[意图:废弃]` | 标记为废弃，不再接受新调用 | `DddAdapter [意图:废弃]` |

标记规则：
- 仅标记结构性变更；新增组件和无变更的现有组件不标记
- 收敛必须注明目标（`→ 目标名称`）；迁出必须注明去向
- 前端产物（`frontend-components.md`、`frontend-routes.md`）适用同一标记规范
- 标记用于 I14 设计意图覆盖检查的锚点；未标记的条目不纳入覆盖检查

**前端设计产物**（如项目包含前端）：
- 创建 `docs/aidlc/inception/application-design/frontend-components.md`，包含：
  - 页面组件拆分方案
  - 组件层级关系图——调用 `aidlc-diagram-design`：`intent` = 展示前端组件层级和复用关系；`approved facts` = 已确认的页面和组件列表
  - 公共组件复用策略
- 创建 `docs/aidlc/inception/application-design/frontend-routes.md`，包含：
  - 路由结构设计
  - 路由守卫配置
  - 动态路由方案
- 创建 `docs/aidlc/inception/application-design/api-contracts.md`，包含：
  - 前后端接口契约定义
  - 请求/响应数据结构
  - 错误码和状态码约定
- 创建 `docs/aidlc/inception/application-design/state-management.md`，包含：
  - Pinia Store 划分方案
  - 状态管理模式
  - Store 间依赖关系

**前端平台规范**（跨端项目，按条件执行）：
- 条件：state.md 中 `前端平台规范` ≠ `已就绪`，且前端目标平台为跨端
- 按 `construction-ui-implementation-bridge.md` 第一部分执行创建引导
- 创建 `docs/aidlc/frontend-platform-spec.md`，包含：
  - 平台声明（运行时、组件库、样式方案）
  - 布局原语映射表
  - 组件映射参考表
  - CSS/样式约束清单
- 产出后更新 state.md：`前端平台规范: 已就绪`

### 10.5 过渡：测试用例派生

> 应用设计产物就绪后，进入I13（测试用例派生）。该步骤由独立 steering 文件 `test-case-derivation.md` 驱动，按路由表顺序执行。
>
> 本步骤不在 `inception-application-design.md` 内部执行——完成应用设计审批后，路由表自动跳转I13。

### 11. 记录审批
- 在 `docs/aidlc/audit.md` 中记录审批提示及时间戳
- 包含完整的审批提示文本
- 使用 ISO 8601 时间戳格式

### 12. 展示完成消息

```markdown
# 🏗️ 应用设计完成

[AI 生成的应用设计产物摘要，使用要点列表]

> **📋 <u>**需要审查：**</u>**
> 请检查应用设计产物：`docs/aidlc/inception/application-design/`

> **🚀 <u>**下一步？**</u>**
>
> **你可以：**
>
> 🔧 **请求修改** - 要求修改应用设计
> [如果单元生成被跳过：]
> 📝 **添加单元生成** - 选择包含**单元生成**步骤（当前已跳过）
> ✅ **确认并继续** - 确认设计，进入**[单元生成/CONSTRUCTION 阶段]**
> 📋 **新 Session 继续** - 复制 `state.md` 中的交接提示词到新对话继续
```

### 13. 等待明确审批
- 在用户明确审批前不得继续
- 审批必须清晰且无歧义
- 如用户请求修改，更新设计并重复审批流程

### 14. 记录审批回复
- 在 `docs/aidlc/audit.md` 中记录用户的审批回复及时间戳
- 包含用户的确切回复文本
- 清晰标记审批状态

### 15. 更新进度
- 在 `docs/aidlc/state.md` 中标记应用设计阶段完成
- 更新"当前状态"部分
- 准备过渡到下一阶段

## SSOT 集成(可选)

> 仅在配置了 SSOT 连接时按需加载,规则见 `common-ssot-integration.md`。
- I12 应用设计同 I5,经 `search_documents` 检索既有过程资料/架构文档作上下文。
- 片段仅作参考,来源写入设计文档引用,不自动进入批准基线。
