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
npm install -g https://github.com/loeyae/loeyae-aidlc-v2/archive/2ba85d1.tar.gz
```

如果 Windows 的 `loeyae-aidlc` 仍指向旧的本地路径（例如 `E:\Work\repo\node\...`），先清理旧的全局安装和命令 shim，再重新安装：

```powershell
npm uninstall -g loeyae-aidlc
npm install -g https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
```

### 部署到各平台

```bash
# Kiro Crew Dashboard（默认，全局 skill）
loeyae-aidlc install

# Kiro IDE（全局 Power）
loeyae-aidlc install --harness kiro-ide

# Kiro CLI（全局 agent skill）
loeyae-aidlc install --harness kiro-cli

# Claude Code（全局 user-scope plugin；安装器会通过官方 CLI 注册 marketplace 并安装）
loeyae-aidlc install --harness claude

# Claude Code（显式项目级部署；写入目标项目的 .claude 配置）
loeyae-aidlc install --harness claude --target ./my-project

# OpenCode（全局 plugin）
loeyae-aidlc install --harness opencode

# Codex（全局 agent）
loeyae-aidlc install --harness codex

# 一次性安装到所有平台
loeyae-aidlc install --all
```

Kiro Crew 的默认安装还会将 V1 的 `loeyae-skills`、`awesome-design`、`figma`、`ssot` 和 `chrome-devtools` MCP 服务按“只补缺失项、不覆盖同名现有配置”的规则合并到 `~/.kiro/settings/mcp.json`。`ssot` 使用环境变量 `SSOT_API_KEY`，不把密钥写入安装包或项目文件。项目级 `--target` 安装不会修改全局 MCP 配置。

Claude Code 的安装器会额外生成本地 marketplace，并调用官方 `claude plugin marketplace add`、`claude plugin install` 注册 user-scope 插件；不会直接编辑 `installed_plugins.json`。staging 文件位于 `~/.claude/plugins/loeyae-aidlc-marketplace/`，实际运行缓存和注册表由 Claude Code 管理。当前已打开的 Claude 会话需执行 `/reload-plugins`（如提示缓存变更则按提示使用 `--force`）或重新开会话；新会话会自动加载。

各平台的全局安装路径：

| 平台 | 安装路径 |
|------|---------|
| Kiro Crew | `~/.kiro/crew/skills/loeyae-aidlc/` |
| Kiro IDE | `~/.kiro/powers/loeyae-aidlc/` |
| Kiro CLI | `~/.kiro/skills/loeyae-aidlc/` |
| Claude Code | `~/.claude/plugins/loeyae-aidlc-marketplace/plugins/loeyae-aidlc/`（staging；运行时由 Claude Code 管理官方 cache 和注册表） |
| OpenCode | `~/.config/opencode/plugins/loeyae-aidlc.js`（入口；资源位于同级 `loeyae-aidlc/`） |
| Codex | `~/.agents/skills/loeyae-aidlc/` |

### 平台生命周期门禁

所有平台共用 `loeyae-aidlc orchestrate report` 作为唯一准出判定入口；平台 Hook 只负责在生命周期边界触发该命令，不直接修改 `docs/aidlc/aidlc-state.json` 或 `.aidlc/evidence/`。

| 平台 | 原生机制 | 安装/激活方式 | 失败时行为 |
|------|---------|---------------|------------|
| Kiro IDE | `.kiro/hooks/` 的 `Stop` Hook | `loeyae-aidlc install --harness kiro-ide --project <project>` | 由 Kiro Hook 触发引擎检查；具体 Kiro 版本的 Stop 阻断能力以运行时为准 |
| Kiro CLI | `.kiro/hooks/` 的 `Stop` Hook（支持该格式的版本） | `loeyae-aidlc install --harness kiro-cli --project <project>` | 由 Kiro Hook 触发引擎检查 |
| Claude Code | 插件 `hooks/hooks.json` 的 `Stop` Hook | 随官方插件安装自动注册 | `decision:block` 阻止回合结束 |
| OpenCode | 插件 `session.idle` 事件 | 全局插件安装自动加载 | 失败时通过插件继续提示 Agent 处理 |
| Codex | 全局 `~/.codex/hooks.json` 的 `Stop` Hook | `loeyae-aidlc install --harness codex`，然后 `/hooks` 审查并信任 | `decision:block` 触发继续执行 |
| Kiro Crew | 当前无公开生命周期 Hook | Skill 强制调用引擎；不能伪造完成 | 引擎拒绝 `report`，Skill 必须继续修复 |

Hook 未安装或平台未触发时，不能降低引擎门禁要求；直接调用 `orchestrate report` 仍会执行完整的 `requires`、`condition`、`produces`、`sensors`、审批和当前阶段校验。

自定义路径（项目级部署）：

```bash
loeyae-aidlc install --harness claude --target ./my-project
```

### 升级

```bash
npm install -g https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
loeyae-aidlc install        # 重新部署（或 --all 全部）
```

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

## 使用

安装并重启后，在 Kiro Crew 新会话中输入：

```
使用 AI-DLC 开发用户认证模块
```

触发关键词：`aidlc`、`AI-DLC`、`使用 AI-DLC`、`继续上次的工作`、`功能设计`、`用户故事` 等。

### CLI 命令

```bash
# 查看版本
loeyae-aidlc version

# 编译 stage graph
loeyae-aidlc graph compile

# 直接调用引擎（在业务项目目录下执行）
loeyae-aidlc orchestrate next --scope feature
loeyae-aidlc orchestrate next --status
loeyae-aidlc orchestrate report --stage requirements-analysis --result completed
loeyae-aidlc orchestrate park

# 使用业务项目中的受控命令清单生成构建测试证据
loeyae-aidlc evidence run --stage build-and-test

# 构建某个 harness 的发布产物
loeyae-aidlc build --harness kiro-crew
loeyae-aidlc build --all
```

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
│   │   └── data/               # 编译产物
│   ├── knowledge/               # 规则与参考文档 (45 files)
│   │   ├── protocols/          # 流程协议
│   │   ├── standards/          # 编码/设计标准
│   │   ├── design/             # 图表/UI 标准
│   │   └── tech/               # 技术栈规范
│   ├── scopes/                  # Scope 定义
│   ├── agents/                  # Agent persona
│   ├── sensors/                 # 自动检查
│   └── memory/                  # 分层规则
├── harness/                     # 各平台适配层
│   ├── kiro-crew/              # Kiro Crew Dashboard
│   ├── kiro-ide/               # Kiro IDE (Power)
│   ├── claude/                 # Claude Code
│   └── opencode/               # OpenCode
├── dist/                        # 编译输出
├── scripts/                     # 构建脚本
├── plugins/                     # 可插拔扩展
└── tests/                       # 测试
```

## 引擎工作原理

v2 使用确定性状态机取代 v1 的 agent 自路由：

```
Agent ←→ aidlc-orchestrate.ts next   → 返回下一步的 JSON directive
Agent ←→ aidlc-orchestrate.ts report → 记录结果，推进状态
Agent ←→ aidlc-orchestrate.ts park   → 保存状态供下次恢复
```

Agent 不能跳步——引擎验证每次 `report` 的 stage 必须是当前活跃 stage，否则拒绝。

### 五层门禁

| 层 | 机制 | 时机 | 覆盖 |
|----|------|------|------|
| requires | 前置 stage 依赖检查（scope-aware） | `next` | 41/46 |
| condition | 动态条件评估（false 时自动跳过） | `next` | 14/46 |
| produces | 产物文件存在且非空 | `report` | 32/46 |
| sensors | 结构化证据校验（evidence 协议） | `report` | 21/46 |
| current_stage | 防跳步 | `report` | 46/46 |

仅 `application-design`（架构决策）和 `operations`（部署决策）保留 `approval: block`；其余 44 stage 门禁通过即自动推进。

### Evidence 协议（Construction）

Construction sensors 从 `.aidlc/evidence/<stage-slug>/<sensor>.json` 读取机器生成的结构化证据。证据文件必须：
- 包含 `evidence_version: "1"` 和合法 ISO `timestamp`（≤ 24h）
- 由 CI/构建工具/测试 runner 写入（非手写）
- ≤ 512 KB，按 sensor schema 严格校验

详见 `core/knowledge/protocols/common-quality-gates.md`。

受控 Producer 使用业务项目根目录的 `.aidlc/evidence-commands.json` 作为命令 allowlist。构建测试使用 `build`、`test`、`check` 角色；其他语义 sensor 使用 `role: "semantic"` 并绑定 `sensor`：

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

不同 scope 执行不同数量的 stages（以下为条件判断前的候选数量；实际数量会因项目证据自动跳过条件阶段）：

| Scope | 候选 stages | 典型场景 |
|-------|------------|---------|
| feature | 46 | 完整功能开发 |
| enterprise | 46 | 企业级完整流程 |
| mvp | 46 | 最小可行产品 |
| classic | 44 | 标准开发流程 |
| express | 7 | 快速迭代 |
| workshop | 7 | 工作坊/探索 |
| bugfix | 7 | Bug 修复 |
| refactor | 7 | 代码重构 |

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

## License

MIT
