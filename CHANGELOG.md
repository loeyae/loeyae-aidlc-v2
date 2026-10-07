# Changelog

## Unreleased

文件级 sensor（no-todo / traceability）与源码 produce 存在性判定只看本单元交付的变更文件，不再检查源码根全集（MARS-95）。

### Fixed

- **交付文件集**：module/unit 上下文且已登记基线（模块接管基线 → 全局基线链，当前代即 `--advance` 后的 GREEN 锚点）时，canonical `src/` 解析为各源码根在各自仓库内（嵌套仓库在子仓库 cwd）`git diff --name-only <baseline>`（基线后的提交 + 暂存/未暂存改动）加未跟踪文件，只取已跟踪/未忽略的文本文件；`.gitignore` 命中的文件（即使已跟踪）和含 NUL 字节的二进制文件一律排除。
- **no-todo** 只检查交付文件集；**traceability** 对源码改为「交付文件集中至少一个文件引用本单元 `req_refs` 中的 REQ」（未声明 `req_refs` 时为任一 REQ/R 编号），逐文件 REQ 标记交给 traceability-matrix 的 code_refs 层；文档类 produce 仍要求每个文件含 REQ。
- **交付文件集为空**：声明 `ucd_exemption` 的 unit 源码 produce 为 `not_applicable`，`report` 写审计事件 `SOURCE_DELIVERY_NOT_APPLICABLE`（含基线与豁免 reason_code / approval_ref / reason）并在返回中带 `source_delivery`；其他 unit 报 `本单元未交付任何源码变更`，不静默通过、不退回全集。
- **已完成单元**：基线已 `--advance` 到本单元 GREEN 证据的提交（第 k 代）时，本单元的交付文件集为第 k-1 代到第 k 代的已提交范围，不混入后续单元的改动；re-attest 已完成单元时空交付不报错（其交付在完成时已校验）。lightweight worktree 跳过的嵌套仓库不计入交付，worktree 与主检出给出相同结论。
- **collectFiles → git ls-files**：源码根的存在性判定（produces / consumes）与文件枚举改用 `git ls-files --cached --others --exclude-standard`，尊重 `.gitignore`，排除二进制。

### Unchanged

- 没有基线（全新项目、未登记基线）时，范围为源码根下已跟踪/未忽略的文本文件，逐文件规则与 4.11.0 一致；不在 git 仓库中时按文件系统枚举（排除二进制）。
- lightweight worktree 跳过的嵌套仓库源码根仍按主检出判定存在性。
## 4.11.0

traceability-matrix 的 code_refs 层按单元收敛并豁免 `ucd_exemption` 单元；子进程输出溢出（ENOBUFS）成为独立错误（MARS-94）。

### Added

- unit-manifest `units[].req_refs: string[]`：该 unit 代码交付的 REQ（非空、不重复、形如 `REQ-xxx`）；引用 requirements.md 中不存在的 REQ 时矩阵输出 `REQ-xxx: UNKNOWN_REQ_REF@unit-manifest(...)`。
- `unit_scope.code_refs_layer_reqs`（排序）与 `code_refs_source`（`req_refs` / `ucd_subset` / `module` / `ucd_exemption`）。

### Fixed

- **code_refs 层按单元收敛**：unit 上下文按 `req_refs` → 本单元 UC-D 子集用例文件引用的 REQ → 模块全集确定检查范围，不再要求每个 unit 的代码覆盖模块全部 REQ。
- **豁免单元**：声明了 `ucd_exemption` 且 I13 `ucd_units` 中没有该 unit 时，code_refs 层与 tests 层为 `not_applicable`（`unit_scope.code_refs_layer = "not_applicable(ucd_exemption)"`，带 `exemption.reason_code`），其他层不变。
- **源码扫描范围**：code_refs 层只扫本模块源码根（module-manifest `paths` → `.aidlc/source-roots.json`，含嵌套仓库），不再扫整个项目；其他模块代码里的 REQ 标记不再算作本模块已覆盖。两者都没有声明的项目没有源码归属信息，保持 4.10.1 的全项目扫描。
- **ENOBUFS**：引擎所有缓冲子进程（git、受控命令、语义检查器、`evidence run`、CLI 转发）经 `core/tools/aidlc-spawn.ts` 统一使用 64 MB 上限（原先部分调用为 Node 默认 1 MB，CLI 转发 orchestrate 输出即是其一）。溢出时 `orchestrate` 输出独立的 `kind: "error"`，`subprocess: { argv, max_buffer }` 指出溢出的子进程（argv[0..1]，`node tsx <script>` 带脚本），不再与 sensor 门禁失败拼成一条；子进程内的溢出逐层上抛。`AIDLC_SUBPROCESS_MAX_BUFFER`（字节）可覆盖上限，用于诊断。

### Unchanged

- 没有 unit 上下文（build-and-test）时证据结构与 4.10.1 一致，按模块全集对账：每条 REQ 至少被本模块某处代码引用，否则 `BROKEN@code_refs`。
- 不声明 `req_refs`、I13 没有 `ucd_units` 时 unit 上下文的证据结构与 4.10.1 一致（无 `unit_scope`）。

## 4.10.1

修复类版本：`orchestrate baseline --adopt` 的两条守卫不再把 `ucd_exemption`（空 UC-D 子集）单元算作模块已进入 tdd（MARS-93）。

### Fixed

- **「接管 commit 不晚于模块第一个 tdd 开始时间」**：只统计拥有 UC-D 子集的 unit 的 tdd 实例。I13 有 `ucd_units`、unit 不拥有其中任何 UC-D 且 unit-manifest 声明了 `ucd_exemption` 的 unit，其 tdd history 与认领不计入。
- **「模块已有 RED / BASELINE / GREEN 证据」**：上述豁免单元目录下 `status: not_required` 且带 `ucd_exemption` 的记录不计入，`--adopt` 不要求删除它们；其余记录（含无法解析的条目）照旧计入。这些记录不绑定基线，接管后门禁复验照常通过。
- `BASELINE_ADOPTED` 审计新增 `Ignored Exemption Instances`（`--dry-run` 的 `checks.ignored_exemption_instances`），列出被忽略的豁免 tdd 实例与证据。

### Unchanged

- 没有豁免单元的模块行为、审计字段与 4.10.0 一致；I13 没有 `ucd_units` 或 I13 / unit-manifest 读不出时不做任何豁免（fail closed）。

## 4.10.0

新增模块级接管基线（MARS-92）：接管前已存在的实现可以登记为 characterization 存量行为，不再需要人为造空壳补 RED。

### Added

- **`orchestrate baseline --adopt <commit> [--repo <dir>=<sha>]… --module <id> --user-input Approve --approval-ref "<批准记录>" --reason "<原因>" [--dry-run]`**：写入模块子工作流的 `Adoption Baseline` / `Adoption Baseline Repos` / `Adoption Approval Ref` / `Adopted At`，全局 Baseline 链不变。豁免「committer date 不晚于 T0」与「不包含工作流状态文件」；保留 commit 存在、是 HEAD 祖先、非浅克隆、不晚于该模块第一个 tdd 开始时间；模块已有 RED / BASELINE / GREEN 证据时拒绝；嵌套仓库逐仓校验。审计事件 `BASELINE_ADOPTED`。
- **I13 / BASELINE 按模块解析基线**：登记了接管基线的模块用接管基线解析 characterization code ref 与 BASELINE blob，证据记录 `baseline_kind: "adoption"`（缺省即 `"workflow"`），门禁复验时要求与模块当前适用的基线一致。
- **`--advance --module <id>`**：在模块的接管基线链上推进（`Adoption Baseline History` / `Adoption Baseline Repos History`），规则与 4.7.0 一致；审计事件 `BASELINE_ADOPTION_ADVANCED`。
- **`orchestrate baseline --module <id>`** 显示模块适用的基线；`orchestrate baseline` 在存在接管模块时列出 `adoption_baselines`。

### Unchanged

- 没有登记接管基线的模块行为与 4.9.x 一致，证据结构不变（不写 `baseline_kind`）。不带 `--module` 的全局 `--advance` 跳过已接管模块。
- `--set` / `--replace` 仍拒绝 `--module`。

### Upgrade notes

- 无需迁移。接管基线仅支持 split 布局；接管后先对该模块的 `test-case-derivation` 执行 `evidence run --refresh`。

## 4.9.1

修复类版本：门禁按阶段生效，不再在下游产物所属阶段到达前提前硬拦（MARS-90）；收紧跨 module 契约 Owner 交付判定（MARS-91）。

### Fixed

- **traceability-matrix 澄清层阶段错位**（MARS-90）：`UNCOVERED_CL@downstream` 原先无阶段守卫，需求分析内完成澄清后即因 `user-stories.md` 尚不存在而阻断 `requirements-analysis`。现在从 `user-stories` 起才计入 `broken_rows`；此前缺口记入 `advisory_cl_pending`，`cl_gate` 为 `not_applicable(用户故事阶段未到达)`，`clarification_cl_total` / `uncovered_cl` 照常输出。`cl_gate` / `advisory_cl_pending` 只在存在 CL 时输出，`advisory_contracts_pending` 只在存在跨 module 契约消费时输出，其余项目的证据结构与 4.9.0 一致。
- **traceability-matrix 契约 Owner 未交付的阶段错位**（MARS-90）：消费方从自身 `application-design` 起才硬拦"Owner 的 application-design 未完成"，此前记入 `advisory_contracts_pending`。"契约未在 product-contracts.md 登记"仍从一开始硬拦。
- **cross-validation 依赖 UI 生成阶段**（MARS-90）：`requires` 增加 `ui-mock-generation`、`ui-figma-generation`，避免按 DAG 先跑交叉验证时因 UI 页面产物缺失被提前阻断；UI 阶段跳过时视为已满足，无 UI 流程不受影响。
- **契约 Owner 交付判定偏宽**（MARS-91）：多 module 下只认 `application-design@module:<owner>`；裸 `application-design` 仅在单 module（无 manifest，或 manifest 仅含 Owner）时兼容回退。契约 ID 中去掉连字符的 module 段按 manifest 还原为真实 `module_id`。

### Unchanged

- `story-traceability` 的澄清遵循语义保持"每个 CL 至少被一个故事引用"，不要求每个故事关联澄清；无 `clarifications.md` 或声明"无澄清项"时不校验。
- `UNCOVERED_FR@requirements` 仍从 `requirements-analysis` 起硬拦。

### Upgrade notes

- 无需迁移。已完成阶段的证据保持有效；之前被 `UNCOVERED_CL@downstream` 阻断的 `requirements-analysis` 重新 `report` 即可。

## 4.9.0

新增嵌套独立 git 仓库作为源码根：characterization、BASELINE、`source_revision` 与代码追溯按仓库解析；已有工作流声明嵌套仓库后，用一条受限迁移命令即可继续推进，不需要重新开始工作流，已完成实例不需要 `--refresh`。

### Added

- **声明方式**：`.aidlc/source-roots.json` 的 `source_roots` 条目除字符串外，还接受 `{ "path": "<dir>", "repo": "nested" }`（只允许这两个键，`repo` 只能是 `"nested"`）。嵌套仓库是项目级拓扑：split 布局里 module-manifest `paths` 优先决定源码根时，落在 `<dir>/` 下的路径仍按 source-roots 的声明归属该仓库（manifest 管模块归属，source-roots 管仓库拓扑）。module-manifest `paths` 出现对象条目时明确报错。不做自动识别。
- **fail-closed 校验**（`core/tools/aidlc-nested-repos.ts` `nestedSourceRepos`）：路径每一段都不能是符号链接 / junction，realpath 在项目根内；`<dir>/.git` 存在；`git -C <dir> rev-parse --show-toplevel` 的 realpath 等于 `<dir>`；嵌套仓库不能互相包含；工作流仓库 `git ls-files -- <dir>` 为空。
- **状态字段**：`baseline_commit` 处处仍是工作流仓库的 40/64 位 commit 或 `unavailable`。嵌套仓库放在独立字段：`- Baseline Repos: app=<sha>, web=<sha>`（`baseline_repos`，键按字典序；子工作流禁止携带；工作流 commit 为 `unavailable` 时禁止）；推进过的工作流另有 `- Baseline Repos History: app=@<起始代>:<sha>+<sha>…`（每个仓库从起始代到当前代每代一个 commit，无空洞，最后一代等于 `Baseline Repos`，只与 `Baseline History` 一起出现）。`Baseline History` 每项仍只是工作流 commit；嵌套仓库前进而工作流 commit 不变时，同一 commit 可在相邻两代出现，代以“工作流 commit + 各仓库 commit”区分。
- **证据字段**（只在声明了嵌套仓库且已登记时出现）：I13 增加 `baseline_repos`（各仓库起始代的 commit），`characterization[].code_refs[]` 增加 `repo`（`"."` 或嵌套路径）；BASELINE 增加 `baseline_repos`（证据所在代），`code_ref_digests[]` 增加 `repo`；`source_revision` 增加 `repos: { "<dir>": { commit, dirty, worktree_digest } }`（嵌套仓库自己的 `ls-files -co --exclude-standard`），split 布局的 `scope_digest` 覆盖 scope 内的嵌套仓库文件。
- **CLI**：`orchestrate baseline --set <commit> [--repo <dir>=<sha>]…`：未写 `--repo` 的嵌套仓库取它当前的 HEAD，此时任一嵌套仓库 dirty（含未跟踪文件）或没有提交即拒绝；显式 `--repo` 不查 dirty，但审计 `Repo Dirty` 记录。`--advance <commit> --repo <dir>=<sha>… --expect <commit> --expect-repo <dir>=<sha>…`：每个已登记仓库都必须显式写出（无默认值），目标是严格后代或等于当前代，至少一个仓库前进；GREEN 锚点要求同一份已完成 code-generation 的 GREEN 证据同时记录工作流 commit 和每个 `repos.<dir>.commit`。`next --scope` 创建工作流时自动记录各嵌套仓库 HEAD，dirty 或无提交时整个创建被拒绝，不写状态与审计。
- **受限迁移**：`orchestrate baseline --set <当前 commit> --replace --expect <当前 commit> [--expect-repo …] --repo <dir>=<sha>… --user-input Approve --reason "…"`。只补登尚未登记的嵌套仓库：工作流 commit 必须等于当前值；登记后的键集合必须等于声明集合（已有键不能修改或删除）；已推进的工作流也可以，新仓库从当前代开始记录；父工作流和全部子工作流的证据中不得已有引用落在新仓库路径下（无法解析的证据视为已引用）；各仓库 commit 通过逐仓检查（存在、是 commit、是该仓库 HEAD 的祖先、非浅克隆、committer date 不晚于 T0、证据锚点）。只写入 `Baseline Repos` / `Baseline Repos History`，`Baseline Commit`、`Baseline Source`、`Baseline History` 不变，审计 `BASELINE_REPOS_REGISTERED`。
- **待迁移状态**：声明了嵌套仓库、但基线没有登记它时，只拒绝产出 / 复验指向该仓库的 I13 characterization 或 BASELINE，以及 `--advance`，报错直接给出迁移命令；新的 GREEN / RED 照常产出并记录 `source_revision.repos`。不带参数的 `orchestrate baseline` 与 `runtime doctor` 显示待迁移仓库和命令。已登记但 source-roots 不再声明的键在门禁、`--set`、`--advance` 与迁移中报错；加载状态只校验格式。

### Changed

- **旧证据按自身结构复验**：证据没有 `source_revision.repos` 时按 4.8.1 算法复验（不含嵌套仓库文件）；BASELINE / I13 没有 `baseline_repos` / `repo` 时按 4.8.1 规则复验。适用于门禁、code-generation 完成时对 RED/BASELINE 的复验、`next` 上游复验、re-attest、`--advance` 锚点复验和 test-quality。声明嵌套仓库后已完成实例的证据字节不变。
- **按仓库解析**：嵌套仓库下的 code ref 以子仓库为 cwd、用子仓库内相对路径执行 `cat-file` / `ls-tree` / `show` / `hash-object`。I13 中工作流仓库的 code ref 取第 0 代，嵌套仓库的取该仓库的起始代；BASELINE 复验按“证据所在代 × 所在仓库”重新解析 blob，证据所在代早于仓库起始代却引用该仓库时拒绝。
- 字符串源码根照旧：`baselineCodeRef` 报 `does not exist in the workflow baseline` 时，若路径上某一级目录带 `.git`，报错末尾追加提示 `<dir>/ is an independent git repository; declare it in .aidlc/source-roots.json as { "path": "<dir>", "repo": "nested" }`，行为不变。
- **attest / worktree / structural-invariants**（共享判定 `nestedInvolvement`，`core/tools/aidlc-nested-repos.ts`；命中 `code_ref` / `changed_path` / `evidence_repos` 之一即为“涉及”，只声明了嵌套源码根只给 `nested_source_roots` 提示）：
  - `worktree prepare`：不涉及时照常创建工作流仓库的 worktree，元数据记录 `Nested Repos Skipped`；涉及时拒绝，不创建 worktree 与分支。在这种 worktree 中，code-generation 的 produces / consumes 对被跳过的嵌套源码根到主 checkout 中判定。
  - `worktree merge-plan`：按最新 I13 的 code ref 与 diff 路径判定，涉及时拒绝（含 prepare 后 I13 refresh 才变成涉及的情况）；不涉及时结构与 4.8.1 一致，另有 `nested_repos_skipped`。
  - `attest resolve`：显式路径、审查覆盖路径在嵌套仓库下，或证据带 `source_revision.repos` 时返回 `unverifiable` 并给出 `nested_repos_involved`，不会把看不到的仓库当作“已覆盖”或“未变更”；其他情况与 4.8.1 一致。
  - structural-invariants 的 `baseline_ref`：候选文件位于嵌套仓库下时明确报错。

### Upgrade notes

- 没有嵌套仓库声明的项目无需任何操作，状态、证据和 CLI 输出与 4.8.1 一致。
- 已有工作流切换到嵌套源码根：把 source-roots 条目改为 `{ "path": "app", "repo": "nested" }`，再执行一次受限迁移命令（`orchestrate baseline` 会打印）。基线已被使用或已推进也可以；需要更正已被使用的工作流 commit、或删除已登记的嵌套仓库时只能重新开始工作流。
- I13 补充指向嵌套仓库的 characterization：新 UC-D 用 `unit_refs` 只分配给还没开始 tdd 的单元（模块原来没用 `unit_refs` 时需一次给全部 UC-D 补上，已完成单元的 UC-D 指向原单元）。I13 原本产出失败时迁移后对活动中的 `test-case-derivation` 执行普通 `evidence run`；I13 已完成时执行 `evidence run --refresh`。已完成单元的 RED / BASELINE / GREEN 不需要任何操作。
- 推进顺序：先把工作流仓库和所有嵌套仓库的改动都提交，再产出 GREEN，然后 `--advance … --repo <dir>=<该 GREEN 记录的 commit>`。
- 跨仓库的完整 attest / worktree 支持不在 4.9.0 范围内，另行跟进。
## 4.8.1

修复类版本：模块 / 单元上下文中，`contract-baseline`、`nfr-coverage`、`infrastructure-completeness` 不再扫描全项目；同时修正 `noUnresolved()` 对否定描述的误判和 `nfrCoverage()` 的块截断。

### Fixed

- **模块 / 单元上下文中三个检查器扫描全项目**：`contextAllows()` 对 `docs/aidlc/modules/` 之外的路径一律放行，`contractBaseline()`、`nfrCoverage()`、`infrastructure()` 又直接用 `projectFiles()` 收集文件，项目根文档、ideation、逆向工程产物和其他工作线文档里真实存在的未决标记会让当前单元永远无法通过，`contract-baseline` 的 owner / consumers 也可能取到别的模块的契约。三者改为调用共享函数 `moduleScopedFiles(pattern)`：有 `ACTIVE_MODULE` 时只收集本模块 `inception/`、本单元 `construction/<unit>/`（无单元时本模块整个 `construction/`）、module-manifest 中本模块的 `paths`，以及新增的 `contract_paths`；没有 `ACTIVE_MODULE` 时仍是 `projectFiles()`，行为与 4.8.0 一致。范围内没有文件时照旧报 `no contract schema file found` / `NFR artifacts are missing` / `infrastructure design artifacts are missing`。`contract-baseline` 的 owner、consumers、版本信息和 `schema_hash` 只来自范围内的来源。`contextAllows()` 本身和其他检查器不变。
- **项目级共享契约表**：`product-contracts.md` 通过 `contract_paths` 纳入时，模块上下文中按本模块的角色取行（列识别与 `moduleForValue` 匹配规则从 `aidlc-orchestrate.ts` 抽到 `core/tools/aidlc-contract-table.ts`，orchestrate 的 shared contract projection 与依赖图改为复用）：本模块是**提供方**的契约，校验该契约在各表中的全部行（提供方要对所有消费方负责）；本模块**只是消费方**的契约，只校验消费者单元格包含本模块的行，提供方行仅作为引用行用于确定 owner 和计入 `schema_hash`，不检查未决标记，其他消费方的行不纳入。owner / consumers 从这些行提取（消费的契约只报告本模块自身为 consumer）；其他模块行中的未决标记不再使当前模块失败。表中没有本模块的行时不作为本模块的契约来源，也不报错。
- **`noUnresolved()` 误伤否定描述**：`阻断` 前为 `不`、`非`、`无` 时（“不阻断”“非阻断”“无阻断”）不再判定为未决；单独的 `阻断`、`存在阻断`、`阻断项`，以及 `TODO`、`FIXME`、`TBD`、`HACK`、`NotImplemented`、`待确认`、`待定`、`未解决`、`未定义` 的规则不变。对该函数的全部调用点生效；`validatePrdPendingQuestions` 的规则不变。
- **`nfrCoverage()` 切块**：块结束位置少加了编号长度（`start + next` → `start + id.length + next`），两个 NFR 相邻时第一个块会丢掉末尾的验收信息；编号起点改为完整编号的出现处，`NFR-1` 不再取到 `NFR-10` 的块（此前 `NFR-1` 没有验收规则时也会借用 `NFR-10` 的规则而通过）。验收关键词和 `acceptance_criterion` 的行查找都增加 `p99`（不区分大小写）。
- **契约表单元格的模块匹配（`moduleForValue`）**：原实现在精确匹配失败后用 `value.includes(module_id)` 做子串匹配，并取 manifest 中第一个命中的模块。模块 id 之间有前缀关系时（如 `m1` / `m10`、`order` / `order-ext`），`m10` 的单元格会被解析为 `m1`：在 4.8.1 的行过滤中，`m1` 会把 `m10` 的行当作自己的而误报失败，`m10` 则找不到自己的行，契约表被忽略、未决标记无人检查。现在先按 `module_id` / `service_id` / `name` 精确匹配；否则只接受以整词出现的 `module_id`（两侧是单元格边界或非 ASCII 字母数字的字符，如 `m10/unit`、`order-api`、`订单服务 m10`），多个命中时取最长的 `module_id`，再按 manifest 顺序。`m100`、`xm10y`、`orders` 不再匹配任何模块。`excluded`（依赖图中解析消费方时排除提供方）语义不变。这一规则同时用于 contract-baseline 的行过滤、集成屏障的 shared contract projection 和模块依赖图。

### Added

- module-manifest 模块描述新增可选字段 `contract_paths: string[]`：本模块作为提供方或消费方需要在 `contract-baseline` 中校验的契约文件或目录。规范化的项目相对路径，不得指向 `aidlc/`、`.aidlc/`、`docs/aidlc` 本身或 `docs/aidlc/modules/`；checker 读取时路径不存在、为符号链接 / junction（含目录内）或解析后越出项目根都直接报错，不静默跳过。`contract-baseline` 把声明的文件全部视为契约；`nfr-coverage` / `infrastructure-completeness` 对其仍按文件名规则过滤。

### Upgrade notes

- 模块上下文中不再扫描项目根。原先靠项目根文件（如 `docs/` 下的 `*-contract*.md`、`nfr-*.md`、`deployment-*.md`）通过的模块，需要把这些产物放进本模块 / 本单元目录或模块 `paths`；否则会报 `no contract schema file found` 等缺失错误。
- 需要校验项目级共享契约（如 `docs/aidlc/ideation/product-contracts.md`）时，在 module-manifest 中为模块声明 `contract_paths`；未声明时项目级契约文件不再参与本模块的 `contract-baseline`。
- 模块上下文中按新范围重新计算的 `contract-baseline` `schema_hash` 可能与已有证据不同；需要让已有证据与新范围一致时，对相应实例执行 `evidence run --refresh` 后 re-attest。
- 没有模块上下文的单一工作流不受范围收敛影响；`noUnresolved()` 和 `nfrCoverage()` 的修正对所有工作流生效。

## 4.8.0

unit 轴的 tdd / code-generation 按单元收敛 UC-D 覆盖：split 布局下一个模块拆成多个 unit 时，UC-D 用 frontmatter `unit_refs` 声明所属单元，各单元的 RED / BASELINE / GREEN 只覆盖自己的 UC-D，模块完整性在 build-and-test 和集成屏障对账。此前第一个 unit 的 GREEN 必须让整个模块的 UC-D 全部通过，后续 unit 的 tdd 失去意义，不含业务代码的契约类 unit 无法完成。

### Added

- **UC-D frontmatter `unit_refs: [<unit-id>, ...]`**（可选）：与 `tdd_mode` 相同，只能写在 frontmatter，写在正文里拒绝。一个 UC-D 可以属于多个 unit，列出的每个 unit 的 GREEN 都必须覆盖它。I13 fail-closed 校验：列表非空、元素不重复；每个 unit-id 必须是该模块 `unit-manifest.json` 中已有的 unit；同一模块内只要有一个 UC-D 声明，就要求全部 UC-D 都声明，否则拒绝并列出缺失的 UC-D。
- **I13 证据字段 `ucd_units: { "<UC-D>": ["<unit-id>", ...] }`**：只在有声明时输出。I13 门禁校验每个 UC-D 恰好一项、非空、不重复、unit 在清单中。
- **共享函数 `unitUcdIds(i13, unitId) → { new, characterization, all, scoped }`**（`aidlc-execution-context.ts`）：有 `ucd_units` 且有 unit 上下文时返回 `unit_refs` 包含该 unit 的子集，否则返回模块全集。evidence producer、orchestrate 门禁和 semantic checker 都调用它；`i13UcdIdsByMode` 一并移入该文件（`aidlc-evidence.ts` 仍按原名导出）。
- **空子集豁免 `ucd_exemption`**：不被任何 `unit_refs` 指向的 unit（如契约类 unit）在 `unit-manifest.json` 对应 unit 下声明 `{ reason_code, reason, approval_ref, alternative_validation, validation_command }`（`reason_code` 取值同 I13 `non-applicable.json`，`validation_command` 为 argv 数组，不经 shell）。受控 producer 先执行该命令，退出 0 才把 RED、BASELINE、GREEN 写为 `not_required`（`ucd_ids: []`，并记录 `ucd_exemption` 与 `exemption_validation_execution`）；没有豁免或命令非零退出时拒绝、不写证据。门禁复核豁免字段与清单一致、执行摘要等于 `validation_command` 的 argv 摘要、退出码为 0。GREEN 的 `allowedStatuses` 在有 `ucd_units` 时增加 `not_required`，且只允许出现在子集为空的情况。
- **模块收口对账**：project 轴 build-and-test 的 `test-quality`（无 unit 上下文）对每个有 `ucd_units` 的模块检查：每个 UC-D 都出现在其 `unit_refs` 中每个 unit 的 passed GREEN `uc_mapping` 里（从而所有 unit 的 GREEN 并集覆盖模块全部 UC-D）；缺一项即失败，报错点名 UC-D 与 unit，通过时证据输出 `ucd_coverage`。split 布局的集成屏障（`registryProjection` 的 `blocking`）对已完成 construction 的模块做同样的检查，失败时阻断原因为 `ucd-coverage:<module>`，提示中列出缺口。

### Changed

- 以下位置在 unit 上下文中改用本单元子集（I13 没有 `ucd_units` 时全部保持 4.7.1 行为）：
  - RED / BASELINE / GREEN 门禁的 `uc_mapping` 覆盖检查（报错文本带 `of unit <id>`），以及 RED / BASELINE `not_required` 的判定；
  - producer：RED / BASELINE 是否 `not_required`，观察型证据额外写入本单元子集 `ucd_ids`；
  - BASELINE `code_ref_digests`：producer 只比对、只记录子集中 characterization UC-D 的 code ref，门禁复验的“`code_ref_digests` 必须等于 code ref 集合”同样换成子集；4.7.0 的按代校验规则不变；
  - `test-quality` 门禁与 checker（RED / BASELINE 要求、用例清单、UC-D 映射）；子集为空的 unit 返回 `not_applicable`，门禁只对这种 unit 或 I13 `not_applicable` 接受 `not_applicable`；
  - `traceability-matrix` 的 tests 层：只检查本单元 UC-D 用例文件引用的 REQ，UC-D 派生诊断只看子集，证据输出 `unit_scope`；code_refs 层不变；
  - `functional-design-completeness`：有 unit 上下文且 I13 有 `ucd_units` 时，只要求单元 FD 出现子集中的 UC-D 编号。

### Upgrade notes

- 不声明 `unit_refs` 的工作流行为与 4.7.1 完全相同：每个 unit 仍覆盖模块全集，单单元和非 split 工作流不受影响，`--advance` / `--replace` 不变。
- 已有工作流要启用：给模块内**全部** UC-D 补上 `unit_refs`，给不拥有 UC-D 的 unit 补 `ucd_exemption`，然后 `evidence run --stage test-case-derivation --module <id> --refresh` 刷新 I13 并 re-attest。影响：已完成的 tdd / code-generation 实例是按模块全集产出的证据，刷新 I13 后在 `next` 复验或 re-attest 时会按子集判定——RED / BASELINE / GREEN 的 `uc_mapping` 多出其他单元的 UC-D 会报 `unexpected`，BASELINE 的 `code_ref_digests` 多出其他单元的 code ref 也会被拒；对这些已完成实例执行 `evidence run --stage <tdd|code-generation> --module <id> --unit <id> --refresh`（命令按子集输出观察）后 re-attest。RED 无法在已实现的代码上重新观察失败，因此建议在第一个 unit 进入 tdd 之前启用；中途启用时，已完成单元的 RED 需按团队流程处理（例如在该单元实现之前的提交上重新产出）。

## 4.7.1

split 布局下 `orchestrate baseline --advance` 可用了：产品级阶段全部完成后全局工作流会被置为 `done`，4.7.0 在这种情况下拒绝推进，而这正是 `--advance` 要解决的场景（split 布局 + 多单元 characterization）。

### Fixed

- **split 布局下全局工作流为 `done` 时 `--advance` 被拒绝**：4.7.0 的第 1 条前置检查要求 `aidlc/active/aidlc-state.md` 的全局工作流处于 `running` / `parked`，`--advance` 又只能在全局工作流上执行。split 时，如果当前阶段已经属于某个模块，全局工作流自有的实例全部 resolved，会被合法地置为 `done`（`summarizeOwned`），实际在跑的是模块子工作流。消费方因此报 `Workflow … is done; baseline --advance requires a running or parked workflow.`，无法推进。现在全局工作流为 `done` 时，同时满足以下两条就允许推进：它是 split 布局的全局工作流（`registry.md` 存在，Global Workflow ID 与之一致）；至少有一个模块或集成子工作流处于 `running` / `parked`。
  - 推进写入的仍然是全局工作流（`Baseline History`、`Baseline Source: advanced`、`history` 的 baseline/advanced 记录、`BASELINE_COMMIT_ADVANCED` 审计），全局工作流的 `Status` 保持 `done`；子工作流仍通过 `workflowBaseline()` 继承这条链。`saveWorkflowState` 的 `{ baselineWrite: true }` 写路径本来就不检查 `Status`，`done` 的全局工作流可以正常写入。
  - 第 2–5 条检查语义不变：目标的祖先关系、GREEN 锚点、BASELINE 与 GREEN 之间没有停着的单元、code ref 可解析。
  - 以下情况仍然拒绝：非 split 的单一工作流为 `done`（错误文本与 4.7.0 相同）；split 布局下所有模块和集成子工作流都为 `done`（报 `no module or integration sub-workflow is running or parked`）；registry 无法加载或 Global Workflow ID 不一致。
- **`--set` / `--replace` 同样修复**：它们对 `done` 工作流的拒绝属于同一缺陷，并非有意设计。split 布局下的 characterization UC-D 继承全局工作流的基线，全局工作流一旦 `done`，存量 split 工作流就无法登记基线（README 要求先 `--set` 再派生 characterization UC-D），也无法更正尚未使用的基线。现在采用与 `--advance` 相同的判定条件。非 split 的单一工作流为 `done` 时仍然拒绝，错误文本不变（`its baseline can no longer be registered or replaced.`）；U1–U4 使用检查和"推进过的链不能替换"的规则也不变。

### Tests

- `tests/test_v4_7_0_baseline_advance.ts` 新增一个 e2e 变体：split 时当前阶段已属于模块，断言 split 后全局工作流为 `done`、模块为 `running`。在这个前提下，`--set --replace --dry-run` 可以更正尚未使用的基线；u1 改动共享 code ref、提交并 GREEN 之后 `--advance` 成功，全局工作流仍为 `done`；u2 tdd 的 BASELINE 产出受控证据（绑定第 1 代）；u1 原有 BASELINE 证据逐字节不变，并继续通过门禁。全部子工作流 `done` 后，`--advance` 被拒绝。4.7.0 原有 e2e 中，全局工作流在 split 后仍是 `running`，因此没有覆盖到这个问题。去掉修复后，新变体会失败。
- 新增负向用例：非 split 的单一工作流为 `done` 时，`--advance` 和 `--set --replace` 仍然被拒绝，且不写入状态。

## 4.7.0

多单元 characterization 基线分代：工作流基线从单个值变为只能追加的 commit 链，`orchestrate baseline --advance` 把上一个单元的完成点追加为新一代，每份 BASELINE 证据按它产出时的那一代校验。

### Added

- **`orchestrate baseline --advance <commit> --expect <当前基线> --user-input Approve --reason "<理由>" [--dry-run]`**：把基线推进到一个已完成单元的完成点。参数规则沿用 `--set` / `--replace`：`<commit>` 与 `--expect` 必须是完整的 40/64 位小写十六进制，`--user-input` 只能是 `Approve`，`--reason` 必填；`--expect` 必填（与 `--replace` 相同的乐观校验，写入前重新读取状态并比较 revision 与当前基线）。`--advance` 与 `--set`、`--replace` 互斥，未知参数、多余位置参数和 `--module` 报错。推进前检查（任一不满足即拒绝，并给出具体原因）：
  1. 存在 running / parked 的全局或单一工作流；是 git 仓库；基线已登记且不是 `unavailable`（`unavailable` 仍走 `--replace --expect unavailable`），当前基线仍可从 HEAD 到达。
  2. 目标是存在的 commit 对象，是 HEAD 或 HEAD 的祖先，并且是当前代的严格后代（不能等于当前代）；浅克隆无法判断时拒绝。
  3. 锚点：目标等于父工作流或任一子工作流中某个已完成 `code-generation` 实例的受控 GREEN 证据的 `source_revision.commit`，且该证据仍通过 GREEN 门禁（只容忍工作区漂移）。
  4. 没有单元停在 BASELINE 与 GREEN 之间：扫描父工作流和全部子工作流，不能有活动中（Active Instances 或 Current Instance）的 `code-generation`，也不能有已产出 BASELINE 证据（非 `not_required`）而同一单元 `code-generation` 尚未完成的 `tdd`。
  5. 目标 commit 中所有 I13 characterization code ref 都能解析为普通文件（不是符号链接）。
- **基线链字段**：全局/单一工作流状态新增可选的 `- Baseline History: <c0>, <c1>, …`（`baseline_history?: string[]`）。加载与保存时 fail-closed 校验：链存在时至少 2 项、每项为 40/64 位小写十六进制且不重复、最后一项等于 `Baseline Commit`，并且 `Baseline Source` 必须是 `advanced`；`Baseline Source` 为 `advanced` 时链必须存在；模块与集成子工作流不得携带该字段，通过 `workflowBaseline()` 继承父工作流的整条链（新增 `epochs` 字段）。普通保存必须原样保留链，只有 `{ baselineWrite: true }` 的 baseline 写路径可以追加。各代之间的 git 祖先关系在使用时校验。
- **`baseline_source=advanced`**：`BaselineSource` 增加取值 `advanced`。
- **审计 `BASELINE_COMMIT_ADVANCED`**：记录 Workflow ID、From、From Source、To、Epoch、Chain、Anchor（GREEN 证据路径、commit 与实例）、Expected、HEAD、Reason、User Input；审计写入失败时返回 error 并提示"状态已写入、审计缺失，请人工补记"。`history` 追加 `{ stage: "baseline", result: "advanced", user_input: "Approve" }`。
- 不带参数的 `orchestrate baseline` 增加 `baseline_epoch` 与 `baseline_history` 字段；推进过的工作流在 message 中显示当前代与完整链，未推进的工作流 message 与 4.6.1 相同。

### Changed

- **BASELINE 前置校验按当前代**：producer 比对的期望 blob 改为从**当前代** commit 中解析（`baselineCodeRef(projectRoot, 当前代, ref)`），不再使用 I13 存的 `baseline_blob`；证据记录 `baseline_commit = 当前代`、`code_ref_digests[].baseline_blob = 当前代 blob`，`worktree_blob` 必须与之相等。producer 同时要求 I13 的 `baseline_commit` 等于链的第 0 代。从未推进时当前代即第 0 代，行为不变。
- **BASELINE 复验按证据所在的代**（tdd 门禁、`code-generation` 完成与 re-attest、`next` 对上游的复验）：`evidence.baseline_commit` 必须是本工作流基线链中的一项，且仍可从 HEAD 到达；`code_ref_digests` 的路径集合仍须等于 I13 的 code ref 集合；`baseline_blob` 必须等于证据所在那一代 commit 中解析出的 blob，`worktree_blob === baseline_blob`（产出时的记录，复验不读当前工作区）；第 0 代的证据还须与 I13 的 `baseline_blob` 一致。`i13.baseline_commit` 必须是链的第一项。
- **`code-generation` 完成时的 BASELINE 复验要求当前代**：同一单元的 tdd BASELINE 证据必须属于当前代，即一个单元的 BASELINE 与 GREEN 必须在同一代内完成。re-attest 已完成的 `code-generation` 不要求当前代。
- I13（`characterizationEvidence`）与 I13 门禁按第 0 代解析 code ref；推进后不需要也不会因推进而 refresh I13。
- GREEN 门禁接受调用方的漂移容忍选项（仅供 `--advance` 的锚点检查使用；`code-generation` 完成与 `next` 复验的调用方式不变）。
- `orchestrate baseline --set --replace` 对推进过的工作流（`Baseline Source: advanced` 或存在链）一律拒绝：推进过的基线链只能追加，不能替换。

### Fixed

- **多单元 characterization 场景中后续单元的 tdd BASELINE 永远无法满足**：split 布局下一个模块的多个单元共享 characterization code ref 时，先完成的单元在 `code-generation` 中合法修改这些文件（例如为 traceability 添加 `@ReqId` 注释）后，后续单元的 BASELINE 前置校验固定报 `BASELINE refuses to run: code ref … changed since the workflow baseline`；基线又因已在使用中（U1–U4）无法 `--replace`，回滚改动会让上一个单元的 traceability 失败。现在用 `--advance` 推进到上一个单元的完成点即可继续。

### Upgrade notes

- 存量工作流不需要迁移：没有 `Baseline History` 字段的状态等价于只有一代，读取和保存后仍然没有该字段；单单元工作流与从不推进的工作流行为不变。
- 被这个问题卡住的多单元工作流：在上一个单元的 `code-generation` 完成并提交之后（GREEN 证据的 `source_revision.commit` 必须是该提交；GREEN 若在提交前产出，提交后对该实例执行 `evidence run --refresh` 并 re-attest），执行 `orchestrate baseline --advance <该单元 GREEN 的 commit> --expect <当前基线> --user-input Approve --reason "…"`，然后对**活动中的**实例执行普通 `evidence run`，继续当前单元的 tdd。**已完成实例不需要 `--refresh`**，它们的原始 BASELINE 证据保持有效。
- `--advance` 与 `--replace` 的区别：`--replace` 更正一个**尚未使用**的基线（U1–U4 任一命中即拒绝），旧值被覆盖；`--advance` 在基线**已在使用中**时追加新的一代，旧的代保留在链中，按旧代产出的证据继续有效。推进过的工作流不能再 `--replace`。

## 4.6.1

修复目录型产物在 produces 与 consumes 两侧判定标准不一致（D8）：源码根中只要有一个 0 字节的 `__init__.py`，消费源码根的阶段就固定失败。

### Fixed

- **D8 `checkConsumes` 对目录型源码根逐文件要求 ≥16 字节**：同一个目录型产物，`checkProduces` 只要求目录中至少有一个 ≥16 字节的文件，`checkConsumes` 却要求目录中每个文件都 ≥16 字节。因此 Python 项目源码根里合法的 0 字节包标记 `__init__.py` 会让 `code-review`、`build-and-test` 固定报 `app/: missing or smaller than 16 bytes`，对已完成的 `code-review` 做 re-attest 也失败。
  - 新规则：两侧统一调用共享函数 `artifactPresenceFailure`（`core/tools/aidlc-orchestrate.ts`）。**目录型**（pattern 以 `/` 结尾，或目标本身是目录；源码根展开为 `<root>/`）要求目录存在且至少有一个 ≥16 字节的文件，目录中的空文件、小文件不算失败。**单文件型**规则不变：文件存在且 ≥16 字节，project 级 aggregate 展开成多个文件时每个都须 ≥16 字节。报错文案与 label 不变。
  - 保持 fail-closed：源码根不存在、为空目录、其中文件全部小于 16 字节、是符号链接或 junction（含解析到项目外）时仍然失败；多个源码根逐个判定，任一不满足即失败；单文件 <16 字节仍然失败。目录型 pattern 经 aggregate 展开到多个 module/unit 时直接拒绝，避免一个模块的文件替另一个模块凑数（当前阶段图中没有这种组合）。
  - 受影响的 consumes：`src/`（`code-review`，unit 级；`build-and-test`，project 级）与 `docs/aidlc/modules/{module-id}/inception/application-design/test-cases/`（`tdd`、`code-generation`，unit 级），现在与 produces 侧采用同一目录型规则。`checkProduces` 的判定结果不变。
  - 内建 `traceability` sensor 不再把目录型 produce（如源码根）中小于 16 字节（`MIN_ARTIFACT_BYTES`）的文件当作缺少需求 ID 的产物；≥16 字节且没有 REQ 标记的源码文件仍然失败，单文件 produce 的检查不变。

### Upgrade notes

- 已完成的 `code-review`、`build-and-test` 实例不需要任何额外操作。
- 源码根里有空文件或很小文件（如 0 字节 `__init__.py`）的项目，升级后可以直接继续 `next` / `report` / re-attest。
- 源码根中小于 16 字节的源码文件不再参与 traceability 追溯。

## 4.6.0

TDD characterization 模式与工作流基线登记：UC-D 按 `tdd_mode` 区分，新行为走 RED→GREEN，存量行为走 BASELINE→GREEN，存量工作流通过 `orchestrate baseline` 显式登记基线。

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

- **reverse-engineering 可能被重新触发（S1.0）**：`has_legacy_code` 改为统计全部源码根，源码不在 `src/` 的项目升级后可能首次被判为存量代码，从而在新工作流中选中 reverse-engineering。
- **降级兼容（S1.1）**：4.5.4 及更早引擎读取 4.6 状态文件不会报错，但第一次写状态时会静默丢掉 `Baseline Commit` / `Baseline Source`；之后回到 4.6 时基线显示为未登记，可用 `orchestrate baseline --set <原 commit> --user-input Approve --reason "<理由>"` 补登。建议团队成员统一升级后再继续同一工作流。
- **存量工作流使用 characterization 前需先登记基线（S1.2 / S2.2）**：4.6 之前创建的工作流没有基线，I13 会拒绝 characterization UC-D；先执行 `loeyae-aidlc orchestrate baseline --set <commit> --user-input Approve --reason "<理由>"` 登记。基线为 `unavailable` 时改用 `--set <commit> --replace --expect unavailable`。split 布局的模块子工作流继承父工作流基线，无需单独登记。
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
