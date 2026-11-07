---
slug: state-template
number: "2.0"
name: 状态模板
phase: inception
execution: ALWAYS
# execution: ALWAYS 阶段对所有 scope 无条件执行；下面的 scopes 仅作文档参考，不参与阶段过滤（过滤规则 execution==="ALWAYS" || scopes.includes(scope)，ALWAYS 短路了 scopes）。
scopes: [feature, enterprise, mvp, classic, express, workshop, bugfix, refactor]
consumes: []
produces: []
sensors: []
completion_contract: instruction_only
requires: [workspace-detection]
---
# 状态、交接与只读摘要

本阶段说明现有控制面，不要求创建或维护 `docs/aidlc/handoff.md`。state/audit/ledger 由引擎维护，Agent 不手工复制阶段、单元、测试计数或审批结果。

## 权威来源

- 当前布局的 workflow state/audit 记录阶段、module/unit、choice、审批与推进历史；per-module 布局还读取 registry 和选定模块状态。
- 成功 `orchestrate report` 和当前 directive 返回 `handoff_prompt`，原样展示后用于交接；恢复遵循 `common-session-handoff.md` 的精确领取与转交契约。
- `orchestrate state summary` 只读生成简短概览，不执行 producer、不推进状态、不授予领取权限，也不代替门禁。
- module/unit manifest、需求、故事、设计、契约和受控 Evidence 保留各自权威路径。UI 方式读取签名 I9 choice，页面事实读取 canonical page-plan 与 HTML/Figma manifest，不从摘要补齐机器输入。

## 人工信息放在哪里

只补充不能从机器结果派生的信息：

- 真实产品决策、冲突来源和替换依据保留在对应问题文件及受影响需求/设计；未决语义冲突仍按 `common-workflow-changes.md` 阻断。
- CR 的批准、风险、消费者和验证计划遵循 `change-request-process.md` 与 `quality-gates-v1.md`；现有记录中的 `aidlc-cr` 机器段不是可丢弃的统计摘要。
- 共享契约基线、来源、实际验证与失效依据遵循 `construction-shared-contract-baseline.md`，未验证或失效的基线不能因摘要写成“完成”而解锁消费者。
- 审查发现、修复与剩余风险保留在单元 `code-review.md`，不另建单元审计或实施摘要。

既有 handoff 中的真实批准、活跃 CR 或契约业务记录按原契约保留并引用，不能随展示视图一起删除；纯进度表与统计不再要求持续同步。缺少旧展示视图不阻断恢复，真实权威记录冲突仍按引擎与业务决策流程处理。

## 展示与导出

简单任务默认展示简短结果及 `handoff_prompt`。复杂交付或明确要求完整报告时，按实际受众与风险补充必要解释，直接引用已有证据，不建立新的通用报告层。

用户明确要求导出摘要时可将只读结果保存到 `.aidlc/views/`，该文件可重建，不作为完成或审批依据。上下文压缩时按需读取原始 state/audit 和 canonical 产物，不压缩、覆盖或删除权威记录，也不为整理摘要额外要求 Git 提交。
