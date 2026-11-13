> Historical 4.x design/evaluation; not current execution instructions. See [current rules](../../../core/knowledge/protocols/host-execution.md).

# 多仓库与临时 Worktree：初始化、恢复与证据边界指南

## 默认宿主执行

先用 Git 核对每个实际仓库、分支、worktree、未提交修改和正在运行的任务，再从既有需求、代码、测试结果恢复本次工作。旧 workflow、claim、基线或证据失配不自动阻断独立本地开发；已确认的授权继续有效，未知旧进程和真实写入冲突须先核实。新建 worktree 取决于实际隔离需要，不作为 CR 的固定前置步骤。

按实际改动及依赖决定复验范围；代码、测试、依赖、配置或环境变化时重验对应检查，纯记录整理不要求重复测试。跨仓提交、合并与发布按用户授权执行，各仓实际状态分别报告。共享规则见[宿主执行协议](../core/knowledge/protocols/host-execution.md)。

## 显式受管兼容参考

以下 `.aidlc/source-roots.json`、基线、领取、受控证据和恢复命令仅适用于用户明确选择维护旧受管流程的情况。默认执行不按此清单补建记录，已有真实批准和受管记录也不自动改写。

本文回答一个使用问题：**多仓库（嵌套仓库）与临时 worktree 的会话中断、更换工作区、证据失配之后，哪些东西可以复制，哪些必须由原生门禁重判。** 命令速查见 `docs/loeyae-aidlc-cli-guide.md`，协作约定见 `core/knowledge/protocols/common-team-collaboration.md`。

以下兼容参考最初按 4.22.17 核对；历史报错与能力说明不作为当前默认模式入口。当前受管命令以 CLI 帮助和实现为准；每条规则以（`实现文件` · `符号`）标注原核对位置。

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

输出 merge-plan JSON：`authorized: false`、变更路径清单和建议命令 `merge_command: git -C <project> merge --no-ff <branch>`。该计划不代替实际合并授权；实际 merge、push 和 worktree 清理按已有用户授权及仓库要求，由宿主或有权限的成员执行。

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
3. 把 transfer 返回的 binding JSON 仅传给当前会话的子命令，先 `orchestrate next --preview` 核对精确实例，再以有效 binding 执行 `orchestrate next`。已移交的实例不重复 `--claim`，也不把单元绑定用于其他单元。
4. worktree 的中断恢复：元数据仍在主 checkout 控制面，`verify` / `merge-plan` 按**原**元数据校验原路径，原 worktree 还在就直接续用（见 §6 演练）。原 worktree 丢失而实例未完成时，同实例重复 `prepare` 会被一次性写入拒绝（EEXIST）——这是当前边界，没有 worktree 注销命令。

### 3.3 显式释放自己的 claim

当前支持 `module release --stage-instance <instance> --expect <inspect.expected>`。持有有效 binding 的原会话先 inspect，再释放自己的精确 claim；命令不推进阶段、不暂停 workflow、不改业务产物和批准，原 binding 随即失效。实现见 `core/tools/aidlc-team-light.ts` 的 release 分支及 `core/tools/aidlc-session.ts` 的 `releaseSession`。

丢失 binding 或更换会话时，仍按上一节的真实移交授权处理；TTL 过期不代替人工指令来源，也不证明旧进程已退出。不得删除他人的 claim 或伪造完成报告来归档；`orchestrate archive` 要求未结算 claim 已合法处理。

## 4. 证据边界

### 4.1 `source_revision` 的逐仓记录语义

受控证据由确定性 producer 生成并盖章：`producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id }`、`checker`（含 `argv_digest`）与 `source_revision`（`core/tools/aidlc-evidence.ts` · evidence run 写出路径）。声明了嵌套仓时，`source_revision.repos` 按仓库路径逐仓记录 `{ commit, dirty, worktree_digest }`：HEAD、`git status` 是否有变动（含未跟踪文件）、以及对该仓库 `git ls-files -co --exclude-standard` 全量文件的内容摘要（`core/tools/aidlc-revision.ts` · `readSourceRevision`、`nestedRevision`）。工作流仓库自身的 `worktree_digest` 排除控制面（`aidlc/`、`.aidlc/`、`.gitattributes`、`.gitignore`）。

### 4.2 按证据实际绑定判断有效性

不同 checkout 或提交不自动等于所有业务输入已变化。历史全工作树绑定按原 commit、dirty 和摘要校验；带 `scope_digest` 的证据按所属范围内容、历史关系、命令和环境等适用约束核验，其他模块及允许的派生记录变化不必使它失效。BASELINE 的 `code_ref_digests[]` 仍在证据所属代核对 `baseline_blob` / `worktree_blob`。

- 保存或恢复原始证据不授予新身份、领取或执行权限。不得改写原始结果、签名、时间戳和绑定来制造通过；是否能复用由当前消费者校验，不能仅凭文件存在判断。
- 提交祖先关系只是校验的一部分；历史基线、执行输入、测试来源和适用环境仍须满足对应契约。新的 GREEN v2 可识别规范计划的纯勾选进度，历史 v1 保留原绑定；详见 `core/sensors/green-test-evidence.md`。

### 4.3 先诊断，再定向恢复

先读取 `orchestrate state evidence` 的复用计划及实际门禁诊断，区分身份/领取问题、语义记录缺失、真实输入变化和验证失败。修复身份不要求顺带重跑业务测试；仍有效的原始结果直接沿用。

```bash
loeyae-aidlc orchestrate state evidence
# 仅当指定检查确实需要重验时，在有效绑定下运行：
loeyae-aidlc evidence run --stage <slug> --module <module-id> --unit <unit-id> --sensor <affected-sensor> --refresh
```

参数按实际阶段轴填写，项目/模块阶段不伪造 unit。显式调用 GREEN producer 会执行受控测试命令，不能把 `--refresh` 当作无成本的进度更新。已完成阶段确需 re-attest 时沿用原 report 语义；引擎可定向修复缺失的语义证据，但失败或缺失的 GREEN 不能被摘要补成通过。仅相关输入、环境或有效期确实失效时重新执行对应检查，不默认刷新整条证据链。

## 5. 可复制 vs 必须重建/重判

| 类别 | 例子 | 复制合法性 | 恢复后校验路径 | 实现位置 |
|---|---|---|---|---|
| **配置** | `.aidlc/source-roots.json`、`.aidlc/commands/*.json`、module/unit manifest | ✅ 可复制（随 git 提交/合并分发） | 引擎读取时 fail-closed 重校验：格式、仓库根、符号链接、互相包含、tracked 冲突等，非法即抛错不回退 | `core/tools/aidlc-source-roots.ts`、`core/tools/aidlc-nested-repos.ts` |
| **控制面状态** | `aidlc/active/*.md`（state/audit/worktrees 登记、registry） | ✅ 随 git 合并分发，但**禁止整目录选边**：同一 lineage 逐文件按 `Revision` 取较新者，不同 lineage 文件不能混合 | `orchestrate state verify` 只读核对 lineage 与 Revision；写入需会话绑定与 claim | `core/knowledge/protocols/common-team-collaboration.md` § lineage、`core/tools/aidlc-light-state.ts` |
| **证据** | `.aidlc/evidence/**`（受控 producer 产物） | 可保留原始记录；备份或文件存在不证明当前有效，不得改写绑定或伪造通过 | 按实际 scope、来源、命令、环境和授权检查；有效项复用，仅重验失效项，见 §4 | `core/tools/aidlc-evidence.ts`、`core/tools/aidlc-revision.ts` |
| **共享状态（会话身份）** | claim（`Active Instances`，含 session_id/generation）、`AIDLC_SESSION_BINDING`、worktree 元数据绑定 | ❌ 不可复制复用。claim 是会话身份，绑定只在本会话子命令环境有效；worktree 元数据绑定 member/path/branch | 新会话 `module inspect` → `module transfer --human-instruction-ref` 接手，`next --claim` 重新领取；worktree 按原元数据 verify | `core/tools/aidlc-session.ts`、`core/tools/aidlc-light-state.ts` · `assertSessionClaim`、`core/tools/aidlc-worktree-light.ts` |

## 6. 端到端恢复示例

场景：用户明确恢复 `module-a` 中 `unit-a` 的受管实施。先核对真实现场，不把中断本身当作重新执行整条流程的原因。

1. 用 `runtime summary` 和 `module inspect --stage-instance code-generation@module:module-a@unit:unit-a` 读取当前状态、精确领取和未完成范围。
2. 复用有效 binding；新会话依 §3.2 及已有真实授权移交，不能等 TTL 后自行接管。原会话需要释放时按 §3.3 执行 release，不伪造阶段完成。
3. 在目标工作目录用本会话 binding 预览和继续：

   ```bash
   loeyae-aidlc orchestrate next --module module-a --unit unit-a --preview
   # 仅当预览仍属于当前精确绑定且可以继续时：
   loeyae-aidlc orchestrate next --module module-a --unit unit-a
   ```

   当前单元无下一阶段时，按返回的剩余范围处理；不能据此宣称整个模块或项目完成，也不重复领取其他人的工作。
4. 原 worktree 仍可用时继续使用。需要 verify/merge-plan 时按 §2 检查实际路径、已授权提交及真实审查，不为恢复强制另建 worktree；路径丢失或未知旧进程先诊断。
5. 按 §4 从复用计划定位失效项。有效 GREEN 及原始运行结果保持不变；只有相关业务输入、环境或命令确实变化时才运行对应检查。证据修复和 re-attest 使用实际 stage/module/unit，不默认执行阶段级 `--refresh`。
6. 分别报告实施、验收、提交/合并和遗留事项。需要合并时生成或查看 merge plan，实际操作遵循已有用户授权及仓库要求；领取、workflow 完成和实际合并互不替代。
