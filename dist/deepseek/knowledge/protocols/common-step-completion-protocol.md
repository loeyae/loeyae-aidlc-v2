# 步骤完成协议

完成阶段前，Agent 必须：

1. 生成 directive 声明的产物；
2. 满足 consumes、requires、condition 和 sensor；
3. 仅运行当前 directive 声明或绑定、且未被当前有效受控 Evidence 覆盖的 review、构建和测试；修复后只重跑受影响、失效或尚未满足的检查，确定性 producer/sensor 继续由引擎负责；
4. 用 `orchestrate report` 记录结果；
5. 原样展示返回的 `handoff_prompt`。

当前 workflow 的状态和审计始终写入：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

state/audit/ledger 由引擎维护，Agent 只在已有业务产物或问题记录中补充真实决策、风险与例外，不抄写机器统计。需要简短摘要时读取 `orchestrate state summary`；仅在用户明确导出时保存到 `.aidlc/views/`，不作为阶段产物或门禁依据。

Agent 不能手工修改状态来跳过门禁，也不能把 Hook 输出或派生摘要当作质量证据。若 `handoff_prompt` 表示无法确认某项信息，必须如实保留该状态而不是宣称完成。
