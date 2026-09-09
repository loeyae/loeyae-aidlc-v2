# 安装 Loeyae AI-DLC v2 for OpenCode

全局安装：

```bash
loeyae-aidlc install --harness opencode
```

全局安装会将入口放入 `~/.config/opencode/plugins/loeyae-aidlc.js`，并将引擎资源放入 `~/.config/opencode/loeyae-aidlc/`；OpenCode 启动时会自动加载该直接插件文件。

项目级或手动安装也可以在 `opencode.json` 的 `plugin` 数组中添加：

```json
{
  "plugin": ["loeyae-aidlc@git+https://github.com/loeyae/loeyae-aidlc-v2.git"]
}
```

重启 OpenCode 后输入 `使用 AI-DLC`。插件只负责注入 v2 引擎入口；阶段顺序、产物和门禁由 `tools/aidlc-orchestrate.ts`、`stages/` 和编译后的 `tools/data/stage-graph.json` 决定。

在业务项目目录通过以下命令驱动流程：

```bash
loeyae-aidlc orchestrate next --scope feature
loeyae-aidlc orchestrate report --stage <slug> --result completed
loeyae-aidlc orchestrate park
```

`gate: true` 时，加载 `aidlc-approval`，读取并展示 request 的随机 `confirmation_phrase` 后结束回合；只有用户下一条真实消息完整匹配，才能通过 `--approval-confirmation-stdin` 定向报告。普通“同意”、预填按钮、Agent 代填、旧消息或同一回合自动提交无效。Provider 是可选增强，真人 TTY 是备用路径。`instruction_only` stage 执行正文后必须显式 `--instruction-ack <slug>`，idle gate 不会自动推进。公开 report 不支持手动 skip，仅 condition=false 可产生内部 `condition_skipped`。

`docs/aidlc/aidlc-state.json` 是 schema v3 设备签名 append-only event、workflow ID、revision/CAS 保护的唯一机器状态；`docs/aidlc/handoff.md` 仅为派生人类视图。每台设备自动生成独立 Ed25519 credential，v3 不配置、传递或共享 `AIDLC_TRUST_SECRET`。若 `next` 返回 `team-enrollment-confirmation` ask，Agent 展示完整 `JOIN ...` 短语后必须结束回合；仅用户下一条真实消息精确匹配后通过 strict `--team-enrollment-confirmation-stdin` 完成本机 enrollment。不得代填、同回合提交或复制 private key。enrollment 绑定已接受 event head，rollback/fork fail-closed；Provider/SCM 权限仍决定共享流写入资格。

Evidence 只接受受控 Producer 的精确 provenance、当前 `commit + dirty + worktree_digest` 和 schema 对应完整性（v3 自动设备 Ed25519；v2 legacy HMAC）；命令只记录 `argv_digest`，semantic 固定执行发行包内置 checker。同 stage 多个活动实例时必须传 `--instance`。`AIDLC_TRUST_SECRET` 仅用于 schema v2/HMAC/recovery legacy。
