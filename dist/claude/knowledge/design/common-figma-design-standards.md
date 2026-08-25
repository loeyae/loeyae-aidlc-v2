# Figma 设计稿还原规范

> **职责边界**：本文件定义 Construction 阶段**从 Figma 读取设计并还原为代码**的规范（读方向）。Inception 阶段**在 Figma 中创建设计**的流程（写方向）见 `inception-ui-figma.md`。
>
> **加载条件**：state.md 的 `## UI 设计` 区块中 `UI 设计方式` 为 `figma`。外部提供的 Figma 设计稿同样必须在 I9 登记为该方式。

## 核心原则

**设计稿是前端布局和样式的唯一真相来源。** design.md 中的布局描述仅作参考，有冲突时以 Figma 设计稿为准。design.md 不应重复描述 Figma 中已精确定义的视觉信息（gap、padding、font、color），而应聚焦技术架构和非视觉逻辑。

## 1. Figma 还原开发流程

### 1.1 自顶向下逐层解析

```
Step 1: get_metadata（页面级 nodeId）→ 获得区块划分和容器层级地图
Step 2: get_variable_defs → 获得设计变量，建立 token 对照
Step 3: get_design_context（逐个区块 nodeId）→ 获得该区块的完整布局和样式
Step 4: get_screenshot → 视觉参考，确认解析结果与实际外观一致
```

**绝不跳过任何层级。** 父容器的 background-color 和 gap 是区块间距的视觉来源，遗漏会导致间距"消失"。`get_design_context` 返回的 JSX 嵌套结构即为节点层级，逐层对照不得压平。

### 1.2 图片占位处理

当 `get_design_context` 返回的节点内部只有图片元素、且无 flex 布局类（说明 Figma 中 layout mode 为 `none`）时：

1. 标记为"图片占位"
2. **立即调用 `get_screenshot`** 进行视觉分析
3. 从截图中推断布局结构
4. 需要实际资产时调用 `download_assets`
5. 如果仍无法确定，请求用户确认

### 1.3 整体→局部→整体

```
1. 先搭建主页面骨架 → 所有容器的 layout 属性（bg, gap, padding, borderRadius）
2. 再开发各子组件 → 对每个组件的 nodeId 调用 get_design_context 提取内部结构
3. 每个子组件完成后 → 回到主页面验证整体效果
4. 最终整体对比 → get_screenshot 逐区块检查与设计稿的一致性
```

### 1.4 关键属性检查清单

每个组件开发完成后，对照此清单检查：

- [ ] 父容器 `background-color` 是否设置
- [ ] 父容器 `gap` 值是否正确
- [ ] 尺寸行为映射正确（对照 §2.3 表格，`flex-1` 已补 `min-width: 0`）
- [ ] `borderRadius` 设置在正确的层级（不依赖父容器 overflow 裁剪）
- [ ] 文字样式（fontFamily、fontWeight、fontSize、lineHeight、color）全部来自 Figma，无凭空取值
- [ ] 颜色和间距优先使用 `get_variable_defs` 返回的变量对应的项目 token，而非硬编码值
- [ ] Element Plus 组件样式覆盖使用 `:deep()` 选择器
- [ ] 组件在主页面中的 flex 属性正确（父级为 fill 的节点需要 `flex: 1`）

## 2. Figma MCP 使用规范

> **适用的 MCP**：Figma 官方 Remote MCP Server（`https://mcp.figma.com/mcp`，配置见 `mcp.json` 中的 `figma` server）。本节的工具名和返回结构均以官方契约为准，不适用于第三方 Figma MCP 实现。

### 2.1 工具选择策略

| 场景 | 工具 | 说明 |
|------|------|------|
| 不知道从哪个页面/节点入手 | `get_metadata`（不传 nodeId） | 返回文档顶层 Pages 列表 |
| 了解页面整体结构和区块划分 | `get_metadata`（传 Page 或 Frame 的 nodeId） | 返回稀疏 XML：节点 ID、名称、类型、位置、尺寸 |
| 提取节点的完整样式和布局 | `get_design_context` | 默认返回 React + Tailwind 表达，可通过提示词指定框架 |
| 提取设计变量和样式 | `get_variable_defs` | 返回选区使用的颜色、间距、字体变量 |
| 视觉参考与实现后比对 | `get_screenshot` | 单节点 PNG |
| 导出资产（图标、配图） | `download_assets` | 支持 PNG/JPG/SVG/PDF，最多 20 节点/次 |
| 已建立 Code Connect 映射 | `get_code_connect_map` | 返回 Figma 节点到代码组件的映射 |

**大型设计的处理顺序**：先 `get_metadata` 拿结构地图 → 定位需要的子节点 → 对子节点逐个 `get_design_context`。直接对整页调用 `get_design_context` 会产生过大上下文或被截断。

### 2.2 关键数据提取

**从 `get_design_context` 提取**（返回 React + Tailwind 代码）：

| 目标信息 | 在返回中的位置 |
|---------|--------------|
| 布局方向 | Tailwind `flex-row` / `flex-col` |
| 间距 | Tailwind `gap-*`、`p-*`、`m-*` |
| 对齐 | Tailwind `items-*`、`justify-*` |
| 尺寸行为 | Tailwind `flex-1`（fill）、`w-auto`（hug）、`w-[Xpx]`（fixed） |
| 圆角 | Tailwind `rounded-*` |
| 颜色 | Tailwind 颜色类或内联 `bg-[#xxxxxx]` |
| 文字样式 | Tailwind `text-*`、`font-*`、`leading-*` |
| 组件实例 | JSX 组件名和 props |

**从 `get_variable_defs` 提取**：变量名到实际值的映射，用于替换 Tailwind 中的硬编码值为项目 token。

**Tailwind 表达仅作中间表示**：`get_design_context` 的输出是设计意图的结构化表达，不是最终代码。必须按 §3 规则翻译为项目实际使用的框架和 token 体系。

### 2.3 尺寸行为到 CSS 的映射

`get_design_context` 返回的 Tailwind 类反映了 Figma 的 sizing 行为，对应关系如下：

| Figma sizing 语义 | MCP 返回的 Tailwind | 目标 CSS |
|------------------|-------------------|---------|
| `horizontal: fill` | `flex-1` / `w-full` | `flex: 1; min-width: 0` |
| `horizontal: hug` | `w-auto` / `shrink-0` | `width: auto` 或 `flex-shrink: 0` |
| `horizontal: fixed, width: X` | `w-[Xpx]` | `width: Xpx` |
| `vertical: fill` | `flex-1` / `h-full` / `self-stretch` | `flex: 1; min-height: 0`（column 布局）或 `align-self: stretch` |
| `vertical: hug` | `h-auto` | `height: auto` |
| `vertical: fixed, height: X` | `h-[Xpx]` | `height: Xpx` |

**`min-width: 0` 必须显式补充**：Tailwind 的 `flex-1` 不包含 `min-width: 0`，在 flex 容器中会导致内容溢出不收缩。翻译时必须补上。

## 3. Element Plus 组件还原规范

### 3.1 Figma Component 到 Element Plus 的映射

`get_design_context` 返回的 JSX 中，Figma 组件实例表现为具名 JSX 组件及其 props。当组件名可识别为 Element Plus 组件时，映射为对应的 `<el-xxx>`，props 按下表转换：

```
Figma 组件属性 → Element Plus props:
- Button: 文本→slot内容, type→type, style=text→link, size→size, plain→plain, round→round
- Tag: type→type, effect→effect, round→round, size→size, closable→closable
- Badge: type→type, dot=on→is-dot, value→value
- Progress: type→type, format=true→show-text, %=30→:percentage="30"
```

**已建立 Code Connect 时优先使用映射**：调用 `get_code_connect_map` 获取节点到项目实际组件的映射，直接使用返回的 `componentName` 和 `source`，不再依据组件名推测。

### 3.2 Figma 组件与前端组件的结构差异

Figma 中的组件是纯视觉的，不包含交互行为。以下场景会导致前端组件结构与 Figma 不一致，需要特别注意布局处理：

| Figma 表现 | 前端实际结构 | 布局影响 |
|-----------|-------------|---------|
| Button（带下拉菜单语义） | `el-dropdown > el-button` | dropdown 包裹层不继承 flex:1，需对 `.el-dropdown` 也设置 flex:1 |
| Button（带弹出确认框） | `el-popconfirm > el-button` | 同上，popconfirm 包裹层需处理 |
| Input（带搜索建议） | `el-autocomplete`（非 el-input） | 组件根元素不同，宽度行为不同 |
| Select（带远程搜索） | `el-select-v2` | 组件 class 不同 |

**规则**：当 Figma 中多个 Button 实例并排且尺寸行为为 fill（Tailwind `flex-1`）时，检查前端是否有按钮需要被 dropdown/popconfirm/tooltip 等包裹。如果有，必须对包裹容器也设置 `flex: 1; min-width: 0`，确保与设计稿等宽。

### 3.3 Element Plus 样式覆盖规则

- 对 Element Plus 组件的样式覆盖**必须**使用 `:deep()` 选择器（Vue scoped 样式不穿透子组件）
- 优先使用 Element Plus 的 props 控制样式（type、size、effect），避免直接覆盖 CSS
- 设计稿中的自定义颜色（如 #6E6CF5 不在 Element Plus 预设中）使用 `color` prop 或 `style` 绑定

```vue
<!-- ✅ 正确：使用 props -->
<el-tag type="warning" effect="plain" round>股权基金</el-tag>

<!-- ✅ 正确：自定义颜色用 color prop 或 style -->
<el-tag :color="'#6E6CF5'" style="border-color: #6E6CF5; color: #fff;" round>项目储备</el-tag>

<!-- ✅ 正确：样式覆盖用 :deep() -->
<style scoped>
:deep(.el-avatar) { border-radius: 100px; }
</style>

<!-- ❌ 错误：scoped 中直接写子组件类名 -->
<style scoped>
.el-avatar { border-radius: 100px; }  /* 不生效 */
</style>
```

### 3.4 Element Plus 颜色体系

设计稿中的颜色值与 Element Plus CSS 变量的对应关系：

| 色值 | Element Plus 变量 | 语义 |
|------|------------------|------|
| #409EFF | --el-color-primary | 主色 |
| #67C23A | --el-color-success | 成功 |
| #E6A23C | --el-color-warning | 警告 |
| #F56C6C | --el-color-danger | 危险 |
| #909399 | --el-color-info | 信息 |
| #303133 | --el-text-color-primary | 主要文字 |
| #606266 | --el-text-color-regular | 常规文字 |
| #909399 | --el-text-color-secondary | 次要文字 |
| #DCDFE6 | --el-border-color | 边框 |
| #EBEEF5 | --el-border-color-lighter | 浅边框/分隔线 |
| #F5F7FA | --el-fill-color-light | 悬停背景 |

## 4. design.md 中前端部分的定位

| 应该写 | 不应该写 |
|--------|---------|
| 组件职责和数据来源 | 具体的 CSS 属性值 |
| Figma nodeId 与组件的映射关系 | 字体大小、颜色、间距等样式细节 |
| 数据加载策略、分页逻辑 | 布局方向（row/column）、flex 属性 |
| 路由跳转规则 | borderRadius、padding 等数值 |
| 非视觉的交互逻辑 | 已在 Figma 中精确定义的视觉信息 |
