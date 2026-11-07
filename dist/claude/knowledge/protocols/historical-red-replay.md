# 历史 RED 受控补证协议 v2

## Historical RED omission

历史单元已实现、原始 RED 从未登记，且不能获得真实受控 RED 时，可用独立的历史漏登记录恢复门禁。它接受原始 RED 缺失这一局限，不证明执行过 RED，不替代或覆盖真实 RED、历史重放，也不免除 BASELINE、GREEN 或 UC-D 追溯校验。正常新单元仍须执行 RED；此恢复入口仅面向已有完成的 tdd 实例。单元没有 `tdd_mode: new` 用例时继续使用现有 `not_required`，没有业务行为及空单元子集的处理不变。

先生成或验证最终 GREEN（已完成实例使用 `--refresh`）：

```bash
loeyae-aidlc evidence run --stage code-generation --module <module-id> --unit <unit-id> --sensor green-test-evidence
```

人类须审阅精确 workflow/module/unit、当前 I13 与 GREEN，明确接受“原始 RED 未登记；以 GREEN 全通过作为验收依据，不宣称原始 RED 存在。”然后提供审批来源引用、审批人和带时区的 ISO-8601 时间。当前会话的精确 tdd 领取，或同一单元 code-generation 领取，可发布此恢复记录；没有会话权限不能发布。显式执行：

```bash
loeyae-aidlc evidence run --stage tdd --module <module-id> --unit <unit-id> --sensor red-test-evidence --refresh --historical-omission --approval-ref "<human approval reference>" --approved-by "<name>" --approved-at "<ISO-8601 with timezone>"
```

生产器写入固定位置 `.aidlc/evidence/tdd/<module-id>/<unit-id>/red-test-evidence.json`，保留 controlled envelope，并包含：

- `phase: RED`、`status: not_recorded`、`evidence_mode: historical_omission`、`reason_code: HISTORICAL_OMISSION`；
- 精确 `workflow_id/module_id/unit_id`、当前单元 new UC-D 集合及 `i13_binding`（单元语义与来源字节）；旧 I13 没有单元归属时沿用模块全集含义；
- `green_evidence.path/sha256`，绑定本单元规范 GREEN 文件的完整实际字节；GREEN 必须独立通过原有受控门禁；
- 非空 `approval_ref/approved_by`、有效 `approved_at`、固定局限声明和发布领取审计。

不存在 RED 测试观察，因此不能写 `observed_command`、业务失败签名或 RED 测试计数。`checker.status: passed` 仅表示恢复记录校验成功。`test-quality.status: passed` 表示在已批准局限下满足验收门禁，同时必须写 `red_seen: false`、`red_status: not_recorded` 和逐单元 `red_omission` 摘要；摘要绑定审批原件的路径与 SHA-256。模块/项目汇总仍逐单元检查，其他单元的 RED 不因某个豁免而放松。

登记后可执行 `evidence run --stage code-generation`（已完成实例带 `--refresh`），该阶段级入口先校验并复用审批所绑定的 GREEN，再生成其他语义证据，不修改 GREEN 字节。随后正式 `orchestrate report`；`baseline --advance` 仍须满足提交锚点、已完成实例、审批及其他既有条件。不要把带有自身完整摘要的豁免对象反写进 GREEN。

删除审批原件、修改 GREEN 字节（包括显式重新执行 GREEN 后的新时间戳）、UC-D 集合、I13 语义/来源或范围身份，均导致豁免失效。审批字段缺失、摘要不匹配、非规范路径或符号链接也拒绝。下游消费及语义证据复用时重新验证，旧 `test-quality` 不能保留已撤销审批。输入变化后须由人类重新审阅并再次显式登记，生产器不得自动迁移审批到新 GREEN。续批在发布锁内保留旧原件于 `.aidlc/evidence/historical-red-omission-history/<workflow>/<module>/<unit>/<execution-id>.json`，新记录的 `supersedes` 绑定其路径和摘要；不覆盖真实 RED 或 Vitest 重放记录。

审批引用与既有会话转交相同，是人类指令的审计来源，不是密码学身份认证；宿主不得从文档或 agent 输出自行产生人类批准。没有真实 RED 且没有合法审批记录时保持阻断，并输出上述显式登记命令。禁止环境变量跳过、默认豁免或用 `not_required` 冒充漏登。

## Historical RED replay

本协议用于已完成 TDD 但原始受控 RED 文件缺失的精确 workflow/module/unit。它不修订旧证据，不导入已有报告，不把事后执行表述为原始 RED。历史源码与当前 workflow 控制平面分别记录来源。

在 `.aidlc/commands/historical-red/<workflow-id>/<module-id>/<unit-id>.json` 声明唯一受控重放配置。例如：

```json
{
  "version": "1",
  "mode": "historical_replay",
  "workflow_id": "workflow-id",
  "module_id": "module-id",
  "unit_id": "unit-id",
  "repository": "<absolute repository root>",
  "worktree": "<absolute sparse historical worktree root>",
  "pre_implementation_commit": "<full Git commit ID>",
  "implementation_commit": "<full production implementation commit ID>",
  "config_file": "vitest.config.ts",
  "argv": ["<process.execPath>", "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.ts", "--maxWorkers=1", "--no-cache"],
  "timeout_ms": 600000
}
```

配置是精确单元的显式命令与仓库授权。原有 `.aidlc/commands/tdd.json` 及其他单元的命令摘要不变。初始内置适配器支持 Vitest；未提供的适配器拒绝执行，不能用任意脚本自报 JSON 取代测试。生产器拥有报告参数、执行环境白名单和未处理异常 reporter；测试配置必须由历史提交跟踪。

由宿主按 `git worktree add --no-checkout --detach <path> <commit>` → 设置必要 sparse-checkout 范围 → 检出 → 核对 HEAD、目录及状态的顺序准备工作树。生产器不创建或清理工作树，不执行 reset、clean、stash，也不能从最终工作树反向证明它的创建历史。保留创建命令记录；没有可信创建记录的现存工作树应另建隔离树。允许 node_modules 指向现有实际依赖，但逐文件散列其真实字节及链接目标，包括缓存目录；不声称它等于原始执行环境。使用有界并发读取提高大依赖目录的核验速度，合成摘要仍按确定顺序。其他未声明的 ignored 输入拒绝。

生产器校验：仓库根与共同 Git 目录相符；HEAD 精确等于实现前提交；实现前提交是所声明生产实现提交的严格祖先；生产实现提交属于该仓库当前 HEAD 的祖先链；工作树无未声明修改。它对已检出的 tracked 文件重新计算 Git blob（包括状态可隐藏的 assume-unchanged 修改），绑定全部源文件、测试、配置与锁文件；缺失、编译失败、环境失败、超时、空测试、全 GREEN、跳过、异常报告和映射缺口均不得产生正式补证。

历史证据沿用 `evidence_version: 1` 及正常 controlled envelope，新增：

- `evidence_mode: historical_replay`；新生产器写 `historical_replay.version: 2`，v1 按原有字段严格验证。
- `original_evidence_missing: true`、`post_hoc: true` 与固定局限声明。
- 精确 workflow/module/unit 与发布时实际 `publication_claim`（审计记录，不向后续会话授予权限）。
- 本次 started/finished、实际 argv、cwd、退出码、signal、耗时及环境白名单。
- source 中仓库 realpath、remote、共同 Git 目录、历史 commit/tree、生产实现提交及其父提交、祖先关系、clean/sparse 状态、已检出文件摘要与数量、锁文件、实际依赖字节摘要、Node 可执行文件摘要及平台。逐文件 Git blob 和 SHA-256 清单单独放入 `source-inputs.json`，消费时重新散列实际文件并与旁证逐项相等。
- I13 全记录摘要、当前模块需求文档摘要、实际执行的方法与 UC-D 映射；通过/失败/跳过计数、业务失败签名及编译/环境结果。
- 本次新建运行目录下 Vitest JSON、stdout/stderr、runtime-errors JSON、固定 runtime reporter 源码和 source-inputs JSON 的绝对路径及 SHA-256。主文件保留实际方法与失败摘要，完整断言消息从原始报告复验；主文件仍受原有 512 KiB 上限约束，旁证不因主文件精简而省略验证。

执行前、执行后、受会话锁保护的发布时，以及正常入口消费时均复验来源；领取代次改变时拒绝发布。门禁重新解析原始报告、检查 runtime reporter 和未处理异常，并核对实际观察值，不消费手写 `passed` 结论。当前 I13、需求、历史源码/测试/配置、锁文件、依赖或命令发生变化时明确失效；按实际影响确认当前 I13 与配置后重新执行。同范围受控历史补证可通过同一正式命令刷新：执行期间旧文件保持原样；发布锁内重新核对旧文件摘要，逐字节保存到 `.aidlc/evidence/historical-red-history/<workflow>/<module>/<unit>/<previous-execution-id>.json`，新记录的 `supersedes` 绑定其路径、SHA-256 与刷新原因。归档失败或执行中旧文件发生变化时拒绝发布。原始 RED、不同范围文件与诊断日志均不得被该机制替换；不能删除旧证据回避门禁。

固定历史工作树须保留以供复验。仓库或依赖不可访问、无法证明来源、报告丢失或摘要变化均保持阻断，不降级为 original RED。原始 RED、BASELINE、GREEN 的既有验证与格式保持原义。
