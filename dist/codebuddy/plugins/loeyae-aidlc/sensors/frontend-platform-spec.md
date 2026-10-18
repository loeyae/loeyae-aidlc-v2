---
id: frontend-platform-spec
phase: construction
---

# frontend-platform-spec Sensor

在代码生成前的桥接阶段读取 `.aidlc/evidence/ui-implementation-bridge/{module-id}/{unit-id}/frontend-platform-spec.json`。本阶段创建 spec 和证据，代码生成消费并复验，不要求 Inception 提前写单元受管产物。

通过条件：`evidence_version` 为 `1`、`status` 为 `passed`。`mapping_version: 2` 的 `layout_primitives`、`component_mapping`、`css_constraints` 保存现有规范表格的真实行（名称、目标及约束），按已批准设计/平台来源逐项复核，不设固定数量。空表、占位、重复条目、漏实际组件或必要约束拒绝。producer 与主门禁共同读取实际规范和适用来源。

既有 Markdown 四章节/表格继续支持；旧占位数组证据需重新运行 producer，无需补无关映射或新增审批。新规范可用 `design_source`/`platform_source` 引用现有已批准文档的适用章节，详见桥接阶段正文。自然语言来源可在现有 spec 内提供完整 `frontend-source-projection`，绑定来源 SHA-256、原文 quote 和真实映射，标记 `coverage_basis: approved-source-projection`；每个已发现来源独立复核。无来源的既有项目保留真实 spec 表格兼容路径并标记 `coverage_basis: legacy-spec-tables`；解析失败不能静默跳过权威约束。

合法、非未来的 ISO 时间仍必需；纯时间不使确定性结果失效。外部状态使用显式 `freshness` 窗口。身份、provenance、来源、命令、范围、世代及当前真实覆盖仍须通过。仅既有 `needs_ui_implementation_bridge` 触发本阶段，纯 Web 不新增桥接。
