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

## 证据与门禁（producer / sensor）

阶段准出由 **sensor 门禁** 把守，门禁读取的是 **受控证据（controlled evidence）**——落在 `.aidlc/evidence/<stage>/[<module>/[<unit>/]]<sensor>.json` 的 JSON 文件。你不需要手写这些证据，也**不能**手写：

- **证据由确定性 producer 生成，不是人或 AI 写的。** 例如追溯矩阵证据（`traceability-matrix.json`）由 producer 函数扫描 `requirements.md`、`user-stories.md`、设计文档、代码源文件里的 `REQ-xxx` / `@ReqId` 标记，机械算出每个需求是否逐层被覆盖，输出 `broken_rows`。给同样的产物永远输出同样的矩阵。
- **证据带防伪印章。** 每份受控证据包含 `producer.mode=controlled`、`checker.argv_digest`（SHA-256）、`source_revision.worktree_digest`（与当前 git HEAD/worktree 绑定）。Agent 手写的 JSON 缺印章或印章对不上当前提交，会被 `report` / `next` 当场判为伪造并拒绝。这就是 “Agent 手写即伪造证据” 的含义——它是引擎的正常防护，不是错误。

### 证据什么时候生成

**`report` 会自动生成缺失的语义证据**，你不必单独调用 producer：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
```

`report` 在完成前会为该阶段声明的语义 sensor 自动运行受控 producer，把缺的证据 JSON 生成出来，然后校验：

1. `consumes` / `produces` 产物齐全；
2. 每个 sensor 门禁通过（含追溯矩阵 `broken_rows` 为空）。

`next` 推进下一步时，还会复验上游已完成阶段的门禁是否**仍然**满足——防止上游产物事后被改坏。

### 门禁失败怎么办

引擎会打印具体的失败 sensor 和原因，按类型处理：

- **证据缺失 / provenance 不匹配** → 重新 `report`，让 producer 重新生成。**不要手写证据 JSON。**
- **追溯矩阵断链 `REQ-xxx: BROKEN@<layer>`** → 该需求在某一层真的丢了（如活到故事层却在设计层断）。去补那一层的产物：让对应文档/代码里出现该 `REQ` 标记，再 `report`。
- **未迁移旧项目**（`requirements.md` 无 `REQ-xxx` 或缺 `track` 标签）→ 记 `MIGRATION_REQUIRED`，降级放行并输出缺失清单，不硬阻断。

证据文件默认 24 小时过期；跨天续作时上游纯过期不算回归，引擎会放行。

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
