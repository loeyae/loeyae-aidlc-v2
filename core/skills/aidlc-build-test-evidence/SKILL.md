---
name: aidlc-build-test-evidence
description: "运行项目真实构建与测试，解释结果并选择最小充分复验范围。"
triggers: 构建测试证据, 测试证据, 构建证据, 生成测试报告, build test evidence, 受控测试证据
---

# 构建与测试

未加载时先读[共用规则](../../knowledge/protocols/host-execution.md)，已加载则复用。

从项目脚本、配置和已有测试确定真实命令。按[验证顺序与复用](../../knowledge/protocols/verification.md#先短回归再集中核验)选择定向修复验证或完整失败收集，核对所选入口前置条件；查全同类缺陷及消费者，短回归收敛后集中补齐必要检查。统筹 hook 与构建脚本的覆盖，保留项目要求的实际执行。

按[实际影响](../../knowledge/protocols/verification.md#按实际影响验证)选择检查，语义变化沿受影响验收查全。保留命令、输入/环境、退出码、关键输出与缺口，区分选定检查和完整套件。引用原始报告；无法运行时说明原因，继续独立检查。
