# Evidence reuse and targeted repair

`next` / `report` 的正常门禁始终是完成判定依据。复用计划和修复诊断只说明当前可做的工作，不授予发布权限、审批或通过结论。

## Current-target evidence plan

`evidence_reuse_plan.entries/reuse/verify/revalidate` 只列精确目标 stage instance 的传感器。其他已选择阶段保留在 `selected_rule_stages` 和 `deferred_stages`；它们不是当前重验待办。没有精确目标的工作流级计划只描述选择与延后范围，操作列表为空。

`verify` 表示使用正常门禁验证已有证据，不表示重新执行测试。`revalidate` 表示当前证据需要进一步处理，应按其错误诊断选择恢复、补证或修复输入，不自动等同于重跑整个阶段。

初步定位变更可使用 `orchestrate state changes --from <完整提交ID> --paths <JSON数组>`，无需领取或有效进度状态。Git 差异只缩小调查范围，不证明证据仍有效。局部证据核对采用相同算法的 scope-only 摘要，不读取范围外文件；此投影的全仓摘要为 null，不得作为新生产证据或最终候选身份发布。证据生产、实际质量门禁、必要环境和检查器身份验证仍保留。不得为减少重复文档而另建一份人工维护的进度报告，已有摘要与复用计划按需读取。

## Typed repair diagnostics

失败 directive 返回 `repair_diagnostics`，`repair_guidance` 保留重试摘要，避免重复输出同一组诊断。每项包含原因 `code/category`、目标 `stage_instance/sensor`、可定位时的 `artifact`、原始 `message`、`action`、`next_step` 和 `requires_human_approval`。有确定修复入口时，`command` 提供建议 argv，宿主不得把任意错误日志当作可执行脚本。

- 缺失或过期的语义证据：定位到单一 `--sensor`；已完成目标带 `--refresh`，活动目标使用普通生产入口。
- 实际测试失败：先检查原始失败并修复最小原因，不通过扩大测试范围修复元数据。
- 历史 RED/BASELINE 输入漂移：保留原件并诊断受影响观察，不盲目重跑 RED。
- `HISTORICAL_RED_APPROVAL_REQUIRED` / `RED_OMISSION_INVALID`：核验原始 RED 是否可恢复，或在当前 GREEN/I13 有效后取得真实人类审批，再使用历史漏登入口。建议命令中的审批占位符不是批准。
- `HISTORICAL_BASELINE_APPROVAL_REQUIRED` / `BASELINE_OMISSION_INVALID`：核验原始 BASELINE 是否可恢复；实现已修改 characterization code refs 的历史漏登须审阅当前 GREEN/I13 和原基线链，再对精确单元显式审批并使用 `--sensor baseline-test-evidence --refresh --historical-omission`。不通过重复运行当前测试伪造实现前的观察，不改成 `not_required`。

原始错误保留可读；原因代码、目标和 argv 用于宿主选择动作。诊断不能跳过既有会话、来源、审批或测试门禁。

## Equivalent retry identity

宿主自动派发证据修复时必须读取顶层 `repair_guidance`。`action=diagnose` 停止等价刷新并保留原始失败；不能只挑 `repair_diagnostics.command` 继续执行。首次 `action=repair` 即使 `equivalent_retry_allowed=false` 也可执行一次；后续仍受原授权期限、预算和 Core 判定限制。批量修复按规范化的实际命令与失败输入指纹计数，不按第一条传感器名称计数。

`input-defect` 表示 canonical 输入缺失、必要设计章节缺失、未解决占位符等真实输入问题，动作是 `repair-inputs`，不附带自动刷新命令。先修正输入，再校验；保持同一缺陷重新生产证据不能构成进展。

重试指纹绑定 workflow/instance、结构化失败原因、受影响证据及原测试/I13 输入。进度日志、耗时和展示时间戳不区分阻断。相同原因和输入再次失败时返回 `diagnose`，`equivalent_retry_allowed` 保持 false；修复真实输入或出现不同失败后重新计数。

只读调用不写重试日志；损坏或失效的会话不能发布。日志保存有界的失败标识与计数，不保存无界原始日志。重试日志不缓存“门禁通过”结论，也不限制修复后进行正常验证的次数。

## 外置模块文档的输入归属

模块 manifest 可选 `context_paths` 声明模块私有的精确 Markdown 路径，例如 `"context_paths": ["team/m06-integration.md"]`。它不用于声明源码或全局规则：拒绝通配符、目录、根文档、AGENTS/README/SKILL、隐藏目录、控制面、canonical docs/aidlc 和已声明源码根下的路径；每个路径只允许一个模块拥有。

未声明文件保持保守绑定。`inputs-v2` 的模块/单元范围排除其他模块精确私有路径，自己的文档继续绑定；显式 `contract_paths`、单元 `shared_paths` 和自主依赖输入优先，项目级验证不作此排除。归属声明本身参与输入摘要，改变声明需重新校验，不追认旧证据；旧范围保持原排除语义。不得根据文件名中的模块代号自动忽略文件。跨模块消费者必须显式登记共享输入。

## Explicit semantic-only batches

自动 report/re-attest 将明确缺失的语义传感器放进同一个 producer 调用。例如：

```bash
loeyae-aidlc evidence run --stage code-generation --module <module-id> --unit <unit-id> --sensors test-quality,traceability-matrix,structural-invariants --refresh
```

活动实例省略 `--refresh`。整个列表在生成前验证：只允许当前阶段已启用、互不重复的语义传感器；RED/BASELINE/GREEN、build/test、未知或其他阶段的传感器均拒绝。不能与 `--sensor`、`--all-sensors`、输出重定向、命令筛选、lint、测试过滤或历史恢复混用。

每项继续使用独立发布锁、当前会话和来源校验。失败时停止后续处理，已生成项保留受控证据；整个阶段仍需正式 report。自动补证只补缺失记录，已有实际阶段观察保持原字节，不执行测试命令来修复其他语义记录。显式单传感器生产与原有阶段级入口继续保留其含义。

## Source calculations within a validation request

`next/report`、producer 与语义检查子进程在各自的只读校验区间内复用源码摘要计算。异步调用使用独立上下文，同一调用的嵌套读取共享计算；成功、失败、异步拒绝后都释放上下文，延迟回调不能继续使用已结束请求的缓存。缓存键区分项目、摘要范围、投影输入和嵌套仓库声明。

项目命令、语义/补证子进程、生成器和证据发布均构成失效边界：执行前清理旧计算，执行后无论成功、非零退出、超时或抛错都再次清理。已知输入更新也使同进程其他活动校验上下文的摘要失效。后续读取必须重新计算，不能继续使用执行前的来源摘要。

源码摘要共享不扩大证据适用范围，也不改变历史证据的来源算法。

## Successful GREEN gates within one request

普通、完整的 GREEN 观察可以在同一次请求内复用已通过的完整门禁结果。每次尝试复用仍读取当前证据并检查时间有效性，按内容绑定工作流与基线状态、I13、证据与命令配置、原测试输入、文档、环境、仓库 HEAD 和校验选项。绑定变化必须重新验证；任何失败均不缓存。显式新鲜度窗口在尝试复用时重新检查，不因缓存延长。

历史 RED/BASELINE 校验、回放、漏登豁免、无行为替代验证、缺少原输入绑定的旧证据和自定义门禁不复用成功结论。扫描过大、不支持的文件或符号链接使本次复用失效，继续完整门禁。项目命令、发布与请求结束同时清除源码摘要和成功结果，独立异步请求不能共享结论。审批原件仍由其正常门禁逐次读取。

## Versioned sensor dependencies

首个明确声明依赖的传感器是 `build-and-test-templates/template-completeness`。新生产记录使用 `checker.identity_version: 2` 和 `sensor-inputs-v1` 来源范围；`inputs` 记录版本、传感器、工件清单与逐文件 SHA-256。范围包括两份实际模板、module/unit manifests，以及显式 `contract_paths`、`evidence_inputs.shared_paths`。缺失路径也进入摘要；忽略文件仍按显式声明读取。目录清单超限直接拒绝，不以截断摘要证明完整性。

该传感器的受控 producer 执行独立入口，绑定检查器、输入契约、上下文解析器和身份算法的闭合实现依赖，以及运行时与包配置/依赖内容。包版本号单独变化不改变实现身份；增加未声明导入直接阻断生产。执行前后核对检查器内容，并在会话发布锁内再次核对输入内容。修改实际模板、声明或共享输入会使证据失效；仅触碰 mtime、修改无关源码或其他传感器实现不会触发重跑。`inputs_changed` 包含内容变化路径。

这是按传感器逐项启用的契约，不能推断其他传感器依赖也已收窄。未知/动态传感器保留完整阶段来源与实现绑定；旧 `identity_version: 1` 记录仍按原完整摘要验证，显式刷新后才迁移，不自动改写旧证明。RED、BASELINE、GREEN 和 Vitest 历史回放的生产语义保持不变。

独立检查器的闭合依赖声明仅支持普通静态导入。模块关键字旁带注释、带字符串绑定名的导入、再导出及动态加载均明确拒绝；不以未识别语法推断“无依赖”。需要扩展语法时，必须同步扩展依赖解析和回归覆盖后再生产证据。

所有本地导入（含类型导入）均须属于显式闭包，不以标识符 `type` 推断运行时不加载模块。原生模块也采用显式 fs/path/crypto/url 清单；`node:module`、`node:vm` 等加载或求值入口不能通过别名绕开声明。

功能设计完整性使用 identity_version 3：独立执行文件及七个 TypeScript 文件/固定 tsconfig 的闭合依赖集合，运行依赖为 tsx 及其真实传递依赖。Core 路由、worker 和 UI 检查器不在该执行闭包内；项目来源范围仍沿用 functional-design 阶段范围，没有缩减 UC-D、接口、数据源、错误处理检查。旧记录按其原版本核验，刷新后使用新入口。
