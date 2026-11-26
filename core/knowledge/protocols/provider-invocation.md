# Provider 的宿主调用

Provider 来源与锁定规则见[知识读取规则](provider-offline-knowledge.md)。Core 只负责来源锁定、完整性检查和明确支持的知识/文档能力；宿主负责选择工具、执行、权限、等待、重试及验收。不得伪造旧 Plan、阶段、签名回执或权限对象来接通工具。

## 定位真实入口

1. 对项目已锁定实例运行 `loeyae-aidlc provider inspect <instance> --project <root>`，按需投影 `enabled`、`source`、`bindings`、`declaration` 和 `cache.path`。核对启用状态、来源提交/子目录、能力绑定及实际项目技术栈；需要提交信任详情时使用现有 `provider status`。声明匹配不能证明工具已连接、可执行或获准操作。
2. `cache.path` 是裸 Git 对象缓存，不是可运行目录。确需本地 CLI 时，按下述[准备步骤](#从裸缓存准备可执行包)读取锁定包并物化；不能用活动分支或未锁定来源顶替。依赖安装、网络和外部写入按既有授权执行，包声明不能自行扩大权限。
3. 依据包实际文档选择入口。对外部声明先发现宿主真实工具及当前参数，再按已授予权限调用；声明中的服务名或工具名不能代替工具可用性。纯声明的占位脚本不是能力实现。
4. 保留真实命令/工具、输入版本、输出与退出状态。检查结果契约、适用范围和实际产物；退出码 0、空检查、不适用、知识已读均不能证明目标通过。可修复问题继续返修和必要复验；结果未知按[外部操作恢复](project-continuity.md#外部操作结果恢复)处理。

## 从裸缓存准备可执行包

使用 inspect 返回的 `source.commit_oid`，不要再次解析 `requested_ref`。下列 `<tree>` 在 `source.subdir` 非空时是 `<commit_oid>:<subdir>`，否则是 `<commit_oid>^{tree}`；`<cache>` 是 `cache.path`。将路径作为独立命令参数传入宿主工具，不拼接成待执行的脚本文本。

1. 用 `git --git-dir "<cache>" ls-tree -r -z "<tree>"` 在本地解析所选子树的路径、模式与 blob OID，只输出相关入口及异常摘要。物化前排除越界路径和目标平台的重名冲突；普通文件模式为 `100644`/`100755`。发现符号链接 `120000` 或子模块 `160000` 时先核实其实际目标、独立锁定来源和授权，不直接解包、跟随链接或自动初始化子模块。
2. 从这份清单定位 README 和 `declaration.entrypoint.path`，用 `git --git-dir "<cache>" cat-file blob "<blob-oid>"` 读取实际内容，按任务需要展开参数与依赖说明。README 缺失时查看包已有说明或入口帮助；仍不能确定协议时保留能力缺口，不猜参数或运行占位脚本。
3. 选定任务拥有且尚不存在的候选目录，确认解析后的目标仍在约定工作区内，再创建。只物化上述锁定子树，不覆盖既有目录；可使用宿主已有的字节保持检出方式，或 `git --git-dir "<cache>" archive --format=tar --output="<新归档文件>" "<tree>"` 后解包到该目录。归档文件也必须是新路径；读取/复制 blob 时使用字节流，避免文本重定向改变换行或编码。
4. 对照所选子树核对候选目录的缺失、多余文件及实际字节，运行依赖同样覆盖。普通文件可用 `git --git-dir "<cache>" hash-object --no-filters -- "<候选文件>"` 与原 blob OID 比较。`git archive` 的 `export-ignore`/`export-subst` 可能省略或改写文件；出现差异时改用锁定 blob 字节或等价的宿主检出方式，不能把差异当作通过。复用相关输入未变的核对结果，不扫描其他项目目录。
5. 按锁定包说明调用候选目录中的真实入口，将本次业务项目和明确输入作为参数。保留调用与产物依据，按原验收检查结果；以上准备过程不产生新的 AIDLC 状态、许可或执行回执。

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
