# P1-09 Spec / Standards 审查

模式：`INDEPENDENT_DUAL_AXIS`，状态：`DONE`。由同一 Codex 宿主分别形成两轴结论，没有另起独立 Agent；本维护记录不替代业务 workflow 的 Native C7/审批/完成证据。

输入：总体设计 P1-09 及 P1-AC-02、contracts-v1 第 17 节、原 session/grant/publication 与证据约束；本轮协议/Skill/阶段正文、Core 指导与作用域、Codex runtime、测试和选定分发差异；33 项主检查、真实 CLI 衔接、三项 Skill 校验、十种构建、实际 shipped CLI smoke 和 parity。具体版本、选中日志、实际退出码和原始证据以 verification.json 的 SHA-256 为准。

## Spec Axis

| 检查 | 结论 |
| --- | --- |
| 自主模式不逐阶段人工继续 | 共享协议、实际 directive 与补充规则计划一致；真实 notify 报告后返回有效协调 binding，多阶段路由夹具连续执行 |
| 人类交接程度与委托 | H1–H3 明确有限范围/硬约束/全部分母；确定来源复用，工程细节自主处理，合法 policy/fallback 记录后实现与验证；pending 复核后置，真实冲突不伪装兜底 |
| 未采用兼容 | 不注入自主字段或 grant/admission 要求，保留原路由/人工模块选择/report/Stop；真实 CLI 及 shipped CLI 双模式验证 |
| 范围与真实审批 | 单/多模块调度只选择正式路由的冻结 implement；同名前缀、未来/未选单元拒绝；block、真实 choices、暂停和权限保持阻断 |
| 完整验收与结果 | I13/TDD/审查/UI/C8、完整矩阵、当前候选和受控 BatchResult 不降级；scope-exhausted/final/观察 passed 不决定批次完成 |
| Core / 宿主边界 | 指导与校验归 Core；连续 turn、工具前执行、预算/取消与协调 binding 由原 Codex 宿主负责，无新增 Core Supervisor |

Spec：通过。真实 Native 模型贯穿 UI/无 UI 完整批次仍留 P1-10，本记录不将协议夹具或实际 CLI 单段衔接升级为完整试点。

## Standards Axis

| 检查 | 结论 |
| --- | --- |
| 凭据与领取 | 原 report 释放语义保留；实际持有协调 owner/session/generation 才可复用/续期，缺失和错误代次拒绝，不从 state 生成凭据 |
| 授权与期限 | 每次工具/发布仍复核 grant；claim 续期不延长 grant/wall deadline，旧/撤销/转交/暂停不自动恢复；模型不能批准、转交或签发授权 |
| 私有控制面 | 协调 binding 仅在宿主内存与本进程环境；modelProjection 过滤，报告后清空 readyInstance，新精确正式阶段才开放代码写入 |
| 错误与重试 | 仅正常 reconciled next/exit-2 JSON 诊断保留；进程/非 JSON/其他命令失败不当作修复许可，Native 刷新保持有界且无源码许可 |
| 隔离检查器与来源 | 非模板工作流解析移到 workflow-layout；原封闭依赖图/白名单保留，contract-baseline 的 producer/gate/reuse 使用一致 sensor scope 和实际嵌套版本 |
| 规则与分发 | 可选补充字段保持旧输出；Skill 描述/命名/metadata 经正式校验；manifest 驱动十种分发，选定 copied tools 实际执行，未推导其他宿主已适配 |
| 证据与维护范围 | 原始失败/复验分开保留；EOF 身份变化后重新生成引用收据，不挪用旧身份；根 workflow 保持，不全局安装或新增业务授权 |

Standards：通过，未发现未解决的关键或重要问题。

## 修复复核

- **诊断未到达驱动**：修复真实 CLI exit-2 传递；实际 CLI 错误与取消/未知/其他命令负例，以及诊断送达有界刷新均通过。
- **成功报告后使用已释放 claim**：保留全局协调 claim，报告后用所持真实 binding 通过原 bind 续期；实际 report→context/select、工作 claim 释放和错误协调凭据拒绝通过。
- **已冻结模块仍要求人类选择/单模块无法绑定**：宿主处理 module-selection 及 binding-required，Core 再检查模块/单元；正反路由通过，普通 Core API 与旧模式保持。
- **模板检查器被自主依赖导入污染**：移出工作流专用分支，没有新增白名单例外；真实模板 producer、隔离/输入范围政策，以及共享契约 producer→主门禁→复用计划通过。
- **夹具跨项目 binding 与 EOF 空白**：Core 的正确拒绝保留；修正夹具隔离，清理字节并重建/刷新签名，实际 shipped CLI 双模式和 whitespace 最终通过。

曾发生一次 Chrome DevToolsActivePort 启动文件 EBUSY，观察如实 failed；完整 UI 单项复验及最终身份刷新均通过，日志保留。真实宿主长时工具稳定性仍属于 P1-10 试点观察范围。未运行完整 npm test、完整 Native 模型业务试点或 P2 恢复验证。
