# P1-03 代码审查

| 项目 | 内容 |
| --- | --- |
| 状态 | DONE：本次 Core/操作终端工程范围复核通过，无未修复的关键/重要问题 |
| 模式 | INDEPENDENT_DUAL_AXIS；Spec 与 Standards 分开形成结论，同一宿主执行，不声称独立人员或子 Agent 审查 |
| 范围 | grant store/controller、纯来源解析、state/session/decision/evidence/Provider/CLI 发布入口、规则与分发 |
| Spec | 总体设计 P1-03；契约 v1 第 5 节，包含第 5.3 节实际实现与信任边界 |
| Standards | 既有精确 claim/CAS、同锁发布、版本化可选采用、真实来源、密码学完整性与诚实证据 |
| 影响域 | 授权、工作流状态、共享业务记录和受管证据发布；不新增模型驱动，不放行质量门禁 |
| 证据 | [实施记录](../../../aidlc-autonomous-implementation-p1.md)、[验证清单](verification.json)、同目录原始日志 |

## Spec Axis

结论：PASS，限于单会话 Core 授权和可信操作端约定下的终端入口。

- 请求与签发分开：只有进程内批准对象可被消费，普通 JSON/AuthorityRef/Provider 不等于批准；签发前重新生成并比较实际作用域。
- 批次、policy、源摘要、HostRef、项目血缘、会话、允许操作与有限期限绑定；普通状态保存不能增加或移除运行模式。
- 每次受管发布在工作流锁及自主控制锁内检查来源、撤销和领取；阶段 generation 可更新，但同会话约束与原到期时间不变。
- 过期、撤销、新 session/host、越界单元/路径、权限不一致均拒绝；同项目 split 参与者仍逐个拥有实际 claim。
- 撤销独立于失效的运行凭据；工作树撤销记录与 Git 中锚点一致校验，不因删除工作树 JSON 恢复权限；重复撤销不再索取确认。
- 原生 release/park 是控制面降权；grant 不自动恢复用户暂停，不替代审批、准入或功能/UI 门禁。
- host 需真实复核工具目标、执行预算与取消/对账；未把 operator-terminal 声称为人类身份认证或原生 Codex 聊天回执。

## Standards Axis

结论：PASS，实际验收边界已在规则与契约中保留。

- 私钥/锚点放 Git common directory；审批和 grant 记录签名，缺失验证密钥不自动重建；不输出私钥、不写业务文档。
- 纯来源解析与 grant store 无 workflow 运行时依赖，避免 state/授权校验的循环初始化。
- 文件有界、路径不越界/跟随链接；批准与签发有效窗口、单调撤销引用、CAS 与锁竞争均有拒绝测试。
- 共享锁支持同一领取内的嵌套状态提交，并恢复原外层发布上下文；不为签发重入获取自身文件锁。
- 48 个专项、44/55 个前阶段场景、类型与会话/布局/handoff/摘要/Provider/策略回归通过；10 Harness 最终构建和 2815 文件一致性通过。
- 正例授权全部模拟原生终端边界，记录仅在临时仓库；没有真实业务授权、真实人类确认或外部副作用完成的声明。

## 问题与复审

| ID | 严重度 | 定位 | 修复与复审 |
| --- | --- | --- | --- |
| R-01 | 重要 | grant store / operator capture | 不能直接把 AuthorityRef JSON 当批准；采用 TTY 实际输入、完整请求摘要和进程内一次性对象，拒绝管道/--user-input/篡改/重放；明确同用户与模拟终端信任边界，通过 |
| R-02 | 重要 | readIssuedGrant / revocation | 仅靠工作树撤销文件可能被删除；增加 Git 控制目录签名锚点，不一致或缺失拒绝；删除 JSON、缺失 key 与在途发布用例通过 |
| R-03 | 重要 | light-state / grant activation | 原发布锁内再次 save 会等待自身锁；复用精确绑定持有的锁，保留外层上下文，仍做 CAS 和冻结校验；签发与 session 回归通过 |
| R-04 | 重要 | controller / operation checks | 普通 workflow-write 不得覆盖 decision-record，consume/verify 不得获得实施权限；按操作和精确 implement 单元检查，增补最小权限与 split 正例，通过 |
| R-05 | 重要 | input capture | 消费证据同样必须固定；纳入实际字节绑定，新增依赖和来源漂移在发布前拒绝，通过 |
| R-06 | 一般 | request time / data bounds | 时间用同一基准构造，避免跨毫秒变成非整数 lifetime；载荷与资源有限；目标路径必需；PEM 使用多行格式验证，通过 |

不签发受控 review-evidence，不更新业务 workflow state/audit，不批准业务决定，不宣告 P1 或业务 verified。真实人类/原生宿主回执、预算驱动、业务试点和 UI 验收继续待各自阶段验证。
