# 内容验证规则

## 图表格式决策（强制）

创建或优化文档中的图表前，先按 `core-workflow.md` 判定格式：用户明确指定格式优先；目标文档已有有效 SVG 引用时延续 SVG；阶段契约明确要求 SVG 时使用 SVG；其他情况默认 Mermaid。不得以同目录孤立资产、其他文档格式、工具偏好或当前格式失败为理由切换。

## Mermaid 图表写入前验证

创建或修改 Mermaid fenced block 前，必须加载 `common-diagram-design-standards.md`、`common-mermaid-diagram-standards.md` 与 `common-mermaid-syntax-rules.md`，并确认：

1. 图表目的、节点、关系、方向、标签和分组均来自已确认事实，并与相邻正文一致；
2. fenced block 闭合、语言标识为 `mermaid`、图类型明确，节点与关系引用完整，标签和特殊字符符合可移植语法；
3. 项目或宿主已有 Mermaid parser/CLI 时执行真实解析；不可用时记录“未执行真实语法解析”，不得伪造渲染通过或静默安装工具；
4. 不生成 `.svg`、`.diagram.json`、expected contract 或 Provider Request 作为 Mermaid 模式的伴随资产；
5. 关键业务事实在正文中可追溯，图表渲染失败不会使唯一事实丢失。

## SVG 图表写入前验证

创建或修改 SVG 源或图表资产前，必须加载 `common-diagram-design-standards.md` 与 `common-svg-diagram-standards.md`，并确认：

1. 图表目的、节点、关系、标签、分组和边界均来自已确认事实，并符合 Blueprinter 设计规则；
2. SVG 源中的文字、节点、连线、分组、可访问性信息、统一视觉属性和布局决策可审阅；如使用 `.diagram.json`，它位于目标 Markdown 同级 `assets/`，并记录版本、标题、描述、图型/意图、画布、节点、连线、端口、无框标签、分组类型/成员/层级和输出源文件名；
3. 可选清单字段与 `common-svg-diagram-standards.md` 统一 SVG 契约一致；节点、连线、分组和端口引用使用稳定唯一 ID，文本规范化幂等；`legend` 必须缺失、`annotations[]` 必须为空，SVG 不得出现 `data-legend-item` 或 `data-note`；清单不被假定为本地渲染输入；
4. 节点、决策、连线、标签和分组尺寸由同一份文本、行高、内边距和布局数据计算；画布为不透明白色，业务框体默认无填充，structural 交点节点可使用不透明白底，墨色为黑色，字体首选微软雅黑，框体/边标签字号为 `16/14`，线宽为 `2`，箭头为 `10 × 10`，无框边标签位于线段中点法向且净空至少 `6`；不得通过缩小字体、整体缩放或手改 SVG 源掩盖空间问题；
5. 源文件不包含脚本、`foreignObject`、外部图片、外部样式、外部链接或其他不安全嵌入；
6. AIDLC 完成源结构、事实映射、稳定 ID、方向、端口、连通性和可表达几何约束检查，并生成 Provider Request；AIDLC 不调用或默认绑定渲染器；
7. 若目标明确要求 Provider 生成的静态 SVG、预览或导出物，Provider 执行实际渲染、文字测量、最终布局和目标环境视觉检查；其结果必须单独记录目标产物路径、Provider 和能力范围；
8. 需要几何精度的流程额外检查端点、正交路径、回边外侧布置、重叠、交叉、节点/文字穿越、structural 框体与节点/连线/标签/箭头的交点遮挡、标签覆盖、单一起始节点和流程单向连接；structural 交点节点必须使用不透明白底，连线、标签或箭头交点必须由按实际 bbox 计算的 structural alpha 断口或无交点分段路径处理，并在 Provider 截图/像素证据中复核；所有图型还要检查全局图例/备注缺失、统一视觉样式、标签中点法向净空、分组未声明交叠、互斥成员唯一和图型混合拆图记录；双向线仅适用于明确的数据互通关系图；
9. 仅有源而未执行目标 Provider 时，必须在 SVG 外部的验收证据中记录目标几何/视觉状态为 `UNVERIFIED`；不得把状态、全局图例或全局备注写入 SVG 可见内容、`legend`、`annotations[]`、`<title>` 或 `<desc>`。用户要求 Provider 但无可验证能力时返回 `NEEDS_CAPABILITY`，不得把源不存在与能力缺失混为一谈。

## 图表验收记录（强制）

Mermaid 模式记录业务语义检查、真实 parser 执行状态和目标阅读环境验证状态；无 parser 时必须明确未执行，不得写成通过。SVG 模式记录源结构、事实映射、语义契约和适用几何检查；存在 Provider 目标产物时还必须引用 `common-svg-diagram-standards.md` 的完整验收矩阵，并记录 Provider、目标环境和证据位置。两种格式的证据不得互相替代。

仅交付 SVG 源时，必须明确记录目标环境几何和视觉为 `UNVERIFIED`，这不等于源设计失败；只有目标操作被要求且 Provider 不可用时才返回 `NEEDS_CAPABILITY`。不得把不存在的 Provider 目标产物或视觉验收描述为已通过。

## 图表格式边界

默认 Mermaid 可作为正式文档图表；显式 SVG 模式继续使用 SVG 源和对应契约。任一格式失败都不得静默切换。二维 ASCII/Unicode 图只用于遗留内容识别；目录树、命令、单行状态和普通文字不属于图表迁移范围。

## 通用内容验证

### 创建前验证清单

- [ ] 验证嵌入的 JSON、YAML 和其他代码块；
- [ ] 检查特殊字符转义；
- [ ] 验证 Markdown 语法和相对链接；
- [ ] 验证复杂内容的目标环境兼容性；
- [ ] 为图像加载失败的关键事实保留文本依据。

### 验证失败处理

1. 记录具体失败的源、SVG、引用、结构、几何、语义或视觉检查；
2. 修复可定位的结构化源后，只重跑受影响渲染和验证；
3. Provider 或环境不可用时，只有在用户明确要求目标 `preview`、`render` 或 `export` 且没有可验证 Provider 的情况下返回 `NEEDS_CAPABILITY`；仅要求源时使用 `SOURCE_READY` 并将目标几何/视觉标为 `UNVERIFIED`；事实不足或图型不适用时使用 `NEEDS_CONTEXT` 或经用户同意的文字/表格。
4. 不得以未验证的替代图表、假定 Preview 成功、手改 SVG 或删除失败证据来标记完成。
