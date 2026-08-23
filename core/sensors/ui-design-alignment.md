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
  "elements_checked": 1,
  "unmapped_elements": 0,
  "extra_elements": 0,
  "styles_aligned": true,
  "conditional_visibility_aligned": true,
  "platform_constraints_respected": true
}
```

`design_mode` 必须为 `html-mock` 或 `figma`。存在未映射元素、多余 UI、样式偏差、条件可见性偏差或平台约束违规时阻断 Code Review。
