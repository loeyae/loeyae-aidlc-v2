---
name: aidlc-test-case-derivation
description: "从已确认行为与技术风险补充可执行测试，复用项目现有测试结构。"
triggers: 测试用例派生, UC-D, 测试场景, 验收测试设计, test case derivation, 测试用例设计
---

# 测试派生

未加载时先读[共用规则](../../knowledge/protocols/host-execution.md)，已加载则复用。

从本次要求、实现和已有测试出发，按[受影响验收引用](../../knowledge/protocols/verification.md#沿既有验收引用查全影响)收集完整候选后判断影响，覆盖前置、失败、边界、并发及消费者；把遗漏归回原权威记录并核对差集。

在获准修改的项目测试结构中复用或补充行为测试，必要追溯保留于测试名称/说明。断言依据需求、独立算例或已知结果，避免复制实现；已有覆盖无需按每条文档引用重复建例。输出测试位置、覆盖与缺口，未运行不宣称通过。
