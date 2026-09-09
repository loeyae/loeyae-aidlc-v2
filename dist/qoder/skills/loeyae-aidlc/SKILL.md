---
name: loeyae-aidlc
description: Use when the user asks to use AI-DLC, aidlc, requirements, design, implementation, review, debugging, or deployment through the deterministic Loeyae AI-DLC workflow in Qoder CN IDE, Desktop, or CLI.
---

# Loeyae AI-DLC v2 for Qoder CN IDE / Desktop / CLI

Qoder CN IDE、Qoder Desktop 或 CLI 是 AI-DLC 的平台入口，不自行决定阶段顺序。在业务项目目录调用：

```bash
loeyae-aidlc orchestrate next --scope <scope>
```

PRD 默认不进入工作流。仅当用户明确选择生成 PRD 时，对 `feature`、`enterprise`、`mvp` 或 `classic` 初始化命令追加 `--with-prd`；选择写入签名状态，活动工作流中不可变。

完整 scope 的 `workspace-detection` 也是运行时 choice：directive 返回 `choice_required: true` 时，必须向用户展示 `single-module`、`multi-module`，并以 `report --stage workspace-detection --result completed --instruction-ack workspace-detection --user-input <choice>` 写入签名 history。单模块跳过产品级 Inception 但仍登记唯一模块；产品契约仅在多模块或存在跨边界事实时执行。快速 scope 不要求该 choice；不得从 `handoff.md` 推断或改变机器路由。

I9 UI 设计不是初始化选项，而是运行时 choice。`ui-mock` directive 返回 `choice_required: true` 时，必须向用户展示 `choices`，并以 `report --stage ui-mock --result completed --instruction-ack ui-mock --user-input <choice>` 记录 `html-mock`、`figma-create`、`figma-existing`、`skip` 中唯一值。`skip` 不创建 UI 产物，HTML/Figma 分支互斥；不得从 `handoff.md` 推断或改变机器路由。

`application-design`、`units-generation`、`functional-design` 和 `operations` 根据 `workflow-plan.md` 的 `execute / skip + evidence` 自动路由；旧计划缺行时才保守推断。I14 跳过后使用 `default` 单元；I14 执行时，新签名 `unit-manifest.json` 必须为每个单元声明 `conditional_stages`（允许空数组），防止其他单元的 NFR、基础设施、契约、框架或 UI 事实扩散，旧清单缺字段时保守回退。Operations condition=false 不出现审批；`operations-templates` 只在明确要求保留可复用模板时执行。

严格执行返回的 directive；其中 `stage_instance`、`axis`、`module_id`、`unit_id`、`artifact_root`、已解析的 `consumes`/`produces` 和 `evidence_root` 是当前机器上下文，不得跨模块/单元复用产物或 Evidence。完成当前阶段后调用：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
```

`gate: true` 阶段先加载 `aidlc-approval`，展示 request 的随机 `confirmation_phrase` 后结束回合；只有用户下一条真实消息完整匹配，才能通过 `--approval-confirmation-stdin` 定向报告。普通“同意”、预填按钮、Agent 代填、旧消息或同一回合自动提交无效。Provider 是可选增强，真人 TTY 是备用路径。`instruction_only` 阶段必须在执行正文后传入 `--instruction-ack <slug>`。公开 report 不支持手动 `skipped`，只有图谱条件为 false 时引擎才能记录内部 `condition_skipped`。

插件 Stop Hook 通过退出码 2 向 Qoder 返回阻断反馈。重入的 Stop 回调按 Qoder 的 `stop_hook_active` 契约停止再次阻断，但签名工作流状态仍保持 running，后续会话必须继续完成当前阶段。Hook 不直接修改 `docs/aidlc/aidlc-state.json` 或 `.aidlc/evidence/`。

状态、Evidence、审批、前置依赖、产物和 sensors 均以随插件发布的 `tools/`、`stages/`、`knowledge/` 和 `sensors/` 为准。需要 Evidence 时，必须在第一次 `next` 前向 Qoder 宿主、CLI、Producer 和 Hook 注入同一份至少 32 字节的 `AIDLC_TRUST_SECRET`。
