# Mermaid 图表标准

## 定位

Mermaid 是创建或优化 Markdown 及其他文本型文档时的新图表默认格式。仅当用户明确指定 SVG、目标文档已有有效 SVG 引用，或阶段/目标产物契约明确要求 SVG 时，才改走 `aidlc-diagram-design` 的 SVG 流程。

Mermaid 图表以目标 Markdown 内的 `mermaid` fenced block 作为正式源，不生成 `.svg`、`.diagram.json`、expected contract 或 Provider Request。图表目的、图型、粒度、拆分和事实边界仍遵守 `common-diagram-design-standards.md`；语法遵守 `common-mermaid-syntax-rules.md`。

## 写入规则

1. 写入前读取目标文档对应章节、相邻正文和已有图表，确认格式决策及唯一业务上下文；
2. 节点、关系、方向、标签、分组和边界只能来自用户输入、可验证代码/文档或已批准产物，不得创造业务事实；
3. 使用目标 Mermaid 版本支持的图型和可移植语法，不依赖未确认可用的实验特性、主题或外部资源；
4. 图表代码块紧邻解释其目的和关键结论的正文；关键业务事实不能只存在于图中；
5. 优化已有 Mermaid 时保持节点含义、关系方向、方向声明、分支条件、状态语义和边集合不变，除非用户明确授权业务变更；
6. 不因 Mermaid parser 缺失或渲染失败而静默改成 SVG、ASCII 或图片。

## 已有 Mermaid 的最小路由调整（强制）

优化已有 Mermaid 时，先冻结当前 fenced block 的 source graph：节点及其展示文本、边及其方向、图型方向（`TD`/`LR`）、分支条件和业务语义。默认只允许对明确存在问题的连线做最小范围路由调整，不得借布局修复改变业务事实。

- 需要独立调整的连线必须使用稳定、唯一且不随语句重排变化的 edge ID，并优先使用边级 curve 属性：

  ```mermaid
  flowchart TD
      M mbBack@-->|"否"| B
      mbBack@{ curve: stepBefore }
  ```

- 修复单条连线时，不得修改全局 `curve`、改变整图 `TD`/`LR` 方向、重排无关节点，或借助其他无关边掩盖目标边问题；未受影响的节点、边、标签和分支条件保持原文。
- 回流、失败、重试和反馈边优先沿流程主体外侧的最窄合法通道，保持正交并尽量减少实际方向变化；不得穿越节点、节点文字、边标签、箭头或无关连线。
- 目标箭头前的最后一个有效线段必须沿目标节点连接面的法线进入：目标面为左/右时末段水平，目标面为上/下时末段垂直。箭头尖端、末段和目标边界必须在同一真实渲染几何中连续可追踪。
- Mermaid 自动布局无法同时满足来源端和目标端理想路径时，优先保证目标箭头端法线进入；允许来源端增加必要拐点，但必须在相邻 Design Notes 或验收记录中说明该取舍及实际渲染证据。
- `stepBefore`、`stepAfter`、`linear` 只是候选路由方式，不能根据名称推断视觉效果；每次选择都必须以当前 Mermaid 版本对正式 fenced block 的实际渲染结果为准。
- 禁止把写死 SVG 路径坐标的 `themeCSS`、`nth-child` 标签偏移、透明图片节点、不可见连线或渲染后手工改图作为默认方案。遗留兼容只能作为版本敏感的显式例外，且必须记录适用版本、原因和回退边界。

## 验证

Mermaid 验收必须分离 parser、源语义和真实渲染三层，不能用前一层替代后一层：

- 检查 fenced block 闭合、图类型声明、节点/关系引用、标签转义、稳定 edge ID、边级 curve 配置和相邻正文一致性；
- 项目或宿主已有 Mermaid parser/CLI 时执行真实语法解析，不静默安装新工具；语法解析通过只证明源可解析，不证明连线方向、正交性或视觉可读性；
- 涉及回流边、端口方向或正交路径时，必须从当前正式 Markdown 的 Mermaid fenced block 直接渲染 PNG，并检查目标末段法线、箭头连续性、实际拐点、节点/文字/标签/箭头碰撞、边交叉和画布裁切；不得从复制后的手工 SVG、外部路径配置或渲染后改图取得替代证据；
- 真实渲染不可执行时，验收状态必须标记为 `UNVERIFIED`，只能报告已完成的源检查和 parser 状态，不得仅凭源码或 parser 声称视觉通过；
- Mermaid 正式源始终是目标 Markdown fenced block。Mermaid 模式不创建 `.svg`、`.diagram.json`、expected contract 或 Provider Request；临时 PNG 只能作为本次渲染证据，不能反向成为设计源。

## SVG 边界

格式决策为 SVG 时加载 `common-svg-diagram-standards.md` 并调用 `aidlc-diagram-design`。Mermaid 代码、静态审查或预览截图都不能替代 SVG 源、结构化契约、`diagram-contract` sensor 或 Provider evidence；同样，SVG 验收结果不能证明 Mermaid 语法有效。
