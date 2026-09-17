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
loeyae-aidlc evidence run --stage build-and-test
loeyae-aidlc runtime summary
loeyae-aidlc runtime doctor
loeyae-aidlc attest resolve --base origin/main --head HEAD
```

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
