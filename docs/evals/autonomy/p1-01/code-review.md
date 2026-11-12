# P1-01 代码审查

| 项目 | 内容 |
| --- | --- |
| 状态 | DONE：本次 P1-01 范围内复核通过，无未修复的关键/重要问题 |
| 模式 | INDEPENDENT_DUAL_AXIS；Spec、Standards 分别检查与记录，由同一宿主执行；不声称独立人员/子 Agent 审查 |
| 范围 | 新 autonomy/state 类型工具；既有 state/orchestrate/CLI 接入；专项测试、测试入口和对应分发 |
| Spec | 总体设计 P1-01、契约 v1 第 1–3 节及新增 3.1.1 实现边界 |
| Standards | 既有 Markdown 单一状态、CAS 与 claim 机制；闭合输入、路径约束、预览零写入和证据诚实边界 |
| 影响域 | 全局状态与模块归属、批次范围、CLI 路由前校验；不新增授权或完成判定 |
| 验证 | [实施记录](../../../aidlc-autonomous-implementation-p1.md)、[验证清单](verification.json)及同目录原始日志 |

## Spec Axis

结论：PASS，限于 P1-01 已声明的范围读取/采用能力。

- 显式 adoption 保存版本和唯一范围快照；无 marker 的旧流程不读取自主来源。
- 单批次、三角色、模块/单元真实归属与内容摘要；场景/AC/UI/基线/交付物引用真实定义。
- 已登记上游依赖与反向消费者闭包均校验，跨模块消费者不能被省略；排除理由不冒充验证通过。
- preview/inspect 与幂等采用不写入；正式采用需要有效 claim 和预期 revision，并在状态锁内复核来源。
- policy/matrix 完整语义、证据 producer/freshness/readiness、无 UI 适用性和功能/UI 验收明确保持 pending；投影不授予执行权限。
- 已采用范围漂移在 CLI next/report 拒绝，split 提前拒绝归属变化；没有把当前全部 native 阶段路由声称为批次调度已实现。

## Standards Axis

结论：PASS，范围和限制已在契约及 CLI 手册中明确。

- 采用身份复用既有 global state/audit，不复制进度控制面，不修改无关活动 workflow。
- state 的快照类型/校验独立于读取器，避免新增的 state → orchestrator 循环依赖。
- JSON 对象键排序不依赖 locale，raw-file 按原字节，相关输入每次重读；不使用有失效风险的跨调用缓存。
- 拒绝越界、Windows 驱动/分隔符绕行、路径链接、非单链接常规文件和超限文件；递归引用检测循环与深度。
- 正向/反向相关依赖使用同一封闭校验；SourceItemRef 需要来源中的真实定义，正文提及和代码围栏不计入。
- 44 个专项场景、相关状态/会话/布局/权限/摘要回归及类型检查通过；10 个分发完成构建和逐字节一致性检查。

## 问题与复审

| ID | 严重度 | 定位 | 问题、修复和结果 |
| --- | --- | --- | --- |
| R-01 | 重要 | core/tools/aidlc-autonomy.ts：依赖扫描与 consumer_closure | 最初只检查消费者的上游，可能遗漏提供者变更后的下游；现扫描所有模块已登记依赖，要求受影响消费者有验证或排除记录，补充同模块/跨模块案例，复审通过 |
| R-02 | 重要 | core/tools/aidlc-orchestrate.ts：performSplit | 采用后 split 会改变 UnitRef owner/workflow 身份，留下已冻结但无法解析的范围；现修改布局前直接拒绝，专项 CLI 零写入测试通过 |
| R-03 | 一般 | core/tools/aidlc-autonomy.ts：摘要与身份校验 | 收紧重复基线/矩阵 check、policy 专用 ID、证据 batch ID 和 locale 无关排序；补充重复身份及键顺序稳定案例，复审通过 |
| R-04 | 一般 | core/tools/aidlc-autonomy.ts：反向相关依赖 | 排除的下游边也应校验闭合字段与引用，不能因未列入 dependency_refs 绕过；提取统一 dependency 校验并补充未知字段拒绝，复审通过 |

本记录是源码审查结果，不签发受控 review-evidence，不放行现有 C6/C7/C8 或业务交付门禁，不更新工作流状态。未检查完整 P1、实际浏览器或无人值守业务执行。
