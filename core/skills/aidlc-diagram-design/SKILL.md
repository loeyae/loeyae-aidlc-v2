---
name: aidlc-diagram-design
description: "按已确认语义制作 Mermaid 或显式要求的 SVG 图表，并验证可读性和关系正确性。"
triggers: 画图, 图表设计, 业务流程图, 系统架构图, 架构图, 流程图, 泳道图, 时序图, 状态图, ER 图, 部署图, diagram, architecture diagram, flowchart, sequence diagram, svg
---

# 图表设计

未加载时先读[共用规则](../../knowledge/protocols/host-execution.md)，已加载则复用。

从用户描述或实际代码/文档确定节点、关系和语义来源。默认在原 Markdown 中使用 Mermaid；明确要求 SVG 时制作可编辑 SVG。

核对关系完整性、阅读方向、标签、连线和容器边界，SVG 另检查遮挡与尺寸。预览或导出有实际用途时渲染，未渲染不宣称视觉验证通过。交付所需图源与说明；仅在明确要求受控 Provider 时使用对应契约，图形不能反向证明业务验收。
