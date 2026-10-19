# MARS-257 noEmit 最终有效语义

基线 `main ecf30f7346efb2bf7830c0a0eb9b4290aca09e17` / 4.22.8。Windows、Node 22.23.2、实际 TypeScript 5.9.3。任务分支 `MARS-257-noemit-semantics`；保持版本，不合并 main、不打 tag、不发布。

## 实现与兼容边界

`nativeNodeCheckTooling` 使用选定本地 TypeScript 的 `parseCommandLine`、`readConfigFile` 和 `parseJsonConfigFileContent`，解析实际命令、JSONC、本地相对继承与 CLI 覆盖后的最终选项。删除合并前的输出字段拒绝和包目录全量 tsconfig 扫描。选项诊断来自真实编译器解析器；真实命令仍执行并检查退出码，解析成功不等于类型检查成功。

最终 `noEmit: true` 抑制 JS、声明与映射文件；保留 `outDir`、`outFile`、`declarationDir`、`declaration`、`emitDeclarationOnly` 等合法设置。单独的 `tsBuildInfoFile` 是路径，不据此认定产物；TypeScript 5.9.3 的实际 noEmit 检查接受该组合且不写文件。`incremental`/`composite` 仍可能写 build-info，独立 trace/profile 也不受 noEmit 抑制，继续拒绝构建豁免。build/watch、references、无法核实的继承/响应文件/包装器和真实类型错误继续阻断；showConfig/help/listFilesOnly/noCheck 不得冒充检查。

受控 npm 脚本先带入实际转发的参数，再判定最终选项，避免先把脚本的基础配置判为 emit。其他声明的 TypeScript 流程仍接受分析；真实 build/prepare/generate 脚本和未决工具归属继续阻断例外。闲置配置可存在，甚至其语法与当前检查无关，但正常 source revision 绑定不变：新增或编辑源配置可能使旧证据过期，重新执行后无需虚构 build。

角色政策继续为 `native-node-role-policy-v1`。producer、sensor gate、public report 和重验沿用共同 `c8RoleBasis`。实际消费的配置和继承、锁文件、包政策、argv、编译器 CLI 及新增的 `lib/typescript.js` 解析 API 字节共同绑定；`@execution-context` 绑定运行时和环境摘要，采用已有声明变量/默认保守环境契约且不泄露值。环境变化使旧 noEmit 证据失效；会话令牌不参与该摘要。无 TypeScript 的旧角色声明不增加字段。未取消真实构建、混合模块、命令全集、非零业务通过数和失败防护。

本适配器明确支持可定位的 TypeScript 5.x；其他版本诊断为待核实，不声称跨版本已验证。无需新增引擎运行时依赖，解析 API 从项目所选编译器加载。Windows 的真实执行入口为 `node <typescript/bin/tsc>`；npm 参数展开有适配器断言，不声称已解决 Windows npm 可执行发现。其他语言与工具仍沿用原边界。

## 真实验收矩阵

| 场景 | 实现及验证边界 |
| --- | --- |
| 原问题 `noEmit:true + outDir + declaration` | 用原组合直接运行真实 tsc；producer 和实际 gate；核对输出目录/声明/映射/build-info 均不存在 |
| 无输出配置、共享输出配置 | 保留原 JSONC/无产物检查；共享 outDir/declaration、declarationDir/maps、outFile/system、emitDeclarationOnly 组合直接运行编译器并核对磁盘 |
| CLI 与继承 | CLI noEmit 覆盖配置 false；本地继承 false 后最终 true；CLI 输出选项被 noEmit 抑制；继承 incremental true 后最终 false 无副产物 |
| 真实副产物 | 真实 incremental 与 `--build` 均观察 `actual.tsbuildinfo` 存在，随后 producer 拒绝豁免；测试仅清理该夹具副产物 |
| 仅 build-info 路径 | 真实 tsc 退出 0、不写文件；producer/gate 接受，不使用字段存在替代语义 |
| 闲置配置与实际流程 | 闲置输出配置及未消费的非法 JSON 不强迫构建；修改后旧来源证据拒绝、重新产证接受；将其接入真实 build 脚本则拒绝豁免 |
| 发射、失败与歧义 | 最终 noEmit false、真实类型错误、未知参数/包装器/包式继承、references、prepare 等拒绝；保留真实 TypeScript 编译产物成功及失败构建断言 |
| 来源绑定 | 配置/本地继承字节、包政策/批准引用、依赖锁增删、argv 和配置摘要变化使旧证据失效；实际 gate/public report 均复核 |
| public report | 默认、noEmit、coverage、combined 四条原路径及新增 CLI 覆盖、继承路径；真实 I13 required、业务 RED/GREEN、C8 producer/gate/report；noEmit 路径实际使用带输出设置的配置；消费配置漂移阻断完成，恢复后复用原有效 C8 execution |
| 历史保护 | MARS-249 适用性、真实 producer/gate、环境变化和观察复用；MARS-253 六种删除完成路径、基线/归属漂移；MARS-252 36 个 notify 阶段政策；原 TAP/coverage 正反例和混合模块构建保护 |

public report 夹具准备必要已完成阶段，不声称从零执行所有工作流。失败/取消/全 skip 或 todo 测试、截断/重复/矛盾 TAP 与覆盖率仍拒绝。未增加覆盖率阈值或全量测试要求。

## 验证命令

以下最终验证命令均退出 0；结果清单与原始日志随 issue 附件交付。测试中的负例按实际 producer 退出 2 或实际 gate/report 拒绝断言，不把预期拒绝算作产品成功执行：

| 命令 | 目的 |
| --- | --- |
| `npm ci --ignore-scripts` | 任务 worktree 独立安装锁定依赖 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars255_c8.ts` | 上述真实编译器、产证、gate、六种 public report 与历史 C8 保护 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars249_validation_policy.ts` | 适用性、环境变化、历史 RED、复用 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars253_deletions.ts` | 六种删除完成路径及基线/来源/归属负例 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars252_policy.ts` | 36 个 notify 阶段与受保护门禁 |
| `npm run typecheck` | core、harness、scripts 类型检查 |
| `npm run build:all` | 按仓库方式生成九种 harness |
| `node node_modules/tsx/dist/cli.mjs tests/test_distribution_parity.ts` | 2292 份分发与源码一致性 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars253_distribution.ts` | 117 份关键引擎/协议/阶段/技能/图副本 |
| `git diff --check` | 补丁格式 |

测试开发中曾假设“只有 tsBuildInfoFile 路径但没有 incremental 会退出 2”，实际 TypeScript 5.9.3 返回 0，相关中间测试退出 1。已用编译器实测结果修正为无副产物正例。另一次在调整适用性绑定期间的中间运行因旧证据不匹配退出 1；固定实现后重新执行完整扩展套件，六种 public report 全部通过、最终退出 0。两个中间运行不计为验收通过，日志一并保留。原审计的退出 0 仅表示复现缺口，本任务不以它替代修复后的正向验收。

不运行无关全仓测试、外部 Provider 集成或已有旧 D8 基线失败的 engine suite；这些未验证项不计为通过。不等待外部 CI。

## 工作区保护

持 `.git/aidlc-local-write.lock` 和 `.git/local-directory-write.lock` 独占句柄建立、修改、验证和提交相邻独立 worktree `loeyae-aidlc-v2-mars257`。人类主目录保持 `main / ecf30f7346efb2bf7830c0a0eb9b4290aca09e17`；实际入场是 `.gitattributes`、`.gitignore` 未暂存修改，AGENTS.md 不存在。用户改动不进入任务提交；不切主目录分支，不 stash/reset/clean，不修改主目录 node_modules 或其他 worktree。交付前按启动快照复核 HEAD、分支、完整 diff、暂存/未暂存/未跟踪状态及所有既有 worktree 注册，结果随附件记录。交付后释放本任务锁。
