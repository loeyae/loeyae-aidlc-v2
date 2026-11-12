# P1-04 工程变更审查

状态：DONE（工程审查通过；不代表真实批次运行已准入）。

- 模式：INDEPENDENT_DUAL_AXIS，分别形成 Spec / Standards 结论；同一宿主执行，不声称独立人类或另一个 Agent 审查。
- 范围：AdmissionPlan、接收/命令预检、三态结果、签名 receipt/current、首次 next / 工具 / 发布拦截、规则和专项测试。
- Spec：总体设计第 9/10/13 节、contracts-v1 第 6 节、P1-03 grant/session 边界，以及本轮用户 P1-04 请求。
- Standards：现有精确领取、受控证据签发、来源/有效期/checker 绑定、有限命令、显式采用及旧流程兼容规则。
- 证据：[接收/准入场景、引用契约及 checker 缓存边界复验](admission-verified.log)、[实际 native next 拦截](admission-route-verified.log)、[三项依赖预检](dependency-preflight-verified.log)、[类型检查](typecheck-verified.log)、同目录 P1-01/02/03 和原生回归日志。
- 本文件是仓库工程审查记录，不是活动业务单元 C7、正式受控 review-evidence、审批或业务质量通过凭据。

## Spec Axis

结论：P1-04 Core 范围符合设计，工程检查通过；P1-05/06 的接入和真实批次运行仍未就绪。

1. 接收计划在批次授权前冻结，复用实际 canonical package / development_acceptance / technical_review，不创建替代业务账本。
2. 同一硬检查清单决定三种结果，委托复核与实施完整性分开；未知能力、缺少 UI 基线或浏览器、实际命令失败均不通过。
3. 首次测试代码、共享声明物化和 GREEN 均在受控路径校验；preview 只作 planned 建议，正式 next 和发布不会据此放行。
4. 凭据由 Core 签发且实时复核；来源、命令、有效设计、环境、checker、能力期限、授权变化失效。补写决策输出不改变设计准入分母或触发无关重跑。
5. 默认 CLI 缺少可信原生宿主适配器时保留 unverified/not-ready。复杂依赖、多单元、split、共享输入等待 P1-05；业务/候选/UI 运行验收等待 P1-07/08。没有把接口夹具当成这些接入已经完成。
6. 既有 I13、RED/GREEN、UI bridge、review、C8 继续独立执行；receipt/business_verified=false 不覆盖其要求。

## Standards Axis

结论：重要问题已修正并经复验，未发现剩余阻塞 P1-04 Core 提交审阅的重要问题。

| 问题 | 级别 | 修复与复验 |
| --- | --- | --- |
| 只检查 execution_grant_version 的旧 early-return 会漏掉“已采用、未签发”的首次实施 | 重要 | pure grant guard、公开操作检查、session capture 和受控状态/发布入口同时覆盖；实际三种实施阶段 publication 与 native next 负例通过 |
| 将 functional-design 一并作为实施入口会阻塞准入前的设计接收 | 重要 | 实施入口收敛为 shared-contract-baseline/tdd/code-generation；设计准备和合法决策记录可先进行 |
| 结束时才采集环境或 checker 身份会把预检中漂移重新绑定为当前 | 重要 | 预检前采集，提交锁内复核；源文件/环境在途变化返回 not-ready，不发布凭据 |
| 单纯补写决策输出也使整批准入失效，会干扰持续实施 | 重要 | 指纹覆盖有效设计/返工语义，排除已知输出记账字段，未知字段保留；专项中的输出追加与新有效决策分别复验 |
| 外部领取可在预检结束、签发前发生变化 | 重要 | 固定 workflow 锁顺序后重读所有领取冲突；消费时继续检查当前全局实现领取 |
| 无效计划仍可能调用原生探针 | 重要 | 范围/授权/环境前置检查失败不调用 adapter；普通 passed authoring 与无 grant run 不产生凭据 |
| 非法计划及在途变化原先可能丢失三态投影 | 重要 | 保留 not-ready、具体 failed/unverified 检查和 publication_error；预览不写入 |
| 调用方 memoization 可能缓存 checker 身份，遮蔽后续内容变化 | 重要 | 接收前、发布前、签发和消费均强制 fresh digest；在独立安装副本内修改 checker，不修改当前源码，用回归验证缓存不能绕过 |
| 观察对象和引用列表混用会破坏 receipt 数据契约 | 重要 | environment_refs / capability_probe_refs 保持已验证 InputRef 数组；完整 host_observation 单独保存，专项正例核对字段类型 |

检查了相对路径/链接、闭合字段/重复项、摘要/签名、TTL/撤销、固定锁顺序与授权重读、输出缓冲/超时和命令 argv。receipt 限制为受管读取器可读的 2 MiB；错误不通过更新时间或 raw JSON 自动转为成功。未改构建器、放宽权限或偷取未知锁。

## 实际边界

Core 校验可信宿主 adapter 提交的原生观察，不靠业务 JSON 证明模型或浏览器能力；适配器的实际探针、工具副作用分类、执行隔离和取消/预算执行属于 P1-06 宿主职责。当前测试 adapter 和模拟操作终端只验证协议消费，不能声称实际 Codex/Claude/浏览器或真人批准已验证。与 P1-03 相同，本地 issuer 依赖可信 OS 用户和控制目录，不声称抵抗拥有完整本地控制权的恶意程序。

完整 npm test、两个真实业务试点、实际宿主连续驱动、真实 UI 还原及重启恢复不在本轮已通过证据中；分发构建/一致性在本目录另列结果，不替代业务门禁。
