---
name: loeyae-aidlc
description: Use when the user asks to use AI-DLC, aidlc, or the Loeyae AI-DLC workflow; orchestrate work through the deterministic stage engine and its gates.
---

# Loeyae AI-DLC v2 — Claude Code 入口（3.0 协作状态）

当用户消息包含 `AI-DLC` 或 `aidlc` 时进入 schema-aware 确定性引擎流程。先读取当前发布包中的 `stages/` 与 `knowledge/`，再在业务项目目录执行：

```bash
loeyae-aidlc orchestrate next --scope <scope> \
  --actor-id <actor> --device-id <device> --client-id <client>
```

PRD 默认不进入工作流。仅当用户明确选择生成 PRD 时，对 `feature`、`enterprise`、`mvp` 或 `classic` 初始化命令追加 `--with-prd`；选择写入签名状态，活动工作流中不可变。

完整 scope 的 `workspace-detection` 也是运行时 choice：directive 返回 `choice_required: true` 时，必须向用户展示 `single-module`、`multi-module`，并以 `report --stage workspace-detection --result completed --instruction-ack workspace-detection --user-input <choice>` 写入签名 history。单模块跳过产品级 Inception 但仍登记唯一模块；产品契约仅在多模块或存在跨边界事实时执行。快速 scope 不要求该 choice；不得从 `handoff.md` 推断或改变机器路由。

I9 UI 设计不是初始化选项，而是运行时 choice。`ui-mock` directive 返回 `choice_required: true` 时，必须向用户展示 `choices`，并以 `report --stage ui-mock --result completed --instruction-ack ui-mock --user-input <choice>` 记录 `html-mock`、`figma-create`、`figma-existing`、`skip` 中唯一值。`skip` 不创建 UI 产物，HTML/Figma 分支互斥；不得从 `handoff.md` 推断或改变机器路由。

`application-design`、`units-generation`、`functional-design` 和 `operations` 根据 `workflow-plan.md` 的 `execute / skip + evidence` 自动路由；旧计划缺行时才保守推断。I14 跳过后使用 `default` 单元；I14 执行时，新签名 `unit-manifest.json` 必须为每个单元声明 `conditional_stages`（允许空数组），防止其他单元的 NFR、基础设施、契约、框架或 UI 事实扩散，旧清单缺字段时保守回退。Operations condition=false 不出现审批；`operations-templates` 只在明确要求保留可复用模板时执行。

严格按引擎返回的 stage directive 执行，完成后使用：

```bash
claim-receipt.json | loeyae-aidlc orchestrate report \
  --stage <slug> --instance <stage-instance> --result completed \
  --claim-receipt-stdin
```

当 directive 的 `gate` 为 `true` 时，用户可调用 `/aidlc-approve` 加载 `skills/aidlc-approval/SKILL.md`。schema v3 request 必须绑定明确 `--instance`，并返回随机 `confirmation_phrase`；Slash Command 本身不是批准。Agent 展示当前产物/Evidence 和完整确认语后必须结束回合，只有用户在下一条真实消息中手工输入完全一致的文本，才能把 `aidlc.approval.confirmation` 与 claim receipt 组成严格 stdin envelope，通过 `--approval-confirmation-stdin` 定向报告。普通“同意”、预填按钮、Agent 复制确认语、旧消息或同一回合自动提交都无效。引擎内部生成并立即消费 token，继续校验 TTL、instance、receipt、produces 和 sensors。受信 Claude Provider 只是可选一键增强，真人 TTY 只是备用路径。`instruction_only` stage 必须在执行正文后显式追加 `--instruction-ack <slug>`。公开 report 不支持手动 `skipped`，仅 condition=false 可产生内部 `condition_skipped`。

`docs/aidlc/aidlc-state.json` 是 schema v3 签名 append-only event 与 instance map 的唯一机器状态；不同 ready instances 可并行 claim。每台设备自动生成独立 Ed25519 credential，state/event/receipt/v3 Evidence 可跨设备验证，不配置、传递或共享 `AIDLC_TRUST_SECRET`。若 `next` 返回 `ask_type: "team-enrollment-confirmation"`，Agent 必须展示完整 `JOIN ...` 短语并结束回合；只有用户下一条真实消息精确匹配后，才能通过 strict `--team-enrollment-confirmation-stdin` 完成本机 enrollment。完成 enrollment 后若返回 `ask_type: "migration-claim-recovery-confirmation"`，只允许旧 claim 的同一 actor；Agent 展示完整 `TAKEOVER ...` 并再次结束回合，只有下一条精确消息才能经 strict `--migration-claim-recovery-confirmation-stdin` 换取当前 device/client 的有限期 Local/Git receipt。JOIN、TAKEOVER、APPROVE 必须使用独立请求和回合；不得自动接管、跨 actor 接管或改用 `recover re-enroll`。不得代填、同回合提交或复制 private key。enrollment 记录已接受 event head，rollback/fork fail-closed；Provider/SCM 权限仍决定谁能写共享流，设备签名不是完整成员授权 PKI。

actor/device/client 标识 execution lease holder，assignment 和 handoff 都不能授权 report。Local Provider 仅同工作树；跨工作树/设备使用 Git Provider 专用 coordination ref 或具体 External Provider。用户说“继续”“接手”或“在这台设备继续”时加载 `skills/aidlc-continuity/SKILL.md`：running workflow 直接从签名 ready/claimed set 恢复，不要求 park；只有已 parked workflow 才在用户明确继续后使用 `next --resume`。`park` 冻结整个 workflow。schema v2/HMAC/recovery 仅为兼容路径，可显式 `state migrate-v3`；受控 legacy re-enroll 的 parked 要求保持不变。

Evidence 只接受受控 Producer 的精确 provenance、当前 `commit + dirty + worktree_digest` 与 schema 对应完整性：v3 自动设备 Ed25519，v2 legacy HMAC。命令只记录 `argv_digest`，semantic 固定执行发行包内置 checker；同 stage 多个活动实例时必须传 `--instance`。

平台适配只负责入口和工具调用；顶层 CLI 依据 state schema 分流兼容编排器与协作 v3 编排器，阶段顺序、准入准出门禁和产物要求仍以发布包 `tools/` 与 `stages/*` 为准。
