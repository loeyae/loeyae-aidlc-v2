---
name: "loeyae-aidlc-v2"
displayName: "Loeyae AI-DLC v2"
version: "2.0.2"
description: "引擎驱动的 AI-DLC 生命周期，使用准入、准出和传感器门禁保证流程完整性。"
keywords: ["aidlc", "AI-DLC", "使用 AI-DLC", "功能设计", "代码审查", "部署准备"]
author: "Loeyae Team"
---

# Loeyae AI-DLC v2

激活后使用 `tools/aidlc-orchestrate.ts` 驱动流程，不自行决定阶段顺序。先在业务项目目录执行：

```bash
loeyae-aidlc orchestrate next --scope <scope>
```

按 directive 执行 `stages/` 中的阶段文件，完成后报告结果。`gate: true` 不是口头确认：人类须在交互式终端运行 `loeyae-aidlc approve --stage <slug>`（或使用受信宿主 provider），再以一次性 `--approval-token` 报告 `approved`；Power、Agent 和 Stop Hook 不得自行签发，无 provider/TTY 时 fail-closed。`instruction_only` 阶段执行正文后必须显式 `--instruction-ack <slug>`。公开 report 不支持手动 skip，只有 condition=false 可记录内部 `condition_skipped`。

`docs/aidlc/aidlc-state.json` 是 HMAC、workflow ID、revision/CAS 保护的唯一机器状态，外部 enrollment 绑定项目；`docs/aidlc/handoff.md` 仅为派生人类视图。Evidence 必须由受控 Producer 生成，绑定完整 source revision 并通过 HMAC 校验；需要 Evidence 时必须在第一次 `next` 前统一注入至少 32 字节的 `AIDLC_TRUST_SECRET`，semantic 只执行发行包内置 checker。

阶段图、门禁和知识规则均来自本 Power 随附的 `steering/`、`tools/` 和 `knowledge/`，平台入口不复制流程规则。

## Chrome DevTools 浏览器验收 Provider

本 Power 的 `mcp.json` 预置不指定版本的 `chrome-devtools` MCP（`chrome-devtools-mcp`），仅用于加载独立 SVG 或目标预览 URL，采集 DOM/属性、几何、viewport 截图和控制台等浏览器验收证据。

该 Provider 不生成 SVG、`.diagram.json` 或 PNG/PDF，不负责重新布局，也不替代源级 `diagram-contract` 检查。独立 SVG 优先尝试使用 `file://` URL；若 Chrome 将其呈现为 XML 查看器，运行器会使用只包含当前 SVG 的临时本地 HTML wrapper 进行检查并在结束后删除；无法启动 Chrome 或 MCP 时必须记录 `NEEDS_CAPABILITY`，不得伪造浏览器验证通过。`UNVERIFIED` 等验收状态记录在外部 evidence 或验收报告中，不写入 SVG 图片内容。
