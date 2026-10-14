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

## 文档切片附加约束

完整 `inception/requirements.md` 与 `inception/user-stories.md` 永远保留权威正文和稳定路径。
派生视图位于 `inception/document-slices/`：`adoption.json`、`manifest.json` 及
`objects/{sha256}.md`（单元/共享需求、故事与导航索引）。不维护第二份业务事实。
生成、门禁、显式采用和恢复契约见 `knowledge/protocols/common-document-slices.md`。
