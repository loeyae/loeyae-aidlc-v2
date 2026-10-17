# MARS-244 验证记录

生成时间：2026-10-17T15:33:01.910Z。基线：main a6329d6，版本保持 4.21.0。

## 最终结果

类型检查通过；既有 build 生成九套 dist；22/22 定向验收通过，包含 distribution parity。最终命令与原始日志随议题附件交付。未执行全量 npm/Maven 回归，未等待远端 CI。

| 验证 | 命令 | 退出码 |
|---|---|---|
| typecheck | `node node_modules/typescript/bin/tsc --noEmit` | 0 |
| build | `node node_modules/tsx/dist/cli.mjs scripts/build.ts --all` | 0 |
| acceptance | `node node_modules/tsx/dist/cli.mjs tests/run_mars244.ts` | 0 |

## 定向矩阵

| 套件 | 退出码 | 耗时（秒） |
|---|---|---|
| test_mars244_boundary | 0 | 6.8 |
| test_mars244_migration | 0 | 30.0 |
| test_mars244_writes | 0 | 12.0 |
| test_mars244_scope | 0 | 8.3 |
| test_mars244_publication | 0 | 15.6 |
| test_mars244_review | 0 | 13.0 |
| test_mars243_sessions | 0 | 9.1 |
| test_mars243_stop | 0 | 1.8 |
| test_mars243_layout | 0 | 7.3 |
| test_mars243_report | 0 | 2.2 |
| test_mars160_execution_policy | 0 | 0.7 |
| test_construction_tdd_gates | 0 | 22.5 |
| test_i13_case_root | 0 | 2.1 |
| test_i13_executable_behavior | 0 | 17.3 |
| test_v4_5_4_engine_defects | 0 | 126.0 |
| test_orchestrate_upgrade | 0 | 11.0 |
| test_ui_generation_governance | 0 | 16.9 |
| test_mars159_ui_freshness | 0 | 22.7 |
| test_mars169_document_slices | 0 | 29.0 |
| test_mars161_execution_profile_phase4 | 0 | 13.7 |
| test_mars161_execution_profile_phase5 | 0 | 6.4 |
| test_distribution_parity | 0 | 0.7 |

## 验收覆盖

- 38 节点图、旧缓存图诊断兼容、正式 next directive 无执行拓扑字段；顶层流程契约保留。
- 任意子代理成功/失败日志均不参与门禁；reviewer-required、两轴审查和 I13 保留。
- 单/拆分布局旧检查点的未完成、已完成、parked、缺 Current Instance 的兼容迁移；真实 report 缺证据仍阻断，兄弟工作流及历史日志字节保持。
- UI 六类独立写入及切片 generate/recover --apply 的旧 session 拒写、同 owner 换 session、新 session 合法写入与只读入口。
- UI/切片在计算中途真实转交后发布失败；多文件重基线注入故障后锁、验收、checkpoint 回滚并可重试。
- 无关模块/单元及兄弟业务元数据不使当前证据失效；当前源码/测试、共享契约、锁文件和依赖单元变化使其失效；忽略的范围声明仍绑定；旧声明保守退回模块范围。
- 真实受控审查在无关模块提交后可复验，真实共享变更与旧 scope 不兼容仍拒绝；producer、摘要格式、身份与 ancestry 拒绝路径保留。
- MARS-243 会话、Stop、拆分状态、report/checkpoint，RED/GREEN 和 I13 既有回归通过；已完成阶段定向 re-attestation 保留 parked 状态。

## 验证边界

全部功能测试使用临时 Git 项目和本地故障注入。没有操作真实业务模块 m02/m06/m11，没有验证生产 Figma/宿主/MCP 登录或外部设计操作；fixture 成功不代表生产操作成功。未提升版本、升级本机宿主、修改个人 MCP、合并 main 或发布包。

代码与迁移说明见本分支；GitHub PR 创建仍需可用登录凭据，不能把 compare 链接或本地描述当成已创建 PR。
