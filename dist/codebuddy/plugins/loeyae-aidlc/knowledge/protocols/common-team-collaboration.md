# 团队轻量协作模型

AI-DLC 使用 AWS-style 轻量协作：明确工作描述、Markdown workflow、成员自主选择 unit、Git 分支、review、构建、测试和人工 merge。

## 控制面

工作流只由以下文件控制：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

状态记录工作目标、scope、阶段、实例、已完成项、unit 选择与历史；audit 追加每次状态变化。新工作必须由用户明确描述后启动：

```bash
loeyae-aidlc orchestrate next --scope feature --work "实现门店库存同步失败重试"
```

## 单元协作

成员在 module manifest 和 unit manifest 已就绪后自行选择工作单元：

```bash
loeyae-aidlc unit list
loeyae-aidlc unit select \
  --module module-a \
  --unit unit-a \
  --member alice \
  --branch feat/module-a-unit-a
```

选择是公开协作记录，不是锁。重复选择由成员沟通；达成一致后可使用 `--replace` 更新记录。

## 交付标准

1. 读取当前 directive 的 `handoff_prompt`、依赖和产物要求。
2. 在个人分支或 worktree 完成代码、文档和测试。
3. 完成 review，review evidence 覆盖实际改动路径。
4. 运行适用的构建、测试和语义检查。
5. 使用 merge plan 汇总分支、review 和变更覆盖，再由具备仓库权限的成员人工合并。

```bash
loeyae-aidlc worktree merge-plan \
  --instance code-generation@module:module-a@unit:unit-a \
  --member alice \
  --path /absolute/path/to/module-a-unit-a \
  --review-evidence .aidlc/review.json
```

`merge-plan` 不会自动 merge 或 push。

## 阶段门禁

`requires`、`condition`、`consumes`、`produces` 和 sensor 继续生效。instruction-only 阶段需要 `--instruction-ack`；应用设计和部署决策需要显式 `--user-input Approve`。Evidence 必须来自受控 producer，并与当前 source revision、checker 或构建测试结果相符。

## 交接

每个 `run-stage` directive 和成功 report 都返回 `handoff_prompt`。Agent 必须原样展示它，使下一位成员了解工作目标、当前阶段、单元、产物以及后续 review/build/test 动作。