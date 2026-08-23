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
  "unresolved": 0
}
```

`provider_status` 为 `unverified` 时只表示目标 Provider 尚未执行，不得冒充目标视觉通过。`target_operation_required` 为 `true` 时，`provider_status` 必须为 `passed`，否则阻断；为 `false` 时允许 source-only 交付并保留 `UNVERIFIED`。若用户明确要求预览、渲染或导出，producer 必须将该字段设为 `true`。旧 V1 资产缺少新结构化字段时标记 `MIGRATION_REQUIRED`，不能直接通过新门禁。
