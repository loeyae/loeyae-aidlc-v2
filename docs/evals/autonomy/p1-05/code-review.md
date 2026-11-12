# P1-05 工程变更双轴审查

状态：DONE，Spec / Standards 工程审查通过；不代表真实业务运行准入或完整 P1 已通过。

模式：INDEPENDENT_DUAL_AXIS，同一宿主分别检查 Spec / Standards，不声称独立人类或其他 Agent 审查。依据为用户 P1-05 请求、总体方案多单元/批次设计、contracts-v1 第 3/13 节、原生 claim/grant/evidence/source-scope 规则。范围包括新 dependency controller/pure inputs/native checker、准入与 grant/session/publication/native 路由、来源投影、契约扫描、规则/CLI 与专项测试。工程维护不推进当前业务 workflow；本记录不是 C7 或受控 review-evidence。

## Spec Axis

结论：P1-05 Core 范围符合设计，专项 40 场景及相关准入/兼容验证通过。

逐项核对：显式 v1 与旧模式隔离；真实 UnitRef/split 与能力版本；consume 固定证据/verify 实际检查；可达分阶段 checkpoint；不同依赖类型不互换状态；输入传递与缺失时 module fallback；写 Owner/共享串行；P1-04 dependency-readiness 与实际消费复查；scope-exhausted 不推导项目/批次完成。

P1-05 不实现通用 Supervisor、真实宿主 Adapter、runtime/external 生产者、独立能力级前沿或最终批次候选终态。保留这些未验证状态，依赖规划准入不等于消费者已解锁。UI/功能完整性仍须原 Native gates 与 P1-07 的实际业务观察，不能因本步检查通过而减小分母。

## Standards Axis

结论：已定位的重要问题均已修复并复验；类型检查、相关回归及最终分发一致性通过。

核对路径/链接/控制目录、封闭字段与重复项、摘要/来源/checker/命令/时效、真实 Native 生产者消费、锁内重读、活动 claim、有限子进程及旧模式兼容。纯 grant-store 只引入纯输入/冲突函数，不引入工作流写控制器；复杂 Native 校验通过受限只读子进程复用已有门禁，不在 Core 新造模型运行器。

| 问题 | 级别 | 修复与证据 |
| --- | --- | --- |
| 跨单元消耗证据可形成批次 EvidenceRef 自摘要环 | 重要 | 显式 v1 来源投影只排除 batch 记账，保留正文/非 batch；采用/授权仍绑定完整批次，真实 consume 正例及漂移负例 |
| 缺少完整输入声明时不能安全缩小 scope | 重要 | 保留模块范围/串行，跨单元输入和共享输入传递；boundaries 的 fallback/ownership/cycle 场景 |
| 旧契约匹配绝对目录名使普通业务文件误入契约 | 重要 | 仅 v1 项目相对路径匹配并支持 .schema；实际 C5 在私有实现变化后仍可消费，共享输入改变后拒绝 |
| 私有写范围可覆盖共享 Owner 边界 | 重要 | 全部私有/共享范围做交叠检查；private-shared 场景拒绝宽 src 私有声明 |
| 把普通 JSON passed 或 invented GREEN 字段当作就绪 | 重要 | 使用实际 Native 生产者/现有 schema 与 gates；workflow 身份显式进入新证据，伪造外壳拒绝 |
| 已耗尽的选定单元链可能将整个项目写为 done | 重要 | scope-exhausted 明确未完成且不写 state/audit；实际 next 负例 |
| 备用 handoff 来源仍将 batch 记账当作提供者源码 | 重要 | 显式 v1 同时投影 scenario-module-mapping 与 handoff，保留 policy/非 batch records；新增 handoff 来源投影场景 |
| Windows 同一路径不同大小写可避开写范围交叠比较 | 重要 | Windows 使用大小写无关身份比较，同时拒绝不同大小写的控制目录；新增平台语义场景 |
| 无 v1 标记的旧契约检查提前读取严格单元清单 | 重要 | 先检查目标单元显式 marker，只有新模式进入严格清单/新 scope；旧 checker-scope 失败记录保留并复验 |

最终复验见 dependencies-reverified.log、boundaries-reverified.log、admission-reverified.log、checker-scope-reverified.log、typecheck-reverified.log 及 verification.json 所选的其他成功结果；20 项不同检查通过。十种 Harness 构建完成，distribution-parity.log 确认 2855 文件一致。Windows 生成目录占用通过验证边界后原生 PowerShell 清理恢复，没有修改构建器或权限；失败构建/清理尝试记录在 build-results.json / cleanup-results.json。

## 验证适用边界

测试使用隔离临时 Git 项目、模拟终端批准、测试专用 AdmissionHostAdapter，Native GREEN 执行真实 Node 断言；review 文本是协议夹具。它们不证明真实业务、原生模型/浏览器、真人批准或实际重启恢复已通过。没有扩大当前业务运行权限。生产工具直接写入覆盖、串行/预算执行与进程取消对账须由 P1-06 宿主接入；P1-07/08 负责实际运行和候选闭环。

