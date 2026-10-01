# Changelog

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
