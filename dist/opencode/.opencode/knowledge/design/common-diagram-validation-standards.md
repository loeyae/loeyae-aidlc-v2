# 图表验证标准

## 目的与边界

本文件定义图表生成后的验证分层、状态、风险路由和证据边界。它不重新定义图型设计规则或 `.diagram.json` 字段契约：

- 图表表达、图型、粒度、拆图和视觉语义：`common-diagram-design-standards.md`；
- SVG、V1 清单、端口和源—SVG 映射：`common-svg-diagram-standards.md`；
- 本文件：如何用确定性检查和目标 Provider 证据证明结果。

源码检查由 `core/tools/aidlc-semantic-checks.ts` 执行，浏览器检查由 `core/tools/aidlc-diagram-provider.ts` 执行。配置存在不代表 Provider 已实际可用；没有真实执行证据时必须保持 `UNVERIFIED` 或 `NEEDS_CAPABILITY`。

## 验证顺序

```text
Diagram IR / SVG source
        ↓
Semantic QA
        ↓
Geometry QA
        ↓
Render preflight
        ↓
Risk Assessment
        ↓
Browser Routing
        ↓
Browser Evidence（仅实际执行时）
        ↓
Final Delivery Status
```

前一层失败时，不得用后一层证据掩盖源问题。Geometry 通过不代表 Render 通过；Render 通过不代表 Browser 通过。

## 统一状态模型

最终状态只有以下五种，`final_status` 是图表验收的唯一权威字段：

- `PASS`：业务语义、源与结构契约、几何和最新真实浏览器视觉证据全部通过；三视图 `normal`、`fit`、`zoom` 均有本次运行生成的截图与快照。
- `STATIC_PASS`：业务语义、源与结构契约、几何均通过，但浏览器视觉尚未完成；它不是完整 `PASS`。
- `UNVERIFIED`：来源、解析、expected-vs-actual、证据或某项必需验证缺失，当前不能作出通过结论。
- `NEEDS_CAPABILITY`：用户要求的 Provider/目标操作没有可验证能力，不能伪造截图、快照或通过状态。
- `FAIL`：发现具体语义、结构、几何或视觉问题。

旧 `SOURCE_READY` 仅作为外部兼容别名映射为 `STATIC_PASS`；旧 `DELIVERED` 不自动等于 `PASS`，必须重新满足上述四层条件。Evidence 外层历史 `status: "passed"` 只表示 producer 成功写入文件，不是最终状态；调用方必须读取 `final_status`。旧 evidence 没有 `final_status` 时可按兼容规则推导，但新 producer 必须写入它。

状态优先级为：

```text
FAIL > NEEDS_CAPABILITY > UNVERIFIED > STATIC_PASS > PASS
```

缺少任何一层的来源或证据都不能向右升级。`PASS` 不得由 source checker、SVG/sidecar 自洽、截图文件存在、字段布尔值或 Provider 配置存在单独产生。

## 四层验收

验收对象必须区分四层并分别记录结果：

1. **业务语义层**：expected contract 的 source、intent、节点/边语义、主流程、分支/回路和例外是否来自可追溯业务来源；不能从坐标或 SVG 标题反推。
2. **源与结构契约层**：actual SVG/sidecar/manifest 的 ID、端点、端口、图例、分组、注释、生成器 provenance 是否与 expected contract 一致；actual 自洽不等于业务正确。
3. **几何层**：源坐标和路径的端口方向、目标外侧接近、碰撞、共线重叠、交叉、折点、同侧通道、画布边界和标签可读性是否通过。
4. **真实浏览器渲染层**：目标 Provider 实际加载 actual，在 `normal`、`fit`、`zoom` 三视图检查 DOM、真实 bbox、文本、箭头、溢出、遮挡并保存截图/快照；静态几何结果不能代替该层。

前一层失败时不得用后一层证据掩盖；浏览器证据必须引用本次 request、viewport、截图和快照路径。仅有字段、路径或 screenshot 文件名而没有真实执行结果时为 `UNVERIFIED`。


## 上下文预算与恢复

图表验证的模型上下文不是证据存储。原始 SVG、`.diagram.json`、截图、快照和 Provider stdout 必须保存在文件中，对话只读取当前验证层所需的紧凑摘要。

- 默认一轮只处理一张图和一个目标操作；多图批量必须拆成独立会话或独立子任务；
- 不读取截图 base64、完整浏览器 snapshot 或多张 SVG 的全文；使用 checker/Provider 输出的状态、错误码、bbox、证据路径和下一步摘要；
- 按 `common-token-management.md` 的 60KB 预警执行，接近阈值即保存当前图、验证层、输入路径和证据路径并 compact；
- `The context window overflowed` 后必须从新会话读取摘要恢复，不得重复注入完整历史；
- 上下文不足返回 `NEEDS_CONTEXT`，不得通过跳过 Semantic/Geometry、压缩业务事实或伪造 Browser Evidence 放行。

Semantic QA 是不启动浏览器的结构化检查，至少覆盖：

- 图表 ID、标题、描述、画布、节点、连线、分组和图例数组；
- 节点 ID、形状、标签、坐标、尺寸、画布边界和稳定引用；
- 连线 ID、`from` / `to`、端口、类型、路径点和标签；
- `diagramType`、`designNotes`、视觉语义和 `designNotes.layout`；
- `annotations[].id` 的唯一性以及 SVG `data-note` 一一映射；
- 方向、主轴、层级、分支端口、汇合声明和图例/注释顺序；
- FR/REQ 与图表对象的追溯关系。

缺少 V2 新结构化字段时记录 `migration_status: "MIGRATION_REQUIRED"`，并将图表 `final_status` 保持为 `UNVERIFIED`；字段存在但值非法时 `final_status` 为 `FAIL`。不得把自然语言观察当作结构化证据。

## 已有图表冗余连线修复的验证边界

当任务明确是已有图表的冗余连线修复时，验证记录必须区分“局部路由修复”和“业务语义变更”。默认要求保留节点/边 ID、节点集合、业务分支、方向、节点几何和文档语义上下文；若发生节点或布局变化，必须提供 `changeImpactReview`，覆盖移动节点的全部 incident edges。没有 before/after baseline 时，checker 可以证明当前源契约和几何状态，但不能单独证明“未改变原始业务语义”或“检查了原图全部冗余边”，不得把这些结论伪装成自动 PASS。

修复记录至少应列出受影响 edge ID、原端口和路径、候选直达/一折/最少 Manhattan 路径、最终路径、保留外道的实际原因及适用的 `branchPortExceptions`、`sideSwitchExceptions` 或 `crossingExceptions`。这些是可追溯的任务证据；现有 `routing_minimality_status`、端口方向/目标外侧、节点/边碰撞、交叉、共线重叠和箭头映射门禁继续作为最终 source gate，不新增平行的 `arrowRef` 契约。

业务语义证据应引用 SVG 所属文档位置的 `document`、章节或相邻正文。SVG/sidecar 的几何不能替代业务来源；如果文档上下文不足，状态为 `NEEDS_CONTEXT`，而不是让 checker 根据坐标放行。

`source-only` 只有在 expected contract、业务语义、源结构和几何证据均通过时才能为 `STATIC_PASS`；目标 Provider 状态可以是 `UNVERIFIED`，但不得宣称完整 `PASS`。当目标操作包含 `preview`、`render` 或 `export` 时，必须实际取得所要求的 Provider 证据；`normal`、`fit`、`zoom` 任一缺失、失败或 Provider 不可用时，保持 `UNVERIFIED`/`NEEDS_CAPABILITY`，不能声明完整 `PASS`。`git diff --check`、命令长度和“不创建 Git commit”属于执行流程检查，不是 diagram-contract 语义 evidence 字段。

### Expected-vs-actual 与 route contract 门禁

`diagram-contract` 新建/调整图的业务期望来自独立 expected contract；Provider Request 使用 `expected_contract_path` 指向它，manifest 中的同名路径字段只能是引用，不能把 manifest 内容转换为 expected。expected 必须包含可追溯 source/generator provenance、每个节点和边的业务集合、端点/端口期望以及完整 `route_contract.edge_intents`；expected 不得包含 `x`、`y`、`width`、`height`、`points`、bbox 或浏览器测量值。

Checker 依次比较 expected 与 actual：节点/边集合、端点、端口、边类型、图例/分组/注释、主流程/回路/分支和每条边的 route intent。route 的折点数按连续有效线段的方向变化计算；共线点不计数，`points.length` 不是折点数。若 SVG 与 sidecar 彼此一致但与 expected route 或业务端点不一致，必须返回 `FAIL`，不能用 actual 自洽掩盖 expected mismatch。

交叉、回路、端口例外和分支例外必须验证以下内容，而不是只验证字段存在：

- `object`：实际边、边对、节点或端口对象存在且与偏离对象一致；
- `type`：例外类型与实际几何偏离一致；
- `business_reason`：为什么业务语义、主轴或关系顺序不能采用普通路径；
- `geometric_reason`：实际障碍、端口或可读间距原因；
- `scope`：图表 ID、适用视图/阶段和条件；
- `visual_evidence`：Provider 实际截图、快照和观察结果。没有最新真实证据时只能是 `UNVERIFIED`。

生成器闭环要求 expected、sidecar、SVG、Provider Request 和声明的其他派生产物在同一次生成记录中列出 generator/version、config summary/digest、source refs 和 outputs。生成器或配置改变后必须重新生成全部派生产物并重新运行受影响的四层验收；旧 evidence 不得复用为最新 `PASS`。



Geometry QA 使用源坐标、路径点和结构化文本估算，不声称完成真实浏览器字体测量。当前检查覆盖：

- 节点重叠和安全间距：`NODE_OVERLAP`、`INSUFFICIENT_GAP`；
- 连线穿越节点、连线交叉和标签冲突：`EDGE_NODE_COLLISION`、`EDGE_CROSSING`、`CROSSING_EXCEPTION`、`LABEL_COLLISION`；
- 端口、首末端点、目标外侧接近与最少路径：`PORT_MISMATCH`、`EDGE_ENDPOINT_MISMATCH`、`PORT_DIRECTION`、`PORT_APPROACH`、`REDUNDANT_PATH_POINT`、`ROUTING_MINIMALITY`；
- 主轴同侧通道与布局迁移复核：`SIDE_SWITCH`、`SIDE_SWITCH_EXCEPTION`、`CHANGE_IMPACT_REVIEW`；
- 分组成员、父级和最小内边距：`GROUP_CONTAINMENT`；
- 内容、路径点、标签和对象越界：`CANVAS_CLIPPING`；
- 内容相对画布过小：`CANVAS_TOO_EMPTY`；
- 不支持的复杂形状或生命线：`UNSUPPORTED_SHAPE_GEOMETRY`、`SEQUENCE_LIFELINE_MISSING`；
- 主轴、对称性、层级和分支规则：`LAYOUT_AXIS`、`LAYOUT_SYMMETRY`、`LAYOUT_LAYER`、`BRANCH_PORT`、`BRANCH_LAYER`、`BRANCH_PATH_DIRECTION`；
- 汇合声明和注释追溯：`MERGE_DECLARATION`、`ANNOTATION_MAPPING`、`ANNOTATION_ORDER`。

通用检查无法可靠判断真实字体 bbox、复杂 SVG path 边界或浏览器 marker 可见性时，必须保持 `UNVERIFIED`，不能以矩形近似冒充视觉通过。

交叉门禁的判定边界：`EDGE_CROSSING` 用于阻断未声明、不可读或触及节点/文字/标签/箭头/关键端点的非端点交叉；它不是把所有交叉机械判为失败的零交叉开关。对已声明且实际命中的必要交叉，仍须检查其可读性和 `crossingExceptions` 理由。修复记录和验证结果应记录实际交叉数量、边对和例外命中情况；当前证据不足以证明全局最少交叉时，不得伪造“最少交叉”自动 PASS。

### 集中阈值

阈值由 `core/tools/aidlc-semantic-checks.ts` 和 Provider 的几何检查集中实现，并必须与共享 SVG 规范保持一致：

| 常量 | 默认值 | 用途 |
|---|---:|---|
| `MIN_NODE_GAP` | 24 | 节点之间最低安全间距 |
| `MIN_EDGE_GAP` | 12 | 连线与可读区域最低间距 |
| `MIN_LABEL_GAP` | 8 | 标签与其他对象最低间距 |
| `MIN_GROUP_PADDING` | 16 | 分组内容最低内边距 |
| `CANVAS_MARGIN` | 24 | 内容到画布边缘最低内边距 |
| `POINT_TOLERANCE` | 1 | 端点比较允许误差 |

### 主轴、层级、分支和内容顺序

当源提供 `designNotes.layout` 时：

1. `TB` 使用节点中心 `y` 判断层级，`LR` 使用节点中心 `x` 判断层级；声明的同层节点必须落在容差内。
2. `mainAxis` 必须与方向正交；首层对称组按声明中心检查，不凭空要求所有节点对称。
3. 判断节点的分支目标默认处于同一业务层级；TB 目标从 `top` 进入，LR 目标从 `left` 进入。合法例外必须显式声明原因。
4. 分支最后一段必须沿主阅读方向进入目标；回边和异常边不被强制伪装成主干边。
5. 多入边节点必须声明 `mergeNodes`，不同合法端口不得被静默合并。
6. 业务主体、图例、注释按 DOM 和内容边界保持主体 → 图例 → 注释；纵向滚动合法，水平溢出、裁切和不可读不合法。
7. 有 `annotations[].id` 且提供 SVG 时，检查每个 ID 恰好对应一个 `data-note`；缺少旧资产字段只返回迁移状态。

这些检查证明源坐标、声明和 SVG 追溯关系；真实字体、viewport、normal/fit/zoom 可读性仍由 Provider 产生外部证据。

## Render Preflight

源级 `viewBox`、根元素、标题、描述、安全属性和内容边界检查不等于静态 Render QA。没有实际静态 Renderer 返回渲染表面 bbox 或截图时，`render_status` 必须为 `unverified`；不得以 SVG 文件存在、源脚本成功或结构检查通过冒充 Render PASS。

## Risk Assessment

风险评估用于路由，不是质量门禁。高风险不代表图表失败，低风险也不代表浏览器通过。每个风险原因必须有稳定 code、分值和可解释原因：

| 因素 | 分值 |
|---|---:|
| 节点数 > 20 | +1 |
| 连线数 > 30 | +1 |
| 多拐点或非正交路径 | +2 |
| 同侧端口复用 | +2 |
| Sequence | +1 |
| 复杂 Flowchart/Pipeline | +2 |
| 多层分组 | +2 |
| 复杂图例或多行文本 | +1/+2 |
| 多字体、`foreignObject` 或 `transform` | +2/+3/+1 |
| 历史视觉失败 | +3 |
| 目标环境为 browser 或用户明确要求浏览器验证 | +3/+3 |

```text
0–2   LOW
3–5   MEDIUM
6+    HIGH
```

风险结果不得覆盖 Semantic、Geometry 或 Render 的失败、迁移或未验证状态。

## Browser Routing 与 Evidence

路由器只生成决策，不把路由结果当作执行证据：

1. 用户明确要求浏览器验证，或目标环境为 browser，必须路由到 Browser；
2. `source-only` 默认不启动浏览器；
3. HIGH 风险且非 source-only，或 MEDIUM 风险且目标操作为 `preview`/`render`，进入 Browser；
4. Semantic 或 Geometry 未通过时先修复源，不执行浏览器掩盖问题；
5. Chrome 未实际执行时保持 `executed=false` 和 `status=UNVERIFIED`；要求能力但不可用时为 `NEEDS_CAPABILITY`。

适用时 Provider 必须分别保留 `normal`、`fit`、`zoom` 三种阅读视图，每个视图记录 viewport、状态、几何观察和截图/快照路径。纵向滚动允许，水平溢出、裁切和不可读失败。

结果记录使用统一 `final_status`，不把路由决策或截图路径当执行证据：

```json
{
  "final_status": "PASS",
  "provider": "<provider>",
  "reading_view": "normal",
  "geometry": { "contentBBox": {}, "canvasBBox": {}, "clipped": false },
  "screenshots": ["<screenshot-path>"],
  "snapshot": "<snapshot-path>",
  "expected_contract": "<expected-contract-path>"
}
```

## 自动修复边界

- Geometry 问题优先由确定性布局、路由和间距算法修复；
- Semantic 问题需要 Diagram Design 能力重新设计或拆图；
- 不让 Agent 反复猜测可由坐标和路径算法确定的问题；
- 不手工修改最终 SVG 掩盖源或验证器问题；
- 本协议不替代 `diagram-contract` sensor、`aidlc-semantic-checks.ts` 或 `aidlc-diagram-provider.ts`，只定义它们共同遵循的验证层次和证据边界。


## 流程可追踪性与浏览器实际几何门禁

`diagram-contract` 的源级 PASS 不能只由 XML 合法、SVG 可加载、ID 存在或 `data-node`/`data-edge` 存在得出。过程图必须同时有以下独立结果：

- `main_flow_valid`：主流程入口、出口、节点/边覆盖和可达性通过；
- `loop_lanes_valid`：回路边有标签、声明了左右 lane 和原因，并实际离开主流程通道；
- `decision_exit_valid`：所有判定节点为 diamond 且每个出口都有非空可见标签；
- `edge_intersection_status`：无未声明或不可读的 edge-edge 交叉；已声明的必要交叉必须保持主流程、文字、标签、箭头和端点零歧义。
- `collinear_overlap_status`：无非预期非零共线重叠；
- `target_port_direction_status`：连接器首末段方向与声明端口一致；
- `target_port_approach_status`：目标倒数第二有效点位于实际形状外部；
- `routing_minimality_status`：不存在更短的无障碍直达或一折 Manhattan 路径；
- `side_switch_status`：同侧通道未无声明跨轴折返；
- `change_impact_review_status`：声明布局迁移时，所有移动节点的 incident edges 都有复核；
- `visible_arrow_mapping_status`：箭头目标、marker/overlay 映射和可见性通过。

确定性 checker 使用稳定错误码区分失败原因：`MAIN_FLOW_TRACE`、`LOOP_LANE`、`DECISION_SHAPE`、`DECISION_EXIT`、`PORT_DIRECTION`、`PORT_APPROACH`、`ROUTING_MINIMALITY`、`SIDE_SWITCH`、`SIDE_SWITCH_EXCEPTION`、`CHANGE_IMPACT_REVIEW`、`EDGE_CROSSING`、`CROSSING_EXCEPTION`、`COLLINEAR_OVERLAP`、`REDUNDANT_PATH_POINT` 和 `EDGE_NODE_COLLISION`。`EDGE_CROSSING` 仅针对未声明或未满足必要交叉可读性条件的交叉；`CROSSING_EXCEPTION` 处理缺失、重复、非法或未实际发生的例外；`COLLINEAR_OVERLAP` 始终不得降级为普通交叉，端点接触也不能掩盖同一边对之间的非零共线重叠。

当目标操作为 `preview` 或浏览器 `render` 时，Chrome DevTools Provider 必须对实际 DOM/SVG 几何执行：节点和边集合的精确映射、edge-node crossing、edge-edge intersection（仅接受 sidecar 已声明且实际命中的必要交叉）、共线重叠、端口首末方向和目标外侧接近、边 bbox、同侧通道/跨轴折返、标签与无关边 bbox、箭头 overlay bbox 及其被无关节点、后绘制标签、图例或分组遮挡、`text`/`tspan` bbox 越界与重叠、`contentBBox`、水平溢出、判定 diamond 和出口数量，以及 sidecar 声明的主流程和回路边覆盖。不能用源坐标结果代替这些浏览器检查。

Provider Request 的 `target_reading_environment.viewports` 必须同时声明 `normal`、`fit`、`zoom` 三个对象。实际运行缺少任何一个视图时必须阻断；只有三个视图全部检查成功，且截图/快照均已生成，才可以原子更新 `provider_status: "passed"`。页面纵向滚动允许，但水平溢出、对象越界、文字/箭头不可见或被遮挡都失败。dry-run 只验证请求和执行计划，不产生浏览器通过证据。
