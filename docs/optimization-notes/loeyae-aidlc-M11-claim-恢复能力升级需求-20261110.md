# Loeyae AI-DLC 升级需求：M11 模块级过期 Claim 恢复

## 目的

支持单个模块因会话中断、宿主重启或续领异常导致 claim 过期时，安全恢复该模块，而不暂停整个仓库的并行 AI-DLC 工作流。

## 受影响范围

- Workflow ID：`6b149b81-fb83-4f37-a4c2-2fdf1229a6f8`
- Module：`m11-recommend`
- 关键实例：`application-design@module:m11-recommend`

M11 已完成 application-design 变更的 evidence 验证，但无法提交 `approved` 报告。

## 问题现象

`module inspect` 能返回过期 claim 与最新 expected token；但所有正常恢复路径形成死锁：

```text
claim expired → 必须 bind/renew 才能写入
bind/renew → 要求仍有效的 current session binding
过期 binding → 无法生成新 binding
release/report → 又要求先 bind/renew
```

已观察到的错误包括：

```text
claim expired for application-design@module:m11-recommend; explicitly bind/renew before writing
renewal requires the current session binding
resume must target the parked current instance
Cannot read properties of null (reading 'project_root')
```

## 为什么不能直接删除 claim

Claim 同时记录在模块 `aidlc-state.md`、模块 `audit.md` 和共享 registry/锁状态。手工删除其中任意一处会造成受管状态不一致，可能破坏 evidence、报告与其他工作流并发保护。

## 当前维护入口的局限

现有命令：

```bash
loeyae-aidlc orchestrate state maintenance-plan --module m11-recommend
loeyae-aidlc orchestrate state recover --module m11-recommend --maintenance <token> --user-input Approve
```

虽然指定 M11，但维护计划要求**全仓所有 workflow claim**全部释放后才允许恢复。仓库内 M01、M19、M20 等无关模块仍有活动 claim；当前维护人无权释放它们，这使一个 M11 的过期 claim 问题被迫升级为全仓停机。

## 期望新增能力

建议新增精确、模块级的过期 claim 恢复入口，例如：

```bash
loeyae-aidlc module recover-claim \
  --stage-instance application-design@module:m11-recommend \
  --owner <new-owner> \
  --session-id <current-session> \
  --expect <inspect-token> \
  --human-instruction-ref <user-instruction-ref>
```

或：

```bash
loeyae-aidlc orchestrate state recover-claims \
  --module m11-recommend \
  --maintenance <module-maintenance-token> \
  --user-input Approve \
  --reason "expired claim renewal deadlock"
```

## 安全约束

- 仅作用于精确 stage instance 或目标 module；不得修改其他模块 state、claim 或 registry 条目。
- 必须要求当前 `inspect.expected`，防止覆盖并发 claim。
- 仅允许过期 claim 使用该入口。
- 必须要求人类明确批准或可审计的 `human-instruction-ref`。
- 在 audit 中记录旧 owner/session/generation、新 generation、恢复理由与授权来源。
- 恢复后生成新的 session binding；仍须执行正常 evidence、gate 和 approval，不得绕过质量门禁。
- 支持同 owner 的新 session 恢复，不依赖已失效 binding。

## 验收标准

1. M11 的过期 `application-design` claim 可在其他模块仍活动时恢复。
2. 不影响其他模块 active claims 和共享 registry 的并发一致性。
3. 恢复后可正常执行 `orchestrate report --result approved --user-input Approve`。
4. 无法在缺少 expected token、授权来源或非过期 claim 条件下执行恢复。
