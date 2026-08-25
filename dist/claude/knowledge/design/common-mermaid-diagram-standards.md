# Mermaid 遗留兼容说明

## 定位

Mermaid fenced block 不再是本仓图表设计的输出格式。本文件仅用于识别历史 Mermaid 内容、提取其已确认业务语义，并按 Blueprinter SVG 设计规则迁移为 SVG 源和可选的语义伴随清单。静态 SVG、预览和导出由外部 Provider 负责，不是 AIDLC 默认能力。

新图表必须加载 `common-diagram-design-standards.md` 与 `common-svg-diagram-standards.md`，不能新建、复制或保留 Mermaid 图块作为正式图例。

## 迁移规则

1. 从历史图中提取节点、关系、方向、标签、分组和正文中的事实来源；
2. 依据图的目的选用 Flowchart、Sequence、State、ER、Class、Context、Container、Component、Deployment 或 Infrastructure SVG 场景；
3. 需要保存图表源时，在目标 Markdown 同级 `assets/` 写入 SVG 源；仅在需要机器检查稳定 ID、方向、端口、连通性或 Provider 映射时创建 `.diagram.json` 语义伴随清单；若目标要求预览、渲染或导出，同时生成 Provider Request；
4. 用 SVG 源引用或 Provider 实际生成的目标产物引用替换原图块，保留相邻正文、表格和历史日期；引用不证明目标环境已渲染成功；
5. 源信息不足时不猜测；请求补充或保留文字/表格；
6. 不为迁移而安装 Mermaid CLI、外部插件或 draw.io Provider。

## 已迁移的交付流程示例

![交付型业务流程 SVG 模板](assets/mermaid-delivery-flow.svg)

结构化源位于 `assets/diagram-library.diagram.json`，用于表达开始、步骤、判断、通过分支和完成状态。严格端点类业务流程仍须遵守 `common-svg-diagram-standards.md` 的几何规则。

## 兼容边界

- 历史文档可保留“Mermaid”术语，以准确说明当时的背景或迁移来源；
- 不得把遗留语法或目标预览能力当作当前 SVG 验收证据；
- 目标阅读环境没有可验证 SVG Provider 时，可以使用已有静态资产，或交付 SVG 源并将目标几何/视觉标为 `UNVERIFIED`；只有用户明确要求目标 `preview`、`render` 或 `export` 而无能力时返回 `NEEDS_CAPABILITY`，经用户同意才可文字表格降级；
- Mermaid 解析、CLI 渲染和 Kiro Mermaid Preview 均不属于当前 SVG 设计和 Provider 验证路径。
