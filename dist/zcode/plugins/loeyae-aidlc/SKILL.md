---
name: loeyae-aidlc
description: Use when the user asks to use AI-DLC, aidlc, requirements, design, implementation, review, debugging, or deployment through the deterministic Loeyae AI-DLC workflow in ZCode.
---

# Loeyae AI-DLC v2 for ZCode

ZCode 是 AI-DLC 的平台入口，不自行决定阶段顺序。在业务项目目录调用：

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

`gate: true` 阶段只能使用受信任的人类审批 token；Skill、Agent 和 Stop Hook 不得自行签发。`instruction_only` 阶段必须在执行正文后传入 `--instruction-ack <slug>`。公开 report 不支持手动 `skipped`，只有图谱条件为 false 时引擎才能记录内部 `condition_skipped`。

Stop Hook 返回 ZCode 原生 `decision: block` 反馈。ZCode 最多连续继续主模型三次，因此生命周期反馈有宿主上限；未完成阶段仍保留在签名工作流状态中，后续会话必须继续。Hook 不直接修改 `docs/aidlc/aidlc-state.json` 或 `.aidlc/evidence/`。

状态、Evidence、审批、前置依赖、产物和 sensors 均以随 Skill/插件发布的 `tools/`、`stages/`、`knowledge/` 和 `sensors/` 为准。需要 Evidence 时，必须在第一次 `next` 前向 ZCode、CLI、Producer 和 Hook 注入同一份至少 32 字节的 `AIDLC_TRUST_SECRET`。
