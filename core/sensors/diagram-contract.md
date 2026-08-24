---
id: diagram-contract
name: Diagram Contract
description: Verifies SVG and diagram structural contracts.
evidence_path: .aidlc/evidence/<stage-slug>/diagram-contract.json
---

# diagram-contract

## 目的
验证需求流程图和应用设计图遵循 V1 SVG/Diagram 契约：稳定 ID、端口、方向、连通性、图例、分组、viewBox、FR 映射和 Provider 状态均有结构化证据。

## Evidence 路径

```text
.aidlc/evidence/<stage-slug>/diagram-contract.json
```

## 必填字段

```json
{
  "evidence_version": "1",
  "timestamp": "2026-01-01T00:00:00Z",
  "status": "passed",
  "source_format": "svg",
  "diagrams_checked": 1,
  "ids_unique": true,
  "ports_valid": true,
  "direction_consistent": true,
  "legend_valid": true,
  "groups_valid": true,
  "viewbox_valid": true,
  "provider_status": "unverified",
  "target_operation_required": false,
  "fr_mapping_complete": true,
  "design_notes_valid": true,
  "migration_status": "passed",
  "port_paths_valid": true,
  "unresolved": 0
}
```

`provider_status` 为 `unverified` 时只表示目标 Provider 尚未执行，不得冒充目标视觉通过。`target_operation_required` 为 `true` 时，`provider_status` 必须为 `passed`，否则阻断；为 `false` 时允许 source-only 交付并保留 `UNVERIFIED`。若用户明确要求预览、渲染或导出，producer 必须将该字段设为 `true`。

新建或调整图必须提供 `diagramType`、`designNotes`、完整边 `points`、图例/分组语义和 FR/REQ 映射。旧 V1 资产缺少适用结构化字段时，Checker 必须 fail-closed 并报告 `MIGRATION_REQUIRED`；`migration_status` 只有在迁移完成后才能为 `passed`。`port_paths_valid` 表示端口、偏移和路径点已完成源级检查。

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
  "stage": "requirements-methods",
  "target_reading_environment": { "viewport": { "width": 1280, "height": 720 } },
  "diagrams": [{
    "id": "requirements-flow",
    "source_path": "docs/aidlc/inception/requirements/assets/requirements-flow.svg",
    "manifest_path": "docs/aidlc/inception/requirements/assets/requirements-flow.diagram.json"
  }]
}
```

运行器固定调用 `chrome-devtools-mcp@1.6.0` 的 CLI，执行页面导航、viewport 调整、DOM/属性/几何检查、可访问性快照、viewport 截图和控制台采集。源级 evidence 不存在或未通过时拒绝执行；浏览器检查失败时不修改既有 evidence；全部适用检查通过后，才原子更新 `provider_status: "passed"`、`target_operation_required: true`，并写入 `diagram-contract-provider.json`、截图和快照。`export` 不属于该 Provider 能力，必须返回 `NEEDS_CAPABILITY`。

对本地 SVG，运行器会先验证源文件的静态安全约束；若 Chrome 将直接 `file://` SVG 呈现为 XML 查看器，则使用只包含当前 SVG 的临时本地 HTML wrapper 进行浏览器检查，wrapper 在运行结束后删除，不修改 SVG 源。无法启动或调用 Chrome DevTools 时保持原有 `UNVERIFIED` evidence，不得伪造通过。
