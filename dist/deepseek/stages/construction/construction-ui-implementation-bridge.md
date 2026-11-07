---
slug: ui-implementation-bridge
number: "3.5.0"
name: UI 实现桥接
phase: construction
axis: unit
execution: CONDITIONAL
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces:
  - docs/aidlc/modules/{module-id}/construction/{unit-id}/frontend-platform-spec.md
  - .aidlc/evidence/ui-implementation-bridge/{module-id}/{unit-id}/frontend-platform-spec.json
sensors: [frontend-platform-spec]
requires: [tdd]
condition: needs_ui_implementation_bridge
---
# UI 实现桥接 — UI 设计到平台代码的翻译流程

## 目的

定义从 UI 设计产物（HTML Mock 或 Figma 设计稿）到目标平台代码的翻译流程。解决设计产物使用 Web 语义（HTML/CSS 或 Tailwind）而目标平台（Taro/RN/Flutter 等）语义不同导致的实现偏离问题。

**本文件定义流程（做什么），不定义具体框架内容（用什么组件）。** 框架特定内容由当前单元的 `docs/aidlc/modules/{module-id}/construction/{unit-id}/frontend-platform-spec.md` 提供；不同单元不得复用彼此的门禁产物。

---

## 适用条件

以下条件**全部满足**时执行本流程：

1. 项目包含前端代码生成
2. 目标平台**非纯 Web**（即非 Vue3+ElementPlus 这类纯浏览器方案）
3. 当前模块 Markdown history 中的 I9 choice 为 `html-mock`、`figma-create` 或 `figma-existing`；`skip` 或无选择不触发

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
目标项目/docs/aidlc/modules/{module-id}/construction/{unit-id}/frontend-platform-spec.md
```

此文件由 Kiro / Claude Code / OpenCode 三入口共同读写，不依赖任何工具私有路径，并绑定当前 `stage_instance` 的模块和单元。

### 创建时机

| 项目状态 | 触发点 | 方式 |
|----------|--------|------|
| 存量项目 | ui-implementation-bridge directive | 复用已有批准的平台事实，在本阶段创建或更新单元 spec |
| 全新项目 | I13 / RED 完成后的 ui-implementation-bridge directive | 消费已批准应用设计，在本阶段创建单元 spec |

本阶段是单元 spec 及其受控证据的唯一 producer，位于 `tdd → ui-implementation-bridge → code-generation`。Inception 只产出已批准设计与平台事实，不提前写未来阶段的单元受管产物。代码生成消费并复验已有 spec；来源变化时回到本阶段更新证据。

### 必填章节

frontend-platform-spec.md 使用以下四个章节；表格只列当前单元实际需要的项，不要求填满示例行或满足固定数量。布局、组件和样式约束须是真实映射；空表、重复或占位内容不能通过。

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

### 实际覆盖与旧格式兼容

producer 和门禁读取上述既有表格的真实行，按已批准的 `inception/application-design.md`、`application-design/frontend-components.md` 中适用表格验证。单元只覆盖部分页面/组件时，在当前 spec 中引用已有文档章节，不新建审批文档：

```markdown
- design_source: docs/aidlc/modules/{module-id}/inception/application-design/frontend-components.md#当前页面
- platform_source: docs/aidlc/modules/{module-id}/inception/application-design.md#平台约束
```

被引用章节使用“布局原语 / 组件映射参考 / CSS/样式约束”或现有“组件名称 / 目标组件”等表头；名称与目标逐项映射，平台禁止写法须保留原因和替代方案。自然语言来源可在当前 spec 内附 `frontend-source-projection` fenced JSON：`source` 为上述适用引用，`source_sha256` 为引用章节原文的 SHA-256，`complete: true` 明确声明完整覆盖该范围，`rows` 每项含 `kind`（layout_primitives/component_mapping/css_constraints）、`cells`（与表格相同列顺序）及原文连续 `quote`。由已有批准事实投影，不新增批准或改写无关上游文档；逐项复核投影是否遗漏/误译。source、摘要、原文引用、实际映射及平台声明都由 producer/gate 共同复验。无法确认完整范围或含真实语义冲突时先澄清，不将解析失败视为无约束。旧四章节表格无需迁移；旧占位数组证据重新运行 producer。无来源的历史项目使用真实 spec 表格兼容路径并显式标记，不强迫其补其他页面的映射；已有来源的实际缺项仍阻断。纯 Web 的跳过条件保持不变。

### 创建引导流程

当需要创建 frontend-platform-spec.md 时，按以下步骤引导用户：

**步骤 A：收集信息**

优先读取现有已批准设计与平台事实；仅缺少必要信息时一次性向用户提问。已明确的信息不重复确认：

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

**步骤 C：复核来源并保存**

复用已有设计与平台决策的批准，不新增独立审批；仅尚未决定的实际语义冲突或用户显式要求审阅时请求确认。

---

## 第二部分：组件映射表（代码生成时产出）

### 时机

在代码生成计划的**第一步**（前端跨端项目），基于 UI 设计产物 + frontend-platform-spec.md 生成本单元的具体组件映射表。

### 输出位置

写入代码生成计划文档的头部：

```
docs/aidlc/modules/{module-id}/construction/{unit-id}/plans/code-generation-plan.md
```

### 格式

**html-mock 模式**：

```markdown
## 组件映射表

> 依据: docs/aidlc/modules/{module-id}/construction/{unit-id}/frontend-platform-spec.md
> UI 设计方式: html-mock
> 设计来源: docs/aidlc/modules/{module-id}/inception/ui-mock/{端}.html

| # | 设计区域/元素 | 设计表现 (HTML/CSS) | 目标组件 | Props/样式 | 可见性 |
|---|--------------|--------------------|---------|-----------|--------|
| 1 | ... | ... | ... | ... | 始终可见 |
| 2 | ... | ... | ... | ... | 条件: ... |
```

**figma 模式**：

```markdown
## 组件映射表

> 依据: docs/aidlc/modules/{module-id}/construction/{unit-id}/frontend-platform-spec.md
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

## 第三部分：创建、消费与复验门禁

### 检查时机

桥接 directive 内创建并验证 spec，通过受控 producer 后 report；引擎 `next` 仅在桥接完成后路由到代码生成。代码生成步骤 1.5 消费并复验，代码审查检查实现与映射一致性。

### 检查逻辑

```
IF 当前 unit 的签名执行序列实例化了 ui-implementation-bridge
AND 当前模块签名 I9 choice ∈ {html-mock, figma-create, figma-existing}
THEN:
  # 引擎的 needs_ui_implementation_bridge 已用 canonical 项目目标事实确认非纯 Web；
  # handoff.md 只展示结果，不参与本门禁判断。
  检查 docs/aidlc/modules/{module-id}/construction/{unit-id}/frontend-platform-spec.md 是否存在
  
  IF 不存在:
    ❌ 阻断代码生成
    提示: "前端平台实现规范缺失。跨端项目必须在代码生成前建立平台规范。
           请执行以下操作之一：
           A) 现在创建（我引导你完成）
           B) 真实设计决策缺失时澄清上游事实后，在桥接阶段创建"
    
  IF 存在但章节不完整（缺少必填章节）:
    ⚠️ 阻断代码生成
    提示: "frontend-platform-spec.md 缺少以下必填章节：[列出缺失项]
           请补充后再继续代码生成。"
    
  IF 存在且完整:
    ✅ 通过，继续代码生成
    加载 spec 内容到上下文
```

### 完整性校验标准

以下四类内容使用既有兼容章节/表格表达，覆盖真实适用项（不要求精确标题文本或固定行数）：
- 平台声明包含实际运行时、组件库和样式方案
- 布局原语覆盖当前单元实际需要的映射
- 组件映射覆盖适用设计中的组件
- CSS/样式约束覆盖已批准平台限制；不得为凑数量添加无关项

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
| `common-figma-design-standards.md` | 提供通用 Figma 读取契约与布局语义映射；组件库映射由真实模块事实匹配的外部知识提供 |
| `provider-offline-knowledge.md` | 按已批准模块身份、依赖版本和显式绑定加载兼容章节；不得从跨端类型或旧 handoff 标记推断框架 |
| `construction-code-generation.md` | 本阶段先产出 spec，代码生成第一步消费并复验 |
| `construction-code-review.md` | 本流程扩展其规格合规检查清单 |
