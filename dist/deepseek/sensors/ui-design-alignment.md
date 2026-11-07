---
id: ui-design-alignment
name: UI Design Alignment
description: Verifies implementation alignment with HTML Mock or Figma design evidence.
evidence_path: .aidlc/evidence/code-review/ui-design-alignment.json
---

# ui-design-alignment

## 目的
验证 Construction 代码审查中的 HTML Mock/Figma 页面、组件、可见性、样式和平台约束与实现一致。

## Evidence 路径

```text
.aidlc/evidence/code-review/ui-design-alignment.json
```

## 非 UI 项目

```json
{
  "evidence_version": "1",
  "timestamp": "2026-01-01T00:00:00Z",
  "status": "not_applicable"
}
```

## UI 项目必填字段

```json
{
  "evidence_version": "1",
  "timestamp": "2026-01-01T00:00:00Z",
  "status": "passed",
  "design_mode": "html-mock",
  "pages_checked": 1,
  "pages_covered": ["PAGE-001"],
  "elements_checked": 1,
  "unmapped_elements": 0,
  "extra_elements": 0,
  "styles_aligned": true,
  "conditional_visibility_aligned": true,
  "platform_constraints_respected": true
}
```

`design_mode` 必须为 `html-mock` 或 `figma`。存在未映射元素、多余 UI、样式偏差、条件可见性偏差或平台约束违规时阻断 Code Review。

`pages_covered` 列出本单元在 `code-generation-plan` 页面对照表中覆盖的 PAGE id（非空、长度等于 `pages_checked`），供 `implementation-report` 做每页正向全覆盖对账。

## 缺页面映射与显式豁免（MARS-125）

选了 UI route 的单元，若 `code-generation-plan` 缺「页面对照表 / page mapping」章节：

- 默认判 **fail**（页面映射应有而缺失），不再静默 `not_applicable`——否则整个 UI 对齐门禁会被该节缺席击穿。
- 本单元确实无界面承载时，必须在 `code-generation-plan` 中用显式豁免标记 `[ui: n/a]` / `[ui：n/a]` / `[无界面]`（大小写不敏感）声明，才返回 `not_applicable`。
