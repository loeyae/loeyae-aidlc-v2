# Loeyae AI-DLC

基于 AWS-style 轻量协作理念的 AI 驱动开发流程。新 workflow 使用明确工作描述、Markdown 状态与审计、成员自主选择 unit、Git 分支、review、构建和测试。

## 核心模型

新流程以明确工作描述、Markdown 状态与审计、成员自主选择 unit、Git 分支、review、构建和测试为基础。

```text
用户明确工作
  → Markdown workflow
  → 团队成员选择 unit
  → 产物 / review / build / test
  → 人工执行 merge
```

工作流控制面：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

新 workflow 的控制面只包含 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md`。

## 安装

```bash
npm install -g https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
loeyae-aidlc install
```

支持 Kiro Crew、Kiro IDE、Kiro CLI、Claude Code、OpenCode、Codex、CodeBuddy、Qoder 和 ZCode：

```bash
loeyae-aidlc install --harness kiro-ide
loeyae-aidlc install --harness claude
loeyae-aidlc install --all
```

## 开始新工作

用户先明确要做的事：

```text
使用 AI-DLC 修复订单导出超时并增加重试
```

```bash
loeyae-aidlc orchestrate next \
  --scope feature \
  --work "修复订单导出超时并增加重试"
```

`next` 返回当前 directive 和 `handoff_prompt`。Agent 必须原样展示下一步提示词，提示中会说明工作目标、当前阶段、当前单元、产物和后续 review/build/test 动作。

## 团队成员选择 unit

```bash
loeyae-aidlc unit list
loeyae-aidlc unit select \
  --module module-a \
  --unit unit-a \
  --member alice \
  --branch feat/module-a-unit-a
```

选择是协作记录，不是分布式锁。若发生重复选择，团队协商或使用显式 `--replace` 更新记录。

## Agent 执行

每个 directive 可携带 `agent_execution`：它声明 primary persona、support/reviewer、执行模式和结构化结果契约。

- `inline`：conductor 在当前会话加载 persona；
- `delegate`：宿主支持时派发独立实现 agent，否则明确回退 inline；
- `pipeline`：按步骤传递结构化结果；
- `mob`：多个 persona 独立贡献后由 conductor 整合；
- `review`：独立 reviewer 只读审查，不编辑业务产物。

persona 位于 `agents/`，执行计划可检查：

```bash
loeyae-aidlc agent plan --stage code-generation
loeyae-aidlc agent validate-result result.json
```

无论执行模式如何，只有 conductor 可以更新 Markdown state/audit、报告阶段、接受审批或执行 merge/push。

## 阶段推进

```bash
# 普通阶段
loeyae-aidlc orchestrate report --stage <slug> --result completed

# instruction-only 阶段
loeyae-aidlc orchestrate report \
  --stage <slug> --result completed --instruction-ack <slug>

# 应用设计和部署决策
loeyae-aidlc orchestrate report \
  --stage <slug> --result approved --user-input Approve
```

流程仍验证 requires、condition、consumes、produces、sensor、review、构建和测试；轻量化降低的是协作身份摩擦，不是质量要求。

## Worktree 与 merge plan

```bash
loeyae-aidlc worktree prepare \
  --instance code-generation@module:module-a@unit:unit-a \
  --member alice \
  --path /absolute/path/to/module-a-unit-a

loeyae-aidlc worktree merge-plan \
  --instance code-generation@module:module-a@unit:unit-a \
  --member alice \
  --path /absolute/path/to/module-a-unit-a \
  --review-evidence .aidlc/review.json
```

`merge-plan` 只验证分支、review 和变更路径覆盖，并输出建议 merge 命令；不会自动 merge 或 push。

## 其他能力

```bash
loeyae-aidlc runtime summary
loeyae-aidlc runtime doctor
loeyae-aidlc attest resolve --base origin/main --head HEAD
loeyae-aidlc extension validate /absolute/path/to/extension
loeyae-aidlc export --help
loeyae-aidlc docx --help
```

## 开发

```bash
npm run build:all
npm test
```

## License

MIT
