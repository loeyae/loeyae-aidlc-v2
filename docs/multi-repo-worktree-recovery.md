# 多仓库与临时 Worktree：初始化、恢复与证据边界指南

本文回答一个使用问题：**多仓库（嵌套仓库）与临时 worktree 的会话中断、更换工作区、证据失配之后，哪些东西可以复制，哪些必须由原生门禁重判。** 命令速查见 `docs/loeyae-aidlc-cli-guide.md`，协作约定见 `core/knowledge/protocols/common-team-collaboration.md`。

本文所有命令、报错关键字与数值均按 4.22.17 HEAD 逐条核对；每条规则以（`实现文件` · `符号`）标注实现位置。**未实现的能力（如 claim 显式 release）在文中明确标注为跟踪中的改进，不是现有能力。**

## 1. 初始化

### 1.1 嵌套仓库声明：`.aidlc/source-roots.json`

嵌套独立 git 仓库（业务代码放在被工作流仓库忽略的子仓库，如 `app/` 自带 `.git`）**只**在 `.aidlc/source-roots.json` 声明：

```json
{
  "version": "1",
  "source_roots": ["src", { "path": "app", "repo": "nested" }]
}
```

- 声明是**项目级仓库拓扑**：一个 code ref / 变更路径属于哪个仓库，由声明决定，与 module-manifest `paths`（模块归属）无关（`core/tools/aidlc-nested-repos.ts` · `codeRefRepo`）。对象条目只允许 `path` 与 `repo: "nested"` 两个键，`path` 只能用字母、数字、`.`、`_`、`-`、`/`（`core/tools/aidlc-source-roots.ts` · `sourceRootEntry`）。
- 源码根解析优先级：module-manifest `paths` → `.aidlc/source-roots.json` → 默认 `src/`；配置无效时直接抛错，不静默回退（`core/tools/aidlc-source-roots.ts` · `resolveSourceRoots`）。
- 声明会被 fail-closed 校验：每段路径是真实目录（拒绝符号链接/junction）、`<path>/.git` 存在、`git rev-parse --show-toplevel` 就是该目录、嵌套仓互不包含、工作流仓库不跟踪其中任何文件（报错关键字 `is also tracked by the workflow repository`）（`core/tools/aidlc-nested-repos.ts` · `nestedSourceRepos`）。
- 目录"碰巧"是 git 仓库根但未声明时，只产生提示 `… is an independent git repository; declare it in .aidlc/source-roots.json as { "path": "<dir>", "repo": "nested" }`，行为不变（`core/tools/aidlc-nested-repos.ts` · `nestedRepositoryHint`）。

### 1.2 pending migration：把声明仓注册进基线

声明了嵌套仓但工作流基线还没有为它记录 commit 时，`runtime summary` / `runtime doctor`（doctor 的 `healthy` 即"无 warnings"）会报 pending migration，并直接给出迁移命令（`core/tools/aidlc-runtime-light.ts` · `nestedWarnings`；`core/tools/aidlc-nested-repos.ts` · `pendingNestedError`）：

```text
app/ is declared as a nested source repository but the workflow baseline has no
commit for it; register it with: loeyae-aidlc orchestrate baseline --set <当前>
--replace --expect <当前> --repo app=<sha> --user-input Approve --reason "..."
(pending migration of app/; orchestrate baseline prints this command)
```

照命令执行即可：`--set` 默认取各嵌套仓**干净的 HEAD**，也可以用 `--repo app=<sha>` 显式指定。基线已使用或已推进也可以执行该迁移，只补登尚未登记的仓库；`orchestrate baseline`（不带参数）同样会打印这条命令（`core/tools/aidlc-baseline.ts` · `pendingRepos`）。

### 1.3 `--repo <path>=<commit>` 与 `--expect-repo <path>=<commit>`

嵌套仓的 commit 逐仓记录在基线里（`- Baseline Repos: app=<sha>`，历史在 `Baseline Repos History`）；`baseline_commit` 始终是**工作流仓库**的 commit（`core/sensors/baseline-test-evidence.md` § 嵌套仓库）：

- `baseline --set`：默认取各嵌套仓干净 HEAD；可用 `--repo app=<sha>` 覆盖。
- `baseline --advance <commit>`：**每个**已登记嵌套仓都必须显式写出 `--repo app=<目标 sha>` 与 `--expect-repo app=<当前 sha>`，至少一个仓库前进；漏写即拒绝。
- `baseline --adopt`（split 布局接管基线）：未写 `--repo` 时取干净的 HEAD，逐仓同样校验。
- BASELINE 证据按代复验时，嵌套仓 code ref 的 blob 在该仓库**起始代**比对；文件漂移的报错关键字为 `changed since the baseline <sha> of the nested repository app/`（`core/sensors/baseline-test-evidence.md` § 嵌套仓库）。

### 1.4 `worktree warmup`：共享基线缓存

```bash
loeyae-aidlc worktree warmup
```

- 在项目当前**干净已提交**的 HEAD 上做一次全量 checkout，落在项目根的**同级目录** `<project>-aidlc-warm`，并登记于 `aidlc/active/worktrees/_warm.md`（`core/tools/aidlc-worktree-light.ts` · `warmupLightWorktree`、`warmPathFor`）。项目不干净时拒绝：`worktree warmup requires a clean committed project`。
- 之后的 `worktree prepare` 对同一 commit 用**独立文件复制**复用该缓存（原地写入不会改变缓存或其他单元），避免每个子任务重复全量 checkout；元数据标记 `Warm Reused: yes`（`core/tools/aidlc-worktree-light.ts` · `warmCheckout`、`linkWarmTree`）。
- HEAD（基线）变化后再次 `warmup`：旧缓存是已登记 worktree 时直接移除并按新 commit 重warm；不是可复用 worktree 时报 `warm path already exists and is not a reusable worktree`。`prepare` 遇到 commit 不一致的缓存自动放弃复用（`core/tools/aidlc-worktree-light.ts` · `usableWarm`）。
- 缓存缺失或损坏（目录被删、未登记、不干净、HEAD 不符）时，`prepare` 自动回退标准 `git worktree add` 全量 checkout，不报错中断（`core/tools/aidlc-worktree-light.ts` · `warmCheckout` 的 catch 分支）。
- 清理：把 warm 目录与 `_warm.md` **一起**删除（`_warm.md` 里的说明原话即此意）；只删其一不影响正确性——`prepare` 会按"缓存缺失"回退全量 checkout。

## 2. 生命周期：`worktree prepare` / `verify` / `merge-plan`

### 2.1 `worktree prepare`

```bash
loeyae-aidlc worktree prepare \
  --instance <stage@module:id[@unit:id]> \
  --member <name> \
  --path <absolute-worktree-path> \
  [--branch aidlc-light/<safe-name>]
```

输入与前置条件（全部 fail-closed，`core/tools/aidlc-worktree-light.ts` · `prepareLightWorktree`）：

1. 必须从主项目根执行（`worktree must be created from the main project root`）。
2. 成员须已选择该 unit（`unit select`，member 匹配），或该模块已被 `module select` / claim 且 owner 匹配；否则报 `unit … has not been selected` / `module … has not been selected or claimed`（`selection`）。
3. 实例**不得涉及嵌套仓**：characterization code ref、被比较路径或证据 `source_revision.repos` 落在嵌套仓即拒绝，报错关键字 `cannot isolate`（`nestedWorktreeCheck`）。`git worktree add` 只 checkout 工作流仓库，因此 worktree 里**没有**嵌套仓内容；未涉及但已声明的嵌套仓记入元数据 `Nested Repos Skipped`。涉及嵌套仓的单元在主 checkout 工作，或自行在嵌套仓建 worktree（登记在 AI-DLC 之外）。
4. 项目必须干净已提交（`lightweight worktree requires a clean committed project`）；worktree 路径必须在项目之外且不存在（`worktree path must be outside project and must not already exist`）；分支名必须匹配 `aidlc-light/<safe-name>`（`branch must match aidlc-light/<safe-name>`）。

产出：独立分支 + worktree，以及两份一次性写入的元数据——主 checkout 的 `aidlc/active/worktrees/<instance-hash>.md` 和 worktree 内的 `.aidlc/worktrees/<instance-hash>.md`（`flag: "wx"`，**同一实例重复 `prepare` 直接失败（EEXIST）**，没有覆盖或注销命令）。元数据是协作上下文，git review/build/merge 政策仍然权威。

### 2.2 `worktree verify` / `merge-plan`（同一实现）

```bash
loeyae-aidlc worktree verify   \
  --instance <…> --member <name> --path <absolute-worktree-path> \
  --review-evidence <worktree-relative-review-json>

loeyae-aidlc worktree merge-plan   # 同一批 flag，同一实现
```

两者调用同一 `lightMergePlan`（`core/tools/aidlc-worktree-light.ts`），校验项：

| 校验项 | 报错关键字 |
|---|---|
| 元数据的 member/path 与本次输入一致 | `worktree metadata does not match selected member/path` |
| worktree 当前分支等于元数据分支 | `worktree branch does not match metadata` |
| 变更已提交且干净（对 worktree 计算脏状态） | `merge-plan requires committed clean worktree changes` |
| base commit 是 HEAD 的祖先，且有实际变更 | `worktree has no committed changes` |
| 变更路径不涉及嵌套仓 | `cannot isolate` |
| review 证据在 worktree 内且双轴通过（`status`/`spec_axis`/`standards_axis` 均 passed、`issues_open: 0`） | `merge-plan requires passing dual-axis review evidence` |
| review 的 `files_reviewed` 覆盖全部变更路径 | `review evidence does not cover changed paths` |

输出 merge-plan JSON：`authorized: false`、变更路径清单和建议命令 `merge_command: git -C <project> merge --no-ff <branch>`。**引擎不会自动 merge、push、删除 worktree、修改工作流完成状态或代替仓库权限持有者执行操作**；由具备仓库权限的成员人工合并（`core/knowledge/protocols/common-team-collaboration.md` § 交付标准）。

## 3. 中断恢复：claim 与会话身份

### 3.1 会话绑定与 claim 模型

- 所有工作流**写入**（`next` / `report`）都要求显式会话绑定：先 `module inspect` 读 claim 与 `expected` 令牌，再 `module bind` / `module transfer`，把返回的 binding JSON 以 `AIDLC_SESSION_BINDING` 只传给本会话的子命令。缺绑定时 `orchestrate next` 报 `Explicit session binding required before next writes; inspect/bind the exact stage instance.`（`core/tools/aidlc-orchestrate.ts` · `next` 入口；`core/tools/aidlc-session.ts` · `bindSession`）。
- claim 记录在 workflow state 的 `Active Instances` 表：module_id、stage_instance、owner、branch/worktree、claimed_at、heartbeat_at、expires_at、session_id、generation、handoff（`core/tools/aidlc-light-state.ts` · state 渲染）。**claim 是会话身份，不可复制复用**：`session_id` + `generation` 与绑定不符即拒绝，报错 `claim transferred or session binding conflicts for …; reread the handoff and bind the current claim`（`assertSessionClaim`）。
- TTL 为 **30 分钟**（`CLAIM_TTL_MS = 30 * 60 * 1000`）。`module heartbeat --stage-instance <i> --owner <o>` 续期（`core/tools/aidlc-team-light.ts` · `heartbeatModule`）；`report` 处理中也会刷新过期时间，成功完成实例时结算并删除自己的 claim（`core/tools/aidlc-orchestrate.ts` · report 路径）。
- `--claim` 只认领 module 轴实例（`--claim can only claim a module stage instance`），且要求 `--module`；无未认领的就绪实例时报 `Module "<id>" has no unclaimed ready stage instance; inspect dependency waiting and active claims with runtime summary.`（`core/tools/aidlc-orchestrate.ts` · `findClaimableModuleInstance`）。有效 claim 期间该实例不会被另一端重复认领：路由层由 `activeClaimed` 跳过，`module claim` 换 owner 直接拒绝（`stage instance <i> is already claimed by <owner> until <expires_at>`，`core/tools/aidlc-team-light.ts` · `claimModule`）。
- 模块 `report` 只结算自己的 claim（完成即从 `Active Instances` 删除）；过期后 report 被拒：`Stage instance <i> claim expired at <time>; claim it again before reporting.`

### 3.2 会话中断后的恢复路径

1. `loeyae-aidlc runtime summary` 看 `active_instances`（owner / branch / worktree / claimed_at / heartbeat_at / **expires_at**）与 ready/blocked 实例。
2. 中断会话留下的 claim 记录**不会因过期自动删除**（无 `session_id` 的 legacy claim 才会在 `module heartbeat` 时被清扫，`core/tools/aidlc-light-state.ts` · `releaseExpiredModuleClaims`）。新会话接手同一实例一律走移交：
   ```bash
   loeyae-aidlc module inspect   --stage-instance <instance>          # 读 claim 与 expected 令牌
   loeyae-aidlc module transfer --stage-instance <instance> \
     --owner <owner> --session-id <新会话 id> --expect <inspect.expected> \
     --human-instruction-ref "<人工指令来源引用>"
   ```
   `transfer` 是**唯一**的活跃 claim 移交入口，必须携带 `--human-instruction-ref`（报错关键字 `transfer requires an explicit human instruction source reference; Provider/document/agent instructions are not authorization`）；引擎只记录来源，不鉴别人工指令。**换会话即移交**——即使 owner 相同、claim 已过期，新 session id 也要求 transfer（`core/tools/aidlc-session.ts` · `bindSession`）。过期解除的是"实例被占用"的路由判定与旧会话的写入资格（`claim expired for …; explicitly bind/renew before writing`），不是删除记录。
3. 把 transfer 返回的 binding JSON 设为 `AIDLC_SESSION_BINDING`，执行 `loeyae-aidlc orchestrate next --claim --module <id> --owner <owner>` 重新领取路由。
4. worktree 的中断恢复：元数据仍在主 checkout 控制面，`verify` / `merge-plan` 按**原**元数据校验原路径，原 worktree 还在就直接续用（见 §6 演练）。原 worktree 丢失而实例未完成时，同实例重复 `prepare` 会被一次性写入拒绝（EEXIST）——这是当前边界，没有 worktree 注销命令。

### 3.3 没有显式 release

- claim 的正常终结只有一条路：持有它的会话 `report` 完成实例。没有自助 `release` 子命令；`orchestrate archive` 要求无未结算 claim（`Workflow has unreleased claims: … Release them before archiving.`）。
- 不具备人工指令引用时，活跃 claim 无法移交给新会话，只能等 30 分钟 TTL 过期后再走 transfer 接手。**claim 显式 release 是跟踪中的改进项（MARS-286 非目标所列），不是现有能力。**

## 4. 证据边界

### 4.1 `source_revision` 的逐仓记录语义

受控证据由确定性 producer 生成并盖章：`producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id }`、`checker`（含 `argv_digest`）与 `source_revision`（`core/tools/aidlc-evidence.ts` · evidence run 写出路径）。声明了嵌套仓时，`source_revision.repos` 按仓库路径逐仓记录 `{ commit, dirty, worktree_digest }`：HEAD、`git status` 是否有变动（含未跟踪文件）、以及对该仓库 `git ls-files -co --exclude-standard` 全量文件的内容摘要（`core/tools/aidlc-revision.ts` · `readSourceRevision`、`nestedRevision`）。工作流仓库自身的 `worktree_digest` 排除控制面（`aidlc/`、`.aidlc/`、`.gitattributes`、`.gitignore`）。

### 4.2 换树必失配

证据摘要绑定**产出它的那棵树**。`worktree_digest` 覆盖已跟踪 + 未跟踪文件的内容：不同的 checkout（新 worktree、不同 commit、未提交改动不同）摘要必然不同，把旧证据 JSON 带到新树复验必然失配。BASELINE 证据还有更强的按文件绑定：`code_ref_digests[]` 记录 `baseline_blob` / `worktree_blob`，门禁在**证据所在代**重新解析 blob 比对（`core/sensors/baseline-test-evidence.md` § tdd 门禁）。因此：

- **证据不可复制。** Agent 手写或搬运证据 JSON = 伪造证据，缺印章或印章对不上当前提交时 `report` / `next` 当场拒绝。
- 少数复验**容忍工作区漂移但不容忍历史漂移**：如 `code-generation` 完成时复验 GREEN/BASELINE 只要求 `source_revision.commit` 是 HEAD 或其祖先（`core/tools/aidlc-revision.ts` · `commitAncestryErrors`），基线按代绑定规则不变。容忍不等于免检：`next` 复验上游门禁仍要现在为绿。

### 4.3 恢复输入后的重判

换工作区/换树后让证据重新有效的唯一路径是**由原生门禁重判**，不是复制旧证据：

```bash
loeyae-aidlc evidence run --stage <slug> --module <module-id> [--unit <unit-id>] --refresh
loeyae-aidlc orchestrate report --stage <slug> --module <module-id> --result completed   # re-attest
```

`--refresh` 按"选择性失效"重判：输入指纹未变的受控证据直接复用，输入变化才由 producer 在当前树重产（`core/tools/aidlc-evidence.ts` · `runSemanticProducer` 的 `refresh` 分支）；对**已完成**实例执行 `report` 属于 re-attest：重跑 consumes/produces/sensor，记录 `reattested` 历史，不改变进度，模块 parked 时也可执行。`orchestrate state evidence` 的 reuse plan 会把每份证据标为 `reuse` / `verify` / `revalidate`，任何不匹配（producer、时间、module/unit/instance、source revision、checker）都转为 `revalidate`（`core/tools/aidlc-evidence-reuse-plan.ts`）。恢复状态与未知 sensor 默认 24h 过期，外部依赖可用显式 freshness 窗口收紧。

## 5. 可复制 vs 必须重建/重判

| 类别 | 例子 | 复制合法性 | 恢复后校验路径 | 实现位置 |
|---|---|---|---|---|
| **配置** | `.aidlc/source-roots.json`、`.aidlc/commands/*.json`、module/unit manifest | ✅ 可复制（随 git 提交/合并分发） | 引擎读取时 fail-closed 重校验：格式、仓库根、符号链接、互相包含、tracked 冲突等，非法即抛错不回退 | `core/tools/aidlc-source-roots.ts`、`core/tools/aidlc-nested-repos.ts` |
| **控制面状态** | `aidlc/active/*.md`（state/audit/worktrees 登记、registry） | ✅ 随 git 合并分发，但**禁止整目录选边**：同一 lineage 逐文件按 `Revision` 取较新者，不同 lineage 文件不能混合 | `orchestrate state verify` 只读核对 lineage 与 Revision；写入需会话绑定与 claim | `core/knowledge/protocols/common-team-collaboration.md` § lineage、`core/tools/aidlc-light-state.ts` |
| **证据** | `.aidlc/evidence/**`（全部受控 producer 产物） | ❌ 不可复制。带 producer/checker/source_revision 防伪印章，绑定产出树，换树必失配；手写/搬运即伪造 | 恢复输入后在当前树 `evidence run --refresh` 重新产证 + `orchestrate report --result completed` re-attest | `core/tools/aidlc-evidence.ts`、`core/tools/aidlc-revision.ts` |
| **共享状态（会话身份）** | claim（`Active Instances`，含 session_id/generation）、`AIDLC_SESSION_BINDING`、worktree 元数据绑定 | ❌ 不可复制复用。claim 是会话身份，绑定只在本会话子命令环境有效；worktree 元数据绑定 member/path/branch | 新会话 `module inspect` → `module transfer --human-instruction-ref` 接手，`next --claim` 重新领取；worktree 按原元数据 verify | `core/tools/aidlc-session.ts`、`core/tools/aidlc-light-state.ts` · `assertSessionClaim`、`core/tools/aidlc-worktree-light.ts` |

## 6. 端到端恢复演练

场景：成员 alice 在模块 `module-a` 的 `code-generation@module:module-a` 上会话中断——claim 还挂在旧会话名下，worktree 留有已提交但未合并的变更，主 checkout 已切换工作环境导致部分证据失配。以下命令可直接照做（占位符按实际替换）。

**第 1 步：盘点现场**（任意会话，只读）

```bash
loeyae-aidlc runtime summary
# 看 active_instances[]（claim 的 owner / expires_at）、ready_instances、warnings（含 pending migration）
loeyae-aidlc module inspect --stage-instance code-generation@module:module-a
# 记下 claim 的 expires_at 与 expected 令牌
```

**第 2 步：接手 claim**（新会话；换会话即移交，必须有人工指令来源）

```bash
loeyae-aidlc module transfer --stage-instance code-generation@module:module-a \
  --owner alice --session-id <新会话 id> --expect <inspect 输出的 expected> \
  --human-instruction-ref "human:<owner>/<issue-或工单引用>"
# 输出 binding JSON；只在本会话使用
export AIDLC_SESSION_BINDING='<transfer 返回的 binding JSON>'
```

若旧 claim 未过期且拿不到人工指令引用：等 30 分钟 TTL 过期后再执行本步（记录仍在，仍需 transfer，见 §3.2）。

**第 3 步：重新领取路由**

```bash
loeyae-aidlc orchestrate next --claim --module module-a --owner alice
# 展示返回的 handoff_prompt，按 directive 恢复工作
```

**第 4 步：恢复 worktree**（原 worktree 仍在原路径时）

```bash
loeyae-aidlc worktree verify \
  --instance code-generation@module:module-a \
  --member alice \
  --path /absolute/path/to/module-a \
  --review-evidence .aidlc/review.json
# 校验元数据、分支、已提交变更与 review 覆盖；authorized: false
```

变更尚未提交时先在 worktree 内提交（`verify` 只认 committed clean）。原 worktree 丢失时见 §3.2 第 4 条：同实例 `prepare` 会被 EEXIST 拒绝，属当前边界。

**第 5 步：处理证据失配**（在主 checkout、当前树下重判，不要搬旧证据）

```bash
loeyae-aidlc evidence run --stage code-generation --module module-a --refresh
loeyae-aidlc orchestrate report --stage code-generation --module module-a \
  --owner alice --result completed
```

`--refresh` 按"选择性失效"重判：输入指纹未变的受控证据直接复用（输出 `action: "reused"`），输入变化才重跑 producer（`action: "regenerated"`）（`core/tools/aidlc-evidence.ts` · `runSemanticProducer`）。这里的 `report` 对尚未完成的实例是正常完成；对**已完成**实例则属于 re-attest——重跑 consumes/produces/sensor、记录 `reattested` 历史、不改变进度（`docs/loeyae-aidlc-cli-guide.md` § 证据作用域与修复）。若失配的是上游已完成阶段的证据，同样先 `evidence run --refresh` 再 re-attest 该阶段。

**第 6 步：收口**

```bash
loeyae-aidlc worktree merge-plan \
  --instance code-generation@module:module-a \
  --member alice \
  --path /absolute/path/to/module-a \
  --review-evidence .aidlc/review.json
# 拿 merge_command，由具备仓库权限的成员人工 merge --no-ff
```

涉及嵌套仓的实例在本演练中不会走到 worktree（第 4 步会被 `cannot isolate` 拒绝）：此类单元在主 checkout 工作，基线用 §1.2/§1.3 的 `--repo` / `--expect-repo` 维护，证据重判路径与第 5 步相同。
