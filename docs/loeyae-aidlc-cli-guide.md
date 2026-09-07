# loeyae-aidlc CLI 使用手册

本文集中说明 `loeyae-aidlc` 当前提供的全部命令、常用参数、典型操作流程和安全边界。安装平台本身的详细步骤见 [Loeyae AI-DLC v2 安装与 Kiro IDE 使用指南](loeyae-aidlc-v2-installation.md)，自然语言触发方式见 [AI-DLC 能力关键词与提示词指南](ai-dlc-keyword-guide.md)。

## 1. 快速索引

| 目标 | 命令 |
|---|---|
| 查看总帮助 | `loeyae-aidlc help` |
| 查看版本 | `loeyae-aidlc version` |
| 列出支持平台 | `loeyae-aidlc install --list` |
| 安装 Kiro Crew | `loeyae-aidlc install` |
| 自动安装已检测平台 | `loeyae-aidlc install --all` |
| 启动 AI-DLC 工作流 | `loeyae-aidlc orchestrate next --scope feature` |
| 启动并选择生成 PRD | `loeyae-aidlc orchestrate next --scope feature --with-prd` |
| 获取当前阶段 | `loeyae-aidlc orchestrate next` |
| 查看工作流状态 | `loeyae-aidlc orchestrate next --status` |
| 报告阶段完成 | `loeyae-aidlc orchestrate report --stage <slug> --result completed` |
| 暂停工作流 | `loeyae-aidlc orchestrate park` |
| 恢复工作流 | `loeyae-aidlc orchestrate next --resume` |
| 生成构建测试证据 | `loeyae-aidlc evidence run --stage build-and-test` |
| 运行内置语义检查 | `loeyae-aidlc check --sensor <name>` |
| 导出 Markdown 为 Word | `loeyae-aidlc export md <file.md> --to docx` |
| 导出 Markdown 为 PDF | `loeyae-aidlc export md <file.md> --to pdf` |
| 导出 SVG 为 PNG | `loeyae-aidlc export svg <file.svg> --to png` |
| 只读检查已有 DOCX | `loeyae-aidlc docx inspect <file.docx> --json` |
| 预估 DOCX 美化覆盖率 | `loeyae-aidlc docx beautify <file.docx> --dry-run --json` |
| 验证 DOCX styles-only 输出 | `loeyae-aidlc docx validate <output.docx> --against <input.docx>` |
| 构建单个平台分发物 | `loeyae-aidlc build --harness <name>` |
| 验证阶段图谱 | `loeyae-aidlc graph validate` |

## 2. 命令约定

本文使用以下记号：

- `<value>`：必填值，例如 `<stage>`。
- `[option]`：可选参数。
- `...`：参数可以重复，例如多个 `--strip` 或 `--command-id`。
- 路径可以使用绝对路径或相对于当前工作目录的路径；涉及工作流状态和 Evidence 时，建议先进入业务项目根目录。
- 含空格的路径或文本必须使用引号包裹。

以下命令依赖当前工作目录代表业务项目根目录：

- `orchestrate`
- `approve`
- `evidence`
- `check`
- `diagram-provider`
- `hook`（由宿主自动调用）

示例：

```bash
cd /absolute/path/to/business-project
loeyae-aidlc orchestrate next --scope feature
```

`export` 根据输入文件位置解析 Markdown 内的相对图片路径；仍建议传入绝对输入路径，以避免从错误目录导出同名文件。

## 3. 帮助和版本

### 3.1 总帮助

以下写法等价：

```bash
loeyae-aidlc help
loeyae-aidlc --help
loeyae-aidlc -h
loeyae-aidlc
```

总帮助列出公开命令和安装参数。导出命令和 DOCX 独立能力另提供完整子命令帮助：

```bash
loeyae-aidlc export --help
loeyae-aidlc docx --help
```

### 3.2 版本

以下写法等价：

```bash
loeyae-aidlc version
loeyae-aidlc --version
loeyae-aidlc -v
```

## 4. 安装与卸载

### 4.1 支持的平台

```bash
loeyae-aidlc install --list
```

当前支持以下 harness 名称：

| Harness | 用途 |
|---|---|
| `kiro-crew` | Kiro Crew Dashboard 全局 Skill；默认值 |
| `kiro-ide` | Kiro IDE，与 Kiro CLI 共用全局 Agent Skill |
| `kiro-cli` | Kiro CLI，与 Kiro IDE 共用全局 Agent Skill |
| `claude` | Claude Code 官方插件 |
| `opencode` | OpenCode 全局插件 |
| `codex` | Codex 全局 Skill 和生命周期 Hook |
| `codebuddy` | WorkBuddy Enterprise / CodeBuddy 官方插件 |
| `qoder` | Qoder CN IDE / Desktop / CLI 本地插件，并合并对应宿主 MCP 配置 |
| `zcode` | ZCode 用户 Skill、Hook 和 MCP 配置 |

### 4.2 安装语法

```text
loeyae-aidlc install [--harness <name>] [--target <path> | --project <path>]
                      [--all] [--list] [--migrate-legacy]
```

| 参数 | 说明 |
|---|---|
| `--harness <name>` | 指定平台；省略时默认为 `kiro-crew` |
| `--project <path>` | Kiro IDE/CLI 的项目 Hook 根目录，或 CodeBuddy/Qoder 的 project scope |
| `--target <path>` | 专用 bundle 安装目录；Claude 中专门表示项目根目录 |
| `--all` | 检测本机宿主，只安装已检测到的平台 |
| `--list` | 仅列出平台；不能和其他安装参数组合 |
| `--migrate-legacy` | 迁移可识别的旧版、无 ownership manifest 安装，并保留备份 |

参数组合约束：

- `--all` 不能和 `--harness`、`--target`、`--project` 组合，但可以和 `--migrate-legacy` 组合。
- `--target` 和 `--project` 互斥。
- `--project` 必须同时指定 `--harness kiro-ide`、`kiro-cli`、`codebuddy` 或 `qoder`。
- `--migrate-legacy` 只适用于 `install`。
- 除 Claude 外，不要把业务项目根目录传给 `--target`。非 Claude 的 `--target` 是专用 bundle 目录，不等同于 project scope，也不会代替 CodeBuddy、Qoder 或 ZCode 的宿主注册。
- 非空且不受安装器管理的目标会 fail-closed，不会递归清空。

常用安装示例：

```bash
# 默认安装 Kiro Crew
loeyae-aidlc install

# 安装单个平台
loeyae-aidlc install --harness kiro-ide
loeyae-aidlc install --harness kiro-cli
loeyae-aidlc install --harness claude
loeyae-aidlc install --harness opencode
loeyae-aidlc install --harness codex
loeyae-aidlc install --harness codebuddy
loeyae-aidlc install --harness qoder
loeyae-aidlc install --harness zcode

# 为 Kiro 项目安装 Stop Hook
loeyae-aidlc install --harness kiro-ide --project /absolute/path/to/project
loeyae-aidlc install --harness kiro-cli --project /absolute/path/to/project

# 为宿主安装 project scope 插件
loeyae-aidlc install --harness codebuddy --project /absolute/path/to/project
loeyae-aidlc install --harness qoder --project /absolute/path/to/project

# Claude 的 --target 是专用例外：参数表示项目根目录
loeyae-aidlc install --harness claude --target /absolute/path/to/project

# 自动检测并安装
loeyae-aidlc install --all

# 显式迁移旧版受支持目标
loeyae-aidlc install --all --migrate-legacy
loeyae-aidlc install --harness kiro-ide --migrate-legacy
```

Qoder CN IDE、Qoder Desktop 与 CLI 共用发行资产，但安装方式不同。user scope 始终把原生 Skill 受管安装到 `~/.qoder-cn/skills/loeyae-aidlc/`。检测到 `qoder` CLI（或 `QODER_CLI`）时，安装器还通过官方 `qoder plugins` 注册插件；只检测到 Qoder CN Desktop 时，安装器跳过插件/Stop Hook 注册，但仍安装原生 Skill 并直接合并 MCP。直接 HTTP 配置写入 `~/.qoder/settings.json`，固定 `mcp-remote@0.8.3` STDIO bridge 的 CN 配置写入 Windows `%USERPROFILE%\.qoder-cn\mcp.json`（macOS/Linux 继续使用对应 Application Support/XDG 默认路径）。同名用户服务始终保留，不会被默认值覆盖；卸载时受管 Skill 与 staging 删除，共享 MCP 服务保留。未受管的手工 Skill 首次接管需使用 `--migrate-legacy`，原目录会保留为备份。

Qoder CN IDE 官方仅声明支持 STDIO/SSE，要求 2.5.0 或更高版本，并且 MCP 仅在 Agent 模式配合 Qwen3 使用。升级后必须完全退出并重启，确认 `%USERPROFILE%\.qoder-cn\skills\loeyae-aidlc\SKILL.md` 已加载，并在头像菜单 **Your Settings → MCP tools** 中确认 `loeyae-skills`、`awesome-design`、`figma`、`ssot` 可见。Figma 需单独完成 OAuth；SSOT 要求启动宿主前设置 `SSOT_API_KEY`。Desktop/CLI 分别使用 **Settings → MCP**（新版 **Extensions → Connectors**）和 `/mcp` 验证。`install --all` 会通过 Windows App Paths/卸载注册表、默认安装位置、已有 `.qoder-cn` 配置目录或 macOS App bundle 独立识别 Qoder CN Desktop；只有项目 scope、插件和 Stop Hook 注册要求 `qoder` CLI。`%USERPROFILE%\.agents\skills\loeyae-aidlc\SKILL.md` 可见不代表 Qoder harness 或 MCP 已安装。非标准配置路径可用 `QODER_CONFIG_DIR`、`QODER_CN_MCP_CONFIG` 覆盖。CodeBuddy 不在 PATH 时可设置 `CODEBUDDY_CLI`；Windows 的 `codebuddy` 自动探测还会检查 `%LOCALAPPDATA%\Programs`、`%LOCALAPPDATA%`、`%ProgramW6432%`、`%ProgramFiles%` 和 `%ProgramFiles(x86)%` 下的 WorkBuddy/CodeBuddy 内嵌 CLI。

### 4.3 卸载语法

```text
loeyae-aidlc uninstall [--harness <name>] [--target <path> | --project <path>] [--all]
```

卸载只移除 ownership manifest 中记录且哈希仍匹配的资产。用户修改过的文件、额外文件、无所有权记录的目标都会保留并返回错误或提示。

```bash
# 卸载默认 Kiro Crew 安装
loeyae-aidlc uninstall

# 卸载指定平台
loeyae-aidlc uninstall --harness opencode
loeyae-aidlc uninstall --harness codex
loeyae-aidlc uninstall --harness zcode

# 卸载项目级 Hook 或插件
loeyae-aidlc uninstall --harness kiro-ide --project /absolute/path/to/project
loeyae-aidlc uninstall --harness codebuddy --project /absolute/path/to/project
loeyae-aidlc uninstall --harness qoder --project /absolute/path/to/project

# 只卸载安装器拥有的全局或 user scope 安装
loeyae-aidlc uninstall --all
```

`uninstall --all` 不会推断 CodeBuddy/Qoder 的原始项目路径，因此 project scope 必须显式指定 `--harness` 和 `--project`。

## 5. 工作流编排：`orchestrate`

### 5.1 子命令

```text
loeyae-aidlc orchestrate next [--scope <scope>] [--with-prd] [--status] [--resume]
loeyae-aidlc orchestrate report --stage <slug> --result <result> [options]
loeyae-aidlc orchestrate park
```

`orchestrate` 输出 JSON directive。常见 `kind` 包括：

| kind | 含义 |
|---|---|
| `run-stage` | 执行指定 stage，并满足其 consumes、produces 和 sensors |
| `ask` | 需要用户输入，例如首次未指定 scope |
| `print` | 状态或操作成功信息 |
| `error` | 门禁失败或参数错误；修复后重试，不能改 state 绕过 |
| `parked` | 工作流已暂停 |
| `done` | 工作流已完成 |

运行时 choice Stage 还会返回 `choices: string[]` 和 `choice_required: true`。这不是初始化参数；必须向用户展示这些值，并在完成当前 Stage 时用 `--user-input` 精确回传其中一个。

### 5.2 Scope

首次创建工作流时使用 `--scope`：

```bash
loeyae-aidlc orchestrate next --scope feature
```

合法 scope：

| Scope | 当前候选阶段数 | 典型用途 |
|---|---:|---|
| `feature` | 45 | 完整功能开发 |
| `enterprise` | 45 | 企业级完整流程 |
| `mvp` | 45 | 最小可行产品 |
| `classic` | 43 | 标准开发流程 |
| `express` | 7 | 快速迭代或小改动 |
| `workshop` | 7 | 工作坊或探索 |
| `bugfix` | 7 | Bug 修复 |
| `refactor` | 7 | 代码重构 |
| `poc` | 7 | 概念验证 |

阶段数以当前图谱为准，可随版本调整。表中为未选择 PRD 的默认数量；在 `feature`、`enterprise`、`mvp`、`classic` 新建工作流时添加 `--with-prd`，会额外选择 `prd-generation`：

```bash
loeyae-aidlc orchestrate next --scope feature --with-prd
```

PRD 默认不进入工作流，也不阻断 Inception。选择结果写入签名状态的 `selected_optional_stages`，只能在初始化时确定；活动工作流不能中途添加或移除。未启动工作流时，用户也可以直接调用 `aidlc-prd-synthesis` 独立生成 PRD。

不要混用三类路由决定：PRD 是新工作流初始化选项；架构模式是完整 scope 到达 `workspace-detection` 后报告的 `single-module / multi-module` choice；UI choice 只在引擎实际返回 `ui-mock` directive 后报告。两种运行时 choice 都通过当前 Stage 的 `report --user-input` 写入签名 history。

随时运行以下命令查看默认值：

```bash
loeyae-aidlc scope-table
```

首次 `next --scope` 初始化状态后，再运行一次 `next` 获取第一条 `run-stage` directive：

```bash
loeyae-aidlc orchestrate next --scope feature
loeyae-aidlc orchestrate next
```

如果省略 scope 且没有现有工作流，引擎返回 `ask` directive，不会自行选择。

### 5.3 查看状态和获取下一阶段

```bash
# 查看状态，不推进阶段
loeyae-aidlc orchestrate next --status

# 获取或重新读取当前应执行阶段
loeyae-aidlc orchestrate next
```

工作流机器状态位于业务项目的 `docs/aidlc/aidlc-state.json`。该文件具有签名、workflow ID 和 revision 保护，不应手工编辑。

### 5.4 报告阶段结果

```text
loeyae-aidlc orchestrate report --stage <slug> --result <result>
                                [--module <module-id>]
                                [--unit <unit-id>]
                                [--instruction-ack <slug>]
                                [--approval-token <token>]
                                [--user-input <text>]
```

合法 result：

| Result | 用途 |
|---|---|
| `completed` | 普通阶段完成；引擎校验 consumes、produces 和 sensors 后推进 |
| `approved` | 仅用于 `approval: block` 阶段；必须提供有效一次性 token |
| `rejected` | 记录审阅拒绝，当前阶段保持活动状态 |
| `revised` | 记录已修订，当前阶段保持活动状态，之后仍需报告 `completed` 或 `approved` |

普通阶段：

```bash
loeyae-aidlc orchestrate report \
  --stage requirements-analysis \
  --result completed
```

instruction-only 阶段必须确认已实际执行正文。以下是不要求架构 choice 的快速 scope `workspace-detection` 示例；完整 scope 使用下方带 `--user-input` 的命令：

```bash
loeyae-aidlc orchestrate report \
  --stage workspace-detection \
  --result completed \
  --instruction-ack workspace-detection
```

完整 scope 的第一个 Stage `workspace-detection` 要求签名架构 choice：

| `--user-input` | 产品级路由 |
|---|---|
| `single-module` | 跳过产品级 Inception，登记唯一模块；仅有跨边界事实时执行产品契约 |
| `multi-module` | 执行产品级 Inception、模块划分和产品契约 |

```bash
loeyae-aidlc orchestrate report \
  --stage workspace-detection \
  --result completed \
  --instruction-ack workspace-detection \
  --user-input single-module
```

`express`、`workshop`、`bugfix`、`refactor`、`poc` 不包含产品级路由，因此该 Stage 返回空 `choices`，只需 instruction ack，不强迫无关选择。旧签名工作流缺少架构 choice 时，才从模块清单和已经执行的产品分支保守推断。

I9 `ui-mock` 同时是 instruction-only runtime choice Stage。允许值及路由如下：

| `--user-input` | 后续路由 |
|---|---|
| `html-mock` | 共同页面规划后只执行 HTML Mock 分支 |
| `figma-create` | 共同页面规划后创建 Figma |
| `figma-existing` | 共同页面规划后使用已有 Figma |
| `skip` | 不生成 UI 产物，跳过页面规划及两个生成分支 |

```bash
loeyae-aidlc orchestrate report \
  --stage ui-mock \
  --result completed \
  --instruction-ack ui-mock \
  --user-input skip
```

缺少 `--user-input` 或传入 directive `choices` 之外的值会被拒绝。选择写入受 HMAC、workflow ID、revision/CAS 保护的签名 history；不得用 `handoff.md` 或手工 state 修改切换分支。

选择 `html-mock`、`figma-create` 或 `figma-existing` 后，directive 会依次要求当前模块的 `page-plan.md` 与 `ui-artifact-consistency` Evidence，再要求 `ui-mock-manifest.json`（skeleton/content 均 validated）或 `figma-manifest.json` 及对应 Evidence。`cross-validation` 会按签名选择动态加入这些 canonical 产物；选择 PRD 时还会加入 `prd.md` 与 `prd-completeness` Evidence。未选择 PRD/UI、UI condition=false 或选择 `skip` 时，这些 consumes、produces、sensor 和 Evidence 均不出现。`code-review` 同样只在已选 UI 模块保留 `ui-design-alignment`；最终 `implementation-report` 必须显式覆盖全部模块和所有已选 PRD/UI Evidence。

记录用户输入或审阅原因时，对含空格文本使用引号：

```bash
loeyae-aidlc orchestrate report \
  --stage application-design \
  --result rejected \
  --user-input "需要补充回滚边界"

# 完成修改后记录已修订，再按阶段类型完成或审批
loeyae-aidlc orchestrate report --stage application-design --result revised
```

`--stage` 必须等于签名状态中的当前逻辑 Stage，且引擎始终以 `current_stage_instance` 校验真实上下文。`--module` / `--unit` 可选；提供时必须与当前实例完全一致，适合 CI 防止把报告提交到同 slug 的其他模块/单元。公开结果不支持手工 `skipped`；只有图谱 condition 为 false 时，引擎才会自动记录内部 condition skip。

`workflow-plan.md` 必须为 `application-design`、`units-generation`、`functional-design` 和 `operations` 写入 `execute / skip` 与 evidence。引擎优先使用这些机器决策；旧工作流缺行时才按项目证据保守推断。跳过 I14 时使用确定性的 `default` 单元。I14 执行时，新签名工作流的 `unit-manifest.json` 必须为每个单元提供 `conditional_stages`（允许空数组），只让当前单元适用的功能设计、NFR、基础设施、共享契约、子代理、框架合规和 UI Bridge 条件 Stage 执行；旧清单缺字段时保守回退模块级条件。Operations condition=false 时不出现审批；`operations-templates` 仅在明确要求保留可复用模板时执行。

`run-stage` directive 会返回 `stage_instance`、`axis`、`module_id`、`unit_id`、`artifact_root`、已替换占位符的 `consumes`/`produces` 及 `evidence_root`。自动化和 Agent 应直接使用这些字段，不要从 Stage 正文中的抽象路径自行猜测上下文。

### 5.5 暂停和恢复

```bash
# 保存当前状态并暂停
loeyae-aidlc orchestrate park

# 在之后的会话恢复
loeyae-aidlc orchestrate next --resume
```

已 parked 的工作流在没有 `--resume` 时只返回 `parked` directive。

### 5.6 内部 `continue`

```text
loeyae-aidlc orchestrate continue <token>
```

`continue` 是兼容旧 steering chain 的内部传输命令，只确认 token 并提示 Agent 直接加载 stage 文件。普通用户和自动化脚本不应依赖它推进工作流。

## 6. 人工审批：`approve`

只有 condition 判定需要执行的 `application-design` 和 `operations` 实例是阻断审批阶段；condition=false 的实例会先写入 `condition_skipped`，不会创建 challenge。

```text
loeyae-aidlc approve --stage <slug>
```

审批必须在业务项目根目录的交互式人类终端中执行：

```bash
loeyae-aidlc orchestrate next
loeyae-aidlc approve --stage application-design
```

命令会显示一条必须精确输入的确认短语。通过后输出 JSON，其中包含 `approval_token` 和剩余有效秒数。把 token 用于当前阶段：

```bash
loeyae-aidlc orchestrate report \
  --stage application-design \
  --result approved \
  --approval-token <token>
```

也可以由受信宿主通过一次性环境变量传递：

```bash
AIDLC_APPROVAL_TOKEN=<token> \
  loeyae-aidlc orchestrate report --stage application-design --result approved
```

约束：

- Stage slug 必须是当前活动逻辑 Stage，并已由 `orchestrate next` 为当前 `stage_instance` 创建 challenge。
- challenge/token 最长有效 15 分钟。
- token 绑定 workflow、`stage_instance` 和 challenge；模块级 `application-design` 的每个实例单独审批，成功消费后不可重放。
- 非交互终端不能签发 token。
- 普通聊天中的“同意”不能替代 token。

## 7. Evidence Producer：`evidence run`

### 7.1 语法

```text
loeyae-aidlc evidence run --stage <stage>
                           [--sensor <sensor>]
                           [--config <path>]
                           [--output <canonical-path>]
                           [--command-id <id> ...]
```

默认配置文件是业务项目根目录的 `.aidlc/evidence-commands.json`。Evidence 工作流必须在第一次 `orchestrate next` 前安全注入至少 32 字节的稳定 `AIDLC_TRUST_SECRET`，并保证 orchestrator、Producer、Hook 或 CI 使用相同值。不要把 secret 写入仓库。

### 7.2 构建和测试证据

```bash
loeyae-aidlc evidence run --stage build-and-test
```

默认输出：

```text
.aidlc/evidence/build-and-test/build-test-evidence.json
```

只执行 allowlist 中指定命令时可重复传 `--command-id`，但最终选择仍必须同时包含 `build`、`test` 和 `check` 三种角色：

```bash
loeyae-aidlc evidence run \
  --stage build-and-test \
  --command-id app-build \
  --command-id unit-test \
  --command-id type-check
```

最小配置结构示例：

```json
{
  "version": "1",
  "stage": "build-and-test",
  "commands": [
    {
      "id": "app-build",
      "role": "build",
      "argv": ["npm", "run", "build"]
    },
    {
      "id": "unit-test",
      "role": "test",
      "argv": ["npm", "test"]
    },
    {
      "id": "type-check",
      "role": "check",
      "argv": ["npm", "run", "typecheck"]
    }
  ],
  "artifacts": [
    {
      "id": "application-bundle",
      "path": "dist/application.js"
    }
  ]
}
```

`argv` 直接执行，不经过 shell；可执行文件不能是绝对路径或包含路径穿越和 shell 语法。测试命令输出必须包含可解析的 passed/failed/skipped 数量。`artifacts` 只能引用已存在的普通非符号链接文件。

### 7.3 语义 Evidence

```bash
loeyae-aidlc evidence run \
  --stage code-review \
  --sensor review-evidence
```

语义命令必须精确声明内置 checker，不能替换成项目内任意 Node、Python 或 shell 脚本：

```json
{
  "version": "1",
  "stage": "code-review",
  "commands": [
    {
      "id": "review-checker",
      "role": "semantic",
      "sensor": "review-evidence",
      "argv": ["loeyae-aidlc", "check", "--sensor", "review-evidence"]
    }
  ]
}
```

默认输出由当前签名状态决定：项目级为 `.aidlc/evidence/<stage>/<sensor>.json`，模块级为 `.aidlc/evidence/<stage>/<module-id>/<sensor>.json`，单元级为 `.aidlc/evidence/<stage>/<module-id>/<unit-id>/<sensor>.json`。`--output` 仅用于显式确认当前实例的规范路径，不能把 Evidence 写到任意位置。Producer 会拒绝 `--stage` 与当前活动 Stage 不一致的调用，并把 `stage_instance`、`module_id`、`unit_id` 写入 Evidence。

### 7.4 支持的语义 sensor

- `review-evidence`
- `test-quality`
- `contract-baseline`
- `functional-design-completeness`
- `nfr-coverage`
- `infrastructure-completeness`
- `implementation-report`
- `frontend-platform-spec`
- `framework-compliance`
- `subagent-evidence`
- `template-completeness`
- `recovery-evidence`
- `prd-completeness`
- `diagram-contract`
- `design-intent-coverage`
- `ui-design-alignment`
- `ui-artifact-consistency`
- `inception-consistency`

## 8. 直接语义检查：`check`

```text
loeyae-aidlc check --sensor <semantic-sensor>
```

示例：

```bash
loeyae-aidlc check --sensor prd-completeness
loeyae-aidlc check --sensor diagram-contract
loeyae-aidlc check --sensor review-evidence
```

该命令从当前业务项目读取规范产物并输出 checker JSON，适合本地诊断。它本身不生成带完整来源签名的最终 Evidence；正式门禁证据应通过 `evidence run --sensor <name>` 生成。

`check` 支持的 sensor 与上一节的 18 个语义 sensor 相同；`build-test-evidence` 由受控 Evidence Producer 处理，不属于该命令。

## 9. 图表浏览器验证：`diagram-provider`

这是 `diagram-contract` 的高级验证命令，只负责通过 Chrome DevTools 检查已有 SVG，不生成或重新布局图表。

```text
loeyae-aidlc diagram-provider run --request <path>
                                    [--evidence <path>]
                                    [--dry-run]
```

| 参数 | 说明 |
|---|---|
| `--request <path>` | 必填，项目根目录内的 Provider Request JSON |
| `--evidence <path>` | 可选；必须精确等于当前活动 Stage 实例的规范 `diagram-contract.json` 路径；默认从签名 state 的 module/unit 上下文定位 |
| `--dry-run` | 只解析 request 并输出执行计划，不启动浏览器、不写视觉验证结果 |

示例：

```bash
# 先检查请求和目标视口
loeyae-aidlc diagram-provider run \
  --request docs/aidlc/diagrams/provider-request.json \
  --dry-run

# 执行真实浏览器验证
loeyae-aidlc diagram-provider run \
  --request docs/aidlc/diagrams/provider-request.json
```

真实执行前必须满足：

- 源级 `diagram-contract` Evidence 已存在且为 passed。
- 每张图有独立 expected contract 和 actual sidecar。
- request 声明 normal、fit、zoom 三种阅读视口。
- `chrome-devtools` Provider 可用。

Provider 不可用时会记录 `NEEDS_CAPABILITY`；结构或视觉验证失败时记录 `FAIL`，不得把静态检查替代为视觉 PASS。

## 10. 文档和图表导出：`export`

### 10.1 映射关系

只支持三种严格映射：

```text
Markdown -> DOCX
Markdown -> PDF
SVG      -> PNG
```

不支持通过修改扩展名转换为其他格式，也不会在失败时静默降级。

### 10.2 通用语法和参数

```text
loeyae-aidlc export md <input.md> --to <docx|pdf> [options]
loeyae-aidlc export svg <input.svg> --to png [options]
```

| 参数 | 说明 |
|---|---|
| `--output <path>` | 输出路径；默认与输入文件同目录、同主文件名 |
| `--force` | 覆盖已存在的普通输出文件；默认拒绝覆盖 |
| `--browser <path>` | 为 PDF 或 Mermaid 指定 Chrome、Chromium 或 Edge 可执行文件 |

### 10.3 Markdown 参数

| 参数 | 说明 |
|---|---|
| `--strip <keyword>` | 删除标题命中的完整章节，可重复 |
| `--template <docx>` | 导入 Word 模板的样式和页面设置，仅 DOCX |
| `--toc` | 插入生成的目录 |
| `--page-size <name>` | `A4` 或 `Letter`，默认 `A4`；模板设置页面大小时忽略 |

DOCX 示例：

```bash
# 默认同目录输出 document.docx
loeyae-aidlc export md /absolute/path/document.md --to docx

# 目录、模板和章节剥离
loeyae-aidlc export md /absolute/path/document.md \
  --to docx \
  --template /absolute/path/template.docx \
  --toc \
  --strip "内部备注" \
  --strip "修订记录"

# 指定输出并允许覆盖
loeyae-aidlc export md /absolute/path/document.md \
  --to docx \
  --output /absolute/path/output/document.docx \
  --force
```

PDF 示例：

```bash
# 使用自动发现的本机 Chrome、Chromium 或 Edge
loeyae-aidlc export md /absolute/path/document.md --to pdf

# 指定页面和浏览器
loeyae-aidlc export md /absolute/path/document.md \
  --to pdf \
  --page-size Letter \
  --browser /absolute/path/to/browser
```

Markdown 中的 Mermaid fenced block 使用发行包固定版本的本地 Mermaid 脚本渲染，不访问 CDN。本地 SVG 会先转为高分辨率 PNG 后嵌入 DOCX。

### 10.4 SVG 参数

| 参数 | 范围或说明 |
|---|---|
| `--scale <number>` | `0.1` 到 `10`，默认 `1` |
| `--width <pixels>` | 指定 PNG 精确宽度；不能和显式 `--scale` 同时使用 |
| `--dpi <number>` | `72` 到 `600`，默认 `96`，用于 SVG 物理单位 |
| `--background <color>` | CSS 颜色或 `transparent`，默认 `#ffffff` |
| `--font-dir <path>` | 增加本地字体目录，可重复 |

示例：

```bash
# 2 倍缩放
loeyae-aidlc export svg /absolute/path/diagram.svg --to png --scale 2

# 固定宽度、透明背景和自定义字体
loeyae-aidlc export svg /absolute/path/diagram.svg \
  --to png \
  --width 2400 \
  --background transparent \
  --font-dir /absolute/path/to/fonts \
  --output /absolute/path/diagram-2400.png

# 使用 200 DPI 解析 SVG 中的物理单位
loeyae-aidlc export svg /absolute/path/diagram.svg --to png --dpi 200
```

### 10.5 导出安全边界

- 不下载远程图片。
- 不读取 SVG 外部资源。
- 浏览器、Mermaid、图片或格式校验失败时返回非零退出码。
- 使用临时文件和原子替换，失败时不保留半成品。
- PDF 或含 Mermaid 的导出可通过 `--browser`、`AIDLC_CHROME_BIN` 或 `CHROME_BIN` 指定浏览器。
- 导出成功只证明格式和结构检查通过。包含关键图表时仍应打开最终 DOCX/PDF，检查图片、箭头、虚线和文字的真实可见性。

## 11. 已有 Word 文档检查与保守美化：`docx`

`docx` 是 Independent Capability，不调用或推进 46-stage AI-DLC 主状态机，也不更新 state、audit 或 Evidence。处理顺序应为 `inspect → beautify --dry-run → beautify --output → validate --against`。

### 11.1 只读检查

```bash
loeyae-aidlc docx inspect "/absolute/path/input.docx" --json
```

`inspect` 不修改输入，也不访问外部 relationship。报告包含 OPC Part、正文/表格/媒体/批注/修订统计、样式定义、直接默认字体、`default_font_refs` 和 relationship-resolved `theme_fonts`。

### 11.2 Dry-run 与写入

```bash
# 必须先查看角色映射、跳过项和预计有效覆盖率
loeyae-aidlc docx beautify "/absolute/path/input.docx" \
  --preset professional-zh \
  --dry-run \
  --json

# 输出必须与输入不同；默认拒绝覆盖已有文件
loeyae-aidlc docx beautify "/absolute/path/input.docx" \
  --output "/absolute/path/output.docx" \
  --preset professional-zh \
  --json
```

| 参数 | 说明 |
|---|---|
| `--preset professional-zh` | 使用内置中文专业文档样式；当前唯一内置 preset |
| `--style-spec <json>` | 使用严格 allowlist 自定义 Style Spec；与 `--preset` 互斥 |
| `--dry-run` | 不写文件，仅输出样式映射、直接格式影响和 coverage |
| `--output <docx>` | 实际写入时必填，且不能与输入为同一路径或 hardlink |
| `--force` | 事务替换已有普通输出文件；不能与 `--dry-run` 同用 |
| `--json` | 输出 schema version 为 `1` 的机器可读报告 |

自定义 Style Spec 可声明 `schema_version`、`id`、`fonts`、`styles`、`table` 和 `style_map`。其中样式属性只允许预定义的字体、字号、颜色、粗斜体、段落间距/缩进/对齐、分页控制、outline level，以及表格边框/边距/首行底色；未知字段、任意 XML 和超出范围的值均拒绝。

最小示例：

```json
{
  "schema_version": "1",
  "id": "company-zh",
  "fonts": {
    "latin": "Arial",
    "east_asia": "Microsoft YaHei"
  },
  "styles": {
    "normal": {
      "size_pt": 10.5,
      "color": "262626",
      "line_spacing": 1.5,
      "space_after_pt": 6
    },
    "heading1": {
      "size_pt": 18,
      "color": "17365D",
      "bold": true,
      "keep_next": true,
      "outline_level": 0
    }
  },
  "table": {
    "border_color": "B4C6E7",
    "header_fill": "D9EAF7",
    "header_bold": true
  }
}
```

```bash
loeyae-aidlc docx beautify "/absolute/path/input.docx" \
  --output "/absolute/path/output.docx" \
  --style-spec "/absolute/path/company-zh.json" \
  --json
```

### 11.3 静态验证

```bash
loeyae-aidlc docx validate "/absolute/path/output.docx" \
  --against "/absolute/path/input.docx" \
  --json
```

验证要求 Part 集合相同，除 relationship 解析出的 styles Part 外所有 Part 字节完全相同，`document.xml` 和正文文本不变。写入和 validate 通过时状态为 `STATIC_PASS`、`visual_validation` 为 `not_run`；只有 Microsoft Word 或 LibreOffice 的真实打开/渲染另行通过后，才能报告视觉 PASS。

### 11.4 安全边界

- 只修改 styles Part，保留直接格式，不执行 semantic rewrite 或 `document.xml` normalize；
- 不通过 DOCX→Markdown→DOCX 或整包文档模型重建；
- 宏、数字签名、强制文档保护、危险 ZIP/XML、输出 symlink 和原地覆盖均 fail-closed；
- 输出通过同目录临时文件、静态复核、fsync 和原子 rename 提交；`--force` 失败时恢复旧输出或保留备份。

## 12. 构建分发物：`build`

该命令面向本仓库开发和发布，不是业务项目日常命令。

```text
loeyae-aidlc build --harness <name>
loeyae-aidlc build --all
```

示例：

```bash
loeyae-aidlc build --harness kiro-crew
loeyae-aidlc build --harness claude
loeyae-aidlc build --all
```

`--harness` 接受第 4.1 节列出的 harness 名称。构建会先编译 stage graph，并重新生成目标 `dist/<harness>/`；`--all` 重建全部平台分发物。

## 13. 阶段图谱：`graph`

```bash
# 从 core/stages 编译图谱
loeyae-aidlc graph compile

# 校验已编译图谱结构，并检查它是否与源 stage 一致
loeyae-aidlc graph validate
```

编译产物位于发行包的 `core/tools/data/stage-graph.json`。`validate` 发现图谱过期时会提示先运行 `compile`。

## 14. Scope 统计：`scope-table`

```bash
loeyae-aidlc scope-table
```

输出为制表符分隔的 `scope<TAB>候选阶段数`，适合终端查看或脚本解析：

```text
bugfix    7
classic   44
feature   46
...
```

候选阶段数是 condition 求值前的图谱数量，实际执行阶段可能更少。

## 15. 生命周期 Hook：`hook`（内部命令）

```text
loeyae-aidlc hook --format <platform>
```

支持安装产物使用的格式：

- `kiro`
- `claude`
- `codex`
- `codebuddy`
- `zcode`
- `opencode`
- `qoder-cli`

该命令由宿主生命周期配置自动调用，从标准输入读取宿主 JSON，并尝试对当前活动阶段执行完整 `orchestrate report` 门禁。普通用户不应手工执行；安装项目 Hook 或插件后由平台负责触发。

不同宿主的阻断协议不同：Claude-compatible 平台用 JSON `decision: block`，OpenCode/Qoder 使用非零退出码，Kiro 使用普通错误退出。因此自动化不能只用统一退出码解释所有 Hook 结果。

## 16. 环境变量

| 变量 | 用途 |
|---|---|
| `AIDLC_TRUST_SECRET` | 至少 32 字节的稳定签名 secret；Evidence 工作流必须由宿主或 CI 安全注入 |
| `AIDLC_TRUST_DIR` | 覆盖项目外 trust store 目录，适用于隔离测试或受控宿主 |
| `AIDLC_APPROVAL_TOKEN` | 向 `orchestrate report --result approved` 传递一次性审批 token |
| `AIDLC_CHROME_BIN` | 为 PDF 和 Mermaid 导出指定浏览器 |
| `CHROME_BIN` | 浏览器路径兼容变量；优先级低于 `--browser` 和 `AIDLC_CHROME_BIN` |
| `CODEBUDDY_CLI` | 指定 CodeBuddy CLI 路径或命令名 |
| `QODER_CLI` | 指定用于 Qoder CN IDE/Desktop/CLI 插件注册的官方 `qoder` CLI 路径或命令名 |
| `QODER_CONFIG_DIR` | 覆盖 Qoder Desktop/CLI 配置目录；MCP 写入其中的 `settings.json` |
| `QODER_CN_MCP_CONFIG` | 覆盖 Qoder CN IDE 的 `mcp.json` 完整文件路径；Windows 默认 `%USERPROFILE%\.qoder-cn\mcp.json` |
| `KIROCREW_HOME` | 覆盖 Kiro Crew 数据目录，用于宿主检测 |
| `KIROCREW_VENV` | 覆盖 Kiro Crew 托管虚拟环境目录，用于宿主检测 |

不要把 trust secret、审批 token 或宿主凭据写入项目文件、命令文档或提交历史。

## 17. 退出状态和脚本调用

- 成功命令通常返回 `0`。
- `orchestrate` 始终输出 JSON；`kind: error` 时返回非零状态。
- `approve` 和 `evidence` 被门禁阻断时返回非零状态并输出原因。
- `check`、`diagram-provider`、`export`、`docx`、`build`、`graph`、`install` 和 `uninstall` 失败时返回非零状态。
- `install --all` 和 `uninstall --all` 会继续处理其他已选平台，但任一平台失败时最终整体返回非零状态。
- `hook` 遵循宿主协议；Claude-compatible Hook 即使输出 `decision: block` 也可能返回 `0`。

脚本调用 `orchestrate` 时应同时检查进程退出码和 JSON `kind`：

```bash
result="$(loeyae-aidlc orchestrate next)" || exit $?
printf '%s\n' "$result"
```

不要通过脚本直接修改 `docs/aidlc/aidlc-state.json` 或 `.aidlc/evidence/` 来模拟成功。

## 18. 常见问题

### 没有活动工作流

```bash
loeyae-aidlc orchestrate next --scope feature
loeyae-aidlc orchestrate next
```

### 工作流已暂停

```bash
loeyae-aidlc orchestrate next --resume
```

### report 提示 stage mismatch

先查看状态，并使用当前 stage：

```bash
loeyae-aidlc orchestrate next --status
```

不能对非活动 stage 补报或越级 report。

### instruction-only 阶段不能完成

执行 stage 正文后，传入与 stage 相同的确认值：

```bash
loeyae-aidlc orchestrate report \
  --stage <slug> \
  --result completed \
  --instruction-ack <slug>
```

### 审批 challenge 过期

重新运行 `orchestrate next` 获取有效 challenge，然后在交互式终端重新执行 `approve --stage <slug>`。不要重放旧 token。

### Evidence 提示 trust secret 缺失或过短

由宿主、CI 或安全环境注入至少 32 字节的 `AIDLC_TRUST_SECRET`，并确保所有相关进程使用同一个值。若工作流已用另一个 secret 初始化，不要直接切换；应恢复原 secret 或按受控恢复流程处理。

### PDF 或 Mermaid 导出找不到浏览器

```bash
loeyae-aidlc export md /absolute/path/document.md \
  --to pdf \
  --browser /absolute/path/to/chrome-or-edge
```

也可以预先设置 `AIDLC_CHROME_BIN`。

### 输出文件已存在

确认目标文件允许替换后显式使用：

```bash
loeyae-aidlc export md /absolute/path/document.md --to docx --force
```

### 安装器拒绝非空目标

目标没有有效 ownership manifest，或内容已被修改。不要绕过检查或删除业务目录；先确认路径，必要时将可识别旧安装重命名备份，再执行普通安装或显式 `--migrate-legacy`。
