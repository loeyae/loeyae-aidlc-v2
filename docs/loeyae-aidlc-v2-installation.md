# Loeyae AI-DLC 安装

安装包分发 AWS-style 轻量 AI-DLC workflow 到支持的 harness。

```bash
npm install -g https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
loeyae-aidlc install
```

可指定 harness（`loeyae-aidlc install --list` 列出全部可用 harness 及安装位置）：

```bash
loeyae-aidlc install --harness kiro-crew
loeyae-aidlc install --harness kiro-ide
loeyae-aidlc install --harness claude
loeyae-aidlc install --all
```

| harness | 目标工具 |
| --- | --- |
| `kiro-crew` | Kiro Crew Dashboard（全局 skill） |
| `kiro-ide` / `kiro-cli` | Kiro IDE / Kiro CLI（共享同一个全局 Agent Skill） |
| `claude` | Claude Code（官方 user/project plugin） |
| `opencode` | OpenCode（全局 plugin） |
| `codex` | Codex（全局 skill） |
| `codebuddy` | WorkBuddy Enterprise / CodeBuddy（官方 plugin） |
| `qoder` | Qoder CN IDE / Desktop / CLI |
| `zcode` | ZCode |

### Kiro 项目级 Stop Hook

全局安装 `kiro-ide` / `kiro-cli` 只部署共享 Skill 并注册 MCP，不会安装 Stop Hook。需要 Hook 时对每个业务项目执行：

```bash
loeyae-aidlc install --harness kiro-ide --project /absolute/path/to/project
```

Hook 写入 `<项目>/.kiro/hooks/loeyae-aidlc.json`。`--project` 只支持 `kiro-ide`、`kiro-cli`、`codebuddy`、`qoder`，不能与 `--all` 同时使用。

> 注意：`--project` 路径不存在（或是符号链接、不是目录）时，CLI 会**先完成全局 Skill 安装和 MCP 注册**，随后才报错 `--project must be an existing, non-symlink directory` 并以非 0 退出。此时全局 Skill 已安装，只有项目 Hook 未写入；修正路径后重新执行同一条命令即可，无需先卸载。

安装自检使用 `loeyae-aidlc install --list` 与 `loeyae-aidlc version`；`loeyae-aidlc runtime doctor` 需要项目中已有活动 workflow。

## 更新（升级到新版本）

升级到新版本时，按以下四步顺序执行（先清理旧安装，再装新版）：

```bash
# 1. 卸载已部署到各 harness 的资产
loeyae-aidlc uninstall --all

# 2. 从 npm 全局卸载旧的 CLI 包
npm uninstall -g loeyae-aidlc

# 3. 从 npm 全局安装新版本 CLI 包
npm install -g https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz

# 4. 重新部署到所有检测到的 harness
loeyae-aidlc install --all
```

> 说明：`loeyae-aidlc uninstall --all` / `install --all` 的 `--all` 是 CLI 选项（对所有 harness 生效）；`npm uninstall -g` / `npm install -g` 的 `-g` 是 npm 的全局选项。两者不要混用。
>
> 完成后需重启受影响的 harness（如 Kiro Crew / Kiro IDE）以加载新版本。

安装后从明确工作描述开始：

```bash
loeyae-aidlc orchestrate next --scope feature --work "修复订单导出超时"
```

workflow state 和 audit 写入目标项目的 `aidlc/active/`。团队成员使用 unit selection、Git 分支、review、构建、测试和 merge plan 协作交付。