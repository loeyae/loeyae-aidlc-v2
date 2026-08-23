---
name: aidlc-diagram-design
description: "独立图表设计能力：依据 Blueprinter SVG 设计规则，根据已确认语义交付可审阅的 SVG 源、可选语义伴随清单和 Provider Request；不负责阶段路由和完成判定。"
triggers: 画图, 架构图, 流程图, 时序图, 状态图, ER 图, 部署图, diagram, architecture diagram, flowchart, sequence diagram, svg
---

# 图表设计能力

Independent Capability — not an AIDLC phase.

## 输入

调用方提供：

- **source/context**：用户描述、代码路径、文档路径或已有设计产物；
- **diagram intent**：图帮助读者理解什么；
- **diagram_type**（可选）：偏好图型，默认 `auto`；
- **output_location**：目标 Markdown 路径；SVG 源和可选语义伴随清单优先写入同级 `assets/`；
- **target_operations**（可选）：`source-only`、`preview`、`render` 或 `export`；未要求时不主动调用 Provider；
- **approved facts**：已确认的角色、步骤、系统、关系和业务规则；
- **constraints**（可选）：`delivery-business-flow` 用于面向 PRD/业务方/客户交付的流程图；
- **target_reading_environment**（可选）：目标浏览器、容器尺寸或交付环境。

缺少可靠设计图表所需的信息时返回 `NEEDS_CONTEXT`。不得推断流程状态或自行创造业务事实。

## 加载

1. 发布包中的 `knowledge/design/common-diagram-design-standards.md`；
2. 发布包中的 `knowledge/design/common-svg-diagram-standards.md`；
3. `constraints` 包含 `delivery-business-flow` 时，自动应用交付型流程约束。

历史 Mermaid 或二维文本图只在迁移时按需读取；不能作为新输出格式。

## 执行

按加载的设计标准执行完整的图表设计流程：图型选择、节点/边提取、SVG 源生成、可选 `.diagram.json` 语义伴随清单生成、Provider Request 生成和源级验证。具体步骤和验收矩阵以加载的两份规则文件为准，本文件不复制。

## 输出

- Diagram Type + Purpose；
- SVG 源路径；可选 `.diagram.json` 路径；Provider Request；
- Design Notes；
- Validation Matrix（源结构/几何/语义/目标视觉）；
- Delivery Status：`SOURCE_READY`、`DELIVERED`、`NEEDS_CAPABILITY` 或 `DEGRADED_TO_TEXT_TABLE`。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 等待或代替用户审批；
- 执行 AIDLC 阶段路由；
- 发起变更请求；
- 修改业务代码或提交 Git；
- 宣布任何 AIDLC 阶段完成；
- 伪造 diagram-contract evidence；
- 声称目标渲染/预览/导出成功而无 Provider 证据；
- 回退到 Mermaid 或 ASCII 图。
