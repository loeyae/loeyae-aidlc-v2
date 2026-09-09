---
name: loeyae-aidlc
description: Drive the deterministic Loeyae AI-DLC workflow in Kiro IDE or CLI. Use when the user says AI-DLC, aidlc, 使用 AI-DLC, 继续上次的工作, 功能设计, 用户故事, 代码审查, or 部署准备.
---

# Loeyae AI-DLC v2 — Kiro Agent Skill

当用户请求使用 `AI-DLC`、`aidlc`、`使用 AI-DLC`、继续上次的工作、功能设计、用户故事、代码审查或部署准备时，执行 v2 引擎流程。先在业务项目目录调用：

```bash
loeyae-aidlc orchestrate next --scope <scope>
```

PRD 默认不进入工作流。仅当用户明确选择生成 PRD 时，对 `feature`、`enterprise`、`mvp` 或 `classic` 初始化命令追加 `--with-prd`；选择写入签名状态，活动工作流中不可变。

完整 scope 的 `workspace-detection` 也是运行时 choice：directive 返回 `choice_required: true` 时，必须向用户展示 `single-module`、`multi-module`，并以 `report --stage workspace-detection --result completed --instruction-ack workspace-detection --user-input <choice>` 写入签名 history。单模块跳过产品级 Inception 但仍登记唯一模块；产品契约仅在多模块或存在跨边界事实时执行。快速 scope 不要求该 choice；不得从 `handoff.md` 推断或改变机器路由。

I9 UI 设计不是初始化选项，而是运行时 choice。`ui-mock` directive 返回 `choice_required: true` 时，必须向用户展示 `choices`，并以 `report --stage ui-mock --result completed --instruction-ack ui-mock --user-input <choice>` 记录 `html-mock`、`figma-create`、`figma-existing`、`skip` 中唯一值。`skip` 不创建 UI 产物，HTML/Figma 分支互斥；不得从 `handoff.md` 推断或改变机器路由。

`application-design`、`units-generation`、`functional-design` 和 `operations` 根据 `workflow-plan.md` 的 `execute / skip + evidence` 自动路由；旧计划缺行时才保守推断。I14 跳过后使用 `default` 单元；I14 执行时，新签名 `unit-manifest.json` 必须为每个单元声明 `conditional_stages`（允许空数组），防止其他单元的 NFR、基础设施、契约、框架或 UI 事实扩散，旧清单缺字段时保守回退。Operations condition=false 不出现审批；`operations-templates` 只在明确要求保留可复用模板时执行。

严格按引擎返回的 stage directive 执行。`stage_instance`、`axis`、`module_id`、`unit_id`、`artifact_root`、已解析的 `consumes`/`produces` 和 `evidence_root` 是当前机器上下文；不得根据正文抽象示例写回其他模块/单元或旧全局目录。完成后使用：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
```

当 directive 的 `gate` 为 `true` 时，加载 `aidlc-approval`，读取并展示 request 的随机 `confirmation_phrase` 后结束回合；只有用户下一条真实消息完整匹配，才能通过 `--approval-confirmation-stdin` 定向报告。普通“同意”、预填按钮、Agent 代填、旧消息或同一回合自动提交无效。Provider 是可选增强，真人 TTY 是备用路径。`completion_contract: instruction_only` 必须在执行正文后追加 `--instruction-ack <slug>`，Stop Hook 不能代替确认。公开 report 不支持手动 `skipped`；仅图谱 condition=false 可写内部 `condition_skipped`。

阶段规则和知识文件位于本 Skill 随附的 `stages/`、`knowledge/` 和 `tools/`；阶段顺序、准入准出门禁和传感器以 `tools/aidlc-orchestrate.ts` 为准。`docs/aidlc/aidlc-state.json` 是 HMAC、workflow ID、revision/CAS 保护的唯一机器状态，外部 enrollment 绑定项目路径；`docs/aidlc/handoff.md` 只是派生人类视图。暂停使用 `loeyae-aidlc orchestrate park`，恢复使用 `loeyae-aidlc orchestrate next --resume`。

Evidence 必须由受控 Producer 生成并携带精确 producer、`commit + dirty + worktree_digest` 和 HMAC 完整性；命令只记录 `argv_digest`。需要 Evidence 时，宿主须在第一次 `next` 前向 orchestrator、Producer 和 Hook 注入同一份至少 32 字节的 `AIDLC_TRUST_SECRET`。semantic allowlist 只能声明内置 checker，不能执行项目 Node/Python/shell checker。

## Chrome DevTools 浏览器验收 Provider

安装器将共享 Kiro MCP 默认项合并到用户级配置，其中不指定版本的 `chrome-devtools` MCP（`chrome-devtools-mcp`）仅用于加载独立 SVG 或目标预览 URL，采集 DOM/属性、几何、viewport 截图和控制台等浏览器验收证据。

该 Provider 不生成 SVG、`.diagram.json` 或 PNG/PDF，不负责重新布局，也不替代源级 `diagram-contract` 检查。独立 SVG 优先尝试使用 `file://` URL；若 Chrome 将其呈现为 XML 查看器，运行器会使用只包含当前 SVG 的临时本地 HTML wrapper 进行检查并在结束后删除；无法启动 Chrome 或 MCP 时必须记录 `NEEDS_CAPABILITY`，不得伪造浏览器验证通过。`UNVERIFIED` 等验收状态记录在外部 evidence 或验收报告中，不写入 SVG 图片内容。
