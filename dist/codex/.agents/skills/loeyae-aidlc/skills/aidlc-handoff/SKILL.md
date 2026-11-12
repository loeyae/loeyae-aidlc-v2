---
name: aidlc-handoff
description: Summarize scope, actual implementation, verification and remaining work without execution gates.
---

# 交接

默认遵循 [宿主执行协议](../../knowledge/protocols/host-execution.md)。在对话中简短说明范围、实际改动、关键决定、真实命令及结果引用、未完成项和下一步。确需持久交接时更新一份现有任务说明，不新建并行 handoff/progress/state/audit。交接不需要 CLI、签名或授权刷新，不使已通过测试失效。业务、验证与效率分开报告，未验证不写成通过。

旧状态损坏或 claim 过期不阻止独立本地工作。保留旧记录及他人修改，未知进程不接管。只有用户明确要求维护旧受管流程时才加载 [旧会话协议](../../knowledge/protocols/common-session-handoff.md)，原授权保护不因本 Skill 解除。
