# P1-04 设计接收与自主实施准入验证

本目录保存工程验证，非活动业务 workflow 的受控证据、用户审批或真实业务验收。最终退出与源文件摘要以 `verification.json` 为准。

退出结论：P1-04 Core 工程检查通过；真实业务自主运行保持 not-ready。44 个 P1-04 场景（40+1+3）及表中回归通过，最终十种 Harness 构建成功、2825 文件一致性通过。DeepSeek 最终构建清理首次 EPERM、第二次成功，失败和成功日志都保留，未调整构建器或权限。

## 验证范围

- 设计接收：实际包索引、technical_review / development_acceptance 身份与摘要、UI 明确适用/基线/资源、未决问题与合法兜底。
- 预检：冻结计划、完整矩阵与 AC/UI 分母、真实有限 argv 命令、环境/数据/可执行文件、宿主原生探针协议。
- 准入：ready / ready-with-delegated-decisions / not-ready、签名受管 receipt/current、TTL/撤销/来源/checker/环境/有效决策失效。
- 首次实施：正式 native next、代码/测试工具检查、shared-contract-baseline/tdd/code-generation 的 session capture / publication，包含已采用但未签 grant 的负例。
- 连续实施：合法委托不反复人工批准，补写决策输出不使未变设计失效；真实缺项、冲突和未来能力不被记为通过。

## 最终命令

| 命令/范围 | 日志 |
| --- | --- |
| tests/test_autonomous_admission.ts | [40 个接收/准入场景](admission-verified.log) |
| tests/test_autonomous_admission_route.ts | [原生 CLI 首次实施拦截](admission-route-verified.log) |
| tests/test_autonomous_dependency_preflight.ts | [单实现单元、多单元、共享输入三项预检](dependency-preflight-verified.log) |
| tests/test_autonomy_scope.ts | [P1-01：44 场景](autonomy-scope.log) |
| tests/test_autonomy_policy.ts | [P1-02：55 场景](autonomy-policy.log) |
| tests/test_execution_grant.ts | [P1-03：48 场景](execution-grant.log) |
| tsc --noEmit | [最终类型检查（空日志表示无诊断）](typecheck-verified.log) |
| tests/test_mars243_sessions.ts | [会话及竞争](sessions.log) |
| tests/test_mars243_layout.ts | [拆分、暂停、过期及旧模式](layout.log) |
| tests/test_stage_handoff_prompts.ts | [handoff](handoff.log) |
| tests/test_delivery_summary.ts | [交付摘要](delivery-summary.log) |
| tests/test_provider_runner_gate.ts | [Provider Runner](provider-runner.log) |
| tests/test_mars160_execution_policy.ts | [阶段执行策略](execution-policy.log) |
| 10 Harness 构建 | [逐次退出码及日志](build-results.json) |
| tests/test_distribution_parity.ts | [最终分发一致性](distribution-parity.log) |
| git diff --check，保留 session.ts 的既有 CRLF | [空白检查](diff-check.log) |

[Spec/Standards 审查与修复](code-review.md) 分别保留两轴结论；不是另一个执行者或真实人类复核。先前 development / route / checker-refresh 日志保留，用于追踪夹具绑定修正、preview 与正式路由区分、CLI 错误输出读取及实现边界复验；不把失败日志覆盖为通过。

## 未由本轮验证的内容

终端批准使用模拟 TTY/输入，原生宿主 adapter 使用测试替身；Node 夹具断言真实执行，但不等于“发布页面”或“订单分页”的真实业务实现。UI 案例验证必要浏览器观察不可缺失，不证明页面还原已完成。

默认 CLI 尚未接入 P1-06 原生模型/工具/持续会话/预算适配器，必要能力未知时保持 not-ready。多单元、split、consume/verify、能力版本、共享输入及依赖语义等待 P1-05，未通过声明自动提升就绪。P1-07/08 仍须实现实际业务/UI 断言、候选和最终完成；真实试点资源/服务/UI 基线及实际运行 grant 尚未准备完毕。

Core 的工具前和发布检查依赖宿主正确执行操作分类、权限隔离与取消对账；不声称已实现任意 OS 命令的进程 Supervisor 或对恶意本地控制者的防护。未运行完整 npm test、真实宿主连续驱动、业务试点、浏览器或中断恢复。

当前仓库未签发业务 grant 或创建 issuer，原 DeepSeek workflow 的 state/audit 保持原 SHA-256；实际值与存在性检查写入 verification.json。
