---
id: diagram-contract
name: Diagram Contract
description: Verifies SVG and diagram structural contracts.
evidence_path: .aidlc/evidence/<stage-slug>/diagram-contract.json
---

# diagram-contract

## 目的
验证需求流程图和应用设计图遵循 V1 SVG/Diagram 契约：稳定 ID、主阅读方向、主轴、业务层级、端口、分支、连通性、分组、统一单色视觉、无全局图例/备注、viewBox、FR 映射和 Provider 状态均有结构化证据。纵向滚动允许，水平溢出、裁切、对象越界、标签压线和不可读失败。

## Evidence 路径

```text
.aidlc/evidence/<stage-slug>/diagram-contract.json
```

## 必填字段

```json
{
  "evidence_version": "1",
  "timestamp": "<iso-timestamp>",
  "producer": {"name": "<controlled-producer>", "mode": "controlled", "execution_id": "<execution-id>"},
  "source_revision": "<source-revision>",
  "checker": {"id": "<diagram-contract-checker>"},
  "status": "passed",
  "final_status": "STATIC_PASS",
  "gate_statuses": {
    "structure": "STRUCTURE_PASS",
    "route_contract": "ROUTE_CONTRACT_PASS",
    "geometry": "GEOMETRY_PASS",
    "visual": "UNVERIFIED",
    "overall": "STATIC_PASS"
  },
  "structure_status": "STRUCTURE_PASS",
  "route_contract_status": "ROUTE_CONTRACT_PASS",
  "geometry_gate_status": "GEOMETRY_PASS",
  "visual_status": "UNVERIFIED",
  "overall_status": "STATIC_PASS",
  "source_format": "svg",
  "diagrams_checked": 1,
  "expected_contract_status": "passed",
  "semantic_status": "passed",
  "generation_status": "passed",
  "ids_unique": true,
  "ports_valid": true,
  "direction_consistent": true,
  "legend_valid": true,
  "groups_valid": true,
  "viewbox_valid": true,
  "provider_status": "unverified",
  "target_operation_required": false,
  "browser_visual_status": "unverified",
  "fr_mapping_complete": true,
  "design_notes_valid": true,
  "layout_contract_valid": true,
  "annotation_mapping_valid": true,
  "global_decorations_absent": true,
  "visual_style_status": "passed",
  "edge_label_placement_status": "passed",
  "migration_status": "passed",
  "port_paths_valid": true,
  "geometry_status": "passed",
  "render_preflight_status": "passed",
  "render_status": "unverified",
  "unresolved": 0
}
```

`legend_valid` 与 `annotation_mapping_valid` 是兼容输出字段：新契约中它们为 `true` 仅表示全局图例/备注完全不存在，不表示已生成或映射这些层。`global_decorations_absent`、`visual_style_status` 和 `edge_label_placement_status` 是新 source gate，缺失或失败时不能输出 `STATIC_PASS`。

`final_status` 只有 `PASS`、`STATIC_PASS`、`UNVERIFIED`、`NEEDS_CAPABILITY`、`FAIL`。`status: "passed"` 是受控 producer 的外层写入结果，不是最终验收状态。新格式必须同时输出 `gate_statuses.structure`、`gate_statuses.route_contract`、`gate_statuses.geometry`、`gate_statuses.visual` 和 `gate_statuses.overall`；源级通过时前三层分别为 `STRUCTURE_PASS`、`ROUTE_CONTRACT_PASS`、`GEOMETRY_PASS`，只有真实三视图成功时 visual 才能为 `VISUAL_PASS`，完整通过时 overall 才能为 `OVERALL_PASS`。`PASS` 必须同时有 expected contract、业务语义、源结构、几何和本次真实 Provider 的 `normal`、`fit`、`zoom` 截图/快照；`STATIC_PASS` 不能替代 `PASS`。缺少来源、解析或证据为 `UNVERIFIED`；Provider 能力不可用为 `NEEDS_CAPABILITY`；发现问题为 `FAIL`。旧 `SOURCE_READY` 读取时只映射为 `STATIC_PASS`。

新建或调整图必须提供独立 expected contract、`diagramType`、`designNotes`、完整边 `points`、分组与就地视觉语义、统一视觉样式、空的全局图例/备注集合、FR/REQ 映射和 generation provenance。旧 V1 资产缺少适用结构化字段时，Checker 必须 fail-closed，记录 `migration_status: "MIGRATION_REQUIRED"` 并将 `final_status` 保持为 `UNVERIFIED`；字段存在但非法时为 `FAIL`。`migration_status` 只有在迁移完成后才能为 `passed`。`port_paths_valid` 表示端口、偏移和路径点已完成源级检查。

### Generation closure

新建或调整图的 `generation` 至少包含以下字段：

```json
{
  "generator": {"name": "<name>", "version": "<version>"},
  "config": {"summary": "<summary>", "digest": "sha256:<64-hex>"},
  "route_config": {"affected_edge_ids": ["<edge-id>"], "...": "generator input"},
  "source_refs": ["<business-source>"],
  "outputs": ["<svg-output>", "<expected-contract>"],
  "command_argv": ["<executable>", "<arg>"],
  "cwd": "<project-relative-cwd>"
}
```

Checker 必须实际以 `shell: false` 执行 `command_argv`，通过 `AIDLC_DIAGRAM_ID`、`AIDLC_ROUTE_CONFIG_JSON`、`AIDLC_EXPECTED_CONTRACT_PATH` 传入当前上下文，重读 SVG/sidecar，并拒绝任何未列入允许 outputs 的项目文件变更。`route_config`、实际命令、cwd、changed files 和 `reloaded` 结果必须进入 `generation_closure`；命令或配置位于 `/tmp` 时也必须在验证输出中保留路径证据。生成器闭环失败时不得沿用旧 evidence 的 PASS。


## Chrome DevTools Provider 运行时适配

当 `target_operations` 包含 `preview` 或浏览器侧 `render` 时，先完成源级 `diagram-contract` evidence，再执行：

```bash
loeyae-aidlc diagram-provider run \
  --request <provider-request.json> \
  --evidence .aidlc/evidence/<stage-slug>/diagram-contract.json
```

Provider Request 使用 version `1`，最小结构如下：

```json
{
  "version": "1",
  "provider": "chrome-devtools",
  "target_operation": "preview",
  "stage": "<stage-slug>",
  "target_reading_environment": {
    "viewports": {
      "normal": {"width": "<width>", "height": "<height>"},
      "fit": {"width": "<width>", "height": "<height>"},
      "zoom": {"width": "<width>", "height": "<height>"}
    }
  },
  "diagrams": [{
    "id": "<diagram-id>",
    "source_path": "<actual-svg-path>",
    "manifest_path": "<actual-sidecar-path>",
    "expected_contract_path": "<independent-expected-contract-path>"
  }]
}
```


运行器调用未固定版本的 `chrome-devtools-mcp` CLI，执行页面导航、viewport 调整、DOM/computed style/实际 bbox 检查、可访问性快照、viewport 截图和控制台采集。每次真实运行都会以唯一 `sessionId` 启动 `chrome-devtools start --isolated`，后续所有 CLI 调用复用该 daemon，并在运行器进程退出时只停止自身会话；它不依赖或停止 Kiro Crew Dashboard Browser 面板的默认会话。源级 evidence 或 independent expected 不存在、未通过或不可解析时拒绝执行并保持 `UNVERIFIED`；浏览器检查失败时记录当前 `FAIL` evidence 且不把旧 evidence 升级；normal 必须从 `(0,0)` 开始，fit 必须完整显示 content bbox，zoom 必须覆盖 expected `affected_edge_ids`。全部适用检查通过后，且 `normal`、`fit`、`zoom` 三视图各自生成截图和快照，才原子更新 `provider_status: "passed"`、`browser_visual_status: "passed"`、`gate_statuses.visual: "VISUAL_PASS"`、`gate_statuses.overall: "OVERALL_PASS"`、`final_status: "PASS"`，并写入 `diagram-contract-provider.json#views.<view>`。Provider 能力不可用时写入 `final_status: "NEEDS_CAPABILITY"`，不得伪造通过；`export` 不属于该 Provider 能力。


对本地 SVG，运行器会先验证源文件的静态安全约束；若 Chrome 将直接 `file://` SVG 呈现为 XML 查看器，则使用只包含当前 SVG 的临时本地 HTML wrapper 进行浏览器检查，wrapper 在运行结束后删除，不修改 SVG 源。无法启动或调用 Chrome DevTools 时保持原有 `UNVERIFIED` evidence，不得伪造通过；若运行时明确报告 Chrome profile 被占用，返回稳定错误码 `BROWSER_PROFILE_CONFLICT`，不得误报为“Browser 面板未配置”。


## 过程图严格契约与证据门禁

对过程图新增或调整资产，Producer 生成的 evidence 必须保留以下源级结果字段，不能由 Agent 手写补齐：

```json
{
  "main_flow_valid": true,
  "loop_lanes_valid": true,
  "decision_exit_valid": true,
  "edge_intersection_status": "passed",
  "collinear_overlap_status": "passed",
  "target_port_direction_status": "passed",
  "target_port_approach_status": "passed",
  "routing_minimality_status": "passed",
  "side_switch_status": "passed",
  "change_impact_review_status": "not_applicable",
  "visible_arrow_mapping_status": "passed",
  "global_decorations_absent": true,
  "visual_style_status": "passed",
  "edge_label_placement_status": "passed"
}
```

Producer 还必须记录 `expected_contract_status`、`semantic_status`、`generation_status`、`browser_visual_status` 和 `final_status`。expected contract 与 SVG/sidecar 必须分别作为 expected/actual 输入；actual 自洽不构成业务语义通过。route contract 的折点按方向变化次数计算，不得以 `points.length` 代替；expected topology 还可声明正交性、有效线段数和方向序列。端点、端口、箭头目标、折点、points 拓扑、法向、非 Manhattan、节点穿越、未授权交叉、标签碰撞、标签中点法向位置与统一视觉样式必须能区分 expected/actual 差异。交叉、回路、端口和分支例外必须验证 object/type/business_reason/geometric_reason/scope，并在 Provider 层生成真实截图/快照视觉证据；crossing exception 只能豁免所声明的那一对 edge IDs。

先按主轴排布主流程，再检查同层实体在垂直主轴方向的均匀分布；单一正向出边使用主轴前进方向，多出边先使用垂直主轴两侧，其余只在前向 180° 局域均分；源、目标在同侧时必须保持同侧通道。过程图的分支节点必须是 `diamond`，每个出口必须有非空可见标签；菱形端口使用顶点且不得偏移。

`EDGE_CROSSING` 默认阻断，但 `designNotes.layout.crossingExceptions` 可为保持主轴、同层业务顺序或避免更差折返而声明一对必要交叉边；Producer 必须验证声明边对存在、互异且恰好对应实际交叉，并确认交叉不触及节点、文字、标签、箭头或关键端点，且方向与语义可辨。`sideSwitchExceptions` 只允许记录真实避障或业务端口语义导致的跨轴例外，必须命中实际同侧折返或多次换边，不能用于掩盖左右折返。`PORT_APPROACH` 阻断从目标形状内部回折到端口，`ROUTING_MINIMALITY` 阻断存在更短无障碍直达、一折或在已声明 `loopLanes` 的侧别和最小偏移内更少折点候选的流程路径；回路声明不是最少路径豁免。`changeImpactReview` 存在时必须覆盖移动节点的 incident edges。`COLLINEAR_OVERLAP`、节点/文字/标签穿越和未声明或不可读的 `EDGE_CROSSING` 始终阻断；`PORT_DIRECTION`、`DECISION_SHAPE`、`DECISION_EXIT`、`MAIN_FLOW_TRACE` 和 `LOOP_LANE` 继续是可定位的阻断错误码。

### Chrome Provider 证据

当 `target_operation_required` 为 `true` 时，受控 Provider 必须实际检查 DOM/SVG 的节点/边集合、sidecar 主流程/回路/必要交叉覆盖、判定 diamond/出口、edge-node/edge-edge 几何、共线重叠、端口方向与目标外侧接近、同侧通道、边 bbox、标签与无关边 bbox、标签中点法向净空、`10 × 10` 箭头 overlay 可见性及其被节点、后绘制标签或分组边界遮挡、文字/tspan bbox 越界与重叠、白色不透明画布、框体/连线/文字 computed style、marker 尺寸、全局图例/备注缺失、`contentBBox` 及水平溢出。Provider Request 必须提供 `target_reading_environment.viewports.normal`、`.fit`、`.zoom`；缺少任一视图、Chrome 不可用或任一实际检查失败时，不得把 evidence 更新为 `provider_status: "passed"`，应保持 `UNVERIFIED` 或返回 `NEEDS_CAPABILITY`。`--dry-run` 仅验证请求格式和计划。
