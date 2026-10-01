---
name: aidlc-continuity
description: Continue an AWS-style lightweight AI-DLC workflow from Markdown state and audit.
---

# Lightweight Workflow Continuity

当前 workflow 只读取：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

继续工作：

```bash
loeyae-aidlc orchestrate next
```

per-module 布局（存在 `aidlc/active/registry.md`）下，多个模块 workflow 都可推进时，`next` 返回 `kind: "ask"`（`ask_type: "module-selection"`），`modules` 列出各模块的下一阶段。此时必须向用户提问由用户指定模块，不得自行选择，也不得根据工作描述推断模块；得到回答后运行：

```bash
loeyae-aidlc orchestrate next --module <module-id>
```

也可设置环境变量 `AIDLC_MODULE=<module-id>` 作为默认模块，效果等同 `--module`；显式 `--module` 优先，模块不存在时直接报错，不会回退到其他模块。只有一个模块可推进时，`next` 直接返回该模块的 directive。

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