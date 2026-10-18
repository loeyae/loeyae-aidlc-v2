# Loeyae AI-DLC 安装

安装包分发 AWS-style 轻量 AI-DLC workflow 到支持的 harness。

```bash
npm install -g --ignore-scripts https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
loeyae-aidlc install
```

### 为什么必须加 `--ignore-scripts`

本包的依赖树不需要任何安装期生命周期脚本即可运行，但在 macOS 上不带该参数安装会失败：

- `tsx` 的可选依赖 `fsevents@2.3.3` 官方元数据错误声明了 `gypfile: true` 和 `install: node-gyp rebuild`，而其 tarball 实际自带预编译的 `fsevents.node`、不含 `binding.gyp`。npm 据错误元数据启动本地编译后报 `gyp: binding.gyp not found`，安装失败（Windows/Linux 平台不匹配、不安装 `fsevents`，因此不受影响）。
- 本包自身没有必需的 install/postinstall 钩子；`tsx` 的 TS 转换由 `esbuild` 完成，`esbuild` 的平台二进制由 `@esbuild/<platform>` optionalDependencies 直接提供。禁用生命周期脚本后，全部平台可选依赖（包括 darwin 上的 `fsevents` 预编译二进制）仍会正常安装且真实可用。

因此 `--ignore-scripts` 是受支持安装命令的固定组成部分，不是可选的故障规避：

- 它是传给 `npm install` 的命令行参数，只作用于这一次安装，不修改（也不建议修改）全局 npm 的 `ignore-scripts` 配置，不需要在项目或用户目录放置 `.npmrc`。
- 它只影响 npm 安装阶段。`loeyae-aidlc install` / `uninstall` 等 CLI 命令与 npm 生命周期脚本无关，不接收该参数。
- 与 `--omit=optional` 不同：`--ignore-scripts` 保留全部平台 optionalDependencies，不能用删除可选依赖的方式绕过（那会破坏 esbuild 平台二进制的分发）。

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

# 3. 从 npm 全局安装新版本 CLI 包（--ignore-scripts 是固定参数，原因见上文）
npm install -g --ignore-scripts https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz

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