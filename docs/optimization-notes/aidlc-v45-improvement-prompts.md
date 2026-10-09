# AI-DLC v4.5 改进提示词

> 来源：2026-09-30 在 Windows + Kiro IDE 中执行 AI-DLC 初始化时发现的 7 个问题（P1～P7）。
> 已对照源码复核根因：这些问题都不是 Windows 特有的，`Move-Item` 只是用户手工绕过时使用的命令。
> 每条提示词可独立交给新会话执行，按下列顺序实施收益最大；提示词 5 依赖提示词 1。

## 根因总览

| 问题 | 现象 | 源码根因 | 对应提示词 |
|---|---|---|---|
| P3 + P4 | 缺 `.aidlc/evidence-commands.json` 时 report 失败；空 `commands` 被拒 | `aidlc-evidence.ts` 的 `parseConfig` 要求 config 存在、`stage` 等于当前阶段且 `commands` 非空；语义传感器实际由 `runSemanticCommand` 内置执行，config 中的 `argv` 只做字面比对 | 1 |
| P1 | Work 写“多模块协作”，agent 却选了 single-module | `aidlc-orchestrate.ts` 中 `directiveChoices` 已计算但未写入 directive；`inception-workspace-detection.md` 示例命令写死 `--user-input single-module` | 2 |
| P2 | parked 后无法新建 workflow | `handleNext` 在已有 state 时静默忽略 `--scope/--work`；引擎没有归档命令；`evidenceRoot` 不含 `workflow_id`，旧证据会被新 workflow 复用 | 3 |
| P7 | `next` 返回 m01-trade 而非 m02-product | `splitNext` 按 registry 顺序返回第一个可推进模块，属于设计行为；模块 workflow 继承全局 Work，不能据此判断目标模块 | 4 |
| P6 | v4.3 workflow 在 v4.5 下无法继续 | 4.3 → 4.5 间 `stage-graph.json` 三个阶段的传感器集合变化，已完成阶段在上游门禁复验时缺证据；恢复路径 `evidence run --refresh` 又被 P3 的 `stage` 锁定卡住 | 5 |
| P5 | semantic `argv` 格式没有文档 | `aidlc-build-test-evidence/SKILL.md` 只写了 build/test/check 三种 role | 6 |

---

## 提示词 1：语义传感器自动产证不再依赖 evidence-commands.json（P3 + P4）

```
修复 loeyae-aidlc 语义传感器产证必须依赖 .aidlc/evidence-commands.json 的问题。

### 根因（请先阅读确认）
- core/tools/aidlc-evidence.ts：
  - parseArgs 对 config 使用 mustExist=true；
  - parseConfig 要求顶层 stage 等于当前激活阶段，且 commands 非空；
  - 语义传感器（SEMANTIC_SENSORS）实际由 runSemanticCommand 执行内置 checker，
    config 中的 argv 只经 validateSemanticDeclaration 做字面比对，不参与执行。
- 结果：内置 checker 本身没有外部命令，这层白名单只是形式；又因为 stage 锁定，
  每进一个阶段、每次 --refresh 都要重写 config，而不是只在首次失败一次。

### 要求
1. 当本次需要产出的证据全部来自语义传感器时，evidence run 与 orchestrate report
   的自动产证路径不再要求 config 存在，直接调用内置 checker。
2. config 存在但 stage 与当前阶段不一致时：若本次只需要语义证据，忽略该 config；
   只有需要 build/test/check/red/green 命令时才按现有规则报错。
3. build/test/check/red/green 继续保留 config、stage 锁定和 argv 白名单校验，行为不变。
4. config 中已有的 role=semantic 条目继续按现有规则校验（向后兼容），但不再是必需项。
5. 需要非语义命令却缺少 config 时，错误信息附带一段最小可用配置示例
   （含 version="1"、当前 stage、一条 build 或 test 命令）。

### 不要做
- 不要在 workflow 创建时预生成跨阶段共用的 config：stage 锁定会让第二个阶段失败。
- 不要生成 "TODO": true 之类的占位条目：validateArgv 会拒绝，且违反禁止占位的规则。
- 不要引用不存在的 install --init-project 命令。
- 不要放宽非语义命令的白名单或 stage 校验。

### 验证（只运行定向测试，不运行完整 npm test）
- 新增定向测试：无 .aidlc/evidence-commands.json 时，只含语义传感器的阶段
  （如 requirements-analysis 的 traceability-matrix）能完成 report 并生成证据。
- config 的 stage 为其他阶段时，只含语义传感器的阶段仍能产证。
- 含 build/test 传感器的阶段在缺 config 或 stage 不一致时仍按原规则失败，并输出示例。
- 运行受影响的既有 evidence / orchestrate 测试与类型检查。
```

---

## 提示词 2：directive 输出 choices，workspace-detection 不再暗示默认选项（P1）

```
修复 loeyae-aidlc 在 workspace-detection 阶段让 agent 自行选定 single-module 的问题。

### 根因（请先阅读确认）
- core/tools/aidlc-orchestrate.ts 中 run-stage directive 的构造处：
  const directiveChoices = runtimeChoices(nextStage, state) 已计算，
  但返回对象里没有该字段，是死变量，agent 看不到可选项。
- core/stages/inception/inception-workspace-detection.md 的示例 report 命令写死
  --user-input single-module，agent 会照抄。

### 要求
1. run-stage directive 增加 choices 字段，值为 runtimeChoices 的结果；
   没有选项的阶段输出空数组或省略，二选一后保持全局一致。
2. 当 choices 非空时，lightweightNextPrompt 生成的 handoff_prompt 必须：
   - 列出全部选项及各自适用条件；
   - 明确写出“必须向用户提问并等待用户回答后再 report，不得自行选择”。
   workspace-detection 的两种模式说明：
   - single-module：单一业务模块，不需要跨模块协作和产品级 inception；
   - multi-module：多业务模块或多服务，启用产品级 inception（module-division、product-contracts 等）。
3. inception-workspace-detection.md 示例改为 --user-input <single-module|multi-module> 占位，
   并在步骤说明中写明该值来自用户回答。
4. 同步检查其他阶段文档中是否也有写死 --user-input 选项的示例，一并改为占位。

### 不要做
- 不要扫描 Work 文本里的“多模块/协作/split”等关键词：这是启发式补丁，
  漏判、误判都会发生，根因是选项没有传给 agent。
- 不要改变 report 对 --user-input 的校验逻辑。

### 验证（只运行定向测试）
- 定向测试：workspace-detection 的 run-stage directive 包含 choices，
  且 handoff_prompt 同时包含两种模式与“必须提问”的要求。
- 检查阶段文档中不再存在写死的 --user-input 具体值示例。
- 若发行产物包含阶段文档，执行构建并确认分发一致性。
```

---

## 提示词 3：新增 orchestrate archive，已有 state 时显式拒绝 --scope（P2）

```
为 loeyae-aidlc 增加 workflow 归档能力，解决 parked/done workflow 阻止新建的问题。

### 根因（请先阅读确认）
- core/tools/aidlc-orchestrate.ts 的 handleNext：已有 state 时静默忽略 --scope/--work；
  parked 返回 parked 提示，done 只返回 "... is already complete."。
- 引擎中没有任何 aidlc/archive 约定，也没有归档命令。
- evidenceRoot 生成 .aidlc/evidence/<stage>/[<module>/[<unit>]]，不含 workflow_id。
  只移走 aidlc/active 时，新 workflow 会看到旧证据，missingSemanticEvidence 会跳过重新产证。

### 要求
1. 新增命令：loeyae-aidlc orchestrate archive [--reason <text>]
   - 仅允许 status 为 parked 或 done 的 workflow；running 时报错并提示先 park。
   - 存在未释放的 claim 或锁时报错，不强制释放。
   - 归档目标：aidlc/archive/<workflow_id>-<UTC 时间戳>/，同时移入：
     - aidlc/active 下的全部内容；
     - split 布局下由 core/tools/aidlc-workflow-layout.ts 定义的全部路径
       （registry.md、modules/、integration/ 等，以代码定义为准）；
     - .aidlc/evidence 整个目录（放入归档目录的 evidence/ 子目录）。
   - .aidlc/evidence-commands.json 属于项目配置，保留原位不归档。
   - 归档前在 audit.md 追加归档事件（reason、时间、目标路径），然后随目录一起归档。
   - 目标目录已存在时报错，不覆盖。
   - 输出新建 workflow 的下一步命令提示。
2. orchestrate next 在已有 state 时收到 --scope 或 --work，返回 kind="error"，
   说明当前 workflow 的 id 与状态，并提示先 park（若 running）再 archive；
   不再静默忽略。
3. park、next --resume 的现有行为不变。

### 不要做
- 不要新增 --force 等把归档和新建合并在一起的快捷参数。
- 不要删除任何文件；归档只做移动。

### 验证（只运行定向测试）
- 创建 → park → archive → aidlc/active 与 .aidlc/evidence 均不存在 → next --scope 新建成功，
  且新 workflow 的语义证据会重新产出。
- done 状态可归档；running 状态 archive 报错；存在 claim 时 archive 报错。
- 已有 state 时 next --scope/--work 返回 error。
- split 布局下归档后 registry、modules、integration 全部进入归档目录。
```

---

## 提示词 4：多模块下 next 不带 --module 时让用户选择模块（P7）

```
改进 loeyae-aidlc split 布局下 orchestrate next（不带 --module）的模块选择行为。

### 根因（请先阅读确认）
- core/tools/aidlc-orchestrate.ts 的 splitNext 按 registry 顺序返回第一个可推进模块，这是设计行为。
- 模块 workflow 由 createInitialState(..., global.work_description) 创建，继承的是全局 Work，
  所以用 Work 文本推断目标模块不可靠。

### 要求
1. 不带 --module 时：
   - 只有一个模块可推进：保持现有行为，直接返回该模块的 directive；
   - 有多个模块可推进：返回 kind="ask"（复用引擎现有 ask 形态），列出可推进模块
     及各自下一阶段，并给出 next --module <module-id> 命令模板。
2. 支持环境变量 AIDLC_MODULE 作为默认模块：
   - 已设置且模块存在：等价于 --module；
   - 模块不存在：返回 error，不回退到其他模块。
   - 显式 --module 优先于 AIDLC_MODULE。
3. 更新相关 Skill / steering 中对 next 的说明，写明多模块时需先由用户指定模块。

### 不要做
- 不要解析 Work 文本中的模块 ID。
- 不要改变显式 --module 的行为。

### 验证（只运行定向测试）
- 单个可推进模块：行为不变。
- 多个可推进模块：返回 ask，并列出全部可推进模块。
- AIDLC_MODULE 指定存在的模块、不存在的模块、与 --module 同时存在时的优先级。
- 运行 tests/test_v4_3_module_workflows.ts 中受影响的用例。
```

---

## 提示词 5：新增只读的 orchestrate upgrade --dry-run（P6，依赖提示词 1）

```
为 loeyae-aidlc 增加版本升级检查，帮助 v4.3 workflow 在 v4.5 下恢复推进。

### 前置条件
提示词 1 已合入。否则 evidence run --refresh 仍会被 config 的 stage 锁定卡住。

### 根因（请先阅读确认）
- 引擎对 state 没有版本校验，parseLightWorkflowState 不拒绝旧版本 state。
- 对比 4.3 合并点（42ee80c）与当前 core/stage-graph.json，传感器集合变化如下：
  - application-design：新增 structural-invariants；
  - units-generation：新增 structural-invariants；
  - test-case-derivation：traceability-matrix 改为 test-case-derivation。
- 已完成这些阶段的旧 workflow，会在 advance 的上游门禁复验时因缺证据被拦截。
- 现成的恢复路径是 evidence run --refresh 加 re-attest
  （阅读 aidlc-orchestrate.ts 中 Re-attestation 与 re-verify 已完成实例的逻辑）。

### 要求
1. 新增只读命令：loeyae-aidlc orchestrate upgrade --dry-run [--module <module-id>]
   - 遍历全局、各模块、integration 的 workflow（split 布局按 aidlc-workflow-layout.ts 解析）；
   - 找出“已完成、但按当前 stage-graph 声明的传感器缺少证据”的实例；
   - 对每个实例输出：instance_id、module_id、缺失的传感器、
     以及可直接执行的恢复命令（evidence run --refresh + re-attest，按现有 CLI 实际参数生成）；
   - 输出 JSON，不写任何文件。
2. 本次只提供 --dry-run；不带 --dry-run 时返回 error，说明请按输出逐个执行恢复命令。
3. 若 state 中记录了引擎版本，一并输出；没有记录时如实输出为未知，不推断。

### 不要做
- 不要新增 migrate 命令，也不要在 History 中引入 migrated 等新结果：
  这会改变 completedInstanceIds 的语义，影响范围过大。
- 不要自动迁移人员分配或 unit/module selection：旧 state 原地继续使用，无需迁移。
- 不要在本任务中增加 state 版本拒绝逻辑。

### 验证（只运行定向测试）
- 用一个 application-design 已完成、但缺 structural-invariants 证据的 fixture：
  dry-run 列出该实例和缺失传感器；按输出命令执行后，再次 dry-run 输出为空。
- dry-run 前后工作区无文件变化。

### 未验证事项
- Windows 项目中 v4.3 → v4.5 的原始报错尚未获得，“无法使用”的具体表现需用原始报错确认。
  若原始报错与上述传感器变化无关，先报告，不扩大实现范围。
```

---

## 提示词 6：补齐 evidence-commands.json 的 role 文档（P5，在提示词 1 之后执行）

```
补齐 loeyae-aidlc 中 .aidlc/evidence-commands.json 的配置文档。

### 根因
core/skills/aidlc-build-test-evidence/SKILL.md 只说明了 build、test、check 三种 role，
没有 semantic、red、green。

### 要求
1. 在 core/skills/aidlc-build-test-evidence/SKILL.md 中补充（以 aidlc-evidence.ts 的 parseConfig 为准）：
   - 顶层字段：version 固定为 "1"；stage 必填，且必须等于当前激活阶段；commands；可选 artifacts；
   - 六种 role（build / test / check / semantic / red / green）的用途；
   - commands[] 字段：id、role、sensor（仅 semantic）、argv、cwd、timeout_ms 及默认值与上限；
   - 说明 stage 锁定的含义：每进入一个需要非语义命令的阶段，都要更新 stage 并声明该阶段的命令；
   - 说明提示词 1 合入后，只需语义证据的阶段不需要该文件。
2. semantic 条目只保留简短说明：可选；如声明，argv 必须是
   ["loeyae-aidlc", "check", "--sensor", "<sensor-name>"]，不要追加 --module 等参数。
3. 给出一个含 build 与 test 的最小配置示例。

### 不要做
- 不要写“--stage 由引擎补充、配置中不要写”：顶层 stage 字段是必填项。
- 不要新增 help evidence 子命令或独立 schema 文档，本任务只补齐现有 Skill 文档。

### 验证
- 文档中的字段、role 列表、默认值与 parseConfig 实际代码逐项一致。
- 若 Skill 进入发行产物，执行构建并确认分发一致性；运行受影响的平台布局测试
  （注意 tests/test_platform_layouts.py 在基线已有与本任务无关的失败，只需确认没有新增失败）。
```
