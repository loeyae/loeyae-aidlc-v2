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
- **target_operations**（可选）：`source-only`、`preview`、`render` 或 `export`；未要求时不主动调用 Provider；
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

按加载的设计标准执行完整的图表设计流程：先确定 `TB`/`LR` 主阅读方向、主轴、业务层级、首层对称组和判断分支端口，再提取节点/边、计算实际内容边界、生成 SVG 源、生成可选 `.diagram.json` 语义伴随清单、生成 Provider Request 并执行源级验证。每条 `annotations[]` 必须生成唯一稳定 `id`，并在 SVG 中生成一一对应的 `data-note`；不得为了排版合并注释 ID。生成器不得以固定窗口高度、整体缩放、缩小字号或压缩层级换取“一屏显示”，纵向图可以扩展画布并允许页面纵向滚动。具体步骤和验收矩阵以加载的两份规则文件为准，本文件不复制。当 `target_operations` 包含 `preview` 或浏览器侧 `render` 时，源级 `diagram-contract` evidence 通过后调用 `loeyae-aidlc diagram-provider run --request <provider-request.json> --evidence <diagram-contract.json>`；该运行器负责常规/适合窗口/放大视图的浏览器证据采集和 evidence 状态更新，`export` 不由 Chrome DevTools Provider 承担。

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
- Delivery Status：`SOURCE_READY`、`DELIVERED`、`NEEDS_CAPABILITY` 或 `DEGRADED_TO_TEXT_TABLE`。

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

对于 `flowchart`、`pipeline`、`state` 等过程图，生成 `.diagram.json` 时必须同步生成 `designNotes.layout.mainFlow` 和 `designNotes.layout.loopLanes`。先按主阅读方向将连续主流程排在主轴上，再将同层实体在垂直主轴方向均匀分布；单一正向出边走主轴前进方向，多出边先占用垂直主轴的对称两侧，其余只在前向 180° 局域均分。源、目标位于主轴同侧的关系必须优先保持同侧通道，禁止无理由跨轴折返。主流程必须覆盖所有业务节点/流程边并可从入口追踪到出口；出口节点只允许已声明、带标签并实际进入独立 lane 的反馈/重试出边，不能因合法用户后续操作伪造无出边终态；失败、重试、反馈边必须进入声明的左/右独立 lane 并带可见标签；判定节点必须是 diamond，且每个出口必须有可见分支标签。连接器必须保留 `from/to/port` DOM 属性和完整路径，箭头尖端使用独立 `data-edge-arrow` overlay。节点位置、尺寸、端口、标签或分组变化后，先枚举全部 incident edges 与受影响通道，再重算主轴/净空并按直达 → 一折 Manhattan → 两折 Manhattan → 必要外侧 lane 重新路由；不得保留旧折线或只局部缩短。目标端倒数第二个有效点必须在实体外部，最后一段沿 `toPort` 法向进入。既有图布局迁移可提供 `changeImpactReview`；新图不得伪造 baseline。

交叉默认避免，但不是机械零交叉目标：为保持主轴、同层业务顺序或避免更长的折返而必须保留的交叉，须在 `designNotes.layout.crossingExceptions` 声明具体、互异的边对与原因，且该声明必须命中实际交叉；由浏览器确认其不触及节点、文字、标签、箭头或关键端点且方向可读。未声明交叉、未发生的例外声明、共线重叠、节点/文字/标签穿越仍然阻断。跨侧或多次换边须使用 `sideSwitchExceptions` 说明业务端口或真实避障原因，并且同样必须命中实际路径。

验证顺序不得跳过实际几何：先运行 `diagram-contract` checker，确认主流程、回路、判定出口、edge crossing、共线重叠、端口方向和箭头映射状态；目标操作要求 `preview`/浏览器 `render` 时，再使用 Provider 对实际 DOM 的 edge-node、edge-edge、bbox、文字、水平溢出和箭头遮挡执行检查。Provider Request 必须声明 `normal`、`fit`、`zoom`，三视图全部成功后才能记录浏览器 PASS；Provider 不可用时保留 `UNVERIFIED`/`NEEDS_CAPABILITY`，不得手写或修改 evidence 冒充 Producer 结果。
