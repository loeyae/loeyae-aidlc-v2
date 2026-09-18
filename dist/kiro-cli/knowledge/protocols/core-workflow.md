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

`next` 返回一个当前 directive；Agent 读取其阶段文件、产物要求与 `handoff_prompt` 后执行当前工作。

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

每个 `run-stage` directive 可附带 `agent_execution`，由 conductor 决定 inline、delegate、pipeline、mob 或 review 执行。persona 从 `agents/<id>.md` 加载；delegate/review 使用宿主原生 subagent 能力，缺少能力时必须显式回退 inline。

Agent 只能返回结构化结果。conductor 使用 `agent validate-result` 验证结果后，才可继续质量门禁和 `orchestrate report`。state/audit、审批、merge、push 与嵌套派发均不属于 agent 权限。

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

## 交接与暂停

每个 directive 和成功 report 返回 `handoff_prompt`。必须原样展示它。用户明确要求暂停时执行 `orchestrate park`；使用 `next --resume` 恢复。