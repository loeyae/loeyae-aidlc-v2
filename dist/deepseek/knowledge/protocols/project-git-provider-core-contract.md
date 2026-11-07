# 项目级 Git Provider Core 契约与治理边界 v1.1

- **协议版本**：`1.1`
- **状态**：P0 冻结候选；MARS-150 设计评审通过后成为 v1.1 基线
- **适用范围**：`loeyae-aidlc-v2` 与 `loeyae-aidlc-provider`
- **机器可读定义**：`core/tools/aidlc-provider-types.ts`
- **Schema ownership manifest**：`core/tools/data/provider-schema-ownership.json`

本文是项目级 Git Provider 首发链路的规范性 Core 契约。后续实现可以补充校验、存储和执行细节，但不得在同一 discriminator 下改变字段语义、状态所有权或安全边界；需要改变时必须新增协议版本并保留兼容测试。

## 1. 规范优先级与术语

发生冲突时按以下顺序处理：

1. 已发布 JSON Schema 约束 wire shape；Schema 必须与本规范及 `aidlc-provider-types.ts` 的所有权和状态语义一致；
2. `aidlc-provider-types.ts` 冻结 discriminator、Core wire 类型、状态、诊断和 P0 policy；
3. `provider-schema-ownership.json` 冻结 Schema `$id`、维护仓库、规范路径和对象产生者；
4. 本文解释转换、治理和安全不变量。

这里的“Schema 所有者”和“运行时权威”是两件事：Schema 所有者维护结构定义；运行时权威决定谁能产生可信对象。例如 `loeyae-aidlc-provider` 维护 `provider-evidence` 的跨仓 Schema，但只有 Core 的 Controlled Runner 能签发 accepted Evidence，Provider 进程没有 Evidence 权限。

- **Core**：`loeyae-aidlc-v2` 的可信控制面及其 owning conductor。
- **Provider**：锁定 Git commit 中、由 Runner 隔离调用的未受信任实现。
- **Controlled Runner**：Core 内置执行边界；生成 Request、实施 sandbox、验证 Result、签发 Evidence。
- **Result**：Provider 唯一可写的结构化结果，始终未受信任。
- **Evidence**：Runner 校验并绑定 Plan/lock/revision 后签发的可信封装。
- **GateDecision**：Core 对当前 Plan、有效 Evidence、fallback 和 waiver 的最终判定。
- **protected gate**：部署、安全、迁移或项目 policy 标记为受保护的门禁。

## 2. 唯一权威与调用链

```text
Core Resolver
  → immutable ProviderPlan
  → Controlled Runner creates ProviderRequest
  → Provider writes ProviderResult + declared reports to invocation output
  → Runner validates and signs ProviderEvidence
  → Core evaluates GateDecision
  → owning conductor invokes orchestrate report with that decision
```

| 对象/动作 | 唯一权威 | Provider 能否产生/执行 | 约束 |
|---|---|---:|---|
| `aidlc/active/aidlc-state.md` | Core / owning conductor | 否 | Provider 与 Extension 均不可写。 |
| `aidlc/active/audit.md` | Core / owning conductor | 否 | Provider 生命周期事件也由 Core 追加。 |
| Profile、binding、selector 结果 | Core | 否 | Provider 可声明 selector，但不能决定最终适用性。 |
| ProviderPlan、fallback 选择 | Core | 否 | Plan 绑定 project lock、Profile、policy、scope 与 revision。 |
| ProviderRequest | Controlled Runner | 只读 | 是 Provider 唯一可信输入。 |
| ProviderResult、声明报告 | Provider | 是 | 只能写 invocation `output/`；Result 未受信任。 |
| accepted Evidence | Controlled Runner | 否 | Runner 重算摘要并签名；Provider 自报 Evidence 即非法。 |
| Evidence 有效性状态 | Core | 否 | stale/expired/revoked 由 Core 计算或签发事件。 |
| GateDecision | Core | 否 | 只消费当前 accepted 且有效 Evidence。 |
| waiver、approval、`orchestrate report` | Core / 人工 | 否 | Provider 不得自我豁免或推进阶段。 |
| merge/push | 人工交付边界 | 否 | Core 也不自动取得此权限。 |

**硬不变量**：Core 是 state、audit、approval、report、accepted Evidence 与 GateDecision 的唯一语义所有者；Provider 只拥有未受信任 Result 和临时报告内容。

## 3. Schema ownership、URI 与版本

所有 Schema 使用 JSON Schema Draft 2020-12；`$id` 是离线可用 URN。对象中的 `schema` discriminator 必须精确匹配，Core 首发不对未知 `v1.x` 猜测兼容。

| Schema discriminator | `$id` | 维护仓库 | 对象产生者 |
|---|---|---|---|
| `aidlc.provider/v1.1` | `urn:loeyae:aidlc:schema:provider:1.1` | `loeyae-aidlc-provider` | Provider 作者 |
| `aidlc.provider-request/v1.1` | `urn:loeyae:aidlc:schema:provider-request:1.1` | `loeyae-aidlc-provider` | Controlled Runner |
| `aidlc.provider-result/v1.1` | `urn:loeyae:aidlc:schema:provider-result:1.1` | `loeyae-aidlc-provider` | Provider |
| `aidlc.provider-evidence/v1.1` | `urn:loeyae:aidlc:schema:provider-evidence:1.1` | `loeyae-aidlc-provider` | Controlled Runner |
| `aidlc.provider-conformance/v1.1` | `urn:loeyae:aidlc:schema:provider-conformance:1.1` | `loeyae-aidlc-provider` | Conformance Runner |
| `aidlc.knowledge-receipt/v1.1` | `urn:loeyae:aidlc:schema:knowledge-receipt:1.1` | `loeyae-aidlc-provider` | Core |
| `aidlc.project-providers/v1` | `urn:loeyae:aidlc:schema:project-providers:1` | `loeyae-aidlc-v2` | Core CLI |
| `aidlc.project-providers-lock/v1` | `urn:loeyae:aidlc:schema:project-providers-lock:1` | `loeyae-aidlc-v2` | Core CLI |
| `aidlc.profile/v1.1` | `urn:loeyae:aidlc:schema:profile:1.1` | `loeyae-aidlc-v2` | Core |
| `aidlc.provider-plan/v1.1` | `urn:loeyae:aidlc:schema:provider-plan:1.1` | `loeyae-aidlc-v2` | Core Resolver |
| `aidlc.gate-decision/v1.1` | `urn:loeyae:aidlc:schema:gate-decision:1.1` | `loeyae-aidlc-v2` | Core Gate |

表中展示名与 ownership manifest 的 `producer` 枚举对应如下：Provider 作者=`provider-author`，Provider=`provider`，Core CLI/Core/Core Resolver/Core Gate=`core`，Controlled Runner=`controlled-runner`，Conformance Runner=`conformance-runner`。维护仓库不能据此取得对象的运行时签发权限。

### 3.1 防止重复定义

- Schema 维护仓库只存在一份规范 Schema；另一仓只能按明确版本和 digest 消费 fixture，不得复制后独立演进。
- Provider 仓库发布 `provider/request/result/evidence/conformance/knowledge-receipt`；Core schema reader 从锁定 Provider protocol 包读取并验证其 digest。
- Core 发布 `project-providers/project-providers-lock/profile/provider-plan/gate-decision`；Provider conformance 测试以 Core 导出的 fixture 验证兼容。
- ownership 变化本身是协议变更，不能在 v1.1 中静默发生。

### 3.2 通用 wire 规则

- JSON 规范化：RFC 8785 JCS；摘要：小写 `sha256:<64 hex>`。
- 时间：UTC RFC 3339；禁止本地时区模糊值。
- 路径：`/` 分隔的 sandbox/project 相对路径；禁止绝对路径、盘符、反斜杠、空段、`.`、`..`、NUL。
- 未知字段：默认拒绝。扩展只能位于 `extensions.<reverse-dns-namespace>`，namespace 匹配 `^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$`。
- 任何参与摘要的对象先去掉其自摘要字段，再按 Schema 声明的 digest projection 做 JCS；禁止实现自行排除字段。
- Schema minor、required、enum、状态或摘要 projection 的变化必须发布新 discriminator；文案修正不得改变 wire 语义。

### 3.3 首发兼容矩阵

| Core | Provider protocol / SDK | 行为 |
|---|---|---|
| `loeyae-aidlc-v2 <= 4.13.3` | 任意 | 不支持项目级 Git Provider，不得假装兼容。 |
| 4.13.3 后首个 Provider 版本线（计划 4.14.x） | protocol `1.1`、SDK `0.1.x` | 精确接受本表 discriminator；Schema/fixture digest 必须匹配。 |
| 首发 Core | 未登记的 `1.x` 或 `2.x` | `PROVIDER_SCHEMA_INCOMPATIBLE`，fail-closed。 |
| 首发 SDK | Core-owned Schema 未知版本 | Conformance 失败，不生成“兼容”报告。 |

## 4. Core wire 对象的最小语义

完整字段见 `aidlc-provider-types.ts`。以下规则是 Schema/SDK 实现必须保留的语义：

- **Manifest**：声明 Provider ID/version、协议范围、capability、entrypoint digest、ruleset digest、请求权限和 exception policy。声明只会缩小候选范围，不能扩大 Core policy。
- **Effective Profile**：Core 合并后产生；facts、risk facts 和 lineage 全部参与 `profile_digest`。
- **Project intent/lock**：intent 保存 Git/ref/config/binding；lock 保存不可变 commit/tree/Manifest/ruleset/entrypoint/SBOM/config digest。仓库根的 `source.subdir` 规范化为 `null`，不得省略。
- **Plan**：绑定 lock/Profile/policy/source revision/scope；节点包含 selector 三值结果、依赖和已锁定 fallback 候选。相同规范化输入必须产生相同 digest。
- **Request**：绑定 invocation、Plan node、Provider instance、lock、scope、source revision、只读输入、结构化 command、输出 namespace 和有限资源预算。
- **Result**：只包含 invocation ID、终态、规则结果、Provider diagnostics、deferred 元数据和临时报告引用；禁止 Plan/lock/revision/Runner/Evidence/Gate/signature/approval/waiver 字段。
- **Knowledge Receipt**：由 Core 在锁定 knowledge capability 加载后签发，绑定 Provider instance/commit/Manifest/ruleset、Plan node、scope、topic、章节 digest 和加载时间；`gate_eligible` 固定为 `false`，只能证明“加载过哪个版本”，不能证明实现合规或满足 Gate。
- **Evidence**：Runner 绑定 Request/Result digest、Plan、lock、revision、规则结果、重算 summary、有效期、Runner policy 和签名。
- **GateDecision**：Core 绑定当前 Evidence、rule evaluations、fallback、waiver、policy 和签名；只有该对象可表达 `passed_with_waiver`。

### 4.1 `not_applicable` 与 `waived` 的字段边界

- Provider 级适用性由 Core selector 决定，Plan node 使用 `not_selected` 或 `unknown`；Invocation Result 没有 `not_applicable`。
- 已被调用的 Provider 可以对**单条规则**返回 `not_applicable`，必须给出 `applicability_reason`；Runner 验证规则确实属于该 capability/ruleset。
- Provider Result 的 rule status 只能是 `passed | failed | not_applicable`，不得返回 `waived`。
- `waived` 只出现在 Core Gate 的 `rule_evaluations`，并保留 `original_status: failed` 与 `waiver_id`。

## 5. 五层状态机

所有终态对象不可原地改写；重试、事实补全、lock 变化或 policy 变化生成新 ID 与新 digest。Knowledge Receipt 不是门禁状态层：它是不可变加载回执，`gate_eligible=false`，因此不进入以下五层状态转换，也不能出现在 GateDecision 的 Evidence 输入中。

### 5.1 Plan node

| 当前状态 | 允许到达 | 说明 |
|---|---|---|
| `unresolved`（内部） | `selected` / `not_selected` / `unknown` / `blocked` | selector 与 capability 解析结果。 |
| `unknown` | `selected` / `not_selected` / `blocked` | 补充 facts 后必须生成新 Plan；必需节点在冻结 Plan 中不得以 unknown 执行。 |
| `selected` | `blocked` | lock/trust/revision 失效时新 Plan 阻断；不能就地换 Provider。 |
| `not_selected` | 无 | Core selector 的确定终态。 |
| `blocked` | 无 | 修复输入后生成新 Plan。 |

`Provider` 不能返回 Plan 级 `not_selected/not_applicable`。必需 selector 为 `unknown`、缺 capability、冲突、循环或不兼容都必须变为 `blocked`。

### 5.2 Invocation Result

| 当前状态 | 允许到达 | 所有权 |
|---|---|---|
| `scheduled`（内部） | `running` / `cancelled` | Runner |
| `running` | `passed` / `failed` / `deferred` / `error` / `cancelled` | Provider 提交未受信任状态；Runner 对进程异常/取消有最终覆盖权。 |
| 任一终态 | 无 | 重试创建新 `invocation_id`。 |

业务规则不通过应写 `failed` 并正常退出 0；非零退出、缺 Result 或协议异常由 Runner 记为 `error`/诊断，不能伪装为规则失败或通过。

### 5.3 Rule check

| 当前状态 | 允许到达 | 说明 |
|---|---|---|
| `pending`（内部） | `passed` / `failed` / `not_applicable` | Provider 原始规则结果。 |
| `failed` | `waived` | 仅 Core Gate 的派生 evaluation，原始 Result/Evidence 不改写。 |
| `passed` / `not_applicable` / `waived` | 无 | 终态。 |

### 5.4 Evidence

| 当前状态 | 允许到达 | 说明 |
|---|---|---|
| `pending_validation`（内部） | `accepted` | Schema、绑定、摘要、summary、Runner policy 全部通过才签发。 |
| `accepted` | `stale` / `expired` / `revoked` | lock/config/Profile/policy/revision 变化、时间到期或撤销。 |
| `stale` / `expired` | `revoked` | 撤销优先级最高。 |
| `revoked` | 无 | 永不可恢复；只能重跑生成新 Evidence。 |

invalid Result 不会生成状态为“invalid”的 Evidence，而是根本不能进入 accepted。

### 5.5 GateDecision

| 当前状态 | 允许到达 | 条件 |
|---|---|---|
| `evaluating`（内部） | `passed` | capability 表达式满足，所有 Evidence 当前 accepted，无 waiver。 |
| `evaluating`（内部） | `passed_with_waiver` | 仅剩已获准且未过期的 failed-rule waiver。 |
| `evaluating`（内部） | `blocked` | 其他任何情况。 |
| 任一终态 | 无 | 输入变化必须生成新 `decision_id`。 |

## 6. P0 诊断码

`emitter` 是唯一可首创该诊断的边界；Runner 可转录 Provider diagnostics，但不能把 Provider 自报的 Core 诊断当可信。`effect` 是无额外 policy 时的默认结果。

### 6.1 Core：配置、来源与解析

| Code | Effect | Retry | 含义 |
|---|---|---:|---|
| `PROVIDER_CONFIG_INVALID` | blocked | 否 | 项目 intent/config 不符合 Schema/policy。 |
| `PROVIDER_LOCK_MISSING` | blocked | 否 | 必需实例没有 lock。 |
| `PROVIDER_LOCK_MISMATCH` | blocked | 否 | intent/config 与 lock identity/digest 不一致。 |
| `PROVIDER_SOURCE_DISALLOWED` | blocked | 否 | 协议、host、组织、URL 凭据或路径违反 Git Source Policy。 |
| `PROVIDER_REF_UNRESOLVED` | blocked | 是 | 显式 add/update 时 ref 无法解析；发生在 Plan 之前，不能运行时 fallback。 |
| `PROVIDER_SOURCE_UNAVAILABLE` | blocked | 是 | 已锁定 commit/cache 暂不可取得；可选择同一 Plan 内已锁定替代节点。 |
| `PROVIDER_COMMIT_UNTRUSTED` | blocked | 否 | 当前 gate 要求的签名/allowlist/conformance 未满足。 |
| `PROVIDER_COMMIT_REVOKED` | blocked | 否 | commit、签名身份或 Provider release 已撤销。 |
| `PROVIDER_SCHEMA_INCOMPATIBLE` | blocked | 否 | discriminator/dialect/版本未被当前 Core 明确支持。 |
| `PROVIDER_MANIFEST_INVALID` | blocked | 否 | Manifest、ruleset、entrypoint、SBOM/lock 声明无效。 |
| `PROVIDER_CAPABILITY_MISSING` | blocked | 否 | 没有可满足必需 capability 的实例。 |
| `PROVIDER_SELECTOR_UNKNOWN` | blocked | 否 | 必需 selector 因 facts 缺失为 unknown。 |
| `PROVIDER_DEPENDENCY_CYCLE` | blocked | 否 | capability/Plan 依赖成环。 |
| `PROVIDER_PLAN_CONFLICT` | blocked | 否 | exclusive 或 capability expression 冲突。 |
| `PROVIDER_PLAN_STALE` | blocked | 否 | Plan 输入 digest 与当前 lock/Profile/policy/revision 不同。 |

### 6.2 Controlled Runner：sandbox 与 Result

| Code | Effect | Retry | 含义 |
|---|---|---:|---|
| `PROVIDER_SANDBOX_UNAVAILABLE` | blocked | 是 | 当前 OS 无法落实声明的隔离；禁止 best-effort 降级。 |
| `PROVIDER_PERMISSION_DENIED` | blocked | 否 | 请求或行为超出授权。 |
| `PROVIDER_PATH_ESCAPE` | blocked | 否 | 路径、symlink、junction 或 reparse point 越界。 |
| `PROVIDER_NETWORK_DENIED` | blocked | 否 | Provider 尝试未授权网络。 |
| `PROVIDER_SHELL_DENIED` | blocked | 否 | entrypoint/command 尝试 shell 或字符串命令。 |
| `PROVIDER_TIMEOUT` | deferred | 是 | 超过有限 wall-time；本身不能放行。 |
| `PROVIDER_CANCELLED` | cancelled | 是 | Runner/用户取消本次 invocation。 |
| `PROVIDER_PROCESS_ERROR` | failed | 是 | 非零退出、signal 或进程启动异常。 |
| `PROVIDER_RESULT_MISSING` | failed | 是 | 正常结束但没有唯一 Result。 |
| `PROVIDER_RESULT_INVALID` | blocked | 否 | Result Schema、规则汇总、路径或字段不合法。 |
| `PROVIDER_RESULT_BINDING_MISMATCH` | blocked | 否 | invocation/ruleset/capability 与 Request/Plan 不一致。 |

### 6.3 Core：Evidence 与 Gate

| Code | Effect | Retry | 含义 |
|---|---|---:|---|
| `PROVIDER_EVIDENCE_STALE` | blocked | 是 | validity key 已被输入变化失效。 |
| `PROVIDER_EVIDENCE_EXPIRED` | blocked | 是 | Evidence 超过有效期。 |
| `PROVIDER_EVIDENCE_REVOKED` | blocked | 否 | Evidence 或其来源已撤销。 |
| `PROVIDER_GATE_EVIDENCE_MISSING` | blocked | 是 | Plan 必需节点没有当前有效 Evidence。 |
| `PROVIDER_WAIVER_INVALID` | blocked | 否 | waiver 所有者、范围、规则、Evidence、期限或批准无效。 |
| `PROVIDER_FALLBACK_NOT_ALLOWED` | blocked | 否 | fallback 未同时获 Manifest/Core/stage policy 许可。 |
| `PROVIDER_DEFERRED_NOT_ALLOWED` | blocked | 否 | deferred 缺期限/补跑要求或 policy 不许可。 |

### 6.4 Provider 可返回的标准 diagnostics

| Code | Effect | Retry | 含义 |
|---|---|---:|---|
| `INPUT_MISSING` | failed | 否 | Request 声明输入缺失；Provider 不得自行读取其他路径。 |
| `INPUT_INVALID` | failed | 否 | 输入内容不满足 capability 前置。 |
| `CHECK_FAILED` | failed | 否 | 一项或多项业务规则真实失败；不可 fallback 掩盖。 |
| `CHECK_DEFERRED` | deferred | 是 | 外部先决事实暂不可得；必须有 deadline/retry。 |
| `PROVIDER_INTERNAL_ERROR` | failed | 是 | Provider 自身可重试异常；Runner 仍验证 Result。 |

## 7. fallback、deferred 与 waiver

三者默认均为 deny，必须同时被 Manifest 声明、Core policy 和当前 stage policy 允许；任何对象都必须参与 Plan/Gate digest 和 audit。

### 7.1 fallback

- 只能切换到**同一已批准 Plan 中**、已锁定 commit、满足同一 capability 和同等/更高 trust 的候选节点。
- 可用于已锁定来源/cache 暂不可用、timeout/cancel/process error、Result 缺失、显式 deferred 或 Provider internal error；add/update 阶段的 ref 解析失败发生在 Plan 之前，不属于 fallback。
- **不得**用于 `CHECK_FAILED`、配置/lock/schema/Manifest 无效、未信任/撤销、权限/路径/网络/shell 违规、Result 伪造/绑定错误、Evidence stale/expired/revoked。
- fallback 不是“忽略失败”；替代节点必须重新生成独立 Request、Result、Evidence。
- 受保护 gate 的跨 Provider fallback 需要 Plan 内显式批准记录；运行时临时发现的 Provider 不可加入。

### 7.2 deferred

- Result 为 `deferred` 时必须包含 reason、`retry_after`、deadline 和所缺输入；deadline 受 Manifest/Core/stage 最大时长共同约束。
- deferred 不能直接产生 passed 或 `passed_with_waiver`；合法出口只有补齐后新 invocation、批准的 fallback，或 blocked。
- 无时限、无限续期或仅以文本说明的 deferred 为 `PROVIDER_DEFERRED_NOT_ALLOWED`。

### 7.3 waiver

- 只适用于 accepted Evidence 中原始状态为 `failed` 且 Manifest rule catalog 明确 `waivable` 的规则。
- 由 Core 创建，必须绑定 human `approval_ref`、scope、Evidence ID、精确 Rule ID、reason、issued/expiry 和 rerun deadline。
- 不得豁免控制面所有权、schema/digest/lock/source integrity、trust/revocation、sandbox/permission、Result 合法性、缺失/stale/expired/revoked Evidence、error/cancelled/deferred。
- 有任一实际 waiver 的通过状态只能是 `passed_with_waiver`，不能降格为 `passed`。
- Provider Result/报告中的“忽略”“waived”“approved”等文本没有治理效力。

## 8. Git Source Policy v1

### 8.1 来源与 URL

- 生产只允许项目 policy 放行的 `https` 或 `ssh` 来源；拒绝 `http`、`git`、`ftp`。
- URL 不得内嵌密码/token；SSH 用户名不是凭据载荷，但 host key 与组织路径仍必须校验。
- host/组织 allowlist 由项目 policy 决定并进入 policy digest。
- `file` 仅用于本地、隔离的测试 fixture；生产配置不能通过相对路径或本地绝对路径绕过来源 policy。

### 8.2 add/update 与锁定

1. 仅在显式 `provider add` 或 `provider update --ref` 时解析 ref；
2. 把 branch/tag/default ref 解析成完整 immutable commit OID，并记录 Git object format；
3. 记录 commit tree OID、规范化 subdir（仓库根为 `null`）和 Manifest/ruleset/entrypoint/provider-lock/SBOM/config digest；
4. 后续 resolve/run 只读 lock，不查询 branch/tag HEAD；
5. 使用 detached cache/materialization；cache 恢复必须重新验证全部 OID/digest；
6. update 生成新 lock，关联旧 lock 的 Plan/Gate 失效，历史 Evidence 只保留审计用途。

### 8.3 安装期安全

- 使用 Core 创建的干净 Git repository/cache 与隔离 Git config；禁用 system/global config、`core.hooksPath`、credential 向 Provider 泄漏和 fsmonitor。
- 不初始化/递归 submodule，不执行 LFS smudge，不加载用户 custom filter。
- 不执行 `provider.yaml` entrypoint、Git hook、package manager、build/install/postinstall、脚本或二进制。
- Manifest、catalog、lock、SBOM 通过 Git object/plumbing 或安全 materialization 只读获取；拒绝 symlink/junction/reparse 越界。
- 安装失败不留下可被 Resolver 当作 current 的半写配置/lock；Core 原子发布。

### 8.4 trust 与撤销

| 场景 | 最低要求 |
|---|---|
| development、非 protected gate | 可使用 `untrusted-development`，但需显式批准并绑定 lock digest，且必须 `restricted-v1`。 |
| protected gate | verified signed commit/tag 或项目 allowlisted commit + 当前 Conformance；unsigned/untrusted 不可用。 |
| 任意 revoked 来源 | 无条件阻断；相关 Evidence/Gate 失效，不能 waiver/fallback 到同一撤销来源。 |

Git 凭据仅供 Core fetch 使用，绝不进入 Request、Provider 环境、Result、Evidence 或日志。

## 9. `restricted-v1` Runner 安全基线

`restricted-v1` 是可验证的最低能力，不是“尽力隔离”。当前 OS 若无法落实必要边界，Runner 返回 `PROVIDER_SANDBOX_UNAVAILABLE` 并阻断。

| 面 | v1 要求 |
|---|---|
| 身份 | 非特权进程；不得提升权限或访问 Core token。 |
| Provider bundle | 仅 lock commit 的只读 materialization；entrypoint 必须匹配 lock digest。 |
| 输入 | 只挂载 Request 中逐项声明且校验 digest 的只读路径；项目根默认不可见。 |
| 输出 | 唯一可写根为 sandbox `output/` 与 `tmp/`；Provider Result 引用相对 `reports/`；最终 Evidence/Gate 路径不可写。 |
| 路径 | 解析后复核 containment；拒绝 symlink、hardlink、junction、mount/reparse escape 与 TOCTOU 替换。 |
| 命令 | 结构化 executable + argv，`shell=false`；不接受命令字符串、pipe、redirect 或 shell builtin。 |
| 子进程 | 如 capability 允许，整棵进程树继承同一 sandbox、网络与资源限制；PID 有限。 |
| 网络 | 默认 deny；首发 Manifest `requested_permissions.network` 只能为 `denied`。无法强制 deny 时阻断。 |
| 环境 | 不继承宿主环境；仅传 Core allowlist；HOME 指向临时目录；禁止 secret/Git credential/cloud token。 |
| 资源 | Plan 必须给有限 wall-time、memory、process-count、output 和 temp-storage；默认分别 300s、512MiB、32、32MiB、512MiB。提高需受项目 policy 明确批准并进入 digest。 |
| 日志 | 有大小上限，Runner 脱敏；日志不是 Evidence，也不能携带凭据。 |
| 发布 | Runner 先关闭进程、验证唯一 Result/报告、重算摘要与 digest，再原子发布 Evidence；失败时不发布 accepted Evidence。 |

远程 Runner 不属于 `restricted-v1` 首发实现。未来 transport 必须使用新版本契约/mTLS，远端不持有 Core 控制面凭据，且最终 Evidence 仍由本地受信任 Runner/Core 签发。

## 10. Provider 与受限 Extension 权限对比

| 能力 | Restricted Extension | Git Provider | Core |
|---|---:|---:|---:|
| 执行代码 | 否 | 是，仅 `restricted-v1` | 是 |
| 读取业务项目 | 否 | 仅 Request 授权的只读输入 | 是 |
| 写结构化执行结果 | 否 | 仅 invocation Result | 是 |
| 写说明内容 | Core 复制 namespaced Markdown | 仅 invocation 声明报告 | 是 |
| 激活/修改 canonical stage graph | 否 | 否 | 是 |
| 写 state/audit | 否 | 否 | 是 |
| 签发 accepted Evidence | 否 | 否 | Controlled Runner |
| 签发 GateDecision | 否 | 否 | 是 |
| approval/report | 否 | 否 | owning conductor / 人工 |
| merge/push | 否 | 否 | 仍属人工边界 |

`aidlc-extension.ts` 的 blocked fields、advisory sensor 和 non-authoritative projection 语义保持不变。Provider 的引入不得复用 Extension 名义扩大其权限，也不得把 Provider Result 伪装成 Extension sensor 绕过 Runner。

## 11. 不变量与测试清单

`aidlc-provider-types.ts` 以 `PCORE-001`～`PCORE-015` 暴露同一清单；首发实现和 Provider Conformance 必须把以下项目变成正/负 fixture：

| ID | 不变量 | 最小负向测试 |
|---|---|---|
| `PCORE-001` | 仅 Core/owning conductor 写 state/audit/approval/report。 | Provider 尝试写控制面被 sandbox 阻断且无状态变化。 |
| `PCORE-002` | Provider 只写 Result/临时报告。 | 越出 `output/`、多 Result、报告路径逃逸均失败。 |
| `PCORE-003` | 仅 Runner 签发 accepted Evidence。 | 手写/Provider 自报 Evidence、签名或 summary 被拒绝。 |
| `PCORE-004` | 仅 Core 签发 Gate，report 绑定当前 stage/scope/Plan/Gate。 | 错 scope/Plan/revision/签名或缺 Gate 不能 report。 |
| `PCORE-005` | 运行只用 lock commit/digest。 | branch 前移后旧实例仍用原 commit；cache 篡改失败。 |
| `PCORE-006` | 安装不执行 Provider/Git/package 脚本。 | 恶意 hook/submodule/LFS/filter/postinstall fixture 零执行。 |
| `PCORE-007` | `restricted-v1` 不可降级。 | OS 网络/权限隔离 probe 失败时 invocation blocked。 |
| `PCORE-008` | Provider 级 N/A 只属 Core selector。 | Result `status=not_applicable` 拒绝；rule N/A 必须有理由。 |
| `PCORE-009` | fallback 不掩盖规则/完整性/安全失败。 | `CHECK_FAILED`、invalid Result、path escape、revoked 不切换。 |
| `PCORE-010` | waiver 只由人工批准的 Core Gate 产生。 | Provider `waived/approval_ref`、过期/错 scope waiver 被拒绝。 |
| `PCORE-011` | 未知字段/版本 fail-closed，只有 namespaced extensions 开放。 | 顶层额外字段、错误 namespace、未知 discriminator 拒绝。 |
| `PCORE-012` | lock/config/Profile/policy/rules/revision 变化使 Evidence/Gate 失效。 | 每种 digest 单独改变均得到 stale/new Gate。 |
| `PCORE-013` | Restricted Extension 仍 advisory-only。 | `tests/test_restricted_extension.ts` 持续通过并拒绝 blocked fields。 |
| `PCORE-014` | deferred 不能直接通过。 | 无 deadline、无限续期或 deferred→passed/waiver 均阻断。 |
| `PCORE-015` | Knowledge Receipt 只证明锁定知识已加载，不满足质量 Gate。 | 把 receipt 当 Evidence 或 capability 通过依据时 Schema/Gate 拒绝。 |

补充协议测试：

- ownership manifest 与 TypeScript catalog 逐字段一致、无重复 discriminator/`$id`/path；
- 五层状态转换只允许本文边；所有终态重试生成新 ID；
- Provider Result 禁止 Core 字段、自报 `waived` 和非 `reports/` 路径；`deferred` 必须绑定 reason/retry/deadline，`passed` 不得含 failed check，rule N/A 必须含适用性理由；
- diagnostics code 唯一且 emitter/effect 固定；
- Git production/test 协议隔离，protected gate 拒绝 untrusted/revoked；
- Runner 默认无网络、无 shell、无环境继承、无最终 Evidence/state 写权限。

Core 基线测试入口：`tests/test_provider_core_contract.ts`。Extension 权限回归入口：`tests/test_restricted_extension.ts`。

## 12. 变更治理与下游消费

P0 人工评审通过后：

1. `loeyae-aidlc-provider` 的 MARS-155 直接读取 `provider-schema-ownership.json`，按其 canonical path 实现 Provider-owned Schema；SDK wire types 必须与 `aidlc-provider-types.ts` 对应字段一致，尤其不得给 Result 暴露 Evidence/Gate/waiver API。
2. Core 后续任务在 `core/tools/data/provider-schemas/` 实现 Core-owned Schema，并以锁定 fixture/digest 提供给 Provider Conformance；不得在 Provider 仓库另建第二权威版本。
3. P2/P3 只能实现本文语义。任何发现的字段或状态缺口先提出新协议版本，不得在 `v1.1` 下静默改变 enum、所有权、fallback/waiver 或 sandbox 行为。
4. Schema reader 必须先校验精确 discriminator 和 ownership，再做完整 Schema 校验；未知 minor 也 fail-closed。
5. 评审未通过前本文保持“冻结候选”；通过后只允许无语义勘误，语义变化升级版本并增加双版本 fixture。
