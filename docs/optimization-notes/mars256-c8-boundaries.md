# MARS-256 C8 noEmit 与原生 TAP 覆盖率边界

基线 `main 6a838c3768c863b2ace85601e0d55370587b523a`，版本保持 4.22.7。Windows / Node 22.23.2 / TypeScript 5.9.3。任务分支 `MARS-256-c8-boundaries`；不合并 main、不升级、不打 tag、不发布。

## 实现与真实验证矩阵

| 边界 | 实现 | 验收与阻断 |
| --- | --- | --- |
| TypeScript 仅用于无产物检查 | 批准的 native-node build 不适用政策保留。独立适配器解析真实 check argv、简单包脚本及 npm run 引用、JSONC tsconfig、本地相对继承；证明有效 noEmit。包、命令、政策与读取的配置/依赖锁/编译器实现共同绑定。producer、实际 sensor gate、public report 及重验共用 c8RoleBasis。 | 真实 `node <typescript/bin/tsc> --allowJs --checkJs --noEmit router.cjs` 和 `--project tsconfig.json` 均退出 0，C8 producer/gate 通过；真实类型错误阻断。包/批准来源、依赖锁增删变化、继承配置及 argv 漂移使旧证据失效。noEmit false、产物/声明/增量选项、prepare、未知选项/包装器、包式继承、references 等阻断。真实 TypeScript `--outDir compiled-out` 生成并核对产物，必需构建成功接受、真实编译失败阻断；混合模块不能借 noEmit 互相豁免。 |
| TAP 后原生覆盖率 | 先验证并分离 Node 原生覆盖率表，再按既有 TAP 规则核验唯一完整汇总，避免名为 tests 的目录被当成测试汇总。表有固定头尾、列、分隔线、百分比范围和唯一 all files 行，上限 10000 行/1 MiB。 | 真实 `node --test --test-reporter=tap --experimental-test-coverage tests/native.test.cjs` 退出 0，producer/gate/report 通过。嵌套 suite、多文件、部分 skip/todo 的实际覆盖率输出计数为 total 5 / passed 3 / failed 0 / skipped 2，不重复累计父子结果。重复 TAP/覆盖率、未知/截断尾部、第二份摘要、伪造计数/百分比均拒绝；真实失败、取消、全 skip/todo 仍阻断。默认 TAP 与旧数字摘要保留。 |

`tests/test_mars255_c8.ts --baseline-256` 在未修改的人类 main 上调用真实 producer，分别断言 noEmit 和原生 coverage 场景退出 2，复现原误拒绝。修复后的断言为成功产证及实际 gate 通过，并验证四种 public report：默认、noEmit、coverage、组合。各路径真实执行 I13 required、业务 RED、GREEN 和 C8 命令；既有已完成前置阶段由夹具准备，不声称从零运行全部工作流。

noEmit/组合路径还在产证后加入矛盾的 tsconfig.build.json，确认实际 gate 和 public report 拒绝完成；恢复来源后，用正常受控 evidence 命令重新生成 test-quality 观察，再完成 report。有效的 C8 命令证据复用，不伪造 build。测试不手写通过证据，不放宽失败/来源绑定规则。

## 实际命令与结果

以下命令在任务 worktree 执行，均退出 0（被测试的 CLI 负例断言退出 2，真实子命令失败仍阻断）：

| 命令 | 覆盖 |
| --- | --- |
| `npm ci --ignore-scripts` | 仅任务 worktree 安装锁定依赖 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars255_c8.ts --baseline-256` | 两项 main 真实 producer 复现、noEmit/coverage 正反例、真实 gate、I13/RED/GREEN、四种 public report |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars249_validation_policy.ts` | 无行为替代验证、producer/gate、历史 RED、观察复用、建议级 review |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars253_deletions.ts` | 六种删除 CLI 完成路径及来源/归属负例 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars252_policy.ts` | 36 个 notify 阶段及受保护 gate、来源/复用规则 |
| `npm run typecheck` | core、harness、scripts 类型检查 |
| `npm run build:all` | 九种 harness 生成 |
| `node node_modules/tsx/dist/cli.mjs tests/test_distribution_parity.ts` | 2292 份源码/分发、harness 文件及漂移检查 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars253_distribution.ts` | 117 份关键引擎/协议/阶段/技能/图副本 |
| `git diff --check` | 补丁格式检查 |

原始日志随 issue 附件交付。没有运行无关全仓 npm test、Provider 外部集成或已知存在旧 D8 基线失败的 engine suite，不将未运行项列为通过。不等待外部 CI。

## 契约兼容性与边界

角色声明继续使用 `native-node-role-policy-v1`；无 TypeScript 的旧声明不增加字段。新适配增加模块 `check_tooling` 来源摘要；旧默认三角色、业务非零成功测试、可信 I13 无行为替代检查、混合模块全集和命令选择约束保持。检查工具无法核实时明确拒绝例外；其他语言/构建工具仍沿用原边界。

Windows 上本轮真实执行入口是 `node <typescript/bin/tsc>`；包脚本和 npm run 引用由适配器静态解析，未宣称跨平台 npm 可执行发现已修复。没有增加运行时解析依赖、覆盖率阈值、覆盖率必需政策或重复测试要求。覆盖率格式在 Node 22.23.2 实测，未知 Node reporter 格式继续拒绝。

## 工作区保护

人类目录 `E:\Work\src\loeyae\loeyae-framework\loeyae-aidlc-v2` 保持 `main / 6a838c3768c863b2ace85601e0d55370587b523a`。入场实际只有 `.gitattributes`、`.gitignore` 未暂存修改；AGENTS.md 不存在。与启动快照比较完整 diff、暂存/未暂存/未跟踪状态及所有既有 worktree 注册/HEAD，保持一致。

持 `.git/aidlc-local-write.lock` 和历史 `.git/local-directory-write.lock` 独占句柄建立和提交独立 `loeyae-aidlc-v2-mars256` worktree；没有切换主目录分支、stash/reset/clean、操作其他 worktree 或写入 awslabs 上游。依赖、实现、测试、构建、暂存和提交均在任务 worktree。交付后释放本任务锁。
