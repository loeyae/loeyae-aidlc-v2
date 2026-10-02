# Changelog

## 4.6.0（草稿）

> 草稿：由 S1（MARS-47）起逐 issue 追加，P（MARS-46）合并为正式 `## 4.6.0`。版本号仍为 4.5.4。

### Fixed

- **`has_legacy_code` 只看 `src/`（S1.0）**：存量代码判定改为统计全部源码根（module-manifest `paths` → `.aidlc/source-roots.json` → 默认 `src`，与 4.5.4 D6 同一解析）下的文件数之和，阈值仍为"超过 10 个"。遍历跳过 `node_modules`、`.git`、`dist`、`build`、`target` 和隐藏项，嵌套源码根不重复计数；源码根不存在计 0 个文件。源码根配置无效（绝对路径、`..` 越界、符号链接/junction、manifest `paths` 非法）时该条件直接报错，不再静默当作"没有存量代码"。该值只在阶段条件读取 `has_legacy_code` 时才计算。
- **`diagram-format` 审计写入失败被当作成功（S1.5）**：`DIAGRAM_FORMAT_SET` 审计写入失败时命令返回 error，并提示"状态已写入、审计缺失，请人工补记"。
- **I13 `ready_ucd` 按出现次数计数（S2.0）**：`testCaseDerivation()` 原先统计 `status: ready` 在 `_index.md` 与用例文件中出现的次数，同一 UC-D 两处都写时 `ready_ucd` 大于 `ucd_total`，门禁报 `ready_ucd must equal ucd_total`。现在按 UC-D 去重，每个 UC-D 以自己的用例文件（含 `id: UC-D-xxx` 的 frontmatter 块；没有 frontmatter 块时按文件名认定）为准，`_index.md` 不参与计数。用例文件不是 ready、只在 `_index.md` 中出现、或同一 UC-D 在多个用例文件中声明时拒绝，报错列出具体 UC-D。

### Added

- **工作流基线状态字段（S1.1）**：`baseline_commit`（Markdown `- Baseline Commit:`）与 `baseline_source`（`- Baseline Source:`，`created` / `registered` / `replaced`）。两个字段须同时出现或同时缺失，commit 须为 40/64 位小写十六进制或 `unavailable`，否则 `loadWorkflowState` 拒绝；模块与集成子工作流状态里出现这两个字段同样拒绝。
  - 只有 `orchestrate next --scope` 新建全局/单一工作流时自动记录当前 HEAD（`source=created`，非 git 项目或尚无提交时为 `unavailable`），并写审计 `BASELINE_COMMIT_RECORDED`；`createInitialState()` 不写基线。
  - 4.6 之前的状态文件经过 `next`、`report`、`upgrade`、`park` 及任何普通保存后仍然没有基线字段；补登只能走 `orchestrate baseline --set`。
  - `saveWorkflowState` 的普通保存必须原样保留基线（修改、删除或在子工作流上写入都会被拒），只有 `orchestrate baseline` 的写入路径（`{ baselineWrite: true }`）可以登记或替换。
  - split 时全局工作流原样保留原单一工作流的基线，拆出的模块/集成子工作流不写，也不产生新的 `BASELINE_COMMIT_RECORDED`。子工作流通过共享函数 `workflowBaseline(projectRoot, ref)`（`core/tools/aidlc-baseline.ts`）读取父工作流的基线，父工作流没有时返回"未登记"。
- **`orchestrate baseline`（S1.2 / S1.3）**：不带参数时查看当前基线及来源；`--set <commit> --user-input Approve --reason "<理由>" [--dry-run]` 登记基线，`--set <new> --replace --expect <current> ...` 更正基线。
  - 参数：`--set` / `--expect` 必须是完整 40/64 位小写十六进制（缩写、`HEAD~3`、分支名、选项一律拒绝；`--expect` 另接受字面值 `unavailable`，见下），`--user-input` 必须恰好为 `Approve`，`--reason` 必填，`--dry-run` / `--replace` 为布尔开关，未知参数、多余位置参数和 `--module` 报错。
  - 前置条件：存在 running / parked 的全局或单一工作流；git 仓库且 git 可用。已设为同一值返回 `changed: false`；已设为不同值时 `--set` 拒绝并提示 `--replace`；没有基线时 `--replace` 拒绝并提示改用 `--set`。
  - 检查（`--set` 与替换的新 commit 相同）：对象存在且为 commit；是 HEAD 或其祖先（浅克隆无法判断时拒绝并提示 `git fetch --unshallow`）；是 `.aidlc/evidence/**` 中所有受控证据 `source_revision.commit` 的祖先或相等（证据无法解析时拒绝，没有证据时审计记 `Anchor Commits: none`）；`aidlc/active/aidlc-state.md` 被 git 跟踪时该 commit 的树里不能已有同一 Workflow ID 的状态文件；committer date 不晚于 `T0 = min(Created At, history[0])`（提交时间由提交者自报，只防误操作）。
  - 替换额外要求基线未被使用（扫描父工作流和全部子工作流）：U1 任一 `tdd` / `code-generation` / `code-review` / `build-and-test` 实例已完成或处于活动中；U2 已完成的 `test-case-derivation` 实例的 I13 证据含非空 `characterization`；U3 任何证据记录了 `baseline_commit`；U4 任何证据文件无法解析。任一成立即拒绝。
  - 基线为 `unavailable`（创建工作流时不在 git 仓库或仓库尚无提交）时，用 `--set <commit> --replace --expect unavailable ...` 更正（`--expect` 只接受严格小写的字面值 `unavailable`，`--set` 目标仍须为完整十六进制 commit，且同样须通过上述全部检查和 U1–U4）；F3 的报错直接给出该命令。目标 commit 的 committer date 须不晚于 T0，工作流若创建于仓库第一次提交之前则不存在合法基线，需要重新开始工作流。
  - 写入：全部检查通过后（`--dry-run` 到此为止）重新读取状态，revision 或 `--expect` 失效时拒绝；`history` 追加 `{ stage: "baseline", result: "registered" | "replaced", user_input: "Approve" }`；审计 `BASELINE_COMMIT_SET` / `BASELINE_COMMIT_REPLACED`（含 HEAD、自报的 committer/author date、Workflow Started At、Anchor Commits、Tracked State At Commit、Reason、User Input；替换另含 From / From Source / Expected / Usage Check / Replacement Count）。审计写入失败时返回 error 并提示"状态已写入、审计缺失，请人工补记"。
- **共享函数 `baselineCommitErrors(projectRoot, state)`（S1.4，`core/tools/aidlc-baseline.ts`）**：每次调用都重新检查基线已登记、不是 `unavailable`、commit 存在且仍是 HEAD 或其祖先（rebase 使基线成为孤立提交时报错），供后续门禁使用。
- 新增回归测试 `tests/test_v4_6_0_baseline.ts` 并加入 `npm test`。
- **UC-D `tdd_mode` 契约（S2.1）**：UC-D frontmatter 可声明 `tdd_mode: new | characterization`（默认 `new`）。`characterization` 必须写非空 `code_refs`、`reason`、`approval_ref`，`new` 不能写这三项；这四个字段只能出现在 frontmatter。`code_refs` 每项为 `<项目相对路径>[::<符号>]`，路径按 `normalizeSourceRoot` 规则处理（`\` / `/` 均可，拒绝绝对路径、盘符、UNC、`.`/`..`、控制面目录），且须落在源码根之内；工作区与基线中的符号链接均拒绝。UC-D 模板（`knowledge/protocols/test-case-derivation.md`）、`inception-test-case-derivation.md` 与 sensor 文档同步更新。
- **I13 扩展（S2.2）**：required 分支输出 `ucd_modes`（每个 UC-D 一项）；只有存在 characterization 时才输出 `characterization[]`（`ucd`、`code_refs[{ path, symbol?, baseline_blob }]`、`reason`、`approval_ref`）和 `baseline_commit`。
  - producer 校验（git 调用均为数组参数、`shell: false`）：git 仓库；基线取自 `workflowBaselineForModule()`（split 布局下模块子工作流读父工作流的基线）并通过 `baselineCommitErrors`；`git cat-file -e <base>:<path>` 成功且树条目是普通文件（非目录、非符号链接）；写了符号的，符号须作为完整标识符出现在 `git show <base>:<path>` 中；`bugfix` 至少 1 条 `new`。非 git 项目、基线为 `unavailable`、存量工作流未登记基线、基线因 rebase 成为孤立提交时拒绝 characterization。任一项失败 I13 整体失败。
  - 门禁复核：`ucd_modes` 与 `ucd_ids` 一一对应；characterization 条目与 characterization UC-D 一一对应且字段齐全；`baseline_commit` 须等于当前工作流基线并仍可从 HEAD 到达；每个 `code_refs` 重新解析到基线中的同一 blob；没有 characterization 时不得出现 `characterization` / `baseline_commit`。缺 `ucd_modes` 的旧证据视为全部 `new`（不得同时带 `characterization` / `baseline_commit`）。
  - 兼容性：未声明 `tdd_mode` 的项目 I13 结论不变，`ucd_modes` 全部为 `new`，证据不含 `baseline_commit`（S1.3 U3 依赖这一点）。
- 新增回归测试 `tests/test_v4_6_0_tdd_mode.ts` 并加入 `npm test`；`tests/test_python_refactor_e2e.ts` 的 `_index.md` 改回普通列表写法（同时写 `status: ready`）。
- **BASELINE 证据与命令角色 `role: baseline`（S3a）**：tdd 阶段新增 sensor `baseline-test-evidence`，产物 `.aidlc/evidence/tdd/{module-id}/{unit-id}/baseline-test-evidence.json`（graph `produces` 静态声明）。RED 覆盖 I13 `ucd_modes` 中的 `new` UC-D，BASELINE 覆盖 `characterization` UC-D。
  - 命令清单新增 `role: baseline`，沿用 G1：只认默认查找（`.aidlc/commands/tdd.json` → `.aidlc/evidence-commands.json`）、恰好一条；`observed_command.argv_digest` 绑定清单命令，`checker.argv_digest` 由其派生（`BASELINE-observation`）。沿用 M1：`--sensor baseline-test-evidence` 与 `--all-sensors` 带指向其他文件的 `--config` 时，在执行任何命令、写任何证据之前拒绝。
  - producer：执行命令之前用 `git hash-object`（数组参数、`shell: false`）计算 I13 `characterization[]` 中每个 code ref 当前工作区文件的 blob，与 `baseline_blob` 不同（或文件缺失）直接失败、不出证据；命令须退出 0，观察结果须 `status=passed`、`tests_failed=0`、`tests_total≥1`。证据记录 `baseline_commit`、`code_ref_digests[{ path, baseline_blob, worktree_blob }]` 与 `observed_command`。
  - `not_required`：I13 没有 characterization UC-D（含 I13 为 `not_applicable`）时 BASELINE 写 `status: "not_required"`、`ucd_ids: []`，不执行命令，清单也不必声明 `role: baseline`；I13 没有 `new` UC-D 时 RED 同样写 `not_required`。I13 为 `not_applicable` 时 RED/GREEN 原有分支不变。
  - tdd 门禁：RED 的 `uc_mapping` 须恰好覆盖全部 `new` UC-D、不得包含 characterization，RED `not_required` 仅在无 `new` 时接受。BASELINE 的 producer / checker / provenance 契约同 RED；`observed_command` 绑定 `role: baseline` 且 `exit_code=0`；`uc_mapping` 恰好覆盖全部 characterization UC-D、不得包含 `new`；`baseline_commit` 在状态（`workflowBaselineForModule`）、I13、证据三处一致并通过 `baselineCommitErrors`；`code_ref_digests` 与 I13 code ref 一一对应、`worktree_blob == baseline_blob`，且门禁现场重新解析基线 blob 比对；BASELINE `not_required` 仅在 I13 无 characterization 时接受。缺 `ucd_modes` 的旧 I13 视为全部 `new`。
  - `checkSensors` 按阶段声明的全部 sensor 复验 tdd 实例，因此 code-generation 完成时对 RED 的漂移容忍复验（现有 2 个调用点）同时覆盖 BASELINE。
- 新增回归测试 `tests/test_v4_6_0_baseline_evidence.ts` 并加入 `npm test`。
- **下游门禁按 `tdd_mode` 判定（S3b）**：
  - code-generation GREEN：I13 为 `required` 时，`uc_mapping` 须恰好覆盖 I13 全部 UC-D（`new` 与 characterization），漏写、多写或重复都会被拒。
  - code-generation 完成与 re-attest 时连同 RED 复验 BASELINE（仍只有原有 2 个 `tolerateRevisionDrift` 调用点）：只容忍工作区漂移，`source_revision.commit` 须为 HEAD 或其祖先，`producer.mode` 等 provenance 与基线绑定照常校验；基线被替换后，旧基线下产出的 BASELINE 证据被拒。`next` 复验上游维持严格模式，不容忍漂移。
  - test-quality：checker 按各模块 I13 `ucd_modes` 判定——有 `new` UC-D 时要求 RED `failed`（behavior），没有时 RED 须为 `not_required`；有 characterization UC-D 时要求 BASELINE `passed`、`tests_failed=0`，没有时须为 `not_required`；证据新增 `baseline_seen`，`red_seen` 只在有 `new` UC-D 时为 true。门禁按同一规则要求 `red_seen` / `baseline_seen`（读不到 required I13 时仍要求 `red_seen`）。每个 UC-D 都须有测试映射的规则不变。
- **文档（S3b）**：`construction-tdd.md` 统一为"新行为 RED→GREEN，存量行为 BASELINE→GREEN，不再提供豁免"，删去"纯重构不新增行为可豁免"，并补充 BASELINE 步骤与 bug 修复流程；新增 `sensors/baseline-test-evidence.md`；`red-test-evidence.md`、`green-test-evidence.md`、`test-quality.md`、`skills/aidlc-build-test-evidence/SKILL.md`（`role: baseline`、characterization 流程）与 README 同步更新。
- 新增端到端回归测试 `tests/test_v4_6_0_downstream.ts` 并加入 `npm test`：(a) refactor（Python `app/`、无 `src/`、全部 characterization），(b) bugfix（`new` 与 characterization 混合，含 S3b 负向用例及以真实 BASELINE 证据触发的 U3 `--replace` 拒绝），(c) 存量工作流先 `orchestrate baseline --set` 再走完全程，(d) split 布局模块子工作流继承父工作流基线；均只用受控 producer 产证，跑到 implementation-report 完成。

### Upgrade notes

- **I13 用例文件写法收紧（S2.0）**：`ready_ucd` 改为按 UC-D 去重、以每个 UC-D 自己的用例文件为准后，以下三种以前可能被放行的写法现在会被 I13 拒绝，升级后请按需调整并重新产证：
  - **同一 UC-D 不得在多个用例文件中声明**：每个 UC-D 只能有一个用例文件（或一个带 `id: UC-D-xxx` 的 frontmatter 块）声明它；重复声明时报错并列出涉及的文件。
  - **仅出现在 `_index.md`（或其他文件正文引用）中的 UC-D 不算 ready**：`_index.md` 不再参与计数，没有自己用例文件的 UC-D 报 `no case file declares it`；请为其补充单独的用例文件并写 `status: ready`。
  - **无 frontmatter 的聚合文件不再支持**：一个文件里写多个 UC-D、每个只靠正文中的 `status:` 行的写法不再被识别。支持的写法只有两种：每个 UC-D 一个带 `id: UC-D-xxx` 的 frontmatter 块（一个文件可以包含多个块），或者文件名含 UC-D 编号、正文写 `status:`。
  - 已生成的 I13 证据不会自动重算（见 4.5.4 Upgrade notes）；调整用例文件后，已完成的 I13 实例用 `loeyae-aidlc evidence run --stage test-case-derivation --module <id> --refresh` 重新产证。
- **RED 新增 `uc_mapping` 覆盖检查（S3a）**：tdd 门禁要求 RED 的 `uc_mapping` 恰好覆盖 I13 中全部 `new` UC-D（缺 `ucd_modes` 的旧 I13 即全部 UC-D），多写或漏写都会被拒；请让 red 命令输出的映射与 I13 一致后重新产证。
- **tdd 阶段新增 `baseline-test-evidence.json` 产物（S3a）**：没有 characterization UC-D 时为 `not_required`，由 `report` 自动产出，无需新增命令清单条目；有 characterization UC-D 时须在 `.aidlc/commands/tdd.json` 声明恰好一条 `role: baseline` 命令。
- **已完成的 tdd 实例需补齐 BASELINE 证据（S3a）**：升级前完成的 tdd 实例没有该产物，`next` 复验上游时会阻断（不提供按证据版本的兼容豁免）。对每个已完成的 tdd 实例执行 `loeyae-aidlc evidence run --stage tdd --module <id> --unit <id> --sensor baseline-test-evidence --refresh` 补齐后再继续。
- **GREEN 新增全部 UC-D 覆盖检查（S3b）**：green 命令输出的 `uc_mapping` 须与 I13 的 `ucd_ids` 完全一致；只映射部分 UC-D 的 GREEN 证据会被拒，请修正命令输出后重新产证。
- **test-quality 证据新增 `baseline_seen`（S3b）**：升级前产出的 test-quality 证据没有该字段，若模块有 characterization UC-D，门禁会要求重新产证（`evidence run --stage <code-generation|code-review|build-and-test> ... --sensor test-quality --refresh`）。未声明 `tdd_mode` 的项目行为不变。

## 4.5.4

本版本修复 Python / 非 `src/` 项目在 `scope=refactor`、无 module-manifest 时无法用受控证据走完流程的引擎缺陷，并归入此前 Unreleased 的 I13 修复。所有修复都保持 fail-closed：只让真实合规的受控证据通过，缺字段或伪造的证据仍被拒绝。

### Fixed

- **review-evidence 缺 review 模式字段（阻断 code-review）**：内置 checker 从不输出 `reviewer_agent` / `execution_context` / `review_only`，`mode: review` 阶段的受控证据永远被拒。现在 `reviewer_agent` 取自阶段元数据，`execution_context` / `review_only` 只取自审查记录中的显式声明（`execution_context: isolated`、`review_only: true`），未声明则不输出。code-review 阶段文档与审查记录模板已写明这两项为必填。
- **空的 `AIDLC_ACTIVE_MODULE` / `AIDLC_ACTIVE_UNIT` 被当作请求模块上下文（阻断 build-and-test）**：producer 在模块/单元为空时不再设置这两个变量（并丢弃继承来的旧值），checker 只把非空值视为上下文请求。`--module` / `--unit` 与 workflow state 中模块/单元的规则不变。
- **implementation-report 的 `modules_verified` 两边不一致**：新增共享函数 `verifiedModuleIds()`（`core/tools/aidlc-execution-context.ts`），orchestrate 门禁与 checker 共用；无 manifest 的非完整 scope 参与验证的模块为默认模块 `project`（此前门禁用 `default`、checker 计 0）。
- **traceability-matrix 不扫描 Python 等语言**：新增共享语言常量 `SOURCE_EXTENSIONS`（java/kt/ts/tsx/js/jsx/vue/py/go/rs/cs）与 `SOURCE_FILE_PATTERN` / `TEST_FILE_PATTERN`（`core/tools/aidlc-scan-root.ts`），traceability-matrix 的 code/test 层与 test-quality 统一使用。测试文件模式同时排除 `/` 与 `\`，修正 Windows 绝对路径中父目录含 `test` 时所有文件都被当作测试文件的问题。
- **code-generation 硬编码 `produces: src/`**：`src/` 保留为源码根的规范占位，按 module-manifest `paths` → `.aidlc/source-roots.json` → 默认 `src/` 解析（`core/tools/aidlc-source-roots.ts`）。`checkProduces` / `checkConsumes`、`no-todo`、`traceability` 与 directive 显示均使用解析结果；每个源码根都须存在且非空，拒绝绝对路径、`..` 越界、控制面目录和符号链接/junction。
- **受控 RED/GREEN 证据无法通过门禁**（建单后在端到端复现中发现）：I13 为 `required` 时，producer 把 `checker.id` 写成命令 id、RED 的 `checker.exit_code` 写成 1，而门禁要求 `builtin:<sensor>` 与退出码 0，真实 TDD 路径永远被拒。现在 `checker` 为内置检查，被观察的测试命令记录在新字段 `observed_command`；门禁新增要求 `observed_command` 存在且 RED 退出码为 1、GREEN 为 0。
- **收紧：RED/GREEN 观察命令未绑定命令清单**（审查发现）：门禁此前只校验 `observed_command.argv_digest` 的格式，换成任意合法 SHA-256 仍放行。现在门禁按 producer 同一套查找与 stage 锁定逻辑（`resolveCommandConfigPath` + `parseConfig`，共享函数 `allowlistedPhaseCommand()`）取本阶段唯一的 red/green 命令，要求 `observed_command.argv_digest` 等于其 argv digest、`observed_command.id` 等于命令 id，并要求 `checker.argv_digest` 等于 `phaseObservationDigest(phase, observed_command.argv_digest)`。命令清单缺失、无法解析、stage 不匹配或不是恰好一条对应命令时拒绝，不跳过绑定。not_applicable 分支不变。
- **GREEN 完成时 RED 证据必然失配**（建单后在端到端复现中发现）：`code-generation` 完成时复验 RED 证据的 `source_revision`，但 GREEN 实现必然改变代码树，导致永远报 `worktree_digest no longer matches`。该复验现在只容忍工作区漂移（字段格式仍须合法），producer、checker、`observed_command` 与观察内容校验不变；其他场景的 provenance 绑定不变。
- **收紧：容忍漂移时不约束 commit**（审查发现）：上一条的容忍模式此前完全不检查 `source_revision.commit`，填不存在的提交也放行。现在容忍模式要求记录的 commit 为 40/64 位十六进制且是当前 HEAD 或其祖先（`git merge-base --is-ancestor`，`spawnSync` 数组参数、不经 shell）；提交不存在、非祖先或 git 不可用时拒绝，非 git 项目（`unavailable`）要求严格相等。split 布局的 `scope_digest` 容忍不变，但同样受 commit 祖先约束。容忍范围仍只限 `code-generation` report/re-attest 对 RED 的复验。
- 修复 I13 `test-case-derivation` 检查器因路径重复拼接而读不到测试用例的问题：`testCaseDerivation` 向 `allFiles` 传入了已拼接 ROOT 的绝对路径，导致目录被拼成 `/r/r/x`（Windows 为 `E:\r\E:\r\x`），用例目录明明存在 `UC-D-xxx` 却报 "I13 test case directory contains no UC-D identifiers"。现改为传相对路径。
- `allFiles` 对绝对路径幂等：扫描根解析抽到 `core/tools/aidlc-scan-root.ts`（`resolveScanRoot` / `scanFiles`），base 已是绝对路径时不再拼接 ROOT，防止同类问题复发。
- 新增回归测试 `tests/test_i13_case_root.ts`（模块化布局的 ready / blocked 用例，以及相对/绝对路径与 POSIX/Windows 路径语义的单元测试），并加入 `npm test`。
- 修复 I13 `test-case-derivation` 中文关键词（`验收`、`接口`、`业务行为`、`业务规则`、`状态转换`、`可执行`）几乎无法匹配的问题：原正则把整个关键词分组放在 `\b` 之后，而 `\b` 只认 ASCII 单词边界，关键词前面是中文、中文标点、空格或行首时匹配失败，只用中文描述行为的需求被误判为无可执行行为并被要求提供 `non-applicable.json`。现在 `\b` 只作用于英文分支，英文匹配结果与原正则完全一致（`APIs`、`endpoints`、`Scenarios` 仍命中，`myAPI` 仍不命中）。关键词正则抽到 `core/tools/aidlc-executable-behavior.ts`（`EXECUTABLE_BEHAVIOR` / `hasExecutableBehavior`）。新增回归测试 `tests/test_i13_executable_behavior.ts` 并加入 `npm test`。

### Changed

- **命令清单按阶段查找**：`evidence run`（以及 `report` 自动产证）按 `--config` 显式指定 → `.aidlc/commands/<stage>.json` → `.aidlc/evidence-commands.json` 的顺序查找命令清单，多阶段工作流不再需要反复覆盖同一文件。选中的文件仍须锁定当前阶段，否则拒绝。RED/GREEN 例外：门禁只按默认顺序绑定，producer 拒绝指向其他文件的 `--config`。
- **I13 豁免优先**：模块的 `test-cases/non-applicable.json` 只要存在，就先按现有规则完整校验（`schema_version=1`、`status=not_applicable`、`reason_code` 合法、`reason` / `approval_ref` / `alternative_validation` / `validation_command` 非空、`source_refs` 为字符串数组）；校验通过直接判 `not_applicable`，不再看关键词；校验失败直接报错，不回退到 UC-D 分支。豁免不存在时才按关键词判断。"至少存在一个源文件"的前置检查顺序不变。
- **放宽：修复前已命中关键词的项目**（英文 `Given` / `API` 等，或碰巧命中的中文如 `REQ-1验收`），只要模块里有合法的 `non-applicable.json`，现在判为 `not_applicable`（以前豁免被忽略、进入 UC-D 校验）。I13 全部 not_applicable 后的下游联动：`test-quality` 返回 not_applicable；RED/GREEN 证据允许为 `not_applicable`，但仍须提供 `not_applicable_reason`、`alternative_validation` 和受控的 `alternative_validation_execution`；`code-generation`、`code-review`、`build-and-test` 跳过 `traceability` sensor，`traceability-matrix` sensor 仍照常执行。豁免需要 `approval_ref`，属于人工批准的例外。**请检查存量项目 `test-cases/` 下是否遗留过期的 `non-applicable.json`。**
- **收紧：含关键词 + 不合法豁免**：以前会被悄悄忽略，现在报错。不合法包括字段缺失或为空、`schema_version` / `status` / `reason_code` 不符合要求、JSON 无法解析（`<path> is not valid JSON: ...`）、能解析但不是对象（如 `null`、数组，`<path> must contain a JSON object`）。请补全修正或删除这类文件。
- 中文否定表述（如"本模块不包含可执行业务行为"）在无豁免、无用例时，报错从缺少 `non-applicable.json` 变为 "I13 requires test case index"，仍会阻断。

### Upgrade notes

- **RED/GREEN 证据格式**：4.5.3 及以前由命令产生的 RED/GREEN 证据没有 `observed_command`，会被 4.5.4 门禁拒绝（这些证据在 4.5.3 本就因 `checker.id` 无法通过）。用 `loeyae-aidlc evidence run --stage <tdd|code-generation> --module <id> --unit <id>` 重新产证；not_applicable 分支不受影响。
- **RED/GREEN 命令 digest 必须与命令清单一致**：`observed_command.argv_digest` 须等于当前阶段命令清单（`.aidlc/commands/<stage>.json` → `.aidlc/evidence-commands.json`）中唯一 red/green 命令的 argv digest。产证后修改了命令 argv、删除清单或把共享的 `.aidlc/evidence-commands.json` 改写成另一个 stage，都会使已有 RED/GREEN 证据失效；RED/GREEN 的 `evidence run --config <其他文件>` 现在由 producer 直接拒绝，不再产出证据（指向默认查找到的同一文件仍允许）。多阶段工作流请使用 per-stage 文件 `.aidlc/commands/tdd.json` 与 `.aidlc/commands/code-generation.json`，并在修改清单后重新产证。
- **`--all-sensors --config` 整次拒绝**：tdd / code-generation 阶段使用 `evidence run --all-sensors --config <其他文件>` 时整次运行被拒，同阶段的其他 sensor 也不会产出证据（拒绝发生在任何 sensor 执行之前）。如需为这两个阶段的其他 sensor 指定命令清单，请把命令写入 `.aidlc/commands/<stage>.json` 并省略 `--config`。
- **RED 复验要求 commit 为祖先**：GREEN 完成时复验的 RED 证据，其 `source_revision.commit` 必须是当前 HEAD 或其祖先。RED 之后执行 rebase / reset 到其他历史，或在另一分支产出的 RED 证据，需要在当前分支重新执行 RED（`evidence run --stage tdd ... --refresh`）。
- **非 `src/` 项目**：在 `.aidlc/source-roots.json` 写入 `{ "version": "1", "source_roots": ["app"] }`（或在 module-manifest 中声明 `paths`）。源码根下的每个文件仍须满足 `traceability`（引用 `REQ-xxx`）与 `no-todo`，与此前对 `src/` 的要求一致。
- **code-review 记录**：`mode: review` 阶段的审查记录需新增 `execution_context: isolated` 与 `review_only: true` 两行声明。
- **已生成的 I13 证据不会自动按新规则重算**：`report` 只为缺失的证据文件自动生成证据；证据超过 24 小时也不会触发重新生成（`next` 复验上游时跳过 stale 类失败）。只有手动重新生成、删除证据后重新 `report`，或 provenance 失配时才会按新规则判定；provenance 失配时 `next` 会阻断并提示 refresh，不会自动重算。失配条件取决于布局：
  - 旧的 worktree 布局（`source_revision.scope` 缺失或为 `worktree`）：证据绑定 `commit`、`dirty` 和整个工作区 `worktree_digest`，任何新 commit 或已跟踪文件 / 未被忽略的未跟踪文件改动都会让证据失效；
  - split 布局（`source_revision.scope` 为 `module:<id>` 或 `global`）：证据只绑定该 scope 的 `scope_digest`，其他模块目录、integration 目录和其他模块 `paths` 下的改动不会让它失效。
- 按新规则重新判定 I13：
  - 已完成的 I13 实例：`loeyae-aidlc evidence run --stage test-case-derivation --module <id> --refresh`，然后 `loeyae-aidlc orchestrate report --stage test-case-derivation --module <id> --result completed` 复验；
  - 当前活动的 I13 实例：`loeyae-aidlc evidence run --stage test-case-derivation --module <id>`（不带 `--refresh`，对活动实例使用 `--refresh` 会报 "the active instance uses a normal evidence run"）。
