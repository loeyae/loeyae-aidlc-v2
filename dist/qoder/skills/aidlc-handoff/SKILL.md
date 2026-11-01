---
name: aidlc-handoff
description: 根据当前 Markdown workflow 生成清晰的 AI-DLC 交接提示词。
triggers: 暂停并交接, 交接当前工作, 生成交接, handoff, aidlc handoff
---

# AI-DLC 交接

先读取 [会话绑定与转交契约](../../knowledge/protocols/common-session-handoff.md)，只读查看当前 workflow：

```bash
loeyae-aidlc orchestrate next --preview
```

将返回的 `handoff_prompt` 原样展示为可复制文本。提示词必须包含工作目标、当前阶段/实例、module/unit、产物、review/build/test 与下一步。

需要简短进度概览时读取 `orchestrate state summary`，不另写或同步 `handoff.md`、单元实施摘要。用户明确要求导出时可保存到 `.aidlc/views/`，仅作可重建展示；精确领取与路由仍由 state 和会话契约决定。

用户仅希望换会话或换成员时，不要暂停流程。下一位成员按会话契约 inspect 精确实例并 bind；已有领取需要明确人类转交时使用 transfer。转交授权已经明确且目标清楚时直接执行，无需原领取人再次批准。持有返回的 binding 后运行 `orchestrate next`，从现有产物和有效证据继续。per-module 布局下若返回 `ask_type: "module-selection"`，须由用户指定模块，不得自行选择。

交接说明保留当前阻塞原因、已执行验证和最小下一步；不要把证据失效写成业务测试缺失。更换执行环境导致检查器身份变化时，仅按诊断重验受影响证据，不因此重写需求、契约或测试用例。

用户明确要求暂停时执行：

```bash
loeyae-aidlc orchestrate park
```

恢复时执行：

```bash
loeyae-aidlc orchestrate next --resume
```

交接说明不能改变阶段、单元选择或质量门禁。
