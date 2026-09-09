# Loeyae AI-DLC v2

基于引擎驱动的 AI-DLC 方法论实现。确定性 TypeScript 工具链 + 多 harness 分发架构。

## 安装

### 全局安装（从 GitHub，不需要 npm registry）

npm 11.16.0 在 macOS 上通过 `git+https` 全局安装时，可能在处理 `fsevents` 后清理 Git 临时目录，导致 `esbuild` 报 `spawn /bin/sh ENOENT`。推荐使用 GitHub archive URL，它仍然直接从 GitHub 获取代码，但不经过该 Git 临时工作树路径：

```bash
npm install -g https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
```

固定到指定提交：

```bash
npm install -g https://github.com/loeyae/loeyae-aidlc-v2/archive/89cc38e.tar.gz
```

如果 Windows 的 `loeyae-aidlc` 仍指向旧的本地路径（例如 `E:\Work\repo\node\...`），先清理旧的全局安装和命令 shim，再重新安装：

```powershell
npm uninstall -g loeyae-aidlc
npm install -g https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
```

### 部署到各平台

#### 路径参数安全规则（重要）

`--project` 和 `--target` 不是同一个参数：

- `--project <项目根目录>`：Kiro IDE/CLI 用它安装项目 Stop Hook；CodeBuddy/Qoder 用它调用宿主官方 CLI 的 project scope。它不会把整个 harness 覆盖到业务项目根目录。ZCode 当前不接受 `--project`，因为其项目级 Hook 不执行。
- `--target <安装目录>`：用于把 harness 或插件 bundle 复制到专用安装目录，不执行 CodeBuddy/Qoder/ZCode 的宿主注册。不要把业务项目根目录、源码目录或已有工程目录传给它。安装器只会升级带外部所有权清单且内容未被修改的目标；空目录可以首次安装，非空且未受管目标会 fail-closed，绝不会递归清空。
- Claude Code 的 `--target` 是特殊用法：它表示项目根目录，安装器只操作该目录下的 `.claude/loeyae-aidlc-marketplace/`，不应将其用于其他 harness。

如果误用旧版本的 `--target` 删除了目录，应立即停止再次安装或写入该目录，优先从 Git、IDE Local History、Time Machine 或备份恢复；安装器无法恢复已删除源码。

#### 全局安装

```bash
# Kiro Crew Dashboard（全局 skill）
loeyae-aidlc install

# Kiro IDE（共享全局 Agent Skill；不会安装项目级 Hook）
loeyae-aidlc install --harness kiro-ide

# Kiro CLI（全局 agent skill；不会安装项目级 Hook）
loeyae-aidlc install --harness kiro-cli

# Claude Code（全局 user-scope plugin）
loeyae-aidlc install --harness claude

# OpenCode（全局 plugin）
loeyae-aidlc install --harness opencode

# Codex（全局 agent）
loeyae-aidlc install --harness codex

# WorkBuddy Enterprise / CodeBuddy（官方 user-scope plugin）
loeyae-aidlc install --harness codebuddy

# Qoder CN IDE / Desktop / CLI（user-scope 本地插件 + 宿主 MCP 配置）
loeyae-aidlc install --harness qoder

# ZCode（用户 Skill + 用户 Hook/MCP；同时构建可 UI 导入的 marketplace）
loeyae-aidlc install --harness zcode

# 自动检测当前环境中的宿主并只安装对应平台
loeyae-aidlc install --all
```

#### Kiro IDE 项目级安装

Kiro IDE 与 Kiro CLI 共用用户级 Agent Skill，但生命周期 Stop Hook 必须安装到每个业务项目中：

```bash
loeyae-aidlc install \
  --harness kiro-ide \
  --project /absolute/path/to/your-project
```

该命令的效果：

- Agent Skill：`~/.kiro/skills/loeyae-aidlc/SKILL.md`（与 Kiro CLI 共用）
- 项目 Hook：`/absolute/path/to/your-project/.kiro/hooks/loeyae-aidlc.json`
- 不删除、不覆盖业务项目中的源码文件

#### Kiro CLI 项目级安装

Kiro CLI 使用与 Kiro IDE 相同的用户级 Agent Skill；项目级 Hook 同样必须显式安装：

```bash
loeyae-aidlc install \
  --harness kiro-cli \
  --project /absolute/path/to/your-project
```

该命令的效果：

- Skill：`~/.kiro/skills/loeyae-aidlc/SKILL.md`（与 Kiro IDE 共用）
- 项目 Hook：`/absolute/path/to/your-project/.kiro/hooks/loeyae-aidlc.json`
- 不要使用 `--target /absolute/path/to/your-project`

`--project` 可以重复执行，用于更新 Hook；它不会清空项目目录。安装前建议使用绝对路径并确认目标：

```bash
cd /absolute/path/to/your-project
pwd
```

#### CodeBuddy 与 Qoder 项目级安装

CodeBuddy 和 Qoder 通过各自官方 CLI 写入 project scope；Loeyae 只管理项目外的插件源副本和 ownership manifest，不直接编辑宿主 registry/cache：

```bash
loeyae-aidlc install --harness codebuddy --project /absolute/path/to/your-project
loeyae-aidlc install --harness qoder --project /absolute/path/to/your-project
```

项目级安装使用项目哈希隔离宿主源目录和 CodeBuddy marketplace 名称，卸载一个项目不会移除其他项目或 user scope 的安装。CodeBuddy 的完整扩展契约来自 WorkBuddy Enterprise 中的 CodeBuddy Agent/CLI；这里不宣称覆盖 WorkBuddy 的其他模块。

#### ZCode 安装边界

ZCode 当前没有公开的非交互插件注册命令，并且项目配置中的 Hook 不执行。因此默认命令会：

- 安装用户 Skill 到 `~/.zcode/skills/loeyae-aidlc/`；
- 精确合并用户 Stop Hook 到 `~/.zcode/cli/config.json`；
- 只补缺失的用户 MCP 服务，保留已有同名服务；卸载时保留这些共享 MCP 项。

`dist/zcode/` 同时是原生 ZCode marketplace。如需完整插件形态，在 **Settings → Plugins → Create → Add marketplace** 中选择该目录，再安装并启用插件。插件注册和卸载需在 ZCode UI 完成。

Kiro Crew 的默认安装会将 V1 的 `loeyae-skills`、`awesome-design`、`figma`、`ssot` 和 `chrome-devtools` MCP 服务合并到 `~/.kiro/settings/mcp.json`，通过跨进程锁与原子替换避免并发丢更新。默认只补缺失；仅无自定义字段的已知旧默认 `chrome-devtools-mcp@1.6.0` 会收敛为不指定版本的 `chrome-devtools-mcp`。用户主动设置的其他版本/tag pin、额外字段、环境变量、非默认参数或禁用状态均完整保留。`ssot` 使用环境变量 `SSOT_API_KEY`，不把密钥写入安装包或项目文件。

Claude Code 的安装器会额外生成本地 marketplace，并调用官方 `claude plugin marketplace add`、`claude plugin install` 注册 user-scope 插件；不会直接编辑 `installed_plugins.json`。staging 文件位于 `~/.claude/plugins/loeyae-aidlc-marketplace/`，实际运行缓存和注册表由 Claude Code 管理。当前已打开的 Claude 会话需执行 `/reload-plugins`（如提示缓存变更则按提示使用 `--force`）或重新开会话；新会话会自动加载。

CodeBuddy 安装器同样只调用官方 `codebuddy plugin` 命令。优先使用 PATH 中的 `codebuddy`；macOS 能发现 WorkBuddy/CodeBuddy App 内嵌 CLI。Windows 优先从 `App Paths` 和卸载注册表动态读取 WorkBuddy/CodeBuddy 的真实安装根目录，因此支持用户自定义安装位置；per-user 的 `%LOCALAPPDATA%\Programs`、`%LOCALAPPDATA%` 和 machine-wide 的 `%ProgramW6432%`、`%ProgramFiles%`、`%ProgramFiles(x86)%` 仅作为兼容回退。检测到 WorkBuddy 内嵌 CLI 时，安装器会通过 `CODEBUDDY_CONFIG_DIR` 指向 WorkBuddy 自己的 `~/.workbuddy` app home，避免把插件误注册到独立 CodeBuddy 默认使用的 `~/.codebuddy`。其他位置可通过 `CODEBUDDY_CLI` 指定；显式设置的 `CODEBUDDY_CONFIG_DIR` 会被保留。

Qoder CN IDE、Qoder Desktop 和 Qoder CLI 共用发行资产，但自动集成分为两种模式。user scope 下，两种模式都会把经 Windows 真实宿主验证的原生 Skill 受管安装到 `~/.qoder-cn/skills/loeyae-aidlc/`，并写入宿主 MCP 配置。检测到 PATH 中的 `qoder`（或 `QODER_CLI`）时，安装器还会调用官方 `qoder plugins` 注册并启用 `loeyae-aidlc@local`；仅检测到 Qoder CN Desktop 时，则跳过插件/Stop Hook 注册，只安装原生 Skill 并合并 MCP。Desktop/CLI 的 `~/.qoder/settings.json` 使用原生 Streamable HTTP；Qoder CN IDE 在 Windows 实际读取 `%USERPROFILE%\.qoder-cn\mcp.json`，该文件使用固定的 `mcp-remote@0.8.3` STDIO bridge，因为 CN IDE 官方只声明支持 STDIO/SSE。所有合并都只补缺失并保留同名用户配置；macOS/Linux 继续使用对应 Application Support/XDG 默认路径，非标准路径可分别用 `QODER_CONFIG_DIR`、`QODER_CN_MCP_CONFIG` 覆盖。手工复制或旧版本留下的未受管原生 Skill 不会被静默覆盖；首次接管需使用 `--migrate-legacy`，原目录会保留为 `*.pre-managed-backup-*`。

Qoder CN IDE 要求 2.5.0 或更高版本；安装后必须完全退出并重启，确认 `loeyae-aidlc` Skill 已从 `%USERPROFILE%\.qoder-cn\skills\loeyae-aidlc\SKILL.md` 加载，并在头像菜单 **Your Settings → MCP tools** 中确认 `loeyae-skills`、`awesome-design`、`figma`、`ssot` 可见。MCP 仅在 Agent 模式配合 Qwen3 使用，最多同时连接 10 个服务。Figma 首次连接仍需 OAuth；SSOT 要求启动 Qoder CN IDE 前向宿主进程提供 `SSOT_API_KEY`。Desktop 应在 **Settings → Plugins → User → Custom** 和 **Settings → MCP**（新版为 **Extensions → Connectors**）核对；CLI 可依次执行 `/plugins reload`、`/mcp reload`，再用 `/plugins`、`/hooks`、`/mcp` 检查。卸载时受管原生 Skill 与 staging 会删除，共享 MCP 条目保留。

`install --all` 会独立探测 Qoder CN Desktop。Windows 优先读取 `App Paths` 与 HKCU/HKLM 卸载注册表，兼容 `%LOCALAPPDATA%`、`%ProgramFiles%` 等默认位置，并以已存在的 `%USERPROFILE%\.qoder-cn\mcp.json` 或 `.qoder-cn` 配置目录作为兼容证据；macOS 检查标准 App bundle。仅发现 Desktop 时执行 user-scope 原生 Skill + MCP 直接集成；项目 scope、官方插件和 Stop Hook 注册仍要求可调用的 `qoder` CLI。Qoder CN 能读取 `%USERPROFILE%\.agents\skills\loeyae-aidlc\SKILL.md` 只说明共享 Skill 可见，不代表 Qoder harness 已被 `install --all` 选中；Qoder 原生受管 Skill 路径是 `%USERPROFILE%\.qoder-cn\skills\loeyae-aidlc\SKILL.md`。CodeBuddy 仍只通过官方 CLI 管理宿主注册。

各平台的全局安装路径：

| 平台 | 安装路径 |
|------|---------|
| Kiro Crew | `~/.kiro/crew/skills/loeyae-aidlc/` |
| Kiro IDE | `~/.kiro/skills/loeyae-aidlc/`（与 Kiro CLI 共用） |
| Kiro CLI | `~/.kiro/skills/loeyae-aidlc/`（与 Kiro IDE 共用） |
| Claude Code | `~/.claude/plugins/loeyae-aidlc-marketplace/plugins/loeyae-aidlc/`（staging；运行时由 Claude Code 管理官方 cache 和注册表） |
| OpenCode | `~/.config/opencode/plugins/loeyae-aidlc.js`（入口；资源位于同级 `loeyae-aidlc/`） |
| Codex | `~/.agents/skills/loeyae-aidlc/` |
| WorkBuddy / CodeBuddy | `~/.config/loeyae-aidlc/host-assets/codebuddy/user/`（受管 marketplace source；运行时 cache 由 CodeBuddy 管理） |
| Qoder CN IDE / Desktop / CLI | 原生 Skill：`~/.qoder-cn/skills/loeyae-aidlc/`；插件 staging：`~/.config/loeyae-aidlc/host-assets/qoder/user/loeyae-aidlc/`；CN IDE MCP 在 Windows 位于 `%USERPROFILE%\.qoder-cn\mcp.json`，Desktop/CLI MCP 位于 `~/.qoder/settings.json` |
| ZCode | `~/.zcode/skills/loeyae-aidlc/`（默认直接用户集成） |

### 平台生命周期门禁

所有平台共用 `loeyae-aidlc orchestrate report` 作为唯一准出判定入口；平台 Hook 只负责在生命周期边界触发检查，不直接修改 `docs/aidlc/aidlc-state.json` 或 `.aidlc/evidence/`。schema v3 Hook 没有当前 client 的安全 identity/receipt 通道时会 fail-closed，并提示持有 lease 的 client 做定向 report，不会代替协作者完成实例。

| 平台 | 原生机制 | 安装/激活方式 | 失败时行为 |
|------|---------|---------------|------------|
| Kiro IDE | `.kiro/hooks/` 的 `Stop` Hook | `loeyae-aidlc install --harness kiro-ide --project <project>` | 由 Kiro Hook 触发引擎检查；具体 Kiro 版本的 Stop 阻断能力以运行时为准 |
| Kiro CLI | `.kiro/hooks/` 的 `Stop` Hook（支持该格式的版本） | `loeyae-aidlc install --harness kiro-cli --project <project>` | 由 Kiro Hook 触发引擎检查 |
| Claude Code | 插件 `hooks/hooks.json` 的 `Stop` Hook | 随官方插件安装自动注册 | `decision:block` 阻止回合结束 |
| OpenCode | 插件 `session.idle` 事件 | 全局插件安装自动加载 | 失败时通过插件继续提示 Agent 处理 |
| Codex | 全局 `~/.codex/hooks.json` 的 `Stop` Hook | `loeyae-aidlc install --harness codex`，然后 `/hooks` 审查并信任 | `decision:block` 触发继续执行 |
| WorkBuddy / CodeBuddy | 插件 `hooks/hooks.json` 的 `Stop` Hook | 官方 CodeBuddy CLI 自动注册 user/project scope | Claude-compatible `decision:block` 继续 Agent |
| Qoder CN IDE / Desktop / CLI | CLI 插件模式提供 `Stop` Hook；desktop-only 模式不注册 Hook | user scope 始终安装原生 Skill；有 `qoder` CLI 时再安装官方插件，仅 CN Desktop 时直接合并 MCP | 插件模式退出码 2 阻断；`stop_hook_active` 重入时不重复阻断；desktop-only 模式虽有 Skill，但无 Hook，不能宣称生命周期门禁已激活 |
| ZCode | 用户配置或插件 `Stop` Hook | 默认自动合并用户 Hook；完整插件需 UI 导入 | `decision:block`，宿主最多连续继续 3 次 |
| Kiro Crew | 当前无公开生命周期 Hook | Skill 强制调用引擎；不能伪造完成 | 引擎拒绝 `report`，Skill 必须继续修复 |

WorkBuddy/CodeBuddy 的 user-scope Stop Hook 会由宿主在每次会话停止时调用；Hook 被调用不表示当前任务主动使用了 AI-DLC。当前 `cwd` 没有 enrollment/state，或具有签名有效的 `done`/`parked` state 时，Hook 会以退出码 0 静默放行；同一项目仍有 `running` 工作流时，即使当前会话只处理 DOCX 等无关任务，也会继续执行门禁，以防通过新会话绕过未完成阶段。只有确实需要冻结所有协作者的整个 workflow 时才运行 `loeyae-aidlc orchestrate park`，之后用 `loeyae-aidlc orchestrate next --resume` 恢复。已 enrollment 但 state 缺失或签名无效仍按设计 fail-closed。

Hook 未安装或平台未触发时，不能降低引擎门禁要求；直接调用 schema v3 `orchestrate report` 仍会校验明确的 `--instance`、安全 stdin 中的 claim receipt、`requires`、`condition`、`produces`、`sensors` 和审批。

#### Claude Code 项目级部署

Claude Code 的 `--target` 是专用例外：它接收项目根目录，并只在该目录下写入 `.claude/loeyae-aidlc-marketplace/`，不用于 Kiro IDE/CLI：

```bash
loeyae-aidlc install \
  --harness claude \
  --target /absolute/path/to/your-project
```

### 升级

```bash
npm install -g https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
loeyae-aidlc install        # 重新部署（或 --all 全部）
```

`install --all` 检测到 Kiro IDE 与 Kiro CLI 时，会把两者视为同一个全局 Agent Skill，只生成一份 `~/.kiro/skills/loeyae-aidlc/` 资产和一个 canonical ownership manifest；两个宿主仍可分别安装各自项目的 Hook。宿主的公开 CLI 入口优先通过 PATH（CodeBuddy/Qoder 也支持 `CODEBUDDY_CLI`/`QODER_CLI`）发现；Qoder Desktop 的官方插件注册仍要求可调用的 `qoder` CLI，但 Qoder CN Desktop 本身可作为 user-scope 原生 Skill + MCP 直接集成证据。macOS GUI 宿主检查标准 `/Applications` 和用户 `~/Applications` App bundle。Windows 的 KiroCrew、Kiro IDE、OpenCode、Codex、Qoder CN 和 ZCode 桌面宿主优先通过 `App Paths` 与 HKCU/HKLM 卸载注册表读取真实安装根目录，因此支持自定义位置；KiroCrew 与 Qoder CN 另外保留 `%ProgramFiles%`、`%LOCALAPPDATA%\Programs` 等默认位置作为兼容回退，Qoder CN 也接受已存在的 `.qoder-cn` 配置目录。WorkBuddy/CodeBuddy 使用同类注册表发现后继续定位其内嵌 CodeBuddy CLI。未检测到的平台会明确列出并跳过；非标准安装位置或自动检测遗漏时，仍可使用 `--harness <name>` 显式安装。

检测完成后只检查选中平台的预构建产物；若任一选中产物缺失或过期，仍执行一次全平台构建以保持共享 graph 和 distribution parity 一致，不会因 graph 时间戳刷新而逐平台重复重建。

安装器先在目标同级目录 staging，校验后以 rename 交换；平台激活失败或测试 failpoint 触发时会恢复旧受管资产。每次安装在 `~/.config/loeyae-aidlc/installations/` 保存外部所有权清单，记录每个受管文件的 SHA-256。升级和卸载前都会复核清单：文件被用户修改、目标缺失、出现额外文件或目标没有所有权清单时均 fail-closed，不会覆盖或删除。

文件资产与 ownership manifest 受同一安装锁和回滚流程保护，但 Claude、CodeBuddy、Qoder 的官方插件注册表/cache，以及 Codex/ZCode 的共享配置等宿主外部副作用无法与本地 manifest 做跨进程原子提交。若宿主已接受 activate/deactivate，而随后 manifest 写入或宿主的后续子步骤失败，安装器会恢复受管文件，并对首次 CodeBuddy 注册执行尽力补偿，但仍可能需要按错误输出重新运行安装/卸载或使用宿主官方命令核对注册状态；不得将文件回滚等同于真实宿主注册表已回滚。

从没有 ownership manifest 的旧版 v2 安装升级时，使用显式迁移参数：

```bash
# 迁移全部全局平台
loeyae-aidlc install --all --migrate-legacy

# 或只迁移一个平台
loeyae-aidlc install --harness kiro-ide --migrate-legacy
```

迁移只接受能通过稳定 v2 标记识别的旧 Loeyae AI-DLC 目标；任意非空目录、未知文件和符号链接仍会 fail-closed。每个旧目标先以同目录原子 rename 保存为带时间戳的 `*.pre-managed-backup-*`，成功后保留备份并生成 ownership manifest；安装或激活失败时则自动把备份恢复到原路径。即使旧安装中的文件曾被修改，也不会丢失，修改内容会完整留在备份中。确认新版本正常后再自行处理备份，安装器不会自动删除这些 legacy 备份。项目 Hook 同样只有在显式使用 `--migrate-legacy` 且内容可识别时才会迁移。

升级时，安装器会先校验并接管旧 `loeyae-aidlc:kiro-cli` ownership，再以单一共享 owner 管理 Agent Skill。旧 `~/.kiro/powers/loeyae-aidlc/` 只有在存在当前安装器的 ownership manifest 且文件哈希全部匹配时才自动删除；无清单或已修改的旧 Power 会保留并给出警告，不会因目录名称相似而删除。

如果无法识别没有 ownership manifest 的旧目标，不要绕过检查或直接删除；先手工将它重命名为备份，再执行普通安装。例如，旧 Kiro IDE Power 可使用：

```bash
mv ~/.kiro/powers/loeyae-aidlc ~/.kiro/powers/loeyae-aidlc.pre-managed-backup
loeyae-aidlc install --harness kiro-ide
```

### 卸载

```bash
loeyae-aidlc uninstall --harness kiro-crew
loeyae-aidlc uninstall --harness kiro-ide --project /absolute/path/to/project
loeyae-aidlc uninstall --harness opencode
loeyae-aidlc uninstall --harness codebuddy
loeyae-aidlc uninstall --harness qoder --project /absolute/path/to/project
loeyae-aidlc uninstall --harness zcode
loeyae-aidlc uninstall --all
```

卸载只删除所有权清单中且哈希仍匹配的资产。Kiro IDE 与 Kiro CLI 的任一默认卸载命令都会移除两者共用的全局 Agent Skill；`uninstall --all` 对该共享目标只执行一次。`uninstall --all` 只处理当前 `~/.config/loeyae-aidlc/installations/` 中有 ownership manifest 的全局/user-scope 平台，并跳过从未安装或不受当前安装器管理的平台；CodeBuddy/Qoder 的 project scope 仍需显式传入 `--harness` 和 `--project`，因为仅凭哈希目录无法安全恢复原项目上下文。Codex 仅移除稳定 ID `loeyae-aidlc-stop-gate-v1` 对应的 Hook；其他 Hook 保留。CodeBuddy 通过官方 CLI 注销对应 scope；Qoder 仅在 CLI 可用时注销插件，desktop-only 模式直接删除受管 staging 和 `.qoder-cn/skills/loeyae-aidlc` 原生 Skill。ZCode 只移除精确匹配的 Loeyae Stop Hook，其他用户 Hook 和共享 MCP 项保留。共享 Kiro 和 Qoder MCP 项同样默认保留，因为可能仍被其他安装使用。批量命令会继续处理所有已选平台，但只要任一平台失败，最终退出码即为非零。

### 开发模式（从本地仓库）

```bash
git clone https://github.com/loeyae/loeyae-aidlc-v2.git
cd loeyae-aidlc-v2
npm link
loeyae-aidlc install --all
```

### 平台重启

安装后需重启对应平台使 skill 生效：

| 平台 | 重启方式 |
|------|---------|
| Kiro Crew | `kirocrew restart` 或重启桌面 App |
| Kiro IDE | 重新打开项目 |
| Kiro CLI | 新开 `kiro-cli chat` 会话 |
| Claude Code | 执行 `/reload-plugins`，或新开对话 |
| OpenCode | 重启 OpenCode |
| Codex | 新开会话 |
| WorkBuddy / CodeBuddy | 执行 `/reload-plugins`，或新开会话 |
| Qoder CN IDE / Desktop / CLI | 完全退出并重启 Qoder CN IDE/Desktop；CLI 执行 `/plugins reload`、`/mcp reload` 或重新启动 |
| ZCode | 新开会话；完整插件注册/启用在 Settings → Plugins 中完成 |

## 使用

安装并重启后，在 Kiro Crew 新会话中输入：

```
使用 AI-DLC 开发用户认证模块
```

触发关键词：`aidlc`、`AI-DLC`、`使用 AI-DLC`、`继续上次的工作`、`接手当前项目`、`查看可接手任务`、`在这台设备继续`、`审批当前阶段`、`确认架构方案`、`批准部署方案`、`功能设计`、`用户故事` 等。

能力型关键词的适用场景、输入边界和实际提示词模板见 [AI-DLC 能力关键词与提示词指南](docs/ai-dlc-keyword-guide.md)，其中包含调整已有 SVG 流程图的完整示例。

### CLI 命令

完整命令、参数组合、环境变量、脚本调用约定和故障排查见 [loeyae-aidlc CLI 使用手册](docs/loeyae-aidlc-cli-guide.md)。

```bash
# 查看版本
loeyae-aidlc version

# 编译 stage graph
loeyae-aidlc graph compile

# 新 workflow 默认 schema v3；identity 也可通过 AIDLC_ACTOR_ID/DEVICE_ID/CLIENT_ID 注入
loeyae-aidlc orchestrate next --scope feature \
  --actor-id actor:alice --device-id device:laptop --client-id client:session-1
# 仅当用户明确选择生成 PRD 时
loeyae-aidlc orchestrate next --scope feature --with-prd \
  --actor-id actor:alice --device-id device:laptop --client-id client:session-1
loeyae-aidlc orchestrate next --status
loeyae-aidlc orchestrate next \
  --actor-id actor:alice --device-id device:laptop --client-id client:session-1
# directive.claim_receipt 必须经安全 stdin 回传，不放进 argv/聊天
claim-receipt.json | loeyae-aidlc orchestrate report \
  --stage workspace-detection --instance workspace-detection --result completed \
  --instruction-ack workspace-detection --user-input single-module --claim-receipt-stdin
claim-receipt.json | loeyae-aidlc orchestrate report \
  --stage requirements-analysis --instance requirements-analysis@module:module-a \
  --result completed --claim-receipt-stdin

# I9 UI 设计是运行时选择；只能报告 directive.choices 中的一个值
claim-receipt.json | loeyae-aidlc orchestrate report \
  --stage ui-mock --instance ui-mock@module:module-a --result completed \
  --instruction-ack ui-mock --user-input html-mock --claim-receipt-stdin

# approval:block：Agent 展示 request 的随机确认语并停止；用户下一条消息必须精确输入
loeyae-aidlc approve --stage application-design \
  --instance application-design@module:module-a --request
conversation-confirmation-envelope | loeyae-aidlc orchestrate report \
  --stage application-design --instance application-design@module:module-a \
  --result approved --claim-receipt-stdin --approval-confirmation-stdin
loeyae-aidlc orchestrate park

# schema v2 只走兼容引擎；显式迁移默认 dry-run，--apply 才原子写入
loeyae-aidlc state migrate-v3 \
  --actor-id actor:alice --device-id device:laptop --client-id client:session-1

# 只读检查 state/enrollment 信任链；re-enroll 默认仅生成 dry-run 计划
loeyae-aidlc recover inspect
loeyae-aidlc recover re-enroll

# 使用业务项目中的受控命令清单生成构建测试证据
loeyae-aidlc evidence run --stage build-and-test

# 导出 Markdown 和 SVG
loeyae-aidlc export md /absolute/path/document.md --to docx --toc
loeyae-aidlc export md /absolute/path/document.md --to pdf
loeyae-aidlc export svg /absolute/path/diagram.svg --to png --scale 2

# 检查和保守美化已有 DOCX（独立能力，不推进 AI-DLC Stage）
loeyae-aidlc docx inspect /absolute/path/input.docx --json
loeyae-aidlc docx beautify /absolute/path/input.docx --dry-run --preset professional-zh --json
loeyae-aidlc docx beautify /absolute/path/input.docx --output /absolute/path/output.docx --preset professional-zh --json
loeyae-aidlc docx beautify /absolute/path/input.docx --output /absolute/path/custom.docx --style-spec /absolute/path/style-spec.json --json
loeyae-aidlc docx validate /absolute/path/output.docx --against /absolute/path/input.docx --json

# 构建某个 harness 的发布产物
loeyae-aidlc build --harness kiro-crew
loeyae-aidlc build --all
```

#### 文档与图表导出

`export` 提供三种严格映射：Markdown → DOCX、Markdown → PDF、SVG → PNG。未指定 `--output` 时写入输入文件同目录并使用相同主文件名；已有输出默认拒绝覆盖，只有显式 `--force` 才替换。

DOCX 导出将标题、正文、粗体、删除线、行内代码、引用、列表、表格和图片转换为 Word 原生结构，并按中英文显示宽度分配表格列宽。可重复使用 `--strip <关键字>` 剥离内部章节，使用 `--toc` 生成目录，或用 `--template /absolute/path/template.docx` 导入模板样式与页面设置。Mermaid fenced block 和本地 SVG 会转成高分辨率 PNG 后嵌入。

PDF 导出使用本机 Chrome、Chromium 或 Edge 打印静态 HTML；浏览器可通过 `--browser /absolute/path/to/browser` 或 `AIDLC_CHROME_BIN` 指定。Mermaid 使用发行包固定版本的本地脚本预渲染，不访问 CDN。SVG → PNG 使用固定版本 Resvg，可用 `--scale`、`--width`、`--dpi`、`--background` 和可重复的 `--font-dir` 控制输出。

导出器不下载远程图片，不读取 SVG 外部资源。浏览器、Mermaid、图片或格式校验失败时返回非零退出码，不生成降级格式或半成品。完整参数见：

```bash
loeyae-aidlc export --help
```

#### 已有 DOCX 的检查与保守美化

`docx` 是 Independent Capability，不接入或推进 46-stage AI-DLC 状态机。`inspect` 只读报告 OPC 结构、正文、样式、直接字体和 theme-font 引用；`beautify --dry-run` 先报告样式角色映射及直接格式影响后的预计覆盖率；实际写入要求显式、不同于源文件的 `--output`。可使用内置 `professional-zh` preset，或通过 `--style-spec` 提供严格 allowlist JSON；两者互斥。已有输出默认拒绝替换，只有明确使用 `--force` 才执行事务替换。`beautify` 只修改主文档 relationship 解析出的 styles Part，保留 `document.xml`、relationships、媒体、批注和修订等所有其他 Part 的原始字节。

```bash
loeyae-aidlc docx --help
```

写入后应使用 `docx validate <output> --against <input>` 做静态不变量验证。通过状态为 `STATIC_PASS`；没有 Microsoft Word 或 LibreOffice 真实打开/渲染证据时，不能宣称视觉 PASS。

## 架构

```
loeyae-aidlc-v2/
├── bin/cli.ts                   # CLI 入口（全局命令）
├── core/                        # 平台无关的引擎核心
│   ├── stages/                  # Stage 定义文件（带 frontmatter），共 46 stages
│   │   ├── ideation/           # 构思阶段 (5 stages)
│   │   ├── inception/          # 规划阶段 (24 stages)
│   │   ├── construction/       # 实现阶段 (15 stages)
│   │   └── operation/          # 运维阶段 (2 stages)
│   ├── tools/                   # 确定性 TS 工具链
│   │   ├── aidlc-orchestrate.ts # 核心状态机引擎
│   │   ├── aidlc-graph.ts      # Stage graph 编译器
│   │   ├── aidlc-export.ts     # Markdown/DOCX/PDF 与 SVG/PNG 导出器
│   │   └── data/               # 编译产物
│   ├── knowledge/               # 规则与参考文档 (45 files)
│   │   ├── protocols/          # 流程协议
│   │   ├── standards/          # 编码/设计标准
│   │   ├── design/             # 图表/UI 标准
│   │   └── tech/               # 技术栈规范
│   └── sensors/                 # 自动检查
├── harness/                     # 各平台适配层
│   ├── kiro-crew/              # Kiro Crew Dashboard
│   ├── kiro-ide/               # Kiro IDE (Agent Skill)
│   ├── kiro-cli/               # Kiro CLI
│   ├── claude/                 # Claude Code
│   ├── codebuddy/              # WorkBuddy Enterprise / CodeBuddy
│   ├── qoder/                  # Qoder CN IDE / Desktop / CLI shared local plugin
│   ├── zcode/                  # ZCode user integration + plugin marketplace
│   ├── codex/                  # Codex
│   └── opencode/               # OpenCode
├── dist/                        # 编译输出
├── scripts/                     # 构建脚本
└── tests/                       # 测试
```

## 引擎工作原理

v3 使用确定性多实例状态机取代 v1 的 agent 自路由；schema v2 仅保留兼容和受控迁移：

```
Agent ←→ aidlc-orchestrate.ts next   → 返回下一步的 JSON directive
Agent ←→ aidlc-orchestrate.ts report → 记录结果，推进状态
Agent ←→ aidlc-orchestrate.ts park   → 主动冻结 workflow（不是可交接性的前提）
```

每次成功的状态转换都会在返回 directive 前持久化签名 checkpoint。新会话中的 running workflow 通过 `aidlc-continuity` 直接执行 `next --status` / `next` 续接，不要求预先 park；`aidlc-handoff` 仅保留旧交接关键词兼容。只有用户明确要求冻结整个 workflow 时才执行 park，且只有 parked workflow 才使用 `next --resume`。

Agent 不能跳步——schema v3 的每次 `report` 必须绑定确定的 `stage_instance` 和当前有效 claim receipt；Stage slug、聊天声明或 `handoff.md` 负责人都不能授权提交。公开结果协议不包含 `skipped`；只有图谱声明的 `condition` 求值为 false 时，引擎才能写入内部 `condition_skipped` 历史。

`workspace-detection` 是完整 scope 的运行时架构 choice router：directive 返回 `single-module`、`multi-module`；选择写入签名 history。单模块跳过产品级 Inception，但仍生成唯一模块清单；产品契约仅在多模块或存在跨进程、异步事件、前后端接口、外部系统等事实时执行。快速 scope 不要求架构 choice。当前 46-stage 图谱共有 2 个 choice Stage：`workspace-detection` 与 `ui-mock`。

`prd-generation` 是初始化级用户选择，只能在新建完整 scope 时通过 `--with-prd` 写入签名状态。I9 `ui-mock` 是运行时 choice router：directive 返回 `choices` 与 `choice_required`，用户必须在 `html-mock`、`figma-create`、`figma-existing`、`skip` 中选择一个，并通过 `report ... --user-input <choice>` 写入签名 history。`skip` 不生成 UI 产物，HTML 与 Figma 分支互斥；后续机器路由只读取签名状态，不读取 `handoff.md`。

选择 UI 后，当前模块必须依次通过 `page-plan.md`、`ui-mock-manifest.json`（含 skeleton/content 两段）或 `figma-manifest.json`、以及模块级 `inception-consistency` Evidence；每段都与需求、故事和前序 canonical 产物做机器一致性验证。未选择 PRD/UI、UI condition=false 或选择 `skip` 时，不实例化对应 Stage，不读取分支文件，也不要求占位 Evidence。后续 code review 仅对已选 UI 模块/适用单元要求 `ui-design-alignment`，项目级 implementation report 必须聚合全部模块以及所有已选 PRD/UI Evidence。

`workflow-plan.md` 的机器决策表为 `application-design`、`units-generation`、`functional-design` 和 `operations` 分别记录 `execute / skip` 与 evidence。引擎优先执行该表；缺表的旧工作流才保守地根据项目证据推断。I14 被跳过时 Construction 使用确定性的 `default` 单元；I14 执行时，新签名工作流在 `unit-manifest.json` 为每个单元声明 `conditional_stages`，防止某个单元的 NFR、基础设施、契约、框架或 UI 事实扩散为所有单元的强制流程，旧清单缺字段时保守回退模块级条件。Operations 条件为 false 时不会出现部署审批，模板归档也仅在明确要求保留可复用模板时执行。

图谱通过 `axis: project | module | unit` 声明实例化范围。新工作流固定按“项目级 Ideation → 每个模块完整 Inception → 每个模块/单元完整 Construction → 项目级构建测试、实施报告与 Operations”执行。模块由 `docs/aidlc/ideation/module-manifest.json` 声明；每个模块的工作单元由 `docs/aidlc/modules/<module-id>/inception/unit-manifest.json` 声明。单模块项目同样声明一个模块和至少一个单元。

### 签名状态与恢复边界

> 新 workflow 默认使用 schema v3：确定性 DAG 可同时暴露多个 ready Stage instance；assignment 与短期 execution lease 分离，claim 先由 Coordination Provider 原子接受，再返回 directive/receipt。schema v2 工作流继续走单游标兼容引擎，只有显式 `state migrate-v3` 才迁移。

- `docs/aidlc/aidlc-state.json` 是唯一机器路由状态。schema v3 使用签名 append-only event、instance map、单调 revision 和跨进程 CAS；`report` 必须绑定 `--instance` 与安全 stdin 中的有效 claim receipt。
- Local Provider 只裁决同一工作树内进程；Git Provider 在专用 `refs/heads/aidlc/coordination/<workflow-id>` 上以远端 CAS 支持跨工作树/设备，不把业务 `main`/`master` 当锁；External Provider 当前是通用接口和内存 reference implementation，不代表已有 Jira/TAPD/Linear 连接器。
- actor/device/client 共同标识 lease holder；assignment 只是长期负责人关系。不同 ready 实例可并行 claim，同一实例同时最多一个有效 lease。
- `docs/aidlc/handoff.md` 只是派生的人类协作视图，不能改变 stage、skip、approval、claim 或 revision；冲突时以签名机器状态为准。
- enrollment 位于项目外的 `~/.config/loeyae-aidlc/trust/enrollments/`。已 enrollment 的项目若 state 缺失、未签名、签名无效或 workflow ID 不匹配，CLI 与生命周期 Hook 都会 fail-closed。
- 默认 key 位于 `~/.config/loeyae-aidlc/trust/trust.key`（`0600`）；宿主也可在启动所有相关进程前提供至少 32 字节的 `AIDLC_TRUST_SECRET`，测试/隔离环境可设置 `AIDLC_TRUST_DIR`。需要生成 Evidence 的工作流必须在第一次 `next` 前配置稳定的 `AIDLC_TRUST_SECRET`，并由 CI/宿主安全注入相同值。
- 信任链冲突只能先用 `loeyae-aidlc recover inspect` 只读检查，再对 `parked` state 执行 `recover re-enroll`。后者必须用 `AIDLC_RECOVERY_SECRET` 或受限的 `AIDLC_RECOVERY_KEY_FILE` 证明旧 state，并用 `AIDLC_RECOVERY_ENROLLMENT_FILE` 提供同一 workflow、旧 key 签名的 active enrollment 以证明源项目绑定；跨主机路径变化由源/目标 root SHA 和真人短语显式确认。默认 dry-run，实际写入还要求 state/current enrollment/source enrollment SHA、旧/新 key ID、workflow ID 和原因，没有 `--yes` 或 secret CLI 参数。
- recovery 在项目外 trust store 保存原 state、当前 enrollment 和源 enrollment 的原始字节、活动 key 签名的 plan/result audit，并使用带 `recovery_id` 的 pending enrollment + state lock 实现可续跑事务。事务未完成时普通 loader/Hook 继续 fail-closed；中断后重新运行同一命令继续，不得手工改 state、删 enrollment、任意重签或删除未决 audit。旧 key 签名的 Evidence 不会被批量重签，后续门禁需要时必须由受控 Producer 重新生成。

该机制防止“只能写业务项目、不能访问用户 trust store”的 Agent 直接伪造 state/Evidence；它不能防御拥有同一 OS 用户任意文件读写权或能控制宿主进程环境的恶意进程，不应表述为同 UID 下绝对不可伪造。

### 审批与 instruction-only

只有条件判定需要执行的 `application-design` 和 `operations` 实例使用 `approval: block`。`next` 为其创建绑定 `workflow_id + stage_instance + challenge` 的随机 challenge；模块级 `application-design` 的每个模块实例分别审批。用户通过 `aidlc-approval` Skill、自然语言关键词或 Claude `/aidlc-approve` 进入审阅；`approve --stage <slug> --instance <id> --request` 返回绑定当前 request 的随机 `confirmation_phrase`。Agent 展示 canonical 产物/Evidence 摘要和完整短语后必须结束回合；只有用户在下一条真实消息中手工输入完全一致的正文，Agent 才能将 `aidlc.approval.confirmation` 与当前 claim receipt 组成严格 stdin envelope，通过 `--approval-confirmation-stdin` 定向报告。普通“同意”、预填按钮、Agent 复制文本、旧消息或同一回合自动提交均无效。引擎在内部生成并立即消费最长 15 分钟的一次性 token，仍校验 request、TTL、instance、receipt、produces、sensors 和 replay。受信宿主 Provider 仅是可选一键增强，真人 TTY 仅是备用路径；默认流程不要求专用安全审批卡或另开终端。condition=false 的实例先自动记录 `condition_skipped`，不会创建 challenge。

12 个不产生机器可验证产物的阶段显式标记为 `instruction_only`，执行正文后必须用 `--instruction-ack <stage-slug>` 报告。Stop Hook 不携带该确认，因此不能自动推进这些阶段。

### 五层门禁

| 层 | 机制 | 时机 | 覆盖 |
|----|------|------|------|
| requires | 前置 stage 依赖检查（scope-aware） | `next` | 45/46 |
| condition | 动态条件评估（false 时自动跳过） | `next` | 26/46 |
| produces | 产物存在、路径安全且每个文件至少 16 字节 | `report` | 34/46 |
| sensors | 结构化证据或内置质量校验 | `report` | 34/46 |
| instance + receipt | 定向实例与有效 execution lease 检查 | `report` | 所有 v3 实例 |

仅 `application-design`（架构决策）和 `operations`（部署决策）保留 `approval: block`，且只在各自 condition=true 时出现；12 个 instruction-only stage 需要显式 ack；其余 stage 在声明门禁通过后推进。

### Evidence 协议（Construction）

Construction sensors 按当前执行实例读取机器生成的结构化证据：项目级 `.aidlc/evidence/<stage-slug>/<sensor>.json`，模块级 `.aidlc/evidence/<stage-slug>/<module-id>/<sensor>.json`，单元级 `.aidlc/evidence/<stage-slug>/<module-id>/<unit-id>/<sensor>.json`。模块/单元 Evidence 不能跨上下文复用。证据文件必须：
- 包含 `evidence_version: "1"` 和合法 ISO `timestamp`（≤ 24h）
- 包含 `producer.name: "loeyae-aidlc-evidence"`、HMAC-SHA256 `integrity` 和当前 `commit + dirty + worktree_digest`
- 由受控 Producer、CI、构建工具或测试 runner 生成（非手写），且生成时提供至少 32 字节的 `AIDLC_TRUST_SECRET`
- 命令只记录 `argv_digest`，不把可能含 token/secret 的完整 argv 写入证据；stdout/stderr 尾部继续脱敏
- ≤ 512 KB，按 sensor schema 严格校验

详见 `core/knowledge/protocols/common-quality-gates.md`。

受控 Producer 使用业务项目根目录的 `.aidlc/evidence-commands.json` 作为命令 allowlist。构建测试使用 `build`、`test`、`check` 角色；其他语义 sensor 使用 `role: "semantic"` 并绑定 `sensor`。semantic 声明只能是 `loeyae-aidlc check --sensor <sensor>`；Producer 实际固定执行发行包内的内置 checker，项目配置中的任意 `node -e`、Python、shell 或绝对路径 checker 都会被拒绝：

```bash
loeyae-aidlc evidence run --stage code-review --sensor review-evidence
```

语义 checker 可以直接调用仓库内置检查器：

```bash
loeyae-aidlc check --sensor review-evidence
```

allowlist 中的最小语义命令配置如下：

```json
{
  "version": "1",
  "stage": "code-review",
  "commands": [{
    "id": "review-checker",
    "role": "semantic",
    "sensor": "review-evidence",
    "argv": ["loeyae-aidlc", "check", "--sensor", "review-evidence"]
  }]
}
```


### Scope 过滤

不同 scope 执行不同数量的默认 stages（以下为条件判断前且未选择可选 PRD 的候选数量；实际数量会因项目证据自动跳过条件阶段）。`feature`、`enterprise`、`mvp`、`classic` 初始化时显式使用 `--with-prd` 会增加 `prd-generation` 这 1 个用户选择阶段：

| Scope | 候选 stages | 典型场景 |
|-------|------------|---------|
| feature | 45 | 完整功能开发 |
| enterprise | 45 | 企业级完整流程 |
| mvp | 45 | 最小可行产品 |
| classic | 43 | 标准开发流程 |
| express | 7 | 快速迭代 |
| workshop | 7 | 工作坊/探索 |
| bugfix | 7 | Bug 修复 |
| refactor | 7 | 代码重构 |
| poc | 7 | 概念验证 |

## 从 v1 迁移

v1 源码在 `loeyae-aidlc` 仓库。v2 的所有 steering 内容已从 v1 迁移：

- v1 的 46 个 `steering/inception-*.md` / `construction-*.md` / `operations-*.md` / `product-*.md`
  → v2 的 `core/stages/` 带 frontmatter
- v1 的 44 个 `steering/common-*.md` + `core-workflow*.md`
  → v2 的 `core/knowledge/` 按职责域分类

## 前置条件

- Node.js ≥ 20
- npm 或 bun（安装用）
- Kiro Crew Desktop（使用 Kiro Crew harness 时）
- 两个阻断审批阶段默认要求用户在新的对话消息中精确输入引擎随机确认语；受信宿主 Provider 和真人 TTY 均为可选增强/备用通道。

## License

MIT
