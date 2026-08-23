---
name: "loeyae-aidlc-v2"
displayName: "Loeyae AI-DLC v2"
version: "2.0.0"
description: "引擎驱动的 AI-DLC 生命周期，使用准入、准出和传感器门禁保证流程完整性。"
keywords: ["aidlc", "AI-DLC", "使用 AI-DLC", "功能设计", "代码审查", "部署准备"]
author: "Loeyae Team"
---

# Loeyae AI-DLC v2

激活后使用 `tools/aidlc-orchestrate.ts` 驱动流程，不自行决定阶段顺序。先在业务项目目录执行：

```bash
loeyae-aidlc orchestrate next --scope <scope>
```

按 directive 执行 `stages/` 中的阶段文件，完成后报告结果。`gate: true` 的阶段必须获得用户确认并报告 `approved`；`ALWAYS` 阶段禁止跳过。状态文件为业务项目的 `docs/aidlc/aidlc-state.json`。

阶段图、门禁和知识规则均来自本 Power 随附的 `steering/`、`tools/` 和 `knowledge/`，平台入口不复制流程规则。
