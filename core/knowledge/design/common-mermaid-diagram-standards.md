# Mermaid 图表标准

## 目的与边界

本文件定义 AI-DLC 文档中 Mermaid 图表的选择、信息边界、可读性和降级规则。具体语法由 `common-mermaid-syntax-rules.md` 定义。

Mermaid 用于表达关系、顺序、状态和依赖，不是需求、契约或决策的唯一事实来源。各阶段 steering 只定义需要表达的业务语义，不重复 Mermaid 语法。

## 加载条件

创建或修改包含 Mermaid 代码块的文档时：

1. 先加载本文件；
2. 实际生成、修改或排查 Mermaid 时再加载 `common-mermaid-syntax-rules.md`；
3. 仅阅读不含 Mermaid 的普通 Markdown 时不加载这两个文件。

## 兼容目标

本项目的 Mermaid 兼容性基线是 **Kiro Markdown Mermaid Preview + 项目 Mermaid CLI**，不以 GitHub Markdown 或其他第三方平台为限制条件。

目标渲染环境和文档链路：

| 环节 | 工具 | 角色 |
|------|------|------|
| 开发期预览 | Kiro Markdown Mermaid Preview（Mermaid 11.12+） | 主要预览环境 |
| 语法验证与渲染 | 项目 Mermaid CLI | 权威验证环境 |
| 版本管理 | Gitea | 源文件存储，不作为 Mermaid 能力限制 |
| 文档转换 | Python 文档工具链 | Mermaid → SVG → DOCX/PDF |
| 最终交付 | DOCX/PDF | 客户交付物 |

兼容性判断规则：

1. 如果某 Mermaid 特性能在 Kiro 当前 Mermaid Preview 和项目 Mermaid CLI 中正常解析和渲染，则允许使用；
2. 不因 GitHub Markdown 不支持某图类型而主动限制；
3. 不因 Mermaid 官方将某图类型标记为 experimental 或 beta 而直接禁止——真正的判断标准是目标环境是否可用；
4. Gitea 只负责 Markdown 和 Mermaid 源文件的版本管理，不参与 Mermaid 能力裁剪；
5. 跨环境视觉布局允许有差异，但语义和连接关系必须一致。

## 图类型选择

### Architecture 图类型选择策略

Architecture 相关图表根据表达目的选择最合适的图类型，不强制统一使用 `flowchart + subgraph`：

| 表达目的 | 首选图类型 | 降级方案 | 适用示例 |
|----------|-----------|----------|----------|
| 系统上下文（系统与外部参与者） | `C4Context` | `flowchart TD` + subgraph | 系统边界、外部依赖 |
| 系统内部容器/服务 | `C4Container` | `flowchart TD` + subgraph | 微服务架构、容器划分 |
| 容器内部组件 | `C4Component` | `flowchart TD` + subgraph | 单服务内部模块 |
| 部署拓扑与运行时环境 | `C4Deployment` | `flowchart TD` + subgraph | 服务器部署、网络拓扑 |
| 云服务/CI-CD 资源关系 | `architecture-beta` | `flowchart TD` + subgraph | 云架构、基础设施 |
| 模块依赖、简单结构 | `flowchart` + subgraph | — | 模块关系、简单架构 |

选择规则：

1. 优先选择语义表达能力更强且目标环境已验证可用的图类型；
2. 不因 Mermaid 官方的 experimental/beta 标记直接禁止——判断标准是目标 Mermaid 版本是否支持 + Kiro Preview 能否渲染 + Mermaid CLI 能否解析渲染；
3. 如果高级图类型在目标环境无法可靠渲染，降级为 `flowchart + subgraph`；
4. 禁止仅因某第三方平台（如 GitHub）不支持某图类型而降级。

### 通用图类型选择

| 信息结构 | 首选图类型 | 适用示例 |
|----------|------------|----------|
| 步骤、分支、反馈循环 | `flowchart` | 工作流、决策流、数据管线 |
| 按时间发生的参与方交互 | `sequenceDiagram` | API 调用、消息流、跨服务协作 |
| 状态与迁移 | `stateDiagram-v2` | 实体生命周期、任务状态 |
| 数据实体与基数关系 | `erDiagram` | 需求数据模型、数据库概念模型 |
| 类型、接口与继承关系 | `classDiagram` | 关键领域类型、组件接口 |

不能由上述图类型清晰表达时，优先使用表格或分层列表，不为追求视觉效果引入目标环境未验证的图类型。

## 信息组织

- 图表只呈现理解关系所需的节点和连线；详细字段、约束和依据保留在正文或表格。
- 文档在 Mermaid 不渲染时仍须可理解：关键事实必须同时存在于相邻正文、表格或清单中，但不要求逐行复制图表。
- 节点标签使用项目术语，节点 ID 使用稳定技术标识；不得用颜色代替文字表达状态或结论。
- 单图出现难以阅读的交叉连线、过深嵌套或大量节点时，按业务边界拆图并用正文说明关系。
- 默认不添加装饰性色板、图例或动画；只有颜色承载经文字同时表达的辅助语义时才使用最小样式。

## 布局规则

- 顺序流程默认 `TD`；阶段链路、时间线或参与方较少的横向关系可使用 `LR`。
- 图方向必须显式声明。
- 子图只用于稳定的模块、阶段或职责分组，嵌套不超过两层。
- 避免直接连接子图；优先连接子图内的明确节点，减少不同渲染器的布局差异。
- 标签保持简短；需要解释时在图后增加正文，不在节点内堆叠段落。

## 禁止项

默认禁止：

- 把 Mermaid 图作为需求、契约、审批或决策的唯一记录；
- 使用需要宽松安全模式才能运行的功能；
- `click`、JavaScript callback、外部 URL 交互或依赖宽松安全模式的功能；
- 用 emoji、富 HTML、外部字体或外部图片传递关键语义；
- 为视觉美化添加没有语义用途的大量硬编码颜色；
- 声称仅凭人工检查或正则扫描已通过 Mermaid 解析；
- 使用需要额外配置或外部资源才能渲染的特性（如需安装额外 icon pack 的图标，除非项目已配置）。

不再默认禁止：

- 在目标环境已验证可用的前提下使用 C4 图类型（C4Context、C4Container、C4Component、C4Dynamic、C4Deployment）；
- 在目标环境已验证可用的前提下使用 `architecture-beta`；
- 使用 Mermaid frontmatter 或初始化 directive（如目标 Mermaid 版本支持）。

## 创建与验证流程

1. 从已批准内容提取节点、关系、顺序、状态或基数，不在图中新增产品语义。
2. 选择最小可表达的图类型和方向。
3. 按 `common-mermaid-syntax-rules.md` 生成可移植语法。
4. 对照正文检查节点、连线、标签和结果是否完整一致。
5. 执行可用的最高级别验证：
   - Level 1：静态结构检查 → 记录为"静态检查通过"；
   - Level 2：Mermaid CLI 语法解析 → 记录为"CLI 语法解析通过"；
   - Level 3：Mermaid CLI 实际 SVG 渲染 → 记录为"CLI 渲染通过"；
   - Level 4：Kiro Markdown Mermaid Preview 实际视觉检查 → 记录为"Preview 渲染通过"。
6. 验证失败时先修复；无法修复则移除 Mermaid 块并保留正文或表格，不得写入已知无效图表。

验证环境优先级：

- 如果最终目标是 DOCX/PDF 交付：Mermaid CLI SVG 渲染（Level 3）必须通过；
- 如果只是 Kiro 内部 Markdown 使用：至少完成静态检查（Level 1），条件允许时执行 Mermaid CLI 验证（Level 2）；
- 无法执行 Mermaid CLI 时必须明确标记"未执行真实渲染验证"。

## Mermaid 能力验证

使用高级 Mermaid 图类型（C4、architecture-beta 等）前，应判断目标环境是否支持：

1. **第一层**：Kiro Mermaid Preview 是否支持；
2. **第二层**：项目 Mermaid CLI 是否能够 parse/render；
3. **第三层**：如果两者均通过，则允许使用该图类型。

如果无法确认目标环境支持：

- 不直接假设支持；
- 可使用项目 Mermaid CLI 执行最小语法验证；
- 如果无法执行 Mermaid CLI，则明确标记"未执行真实渲染验证"；
- 必要时降级为已验证的稳定 Mermaid 语法（flowchart + subgraph）。

## 来源说明

本规范以 Mermaid 官方语法文档为技术依据，并参考 MIT 许可项目 `axton-obsidian-visual-skills` 的图表选择与常见错误思路后按本仓职责重写；外部规则不是本仓语法事实来源。
