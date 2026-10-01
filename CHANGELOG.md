# Changelog

## Unreleased

### Fixed

- 修复 I13 `test-case-derivation` 检查器因路径重复拼接而读不到测试用例的问题：`testCaseDerivation` 向 `allFiles` 传入了已拼接 ROOT 的绝对路径，导致目录被拼成 `/r/r/x`（Windows 为 `E:\r\E:\r\x`），用例目录明明存在 `UC-D-xxx` 却报 "I13 test case directory contains no UC-D identifiers"。现改为传相对路径。
- `allFiles` 对绝对路径幂等：扫描根解析抽到 `core/tools/aidlc-scan-root.ts`（`resolveScanRoot` / `scanFiles`），base 已是绝对路径时不再拼接 ROOT，防止同类问题复发。
- 新增回归测试 `tests/test_i13_case_root.ts`（模块化布局的 ready / blocked 用例，以及相对/绝对路径与 POSIX/Windows 路径语义的单元测试），并加入 `npm test`。
- 修复 I13 `test-case-derivation` 中文关键词（`验收`、`接口`、`业务行为`、`业务规则`、`状态转换`、`可执行`）几乎无法匹配的问题：原正则把整个关键词分组放在 `\b` 之后，而 `\b` 只认 ASCII 单词边界，关键词前面是中文、中文标点、空格或行首时匹配失败，只用中文描述行为的需求被误判为无可执行行为并被要求提供 `non-applicable.json`。现在 `\b` 只作用于英文分支，英文匹配结果与原正则完全一致（`APIs`、`endpoints`、`Scenarios` 仍命中，`myAPI` 仍不命中）。关键词正则抽到 `core/tools/aidlc-executable-behavior.ts`（`EXECUTABLE_BEHAVIOR` / `hasExecutableBehavior`）。新增回归测试 `tests/test_i13_executable_behavior.ts` 并加入 `npm test`。

### Changed

- **I13 豁免优先**：模块的 `test-cases/non-applicable.json` 只要存在，就先按现有规则完整校验（`schema_version=1`、`status=not_applicable`、`reason_code` 合法、`reason` / `approval_ref` / `alternative_validation` / `validation_command` 非空、`source_refs` 为字符串数组）；校验通过直接判 `not_applicable`，不再看关键词；校验失败直接报错，不回退到 UC-D 分支。豁免不存在时才按关键词判断。"至少存在一个源文件"的前置检查顺序不变。
- **放宽：修复前已命中关键词的项目**（英文 `Given` / `API` 等，或碰巧命中的中文如 `REQ-1验收`），只要模块里有合法的 `non-applicable.json`，现在判为 `not_applicable`（以前豁免被忽略、进入 UC-D 校验）。I13 全部 not_applicable 后的下游联动：`test-quality` 返回 not_applicable；RED/GREEN 证据允许为 `not_applicable`，但仍须提供 `not_applicable_reason`、`alternative_validation` 和受控的 `alternative_validation_execution`；`code-generation`、`code-review`、`build-and-test` 跳过 `traceability` sensor，`traceability-matrix` sensor 仍照常执行。豁免需要 `approval_ref`，属于人工批准的例外。**请检查存量项目 `test-cases/` 下是否遗留过期的 `non-applicable.json`。**
- **收紧：含关键词 + 不合法豁免**：以前会被悄悄忽略，现在报错。不合法包括字段缺失或为空、`schema_version` / `status` / `reason_code` 不符合要求、JSON 无法解析（`<path> is not valid JSON: ...`）、能解析但不是对象（如 `null`、数组，`<path> must contain a JSON object`）。请补全修正或删除这类文件。
- 中文否定表述（如"本模块不包含可执行业务行为"）在无豁免、无用例时，报错从缺少 `non-applicable.json` 变为 "I13 requires test case index"，仍会阻断。

### Upgrade notes

- **已生成的 I13 证据不会自动按新规则重算**：`report` 只为缺失的证据文件自动生成证据；证据超过 24 小时也不会触发重新生成（`next` 复验上游时跳过 stale 类失败）。只有手动重新生成、删除证据后重新 `report`，或 provenance 失配时才会按新规则判定；provenance 失配时 `next` 会阻断并提示 refresh，不会自动重算。失配条件取决于布局：
  - 旧的 worktree 布局（`source_revision.scope` 缺失或为 `worktree`）：证据绑定 `commit`、`dirty` 和整个工作区 `worktree_digest`，任何新 commit 或已跟踪文件 / 未被忽略的未跟踪文件改动都会让证据失效；
  - split 布局（`source_revision.scope` 为 `module:<id>` 或 `global`）：证据只绑定该 scope 的 `scope_digest`，其他模块目录、integration 目录和其他模块 `paths` 下的改动不会让它失效。
- 按新规则重新判定 I13：
  - 已完成的 I13 实例：`loeyae-aidlc evidence run --stage test-case-derivation --module <id> --refresh`，然后 `loeyae-aidlc orchestrate report --stage test-case-derivation --module <id> --result completed` 复验；
  - 当前活动的 I13 实例：`loeyae-aidlc evidence run --stage test-case-derivation --module <id>`（不带 `--refresh`，对活动实例使用 `--refresh` 会报 "the active instance uses a normal evidence run"）。
