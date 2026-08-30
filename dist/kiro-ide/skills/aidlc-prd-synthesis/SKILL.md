---
name: aidlc-prd-synthesis
description: "基于 Discovery 和已有 Inception 产物合成面向业务方的 PRD 文档；不负责 PRD 审批和阶段完成判定。"
triggers: PRD, 产品需求文档, 需求文档合成, 需求整理, PRD synthesis, 业务需求文档
---

# PRD 合成能力

开始时宣布："使用 aidlc-prd-synthesis 合成 PRD"。

## 输入

调用方必须提供：

- 用户描述或 Discovery 结论；
- 适用的已有 Inception 产物（需求、故事、模块、契约等）；
- 规模检测信号或显式规模取值（S/M/L）；
- SSOT 检索结果（条件：SSOT 已绑定时）。

缺少可靠生成 PRD 所需的信息时返回 `NEEDS_CONTEXT`，不臆造业务规则。

## 加载

加载发布包中的 `stages/ideation/product-prd-generation.md`。

## 输出

返回生成的 PRD 文件路径（`docs/aidlc/ideation/prd.md`）、待确认项索引、来源索引、澄清一致性结论和业务流程图状态。

## 禁止事项

不得：

- 臆造业务规则（不知道就标记 `[待确认]`）；
- 更新项目 state 或 audit；
- 代替用户审批或放行质量门禁；
- 宣布 PRD 完成或阶段完成；
- 伪造 prd-completeness evidence；
- 执行 Inception 后续阶段。
