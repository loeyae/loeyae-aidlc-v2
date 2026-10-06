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

### 源码根与命令清单

- 阶段图中的 `src/` 是源码根的规范占位，按 module-manifest `paths` → `.aidlc/source-roots.json`（`{ "version": "1", "source_roots": ["app", "web/src"] }`）→ 默认 `src/` 解析，适用于 Python 等不使用 `src/` 的项目。
- 嵌套独立 git 仓库（4.9.0）：业务代码放在被工作流仓库忽略的子仓库（如 `app/` 自带 `.git`）时，在 `source-roots.json` 中写 `{ "path": "app", "repo": "nested" }`（只在这里声明；module-manifest `paths` 不接受对象条目，manifest 管模块归属，source-roots 管仓库拓扑）。声明会被 fail-closed 校验（是仓库根、无符号链接/junction、不互相包含、工作流仓库不跟踪其中文件）。characterization code ref、BASELINE 的 `git hash-object` 与 blob 解析都在子仓库内执行；基线在 `- Baseline Repos: app=<sha>` 里为每个嵌套仓库记录 commit，`baseline_commit` 始终是工作流仓库的 commit；证据的 `source_revision.repos` 记录各子仓库的 commit / dirty / digest，子仓库代码漂移会被发现。`--set` 默认取各子仓库干净的 HEAD（或 `--repo app=<sha>`），`--advance` 必须为每个嵌套仓库显式写 `--repo app=<sha>` 与 `--expect-repo app=<当前 sha>`。已有工作流声明后执行一次受限迁移：`loeyae-aidlc orchestrate baseline --set <当前 commit> --replace --expect <当前 commit> --repo app=<sha> --user-input Approve --reason "<原因>"`（基线已使用或已推进也可以，只补登尚未登记的仓库；`orchestrate baseline` 会打印这条命令）。涉及嵌套仓库的 `attest resolve`、`worktree prepare/merge-plan` 明确拒绝，不涉及的照旧。
- 构建/测试/检查命令清单按 `--config` → `.aidlc/commands/<stage>.json` → `.aidlc/evidence-commands.json` 查找；RED/GREEN 命令清单只按 `.aidlc/commands/<stage>.json` → `.aidlc/evidence-commands.json` 查找，显式 `--config` 仅在指向同一文件时被接受，否则 producer 直接拒绝。文件中的 `stage` 必须与当前阶段一致。
- `mode: review` 的代码审查记录须声明 `execution_context: isolated` 与 `review_only: true`。

### 新行为与存量行为（RED / BASELINE / GREEN）

I13 的每个 UC-D 带 `tdd_mode`：新行为（`new`，默认）走 RED→GREEN，存量行为（`characterization`，须声明 `code_refs`、`reason`、`approval_ref`，并绑定到工作流基线）走 BASELINE→GREEN，不再提供"重构可豁免 TDD"的豁免。

- `tdd` 阶段的 `.aidlc/commands/tdd.json`：有 `new` UC-D 时声明恰好一条 `role: red`，有 characterization UC-D 时声明恰好一条 `role: baseline`。BASELINE 在修改任何 code ref 之前运行：producer 先用 `git hash-object` 比对 code ref 与基线 blob，不一致直接拒绝；命令须退出 0。某一模式没有 UC-D 时对应证据自动为 `not_required`。
- `code-generation` 的唯一 `role: green` 命令须覆盖全部 UC-D；完成时连同 RED 复验 BASELINE。`test-quality` 按 `ucd_modes` 要求 RED failed / BASELINE passed。
- 存量工作流（4.6 之前创建、没有基线）先执行 `loeyae-aidlc orchestrate baseline --set <sha> --user-input Approve --reason "<原因>"` 登记基线，再派生 characterization UC-D。split 布局的模块子工作流继承父工作流基线。
- 多单元基线分代（4.7.0）：基线是一条只能追加的 commit 链（`Baseline History`），每份 BASELINE 证据绑定它产出时的那一代。多个单元依次改动同一批 code ref 时，上一个单元的 `code-generation` 完成并提交后，执行 `loeyae-aidlc orchestrate baseline --advance <该单元 GREEN 证据的 source_revision.commit> --expect <当前基线> --user-input Approve --reason "<原因>"`，再对活动中单元的 tdd 执行普通 `evidence run`。已完成单元的 BASELINE 证据保持有效，不需要 `--refresh`。`--advance` 只能推进到已完成单元的完成点，且不能在某个单元的 BASELINE 与 GREEN 之间执行；`--replace` 用于更正一个尚未使用的基线，推进过的工作流一律拒绝 `--replace`。不带参数的 `orchestrate baseline` 显示当前代与完整链。
- 按单元收敛 UC-D（4.8.0）：一个模块拆成多个 unit 时，在 UC-D frontmatter 写 `unit_refs: [<unit-id>, ...]`（只能写在 frontmatter；非空、不重复、必须是 `unit-manifest.json` 中的 unit；模块内要么全部声明，要么全部不声明）。I13 输出 `ucd_units`，各 unit 的 RED / BASELINE / GREEN、BASELINE `code_ref_digests`、test-quality、追溯矩阵 tests 层和功能设计只覆盖本单元的 UC-D；build-and-test 的 test-quality 和集成屏障（`ucd-coverage:<module>`）对账：每个 UC-D 都必须出现在其 `unit_refs` 中每个 unit 的 GREEN 里。不拥有 UC-D 的 unit（如契约 unit）须在 `unit-manifest.json` 中声明 `ucd_exemption`（`reason_code`、`reason`、`approval_ref`、`alternative_validation`、`validation_command` argv），producer 执行该命令通过后才写 `not_required`。不声明 `unit_refs` 时行为与 4.7.1 相同。

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
