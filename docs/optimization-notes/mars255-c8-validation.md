# MARS-255 C8 角色适用性与原生 Node 测试证据

基线：`main 144307c0f467775bdd9feec2daaf5e809fa201c5`，版本保持 `4.22.6`。Windows，Node `v22.23.2`。本次不合并、不升级版本、不打 tag、不发布。

## 两项实现与验证矩阵

| 问题 | 实现 | 真实验证 |
| --- | --- | --- |
| 普通业务机械要求 build/test/check | 可选 `role_applicability` 引用模块自身 package.json 的已批准 `aidlc_validation` 政策。逐模块计算 required 角色，无声明默认 build/check；原生 Node 可明确记录独立 build/check 不适用，业务 test 不豁免。保存规范化配置摘要、包字节 SHA-256 和政策，producer/gate/report/重验共用语义。 | 未改 main 的真实 producer 在只有 test/check 时退出 2；修复后真实 I13 `required` → 语法检查 + 原生测试 → producer 0 → 实际 C8 gate 无失败 → public report 0。混合模块、配置/命令/源漂移、缺少/空/未批准/矛盾政策、必需构建失败、遗漏已配置必需命令均阻断。 |
| 原生 Node TAP 未识别 | 小型独立解析器验证 TAP 13 头、根 plan/连续编号、结果数与唯一完整最终汇总。识别可用的 Node test/suite 类型和 SKIP/TODO 状态以复核计数；嵌套不重复累计。旧数字摘要继续兼容，测试统计逐条与 C8 汇总对账。 | main 配齐三角色后原生 TAP producer 仍退出 2。修复后无需自造摘要，嵌套 suite、多文件、跳过 suite 的真实运行得到 total 5 / passed 3 / failed 0 / skipped 2。真实失败、取消、全 skip/todo/零通过退出 2；截断、重复、矛盾摘要、伪造汇总和任意 passed 文本不被接受。 |

完整契约和配置示例见 `core/knowledge/protocols/common-c8-role-applicability.md`。阶段、模板、通用门禁、sensor、构建测试技能和 CLI 指南已同步。九种 dist 由仓库生成器同步。

report 验证还发现原共享扫描器遗漏 `.cjs/.mjs`，导致 test-quality 报 test source files missing；已在公共扩展集合补齐，traceability 与 test-quality 保持同一语义。真实 CommonJS C8 report 已通过；前置已完成阶段由测试夹具准备，I13、业务 RED/GREEN、C8 命令和完成门禁均真实执行。这不是所有工作流阶段从零端到端运行的声明。

## 实际命令与退出码

| 命令 | 退出码 / 结果 |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | 0；依赖仅安装到任务 worktree |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars255_c8.ts --baseline` | 0；内部确认两个 main producer 负例各退出 2，修复后 producer/gate/public C8 report 正例成功，拒绝负例为 CLI 退出 2 |
| `npx --no-install tsx tests/test_mars249_validation_policy.ts` | 0；已加入有来源依据的无构建业务正例，保留未声明不得豁免、无行为替代验证、历史 RED、复用及审查回归 |
| `npx --no-install tsx tests/test_mars253_deletions.ts` | 0；六种真实删除完成路径 |
| `npx --no-install tsx tests/test_mars252_policy.ts` | 0；36 个 notify 阶段、来源/复用规则 |
| `npx --no-install tsx tests/test_mars252_deletions.ts` | 0；真实行为删除、无剩余源码和 nested repo 路径 |
| `npx --no-install tsx tests/test_mars250_policy.ts` | 0；producer、age、UI、替代观察及 gate 绑定 |
| `npx --no-install tsx tests/test_i13_case_root.ts` | 0 |
| `npx --no-install tsx tests/test_construction_tdd_gates.ts` | 0 |
| `npm run build:all` | 0；九种 harness，38 个阶段图 |
| `npm run typecheck` | 0 |
| `npx --no-install tsx tests/test_distribution_parity.ts` | 0；2283 份文件，九种完整源码/分发一致性 |
| `npx --no-install tsx tests/test_mars253_distribution.ts` | 0；117 份关键删除协议/引擎副本 |
| 核对 `scripts/core-test-suites.json` 可解析、新 C8 测试只登记一次、所有脚本路径存在 | 0；未改变聚合 runner 的执行逻辑 |
| `git diff --check` | 0 |
| `npx --no-install tsx tests/test_v4_5_4_engine_defects.ts` | 1；D1/D2/D3/D5/D6/D7/D8/D9/M1 通过，最后的旧 `4.6.1 D8 directory artifacts` 有 9 条遗留断言不符，见下文。没有宣称全套通过。 |

## 已确认的基线失败与边界

旧 engine suite 的 D7 仍期待 C8 使用与默认 lookup 不同的 `--config`，与 main 已有的 `assertPhaseConfigBinding(options, "build/test")` 冲突。本次将该相关测试改为拒绝不同清单、接受同一实际 lookup，并确认未执行错误命令；修订后的 D7 通过，未放宽产品绑定。

最后的 `4.6.1 D8 directory artifacts` 仍断言 16 字节门槛、旧错误文案及旧聚合路径。本次与 `144307c` 的隔离归档快照都得到同样 9 条不符；基线仅在测试入口筛选该 section，其断言和产品源码均未改。快照使用任务自己的依赖，未修改主目录或其他 worktree 的 node_modules。原始定向基线日志和本次 C8 日志随 issue 附件交付。该段产物规则不属于本次两个 C8 问题，保留现有产品语义并显式报告，未通过降低正确断言来伪造全绿。

本轮默认角色例外适配保守限定于明确声明的原生 Node 项目；其他技术栈维持默认要求，没有猜测或引入新的构建工具。声明中的审批引用是项目政策追溯字段，不是用户身份认证，也不增加审批流程。Node TAP 在本机 Node 22.23.2 上真实验证；未声称所有 Node 版本/所有 reporter 都已验证。未运行无关全仓 npm test、tarball 安装全链、Provider 外部集成或 CI，不等待外部 CI。

## 工作区保护

人类主目录始终保持 `main / 144307c0f467775bdd9feec2daaf5e809fa201c5`。启动记录中的 `.gitattributes`、`.gitignore` 用户修改保留，不进入提交；实际启动时未发现 AGENTS.md 文件。持有 `.git/aidlc-local-write.lock` 期间建立和提交任务工作树 `loeyae-aidlc-v2-mars255`，分支 `MARS-255-c8-applicability`。交付前复核主目录 diff/status、HEAD 与其他 worktree 记录，任务目录与用户目录分离。
