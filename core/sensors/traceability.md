---
id: traceability
name: Traceability
description: Verifies that produced artifacts reference at least one requirement identifier.
---

# traceability

该 sensor 检查阶段产物中是否包含 `REQ-xxx` 或 `R-xxx` 需求标识。缺少需求引用时阻断阶段完成；不适用场景必须由阶段契约明确声明，不能静默跳过。
