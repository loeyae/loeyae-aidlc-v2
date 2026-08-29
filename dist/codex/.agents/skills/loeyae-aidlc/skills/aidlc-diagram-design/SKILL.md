---
name: aidlc-diagram-design
description: "独立图表设计能力：依据 Blueprinter SVG 设计规则，根据已确认语义交付可审阅的 SVG 源、可选语义伴随清单和 Provider Request；不负责阶段路由和完成判定。"
triggers: 画图, 架构图, 流程图, 时序图, 状态图, ER 图, 部署图, diagram, architecture diagram, flowchart, sequence diagram, svg
---

# 图表设计能力

Independent Capability — not an AIDLC phase.

## 输入

调用方提供：

- **source/context**：用户描述、代码路径、文档路径或已有设计产物；
- **diagram intent**：图帮助读者理解什么；
- **diagram_type**（可选）：偏好图型，默认 `auto`；
- **output_location**：目标 Markdown 路径；SVG 源和可选语义伴随清单优先写入同级 `assets/`；
- **target_operations**（可选）：`source-only`、`preview`、`render` 或 `export`；未要求时不主动调用 Provider；未要求目标操作时最终最多为 `STATIC_PASS`，不能写成 `PASS`；
- **expected_contract**：独立 expected contract 路径或受控 Producer 输入，必须来自业务/设计来源，不能从 SVG、sidecar 或浏览器 actual 生成；
- **approved facts**：已确认的角色、步骤、系统、关系和业务规则；
- **constraints**（可选）：`delivery-business-flow` 用于面向 PRD/业务方/客户交付的流程图；
- **target_reading_environment**（可选）：目标浏览器、容器尺寸或交付环境。

缺少可靠设计图表所需的信息时返回 `NEEDS_CONTEXT`。不得推断流程状态或自行创造业务事实。

## 加载

1. 发布包中的 `knowledge/design/common-diagram-design-standards.md`；
2. 发布包中的 `knowledge/design/common-svg-diagram-standards.md`；
3. `constraints` 包含 `delivery-business-flow` 时，自动应用交付型流程约束。

历史 Mermaid 或二维文本图只在迁移时按需读取；不能作为新输出格式。

## 执行

按加载的设计标准执行完整的图表设计流程：先从可追溯业务来源生成独立 expected contract，再确定 `TB`/`LR` 主阅读方向、主轴、业务层级、首层对称组和判断分支端口；随后提取 actual 节点/边、计算实际内容边界、生成 SVG 源、`.diagram.json` 语义伴随清单、Provider Request 和 generation provenance，并执行 expected-vs-actual 源级验证。`legend` 必须省略、`annotations[]` 必须省略或为空，SVG 不得生成 `data-legend-item` 或 `data-note`；较长说明写入相邻 Markdown、Design Notes 或 evidence。route contract 的折点按方向变化次数记录，不能使用 `points.length`。生成器或配置变更后必须重新生成 expected、sidecar、SVG、Provider Request 和其他声明的派生产物，记录 generator/version、config summary/digest、source refs/outputs，再重跑受影响验收。生成器不得以固定窗口高度、整体缩放、缩小字号或压缩层级换取“一屏显示”，纵向图可以扩展画布并允许页面纵向滚动。具体步骤和验收矩阵以加载的两份规则文件为准，本文件不复制。当 `target_operations` 包含 `preview` 或浏览器侧 `render` 时，源级 `diagram-contract` evidence 的业务、结构和几何层通过且 expected 存在后调用 `loeyae-aidlc diagram-provider run --request <provider-request.json> --evidence <diagram-contract.json>`；该运行器负责常规/适合窗口/放大视图的浏览器证据采集和 evidence 状态更新，`export` 不由 Chrome DevTools Provider 承担。


## 统一视觉输出（强制）

所有新建、调整和迁移图必须输出不透明 `#ffffff` 画布；除画布外所有框体 `fill="none"`；框体、连线、箭头和可见文字统一 `#000000`；字体统一 `Microsoft YaHei, 微软雅黑, sans-serif`；框体内文字统一 `16`，边标签统一 `14`；框体和连线线宽统一 `2`；marker 与独立箭头 overlay 统一 `10 × 10` 且 marker 使用 `markerUnits="userSpaceOnUse"`。边标签必须是直接 `<text data-edge-label>`，使用 `text-anchor="middle"`、`dominant-baseline="middle"`，位于所属线段中点并沿法向保持至少 `6` 个源单位净空，禁止背景框、填充、描边、遮罩和光晕。

视觉差异必须由节点、边或分组的就地文字表达，不生成全局图例或全局备注层。有形状/线型语义差异时，`legendDecision.status` 使用 `exempt` 并提供 `inlineSemanticEvidence`；无差异时使用 `not-needed`；`required` 非法。source checker 的 `global_decorations_absent`、`visual_style_status`、`edge_label_placement_status` 必须通过；实际 Provider 还必须保证每个视图的 `visualStyleErrors` 和 `labelPlacementErrors` 为空。

## 已有图表的冗余连线修复模式

当任务是修复已有 SVG 中“直达或一折即可到达、但当前使用多余折点或外侧回路”的连线时，使用本模式。它默认是**不改变语义的局部路由修复**，不是重新设计整张图。

### 业务语义上下文

业务语义必须根据 SVG 所属文档位置的上下文获取，不得只根据线条坐标、节点文字或边的当前走向反推业务含义。按以下顺序定位上下文：

1. `.diagram.json` 的 `document`、图表输出路径和 `sourceBasis`（如有）；
2. 引用该 SVG 的 Markdown 文件及其对应章节、图表标题和相邻正文；
3. SVG/sidecar 所在文档目录中与该图明确关联的来源段落。

开始修改前必须读取当前 SVG、sidecar、上述文档上下文和已加载的图表规范。文档引用不明确、同一 SVG 被多个文档以不同语义引用或来源上下文不足时返回 `NEEDS_CONTEXT`；不得把 SVG 路径本身当作业务事实来源。

### 修复范围与受影响边清单

默认不得改变节点/边的稳定 ID、业务节点集合、业务分支、边方向、节点位置或节点尺寸；不得通过重排节点掩盖单条连线问题。确需移动节点或改变布局时，必须使用 `designNotes.layout.changeImpactReview` 记录 baseline、移动节点、全部 incident edges 和逐边复核。

修改前先建立受影响边清单，至少记录：edge ID、from/to、fromPort/toPort、当前 `points`、相关节点几何、当前问题、候选路径、最终路径，以及是否使用 `branchPortExceptions`。只修改目标边，不扩大到其他图表或无关业务语义。

### 路径与例外

每条受影响边按以下顺序选择合法路径：直达 → 一折 Manhattan → 最少折点 Manhattan → 必要外侧 lane。已声明 `loopLanes` 的回路边必须在其侧别和最小 lane 偏移约束内继续选择最少折点路径，不能因回路声明保留多余折点或外道；只有真实节点/标签/其他边/端口冲突或必须保持的业务端口语义，才允许保留更多折点或外道，并说明具体原因。

路径必须保持水平/垂直正交、无重复点、端点落在实际端口、首段和末段方向正确、目标倒数第二个有效点位于目标形状外部，并通过现有 `ROUTING_MINIMALITY`、`PORT_DIRECTION`、`PORT_APPROACH`、碰撞、交叉和共线重叠检查。`branchPortExceptions`、`sideSwitchExceptions` 和 `crossingExceptions` 必须位于 `designNotes.layout`，只能记录实际命中的业务或几何例外。

### SVG/sidecar 同步与箭头契约

每次修改边必须同步 SVG 的路径、端点属性、`data-arrow-target`、`10 × 10` 独立 `[data-edge-arrow]` overlay、无框标签文本及线段中点法向坐标，以及 sidecar 的 `points`、端口、`arrowTarget`、标签和适用例外。当前 V1 契约不增加 `arrowRef`：箭头身份使用 SVG 的 `data-edge-arrow`/`data-edge`，目标使用 `data-arrow-target`，sidecar 使用 `arrowTarget: "<to>:<toPort>"`；不得引入第二套互相竞争的箭头 ID。

### 验收与输出

先执行 JSON/SVG 结构、expected-vs-actual、source checker 和几何检查；目标操作包含 `preview` 或浏览器 `render` 时，再执行 Provider 的 `normal`、`fit`、`zoom` 三视图。`source-only` 只有在 expected、业务、结构和几何通过时才能以 `STATIC_PASS` 交付；只有用户要求的目标操作全部有最新真实 Provider 证据时才可声明 `PASS`。Provider 不可用时标记 `NEEDS_CAPABILITY`，来源/解析/证据缺失时标记 `UNVERIFIED`，发现问题标记 `FAIL`，不得伪造截图、快照或 evidence。

最终报告至少列出图表 ID、来源文档上下文、修改 edge ID、最终端口和路径、保留外道理由、静态结果、Chrome 结果、未验证项、修改文件、证据路径和“未创建 Git commit”。

## 上下文预算与分段执行

图表验证默认按**单图、单目标操作、单次 Provider 会话**执行，不得在同一上下文中批量加载多张 SVG、多个 `.diagram.json` 或多组截图/快照。

强制规则：

1. 只传文件路径和已确认的事实，不把完整 SVG、完整 JSON、截图 base64、浏览器 snapshot 或大段 Provider stdout 粘贴到对话；需要事实时先用本地 checker/Provider 生成摘要证据。
2. 按需加载规范：先加载本 Skill，再只加载当前图型和当前验证层需要的规则；不要重复加载完整 `common-diagram-design-standards.md`、`common-svg-diagram-standards.md` 和验证规范。
3. 每张图独立保存 SVG、`.diagram.json`、Provider Request 和 evidence；Provider 的 `normal`、`fit`、`zoom` 只在 evidence 中保存路径和紧凑状态，不把三组截图或快照全部读入模型上下文。
4. 单次恢复或验证上下文接近 60KB 时立即停止继续加载，记录当前图、验证层、输入路径和下一步，执行 Context Compact/新会话恢复；不得继续堆叠内容直到模型返回 overflow。
5. 批量图表必须按图分批，默认每次 1 张；上一张图完成并保存证据后才进入下一张。批量结果只汇总状态、错误码、证据路径和下一步，不汇总原始 SVG。
6. 发生 `The context window overflowed` 时，不重试同一大上下文：新会话先读取状态和当前图的证据摘要，从失败的验证层继续；若摘要不存在，先由 checker/Provider 重新生成摘要。

上下文不足时返回 `NEEDS_CONTEXT`，而不是删减业务事实、跳过源级检查或伪造 Provider 通过。

## 输出

- Diagram Type + Purpose；
- SVG 源路径；可选 `.diagram.json` 路径；Provider Request；
- Design Notes；
- Validation Matrix（源结构/几何/语义/目标视觉）；
- **Output Status**：`PASS`、`STATIC_PASS`、`UNVERIFIED`、`NEEDS_CAPABILITY` 或 `FAIL`；旧 `SOURCE_READY` 仅映射为 `STATIC_PASS`，旧 `DELIVERED` 不自动映射为 `PASS`。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 等待或代替用户审批；
- 执行 AIDLC 阶段路由；
- 发起变更请求；
- 修改业务代码或提交 Git；
- 宣布任何 AIDLC 阶段完成；
- 伪造 diagram-contract evidence；
- 声称目标渲染/预览/导出成功而无 Provider 证据；
- 回退到 Mermaid 或 ASCII 图。


## 过程图强制验收补充

对于 `flowchart`、`pipeline`、`state` 等过程图，生成 `.diagram.json` 时必须同步生成 `designNotes.layout.mainFlow` 和 `designNotes.layout.loopLanes`。先按主阅读方向将连续主流程排在主轴上，再将同层实体在垂直主轴方向均匀分布；单一正向出边走主轴前进方向，多出边先占用垂直主轴的对称两侧，其余只在前向 180° 局域均分。源、目标位于主轴同侧的关系必须优先保持同侧通道，禁止无理由跨轴折返。主流程必须覆盖所有业务节点/流程边并可从入口追踪到出口；出口节点只允许已声明、带标签并实际进入独立 lane 的反馈/重试出边，不能因合法用户后续操作伪造无出边终态；真实失败、重试、反馈边必须进入声明的左/右独立 lane；只有来源已有标签时才显示标签，禁止补写业务标签。只有来源语义明确为判断的节点必须是 diamond，多个出口不能单独触发形状转换。连接器必须保留 `from/to/port` DOM 属性和完整路径，箭头尖端使用 `10 × 10` 独立 `data-edge-arrow` overlay；全部对象同时遵守统一单色视觉输出。节点位置、尺寸、端口、标签或分组变化后，先枚举全部 incident edges 与受影响通道，再重算主轴/净空并按直达 → 一折 Manhattan → 两折 Manhattan → 必要外侧 lane 重新路由；不得保留旧折线或只局部缩短。目标端倒数第二个有效点必须在实体外部，最后一段沿 `toPort` 法向进入。既有图布局迁移可提供 `changeImpactReview`；新图不得伪造 baseline。

交叉、回路、端口例外和分支例外必须逐项验证 `object`、`type`、`business_reason`、`geometric_reason`、`scope` 和真实 `visual_evidence`；空理由、未命中实际偏离、适用范围不明或只有截图字段名都应阻断或保持 `UNVERIFIED`。

验证顺序不得跳过实际几何：先运行 `diagram-contract` checker，确认主流程、回路、判定出口、edge crossing、共线重叠、端口方向、统一视觉样式、边标签位置和箭头映射状态；目标操作要求 `preview`/浏览器 `render` 时，再使用 Provider 对实际 DOM 的 edge-node、edge-edge、computed style、bbox、标签中点法向净空、画布不透明度、文字、水平溢出和箭头遮挡执行检查。Provider Request 必须声明 `normal`、`fit`、`zoom`，三视图全部成功后才能记录浏览器 PASS；Provider 不可用时保留 `UNVERIFIED`/`NEEDS_CAPABILITY`，不得手写或修改 evidence 冒充 Producer 结果。


## 过程图方向预分析与树干—树冠布局

在生成或重排过程图时，先从业务来源和 expected contract 执行结构预分析，再决定方向和坐标。预分析必须输出节点数、边数、入口/出口、判断节点、合流节点、反馈边、分支组、最大分支深度、最大并行分支数和预计内容宽度；不得读取 SVG/sidecar 坐标来反推主流程。

不要混淆 `main_flow` 和 `primary_flow`：`main_flow` 覆盖全部业务节点和流程边，`primary_flow` 只声明沿主轴连续前进的中心树干。`primary_flow` 缺失时不能以最长路径代替业务确认；应返回 `NEEDS_CONTEXT` 或要求调用方提供已确认的主干。结构化 `branch_groups` 至少应能追溯判断节点、分支边、目标节点和可选合流点，普通分支不能借用 `loop_lanes`。

方向策略固定为：无复杂分支且横向实际内容宽度可接受时使用 `LR_SINGLE_ROW`；单一浅分支可以使用 `LR_COMPACT_BRANCH`；嵌套分支、多判断、多出口、反馈或横向宽度超限时默认使用 `TB_MAIN_AXIS`；多组件使用 `TB_MULTI_REGION`；入口不唯一且主干未确认时使用 `NEEDS_CONTEXT`。宽度估算必须包含实际标签、节点内边距、箭头和间距，禁止缩小字体或整体缩放来满足 LR。

TB 布局必须将 `primary_flow` 放在中心纵向主轴。判断分支第一次离开主轴时横向展开；分支超过一个简单步骤或再次判断时立即建立平行的局部纵向 lane；局部流程完成后在最近的业务合流点回到主轴。普通分支不得因为路由困难被放入外侧回路，真实反馈/重试边才可使用 `loop_lanes`。生成器应统一求解候选路径，不得按 edge ID 堆叠坐标特判。

expected contract 使用 `primary_flow`、结构化 `branch_groups`，actual `.diagram.json` 使用 `designNotes.layout.primaryFlow`、`branchGroups`；生成器变更后必须重新生成所有声明的派生产物并执行 expected-vs-actual、结构、几何和目标视图验证。


## 既有过程图完整重绘闭环

当任务要求“完整重绘”“重排布局”或“重绘前后对比”时，不得把它当作单条连线修复，也不得直接手工改最终 SVG。必须按以下顺序执行：

1. **来源与样本冻结**：读取业务源、关联文档、当前 SVG、sidecar、expected contract 和适用 standards；冻结重绘前 SVG、sidecar、expected、generator/config 快照，记录绝对路径、SHA-256、静态状态和浏览器状态。来源不变时不得改写业务源。
2. **稳定语义映射**：按来源稳定关系序号和稳定 edge ID 建立 display edge 映射；同一节点对的多条关系必须按稳定 ID/业务标签精确匹配。若显示边合并来源关系，记录 source-relation merge、显示标签和业务理由。
3. **独立预分析**：只消费来源、expected contract 和文本尺寸配置，输出节点/边数、入口/出口、判断节点、合流节点、反馈边、branch groups、分支路径数、最大深度、并行分支数和预计内容边界；不得从旧坐标或旧 SVG 反推主干。
4. **方向与阅读计划**：先决定 `LR`/`TB`，再声明主轴、业务层级、`mainFlow`、`primaryFlow`、branch groups、merge nodes 和 loop lanes。`mainFlow` 覆盖全流程，`primaryFlow` 只表达已确认的中心主干，二者不得混用。
5. **树干—树冠布局**：先冻结主轴和主流程层，再放置同层分支、局部 lane、反馈 lane 与合流点。复杂分支优先保持主轴连续、同侧通道、端口法向、标签净空和局部可读性，不以压缩字号或固定窗口高度换取一屏显示。
6. **统一候选路由**：每条受影响边按直达 → 一折 Manhattan → 最少折点 Manhattan → 必要外侧 lane 选择；路径必须正交、无重复点、首末方向合法、目标倒数第二点在实体外部。真实障碍、已确认端口语义和实际反馈 lane 才能支持更多折点；不得继续累加逐 edge 坐标补丁。
7. **节点迁移影响复核**：任何节点位置、尺寸、端口或业务层变化后，枚举该节点全部 incident edges 及邻近通道，记录 baseline、`movedNodeIds`、`impactedEdgeIds` 和每条边唯一的 `recomputed`/`unchanged` 复核。缺少任一 incident edge 时不得宣称迁移闭环完成。
8. **全量派产物同步**：生成器或 route policy 变化后，同一次闭环重新生成 expected、sidecar、SVG、Provider Request 和其他声明输出；generation provenance 必须记录 generator/version、config summary/digest、source refs、outputs、command 和 cwd。不得保留旧派生产物混报通过。
9. **分层验证与对比**：先执行 source/semantic、结构、几何和 expected-vs-actual，再执行目标 Provider。对比至少覆盖节点/边集合、source merge、main/primary flow、branch groups、loop lanes、crossings、bend count、端口/箭头/标签、内容边界和 SVG 绘制层。
10. **状态诚实**：无真实 Provider normal/fit/zoom 证据时最多为 `STATIC_PASS`；`PASS` 只适用于四层证据均为本次运行、三视图均成功的结果。字段、截图文件名、旧 evidence 或自然语言观察不能替代真实视觉证据。

完整重绘可以改变坐标和画布，但不能静默改变业务节点、关系、方向、分支标签、合并语义或来源映射。案例名称、节点名、edge ID、坐标和具体调整矩阵必须写入案例复盘，而不是写入本通用 Skill。

## Mermaid 来源保真（强制）

迁移 Mermaid 或批准流程时，先建立独立 `source_graph`，冻结每个节点的来源 ID、原文文本和形状，以及每条关系的来源序号、端点、线型和标签；随后才声明 `reading_paths`、主轴、局部 lane 和 feedback lane。反馈是路由角色，不是改变实线/虚线的理由。只有显式、端点和线型一致的多对一 source relation merge 可以产生 `display_label`；其余文本规范化、形状转换、线型转换和标签增加一律禁止。

路由候选按“直连 → 一折 Manhattan → 两折 Manhattan → 局部 lane → 必要 feedback lane”选择；局部分支不得因减少交叉而绕到外侧 lane。任何边离开 source 后不得再次穿过 source 内部；节点移动后必须复核全部 incident edges。样品可作为布局阅读参考，但不构成语义来源，也不提升浏览器视觉状态。

## 反馈 lane、同端点合并与标签近邻

对每条反馈/重试边，先从来源端口向外搜索最窄合法 corridor；只有节点、标签、箭头或来源端口语义阻挡时才扩大。不得沿用固定超大 lane offset；`laneOffset` 相对主轴的数值不是宽绕行的理由，必须同时审查来源端口到 lane 的实际清场距离和障碍。

对同一来源、目标、线型的多条来源关系，先判断是否可做 source-backed display merge。获准合并时保留每个 source ordinal 和原始条件标签，使用唯一 display label，并优先走同轴直达；不得为保留重复 display edge 添加 target offset、平行折线或远侧标签。

标签先放在分歧点附近或所属最长可读路径段的中部，法向偏移只用于最小净空。标签离开连接器可辨识邻域时，先修 merge、局部 corridor 或节点间距，禁止通过任意增大 side offset 解决。

无关节点的边界不是可借用的走线通道。连线只可在自身 source/target 的端口单点接触节点；一旦与无关节点矩形、圆角矩形或椭圆边框存在非零长度共线段，必须将 corridor 外移到最小净空位置。