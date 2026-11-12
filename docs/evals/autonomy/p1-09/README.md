# P1-09 协议、续作与分发一致性验证

本目录记录源协议、Skill、CLI 和选定 Codex 分发的收口。实现与退出见 [P1 记录第 20/21 节](../../../aidlc-autonomous-implementation-p1.md#20-p1-09源协议skillcli与选定-harness-收口)，新增字段及控制边界见 [契约第 17 节](../../../aidlc-autonomous-contracts-v1.md#17-p1-09协议skillcli与选定分发一致性)。

## 交付行为

- 显式采用时加载同一自主实施协议：确定来源直接复用、普通工程选择自主处理、合法兜底记录后实现和验证；notify/none 不逐阶段询问继续。真实 block/choices、用户暂停/审阅、权限及全部质量门禁保留。
- Core 普通模块选择 API 保持不变；Codex 在正式路由候选中按已冻结 implement 顺序调度，处理多模块选择和单模块 binding-required，Core 再核对模块/单元范围。
- 实际 report 仍释放完成阶段 claim；宿主保留已完成全局协调 claim，报告后清空代码写许可、回到所持协调 binding 并经原 bind 续期，随后读取下一正式路由。不从状态构造凭据、不继承新 session 或延长 grant/wall budget。
- reconciled 的正常 next/exit-2 JSON 诊断送达原有有界修复分支；其他进程/命令失败、真实批准要求或未知退出不变成修复许可。
- 模板检查器保持封闭依赖图；共享契约作用域由 workflow-layout 统一提供给生产者、Native 门禁及复用计划，保留实际源码/嵌套仓库版本。

未采用 workflow 不增加 autonomous_execution/supplemental_protocols、grant 或 admission 要求，保持原路由、人工模块选择、report/Stop 和真实审批。

## 检查与原始记录

| 检查 | 记录 |
| --- | --- |
| 自主规则与实际 CLI 衔接 | 7 个场景；真实 notify next/report→协调 context/select，含凭据缺失/代次错误拒绝与旧模式兼容 |
| 宿主持续路由 | 32 个场景；冻结范围/同名前缀/未选单元拒绝、单模块绑定、多模块调度、block/choices 停止、诊断送达和有限刷新 |
| 宿主执行与凭据过滤 | 29 个场景，继续原 grant/工具前校验/预算/取消规则 |
| 规则与旧模式回归 | progressive rule loading、evidence reuse、legacy report/Stop、MARS-250/251/252 政策、输入范围、Operations 拆分 |
| P1-01～08 相关回归 | 采用/策略/授权/准入/依赖/Native gates、4 + 12 个批次结果场景、17 + 11 + 10 个实际功能/运行/UI 观察场景及相关类型/汇总/Provider 检查 |
| Skill 结构 | skill-creator quick_validate 对 Codex 入口、continuity、handoff 三个 Skill 检查；结果与运行路径见 skill-validation.json |
| 选定分发 smoke | 从 dist/codex 实际运行 copied tools；3 个双模式/协议/runtime 场景，结果见 distribution-smoke.json |
| 构建与一致性 | 十种 Harness 重建；按 manifest 核对 Core、宿主文件和无额外漂移；另读根项目旧模式 rules/结果，核对最终 checker 与 whitespace |

主回归共 **33 项不同检查**，由 run-verification.cjs 记录实际命令、退出码和日志。最终按 test-results-final.json → final-2 → final-3 → final-4 → final-5 选择同名检查的最新复验，封存脚本要求每项最终退出码为 0；完整过程的失败轮次仍保留。

最终所选 33 项主检查、三个 Skill 校验及三个选定分发 smoke 场景全部通过，十种 Harness 构建成功，**2948 文件分发一致性**通过。签名/原始引用与最终 checker 绑定已封存核对；根项目只读规则无自主补充字段，原 state/audit 哈希和授权/运行目录缺席条件保持。

EOF 空白清理只改变 Core 字节身份。为使引用收据绑定最终 checker，另外独立运行完整 UI 观察，并由 refresh-checker-evidence.cjs 重新运行功能、runtime/external、批次汇合及类型检查；其余行为检查采用已通过的同一语义版本记录。最终 checker、六组签名归档及原始引用必须再次一致才可封存。

build-verification.ps1 删除前核验绝对目标在 workspace/dist 内且无链接，使用原生 PowerShell 重建十种分发。run-final-checks.cjs 执行实际选定分发 smoke、parity、根项目只读检查和 whitespace。[verification.json](verification.json) 记录选中日志/源码摘要、实际退出码、Skill/CLI 衔接与分发结果、构建和签名/原始证据核验。[双轴审查](code-review.md) 分别给出 Spec 与 Standards 结论，不冒充业务项目 Native C7。

## 修复及失败处理

1. **实际报告后旧 binding 失效**：真实 CLI 检查暴露，修复为持有协调 claim 并在报告后按原 bind 续期；完成阶段 claim 仍释放，错误协调凭据继续拒绝。
2. **CLI 诊断被丢弃**：正常 next/exit-2 结构化诊断进入驱动，其他失败不降级；有界修复不解锁代码写入。
3. **旧模板隔离检查器拒绝新工作流依赖**：移出非模板依赖，没有放宽白名单；真实共享契约 producer→Native gate→reuse-plan 通过。
4. **夹具前置条件与状态隔离**：补齐明确模拟的 H3 前置行/布局选择；分发 smoke 清除跨项目 binding 后创建独立 legacy state。Core 拒绝原错误夹具的日志保留，没有将拒绝改成通过。
5. **Windows Chrome 启动 EBUSY**：第一次实际 UI 观察诚实失败，随后完整 UI 独立复验通过；原始失败和全部组合的复验均保留。P1-10 继续验证真实宿主运行稳定性。

## 证据边界与退出

notify-sequence.json 证明实际 Core 通知报告及后续控制衔接，没有逐阶段人类继续输入。H3 前置 completed 行/布局选择、操作端与接收 adapter 是显式协议夹具；32 个多阶段路由场景仍是路由夹具。它们与真实 Node/HTTP/Chrome、Native 生产者和签名批次结果分别记录，不能算成 Native 模型贯穿的完整业务试点。

orders-converged、orders-actual、publish-actual、runtime-actual、external-actual、external-preflight-actual 在本目录重新生成；H3/审查身份为夹具，实际命令、HTTP、截图及签名来源可按索引核验。只导出 fixture 公钥，不导出 issuer 私钥。归档是历史工程快照，不延长运行授权、服务或观察租期。

P1-09 的工程退出由最终封存确认。P1-10 仍需以新 HostRef/冻结输入/实际操作端完成 UI 与无 UI 两个完整真实宿主试点；P2 才验收重启与后继恢复。本轮不安装用户全局 Skill、不执行完整 npm test、不重跑 Native 模型探针，也不创建根项目业务授权或接管原 DeepSeek workflow。根 state/audit 哈希及授权/运行目录缺席条件由封存脚本验证。
