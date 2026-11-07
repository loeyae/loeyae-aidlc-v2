---
id: traceability
name: Traceability
description: Verifies that produced artifacts reference at least one requirement identifier, except machine evidence artifacts.
---

# traceability

所有声明 `produces` 的阶段自动启用本 sensor。它递归检查静态、目录和动态单元产物中的文本文件，要求至少包含 `REQ-xxx` 或 `R-xxx` 需求标识。`.aidlc/evidence/` 下的机器证据由对应 schema 和 controlled provenance 校验，不重复执行文本需求引用扫描。

纯机器 evidence 阶段必须在 frontmatter 中显式声明 `traceability: not_applicable`；没有该声明的阶段不能静默跳过检查。