# Loeyae AI-DLC 安装

安装包向十个宿主分发同一套目标导向的当前执行规则与按需方法。5.x 已移除旧阶段调度器；升级边界见 [README](../README.md)。

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
| `deepseek` | DeepSeek Harness / dsh（原生用户级或项目级 Skill） |

### DeepSeek Harness

```bash
loeyae-aidlc install --harness deepseek
loeyae-aidlc install --harness deepseek --project /absolute/path/to/project
```

用户级目标为 `~/.dsh/skills/loeyae-aidlc/`，遵循 `DSH_HOME`；项目级目标为 `<项目>/.dsh/skills/loeyae-aidlc/`。两种范围独立，升级或卸载使用相同参数。`--all` 通过 PATH 中的 `dsh` 探测宿主；通过 npx 或源码启动时可显式安装。

在 dsh 会话中加载 `loeyae-aidlc` Skill 后描述工作目标。适配使用原生 Skill，由宿主执行与续作，不要求会话绑定，不注册自动 Stop Hook。自定义插件组合、扫描路径及使用细节见 [DeepSeek Harness 说明](../harness/deepseek/README.md)。

### 宿主生命周期与旧钩子清理

默认分发不注册 Stop Hook，OpenCode 也不派发 idle 自动工作。Codex、ZCode 升级时仅移除精确识别的旧 AI-DLC 命令，保留同组用户命令、其他事件、MCP 与设置。Kiro 可通过 `install --harness kiro-ide --project <existing-directory>` 清理安装器拥有的旧项目钩子；用户文件保持不变，不创建新钩子。

`--project` 支持 Kiro、CodeBuddy、Qoder、DeepSeek 对应安装范围；不能与 `--all` 同时使用，路径须为已存在的普通目录。

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
loeyae-aidlc work --work "修复订单导出超时"
```

该命令只读提供上下文，不创建状态、审计或执行许可。宿主按已确认目标与权限连续实施和验证；跨会话需要记录时更新一份现有任务说明。安装不修改项目 Git 合并策略，业务资料及真实批准继续保留。
