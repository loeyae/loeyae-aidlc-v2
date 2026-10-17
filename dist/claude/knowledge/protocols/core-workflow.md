# AI-DLC 核心工作流

## 启动

每个新 workflow 从用户明确的工作描述开始：

```bash
loeyae-aidlc orchestrate next --scope <scope> --work "<明确工作目标>"
```

控制面仅为：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

`next` 返回一个当前 directive；Agent 读取其阶段文件、产物要求与 `handoff_prompt` 后执行当前工作。directive 的 `rule_load_plan.load_now` 指明当前应加载的阶段规则（当前阶段及已选依赖），`deferred` 列出已选但留待后续交接的规则；`orchestrate state rules [--module <id>]` 可只读查看完整计划。它不是执行豁免：阶段图、审批、`requires`、产物、sensor、evidence 和 Provider gate 仍由 engine 强制执行。

directive 的 `evidence_reuse_plan` 是同样只读的 evidence 调度建议；`orchestrate state evidence [--module <id>]` 可查看。`reuse` 仅表示可读取既有 evidence，`verify` 表示 mandatory gate 仍须由正常 sensor/gate 明确复验，`revalidate` 表示必须重新产证。计划只查看当前 stage instance 的规范 evidence 路径，并要求受控 producer、严格时间、instance/module/unit、source revision 和 checker provenance 全部匹配；它绝不写 evidence、绝不通过 report，也绝不绕过 gate。

## 路由与实例

阶段图定义 project、module 和 unit 轴的依赖。完整 scope 的 `workspace-detection` 要求用户选择 `single-module` 或 `multi-module`，通过：

```bash
loeyae-aidlc orchestrate report \
  --stage workspace-detection \
  --result completed \
  --instruction-ack workspace-detection \
  --user-input <choice>
```

module manifest 与 unit manifest 生成后，成员使用 `unit select` 记录开发分工。当前 state 中的阶段 history、module/unit 上下文和 manifests 决定路由。

## Agent 执行

AI-DLC 只定义阶段依赖、产物、追溯、真实证据、质量与审批门禁，以及精确 workflow/session/generation 的写入权限。宿主自行选择执行者、模型、上下文、并行和委派方式；AI-DLC 不要求额外执行结果格式或子代理日志。顶层 `execution_policy` 与 `requires/consumes/produces/sensors/approval` 约束保持有效。只有持有当前 WorkflowRef 精确领取的会话可以发布受管产物和推进 state/audit；人类显式交接后旧会话失去写入权限。

宿主可自由委派；共享状态和受管发布仍须遵守领取与人类显式交接规则。

## 阶段完成

普通阶段：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
```

instruction-only 阶段：

```bash
loeyae-aidlc orchestrate report \
  --stage <slug> --result completed --instruction-ack <slug>
```

应用设计和部署决策：

```bash
loeyae-aidlc orchestrate report \
  --stage <slug> --result approved --user-input Approve
```

完成前必须满足 consumes、produces、requires、condition 和 sensor。条件不适用的阶段由引擎记录为 `condition_skipped`。

## Evidence 与交付

受控 Evidence 记录 source revision、执行结果和 sensor 输出。review evidence 必须覆盖实际改动路径；build/test evidence 必须来自真实命令。worktree merge plan 只提供人工合并建议，绝不自动 merge 或 push。

## 文档图表格式

阶段需要画图时（复杂结构、分支/循环、多方时序、状态迁移或层级关系明显优于文字/表格），按以下规则确定格式：

1. 默认 Mermaid：直接在目标 Markdown 中写 `mermaid` fenced block，按 `common-mermaid-diagram-standards.md` 与 `common-mermaid-syntax-rules.md` 编写；语法由 `diagram-contract` 用 loeyae-aidlc 自带的 Mermaid parser 校验（只解析，不渲染）。不生成 `.svg`、`.diagram.json`、expected contract 或 Provider Request，也不调用 `aidlc-diagram-design`，不做浏览器渲染验证。
2. SVG 仅在用户明确指定时使用：用户明确要求 SVG 时，先记录用户选择：

   ```bash
   loeyae-aidlc orchestrate diagram-format --set svg --user-input "<用户原话>"
   ```

   之后才准备 Diagram Request（`output_format: svg`）调用 `aidlc-diagram-design`，并按 SVG 标准交付 SVG 源与 `.diagram.json`；只有用户要求 `preview`、`render` 或 `export` 时才调用 Provider。不得替用户选择 SVG；用户要求改回时以 `--set mermaid` 记录。
3. 以下情况都不构成 SVG 要求：目标文档已引用 SVG（可能是外部资产）、目录中存在 `.svg`、阶段声明了 `diagram-contract` 传感器、阶段文档中的 SVG 模板或示例。

选择记录在 `aidlc/active/aidlc-state.md` 的 `Diagram Format` 字段（缺省为 mermaid），并写入 audit；`orchestrate diagram-format` 不带参数时显示当前格式，directive 的 `diagram_format` 字段同步给出。`diagram-contract` 按该字段判定：mermaid 时只检查 Mermaid（`source_format: mermaid`）——阶段文档（requirements-methods 的 `requirements/business-flows.md`、application-design 的 `application-design/component-dependency.md`）必须至少有一个 `mermaid` 代码块，每个代码块须闭合、声明图类型（flowchart/graph 的方向合法）、包含节点或关系，并通过 Mermaid parser；范围内的 `.diagram.json` 或 SVG 文件不触发 SVG 校验。svg 时执行完整 SVG 契约，Mermaid 证据会被门禁拒绝。格式一经确定不得因工具失败静默切换，需要切换时取得用户明确指示。

## 交接与暂停

每个 directive 和成功 report 返回 `handoff_prompt`。必须原样展示它。用户明确要求暂停时执行 `orchestrate park`；使用 `next --resume` 恢复。
