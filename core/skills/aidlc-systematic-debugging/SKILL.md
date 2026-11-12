---
name: aidlc-systematic-debugging
description: "基于实际错误和可检验假设定位问题，进行最小修复并验证。"
triggers: 系统化调试, 根因分析, 故障定位, 问题排查, debugging, reproducible failure
---

# systematic-debugging

先读取现有错误、代码和必要环境信息；缺稳定复现时主动收集日志或构造最小复现，这正是调试工作，不是开始调查的前置许可。明显语法/路径错误可直接定位修复；复杂、反复或高风险问题逐项检验假设。

保留原失败输出，说明根因的证据与不确定性。修复后运行能检验该问题的短测试，再按影响补关联检查。普通修复只需对话说明，重大事件或用户要求时才写专门报告。

相同失败且没有新信息时，不继续原样重跑；缩小复现、改变诊断或说明真实外部阻塞。不能为通过而删除必要断言；其他独立工作继续。

默认由宿主执行，结果和必要业务文档是工作依据；共享边界见 [宿主执行协议](../../knowledge/protocols/host-execution.md)。

## 兼容参考

仅明确使用旧受管/受控产证模式时读取 [旧契约](../../knowledge/legacy-skills/aidlc-systematic-debugging.md)，默认不加载。
