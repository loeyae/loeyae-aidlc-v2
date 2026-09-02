---
name: loeyae-aidlc
description: Drive the deterministic Loeyae AI-DLC workflow in Kiro IDE or CLI. Use when the user says AI-DLC, aidlc, 使用 AI-DLC, 继续上次的工作, 功能设计, 用户故事, 代码审查, or 部署准备.
---

# Loeyae AI-DLC v2 — Kiro Agent Skill

当用户请求使用 `AI-DLC`、`aidlc`、`使用 AI-DLC`、继续上次的工作、功能设计、用户故事、代码审查或部署准备时，执行 v2 引擎流程。先在业务项目目录调用：

```bash
loeyae-aidlc orchestrate next --scope <scope>
```

严格按引擎返回的 stage directive 执行，完成后使用：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
```

当 directive 的 `gate` 为 `true` 时，聊天中的用户确认本身不是审批凭据。人类审阅后须在交互式终端运行 `loeyae-aidlc approve --stage <slug>`，再以 `--result approved --approval-token <token>` 报告；token 绑定 workflow/stage/challenge、最长 15 分钟且不可重放。Skill、Agent 和 Stop Hook 不得自行签发；无受信 provider/TTY 时 fail-closed。`completion_contract: instruction_only` 必须在执行正文后追加 `--instruction-ack <slug>`，Stop Hook 不能代替确认。公开 report 不支持手动 `skipped`；仅图谱 condition=false 可写内部 `condition_skipped`。

阶段规则和知识文件位于本 Skill 随附的 `stages/`、`knowledge/` 和 `tools/`；阶段顺序、准入准出门禁和传感器以 `tools/aidlc-orchestrate.ts` 为准。`docs/aidlc/aidlc-state.json` 是 HMAC、workflow ID、revision/CAS 保护的唯一机器状态，外部 enrollment 绑定项目路径；`docs/aidlc/handoff.md` 只是派生人类视图。暂停使用 `loeyae-aidlc orchestrate park`，恢复使用 `loeyae-aidlc orchestrate next --resume`。

Evidence 必须由受控 Producer 生成并携带精确 producer、`commit + dirty + worktree_digest` 和 HMAC 完整性；命令只记录 `argv_digest`。需要 Evidence 时，宿主须在第一次 `next` 前向 orchestrator、Producer 和 Hook 注入同一份至少 32 字节的 `AIDLC_TRUST_SECRET`。semantic allowlist 只能声明内置 checker，不能执行项目 Node/Python/shell checker。

## Chrome DevTools 浏览器验收 Provider

安装器将共享 Kiro MCP 默认项合并到用户级配置，其中不指定版本的 `chrome-devtools` MCP（`chrome-devtools-mcp`）仅用于加载独立 SVG 或目标预览 URL，采集 DOM/属性、几何、viewport 截图和控制台等浏览器验收证据。

该 Provider 不生成 SVG、`.diagram.json` 或 PNG/PDF，不负责重新布局，也不替代源级 `diagram-contract` 检查。独立 SVG 优先尝试使用 `file://` URL；若 Chrome 将其呈现为 XML 查看器，运行器会使用只包含当前 SVG 的临时本地 HTML wrapper 进行检查并在结束后删除；无法启动 Chrome 或 MCP 时必须记录 `NEEDS_CAPABILITY`，不得伪造浏览器验证通过。`UNVERIFIED` 等验收状态记录在外部 evidence 或验收报告中，不写入 SVG 图片内容。
