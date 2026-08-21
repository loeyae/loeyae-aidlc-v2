---
slug: workspace-detection
number: "1.1"
name: 工作区检测
phase: inception
execution: ALWAYS
lead_agent: aidlc-architect-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic, express, workshop]
consumes: []
produces: []
sensors: []
---
# 工作区检测

**目的**：确定工作区状态，检查是否存在 AI-DLC 项目

## 步骤 1：检查现有 AI-DLC 项目

检查 `docs/aidlc/state.md` 是否存在：
- **存在**：先检查 `状态模式版本` 和分布式治理字段。版本缺失/低于 2，或缺少 `分布式系统`、`系统基线`、`代码版本标识` 时，保存原阶段位置并执行定向 I1 检测；若发现分布式能力，再执行 I4 的系统级基线回填。迁移成功后必须原位补齐全部字段、写入 `状态模式版本: 2` 和迁移证据，再解除“阻塞恢复”并返回原路由；写回失败时不得继续。
- **存在且模式有效**：执行**意图路由**（参见 `core-workflow.md` 的“意图路由”章节）
  - **继续开发** → 判断架构模式和协作模式并恢复（下方逻辑）
  - **变更已有功能** → 进入 CHANGE REQUEST 流程（`core-workflow.md` 的 CR1-CR5）
  - **新增功能** → 进入新增功能追加流程（`core-workflow.md` 的"新增功能追加流程"）
  
  **恢复逻辑（继续开发）**：
  - 检查 state.md 中的"架构模式"字段
  - **多模块模式**：进入步骤 1.2（多模块恢复）
  - **单模块模式**：继续检查协作模式
    - 检查 state.md 中是否标记"协作模式：团队协作"
    - **团队协作模式**：进入步骤 1.1（团队模式判断）
    - **单人模式**：从上次阶段恢复（加载之前阶段的上下文）
- **不存在**：继续进行新项目评估

### 步骤 1.1：团队模式判断（仅单模块 + 团队协作模式）

检查当前项目的 Inception 和 Construction 状态，确定进入哪种子模式：

**A) 接力模式（Inception 阶段未完成）**：
- 读取 state.md 中的"Inception 进度"表
- 确定哪些步骤已完成、由谁完成
- 确定下一个待执行的步骤
- 展示接力恢复提示（参见步骤 7）

**B) 认领模式（Inception 阶段已完成，Construction 待开始或进行中）**：
- 读取 state.md 中的"单元认领状态"表
- 确定哪些单元待认领、哪些已被认领
- 展示认领提示（参见步骤 8）

**C) 继续开发模式（已认领单元，Construction 进行中）**：
- 读取 state.md 确认当前用户已认领的单元
- 只加载该单元相关的最小上下文
- 从上次中断处继续 Construction 流程

### 步骤 1.2：多模块恢复（仅多模块模式）

检查产品级和模块级状态：

**A) 产品级 Inception 未完成**：
- 读取 state.md 中的"产品级进度"表
- 确定下一个待执行的步骤
- 加载 `product-inception.md`，从中断处继续

**B) 产品级 Inception 已完成，进入模块选择**：
- 读取 state.md 中的"模块进度总览"
- 检查 `docs/aidlc/product/contracts.md` 的变更日志
- 展示模块菜单（参见 core-workflow.md 的"模块选择"步骤）

**C) 已有活跃模块（state.md 中"活跃模块"非空）**：
- 读取活跃模块名称
- 加载该模块的上下文：`product/contracts.md` + `modules/{name}/` 下的产出物
- 检查契约变更日志中是否有影响当前模块的未同步变更
- 如有未同步变更，提示用户（参见 `product-contracts.md` 的变更同步检查）
- 从上次中断处继续模块级工作

## 步骤 2：扫描工作区现有代码

**判断工作区是否有现有代码：**

### 后端代码扫描
- 扫描源代码文件（.java, .kt, .kts, .scala, .groovy, .py, .go, .rs, .rb, .php, .c, .h, .cpp, .hpp, .cc, .cs, .fs 等）
- 检查后端构建文件（pom.xml, build.gradle, Makefile, Cargo.toml 等）
- 识别后端项目结构指标

### Loeyae Boot Framework 检测（仅 Java 项目）

**检测条件**：项目为 Java 且使用 Maven（存在 pom.xml）

**检测方法**：
1. 读取根 pom.xml（或各子模块 pom.xml）
2. 检查以下任一条件是否满足：
   - `<parent>` 中 groupId 为 `com.loeyae.boot`
   - `<dependencies>` 或 `<dependencyManagement>` 中包含 groupId `com.loeyae.boot` 的依赖
3. 如果满足，标记 `loeyaeBootFramework = true`，并记录：
   - 框架版本（从 parent version 或 BOM version 获取）
   - 已引入的 starter 列表（如 `loeyae-spring-boot-starter-mybatis`、`loeyae-spring-boot-starter-security` 等）
   - 是否使用低代码模块（检查 `loeyae-spring-boot-starter-lowcode`）

**影响**：
- `loeyaeBootFramework = true` → Construction 阶段代码生成时加载 Loeyae Boot 编码规范和 MCP Skill
- `loeyaeBootFramework = false` → Construction 阶段按项目自身规范和适用的通用 steering 生成代码，不调用 `loeyae-*` MCP Skill

### 分布式架构能力检测（条件）

从代码、配置、部署描述和机器契约识别以下能力，不因框架依赖存在而假设已启用：
- 可独立部署单元、服务发现或网关入口；
- 跨进程同步调用与异步消息；
- 远程/共享配置及其消费者；
- 多数据所有权边界和外部系统接入。

发现任一能力时，在 state.md 记录 `分布式系统: 是`、检测证据和待确认项，并按需加载 `common-runtime-dependency-analysis.md`。检测到契约、配置或跨边界写入时，再分别加载对应通用治理规则。

检测到 Spring Cloud 或 Nacos 的可靠工作区证据时，记录 `技术适配: Spring Cloud/Nacos` 并加载 `common-tech-spring-cloud-nacos.md`；未检测到则不得套用。构建工具只记录实际入口，不预设 Maven 或 Gradle。

### 前端代码扫描
- **源代码文件**：扫描前端源代码文件（.vue, .tsx, .jsx, .ts, .js, .css, .scss, .less）
- **构建配置**：检查前端构建文件（package.json, vite.config.ts, tsconfig.json, windi.config.ts 等）
- **技术栈检测**（在 package.json 中查找核心依赖）：
  - **框架**：Vue 3, TypeScript
  - **构建工具**：Vite
  - **UI 框架**：Element Plus, Element Plus Icons
  - **状态管理**：Pinia
  - **路由**：Vue Router
  - **国际化**：Vue I18n
  - **样式**：Sass, Windi CSS, stylelint
  - **表单生成器**：@form-create/element-ui
  - **HTTP 请求**：Axios
  - **工具库**：@vueuse/core, dayjs, crypto-js, qrcode, lodash-es, province-city-china
  - **图表**：ECharts, echarts-wordcloud
  - **富文本**：@wangeditor/editor, @wangeditor/editor-for-vue
  - **图片处理**：cropperjs, vue-color
- **目录结构识别**：
  - `src/api/`（API 接口定义，按模块组织）
  - `src/components/`（全局组件）
  - `src/config/`（全局配置）
  - `src/directives/`（全局指令）
  - `src/hooks/`（Composables）
  - `src/layouts/`（布局组件）
  - `src/locales/`（国际化文件）
  - `src/permission/`（权限管理）
  - `src/router/`（路由配置）
  - `src/store/`（Pinia Store）
  - `src/styles/`（全局样式）
  - `src/types/`（类型定义）
  - `src/utils/`（工具函数）
  - `src/views/`（页面组件）
- **规范检查**：
  - 命名规范：组件文件 PascalCase, CSS类 kebab-case, 文件夹 kebab-case
  - 代码风格：2空格缩进, 单引号, 无分号, 标签属性超过2个时换行
  - 导入顺序：Vue 相关 → 第三方库 → 项目内部（@别名）→ 相对路径
  - 优先使用项目现有组件：ContentWrap, Dialog, Form, Table, UploadFile, UploadImg, Icon, Pagination
  - TypeScript 使用：避免 any 类型，使用 type 关键字导入类型

### 前端平台规范检查（存量项目）

**触发条件**：前端代码扫描检测到非纯 Web 技术栈（即技术栈非 Vue3+ElementPlus / React+AntDesign 等纯浏览器方案），如检测到 Taro、React Native、UniApp（跨端模式）、Flutter、duxapp 等跨端框架。

**检查流程**：
1. 检查 `docs/aidlc/frontend-platform-spec.md` 是否存在
2. **存在** → 记录到 state.md：`前端平台规范: 已就绪`
3. **不存在** → 在步骤 5 的完成消息中追加提示：

```markdown
• ⚠️ **前端平台规范缺失**：检测到跨端前端项目（{框架名}），但未找到 `docs/aidlc/frontend-platform-spec.md`。
  此文档用于约束 UI 设计 → 代码的翻译（组件选择、CSS 限制等），Construction 阶段代码生成前会强制检查。
  建议在 Inception 的应用设计阶段创建，或现在就建立：
  A) 我来基于 package.json 和组件库文档生成初稿，你审核
  B) 稍后在应用设计阶段再创建
```

4. 用户选择 A → 按 `construction-ui-implementation-bridge.md` 第一部分的创建引导流程执行
5. 用户选择 B → 记录到 state.md：`前端平台规范: 待创建（应用设计阶段）`，继续后续流程

**纯 Web 项目**：跳过此检查，不需要 frontend-platform-spec.md。

### 通用检查
- 查找项目结构指标
- 确定工作区根目录（非 docs/aidlc/）

**记录发现：**
```markdown
## 工作区状态
- **现有代码**：[是/否]
- **编程语言**：[发现的语言列表]
- **后端构建系统**：[Maven/Gradle/其他（如发现）]
- **后端框架**：[Loeyae Boot/Spring Boot/其他（如发现）]
- **Loeyae Boot 版本**：[版本号，仅 Loeyae Boot 时填写]
- **已引入 Starter**：[starter 列表，仅 Loeyae Boot 时填写]
- **低代码模式**：[是/否，仅 Loeyae Boot 时填写]
- **前端技术栈**：[Vue 3/React/其他/无]
- **前端 UI 框架**：[Element Plus/Ant Design Vue/其他/无]
- **前端构建工具**：[Vite/Webpack/其他/无]
- **前端类型**：[纯Web/跨端/小程序/APP/混合/无]
- **前端平台规范**：[已就绪/待创建/不需要]
- **项目结构**：[单体/微服务/库/空]
- **工作区根目录**：[绝对路径]
```

## 步骤 3：确定下一阶段

**如果工作区为空（无现有代码）**：
- 设置标志：`brownfield = false`
- **多模块模式**：下一阶段为产品级 Inception
- **单模块模式**：下一阶段为需求分析

**如果工作区有现有代码**：
- 设置标志：`brownfield = true`
- **多模块模式**：
  - 检查 `docs/aidlc/product/` 中是否存在产品级产出物
  - **如果产品级产出物存在**：进入模块选择菜单
  - **如果无产品级产出物**：下一阶段为产品级 Inception
- **单模块模式**：
  - 检查 `docs/aidlc/inception/reverse-engineering/` 中是否存在逆向工程产物
  - **如果逆向工程产物存在**：加载它们，跳到需求分析
  - **如果无逆向工程产物**：下一阶段为逆向工程

## 步骤 4：创建初始状态文件

**询问协作模式**：在创建 state.md 之前，询问用户：

```markdown
**请选择工作模式：**

A) 单人模式 — 一个人完成所有阶段
B) 团队协作模式 — 多人按角色分工协作

[回答]:
```

**询问架构模式**：

```markdown
**请选择架构模式：**

A) 单模块模式 — 产品规模较小，一个模块即可覆盖
B) 多模块模式 — 产品规模较大，需要按业务域拆分为多个独立模块并行开发

**选择建议**：
- 如果需求可以在 1-2 周内由一个人完成 → 单模块
- 如果涉及多个独立业务域（如用户管理、订单、支付）→ 多模块
- 如果需要多人并行开发不同功能 → 多模块

[回答]:
```

创建 `docs/aidlc/state.md`：

> **加载模板**：加载 `inception-state-template.md` 获取 state.md 的完整初始化模板，按模板内容创建文件并根据工作区检测结果填充占位符。

## 步骤 5：展示完成消息

**存量项目（单模块模式）：**
```markdown
# 🔍 工作区检测完成

工作区分析结果：
• **项目类型**：存量项目
• [AI 生成的工作区发现摘要，使用要点列表]
• **下一步**：进入**逆向工程**分析现有代码库...
```

**全新项目（单模块模式）：**
```markdown
# 🔍 工作区检测完成

工作区分析结果：
• **项目类型**：全新项目
• **下一步**：进入**需求分析**...
```

**全新项目（多模块模式）：**
```markdown
# 🔍 工作区检测完成

工作区分析结果：
• **项目类型**：全新项目
• **架构模式**：多模块
• **下一步**：进入**产品级 Inception**，确定模块划分和接口契约...
```

**存量项目（多模块模式）：**
```markdown
# 🔍 工作区检测完成

工作区分析结果：
• **项目类型**：存量项目
• **架构模式**：多模块
• [AI 生成的工作区发现摘要]
• **下一步**：进入**产品级 Inception**，确定模块划分和接口契约...
```

## 步骤 6：自动继续

- **无需用户确认** — 此步骤仅为信息展示
- 自动进入下一阶段：
  - **多模块模式（无产品级产出物）**：产品级 Inception
  - **多模块模式（有产品级产出物）**：模块选择菜单
  - **单模块 + 存量项目**：逆向工程（如无现有产物）或需求分析（如产物已存在）
  - **单模块 + 全新项目**：需求分析

---

## 步骤 7：接力模式恢复提示（仅团队协作模式）

当检测到团队协作模式且 Inception 未完成时，展示：

```markdown
**检测到进行中的团队协作项目。**

**Inception 进度：**
| 步骤 | 状态 | 负责人 |
|------|------|--------|
[从 state.md 读取并展示]

**下一步**：[下一个待执行的步骤]

**你要以什么角色继续？**

A) 产品经理 — [根据下一步骤描述具体工作]
B) 架构师 — [根据下一步骤描述具体工作]
C) 回顾已完成的步骤

[回答]:
```

选择角色后：
1. 更新 state.md 中的"当前操作人"
2. 只加载与当前步骤相关的前序产出物（不加载完整 audit）
3. 加载前序步骤的决策摘要（decision-summary.md）
4. 进入对应步骤

## 步骤 8：认领模式提示（仅团队协作模式）

当检测到 Inception 已完成、Construction 待开始时，展示：

```markdown
**Inception 阶段已完成，可以开始 Construction。**

**单元认领状态：**
| 单元 | 状态 | 认领人 | 前置依赖 |
|------|------|--------|----------|
[从 state.md / unit-of-work.md 读取并展示]

**你想认领哪个单元？**

[列出所有"待认领"状态的单元作为选项]

[回答]:
```

认领后：
1. 更新 `unit-of-work.md` 中该单元的状态为"已认领"
2. 更新 state.md 中的"单元认领状态"表
3. 记录认领人和特性分支名
4. 只加载该单元相关的最小上下文（参见 common-team-collaboration.md）
5. 创建特性分支（如用户确认）
6. 进入 Construction 阶段

## SSOT 集成(可选)

> 仅在配置了 SSOT 连接时按需加载,规则见 `common-ssot-integration.md`。
- I1 工作区检测时,若检测到 SSOT 连接配置(MCP url + `SSOT_API_KEY` 环境变量),按需加载 `common-ssot-integration.md` 并经 `list_projects`/`get_project` 绑定当前项目。
- 未配置 SSOT 时按未接入处理,工作区检测流程不变。
