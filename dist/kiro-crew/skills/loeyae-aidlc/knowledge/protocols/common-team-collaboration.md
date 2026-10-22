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

### 模块自主推进

`conductor` 的权限范围是一个 WorkflowRef，而不是整个项目的顶层 issue。`module-division` 完成并产生 module manifest 后，成员可直接进入自己负责的模块：

```bash
loeyae-aidlc orchestrate next --module module-a
loeyae-aidlc orchestrate report --stage <slug> --module module-a --result completed
loeyae-aidlc orchestrate park --module module-a
```

首次 `next --module` 会把旧单布局透明迁移为 per-module 布局；成员无需先回到顶层 issue 请求人工执行 `split`。split 后，每个模块 state 由该模块自己的 conductor 串行写入，不同模块可并行推进。global/integration conductor 只负责 project 轴阶段、跨模块 barrier、lineage 处置和 integration，不代替模块反复 `next` / `report`。

### 单元级并行状态链（MARS-271）

同一模块内的多个 unit 也可以并行推进（7 个 unit 不再互相排队）。规则：

1. 每个 unit 会话先用 `module bind` 绑定自己的 unit 实例（`bind` 校验该实例在 unit-manifest 中声明）。全局 Current Instance 指针被另一个未完成 unit 占用时，`next` 不再移动它，而是把本 unit 的链位记入 state 的 `Unit Contexts`（按 `<module>:<unit>` 键）；两单元的门禁状态互不覆盖，`orchestrate status` 可同时看到各 unit 的当前位置。
2. `report` 按声明实例（claim 或 `--instance`）归属到对应 unit：完成自己的实例、释放自己的 claim、清理自己的 Unit Contexts 记录，不触碰其他 unit 的 Current 指针与 claim。`next`/`report` 支持 `--unit <id>` 显式限定。
3. 证据生产与语义检查按 `--instance`/`--module --unit` 定位，证据路径本就按 unit 分目录，并行单元互不影响。
4. 委派子任务的运行环境失败（如 `env not found`）自动有限次重试由委派层（Multica 调度/host）负责：引擎侧每次 `next`/`report` 都以声明实例幂等重入，委派方按固定上限重试即可安全恢复，不会造成状态双写。
5. 共享基线 worktree 预热：`loeyae-aidlc worktree warmup` 在当前干净基线 commit 做一次全量 checkout（`<project>-aidlc-warm`，登记于 `.aidlc/worktrees/_warm.md`）；之后的 `worktree prepare` 用硬链接复用该缓存（metadata 标记 `Warm Reused: yes`），避免每个子任务重复 4000+ 文件 checkout。基线 commit 变化时重新 `warmup`；缓存缺失或损坏时 `prepare` 自动回退全量 checkout。

整体进度不是由顶层 issue 手工推动：引擎在读取时聚合 global、各 module 与 integration state，并据此计算模块完成度和 integration barrier。模块内的真实依赖、consumes/produces、sensor、证据以及用户审批仍然照常阻塞；“等待顶层协调者代报或裁决”本身不得作为模块阻塞理由。

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

## 工作流 lineage 与 `aidlc/active/` 合并规范

一个项目同一时刻只有一条工作流 lineage（全局 `Workflow ID`，split 后即 registry 的 `Global Workflow ID`）。`aidlc/active/` 是团队共享状态：

- 合并冲突时**禁止**对 `aidlc/active/` 整目录选「保留本地 / 保留对方」；同一 lineage 的状态文件逐文件按 `Revision` 取较新者，不同 lineage 的文件不能混合。
- 开始新工作前先 `git fetch`。`next --scope` 与 `split` 发现 git（HEAD 历史或本地/远程分支末端）里已有另一条未归档的 lineage 时拒绝创建；确需作废旧 lineage，显式加 `--replace-lineage <旧 Workflow ID>`，记入 `Retired Lineages` 与审计 `LINEAGE_RETIRED`。
- 合并后若 HEAD 历史里出现另一条既未 `archive`、也未退役的 lineage，`next` / `report` 拒绝继续。以哪条为准由负责人决定：保留当前 lineage 用 `orchestrate state retire --lineage <id> --user-input Approve --reason "<原因>"`；恢复另一条先 `git checkout <commit> -- aidlc/active`，再退役当前 lineage。
- `orchestrate state verify`（只读）列出其他 lineage 及其进度、混入的模块状态，以及 `Revision` 低于已提交版本的状态文件和恢复命令。
- 被放弃的 lineage 上有需要保留的模块时，在退役前用 `orchestrate state adopt --module <id> --from <commit> --user-input Approve --reason "<原因>"` 迁入当前 lineage；当前 lineage 已有同名模块时只能二选一。
- `aidlc/active/registry.md` 只存模块身份行，只在创建工作流时改变；冲突时保留双方的模块行，状态列由引擎实时计算。

```bash
loeyae-aidlc orchestrate state verify
```

## 阶段门禁

`requires`、`condition`、`consumes`、`produces` 和 sensor 继续生效。instruction-only 阶段需要 `--instruction-ack`；应用设计和部署决策需要显式 `--user-input Approve`。Evidence 必须来自受控 producer，并与当前 source revision、checker 或构建测试结果相符。

## 交接

每个 `run-stage` directive 和成功 report 都返回 `handoff_prompt`。Agent 必须原样展示它，使下一位成员了解工作目标、当前阶段、单元、产物以及后续 review/build/test 动作。