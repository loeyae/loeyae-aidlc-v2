# MARS-253 删除交付适用性、用例来源和兼容范围

基线：`91710d1fc69bbe86a924d30f6eda73d7093fecbe`（4.22.5）。本变更不升级版本。

## 实现与验证矩阵

| 缺口 | 实现 | 实际验证 | 未验证范围 |
|---|---|---|---|
| 可信无行为删除被强制要求业务 UC-D | v1 删除条目新增可选 `applicability`；`not_applicable` 省略 `ucd_id`，复用受控 I13 适用性来源或已批准空子集豁免。授权需求、真实删除、基线 blob、范围归属保持检查 | 纯配置和空 UC-D 子集均执行真实 I13、替代检查、源码 produce 和 `orchestrate report --result completed`；配置 GREEN 有有效成功观察复用。检查失败、缺成功记录、伪造观察来源、授权缺失、来源/命令/环境/基线世代漂移均拒绝 | 未在九种宿主应用中分别交互执行 |
| 按 ID 拼文件名拒绝 I13 有效来源 | I13 和删除入口共享受控声明解析器，支持规范、描述性文件名和多声明聚合文件；新增 `ucd_sources` 记录 ID 的真实文件与 SHA-256 | 描述性与聚合文件均完成真实业务 RED → 删除 → GREEN → CLI 完成；验证重复声明、缺文件、来源修改、越界来源和错误 ID 拒绝；保留业务来源为故事引用且本声明有需求追溯的格式 | 不替未提供的外部用例来源生成或复制文件 |
| `scope.scoped` 拒绝兼容模块全集 | 继续使用 `unitUcdIds`；无 `unit_refs` 时由单单元或唯一匹配的 manifest 需求证明删除归属，真实多单元歧义拒绝 | 显式单元范围、单单元无 `unit_refs`、多单元但需求归属唯一的模块全集均完成 CLI；多单元需求归属歧义及错误归属拒绝 | 歧义场景由用户明确归属后才可交付 |

## 兼容性与证据边界

- 省略 `applicability` 的现有业务删除条目保持业务 RED/GREEN 语义，不接受无行为条目替代非空 UC-D 子集的业务验证。
- 纯配置等无行为删除需声明 `applicability: "not_applicable"`，不可同时伪造 `ucd_id`；无受控 I13/批准来源不放行。适用性来自 I13 协议，不根据路径名字猜测。
- 新 I13 来源映射发生变更需刷新 I13 并重新验证；旧 I13 没有新增映射时仍用共享解析器、真实模块文件、来源和归属检查，保留已有格式兼容。
- 源码 produce 验证删除与归属；执行成功、命令与输入绑定由统一 phase/completion 门禁复核。无需在生成 GREEN 之前伪造 GREEN 文件。
- 复用观察额外核对真实本地成功观察记录及其 ID；空子集执行记录保留 `input_binding` 并在完成时核验来源、环境和基线绑定。旧直接执行证据保留原保守门禁；旧复用记录必须能够解析到当前有效成功观察。
- 依赖方向为 semantic-checks/evidence/source-deletions → 共享纯模块，无反向依赖或循环导入。
- 原 MARS-252 测试的保留 health、删除最后源码根、消费者、基线推进、嵌套仓库和无效删除防护保留。

## 验证命令

在任务 worktree 运行，使用隔离的 `npm ci --ignore-scripts --no-audit --no-fund` 安装依赖（退出 0）。所有命令退出码如下：

| 命令 | 退出码 |
|---|---:|
| `npm run typecheck` | 0 |
| `npm run build:all` | 0 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars253_deletions.ts` | 0 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars253_distribution.ts` | 0（九种分发，117 项字节一致性检查） |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars252_deletions.ts` | 0 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars252_policy.ts` | 0 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars251_policy.ts` | 0 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars250_policy.ts` | 0 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars95_source_delivery.ts` | 0 |
| `git diff --check` | 0 |

扩展旧套件 `test_v4_8_0_unit_ucd_scope.ts` 与 `test_v4_6_0_tdd_mode.ts` 退出 1：旧 fixture 在工作流写入前被 `explicit session binding required before workflow writes; use module inspect/bind` 拒绝。在原始 `91710d1` 的隔离 archive 快照上运行同样命令，均退出 1，失败场景与该会话绑定错误一致；未放宽会话门禁或将这些套件记为通过。新 MARS-253 fixture 使用现有真实会话绑定，覆盖本任务归属、来源、空子集和实际完成路径。

未运行无关全仓测试、外部 CI、macOS/Linux 宿主或九种宿主应用的交互测试；分发按官方脚本重新生成并验证共享文件一致性。旧审计探针只用于理解复现条件；修复通过依据为新正向完成断言。

## 工作区保护

人类主目录始终保持 `main / 91710d1fc69bbe86a924d30f6eda73d7093fecbe`，初始及交付前状态均只有未暂存 `.gitignore` 修改（本机实际不存在 AGENTS.md 文件）。用户改动未进入任务提交；未切换主目录分支，未 stash/reset/clean，未更改主目录 node_modules。任务位于独立 `loeyae-aidlc-v2-mars253` worktree，分支 `MARS-253-deletion-semantics`；持该仓库目录的串行写锁操作，其他 worktree 保留。

交付为提交、独立分支和 PR；未合并 main、tag 或发布。
