---
slug: ui-implementation-bridge
number: "3.5.4"
name: UI 实现桥接
phase: construction
execution: CONDITIONAL
lead_agent: aidlc-developer-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces:
  - docs/aidlc/frontend-platform-spec.md
sensors: [frontend-platform-spec]
requires: [code-generation]
condition: has_ui_requirements
---
# UI 实现桥接 — UI 设计到平台代码的翻译流程

## 目的

定义从 UI 设计产物（HTML Mock 或 Figma 设计稿）到目标平台代码的翻译流程。解决设计产物使用 Web 语义（HTML/CSS 或 Tailwind）而目标平台（Taro/RN/Flutter 等）语义不同导致的实现偏离问题。

**本文件定义流程（做什么），不定义具体框架内容（用什么组件）。** 框架特定内容由项目级 `docs/aidlc/frontend-platform-spec.md` 提供。

---

## 适用条件

以下条件**全部满足**时执行本流程：

1. 项目包含前端代码生成
2. 目标平台**非纯 Web**（即非 Vue3+ElementPlus 这类纯浏览器方案）
3. 存在 UI 设计产物（state.md 的 `## UI 设计` 区块中 `UI 设计方式` 为 `html-mock` 或 `figma`）

**纯 Web 项目**（PC 端 Vue3、React SPA 等）：CSS 语义与设计产物一致，无需跨端翻译层（组件映射表 + frontend-platform-spec.md），跳过本流程的第一至第三部分。

⚠️ **纯 Web ≠ 不对齐设计**：纯 Web 项目仍必须执行以下视觉还原约束（定义在 `construction-code-generation.md` 步骤 12 和 `construction-code-review.md` Spec Axis 中）：
- Mock/设计稿中的样式值（色值、圆角、字号、间距、字体）是视觉实现的唯一权威来源
- 项目存在全局设计 token 文件（如 `style-anchor.css`）时，组件样式必须引用对应 CSS 变量，禁止硬编码等效值
- 禁止使用 UI 框架默认色值（如 Element Plus #409EFF、Material #1a73e8）替代设计稿定义的品牌色
- 本文件第四部分「代码审查扩展 — Mock 一致性检查」对纯 Web 同样适用（跳过"布局原语组件"和"CSS 约束禁止列表"两项即可）

---

## 第一部分：前端平台规范文档（frontend-platform-spec.md）

### 文件位置（三工具通用）

```
目标项目/docs/aidlc/frontend-platform-spec.md
```

此文件由 Kiro / Claude Code / OpenCode 三入口共同读写，不依赖任何工具私有路径。

### 创建时机

| 项目状态 | 触发点 | 方式 |
|----------|--------|------|
| 存量项目 | workspace detection 检测到前端技术栈 | 检查是否存在 → 不存在则引导创建 |
| 全新项目 | application design 确定技术选型后 | 作为应用设计产物之一产出 |

### 必填章节

frontend-platform-spec.md **必须**包含以下四个章节，缺少任何一个视为不完整：

```markdown
# 前端平台实现规范

## 1. 平台声明
- 运行时: [Taro 3.x / React Native / Flutter / ...]
- 组件库: [duxui / NutUI / NativeBase / ...]
- 组件库版本: [x.x.x]
- 样式方案: [Taro StyleSheet / StyleSheet / Tailwind RN / ...]
- 文档地址: [组件库官方文档 URL]

## 2. 布局原语
| 视觉意图 | 目标组件 | 等价 CSS | 备注 |
|----------|---------|----------|------|
| 横向排列 | ... | flex-direction: row | ... |
| 纵向排列 | ... | flex-direction: column | ... |
| 网格布局 | ... | display: grid | ... |
| 固定定位 | ... | position: fixed | ... |
| 滚动容器 | ... | overflow: auto | ... |
| 安全区适配 | ... | — | ... |

## 3. 组件映射参考
| UI 概念 | 目标组件 | 关键 Props | 备注 |
|---------|---------|-----------|------|
| 文本输入 | ... | ... | ... |
| 按钮 | ... | ... | ... |
| 图片 | ... | ... | ... |
| 列表 | ... | ... | ... |
| 弹窗/对话框 | ... | ... | ... |
| 导航栏 | ... | ... | ... |
| 标签页 | ... | ... | ... |
| 下拉选择 | ... | ... | ... |
| 开关 | ... | ... | ... |
| 加载状态 | ... | ... | ... |

## 4. CSS/样式约束
| 禁止写法 | 原因 | 替代方案 |
|----------|------|----------|
| ... | ... | ... |
```

### 创建引导流程

当需要创建 frontend-platform-spec.md 时，按以下步骤引导用户：

**步骤 A：收集信息**

向用户提问（一次性）：

```markdown
检测到前端项目需要建立平台实现规范。请提供以下信息：

1. **目标平台和框架**：（如 Taro 3.x + React Native）
2. **使用的组件库**：（如 duxui、NutUI、TDesign Mobile）
3. **组件库文档地址**：（URL，用于查阅组件列表）
4. **已知的样式限制**：（如果你已知道哪些 CSS 不能用，列出来；不知道可留空，我来查阅文档补充）

或者：
- 提供已有的规范文档 / 组件库文档链接，我来整理为标准格式
```

**步骤 B：生成初稿**

基于用户提供的信息 + 组件库文档（通过 web_fetch 获取），生成 frontend-platform-spec.md 初稿。

**步骤 C：用户确认**

展示初稿，用户确认或修改后保存。

---

## 第二部分：组件映射表（代码生成时产出）

### 时机

在代码生成计划的**第一步**（前端跨端项目），基于 UI 设计产物 + frontend-platform-spec.md 生成本单元的具体组件映射表。

### 输出位置

写入代码生成计划文档的头部：

```
docs/aidlc/construction/plans/{unit-name}-code-generation-plan.md
```

### 格式

**html-mock 模式**：

```markdown
## 组件映射表

> 依据: docs/aidlc/frontend-platform-spec.md
> UI 设计方式: html-mock
> 设计来源: docs/aidlc/inception/ui-mock/{端}.html

| # | 设计区域/元素 | 设计表现 (HTML/CSS) | 目标组件 | Props/样式 | 可见性 |
|---|--------------|--------------------|---------|-----------|--------|
| 1 | ... | ... | ... | ... | 始终可见 |
| 2 | ... | ... | ... | ... | 条件: ... |
```

**figma 模式**：

```markdown
## 组件映射表

> 依据: docs/aidlc/frontend-platform-spec.md
> UI 设计方式: figma
> 设计来源: [Figma 文件链接] / Frame: [Frame 名称] (nodeId: x:xxx)

| # | 设计区域/元素 | 设计表现 (get_design_context 输出) | 目标组件 | Props/样式 | 可见性 |
|---|--------------|----------------------------------|---------|-----------|--------|
| 1 | ... | ... | ... | ... | 始终可见 |
| 2 | ... | ... | ... | ... | 条件: ... |
```

figma 模式下"设计表现"列填写从 `get_design_context` 返回的 Tailwind 类推导出的布局语义（如 `flex-row gap-2` → 横向排列间距 8px），不直接抄录 Tailwind 类。Tailwind 到目标平台的翻译依据 `common-figma-design-standards.md` §2.3。

### 映射规则

1. **设计中可见 = 默认始终渲染**：UI 设计中出现的元素，实现中默认始终渲染。除非设计中显式标注了条件可见性规则（html-mock 模式为 `【条件可见：...】`；figma 模式为 Frame 上的 Annotation），否则禁止在代码中添加条件渲染逻辑。

2. **禁止多余元素**：代码中不得出现映射表未列出的 UI 元素（功能性非可视代码除外）。

3. **组件选择依据 frontend-platform-spec.md**：映射表中的"目标组件"必须来自 spec 的"布局原语"或"组件映射参考"章节。如 spec 未覆盖，需先补充 spec 再映射。

4. **CSS 约束强制执行**：映射时检查设计中的样式写法是否命中 spec 的"CSS/样式约束"禁止列表，命中则必须使用替代方案。

---

## 第三部分：前置门禁（Construction 硬检查）

### 检查时机

前端代码生成的**步骤 2（MCP Skill 加载）之前**。

### 检查逻辑

```
IF state.md 中"前端技术栈" ≠ 空
AND state.md 中"前端类型" ∈ {跨端, 小程序, APP, 混合}（即非纯Web）
THEN:
  检查 docs/aidlc/frontend-platform-spec.md 是否存在
  
  IF 不存在:
    ❌ 阻断代码生成
    提示: "前端平台实现规范缺失。跨端项目必须在代码生成前建立平台规范。
           请执行以下操作之一：
           A) 现在创建（我引导你完成）
           B) 回退到 Inception 补充"
    
  IF 存在但章节不完整（缺少必填章节）:
    ⚠️ 阻断代码生成
    提示: "frontend-platform-spec.md 缺少以下必填章节：[列出缺失项]
           请补充后再继续代码生成。"
    
  IF 存在且完整:
    ✅ 通过，继续代码生成
    加载 spec 内容到上下文
```

### 完整性校验标准

以下四个一级标题必须存在且非空：
- `## 1. 平台声明`（至少包含运行时和组件库两项）
- `## 2. 布局原语`（至少 3 行映射）
- `## 3. 组件映射参考`（至少 5 行映射）
- `## 4. CSS/样式约束`（至少 3 条约束）

---

## 第四部分：代码审查扩展（Mock 一致性检查）

Construction 代码审查的**规格合规阶段**，对前端跨端项目增加以下检查项：

### UI 设计一致性检查清单

- [ ] 组件映射表中每个元素在代码中都有对应实现
- [ ] 代码中不存在映射表未声明的额外 UI 元素
- [ ] 条件渲染逻辑与映射表"可见性"列一致（无标注 = 始终渲染）
- [ ] 所有 CSS/样式属性未命中 frontend-platform-spec.md 的禁止列表
- [ ] 布局方向使用 spec 中的布局原语组件（而非手写 flex-direction）
- [ ] 间距/圆角/阴影等使用组件 Props 或 spec 指定的方式实现

### 不通过处理

任何一项不通过 → 标记为规格合规失败 → 必须修复后重新审查。

---

## 附录：与已有流程的关系

| 已有文件 | 本文件的关系 |
|---------|------------|
| `inception-ui-mock.md` | 产出 HTML Mock → 本流程消费 mock-box 做映射 |
| `inception-ui-figma.md` | 产出 Figma 设计稿 → 本流程消费 Frame 做映射 |
| `common-figma-design-standards.md` | 提供 Figma MCP 读取契约和 Tailwind→CSS 映射 → figma 模式下本流程依赖它获取设计表现，两者串联而非互斥；该文件的 Element Plus 章节仅纯 Web 项目适用 |
| `common-tech-frontend-uniapp.md` | UniApp 编码规范 → 可与本流程并行使用 |
| `construction-code-generation.md` | 本流程嵌入其前端步骤模板第一步 |
| `construction-code-review.md` | 本流程扩展其规格合规检查清单 |
