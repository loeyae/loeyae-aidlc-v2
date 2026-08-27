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
| 连线 | `id`、`from`、`fromPort`、`to`、`toPort`、`kind` | `from`/`to` 引用节点 ID；端口只能为 `top`、`right`、`bottom`、`left`；`kind` 只能为 `directed`、`bidirectional`、`undirected`、`dashed`；可选 `fromPortOffset`/`toPortOffset`、`points` 与 `label`；新建/调整图的连线必须提供可审查的 `points` |
| 连线标签 | `label.text`、`label.x`、`label.y` | 标签属于其 `edge.id`，其稳定身份为 `<edge.id>#label`；`text` 为字符串或非空字符串数组，坐标是标签中心 |
| 分组 | `groups[].id`、`groups[].label`、`x`、`y`、`width`、`height` | 表达系统、泳道、角色或信任边界；可选 `tone`；新建/调整图必须增加 `semanticType`、`members`，`nested` 分组还必须有 `parent`；范围必须包围其声明的内容与标题内边距 |
| 图例 | `legend.items[]` | 可选；存在两种或以上语义化视觉编码时必填。每项必须有 `id`、`label`、`meaning`、`sample` 和 `targets`；`sample` 只引用实际节点、连线或分组，不接受 Provider 私有颜色/坐标字段 |
| 图型与设计记录 | `diagramType`、`designNotes` | 新建/调整图必填；记录单一意图、语义模式、视觉语义角色、图例决定、分组解释、拆图决定和 `layout`；详细字段见下文 |
| 注释 | `annotations[].id`、`text`、`x`、`y` | 每条注释必须有图内稳定唯一 ID；只承载辅助说明；可选 `fontSize`、`lineHeight`、`anchor`、`weight`、`tone`；独立业务事实应建模为节点、连线或分组，而不是无 ID 注释 |

### expected contract、actual 和生成器闭环

`.diagram.json`、SVG 和浏览器 inspection 都是 actual；它们相互一致不能替代独立业务期望。manifest 或 diagram entry 可以使用 `expected_contract_path`/`expectedContractPath` 作为文件引用，但不得把 manifest、SVG、sidecar、截图或 bbox 内容复制到 expected 文件。Provider Request 对每个图使用 `expected_contract_path`，没有该文件、文件不可解析或 source ref 不可追溯时，业务语义状态为 `UNVERIFIED`。

expected contract 的 `route_contract.edge_intents` 是跨图型、跨 SVG/sidecar 结构的共享协议。每条 actual edge 都必须有 expected route intent；`kind` 表示 `direct`、`manhattan`、`branch`、`loop`、`feedback`、`relation` 或 `custom` 等路由语义，`bend_count` 及范围按连续有效路径段的方向变化计算，共线点不计数；intent 可声明 `arrow_target`、`label_text`、`topology`，`topology` 可声明正交性、有效线段数和 `left/right/up/down` 方向序列，`affected_edge_ids` 定义 zoom 覆盖集合。expected 不得写入 actual 的坐标、`points`、实际几何 bbox、渲染像素或 Provider 结果。

期望例外必须使用结构化字段：`object`、`type`、`business_reason`、`geometric_reason`、`scope`、`visual_evidence`。`object` 必须能定位实际边/边对/端口；`type` 必须与实际偏离类型相符；业务原因和几何原因都必须非空；scope 必须声明图表、视图或条件；`visual_evidence.required` 必须为 `true` 且 `refs` 非空。sidecar 使用 `edgeIds`、`businessReason`、`geometricReason`、`visualEvidence.required/refs`；crossing exception 只能豁免所声明的边对。源 checker 验证对象和偏离，浏览器 Provider 验证实际几何、截图和快照，不能只验证字段存在。

每个生成的 diagram entry 必须记录：

```json
{
  "generation": {
    "generator": {"name": "<name>", "version": "<version>"},
    "config": {"summary": "<summary>", "digest": "sha256:<64-hex>"},
    "route_config": {"affected_edge_ids": ["<edge-id>"], "...": "generator input"},
    "source_refs": ["<business-source>"],
    "outputs": ["<svg-output>", "<expected-contract>", "<other-derived-output>"],
    "command_argv": ["<executable>", "<arg>"],
    "cwd": "<project-relative-cwd>"
  }
}
```

生成器或配置变更后，必须实际以 `shell: false` 执行 `command_argv`，通过 `AIDLC_DIAGRAM_ID`、`AIDLC_ROUTE_CONFIG_JSON`、`AIDLC_EXPECTED_CONTRACT_PATH` 接收上下文，重读 SVG/sidecar，并拒绝未列入 outputs 的项目文件变更；`route_config`、命令、cwd、changed files、`reloaded` 和 `/tmp` 路径证据必须进入 generation closure。然后重新生成 outputs 中的全部派生产物并重新执行 source、geometry 和 browser 受影响视图；generation provenance 缺失、不一致或 output 不完整时不得产生 `STATIC_PASS`/`PASS`。



本节只扩展 V1 的可选字段，不改变 `.diagram.json` 的 `version: 1`、`fromPort`/`toPort` 侧语义或既有业务含义：

- `fromPortOffset`、`toPortOffset`：可选有限 `number`，单位为源坐标。它们分别表示从既有 `fromPort`/`toPort` 的规范端口位置沿该逻辑侧的实际可连接边界段偏移的距离；偏移不得跨过该侧的端点、角或改变逻辑侧。正值按该边界段在 SVG 坐标系中的顺时针方向，负值反向，`0` 表示旧版规范端口位置。
- 规范端口位置继续使用既有形状/已声明 profile 的映射：矩形类边的中点、已经定义为顶点的决策端口仍是原顶点。偏移后的点必须仍落在声明的逻辑侧边界段上；若规范端口是菱形顶点或其他角点，非零偏移只有在 profile 明确指定相邻边界段和方向时才允许，否则只能使用 `0`。对 Provider 无法确定该边界段的形状，不得猜测投影；源偏移为 `0` 时可按旧端点处理，源声明非零偏移时返回 `NEEDS_CAPABILITY`。
- 同一节点同一侧的多条独立语义连线，其相邻端点沿实际边界的可读间距默认不小于 `D = max(24 个源坐标单位, 1.5 × 最小正文行高)`。中点可以是其中一个端点，但其他端点必须使用足够的偏移；相反方向关系不得因使用相同偏移而共享端点。
- `points` 的数据类型仍为非空的二维数值数组 `[[x, y], ...]`。新建或调整图的每条连线必须记录完整路径；首点和末点分别是应用端口偏移后的实际边界点，即使路径为直线也不能省略。旧 V1 资产缺少 `points` 时继续按既有默认端口解析，但完整几何证据必须标记 `MIGRATION_REQUIRED`；旧资产省略偏移字段时按 `0` 兼容解析，省略偏移本身不构成迁移，只有实际需要区分同侧端点却没有可验证偏移时才标记迁移。
- SVG 映射必须保留 `data-from-port`、`data-to-port`，并在使用偏移时保留 `data-from-port-offset`、`data-to-port-offset`；缺省偏移按 `0` 解释。连接器几何的首末点必须与这些声明对应的边界点一致。
- 静态验证必须同时检查字段类型、端点实际边界、声明侧、偏移后规范位置和 `points` 首末点；端点误差不得超过 `1` 个 SVG 坐标单位。Sequence 图的 `from`/`to` 仍引用参与者节点 ID，但消息端点的合法边界改由对应生命线定义，而不是参与者标题矩形；SVG 必须为每条生命线提供 `data-lifeline-for="<participant.id>"`，验证器据此检查消息首末点的 `x`。源坐标要求精确相等，Provider 输出允许不超过 `1` 个 SVG 坐标单位的测量误差。若无法完成实际形状/生命线边界或偏移检查，状态只能为 `UNVERIFIED`，不能降级为矩形近似后标记通过。
- Provider 不支持上述 V1 扩展时，不得静默忽略偏移、回落到边中点或重新解释 `fromPort`；Provider 必须消费已记录的显式路径并重新验证，或返回 `NEEDS_CAPABILITY`。不得为此扩展添加 Provider 私有字段。

### V1 语义扩展、字段约束与兼容策略

本次不改变 `.diagram.json` 的 `version: 1`。新增字段都是 V1 可选的向后兼容扩展，但对新建或调整的图按下列条件变为必填；旧资产继续解析不等于新规则通过，源码仓验证器必须将仍缺少本次对该图适用且必须补齐的结构化字段的旧资产标记为 `MIGRATION_REQUIRED`。

- `diagramType`：单个小写枚举值：`architecture`、`context`、`container`、`flowchart`、`pipeline`、`sequence`、`state`、`er`、`deployment`、`class`、`component`、`infrastructure`。它表达图型，不是节点 `shape`。
- `designNotes.intent`：一句话单一理解目标；`semanticModes` 为一个或多个 `static-boundary`、`static-relation`、`process-flow`、`data-flow`、`dependency-flow`、`constraint`；`visualSemantics` 为视觉通道声明数组，每项使用 `{ channel, role, reason }`，`channel` 限定为 `edge-kind`、`node-shape`、`tone`、`group-role`、`icon`，`role` 为 `semantic` 或 `decorative`。凡源中出现两个以上取值的可复用通道，必须声明其角色；`decorative` 必须说明不承载业务语义。
- `designNotes.legendDecision`：使用 `{ status, reason, noReusedSymbol?, inlineSemanticEvidence? }`。`status` 为 `required`、`exempt` 或 `not-needed`；出现语义化视觉差异时只能是 `required` 或符合设计规则的 `exempt`；豁免必须有逐对象 `inlineSemanticEvidence` 和 `noReusedSymbol: true`。
- `designNotes.splitDecision`：使用 `{ status, reason, relatedDiagramIds?, singleGoal?, staticBoundary?, processFlowDistinction?, readabilityEvidence? }`。`status` 为 `not-needed`、`split` 或 `kept-single`；Architecture/Context 与 Flowchart/Pipeline/数据流/过程依赖混合时不得为 `not-needed`。`kept-single` 必须填静态边界、过程区分和 `normal`、`fit`、`zoom` 三项阅读证据，每项为 `{ status: PASS|FAIL|UNVERIFIED, evidence }`。
- `designNotes.groupExplanations`：对 `cross-cutting` 或 `overlay` 分组提供 `{ groupId, meaning }`；也可以由图例项通过 `targets` 解释，但不能省略语义说明。
- `groups[].semanticType`：限 `exclusive`、`nested`、`cross-cutting`、`overlay`；`members` 是直接节点 ID 数组，不得把坐标包围当作成员声明；`nested` 必须有 `parent`，且嵌套深度不超过两层；`cross-cutting` 与 `overlay` 的 `members` 必须为空。
- `legend`：使用 `{ placement, title?, items }`，通用 V1 的 `placement` 仅为 `bottom`；`items` 每项为 `{ id, label, meaning, sample: { kind, ref }, targets: [{ kind, ref }] }`，`kind` 限 `node`、`edge`、`group`。`sample` 必须是 `targets` 中的对象，所有目标的可见样式必须与样本一致；目标必须能追溯到源对象。图例布局坐标由渲染器/Provider 根据实际内容计算，不在契约中添加私有坐标字段。

这些字段属于 AI-DLC 的共享语义契约，不是某个 Provider 的私有渲染字段。Provider 必须消费图例和分组语义，或明确返回 `NEEDS_CAPABILITY`；不得静默忽略字段后声称语义/视觉通过。未来若把可选字段改为所有历史资产的必填字段、改变既有字段含义或需要破坏旧消费者，必须定义 `version: 2` 并提供迁移，不得无版本化修改 V1。

本次只是 V1 的兼容增量，不静默修改仓库发布版本号；若将本次规范变化作为发布版本发布，应另按发布流程提出版本变更建议，默认评估 minor bump，且同步各平台事实入口后再执行。

### 主轴布局与注释映射契约

`designNotes.layout` 是 `.diagram.json` version `1` 的共享可选扩展；对新建或调整的 `flowchart`、`pipeline`、`sequence`、`state` 图变为必填，旧资产缺少时必须报告 `MIGRATION_REQUIRED`，不改变既有业务节点、边或稳定 ID。字段约束如下：

- `direction` 为 `TB` 或 `LR`；`mainAxis` 和 `layerTolerance` 为有限正数；`TB` 的层级轴是 `y`，`LR` 的层级轴是 `x`。
- `symmetryGroups` 为 `{ nodeIds: string[], tolerance?: number }[]`；每组至少两个节点，节点中心必须围绕 `mainAxis` 对称并处于同一层。
- `mergeNodes` 为 `{ nodeId: string, reason: string }[]`；同一节点有多个入边时必须声明为汇合节点。汇合节点可以使用合法的 `top`/`bottom` 等端口，但不改变普通分支的默认端口规则。
- `branchLayerExceptions` 和 `branchPortExceptions` 为 `{ edgeIds: string[], reason: string }[]`，只能用于跨组、显式换行、障碍避让或已确认的不同业务层级；不得用空理由绕过门禁。
- `readabilityEvidence` 必须包含 `normal`、`fit`、`zoom`，每项为 `{ status: PASS|FAIL|UNVERIFIED, evidence: string }` 且 evidence 非空。源 checker 不能仅凭该字段接受 `PASS`；没有本次真实目标环境截图/快照和可追溯 Provider 记录时必须为 `UNVERIFIED`。
- `annotations[]` 若存在，每项必须有唯一小写 kebab-case `id`、字符串 `text`、有限 `x/y`；SVG 必须一一生成 `data-note="<id>"`。允许一个说明框承载一条注释的多行文本，不允许一个 `data-note` 代表多个结构化 ID。

静态 checker 必须对上述源字段执行主轴、同层、首层对称、分支目标端口、分支最后一段方向、显式汇合和注释映射检查；Provider/浏览器必须额外检查真实边界、三视图可读性、图例/注释顺序和水平溢出。

### 语义映射与静态验证标识

静态 checker 对布局契约使用稳定错误码，调用方不得只依赖自然语言：`LAYOUT_AXIS`（方向/图例顺序）、`LAYOUT_SYMMETRY`（主轴对称）、`LAYOUT_LAYER`（同层关系）、`BRANCH_PORT`（分支端口或末段方向）、`MERGE_DECLARATION`（未声明汇合）、`ANNOTATION_MAPPING`（注释 ID 映射）、`ANNOTATION_ORDER`（注释空间顺序）、`CANVAS_CLIPPING`（画布裁切）和 `CANVAS_TOO_EMPTY`（内容过度空白）。


| 语义对象 | SVG 追溯标识 | 约束 |
|---|---|---|
| 图例 | `legend.placement`、`data-legend-item`、`data-legend-sample` | `placement` 只能为 `bottom`；每个结构化图例项都必须在 SVG 中有稳定可追溯标识；图例不计入业务节点/连线数量；图例必须位于业务主体之外且默认在注释之前 |
| 注释 | `annotations[].id`、`data-note` | 每个 `annotations[].id` 必须是图内稳定唯一的小写 kebab-case ID；SVG 中恰好存在一个对应的 `data-note`；JSON/SVG ID 集合和数量必须一致 |
| 布局 | `designNotes.layout` | 新建/调整的过程图必须声明 `direction`、`mainAxis`、`layerTolerance`、`symmetryGroups`、`mergeNodes`、分支例外和 `readabilityEvidence`；这些是共享 V1 字段，不是 Provider 私有字段 |
| 分组 | `group-<id>`、`data-group-role`、`data-group-members` | 分组 ID、语义类型和直接成员必须可由 SVG 反查；缺少新字段的旧资产只可标记迁移状态 |
| 箭头尖端 | `data-edge-arrow`、`data-arrow-target`、`data-edge` | 每个箭头尖端必须能反查所属边和目标节点/端口；双向边的两个尖端分别记录各自目标 |
| 生命线 | `data-lifeline-for`、生命线几何 `x` | `sequence` 图每个参与者生命线必须能反查参与者 ID；消息端点不得落在标题矩形，首末 `x` 必须与生命线一致 |
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

### 验证状态与 SVG 可见内容边界

`PASS`、`FAIL`、`UNVERIFIED`、`MIGRATION_REQUIRED` 和 `NEEDS_CAPABILITY` 是验收元数据，不是图表业务语义。不得将“目标 Provider / 浏览器视觉验证状态：UNVERIFIED”或等价内容写入 SVG 的可见内容，包括但不限于：

- `annotations[]`、`<text>`、图例项、角标、页脚、横幅或水印；
- `<title>`、`<desc>` 中面向图像使用者的验证状态说明；
- 为提醒使用者而添加的“未验证”“待浏览器验证”等非业务节点或注释。

这些状态必须记录在 `.aidlc/evidence/<stage-slug>/diagram-contract.json`、验收报告或 SVG 外部的相邻 Markdown/元数据中。SVG 内允许保留服务机器追溯所需的既有 `data-*` 标识，但不得依赖图内状态文字传达验收结论。`<title>` 和 `<desc>` 只描述图表本身及其业务语义，不描述 Provider 是否执行。

## 画布、文字和几何实现约束

### 画布与渲染层次

- 布局完成后，以节点、分组、文字、标签背景、路径点和箭头尖端的联合边界计算 `canvas`；画布不能预先固定后再把内容强行塞入；
- 所有可见元素必须落在 `viewBox` 内，并保留 `common-diagram-design-standards.md` 所定义的稳定内边距；
- 分组背景先于连线主体；随后严格按连线主体 → 节点及节点文字 → 边标签 → 箭头尖端 overlay → 图例绘制。箭头尖端不得依赖一个位于节点下方的 `marker-end` 保证可见；图例必须位于全部业务分组、泳道和系统边界之外，并与最外边界保留稳定间距；分组边界与标题只能使用预留留白，不能覆盖内部节点、文字、标签或箭头；
- 图例的画布范围由实际图例项、样本、文字和换行结果计算；图例超出 `viewBox`、被裁切、压入业务主体或没有最外边界间距均为几何失败；
- 连接器必须位于背景之上；标签背景与文字完整包围所属标签；节点和其文字必须保持可读，不得被分组或无关标签遮挡；
- 不得用整体缩放、负坐标裁切或把元素移出 `viewBox` 修复空间不足。应重算布局、扩展对象或拆图。

### 箭头尖端 overlay

- 箭头尖端必须作为可独立追溯的 overlay 绘制，并通过 `data-edge-arrow`、`data-edge` 和 `data-arrow-target="<node.id>:<port>"` 反查所属连线及目标端口；双向关系必须为两个方向分别追溯。
- 箭头尖端必须落在目标端口的可连接边界方向上，与目标端口和 `points` 末点一致；箭头不得悬空、深入节点内部或因路径缩短产生方向误读。
- 箭头尖端不得被节点填充、节点边框、标签或分组背景覆盖；静态源检查应验证绘制层，Provider/浏览器检查应验证实际可见性。
- 如果 Provider 不支持独立箭头 overlay，必须通过缩短主体路径、调整 marker 参数或其他已验证方式保证箭头完整可见，并重新执行端点和碰撞检查；marker 只是绘制机制，不能取代 `data-edge-arrow` 追溯。Provider 必须将 marker 所属的连接器包在等价的 `data-edge-arrow` 追溯结构中，或返回 `NEEDS_CAPABILITY`；不得通过改变颜色或增加图例掩盖箭头遮挡。

### 节点与决策文字

- 节点 `width`、`height` 根据实际标签/详情的测量宽度、行数、行高与内边距计算，不能用统一固定尺寸；
- 节点文字的可见包围盒必须完全位于节点形状的可读区域内，且与边界保留内边距；
- 菱形文字除矩形包围盒检查外，还必须满足 `textWidth / diamondWidth + textHeight / diamondHeight ≤ 0.70`；不满足时扩展菱形、拆出说明或改用其他形状；
- 文字必须作为 SVG 文本保留，常规节点字体不得低于 `14`，边标签/说明不得低于 `12` 个源字体单位；不得通过减小字体代替布局调整。

### 连线、端口与标签

- `from`、`to` 节点必须存在，`fromPort`、`toPort` 必须是有效的 `top`、`right`、`bottom` 或 `left`；新建/调整图必须显式声明端口和完整 `points`，旧资产缺失时只能进入 `MIGRATION_REQUIRED`。
- 生成器必须先检测应用端口偏移后的源边界点到目标边界点的直线路径。对非交付型图，直线不穿越实际节点形状、文字、标签、图例、无关分组或其他连线时必须使用直线；对 `delivery-business-flow`，只有同时满足水平/垂直正交约束的合法直连才使用直线，否则使用最少拐角的 Manhattan 路径。
- Manhattan 路径以最少拐角为目标；不改变方向、不绕过障碍、不完成端口连接的共线中间点必须删除。对 `flowchart` 与 `pipeline`，静态验证还必须在实际节点、标签和无关边均无碰撞时比较合法直达与一折 Manhattan 候选；存在更短候选即为 `ROUTING_MINIMALITY` 失败。声明的 `loopLanes`、真实障碍或需要保持已声明交叉/跨侧语义的路径不得因这一比较被机械压缩。
- `points` 首点必须落在 `from` 节点声明端口和偏移对应的实际可连接边界，末点必须落在 `to` 节点对应边界；对 `sequence` 图，`from`/`to` 的语义节点仍是参与者，但首末点必须落在其 `data-lifeline-for` 对应的生命线，不得落在参与者标题矩形。实际落边、端口侧和偏移声明必须一致，端点误差不得超过 `1` 个 SVG 坐标单位。目标端的倒数第二个有效路径点必须在目标实际形状外部，最后一段再沿 `toPort` 法向进入；从实体内部回折到边界即为 `PORT_APPROACH` 失败。
- 端点间距、边界合法性和碰撞检查必须使用实际节点形状；不得只用节点外接矩形替代圆角、椭圆、菱形、数据库或其他已声明形状的边界。无法执行可靠形状检查时，几何项只能为 `UNVERIFIED`。
- 单条线可以连接节点某一侧的中点；同侧多条独立关系必须使用可区分的边界偏移位置，端点间距默认不小于 `max(24, 1.5 × 最小正文行高)` 个源坐标单位。相反方向的关系不得共享同一端口坐标；只有显式 `junction`、`bus` 或共享汇合语义可以共享端点，且必须有成员关系和分支方向证据。当前通用 V1 不接受 Provider 私有总线字段。
- 不同业务关系的非端点路径段不得共享、重叠或共线混淆；共享汇合语义必须通过已有通用结构的显式汇合/关联节点、Design Notes 或拆图表达，不能用多条重叠路径伪造总线。交叉默认避免，但为保持主轴、同层业务顺序或避免更长的无意义折返而无法消除时，只允许保留已声明的必要交叉；它不得触及节点、文字、标签、箭头或关键端点，且两边的方向和语义必须可区分。
- `designNotes.layout.crossingExceptions` 可选为 `{ edgeIds: [string, string], reason: string }[]`，仅记录上述必要交叉；`edgeIds` 必须是两个不同的现有边，`reason` 必须说明为何重排或绕行反而损害主流程可读性。每个声明必须恰好命中一对实际交叉边，未声明交叉为 `EDGE_CROSSING`，引用缺失、重复、非两边或未发生的声明为 `CROSSING_EXCEPTION`。`designNotes.layout.sideSwitchExceptions` 可选为 `{ edgeIds: string[], reason: string }[]`，仅记录同侧通道无法保持的业务端口或真实避障例外；同侧跨轴折返、多次换边、引用缺失或未发生的声明分别以 `SIDE_SWITCH` / `SIDE_SWITCH_EXCEPTION` 失败。没有对应声明的交叉、跨轴折返或 S 形换边均为失败。
- 路由优先级固定为：主流程沿主轴直连 → 同侧关系保持同侧通道 → 判定的前两条分支沿垂直主轴两侧对称离开 → 其余分支在主轴前进方向的 180° 前向局域内均匀分布。`TB` 的前向方向为下方，`LR` 的前向方向为右方；单一正向出边分别优先使用 `bottom`/`right`，其正向入边分别优先使用 `top`/`left`。
- 连线靠近节点时最后一段应尽量垂直进入目标边，禁止沿节点边界长距离平行后贴边进入；确需绕障碍时要记录原因并保留可读间距。
- 连线内部路径不得穿过非源节点、非目标节点、节点文字、边标签、标签背景或图例；跨分组连线可以穿过所属分组边界，但不得穿过无关分组标题、节点或标签。
- 回边、异常、重试和反馈边应沿图外侧路由，不参与正向流程层级和等距间隔计算；流程、Sequence、State 和 Pipeline 不得使用双向关系替代返回或回退。
- 边标签背景宽高必须根据实际行数、行高和内边距计算，完整包围文字并位于所属路径旁的预留空白区域；不得覆盖节点、箭头、其他连线、其他标签或关键端点。标签自身与其他标签的相交也属于几何失败。
- 对 `sequence` 图，参与者标题矩形只显示名称，不是消息端点；消息必须连接源/目标生命线，且 SVG 中必须存在对应的 `data-lifeline-for` 生命线映射，消息首末点的源坐标 `x` 必须精确等于对应生命线的 `x`，Provider 输出允许不超过 `1` 个 SVG 坐标单位的误差。自调用从同一生命线出发并返回，请求和返回不得共享中间路径；消息文字不得压在线或覆盖其他消息。
- 文本测量、换行结果、标签背景尺寸和最终 `<text>`/`<rect>` 渲染必须来自同一标签数据，不能在渲染阶段再次追加文本。


### 图例、分组和混合图型的静态/人工边界

源码仓的通用渲染/验证脚本负责检查：多种已声明语义化连线样式缺少图例、图例目标映射、图例在业务分组外且不超出 `viewBox`、分组未声明交叠、互斥成员重复、分组标题与其他分组背景相交、Architecture/Context 与过程语义混合却缺少拆图记录，以及旧资产的 `MIGRATION_REQUIRED` 状态。

脚本不能仅凭任意 SVG 的像素或自然语言可靠判断“颜色是否承载业务含义”“标签是否完整表达语义”“真实 Provider 的字体/箭头/边界遮挡”和“业务上是否应该拆图”。这些项目必须由 Design Notes、结构化源与人工/Provider 检查共同提供证据；没有目标 Provider 时只能记录 `UNVERIFIED`。

## delivery-business-flow 几何规则

需要精确交付的业务流程图必须直接落实以下约束：

1. TD 图中，判断菱形主流程入线使用顶部主流程入端口且主流程偏移为 `0`；LR 图中使用左侧主流程入端口且主流程偏移为 `0`。除已声明 profile 明确提供等价顶点映射外，不得把主顶点沿边界移动；其他独立语义入线不得仅因方向相同而复用该精确端点，应使用合法偏移、其他边界位置或显式汇合节点；
2. 判断的两条分支分别从主流程入顶点相邻的两个顶点出；
3. 非菱形节点同一侧的单条连线可以落在边中点；多条独立入/出线必须使用不同的边界偏移位置，只有明确的 junction/bus/共享汇合语义才允许共享精确端点；
4. 多条线只允许在明确声明的共享汇合端点坐标重合；任何非零长度路径段不得重叠或共线混淆。非端点交叉不是绝对禁止项，而是低优先级优化目标：在主轴连续性、同层均衡、就近合法端口和合法最少折点 Manhattan 路径均得到优先满足后，才以最少交叉为目标；无法同时消除时，必须使用 `designNotes.layout.crossingExceptions` 记录实际边对、交点和理由；
5. 连线只能由水平和垂直线段组成，不能穿越非端点节点、标签、文字、无关分组边界或其他连线；已按上述规则声明且实际命中的必要非端点交叉除外。跨泳道/跨分组连线可以穿越其所属边界，但必须保留边界两侧的可读间距，并不得穿越无关分组标题、节点或标签；
6. 仅 Architecture、Context、Infrastructure 等明确表达双向数据互通的关系图可使用一条双端箭头路径；Flowchart、Sequence、State、Pipeline 等过程语义必须使用单向连接，返回或回退建模为另一条带标签的有向边，不得拆成两条无语义的相反线或使用双向线；
7. 每条连线记录 `from`、`fromPort`、`to`、`toPort` 和路径点；验证器据此检查共享端点、判断分支和双向关系；
8. 回退、异常或重试边沿图表外侧布置，并在源中保留明确标签；它们不能拉长正常主流程或被无标签的长斜线替代；
9. 判断文字、分支标签和边标签的边界均须纳入几何避让检查，而不是只检查节点矩形。

### 强制几何检查项

以下项目适用于能够执行源级/结构化几何检查的图表；不适用项需记录原因，无法验证项不得默认为通过：

- `from`/`to` 节点存在，`fromPort`/`toPort` 有效；
- `points` 首点落在 `from` 节点的合法实际边界，末点落在 `to` 节点的合法实际边界；
- 实际落边与 `fromPort`/`toPort` 及端口偏移一致，端点误差不超过 `1` 个 SVG 坐标单位；
- 无非端点路径段重叠；
- 无未声明、不可读或触及节点/文字/标签/箭头/关键端点的非端点路径段交叉；允许的交叉只能是已声明的必要交叉或明确声明的共享汇合端点，不能把普通关系误读为 junction/bus；
- 无连线穿过无关节点、实际节点形状、节点文字、边标签或标签背景；
- 无不必要直线折点；无不改变方向、绕障碍或完成端口连接的共线冗余路径点；
- 无同侧多边使用同一精确端点；无相反方向边共享同一端口；
- 无 `fromPort`/`toPort` 与实际几何不一致；
- 无箭头尖端被节点填充、节点边框、标签或分组背景覆盖，且箭头不悬空、不深入节点内部；
- 所有 Sequence 消息均连接到对应生命线，消息首末 `x` 与生命线 `x` 一致；
- 所有可见对象，包括路径、文字、标签背景、箭头尖端和图例，均位于 `viewBox` 内。

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

每张 SVG 源或 Provider 产物都必须分别完成下列适用验收；层级检查可以记录 **PASS**、**FAIL**、**UNVERIFIED**、**MIGRATION_REQUIRED** 或 **NEEDS_CAPABILITY**，但 `MIGRATION_REQUIRED` 只表示迁移诊断，不是图表最终状态。图表最终状态只能写入统一的 `final_status`：`PASS`、`STATIC_PASS`、`UNVERIFIED`、`NEEDS_CAPABILITY` 或 `FAIL`：

| 类别 | 必查项目 | PASS 的最低证据 |
|---|---|---|
| 结构 | SVG 可解析；`viewBox`/尺寸有效；无失效外部资源；ID、端口引用和标签归属唯一有效；图例项与所解释的节点/边/分组样式存在有效映射；分组 ID、语义类型、直接成员声明和层级关系有效；全部元素在画布内 | 实际解析/静态检查输出或可复查的脚本结果，且能从图例目标反查源对象 |
| 几何 | 节点和菱形文字未越界；路径无穿越；图例位于全部业务边界之外、未裁切且与最外边界有间距；未声明 nested/overlay/cross-cutting 的分组不交叠；分组标题/边界/背景不遮挡业务信息；标签背景覆盖多行文本；无非预期重叠、裁切或空白 | 结构化几何检查、渲染器检查或可复查的手工测量；目标 Provider 几何未执行时标记 `UNVERIFIED` |
| 语义 | 源与 SVG 的节点/边数量、ID、形状、方向、端口、分支标签、状态转换和边界一致；图例文本与实际样式、边/节点/分组的业务含义一致；互斥分组无共享成员；贯穿关注点不会被表达为业务域成员；图型混合有拆图/保留单图决策 | 源—SVG 对照记录、Design Notes、已确认事实映射和图型/分组静态检查结果 |
| 视觉 | 常规、适合窗口、放大三种状态下，图例、分组标签、连线标签及节点归属均可辨识，图例和业务主体不被裁切或遮挡 | 每种状态的目标环境、缩放、时间与截图/可定位观察记录；未执行 Provider/浏览器检查必须是 `UNVERIFIED` |

### 三视图与滚动验收

当目标 Provider 可用时，必须在 `normal`、`fit`、`zoom` 三个视图分别检查主流程方向、同层节点关系、主轴/对称、分支目标端口、节点/文字/标签/箭头可读性以及图例和注释顺序。Provider Request 可用 `target_reading_environment.viewports` 声明三个 viewport；缺少任一视图时不能把三视图视觉检查标记为完整 `PASS`。

页面纵向滚动是允许的：内容位于视口下方不构成失败，`fullPage` 截图或页面滚动后的实际目标边界仍可验证。以下情况才失败：内容被裁切、对象超出画布、内容产生水平溢出、文字或箭头不可读、图例/注释顺序错误。仅确认 DOM、SVG 尺寸或“没有滚动条”不能作为视觉 `PASS`；没有真实视图证据必须记录 `UNVERIFIED`。


- `PASS` 只表示对应结构化源或实际目标产物的该项检查有证据；脚本返回成功不能覆盖未执行的目标视觉检查。
- `MIGRATION_REQUIRED` 表示旧 V1 资产仍可解析，但缺少本次新增且对该图适用、必须补齐的端口偏移、完整路径、Sequence 生命线映射、图型/Design Notes、图例或分组结构化记录；可选偏移字段缺省并按 `0` 兼容时不单独触发迁移。它不是新规则的 `PASS`。源码仓渲染/验证命令遇到该状态必须返回非零迁移状态，不能让自动门禁把它当作成功。
- 旧资产只有在迁移后补齐 `diagramType`、`designNotes`、受影响分组字段和适用图例/豁免记录，才能按新矩阵完整验收；迁移不改变业务语义。
- 目标 Provider、浏览器、窗口适配、字体测量和真实视觉检查尚未执行时，必须列为 `UNVERIFIED`；不得用本仓脚本输出、自然语言观察或未运行的命令标记为通过。

状态定义：

- **PASS**：有实际结构、语义或几何检查证据证明对应项目通过；没有目标 Provider/浏览器证据时，箭头可见性、字体、缩放可读性和最终视觉效果不得使用此状态；
- **FAIL**：发现具体结构、语义、几何或视觉问题；必须修复源/适配并只重跑受影响检查；
- **UNVERIFIED**：尚未执行、工具不可用、目标环境不可达，或当前检查无法对实际形状/渲染行为提供证据；不得被其他检查的通过结果覆盖；
- **MIGRATION_REQUIRED**：旧 V1 资产仍可解析，但缺少本次新增且对该图适用、必须补齐的端口偏移、完整路径、Sequence 生命线映射、图型/Design Notes、图例或分组结构化记录；可选偏移字段缺省并按 `0` 兼容时不单独触发迁移。它不是 `final_status`，迁移未完成时图表 `final_status` 必须为 `UNVERIFIED`，迁移完成后重新执行五态验收；
- **NEEDS_CAPABILITY**：用户要求目标预览、渲染或导出，但没有可验证的目标 Provider；它不表示 SVG 源或语义清单不存在，也不是把未执行检查标为 `PASS` 的替代状态。

仅交付源时使用 `final_status: "STATIC_PASS"` 表示 expected、源结构和几何已通过而浏览器尚未完成；保留 `UNVERIFIED` 的浏览器视图证据。任一适用必查项为 FAIL 或 UNVERIFIED 时，不能将对应目标产物标记为完整 `PASS`；只有三个真实浏览器视图均通过并有最新截图/快照时才可为 `PASS`。兼容读取旧 `SOURCE_READY` 时只映射为 `STATIC_PASS`，旧 `DELIVERED` 不自动映射为 `PASS`。


### 过程图追踪字段与 SVG 映射扩展

对新建或调整的过程图，`designNotes.layout` 除通用方向字段外必须包含：

```json
{
  "mainFlow": {
    "entryNodeId": "start",
    "exitNodeIds": ["done"],
    "nodeIds": ["start", "done"],
    "edgeIds": ["start-done"]
  },
  "loopLanes": [
    {"id": "retry-left", "side": "left", "laneOffset": 96, "reason": "失败回路绕过主流程", "edgeIds": ["retry"]}
  ]
}
```

`entryNodeId` 与 `entryNodeIds` 二选一；`mainFlow` 必须覆盖全部业务节点和流程边，并满足入口可达性。`exitNodeIds` 表示主链完成态：它们不得有未归入 `loopLanes` 的出边，但可具有带可见标签、独立 lane 和明确原因的已声明反馈/重试边；不得为通过门禁删除合法业务回路或伪造无出边终态。`loopLanes` 的 `side` 只能为 `left`/`right`，`laneOffset` 至少为 `24`，每条回路边必须有非空标签并实际进入声明的独立外侧 lane。回路边不计入普通 merge 语义。

对既有图布局迁移，可选 `designNotes.layout.changeImpactReview`：`{ baseline, movedNodeIds, impactedEdgeIds, edgeReviews }`。它存在时必须覆盖每个移动节点的所有 incident edges；每条受影响边恰有一个 `recomputed` 或带 `unchangedReason` 的 `unchanged` 复核记录。新建图没有可靠 baseline 时不得伪造该字段。

过程图的 SVG 映射必须保持以下可反查属性：

- 业务节点：`data-node`，判定节点另须显式 `data-node-shape="diamond"`；
- 连线主体：`path[data-edge]`、`data-from`、`data-to`、`data-from-port`、`data-to-port`，有标签时使用 `data-edge-label`；
- 箭头尖端：独立的 `[data-edge-arrow]` overlay，同时保留 `data-edge` 和 `data-arrow-target="<node-id>:<port>"`；箭头 overlay 不得作为连线主体几何重复采样；
- marker 可以作为主体绘制机制，但不能替代可见的独立箭头映射；箭头必须有实际 bbox，且不能被无关节点、标签或分组遮挡。

源级结果至少应分别记录 `main_flow_valid`、`loop_lanes_valid`、`decision_exit_valid`、`edge_intersection_status`、`collinear_overlap_status`、`target_port_direction_status`、`target_port_approach_status`、`routing_minimality_status`、`side_switch_status`、`change_impact_review_status` 和 `visible_arrow_mapping_status`。这些字段只证明对应检查层，不代表浏览器三视图已执行。
