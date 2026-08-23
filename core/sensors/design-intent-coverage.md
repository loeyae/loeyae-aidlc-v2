# design-intent-coverage

## 目的
验证应用设计中的 `[意图:删除]`、`[意图:局部重构]`、`[意图:收敛]`、`[意图:迁出]`、`[意图:废弃]` 均被至少一个工作单元的完成证据或允许修改范围承接。

## Evidence 路径

```text
.aidlc/evidence/units-generation/design-intent-coverage.json
```

## 必填字段

```json
{
  "evidence_version": "1",
  "timestamp": "2026-01-01T00:00:00Z",
  "status": "passed",
  "intent_markers_found": 0,
  "coverage_complete": true,
  "uncovered": 0,
  "skip_reason": "no structural change intent markers"
}
```

存在意图标记时，producer 必须提供覆盖清单并令 `uncovered` 为 0；没有意图标记时必须提供 `skip_reason`。任何未分配意图均阻断 I14 完成。
