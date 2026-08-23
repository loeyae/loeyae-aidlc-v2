# prd-completeness

## 目的
验证 I15 生成的 PRD 具备可实施的功能需求、验收标准、非目标、待确认项、来源索引和一致性结论。

## Evidence 路径

```text
.aidlc/evidence/prd-generation/prd-completeness.json
```

## 必填字段

```json
{
  "evidence_version": "1",
  "timestamp": "2026-01-01T00:00:00Z",
  "status": "passed",
  "prd_path": "docs/aidlc/ideation/prd.md",
  "required_sections": ["overview", "goals", "features", "non-goals", "questions", "sources"],
  "functional_requirements": 1,
  "acceptance_criteria_complete": true,
  "non_goals_complete": true,
  "pending_questions_indexed": true,
  "source_index_complete": true,
  "clarification_consistency": "passed",
  "business_flow_validation": "passed",
  "unresolved_blockers": 0
}
```

`business_flow_validation` 在不适用业务流程图时可为 `not_applicable`，但必须由 producer 记录依据。缺失字段、未解决阻断项、验收标准缺失或来源索引不完整时阻断 PRD stage。
