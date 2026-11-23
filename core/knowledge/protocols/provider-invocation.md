# Provider 的宿主调用

Provider 来源与锁定规则见[知识读取规则](provider-offline-knowledge.md)。Core 只负责来源锁定、完整性检查和明确支持的知识/文档能力；宿主负责选择工具、执行、权限、等待、重试及验收。不得伪造旧 Plan、阶段、签名回执或权限对象来接通工具。

## 定位真实入口

1. 对项目已锁定实例运行 `loeyae-aidlc provider inspect <instance> --project <root>`，取得已验证的提交、子目录、清单、绑定及声明。检查实例启用状态、绑定和实际项目技术栈；声明匹配不能证明工具已连接、可执行或获准操作。
2. `cache.path` 是裸 Git 对象缓存，不是可运行目录。使用宿主 Git 能力只读查看锁定提交中的包 README 和入口；确需本地 CLI 时，在任务拥有的隔离目录物化同一提交/子目录，核对实际文件与锁定来源。不得执行缓存目录、自动安装依赖、切换分支或回退到未锁定包。
3. 依据包实际文档选择入口。对外部声明先发现宿主真实工具及当前参数，再按已授予权限调用；声明中的服务名或工具名不能代替工具可用性。纯声明的占位脚本不是能力实现。
4. 保留真实命令/工具、输入版本、输出与退出状态。检查结果契约、适用范围和实际产物；退出码 0、空检查、不适用、知识已读均不能证明目标通过。可修复问题继续返修和必要复验；结果未知按[外部操作恢复](project-continuity.md#外部操作结果恢复)处理。

## 当前包的入口与边界

| 包/能力 | 实际调用 |
| --- | --- |
| Loeyae Boot `implementation-validation` | 物化后的 `node bin/validate.js --project <root> --files <JSON相对路径数组>`。复用现有静态规则；旧 `--request` 仅供兼容调用方。输出不能替代项目构建、集成或业务验收。 |
| Boot `framework.conventions` | Core `knowledge-catalog / knowledge-load` 读取 v3 知识包；不运行 `offline-only.js`。旧项目须显式更新锁，不能悄悄替换旧版本。 |
| `diagram.visual` | 包的 `bin/inspect.mjs` 接收文档规定的 stdin JSON，使用宿主已安装浏览器。宿主验证实际截图及返回测量，不自动安装浏览器。 |
| `design.resources` | 读取锁定的离线资源和来源说明；`declarative-only.js` 不产生 UI。 |
| `context.search` | 使用宿主已连接的 context-documents MCP，按实际工具 schema 查询；声明包不能证明连接/授权或命中内容有效。 |
| Figma 已有设计 `ui.external-read` | 使用宿主真实 Figma 读取工具及其实际参数、授权；占位脚本不能读取 Figma。 |
| Figma 创建 `ui.create-declaration` | 当前包的 `protocol=unsupported`、空 operations 只表示声明，不能作为可执行创建入口。独立宿主写入工具需另按真实能力及已有授权判断。 |

本表描述入口，不授予权限、不自动消费全部包，也不把 Provider 调用设为阶段门禁。项目原有架构、实现规范、CI 与验收要求继续适用。
