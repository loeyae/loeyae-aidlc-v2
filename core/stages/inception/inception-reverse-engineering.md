---
slug: reverse-engineering
number: "2.1"
name: 逆向工程
phase: inception
execution: CONDITIONAL
lead_agent: aidlc-developer-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces: [docs/aidlc/inception/reverse-engineering.md]
sensors: []
requires: [workspace-detection]
approval: notify
---
# 逆向工程

**目的**：分析现有代码库，生成全面的设计产物

本文要求的图表通过调用 `aidlc-diagram-design` 生成；每张具有不同语义目的的图单独调用，传入逆向工程已验证的事实作为 approved facts。Kiro Power 形态降级为直接加载 `common-diagram-design-standards.md` 执行。本文件只定义各产物需要表达的业务和架构关系，不定义图类型选择、Mermaid 语法或布局规则。

**执行条件**：检测到存量项目（工作区中发现现有代码）

**跳过条件**：全新项目（无现有代码）

**重新执行行为**：检测到存量项目时默认重新执行。**跳过条件**：如果逆向工程产物已存在且用户确认代码未发生重大变化，可以跳过（询问用户："逆向工程产物已存在，代码是否有重大变化需要重新分析？"）

## 步骤 1：多包发现

### 1.1 扫描工作区
- 所有包（不仅是提到的）
- 通过配置文件发现包关系
- 包类型：应用、CDK/基础设施、模型、客户端、测试

### 1.2 理解业务上下文
- 系统整体实现的核心业务
- 每个包的业务概述
- 系统中实现的业务事务列表

### 1.3 基础设施发现
- CDK 包（package.json 中含 CDK 依赖）
- Terraform（.tf 文件）
- CloudFormation（.yaml/.json 模板）
- 部署脚本

### 1.4 构建系统发现
- 构建系统：Maven, Gradle, npm, pnpm
- 构建系统声明的配置文件
- 包之间的构建依赖

### 1.5 服务架构发现
- Lambda 函数（处理器、触发器）
- 容器服务（Docker/ECS 配置）
- API 定义（Smithy 模型、OpenAPI 规范）
- 数据存储（DynamoDB, S3 等）

### 1.6 代码质量分析
- 编程语言和框架
- 测试覆盖率指标
- Lint 配置
- CI/CD 流水线

### 1.7 前端代码分析

**扫描前端目录结构：**
- `src/views/` — 页面级组件
- `src/components/` — 公共组件
- `src/api/` — API 接口定义
- `src/store/` 或 `src/stores/` — 状态管理（Pinia）
- `src/router/` — 路由配置
- `src/utils/` — 工具函数
- `src/types/` — TypeScript 类型定义
- `src/locales/` — 国际化文件

**识别前端架构：**
- Vue 组件结构（页面组件、业务组件、公共组件层级）
- 路由配置（路由表、路由守卫、动态路由）
- Store 定义（Pinia Store 划分、状态管理模式）
- API 调用关系（接口定义、请求拦截器、响应处理）
- 前端构建配置（Vite 配置、环境变量、代理设置）

## 步骤 2：生成业务概述文档

创建 `docs/aidlc/inception/reverse-engineering/business-overview.md`：

```markdown
# 业务概述

## 业务上下文图
[Mermaid 图展示业务上下文]

## 业务描述
- **业务描述**：[系统整体业务描述]
- **业务事务**：[系统实现的业务事务列表及描述]
- **业务词典**：[系统遵循的业务词典术语及含义]

## 组件级业务描述
### [包/组件名称]
- **用途**：[从业务角度描述其功能]
- **职责**：[关键职责]
```

## 步骤 3：生成架构文档

创建 `docs/aidlc/inception/reverse-engineering/architecture.md`：

```markdown
# 系统架构

## 系统概述
[系统高层描述]

## 架构图
[Mermaid 图展示所有包、服务、数据存储、关系]

## 组件描述
### [包/组件名称]
- **用途**：[功能描述]
- **职责**：[关键职责]
- **依赖**：[依赖项]
- **类型**：[应用/基础设施/模型/客户端/测试]

## 数据流
[Mermaid 时序图展示关键工作流]

## 集成点
- **外部 API**：[列表及用途]
- **数据库**：[列表及用途]
- **第三方服务**：[列表及用途]

## 基础设施组件
- **CDK 栈**：[列表及用途]
- **部署模型**：[描述]
- **网络**：[VPC、子网、安全组]
```

## 步骤 4：生成代码结构文档

创建 `docs/aidlc/inception/reverse-engineering/code-structure.md`：

```markdown
# 代码结构

## 构建系统
- **类型**：[Maven/Gradle/npm/pnpm]
- **配置**：[关键构建文件和设置]

## 关键类/模块
[Mermaid 类图或模块层级]

### 现有文件清单
[列出所有源文件及其用途 — 这些是存量项目中可能修改的候选文件]

**示例格式**：
- `[文件路径]` - [用途/职责]

## 设计模式
### [模式名称]
- **位置**：[使用位置]
- **用途**：[使用原因]
- **实现**：[实现方式]

## 关键依赖
### [依赖名称]
- **版本**：[版本号]
- **用法**：[使用方式和位置]
- **用途**：[需要原因]
```

## 步骤 5：生成 API 文档

创建 `docs/aidlc/inception/reverse-engineering/api-documentation.md`：

```markdown
# API 文档

## REST API
### [端点名称]
- **方法**：[GET/POST/PUT/DELETE]
- **路径**：[/api/path]
- **用途**：[功能描述]
- **请求**：[请求格式]
- **响应**：[响应格式]

## 内部 API
### [接口/类名称]
- **方法**：[方法签名列表]
- **参数**：[参数描述]
- **返回类型**：[返回类型描述]

## 数据模型
### [模型名称]
- **字段**：[字段描述]
- **关系**：[关联模型]
- **校验**：[校验规则]
```

## 步骤 6：生成前端架构文档

创建 `docs/aidlc/inception/reverse-engineering/frontend-architecture.md`：

```markdown
# 前端架构

## 技术栈
- **框架**：[Vue 3/React/其他]
- **UI 框架**：[Element Plus/Ant Design Vue/其他]
- **构建工具**：[Vite/Webpack]
- **状态管理**：[Pinia/Vuex]
- **路由**：[Vue Router]

## 组件树
[Mermaid 图展示组件层级关系]

### 页面组件（views/）
- `[页面路径]` - [页面用途]

### 公共组件（components/）
- `[组件路径]` - [组件用途]

## 路由表
### [路由模块名称]
- **路径**：[路由路径]
- **组件**：[对应组件]
- **权限**：[权限要求]

## API 调用关系
### [API 模块名称]
- **基础路径**：[API 前缀]
- **接口列表**：[接口方法及用途]
- **调用方**：[哪些页面/组件调用]

## Store 定义
### [Store 名称]
- **状态**：[管理的状态数据]
- **操作**：[关键 actions]
- **使用方**：[哪些组件使用]
```

## 步骤 7：生成组件清单

创建 `docs/aidlc/inception/reverse-engineering/component-inventory.md`：

```markdown
# 组件清单

## 应用包
- [包名称] - [用途]

## 基础设施包
- [包名称] - [CDK/Terraform] - [用途]

## 共享包
- [包名称] - [模型/工具/客户端] - [用途]

## 测试包
- [包名称] - [集成/负载/单元] - [用途]

## 前端模块
- [模块名称] - [页面/组件/Store] - [用途]

## 总计
- **总包数**：[数量]
- **应用**：[数量]
- **基础设施**：[数量]
- **共享**：[数量]
- **测试**：[数量]
- **前端模块**：[数量]
```

## 步骤 8：生成技术栈文档

创建 `docs/aidlc/inception/reverse-engineering/technology-stack.md`：

```markdown
# 技术栈

## 编程语言
- [语言] - [版本] - [用途]

## 后端框架
- [框架] - [版本] - [用途]

## 前端框架
- [框架] - [版本] - [用途]

## 基础设施
- [服务] - [用途]

## 构建工具
- [工具] - [版本] - [用途]

## 测试工具
- [工具] - [版本] - [用途]
```

## 步骤 9：生成依赖文档

创建 `docs/aidlc/inception/reverse-engineering/dependencies.md`：

```markdown
# 依赖关系

## 内部依赖
[Mermaid 图展示包依赖关系]

### [包 A] 依赖 [包 B]
- **类型**：[编译/运行时/测试]
- **原因**：[依赖存在的原因]

## 外部依赖
### [依赖名称]
- **版本**：[版本]
- **用途**：[使用原因]
- **许可证**：[许可证类型]
```

## 步骤 10：生成代码质量评估

创建 `docs/aidlc/inception/reverse-engineering/code-quality-assessment.md`：

```markdown
# 代码质量评估

## 测试覆盖率
- **整体**：[百分比或 好/一般/差/无]
- **单元测试**：[状态]
- **集成测试**：[状态]

## 代码质量指标
- **Lint**：[已配置/未配置]
- **代码风格**：[一致/不一致]
- **文档**：[好/一般/差]

## 技术债务
- [问题描述和位置]

## 模式与反模式
- **良好模式**：[列表]
- **反模式**：[列表及位置]
```

## 步骤 10.5：建立系统级基线（条件）

检测到分布式架构能力时执行；单进程且无外部运行时依赖时跳过并记录依据。

1. 加载 `common-runtime-dependency-analysis.md`，在 `<system-baseline-root>/` 生成服务目录、运行时依赖和外部系统目录。
2. 存在跨边界接口或事件时加载 `common-contract-governance.md`，将机器契约位置、消费者和兼容状态写入产品级契约索引。
3. 存在共享/远程配置时加载 `common-configuration-governance.md`，生成配置清单与消费者反向索引。
4. 存在跨数据所有权写入时加载 `common-distributed-consistency.md`，生成一致性场景基线。
5. 记录存量定制边界：上游/原始版本标识、已知定制区域、禁止覆盖区域及升级证据；未知项标记待确认，不得猜测。
6. 检测到技术适配标志时加载对应适配规则，仅用于提取事实，不改变上述通用产物结构。

多模块/多服务项目的系统级基线只在产品级维护；模块级逆向仅引用与当前模块相关的切片。实际路径以 `common-directory-structure.md` 为准。

## 步骤 11：创建时间戳文件

创建 `docs/aidlc/inception/reverse-engineering/reverse-engineering-timestamp.md`：

```markdown
# 逆向工程元数据

**分析日期**：[ISO 时间戳]
**分析器**：AI-DLC
**工作区**：[工作区路径]
**分析文件总数**：[数量]

## 生成的产物
- [x] business-overview.md
- [x] architecture.md
- [x] code-structure.md
- [x] api-documentation.md
- [x] frontend-architecture.md
- [x] component-inventory.md
- [x] technology-stack.md
- [x] dependencies.md
- [x] code-quality-assessment.md
```

## 步骤 12：更新状态跟踪

更新 `docs/aidlc/state.md`：

```markdown
## 逆向工程状态
- [x] 逆向工程 - 完成于 [时间戳]
- **产物位置**：docs/aidlc/inception/reverse-engineering/
```

## 步骤 13：向用户展示完成消息

```markdown
# 🔍 逆向工程完成

[AI 生成的分析关键发现摘要，使用要点列表]

> **📋 <u>**需要审查：**</u>**
> 请检查逆向工程产物：`docs/aidlc/inception/reverse-engineering/`

> **🚀 <u>**下一步？**</u>**
>
> **你可以：**
>
> 🔧 **请求修改** - 如需修改逆向工程分析结果
> ✅ **确认并继续** - 确认分析结果，进入**需求分析**
> 📋 **新 Session 继续** - 复制 `state.md` 中的交接提示词到新对话继续
```

## 步骤 14：等待用户确认

- **强制**：在用户明确确认前不得继续
- **强制**：在 audit.md 中记录用户的完整原始回复

## SSOT 集成(可选)

> 仅在配置了 SSOT 连接时按需加载,规则见 `common-ssot-integration.md`。
- I4 逆向工程阶段可通过 `search_documents`/`retrieve_context` 检索 SSOT 中的既有文档作为参考上下文。
- AI-DLC 不直接写入 SSOT;逆向工程产物保留在本地。
