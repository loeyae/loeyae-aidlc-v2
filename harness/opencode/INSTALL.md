# 安装 Loeyae AI-DLC v2 for OpenCode

在 `opencode.json` 的 `plugin` 数组中添加：

```json
{
  "plugin": ["loeyae-aidlc@git+https://github.com/loeyae/loeyae-aidlc-v2.git"]
}
```

重启 OpenCode 后输入 `使用 AI-DLC`。插件只负责注入 v2 引擎入口；阶段顺序、产物和门禁由 `tools/aidlc-orchestrate.ts`、`stages/` 和编译后的 `tools/data/stage-graph.json` 决定。

业务项目中的状态文件为 `docs/aidlc/aidlc-state.json`。通过以下命令驱动流程：

```bash
loeyae-aidlc orchestrate next --scope feature
loeyae-aidlc orchestrate report --stage <slug> --result completed
loeyae-aidlc orchestrate park
```

当 directive 的 `gate` 为 `true` 时，用户确认后使用 `--result approved`；不得用 `completed` 绕过阻断审批。
