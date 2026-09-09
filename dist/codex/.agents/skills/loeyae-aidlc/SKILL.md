---
name: loeyae-aidlc
description: "Loeyae AI-DLC v2 engine-driven lifecycle. Use for requirements, design, implementation, review, debugging, and deployment preparation when the user asks for AI-DLC or aidlc."
---

# Loeyae AI-DLC v2 for Codex

Codex 是 V2 的平台入口，不自行决定阶段顺序。使用已安装 Skill 目录中的确定性引擎获取 directive：

```bash
loeyae-aidlc orchestrate next --scope <scope>
```

PRD 默认不进入工作流。仅当用户明确选择生成 PRD 时，对 `feature`、`enterprise`、`mvp` 或 `classic` 初始化命令追加 `--with-prd`；选择写入签名状态，活动工作流中不可变。

完整 scope 的 `workspace-detection` 也是运行时 choice：directive 返回 `choice_required: true` 时，必须向用户展示 `single-module`、`multi-module`，并以 `report --stage workspace-detection --result completed --instruction-ack workspace-detection --user-input <choice>` 写入签名 history。单模块跳过产品级 Inception 但仍登记唯一模块；产品契约仅在多模块或存在跨边界事实时执行。快速 scope 不要求该 choice；不得从 `handoff.md` 推断或改变机器路由。

I9 UI 设计不是初始化选项，而是运行时 choice。`ui-mock` directive 返回 `choice_required: true` 时，必须向用户展示 `choices`，并以 `report --stage ui-mock --result completed --instruction-ack ui-mock --user-input <choice>` 记录 `html-mock`、`figma-create`、`figma-existing`、`skip` 中唯一值。`skip` 不创建 UI 产物，HTML/Figma 分支互斥；不得从 `handoff.md` 推断或改变机器路由。

`application-design`、`units-generation`、`functional-design` 和 `operations` 根据 `workflow-plan.md` 的 `execute / skip + evidence` 自动路由；旧计划缺行时才保守推断。I14 跳过后使用 `default` 单元；I14 执行时，新签名 `unit-manifest.json` 必须为每个单元声明 `conditional_stages`（允许空数组），防止其他单元的 NFR、基础设施、契约、框架或 UI 事实扩散，旧清单缺字段时保守回退。Operations condition=false 不出现审批；`operations-templates` 只在明确要求保留可复用模板时执行。

严格按 directive 执行。`run-stage` 中的 `stage_instance`、`axis`、`module_id`、`unit_id`、`artifact_root`、已解析 `consumes`/`produces` 和 `evidence_root` 是当前机器上下文，不得跨模块/单元复用产物或 Evidence：

- `run-stage`：读取同一 Skill 目录下的 `stages/` 和 `knowledge/`，执行当前阶段；
- `ask`：用普通文本向用户展示问题和选项，等待用户回答；
- `print`：执行 directive 指定的命令或输出；
- `error`：输出阻断原因并停止；
- `parked`：保留状态并等待后续恢复；
- `done`：工作流完成。

阶段完成后必须报告：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
```

`gate: true` 时，加载 `aidlc-approval` 并读取 request 的随机 `confirmation_phrase`；Agent 展示产物/Evidence 和完整短语后必须结束回合，只有用户下一条真实消息精确匹配，才能通过 `--approval-confirmation-stdin` 定向报告。普通“同意”、预填按钮、Agent 代填、旧消息或同一回合自动提交无效。引擎内部派生并消费 token；Provider 是可选增强，真人 TTY 是备用路径。`instruction_only` stage 必须在执行正文后显式传 `--instruction-ack <slug>`，Stop Hook 不得代确认。公开 report 不接受手动 `skipped`；仅 condition=false 可记录内部 `condition_skipped`。

## Codex 适配

- `docs/aidlc/aidlc-state.json` 是 schema v3 设备签名 append-only event、workflow ID、revision/CAS 保护的唯一机器状态；每台设备使用独立 Ed25519 credential，`docs/aidlc/handoff.md` 仅为派生人类视图；
- `next` 返回 `team-enrollment-confirmation` ask 时，必须展示完整 `JOIN ...` 短语并结束回合；仅用户下一条真实消息精确匹配后通过 strict `--team-enrollment-confirmation-stdin` 完成本机 enrollment。不得代填、同回合提交、复制 private key 或要求共享 `AIDLC_TRUST_SECRET`；
- enrollment 记录已接受 event head，rollback/fork fail-closed；Provider/SCM 权限仍决定共享流写入资格，设备签名不是完整成员授权 PKI；
- evidence 按当前实例隔离：project 为 `.aidlc/evidence/<stage-slug>/`，module 追加 `<module-id>/`，unit 再追加 `<unit-id>/`；只接受受控 Producer 的精确 producer、当前 `commit + dirty + worktree_digest` 和 schema 对应完整性（v3 自动设备 Ed25519，v2 legacy HMAC），命令只记录 `argv_digest`；多个活动实例必须传精确 `--instance`；
- `AIDLC_TRUST_SECRET` 只用于 schema v2/HMAC/recovery legacy，不是 v3 团队配置；semantic 只执行发行包内置 checker；
- 需要子 Agent 时，只使用当前 Codex 会话实际提供的子 Agent 能力；不可用时按阶段规则串行执行；
- MCP、Skill 和项目规则按 Codex 当前会话的可用能力加载；不可用时返回 `NEEDS_CONTEXT` 或 `NEEDS_CAPABILITY`；
- 不把 Skill 入口、阶段执行结果或用户回答伪造成 evidence。

## 边界

本 Skill 不替代引擎的 `requires`、`condition`、`produces`、`sensors`、审批和当前阶段校验。不得更新审计以绕过门禁，不得宣布未通过门禁的阶段完成。
