---
name: aidlc-continuity
description: Continue an AWS-style lightweight AI-DLC workflow from Markdown state and audit.
---

# Lightweight Workflow Continuity

先读取 [会话绑定与转交契约](../../knowledge/protocols/common-session-handoff.md)，按当前布局读取 workflow state/audit；per-module 布局还读取 registry 和目标模块状态。单工作流路径为：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

先只读确定目标：

```bash
loeyae-aidlc orchestrate next --preview
```

需要进度概览时读取 `orchestrate state summary`。旧 `handoff.md` 或实施摘要缺失/过期不阻断恢复，不重建第二份状态；真实产物、证据与领取问题仍按引擎诊断处理。

per-module 布局（存在 `aidlc/active/registry.md`）下，多个模块 workflow 都可推进时，`next` 返回 `kind: "ask"`（`ask_type: "module-selection"`），`modules` 列出各模块的下一阶段。此时必须向用户提问由用户指定模块，不得自行选择，也不得根据工作描述推断模块；得到回答后运行：

```bash
loeyae-aidlc orchestrate next --preview --module <module-id>
```

也可设置环境变量 `AIDLC_MODULE=<module-id>` 作为默认模块，效果等同 `--module`；显式 `--module` 优先，模块不存在时直接报错，不会回退到其他模块。只有一个模块可推进时直接使用该目标。

持有当前精确 session binding 时复用它；否则按会话契约 inspect/bind。用户已明确转交且目标、新领取人清楚时直接 transfer，无需原领取人再次批准。取得 binding 后运行 `orchestrate next [--module <id>]`；明确恢复已暂停实例时追加 `--resume`。`unit select` 是协作记录，不能替代 session binding。

“继续”沿用当前批准目标与范围。失败时先读取诊断，区分真实缺测试、映射缺失、证据失效与状态/权限冲突；不得把所有阻塞都转换成新增测试。相同原因、相同输入连续失败时停止等价重试，记录已尝试操作并切换诊断路径；输入修正后再验证当前阶段。

若没有 active workflow，要求用户明确新的工作描述并启动：

```bash
loeyae-aidlc orchestrate next --scope <scope> --work "<工作描述>"
```

必须展示 directive 的 `handoff_prompt`。团队成员进入 Construction 时先查看或声明 unit：

```bash
loeyae-aidlc unit list
loeyae-aidlc unit select --module <id> --unit <id> --member <name> --branch <branch>
```

review、构建、测试和 merge plan 是交付依据。
