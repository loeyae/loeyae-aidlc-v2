---
name: aidlc-handoff
description: Summarize scope, actual implementation, verification and remaining work without execution gates.
---

# 交接

默认遵循 [宿主执行协议](../../knowledge/protocols/host-execution.md)。在对话中简短说明范围、实际改动、关键决定、真实命令及结果引用、未完成项和下一步。确需持久交接时更新一份现有任务说明，不新建并行 handoff/progress/state/audit。交接不需要 CLI、签名或授权刷新，不使已通过测试失效。业务、验证与效率分开报告，未验证不写成通过。

交付分别说明实施、验收和提交/合并及 CR 收口。QA 或外部决定待完成时只保留相应待办；实际缺陷才返修。按宿主协议维护一处决定和结果摘要，多单元引用同一验证记录；既有摘要不因文件存在就逐份同步。关闭条件满足后才按项目约定整理 CR，未提交或唯一记录不得提前删除。

旧状态损坏或 claim 过期不阻止独立本地工作。保留旧记录及他人修改，未知进程不接管。
所有结论遵循 [统一完成判定](../../knowledge/protocols/completion.md)，未知、失败、过期和外部待办不能省略。
