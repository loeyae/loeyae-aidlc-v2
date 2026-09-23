# Loeyae AI-DLC CLI 使用手册

## 新 workflow

所有新流程都从用户明确的工作描述开始：

```bash
loeyae-aidlc orchestrate next \
  --scope <feature|enterprise|mvp|classic|express|workshop|bugfix|refactor|poc> \
  --work "<明确的工作描述>"
```

新流程控制面只使用 Markdown：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

当前 workflow 只使用 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md` 管理路由、报告和成员分工。

## 继续与报告

```bash
# 获取当前 directive
loeyae-aidlc orchestrate next

# 完成普通阶段
loeyae-aidlc orchestrate report --stage <slug> --result completed

# 完成 instruction-only 阶段
loeyae-aidlc orchestrate report \
  --stage <slug> --result completed --instruction-ack <slug>

# 批准应用设计或部署决策
loeyae-aidlc orchestrate report \
  --stage <slug> --result approved --user-input Approve

# 暂停或恢复当前 Markdown workflow
loeyae-aidlc orchestrate park
loeyae-aidlc orchestrate next --resume
```

每个 `run-stage` directive 和成功 report 都有 `handoff_prompt`。Agent 必须原样展示该提示词，提示中包含工作目标、当前阶段、当前单元、产物、review/build/test 和下一步动作。

## 团队 unit 协作

```bash
loeyae-aidlc unit list
loeyae-aidlc unit select \
  --module <module-id> \
  --unit <unit-id> \
  --member <name> \
  --branch <branch> \
  [--note <text>] [--replace]
```

成员选择是协作声明，不是锁。重复选择会显示当前成员；团队可协商后使用 `--replace` 更新记录。

## 团队 module 协作

模块轴在 `unit select` 之上提供并发认领：

```bash
loeyae-aidlc module list
loeyae-aidlc module select --module <module-id> --owner <member/device/tool> [--branch <branch>] [--worktree <path>]
loeyae-aidlc orchestrate next --claim --module <module-id> --owner <member/device/tool>
loeyae-aidlc orchestrate report --stage <slug> --module <module-id> --owner <member/device/tool> --result completed
loeyae-aidlc module heartbeat --stage-instance <stage@module:id> --owner <member/device/tool>
loeyae-aidlc module migrate [--owner <legacy-owner>]
```

`next --claim` 只认领当前模块的就绪 module stage instance；claim 写入 `module_id`、`stage_instance`、`owner`、branch/worktree、`claimed_at`、heartbeat 和过期时间。有效 claim 不会被另一端重复认领，超时后可重新领取。模块 report 只结算自己的 claim，`application-design` 等 blocking approval 仍按实例要求真人 `--user-input Approve`。

`product-contracts.md` 与 `runtime-dependencies.md` 中明确的模块关系会作为跨模块准入依赖；消费方会显示等待的提供方阶段。`runtime summary` 同时展示所有活动实例、owner、就绪实例和依赖阻塞。

## Worktree 与 review

```bash
loeyae-aidlc worktree prepare \
  --instance <stage-instance> \
  --member <name> \
  --path <absolute-worktree-path> \
  [--branch aidlc-light/<safe-name>]

loeyae-aidlc worktree merge-plan \
  --instance <stage-instance> \
  --member <name> \
  --path <absolute-worktree-path> \
  --review-evidence <worktree-relative-review-json>
```

`prepare` 创建成员选择 unit 对应的 branch/worktree，并写入 Markdown metadata。`merge-plan` 验证已提交变更、review 的 `files_reviewed` 覆盖、branch/base 一致性，并输出建议 merge 命令。

不会自动 merge、push、删除 worktree、修改工作流完成状态或代替仓库权限持有者执行操作。

## Evidence、诊断与溯源

```bash
# 生成当前阶段声明的所有 semantic sensor Evidence；每个 sensor 写入 canonical evidence_path
loeyae-aidlc evidence run --stage <stage> --all-sensors

loeyae-aidlc runtime summary
loeyae-aidlc runtime doctor
loeyae-aidlc attest resolve --base origin/main --head HEAD
```

`evidence run --stage <stage> --all-sensors` 会读取编译后的 `stage-graph.json`，按阶段声明顺序依次运行 semantic checker；省略 `--sensor` 时，非 `build-and-test` 阶段也采用同一行为。`build-and-test` 仍使用既有 build/test/check allowlist。`orchestrate report` 发现缺失 semantic Evidence 时会自动触发该受控产出器，失败仍由 report 门禁阻断。

`diagram-contract` 的 source-only 结果在 source checker、独立 expected contract、generator closure 和几何门禁均通过时可以写成 `final_status: "STATIC_PASS"`，并足以通过不要求目标渲染的 report 门禁；只有 stage/Provider Request 将 `target_operation_required` 设为 `true`（`preview` 或 `render`）时，才必须执行 Provider 的 normal/fit/zoom 证据并达到 `PASS`。Provider 不可用只能保持 `UNVERIFIED`/`NEEDS_CAPABILITY`，不能伪造截图或视觉证据。

`v3->v4 choice reconciliation` 会比较模块 `cross-validation-report.md` 的 `prd_route`、`ui_route` 与当前 Markdown workflow 的 `selected_optional_stages`/UI history；不一致时明确阻断并要求只对齐机器摘要或当前选择，不会静默修改业务内容。

轻量模式的 Evidence 仍要求 producer、source revision、checker 或构建/测试结果，但不要求设备签名 envelope。`attest` 会保守报告无签名 Evidence 的可验证边界，不会把它提升为强授权证明。

## 受限 extension

```bash
loeyae-aidlc extension validate /absolute/path/to/extension
loeyae-aidlc extension compose /absolute/path/to/extension --project /absolute/path/to/project
loeyae-aidlc extension status <name> --project /absolute/path/to/project
```

extension 只能提供 namespaced Markdown 内容、advisory sensor 描述和 additive metadata。它不能执行任意脚本、改变 workflow state、审批、unit 选择、review/build/test 门禁或 merge 权限。

## 平台、导出与帮助

```bash
loeyae-aidlc install
loeyae-aidlc install --all
loeyae-aidlc install --harness kiro-ide --project /absolute/path/to/project
loeyae-aidlc uninstall --all

loeyae-aidlc export --help
loeyae-aidlc docx --help
loeyae-aidlc graph validate
loeyae-aidlc version
```

Stop Hook 只观察 Markdown workflow 是否仍在运行并提示继续；不会自动 report、生成签名或读取旧 JSON workflow。
