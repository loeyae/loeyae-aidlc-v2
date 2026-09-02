# Loeyae AI-DLC v2 安装与 Kiro IDE 使用指南

本文面向 macOS 和 Windows 用户，说明如何从安装 Node.js 开始安装 Loeyae AI-DLC v2，并在 Kiro IDE 中启动和推进 AI-DLC 工作流。

## 1. 安装前提

| 项目 | 要求 |
|---|---|
| Node.js | `>=20.0.0`，建议使用 Node.js LTS |
| npm | 随 Node.js 安装，能够执行 `npm` |
| Kiro IDE | 已安装并可以打开业务项目 |
| 网络 | 能访问 GitHub archive 下载地址 |

Loeyae AI-DLC v2 的 `package.json` 声明了 Node.js `>=20.0.0`。安装包通过 GitHub archive 获取，不需要先配置 npm registry。

## 2. 安装 Node.js

### 2.1 macOS

1. 打开 [Node.js 官方下载页面](https://nodejs.org/en/download/)。
2. 下载满足 `>=20.0.0` 的 LTS 安装包。
3. 按安装器提示完成安装。
4. 关闭并重新打开 Terminal，然后验证：

```bash
node --version
npm --version
```

也可以使用已安装的 Homebrew：

```bash
brew install node
node --version
npm --version
```

### 2.2 Windows

1. 打开 [Node.js 官方下载页面](https://nodejs.org/en/download/)。
2. 下载满足 `>=20.0.0` 的 LTS Windows Installer（`.msi`）。
3. 安装时保留将 Node.js 加入 PATH 的默认选项。
4. 关闭并重新打开 PowerShell，然后验证：

```powershell
node --version
npm --version
```

如果刚安装后命令仍不可用，先关闭当前 PowerShell 窗口，再打开新的 PowerShell 窗口。

## 3. 安装 Loeyae AI-DLC v2

### 3.1 推荐安装方式：GitHub archive

macOS Terminal 和 Windows PowerShell 使用相同的 npm 命令：

```bash
npm install --global https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
```

安装后验证：

```bash
loeyae-aidlc version
loeyae-aidlc help
```

如果要固定到某个已审查的提交，将 `<commit-sha>` 替换为完整或短提交 SHA：

```bash
npm install --global https://github.com/loeyae/loeyae-aidlc-v2/archive/<commit-sha>.tar.gz
```

### 3.2 为什么不优先使用 `git+https`

在 macOS 的 npm 11.16.0 环境中，使用 `git+https` 全局安装时，npm 处理 `fsevents` 后可能清理 Git 临时目录，进而使 `esbuild` 报：

```text
spawn /bin/sh ENOENT
```

这通常不是 macOS 缺少 `/bin/sh`，而是 npm Git 临时工作树清理造成的安装问题。因此优先使用上面的 GitHub archive URL。该方式仍然直接从 GitHub 获取代码，但不经过 npm 的 Git 临时工作树路径。

### 3.3 Windows 仍然指向旧安装路径时

如果 Windows 上的 `loeyae-aidlc` 仍指向旧的本地路径，例如 `E:\Work\repo\node\...`，先卸载旧全局安装，再重新安装：

```powershell
npm uninstall --global loeyae-aidlc
npm install --global https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
loeyae-aidlc version
```

### 3.4 全局命令找不到

如果 npm 安装成功，但执行 `loeyae-aidlc` 时提示命令不存在，先查询 npm 全局目录：

macOS：

```bash
npm prefix --global
export PATH="$(npm prefix --global)/bin:$PATH"
loeyae-aidlc version
```

如果该方式解决了问题，应将 `$(npm prefix --global)/bin` 加入 shell 的 PATH 配置，并重新打开 Terminal。

Windows PowerShell：

```powershell
$npmPrefix = npm prefix --global
$env:Path = "$npmPrefix;$env:Path"
loeyae-aidlc version
```

如果要永久修复 Windows PATH，请在“系统设置 → 系统 → 系统信息 → 高级系统设置 → 环境变量”中，将 `npm prefix --global` 输出的目录加入用户 PATH，然后重新打开 Kiro IDE 和 PowerShell。不要把旧项目源码目录加入 PATH。

## 4. 安装 Kiro IDE 集成

Kiro IDE 集成由两部分组成：

1. **全局 Agent Skill**：安装到 Kiro 官方全局发现目录，使 Kiro IDE 加载 `SKILL.md`、阶段规则、知识规则和工具。Kiro IDE 与 Kiro CLI 共用这一份 Skill。
2. **项目级 Stop Hook**：安装到当前业务项目，使 Kiro IDE 在停止边界触发 AI-DLC 准出检查。

两部分都建议安装。只安装全局 Agent Skill 不会自动为每个业务项目创建 Hook。

### 4.1 安装全局 Agent Skill

在 macOS Terminal 或 Windows PowerShell 执行：

```bash
loeyae-aidlc install --harness kiro-ide
```

默认安装位置：

- macOS：`/Users/<用户名>/.kiro/skills/loeyae-aidlc/`
- Windows：`C:\Users\<用户名>\.kiro\skills\loeyae-aidlc\`

入口文件是 `SKILL.md`，其 frontmatter `name` 为 `loeyae-aidlc`，与目录名一致；`description` 包含 `AI-DLC`、`使用 AI-DLC`、`继续上次的工作`、`功能设计`、`用户故事`、`代码审查` 和 `部署准备` 等激活语义。安装器还会把共享 Kiro MCP 默认项合并到用户级配置；其中 `chrome-devtools` Provider 仅用于图表浏览器验收，不生成 SVG、`.diagram.json` 或 PNG/PDF。

### 4.2 为业务项目安装项目级 Stop Hook

`--project` 接收业务项目根目录，可以是已有的非空目录。它只创建或更新该项目下的 `.kiro/hooks/loeyae-aidlc.json`，不会删除业务源码。

#### macOS

```bash
cd /Users/<用户名>/work/my-project
loeyae-aidlc install --harness kiro-ide --project "$(pwd)"
test -f .kiro/hooks/loeyae-aidlc.json && echo "Kiro IDE Hook installed"
```

Hook 位置：

```text
/Users/<用户名>/work/my-project/.kiro/hooks/loeyae-aidlc.json
```

#### Windows PowerShell

```powershell
Set-Location 'C:\Users\<用户名>\work\my-project'
$project = (Get-Location).Path
loeyae-aidlc install --harness kiro-ide --project $project
Test-Path (Join-Path $project '.kiro/hooks/loeyae-aidlc.json')
```

Hook 位置：

```text
C:\Users\<用户名>\work\my-project\.kiro\hooks\loeyae-aidlc.json
```

### 4.3 重启 Kiro IDE

安装或升级后：

1. 关闭当前 Kiro IDE 项目窗口。
2. 重新打开业务项目。
3. 在 Kiro IDE Chat 中重新开始或继续 AI-DLC 会话。

如果只更新了项目 Hook，也建议重新打开项目，使 Kiro IDE 重新加载 Hook 配置。

### 4.4 `--project` 与 `--target` 的区别

不要将业务项目根目录传给 `--target`：

- `--project <项目根目录>`：用于 Kiro IDE/CLI 项目级 Hook，允许已有非空项目目录。
- `--target <目录>`：只用于专用安装目录，普通 harness 会拒绝写入非空目录。
- Kiro IDE 的正确组合是：先执行全局 `install --harness kiro-ide`，再执行 `install --harness kiro-ide --project <项目根目录>`。

## 5. 在 Kiro IDE 中使用示例

以下示例假设业务项目已经位于：

- macOS：`/Users/<用户名>/work/my-project`
- Windows：`C:\Users\<用户名>\work\my-project`

### 5.1 启动一个完整功能流程

1. 在 Kiro IDE 中打开业务项目根目录。
2. 打开 Kiro IDE Chat。
3. 输入类似下面的请求：

```text
使用 AI-DLC 开发用户认证模块，按 feature scope 执行。
请先读取当前项目结构和已有认证相关代码，再按引擎返回的阶段顺序推进。
目标包括：账号注册、登录、登出、密码重置和会话失效处理。
每个阶段完成后生成要求的产物和证据，不要跳过 ALWAYS 阶段；需要人工确认时先停下来说明决策内容。
```

4. Kiro IDE 中的 AI-DLC Skill 会在业务项目根目录调用确定性引擎，典型入口为：

```bash
loeyae-aidlc orchestrate next --scope feature
```

5. Agent 按引擎返回的 `run-stage` directive 执行当前阶段，读取对应的 `stages/` 和 `knowledge/` 规则，生成阶段要求的业务产物。
6. 阶段完成后，Agent 使用类似命令报告：

```bash
loeyae-aidlc orchestrate report --stage <当前阶段 slug> --result completed
```

7. 引擎验证 `requires`、`condition`、`produces`、`sensors` 和 `current_stage` 门禁后，自动返回下一阶段。

### 5.2 人工确认阶段

只有架构决策和部署决策保留人工确认，通常对应：

- `application-design`
- `operations`

当 directive 中 `gate` 为 `true` 时，Agent 必须先向用户展示决策内容。用户确认后，才使用：

```bash
loeyae-aidlc orchestrate report --stage <当前阶段 slug> --result approved
```

不能用 `--result completed` 绕过人工确认。普通阶段使用 `completed`，审批阶段使用 `approved`。

### 5.3 查看状态、暂停和恢复

在业务项目根目录执行：

```bash
# 查看当前工作流状态
loeyae-aidlc orchestrate next --status

# 暂停当前工作流
loeyae-aidlc orchestrate park

# 下次继续时恢复工作流
loeyae-aidlc orchestrate next --resume
```

状态文件位于业务项目的：

```text
docs/aidlc/aidlc-state.json
```

语义证据位于业务项目的：

```text
.aidlc/evidence/<stage-slug>/
```

不要手工修改状态文件或伪造 evidence。若门禁失败，应根据引擎返回的错误修复产物，再重新执行报告。

## 6. Kiro IDE 中的图表验收示例

如果当前阶段要求设计或验证 SVG 图表，可以在 Kiro IDE Chat 中提出：

```text
请按当前项目来源文档和图表设计规范完成订单流程图设计。
先从 SVG 所属文档上下文提取节点、边和业务语义，再生成独立 expected route contract。
完成后同步 SVG、sidecar 和 evidence，并执行 source checker 以及 Chrome normal、fit、zoom 三视图验收。
如果 Chrome Provider 不可用，请明确记录 NEEDS_CAPABILITY，不要伪造视觉 PASS。
```

图表验收不只检查 SVG 和 sidecar 是否互相一致，还应分别报告：

- `STRUCTURE_PASS`
- `ROUTE_CONTRACT_PASS`
- `GEOMETRY_PASS`
- `VISUAL_PASS`
- `OVERALL_PASS`

Chrome Provider 不负责重新布局。它只加载 SVG 或目标预览 URL，采集 DOM、端口、箭头目标、真实标签 bbox、碰撞、viewport 和三视图证据。

## 7. 升级 Loeyae AI-DLC v2

升级全局 CLI 后，需要重新部署 Kiro 全局 Agent Skill，并为需要的业务项目重新写入项目 Hook：

```bash
npm install --global https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
loeyae-aidlc version
loeyae-aidlc install --harness kiro-ide
```

macOS：

```bash
cd /Users/<用户名>/work/my-project
loeyae-aidlc install --harness kiro-ide --project "$(pwd)"
```

Windows PowerShell：

```powershell
Set-Location 'C:\Users\<用户名>\work\my-project'
loeyae-aidlc install --harness kiro-ide --project (Get-Location).Path
```

完成后重新打开 Kiro IDE 项目。

## 8. 常见问题

### `loeyae-aidlc` 找不到

确认 `node --version` 和 `npm --version` 可用，然后执行 `npm prefix --global`，将对应的 npm 全局可执行目录加入 PATH，并重新打开终端和 Kiro IDE。

### Kiro IDE 没有发现或激活 Skill

先确认标准全局入口存在：

- macOS：`/Users/<用户名>/.kiro/skills/loeyae-aidlc/SKILL.md`
- Windows：`C:\Users\<用户名>\.kiro\skills\loeyae-aidlc\SKILL.md`

然后关闭并重新打开 Kiro IDE 项目，在 **Agent Steering & Skills** 中确认 `loeyae-aidlc` 可见，并在 Chat 中输入 `/loeyae-aidlc` 验证显式激活。自动激活可使用 `使用 AI-DLC`、`功能设计`、`用户故事` 或 `代码审查` 等描述中的关键词。

如果当前使用的是 custom agent，它默认不会加载全局 Skill；需要在该 agent 的 `resources` 中加入：

```json
{
  "resources": [
    "skill://~/.kiro/skills/*/SKILL.md"
  ]
}
```

目录存在或安装命令成功本身不等于宿主已发现并激活 Skill；最终应以 UI 可见、`/loeyae-aidlc` 可选和关键词实际触发为准。

### Stop Hook 没有触发

确认项目级命令使用的是 `--project`，并检查以下文件是否存在：

- macOS：`/Users/<用户名>/work/my-project/.kiro/hooks/loeyae-aidlc.json`
- Windows：`C:\Users\<用户名>\work\my-project\.kiro\hooks\loeyae-aidlc.json`

全局 Skill 中随附的 Hook 源文件不会自动成为每个业务项目的项目 Hook。具体 Kiro IDE 版本对 Stop Hook 的阻断能力可能不同，但这不能降低引擎的 `report` 门禁要求。

### macOS 安装时报 `spawn /bin/sh ENOENT`

卸载可能残留的全局安装后，改用 GitHub archive URL 重新安装，不要优先使用 `git+https`：

```bash
npm uninstall --global loeyae-aidlc
npm install --global https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
```

### 引擎报告被拒绝

不要直接修改状态或 evidence。检查当前阶段是否正确、产物是否存在且非空、sensor evidence 是否由受控 checker 生成；根据错误修复后重新执行 `orchestrate report`。

## 9. 最小安装验收清单

- [ ] `node --version` 满足 `>=20.0.0`。
- [ ] `npm --version` 可以执行。
- [ ] `loeyae-aidlc version` 可以执行。
- [ ] 全局 Agent Skill 已安装到用户的 Kiro Skills 目录，入口为 `SKILL.md`。
- [ ] Kiro IDE 的 **Agent Steering & Skills** 中可见 `loeyae-aidlc`。
- [ ] `/loeyae-aidlc` 可显式激活，且至少一个描述关键词可自动触发。
- [ ] 业务项目存在 `.kiro/hooks/loeyae-aidlc.json`。
- [ ] Kiro IDE 已重新打开业务项目。
- [ ] Chat 请求能够触发 AI-DLC 阶段流程。
- [ ] 工作流状态保存在 `docs/aidlc/aidlc-state.json`。
- [ ] 阶段完成通过引擎 `report`，没有手工伪造状态或证据。
