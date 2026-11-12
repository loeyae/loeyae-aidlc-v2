# P1-05 验证记录

本目录保存多单元依赖、能力版本、consume/verify、共享输入与写范围、P1-04 dependency-readiness 接入的工程验证。依据为用户明确授权、总体设计、contracts-v1 第 13 节及 P1 实施记录第 12/13 节。所有日志保留真实退出码；本目录不是受控业务 evidence、实际运行授权或业务审批。

## 最终检查

| 检查 | 结果与日志 |
| --- | --- |
| P1-05 主要行为 | [20 场景通过](dependencies-reverified.log)：计划准入/消费点阻塞、实际 C5、实际 GREEN/review、固定 consume 版本、角色/写范围、输入失效与伪造证据负例 |
| P1-05 边界 | [20 场景通过](boundaries-reverified.log)：阶段环/后置 runtime 环、外部依赖未验证、module fallback、共享串行、split、局部 stub、双来源投影、Windows 路径、scope-exhausted |
| P1-04 准入 | [40 场景通过](admission-reverified.log)；[首次 native 路由](admission-route-verified.log)；[3 项依赖预检](dependency-preflight-verified.log) |
| P1-01/02/03 回归 | [44](autonomy-scope-verified.log) / [55](autonomy-policy-verified.log) / [48](execution-grant-verified.log) 场景通过 |
| Native 会话/拆分/交接/交付摘要 | [sessions](sessions-verified.log)、[layout](layout-verified.log)、[handoff](handoff-verified.log)、[summary](delivery-summary-verified.log) 通过 |
| Runner/原授权/Native I13 RED GREEN | [runner](provider-runner-verified.log)、[execution-policy](execution-policy-verified.log)、[TDD gates](tdd-gates-reverified.log) 通过 |
| 证据与来源兼容 | [sensor inputs](sensor-input-scope-reverified.log)、[旧契约 checker](checker-scope-reverified.log)、[revision scope](revision-scope-verified.log)、[unit code refs](unit-code-refs-verified.log) |
| TypeScript | [tsc --noEmit 通过](typecheck-reverified.log) |
| 全部 Harness 构建及分发 | [十种构建成功](build-results.json)，[2855 文件 / 10 Harness 一致性通过](distribution-parity.log) |

[verification.json](verification.json) 选择每项最新成功结果，保存 20 项不同检查、构建的每次尝试、日志摘要、源码摘要及当前工作流保全检查。[双轴工程审查](code-review.md) 分别记录 Spec/Standards 与修复复验。

## 测试事实与限制

测试在独立临时 Git 项目执行，使用模拟操作终端批准和测试专用 AdmissionHostAdapter。依赖正例调用现有 Core Native evidence producer；GREEN 实际执行本地 Node 断言，reviewer 文本为协议夹具。它们不能证明原生模型/浏览器、真人批准、真实业务试点、实际 UI 还原或宿主持久驱动已验证。

保留 development 日志以及首轮 test-results.json，其中旧 checker-scope 在无 v1 标记时提前进入严格单元清单而失败；已修复并以 test-results-reverified.json 复验。首轮额外完整 unit-ucd-scope 工作流套件在完成前中止，cancelled=true，未计入通过。未运行完整 npm test；实际相关 Native I13/RED/GREEN、单元 code refs、revision/sensor 及会话兼容结果如上。

采用快照/实际 grant 仍绑定完整范围；依赖计划准入不等于消费就绪。runtime/external 当前保持 unverified，真实工具执行前拦截由 P1-06 宿主接入，P1-07 负责运行与业务/UI 观察，P1-08 负责候选绑定及批次终态；完整能力级调度仍留后续阶段。Core 无法拦截宿主任意直接文件写入。

分发阶段出现 Windows EPERM/文件占用，原构建器重试后对剩余生成目录采用原生 PowerShell 清理。每次递归清理前验证绝对目标位于本工作区 dist 且无 reparse points，未修改构建器/权限；全部构建退出码与清理恢复见 build-results.json / cleanup-results.json。

没有领取、推进或修改当前无关 DeepSeek workflow，没有在当前项目创建 grant、issuer/key 或 admission receipt。state/audit 与 P1 记录第 4 节一致，最终哈希见 verification.json。session.ts 保留原 CRLF；空白检查使用 git -c core.whitespace=cr-at-eol diff --check，避免把原文件 CRLF 误记为空白变更。共享契约规则提到的旧 .claude/workflows/aidlc-construction-batch.js 在本仓库不存在，未声称验证仓库外旧适配器。

