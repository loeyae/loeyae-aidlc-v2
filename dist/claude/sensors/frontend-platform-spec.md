---
id: frontend-platform-spec
phase: construction
---

# frontend-platform-spec Sensor

读取 `.aidlc/evidence/ui-implementation-bridge/frontend-platform-spec.json`。

通过条件：`evidence_version` 为 `1`、`status` 为 `passed`。`mapping_version: 2` 的 `layout_primitives`、`component_mapping`、`css_constraints` 保存现有规范表格的真实行（名称、目标及约束），按已批准设计/平台来源逐项复核，不设固定数量。空表、占位、重复条目、漏实际组件或必要约束拒绝。producer 与主门禁共同读取实际规范和适用来源。

既有 Markdown 四章节/表格继续支持；旧占位数组证据需重新运行 producer，无需补无关映射或新增审批。新规范可用 `design_source`/`platform_source` 引用现有已批准文档的适用章节，详见桥接阶段正文。无来源的既有项目保留真实 spec 表格兼容路径并标记 `coverage_basis: legacy-spec-tables`；存在来源但无法解析时须指向适用表格，不能静默跳过。

合法、非未来的 ISO 时间仍必需；纯时间不使确定性结果失效。外部状态使用显式 `freshness` 窗口。身份、provenance、来源、命令、范围、世代及当前真实覆盖仍须通过。仅既有 `needs_ui_implementation_bridge` 触发本阶段，纯 Web 不新增桥接。
