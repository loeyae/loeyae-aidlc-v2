---
name: aidlc-code-review
description: "审查实际变更的需求符合性、正确性、安全和可维护性，给出可定位的问题。"
triggers: 代码审查, 代码评审, Code Review, code review, Spec 审查, Standards 审查
---

# 代码审查

未加载时先读[共用规则](../../knowledge/protocols/host-execution.md)，已加载则复用。

从本次 diff、相关需求/设计与已有验证开始，同时检查需求符合性、正确性、安全和可维护性；缺运行结果如实标注。

报告可证实的问题、位置、影响和修复建议。高风险或跨边界变化补相关集成检查；涉及接口、数据、安全或配置时查[工程检查](../../knowledge/protocols/engineering-checks.md)。UI 核对约定状态、尺寸、视觉及真实交互。

复审聚焦修复差异和受影响行为。建议级风格问题不阻止交付；用户要求独立审查时按其要求安排。结果写在对话或原审查记录。
