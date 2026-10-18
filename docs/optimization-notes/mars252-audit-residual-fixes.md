# MARS-252：4.22.4 审计残留修复

基线：main `ad4ac9c363da73b5c1c1acead95e30fc218c1e01`（4.22.4）。版本不变；本任务不合并 main、不创建 tag、不发布。

| 项目 | 实现 | 验证 |
|---|---|---|
| 删除型交付 | 新增单元 `source-deletions.json`，核验 Git 删除范围、普通实质文本基线 blob、模块源码根、单元 req_refs、required I13 的 UC-D 归属及需求/行为来源；produce、consume、traceability-matrix、完成输出及审计共用验证 | 自动发现 route 的真实行为测试：RED 暴露 legacy，删除后 GREEN 仅 health；另一实例移除最后源码/根。均实际执行受控 producer 和 CLI report completed。消费、推进后完成范围复核、嵌套仓库及无修改/伪 blob/跨单元/缺行为/越界/忽略/二进制/占位/symlink 负例 |
| notify 正文与模板 | 修复 reverse-engineering、requirements-analysis、functional-design、nfr-requirements、nfr-design 的正文、结束提示、回答模板和审计记录；同步直接加载的 cross-validation 结束提示 | 系统扫描全部 38 个阶段：36 个 notify 不再含无条件“明确审批/确认前不得继续”；application-design 与 operations-authorization 保持 block。原 MARS-251 CLI 授权拒绝回归通过 |
| I13 无行为检查复用 | 阶段正文、I13 协议和两个直接相关技能明确成功执行或有效 reused_from/observation_id；输入/命令/scope/环境/I13/单元/世代漂移重跑；业务 RED/GREEN 独立执行 | MARS-249/250 的真实 producer、观察复用、漂移和绑定回归通过。未修改复用引擎 |
| 需求验证策略 | 最小/标准/全面深度分别明确适用范围；多视角检查先复用权威信息，未知项才提问，允许合并或结束；无批准政策时评分/覆盖率为建议，具体阻断项决定回退 | 静态策略回归；需求澄清、专业方法与深度引用链同步核对。保留验收标准、quality inventory、追溯、来源和真实决策要求 |

## 删除交付的兼容边界

- 原有新增/修改源码、无基线 fallback、ucd_exemption 和已完成单元范围语义保留。MARS-251 原删除负例已改为“无绑定证据的删除不能冒领交付”，并新增有绑定证据的正例。
- 删除清单路径与字段样例见 `core/stages/construction/construction-code-generation.md`。删除是业务行为变化，不能以无行为豁免跳过真实业务测试。
- 显式声明需要单元 manifest 的 req_refs、模块 requirements.md、required I13 的 ucd_units，以及按 UC-D ID 命名的模块内用例 Markdown；现有文件名不同的先规范到该路径。不自动猜测删除归属。
- 不把旧 blob 伪装成当前文件：基线内容只用于验证实质性和对象身份；移除需求由清单的需求/UC-D 映射承接。旧源码无需事先写入新删除需求 ID，旧 TODO 不作为当前可执行代码扫描。当前必要来源、受控 GREEN 和前置证据仍须可读且有效。
- 已批准阈值、用户明确要求审阅、真实未决决策、结构不变式及 block 节点继续阻断；通知或主观高分不能替代它们。

## 验证命令与最终退出码

下表中的测试均在任务独立 worktree 执行，依赖使用该 worktree 的 `npm ci --ignore-scripts --no-audit --no-fund` 安装（0），未修改主目录 node_modules 或全局配置。

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `node node_modules/tsx/dist/cli.mjs tests/test_mars252_deletions.ts` | 0 | 两条实际业务 RED → 删除型 GREEN → CLI 完成路径；消费/推进/嵌套和正反例通过 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars252_policy.ts` | 0 | 36 notify、2 block、需求深度和 I13 引用链通过 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars249_validation_policy.ts` | 0 | 适用性、历史 RED、观察复用、漂移及审查通过 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars250_policy.ts` | 0 | 真实 producer、scoped 观察、绑定和授权保护通过 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars251_policy.ts` | 0 | 修订后的源码正反例、UI 来源投影、真实路由/完成及强制审批拒绝通过 |
| `node node_modules/tsx/dist/cli.mjs tests/test_mars95_source_delivery.ts` | 0 | 6 组原源码 delta、归属、完成范围和 fallback 回归通过 |
| `node node_modules/tsx/dist/cli.mjs tests/test_construction_tdd_gates.ts` | 0 | 原 I13/RED/GREEN 完成门禁通过 |
| `npm run typecheck` | 0 | TypeScript 通过 |
| `npm run build:all` | 0 | 九种 harness 按仓库构建方式重新生成，graph 的审批政策未改变 |
| `git diff --check` | 0 | 无空白错误 |

另对 18 个受影响 core 文件的九种分发副本逐字节核对，162/162 一致（任务本地校验脚本退出 0）。未运行无关全仓测试，不等待外部 CI。

新增测试调试时出现的两类夹具错误（观察脚本未放在可识别的测试路径、推进夹具未标记 Baseline Source advanced）已修正；最终结果如上。未将其归因于基线引擎失败，也未声称运行过本轮未改动基线的完整测试。

## 仓库保护

入口与交付前核对：人类主目录保持 main/ad4ac9c，唯一用户改动为未暂存 `.gitignore`，diff 与入口记录一致，暂存区为空。任务描述曾提到 AGENTS.md，实际入口文件不存在，未创建、移动或删除它。

实施目录为主目录的相邻独立 `loeyae-aidlc-v2-mars252` worktree，分支 `MARS-252-audit-fixes`；修改、依赖、构建、测试和提交均在此处。持主目录 `.git/local-directory-write.lock` 的独占文件句柄串行写入；未切换主目录分支，未 stash/reset/clean，未清理其他 worktree，也未写 awslabs 上游。交付时释放本任务写锁。
