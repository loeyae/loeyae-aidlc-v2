# MARS-251：4.22.3 审计残留修复

基线为 `main@a0e27d2edaa7c1b04aa54aa80210f782fa3e5cf6`，版本保持 4.22.3。本任务不合并 main、不升级版本、不创建 tag 或发布。

| 审计项 | 实现与权威来源 | 验证入口 |
| --- | --- | --- |
| 小源码与配置存在性 | `aidlc-artifact-presence.ts` 区分源码、合法小配置与文档；源码无字节配额，JSON 必须可解析，文档保留实质内容与大小要求。produces、consumes、no-todo 空集保护和 traceability 选取一致；源码跟踪/忽略、二进制、路径边界与单元 delta 规则保留。 | `test_mars251_policy` 执行 15 字节 JS，覆盖小配置、空/占位/二进制/忽略、正常文档、删除与源码 delta；真实 GREEN report 包含 3 字节配置。`test_mars95_source_delivery` 保留原归属回归。 |
| 自然语言设计兼容 | 旧 Markdown 表格与无上游来源的 legacy 路径保留。已有自然语言来源可在当前 spec 内提供显式完整、内容绑定的结构化投影；每个已发现来源独立检查，不能借另一个可解析来源跳过平台约束。 | 真实 bridge producer 与主门禁交叉验证 prose/同义 prose、旧表格、漏组件/约束、跨模块非法引用、页面章节范围、错误 quote、平台声明冲突和来源漂移。 |
| 桥接顺序与真实映射 | 阶段图为 I13 → RED → 条件 bridge → GREEN。bridge 唯一负责单元 spec 与证据的创建；GREEN 条件消费并复验它们。正文、技能、sensor 与代码生成入口删除 3/5/3 配额；追溯矩阵将 bridge 视为 RED 后、生产代码前。 | 真实 `next → evidence run → report → next → GREEN report`，以及来源被改坏时的拒绝。保留纯 Web 条件与轻量 scope waiver；rule-load plan 与执行器共同遵循显式 waiver，未声明阶段即使标记 waiver 仍拒绝。 |
| 审批一致性 | 图/directive 为权威，三个阶段的正文、计划提示、结果模板与完成标准采用 notify。通用 handoff 同时说明复用授权与用户显式审阅等待；架构/部署 block 保留。 | graph 检查三个 notify；实际 GREEN next 的 `gate: false` 与 handoff 审阅等待提示；bridge/GREEN completed 无额外 Approve；Operations completed 被明确审批门禁拒绝。显式自然语言审阅要求由宿主遵守提示，不新增自然语言审批状态机。 |
| 测试职责与范围 | common-tech-testing、code-review 与 build/test 模板统一使用项目已有/明确批准的覆盖率政策及最小充分行为/风险范围。断言失败先核对需求、预期、实现，可有据修正错误测试，禁止降低正确断言伪造通过。 | 逐项核对知识加载链与模板；MARS-249/250、TDD、UC-D scope、checker scope、执行策略与流程定向回归验证既有真实证据门禁。 |
| 主分支操作归属 | units-generation、common-terminology、common-quality-gates 统一交付/提交/整合口径。设计审批不构成 main/push/merge 授权，宿主按项目策略和明确授权决定执行者。 | 原文及引用链清点；任务在独立 worktree 实施，入口/退出快照比较主目录 branch、HEAD、status、`.gitignore` 内容摘要与原 worktree 注册。 |

自然语言兼容由既有批准事实提供投影，不由关键词自动猜测，也不新增审批文档。投影放在现有单元 spec 的 fenced `frontend-source-projection` JSON 中：

```json
{
  "source": "docs/aidlc/modules/project/inception/application-design.md",
  "source_sha256": "填写引用原文的64位SHA256",
  "complete": true,
  "rows": [
    { "kind": "layout_primitives", "cells": ["垂直排列", "View"], "quote": "采用 View 垂直布局" },
    { "kind": "component_mapping", "cells": ["标题", "Text"], "quote": "Text 显示标题" },
    { "kind": "css_constraints", "cells": ["display:grid", "运行时不支持", "flex"], "quote": "不支持 grid，使用 flex" }
  ]
}
```

`source` 必须在当前模块 Inception 范围内，且是适用的自动发现来源或显式 `design_source` / `platform_source`。带 anchor 时引用内容包含匹配标题及其子节，至下一个同级/上级标题之前，换行为 LF；不带 anchor 时对文件原始 UTF-8 文本取 SHA-256。`quote` 必须是该范围中连续原文。每个来源投影最多 500 行，必须明确完整覆盖；实际 spec 表格仍必须覆盖投影及来源已有表格，既有明确目标/原因/替代方案和运行时/样式声明均约束实现。机器检查结构、内容绑定与映射一致性；语义投影的完整性仍须对照批准事实审查，不声称通用 NLP 能证明任意 prose 的全部约束。

存在性校验不替代编译、配置 schema、需求追溯或行为测试。空/纯注释包标记可与实质源码共存，但不能独自代表交付；它们仍参与原有 TODO 扫描。删除后未变的存量文件不会被算作本单元新交付，删除加真实小源码变更仍通过；只删除且没有存活源码 delta 的既有规则未改变，不暗中把整棵源码树算作本单元交付。

真实路由还覆盖了 report 清空活动游标后的上游复验：RED 替代检查按被检查实例的模块/单元绑定，避免错误继承空游标。无输入所有权声明的项目继续保守绑定输入；新增受管文件后需要刷新失效前置观察。受控 refresh 不新增批准，也不允许虚构证据。

执行的具体命令、退出码及原始日志随 issue 验证附件交付。定向验证覆盖受影响引擎和政策；不宣称运行全仓测试、验证任意外部 Provider 或等待外部 CI。

五项历史套件在当前树退出 1，已用 `git archive a0e27d2edaa7c1b04aa54aa80210f782fa3e5cf6` 的隔离源码副本分别复现，基线同样退出 1：`test_v4_6_0_tdd_mode`、`test_v4_8_0_unit_ucd_scope`、`test_v4_8_1_checker_scope`、`test_split_next_routing`、`test_aws_light_workflow`。其失败均包含既有测试夹具缺少显式会话绑定的诊断；未将它们标为通过，未放宽会话门禁或扩展本任务去迁移这些历史夹具。基线副本只复用本任务独立安装的依赖，不读写人类主目录的 node_modules。
