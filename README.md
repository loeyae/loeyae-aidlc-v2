# Loeyae AI-DLC v2

基于引擎驱动的 AI-DLC 方法论实现。确定性 TypeScript 工具链 + 多 harness 分发架构。

## 安装

### 全局安装（从 GitHub，不需要 npm registry）

```bash
npm install -g git+https://github.com/loeyae/loeyae-aidlc-v2.git
```

固定到指定版本：

```bash
npm install -g git+https://github.com/loeyae/loeyae-aidlc-v2.git#v2.0.0
```

### 部署到各平台

```bash
# Kiro Crew Dashboard（默认，全局 skill）
loeyae-aidlc install

# Kiro IDE（全局 Power）
loeyae-aidlc install --harness kiro-ide

# Kiro CLI（全局 agent skill）
loeyae-aidlc install --harness kiro-cli

# Claude Code（全局 plugin）
loeyae-aidlc install --harness claude

# OpenCode（全局 plugin）
loeyae-aidlc install --harness opencode

# Codex（全局 agent）
loeyae-aidlc install --harness codex

# 一次性安装到所有平台
loeyae-aidlc install --all
```

各平台的全局安装路径：

| 平台 | 安装路径 |
|------|---------|
| Kiro Crew | `~/.kiro/crew/skills/loeyae-aidlc/` |
| Kiro IDE | `~/.kiro/powers/loeyae-aidlc/` |
| Kiro CLI | `~/.kiro/skills/loeyae-aidlc/` |
| Claude Code | `~/.claude/plugins/loeyae-aidlc/` |
| OpenCode | `~/.config/opencode/plugins/loeyae-aidlc/` |
| Codex | `~/.codex/agents/loeyae-aidlc/` |

自定义路径（项目级部署）：

```bash
loeyae-aidlc install --harness claude --target ./my-project
```

### 升级

```bash
npm install -g git+https://github.com/loeyae/loeyae-aidlc-v2.git
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
| Claude Code | 新开对话 |
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

# 构建某个 harness 的发布产物
loeyae-aidlc build --harness kiro-crew
loeyae-aidlc build --all
```

## 架构

```
loeyae-aidlc-v2/
├── bin/cli.ts                   # CLI 入口（全局命令）
├── core/                        # 平台无关的引擎核心
│   ├── stages/                  # Stage 定义文件（带 frontmatter）
│   │   ├── ideation/           # 构思阶段 (5 stages)
│   │   ├── inception/          # 规划阶段 (23 stages)
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

### Scope 过滤

不同 scope 执行不同数量的 stages：

| Scope | 说明 | 约执行 stages |
|-------|------|--------------|
| feature | 完整功能开发 | 45/45 |
| enterprise | 企业级完整流程 | 45/45 |
| mvp | 最小可行产品 | ~23/45 |
| classic | 标准开发流程 | ~26/45 |
| express | 快速迭代 | ~7/45 |
| bugfix | Bug 修复 | ~7/45 |
| refactor | 代码重构 | ~8/45 |

## 从 v1 迁移

v1 源码在 `loeyae-aidlc` 仓库。v2 的所有 steering 内容已从 v1 迁移：

- v1 的 45 个 `steering/inception-*.md` / `construction-*.md` / `operations-*.md` / `product-*.md`
  → v2 的 `core/stages/` 带 frontmatter
- v1 的 44 个 `steering/common-*.md` + `core-workflow*.md`
  → v2 的 `core/knowledge/` 按职责域分类

## 前置条件

- Node.js ≥ 20
- npm 或 bun（安装用）
- Kiro Crew Desktop（使用 Kiro Crew harness 时）

## License

MIT
