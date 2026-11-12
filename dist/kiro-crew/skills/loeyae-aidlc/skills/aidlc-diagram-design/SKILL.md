---
name: aidlc-diagram-design
description: "按已确认语义制作 Mermaid 或显式要求的 SVG 图表，并验证可读性和关系正确性。"
triggers: 画图, 图表设计, 业务流程图, 系统架构图, 架构图, 流程图, 泳道图, 时序图, 状态图, ER 图, 部署图, diagram, architecture diagram, flowchart, sequence diagram, svg
---

# diagram-design

先确定图要表达的业务事实与关系，复用用户描述或实际代码/文档。默认在现有 Markdown 中使用 Mermaid；用户要求 SVG 时直接用宿主工具制作可编辑 SVG，无需先写流程状态。

核对节点/关系完整性、阅读方向、标签、线条、容器和文字边界；SVG 注意遮挡、可读性和尺寸。预览或导出有明确用途时才渲染；没有实际渲染就不宣称视觉验证通过。保留语义来源，不从生成图反向杜撰验收事实。

通常只交付所需图源和必要说明；不默认生成 expected-contract、sidecar、Provider Request 或签名证据。用户明确要求受控 Provider/旧图表产证时才使用兼容契约。

默认由宿主执行，结果和必要业务文档是工作依据；共享边界见 [宿主执行协议](../../knowledge/protocols/host-execution.md)。

## 兼容参考

仅明确使用旧受管/受控产证模式时读取 [旧契约](../../knowledge/legacy-skills/aidlc-diagram-design.md)，默认不加载。
