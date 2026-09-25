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

# verify 与 merge-plan 同一实现、同一批 flag：只验证不输出建议 merge 命令之外的额外动作
loeyae-aidlc worktree verify \
  --instance <stage-instance> \
  --member <name> \
  --path <absolute-worktree-path> \
  --review-evidence <worktree-relative-review-json>
```

`prepare` 创建成员选择 unit 对应的 branch/worktree，并写入 Markdown metadata。`verify` / `merge-plan` 验证已提交变更、review 的 `files_reviewed` 覆盖、branch/base 一致性，并输出建议 merge 命令（`authorized: false`）。

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

### Evidence 是 producer 生成的，Agent 不能手写

每个 semantic sensor 的 Evidence 都由 **确定性 producer** 扫描真实产物机械生成，写到 canonical `evidence_path`（`.aidlc/evidence/<stage>/[<module>/[<unit>/]]<sensor>.json`）。以追溯矩阵为例（sensor `traceability-matrix`）：producer 扫描 `requirements.md` 的 `REQ-xxx` 及其 `track:[backend/frontend/data/infra/nfr/doc-only]` 标签，再按阶段到 `user-stories.md`、`application-design`、功能设计、UC-D、代码源文件、测试里逐层比对该 REQ / `@ReqId` 是否出现，算出 `broken_rows`。给同样的产物永远输出同样的矩阵——这是它能当客观证据的前提。

**Agent 手写证据 = 伪造证据。** 受控证据带防伪印章：`producer.name=loeyae-aidlc-evidence`、`producer.mode=controlled`、`checker.argv_digest`（SHA-256）、`source_revision.worktree_digest`（与当前 git HEAD/worktree 绑定）。手写 JSON 缺印章或印章对不上当前提交，`report` / `next` 会当场拒绝。若看到引擎提示“checkSensors 与 traceability-matrix.json：须由引擎受控 producer 生成，Agent 手写即伪造证据”，那是正常的边界提示，不是需要人工补写矩阵的错误。

### checkSensors 何时触发

`checkSensors`（引擎内的门禁裁判）不需你手动调用，在两个时机自动运行：

1. `orchestrate report --result completed` 时，先自动为缺失的 semantic sensor 跑 producer（等价 `evidence run --all-sensors`），再校验证据；任一 sensor 不绿则拒绝完成。
2. `orchestrate next` 推进下一步时，复验上游已完成阶段的门禁是否**仍然**满足，防止上游产物事后被改坏。

### 门禁失败处置

- **证据缺失 / provenance 不匹配** → 重新 `orchestrate report`（或显式 `evidence run --stage <stage> --all-sensors`）让 producer 重新生成。**不要手写证据 JSON。**
- **追溯矩阵断链 `REQ-xxx: BROKEN@<layer>`** → 该需求在某层真的丢了（如活到故事层却在设计层断）。去补那一层产物：让对应文档/代码里出现该 REQ 标记，再 `report`。矩阵只保证结构覆盖（无需求悄悄消失），内容是否忠实仍需 review / 测试。
- **未迁移旧项目**（`requirements.md` 无 `REQ-xxx` 或缺 `track` 标签）→ 记 `MIGRATION_REQUIRED`，降级放行并输出 `missing_track` 清单，不硬阻断。

证据文件默认 24 小时过期；跨天续作时上游纯过期不算回归，`next` 会放行。

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
