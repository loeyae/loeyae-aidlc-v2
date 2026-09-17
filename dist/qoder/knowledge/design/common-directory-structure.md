# AI-DLC 目录结构

```text
<project>/
├── aidlc/
│   └── active/
│       ├── aidlc-state.md
│       ├── audit.md
│       └── worktrees/
├── .aidlc/
│   └── evidence/
└── docs/
    └── aidlc/
        ├── ideation/
        │   └── module-manifest.json
        └── modules/
            └── <module-id>/
                ├── inception/
                │   └── unit-manifest.json
                └── construction/
                    └── <unit-id>/
```

- `aidlc/active/aidlc-state.md` 是可读的 workflow 状态。
- `aidlc/active/audit.md` 追加状态更新记录。
- module manifest 列出模块；unit manifest 列出模块内可独立交付的单元与条件阶段。
- Evidence 路径由当前 directive 的 `evidence_root` 决定。
- 成员在完成 report 后切换上下文；`handoff_prompt` 只提供人类交接说明，不能改变阶段或单元。
