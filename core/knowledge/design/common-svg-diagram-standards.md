# SVG 图表标准

## 目的与适用范围

SVG 是本仓图表的目标源格式，但本标准不规定 AIDLC 必须生成静态交付物。AIDLC 负责按 Blueprinter 设计规则生成可审阅的 SVG 源，并可生成可选的 `.diagram.json` 语义伴随清单和 Provider Request；外部 Provider 负责实际预览、渲染、导出及目标环境视觉检查。业务语义、是否需要图以及粒度选择仍由 `common-diagram-design-standards.md` 决定。

本标准不绑定 draw.io、MCP 或任一第三方 Provider，也不把本仓脚本设为默认运行路径；外部工具只是可能的 SVG Provider，不改变本仓的事实、几何和验收规则。

## 资产位置与来源契约

### 源资产位置（按需）

当调用方要求保存 SVG 源或语义伴随清单时，对于位于 `<dir>/<document>.md` 的图表，优先使用：

- SVG 源：`<dir>/assets/<diagram>.svg`；
- 可选语义伴随清单：`<dir>/assets/<diagram>.diagram.json`；
- Markdown 引用：只有目标环境需要时才添加 `![简短用途说明](assets/<diagram>.svg)`；该引用不代表 Provider 已完成目标环境渲染。

Provider 生成的静态 SVG、PNG 或 PDF 是目标交付物，路径由目标环境或 Provider Request 决定，不被 AIDLC 规定为必须与源文件同级。一个 `assets/` 目录可以包含同一目录下多个 Markdown 的相关源和伴随清单；每个文件都必须可追溯到唯一的图表 ID、目标文档和 Provider Request（如有）。

### 通用结构化源的统一字段

通用 `.diagram.json` 使用版本 `1`。字段名称必须遵循本仓统一语义契约，且在提示词、SVG 源、可选语义清单、Provider 适配和源码仓可选回归工具之间保持一致；不得因某个 Provider 或脚本自行改名：

| 层级 | 必填字段 | 含义与约束 |
|---|---|---|
| 清单 | `version`、`document`、`diagrams` | `version` 为 `1`；`document` 指向关联 Markdown；每个图只出现一次 |
| 图 | `id`、`output`、`title`、`description`、`canvas`、`nodes` | `id` 和 `output` 在同一清单唯一；`canvas` 使用 `{ width, height }`；`output` 为同级 SVG 文件名；新建/调整图还必须提供 `diagramType` 和结构化 `designNotes`，旧 V1 资产可缺省但只能标记为迁移状态 |
| 节点 | `id`、`shape`、`label`、`x`、`y`、`width`、`height` | `shape` 只能为 `round`、`rect`、`diamond`、`ellipse`、`database`、`actor`、`note`；`label` 为字符串或非空字符串数组；可选 `details`、`fontSize`、`tone` |
| 连线 | `id`、`from`、`fromPort`、`to`、`toPort`、`kind` | `from`/`to` 引用节点 ID；端口只能为 `top`、`right`、`bottom`、`left`；`kind` 只能为 `directed`、`bidirectional`、`undirected`、`dashed`；可选 `points` 与 `label` |
| 连线标签 | `label.text`、`label.x`、`label.y` | 标签属于其 `edge.id`，其稳定身份为 `<edge.id>#label`；`text` 为字符串或非空字符串数组，坐标是标签中心 |
| 分组 | `groups[].id`、`groups[].label`、`x`、`y`、`width`、`height` | 表达系统、泳道、角色或信任边界；可选 `tone`；新建/调整图必须增加 `semanticType`、`members`，`nested` 分组还必须有 `parent`；范围必须包围其声明的内容与标题内边距 |
| 图例 | `legend.items[]` | 可选；存在两种或以上语义化视觉编码时必填。每项必须有 `id`、`label`、`meaning`、`sample` 和 `targets`；`sample` 只引用实际节点、连线或分组，不接受 Provider 私有颜色/坐标字段 |
| 图型与设计记录 | `diagramType`、`designNotes` | 新建/调整图必填；记录单一意图、语义模式、视觉语义角色、图例决定、分组解释和拆图决定；详细字段见下文 |
| 注释 | `annotations[].text`、`x`、`y` | 只承载辅助说明；可选 `fontSize`、`lineHeight`、`anchor`、`weight`、`tone`；独立业务事实应建模为节点、连线或分组，而不是无 ID 注释 |

### V1 语义扩展、字段约束与兼容策略

本次不改变 `.diagram.json` 的 `version: 1`。新增字段都是 V1 可选的向后兼容扩展，但对新建或调整的图按下列条件变为必填；旧资产继续解析不等于新规则通过，源码仓验证器必须将仍缺少本次结构化字段的所有旧资产标记为 `MIGRATION_REQUIRED`。

- `diagramType`：单个小写枚举值：`architecture`、`context`、`container`、`flowchart`、`pipeline`、`sequence`、`state`、`er`、`deployment`、`class`、`component`、`infrastructure`。它表达图型，不是节点 `shape`。
- `designNotes.intent`：一句话单一理解目标；`semanticModes` 为一个或多个 `static-boundary`、`static-relation`、`process-flow`、`data-flow`、`dependency-flow`、`constraint`；`visualSemantics` 为视觉通道声明数组，每项使用 `{ channel, role, reason }`，`channel` 限定为 `edge-kind`、`node-shape`、`tone`、`group-role`、`icon`，`role` 为 `semantic` 或 `decorative`。凡源中出现两个以上取值的可复用通道，必须声明其角色；`decorative` 必须说明不承载业务语义。
- `designNotes.legendDecision`：使用 `{ status, reason, noReusedSymbol?, inlineSemanticEvidence? }`。`status` 为 `required`、`exempt` 或 `not-needed`；出现语义化视觉差异时只能是 `required` 或符合设计规则的 `exempt`；豁免必须有逐对象 `inlineSemanticEvidence` 和 `noReusedSymbol: true`。
- `designNotes.splitDecision`：使用 `{ status, reason, relatedDiagramIds?, singleGoal?, staticBoundary?, processFlowDistinction?, readabilityEvidence? }`。`status` 为 `not-needed`、`split` 或 `kept-single`；Architecture/Context 与 Flowchart/Pipeline/数据流/过程依赖混合时不得为 `not-needed`。`kept-single` 必须填静态边界、过程区分和 `normal`、`fit`、`zoom` 三项阅读证据，每项为 `{ status: PASS|FAIL|UNVERIFIED, evidence }`。
- `designNotes.groupExplanations`：对 `cross-cutting` 或 `overlay` 分组提供 `{ groupId, meaning }`；也可以由图例项通过 `targets` 解释，但不能省略语义说明。
- `groups[].semanticType`：限 `exclusive`、`nested`、`cross-cutting`、`overlay`；`members` 是直接节点 ID 数组，不得把坐标包围当作成员声明；`nested` 必须有 `parent`，且嵌套深度不超过两层；`cross-cutting` 与 `overlay` 的 `members` 必须为空。
- `legend`：使用 `{ placement, title?, items }`，通用 V1 的 `placement` 仅为 `bottom`；`items` 每项为 `{ id, label, meaning, sample: { kind, ref }, targets: [{ kind, ref }] }`，`kind` 限 `node`、`edge`、`group`。`sample` 必须是 `targets` 中的对象，所有目标的可见样式必须与样本一致；目标必须能追溯到源对象。图例布局坐标由渲染器/Provider 根据实际内容计算，不在契约中添加私有坐标字段。

这些字段属于 AI-DLC 的共享语义契约，不是某个 Provider 的私有渲染字段。Provider 必须消费图例和分组语义，或明确返回 `NEEDS_CAPABILITY`；不得静默忽略字段后声称语义/视觉通过。未来若把可选字段改为所有历史资产的必填字段、改变既有字段含义或需要破坏旧消费者，必须定义 `version: 2` 并提供迁移，不得无版本化修改 V1。

本次只是 V1 的兼容增量，不静默修改仓库发布版本号；若将本次规范变化作为发布版本发布，应另按发布流程提出版本变更建议，默认评估 minor bump，且同步各平台事实入口后再执行。

### 语义映射与静态验证标识

| 语义对象 | SVG 追溯标识 | 约束 |
|---|---|---|
| 图例 | `data-legend-item`、`data-legend-sample` | 每个结构化图例项都必须在 SVG 中有稳定可追溯标识；图例不计入业务节点/连线数量 |
| 分组 | `group-<id>`、`data-group-role`、`data-group-members` | 分组 ID、语义类型和直接成员必须可由 SVG 反查；缺少新字段的旧资产只可标记迁移状态 |
| Design Notes | 结果记录或清单中的 `designNotes` | 源结构、图例决定、分组关系、图型混合和拆图证据必须能定位到同一图表 ID |

### 结构化语义的最小验证

静态验证至少执行以下规则：图例样本和目标引用存在且样式一致；语义通道的每个取值都有图例覆盖或有合规豁免；分组类型、直接成员和 `parent` 引用有效；嵌套无环且深度不超过两层；互斥分组不共享节点；允许的交叠仅限声明的嵌套、覆盖或贯穿关注点；图例布局不与业务节点/分组相交且全部在 `viewBox` 内；图型与 `semanticModes` 的混合情况有拆图决策。Provider/浏览器无法执行的检查必须标为 `UNVERIFIED`，不能由本地脚本的源检查代替。

ID 规则：

1. 同一图内图、节点、连线和分组的 ID 必须稳定、唯一且推荐使用小写 kebab-case；不同类别也不得复用同一语义 ID；
2. 端口不单独建模为对象时，以 `<node.id>:<port>` 作为稳定端口身份；每条边必须显式声明 `fromPort` 和 `toPort`；
3. 标签不得另造无关联的 ID：边标签通过 `<edge.id>#label` 追溯，节点标签通过 `<node.id>#label` 追溯；
4. 文本、端口、关系和分组 ID 的规范化必须幂等。重复运行处理不能新增后缀、复制括号说明或生成视觉重复节点；
5. 结构检查必须验证节点、连线和分组 ID 的唯一性，以及端口引用和标签归属的有效性。当前 Provider 未自动覆盖的检查必须明确记录为手工/脚本检查，而非假定通过。

布局计算、文本测量、换行、标签尺寸计算和 SVG 源生成必须消费同一份结构化语义数据。外部 Provider 可以基于该源重新完成目标环境所需的文字测量、最终坐标和渲染；AIDLC 不要求自身重渲染，也不把 Provider 输出当作新的业务事实来源。若 Provider 输出与源不一致，应修复 SVG 源、可选语义清单或 Provider 适配映射，并重新执行受影响验收。

### 可审阅源与视觉风格的边界

通用结构化源记录业务语义和已支持的几何字段，不接受未实现的“手绘”私有字段。轻量视觉表现必须来自已验证的 Provider 或已支持的节点形状、色调和路径规则；它不能改变 `shape`、`from`、`to`、端口、方向、标签或 ID 的事实含义。

禁止手工直接修改最终 SVG 来掩盖 SVG 源或 Provider 问题。若 Provider 输出与源不一致、不能表达需要的可读布局或无法验证，应修复源/Provider，返回 `NEEDS_CAPABILITY`，或经用户同意降级为文字/表格。

### 严格流程的 Provider 扩展

`delivery-business-flow` 默认仍使用本节的通用结构化源。Provider 确有更严格的流程几何源格式时，只能作为**已声明的扩展 profile**使用：调用方必须在 `constraints` 与 `Design Notes` 中记录 profile 名称、版本、源路径、与通用节点/边/端口/标签/分组语义的字段映射，以及对应验证器。

不得把未声明的 `kind`、`mainInputPort`、`label.lines` 或其他 Provider 私有字段当作通用契约，也不得让第二套源格式绕过源—SVG、语义和验收记录。无法提供版本化 profile、映射和验证器时，返回 `NEEDS_CAPABILITY` 或使用通用契约，不宣称严格流程已通过。

## 源码仓可选回归工具

本仓保留以下脚本作为源码仓的可选维护和回归工具，不属于 AIDLC 默认运行路径，也不代表 Kiro、Claude Code 或 OpenCode 已具备 SVG Provider：

```bash
node scripts/render-svg-diagrams.mjs <input.diagram.json> <output-assets-directory>
node scripts/render-all-svg-diagrams.mjs
node scripts/render-delivery-business-flow-svg.mjs
node scripts/validate-svg-diagrams.mjs
```

对应的 npm 命令（如 `render:svg-diagrams`、`validate:svg-diagrams`）只在源码仓具备脚本和依赖时使用，且必须由用户或维护流程明确选择。它们可以帮助维护现有 `.diagram.json`—SVG 资产对，并执行本标准列出的新增源级图例/分组/图型检查；其 PASS 只证明本地脚本执行了声明的检查，不证明任何外部 Provider、目标浏览器或平台运行时已验证 SVG 的字体、真实边界、窗口适配或视觉可读性。缺少新语义字段的旧资产会显示 `MIGRATION_REQUIRED`，不等同于新图完整通过。Kiro Power 安装产物不携带 `scripts/`，因此不能据此宣称安装后能自行生成、预览或重渲染 SVG。

## 静态安全与可访问性

SVG 必须是静态、独立和安全的：

- 必须包含有效、非零的 `viewBox`、与其一致的 `width`/`height`、`role="img"`、唯一的 `<title>` 与 `<desc>`；
- 节点和连线必须分别保留稳定的 `data-node`、`data-edge` 标识；分组通过源 `groups[].id` 与 SVG `group-<id>` 追溯，分组语义/成员通过 `data-group-role`、`data-group-members` 追溯，边标签通过 `data-edge-label` 与边 ID 追溯，图例通过 `data-legend-item`、`data-legend-sample` 追溯；
- 禁止 `<script>`、事件属性、`<foreignObject>`、外部图片、外部样式、远程字体和外部链接承载关键语义；
- 不得把关键文字放入栅格图、`foreignObject` 或无法缩放的贴图；
- 图像加载失败时，正文、表格或编号步骤仍要保留理解关键事实的最小文本证据。

## 画布、文字和几何实现约束

### 画布与渲染层次

- 布局完成后，以节点、分组、文字、标签背景、路径点和箭头尖端的联合边界计算 `canvas`；画布不能预先固定后再把内容强行塞入；
- 所有可见元素必须落在 `viewBox` 内，并保留 `common-diagram-design-standards.md` 所定义的稳定内边距；
- 分组背景先于连接器、节点和标签绘制；随后按连接器、节点及节点文字、边标签、图例的顺序绘制；图例必须位于全部业务分组、泳道和系统边界之外，并与最外边界保留稳定间距；分组边界与标题只能使用预留留白，不能覆盖内部节点、文字、标签或箭头；
- 图例的画布范围由实际图例项、样本、文字和换行结果计算；图例超出 `viewBox`、被裁切、压入业务主体或没有最外边界间距均为几何失败；
- 连接器必须位于背景之上；标签背景与文字完整包围所属标签；节点和其文字必须保持可读，不得被分组或无关标签遮挡；
- 不得用整体缩放、负坐标裁切或把元素移出 `viewBox` 修复空间不足。应重算布局、扩展对象或拆图。

### 节点与决策文字

- 节点 `width`、`height` 根据实际标签/详情的测量宽度、行数、行高与内边距计算，不能用统一固定尺寸；
- 节点文字的可见包围盒必须完全位于节点形状的可读区域内，且与边界保留内边距；
- 菱形文字除矩形包围盒检查外，还必须满足 `textWidth / diamondWidth + textHeight / diamondHeight ≤ 0.70`；不满足时扩展菱形、拆出说明或改用其他形状；
- 文字必须作为 SVG 文本保留，常规节点字体不得低于 `14`，边标签/说明不得低于 `12` 个源字体单位；不得通过减小字体代替布局调整。

### 连线、端口与标签

- `edges[].points` 存在时，第一个点必须与 `from`/`fromPort` 的端口坐标一致，最后一个点必须与 `to`/`toPort` 的端口坐标一致；
- 对交付型流程，路径只能由水平和垂直段组成。其他图型即使允许自然路径，也必须通过节点、文字、分组和标签避让检查；
- 连线的非端点路径段不得与非端点节点、节点文本、分组边界、无关边标签或其他非共享路径段相交；
- 回边、异常、重试和反馈边应沿图外侧路由，不参与正向流程层级和等距间隔计算；
- 边标签背景宽高必须由其实际行数、行高与四周内边距计算，完整覆盖 `label.text` 的所有行，并放置在所属路径一侧或预留的无连接器区域；不得覆盖所属或无关连线、关键端点、箭头、节点或其他业务信息；
- 文本测量、换行结果、标签背景尺寸和最终 `<text>`/`<rect>` 渲染必须来自同一标签数据，不能在渲染阶段再次追加文本。

### 图例、分组和混合图型的静态/人工边界

源码仓的通用渲染/验证脚本负责检查：多种已声明语义化连线样式缺少图例、图例目标映射、图例在业务分组外且不超出 `viewBox`、分组未声明交叠、互斥成员重复、分组标题与其他分组背景相交、Architecture/Context 与过程语义混合却缺少拆图记录，以及旧资产的 `MIGRATION_REQUIRED` 状态。

脚本不能仅凭任意 SVG 的像素或自然语言可靠判断“颜色是否承载业务含义”“标签是否完整表达语义”“真实 Provider 的字体/箭头/边界遮挡”和“业务上是否应该拆图”。这些项目必须由 Design Notes、结构化源与人工/Provider 检查共同提供证据；没有目标 Provider 时只能记录 `UNVERIFIED`。

## delivery-business-flow 几何规则

需要精确交付的业务流程图必须直接落实以下约束：

1. TD 图中，判断菱形主流程入线共同落在顶部顶点；LR 图中共同落在左侧顶点；
2. 判断的两条分支分别从主流程入顶点相邻的两个顶点出；
3. 非菱形节点同一侧的一条或多条入/出线共同落在该侧边中点；
4. 多条线只允许在声明的同一节点端口坐标重合；任何非零长度路径段不得重叠；
5. 连线只能由水平和垂直线段组成，不能穿越非端点节点、标签、文字、分组边界或其他连线；
6. 仅 Architecture、Context、Infrastructure 等明确表达双向数据互通的关系图可使用一条双端箭头路径；Flowchart、Sequence、State、Pipeline 等过程语义必须使用单向连接，返回或回退建模为另一条带标签的有向边，不得拆成两条无语义的相反线或使用双向线；
7. 每条连线记录 `from`、`fromPort`、`to`、`toPort` 和路径点；验证器据此检查共享端点、判断分支和双向关系；
8. 回退、异常或重试边沿图表外侧布置，并在源中保留明确标签；它们不能拉长正常主流程或被无标签的长斜线替代；
9. 判断文字、分支标签和边标签的边界均须纳入几何避让检查，而不是只检查节点矩形。

## Provider 边界

AIDLC 负责：

- 按 Blueprinter 规则组织 SVG 源；
- 对已确认事实、源结构、稳定 ID、方向、端口、连通性和可表达的几何约束执行语义/契约检查；
- 根据目标操作生成 Provider Request，并如实记录能力状态；
- 在没有目标 Provider 时保留源检查结果，不伪造渲染或视觉通过。

外部 Provider 负责：

- 消费 SVG 源和可选语义伴随清单；
- 实际文字测量、最终布局、SVG 预览/渲染、PNG/PDF 导出；
- 在目标浏览器、编辑器或交付容器中执行视觉检查并返回证据。

只有实际执行成功且范围明确的 Provider 才能被标为“已验证”。本仓可选回归脚本的通过结果不能代替 Kiro Preview、Claude Code、OpenCode、draw.io、浏览器或其他目标环境的验证。Provider 不可用时：若用户只要求源或设计，交付源并将目标几何/视觉状态标记为 `UNVERIFIED`；若用户明确要求目标渲染、预览或导出，返回 `NEEDS_CAPABILITY`，并保留已生成的源和检查结果；不得静默安装工具或回退为 Mermaid/ASCII 图。

Kiro Power 无内置 SVG Provider 时，只能引用安装包中已有的静态 SVG；需要新图或重渲染时必须由已验证 Provider、源码仓可选命令或用户提供的工具完成。相关状态必须如实记录为“UNVERIFIED”。

## 验收顺序与证据

验收对象分为两种：

- **仅有 SVG 源**：可以对源结构、静态安全、事实映射、ID、方向、端口、连通性和声明路径执行检查；实际 Provider 几何、目标环境渲染和视觉检查标记 `UNVERIFIED`；
- **已有 Provider 目标产物**：对 Provider 返回的静态 SVG/PNG/PDF 及其目标环境执行完整的结构、几何、语义和视觉矩阵。

每张 SVG 源或 Provider 产物都必须分别完成下列适用验收，并在结果中逐项标记 **PASS**、**FAIL** 或 **UNVERIFIED**：

| 类别 | 必查项目 | PASS 的最低证据 |
|---|---|---|
| 结构 | SVG 可解析；`viewBox`/尺寸有效；无失效外部资源；ID、端口引用和标签归属唯一有效；图例项与所解释的节点/边/分组样式存在有效映射；分组 ID、语义类型、直接成员声明和层级关系有效；全部元素在画布内 | 实际解析/静态检查输出或可复查的脚本结果，且能从图例目标反查源对象 |
| 几何 | 节点和菱形文字未越界；路径无穿越；图例位于全部业务边界之外、未裁切且与最外边界有间距；未声明 nested/overlay/cross-cutting 的分组不交叠；分组标题/边界/背景不遮挡业务信息；标签背景覆盖多行文本；无非预期重叠、裁切或空白 | 结构化几何检查、渲染器检查或可复查的手工测量；目标 Provider 几何未执行时标记 `UNVERIFIED` |
| 语义 | 源与 SVG 的节点/边数量、ID、形状、方向、端口、分支标签、状态转换和边界一致；图例文本与实际样式、边/节点/分组的业务含义一致；互斥分组无共享成员；贯穿关注点不会被表达为业务域成员；图型混合有拆图/保留单图决策 | 源—SVG 对照记录、Design Notes、已确认事实映射和图型/分组静态检查结果 |
| 视觉 | 常规、适合窗口、放大三种状态下，图例、分组标签、连线标签及节点归属均可辨识，图例和业务主体不被裁切或遮挡 | 每种状态的目标环境、缩放、时间与截图/可定位观察记录；未执行 Provider/浏览器检查必须是 `UNVERIFIED` |

### 回归状态和证据边界

- `PASS` 只表示对应结构化源或实际目标产物的该项检查有证据；脚本返回成功不能覆盖未执行的目标视觉检查。
- `MIGRATION_REQUIRED` 表示旧 V1 资产仍可解析，但缺少本次新增的图例/分组/图型结构化记录；它不是新规则的 `PASS`。源码仓渲染/验证命令遇到该状态必须返回非零迁移状态，不能让自动门禁把它当作成功。
- 旧资产只有在迁移后补齐 `diagramType`、`designNotes`、受影响分组字段和适用图例/豁免记录，才能按新矩阵完整验收；迁移不改变业务语义。
- 目标 Provider、浏览器、窗口适配、字体测量和真实视觉检查尚未执行时，必须列为 `UNVERIFIED`；不得用本仓脚本输出、自然语言观察或未运行的命令标记为通过。

状态定义：

- **PASS**：有实际证据证明通过；
- **FAIL**：发现具体问题；必须修复结构化源、重渲染并只重跑受影响检查；
- **UNVERIFIED**：未执行、工具不可用或目标环境不可达；不得被结构检查或其他环境的通过结果覆盖。

`NEEDS_CAPABILITY` 表示用户要求的目标预览、渲染或导出没有可验证 Provider；它不表示 SVG 源或语义清单不存在，也不是把未执行检查标为 PASS 的替代状态。仅交付源时可使用 `SOURCE_READY` 表示源和 Provider Request 已生成，同时保留适用的 `UNVERIFIED`。任一适用必查项为 FAIL 或 UNVERIFIED 时，不能将对应目标产物标记为完整通过；只有目标操作未被要求时，源交付可以在视觉项 `UNVERIFIED` 的情况下结束。
