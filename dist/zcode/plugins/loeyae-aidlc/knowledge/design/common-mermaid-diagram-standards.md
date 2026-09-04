# Mermaid 图表标准

## 定位

Mermaid 是创建或优化 Markdown 及其他文本型文档时的新图表默认格式。仅当用户明确指定 SVG、目标文档已有有效 SVG 引用，或阶段/目标产物契约明确要求 SVG 时，才改走 `aidlc-diagram-design` 的 SVG 流程。

Mermaid 图表以目标 Markdown 内的 `mermaid` fenced block 作为正式源，不生成 `.svg`、`.diagram.json`、expected contract 或 Provider Request。图表目的、图型、粒度、拆分和事实边界仍遵守 `common-diagram-design-standards.md`；语法遵守 `common-mermaid-syntax-rules.md`。

## 写入规则

1. 写入前读取目标文档对应章节、相邻正文和已有图表，确认格式决策及唯一业务上下文；
2. 节点、关系、方向、标签、分组和边界只能来自用户输入、可验证代码/文档或已批准产物，不得创造业务事实；
3. 使用目标 Mermaid 版本支持的图型和可移植语法，不依赖未确认可用的实验特性、主题或外部资源；
4. 图表代码块紧邻解释其目的和关键结论的正文；关键业务事实不能只存在于图中；
5. 优化已有 Mermaid 时保持节点含义、关系方向、分支条件和状态语义，除非用户明确授权业务变更；
6. 不因 Mermaid parser 缺失或渲染失败而静默改成 SVG、ASCII 或图片。

## 验证

- 检查 fenced block 闭合、图类型声明、节点/关系引用、标签转义和相邻正文一致性；
- 项目或宿主已有 Mermaid parser/CLI 时执行真实语法解析，不静默安装新工具；
- 无法执行真实 parser 时明确记录“未执行真实语法解析”，只能声明静态审查结果，不能宣称目标环境渲染通过；
- 目标阅读环境的实际渲染只有在真实预览或浏览器证据存在时才可标记通过。

## SVG 边界

格式决策为 SVG 时加载 `common-svg-diagram-standards.md` 并调用 `aidlc-diagram-design`。Mermaid 代码、静态审查或预览截图都不能替代 SVG 源、结构化契约、`diagram-contract` sensor 或 Provider evidence；同样，SVG 验收结果不能证明 Mermaid 语法有效。
