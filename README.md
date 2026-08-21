# Loeyae AI-DLC v2

基于引擎驱动的 AI-DLC 方法论实现，采用确定性 TypeScript 工具链 + 多 harness 分发架构。

## 架构

```
loeyae-aidlc-v2/
├── core/                        # 平台无关的引擎核心
│   ├── stages/                  # Stage 定义文件（带 frontmatter）
│   │   ├── ideation/           # 构思阶段
│   │   ├── inception/          # 规划阶段
│   │   ├── construction/       # 实现阶段
│   │   └── operation/          # 运维阶段
│   ├── tools/                   # 确定性 TS 工具链
│   │   ├── aidlc-orchestrate.ts # 核心状态机引擎
│   │   ├── aidlc-graph.ts      # Stage graph 编译器
│   │   └── data/               # 编译产物（stage-graph.json）
│   ├── hooks/                   # 生命周期钩子
│   ├── scopes/                  # Scope 定义（bugfix, feature, enterprise...）
│   ├── agents/                  # Agent persona 文件
│   ├── knowledge/               # 方法论参考知识
│   ├── sensors/                 # 自动检查传感器
│   ├── skills/                  # 辅助 skills
│   ├── templates/               # 输出模板
│   └── memory/                  # 分层规则文件（org/team/project/phase）
├── harness/                     # 各平台适配层
│   ├── kiro-crew/              # Kiro Crew Dashboard
│   ├── kiro-ide/               # Kiro IDE (Power)
│   ├── claude/                 # Claude Code
│   └── opencode/               # OpenCode
├── dist/                        # 编译输出（各平台部署产物）
├── plugins/                     # 可插拔扩展（额外 stages/scopes/agents）
├── scripts/                     # 构建脚本
│   ├── build.ts                # 统一编译入口
│   └── manifest-types.ts       # Harness 清单类型定义
├── tests/                       # 测试
├── docs/                        # 文档
├── package.json
└── tsconfig.json
```

## 与 v1 的核心区别

| 维度 | v1 (loeyae-aidlc) | v2 (本仓库) |
|------|-------------------|------------|
| 编排 | Agent 读 markdown 自主路由 | 确定性引擎返回 JSON directive |
| 状态 | agent 写 state.md | 工具管理，agent 不能直接改 |
| 门禁 | 靠规则约束 | 工具拒绝非法转换 |
| 多平台 | 3 个入口文件手动维护 | core/ 编译 → 4 个 harness 自动分发 |
| 扩展 | 修改 steering | plugins/ 贡献 stages/scopes |

## 快速开始

```bash
# 安装依赖
bun install

# 编译 stage graph
bun run compile-graph

# 构建某个 harness 的发布产物
bun run build:kiro-crew

# 构建全部
bun run build:all
```

## 迁移路线

现有 loeyae-aidlc v1 的 90 个 steering 文件将分批迁入 core/stages/：

1. **结构迁移**：steering/*.md → core/stages/<phase>/<slug>.md（添加 frontmatter）
2. **引擎实现**：完善 aidlc-orchestrate.ts 的状态机逻辑
3. **Scope 编译**：从 stage frontmatter 的 scopes 字段编译 scope grid
4. **Harness 适配**：各平台 SKILL.md / POWER.md / CLAUDE.md 引用引擎
5. **测试覆盖**：directive 序列 + scope 路由 + 状态转换

## 原文件位置

v1 源码：`../loeyae-aidlc/`（同工作区）
