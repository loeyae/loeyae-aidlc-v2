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

Agent 不能手工修改状态来跳过门禁，也不能把 Hook 输出当作质量证据。若 `handoff_prompt` 表示无法确认某项信息，必须如实保留该状态而不是宣称完成。