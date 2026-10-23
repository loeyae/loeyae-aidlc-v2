# 质量门禁

## 原则

1. 只执行当前阶段和已触发风险需要的检查。
2. 每项检查记录通过、失败、不适用或未验证及其证据。
3. 必需检查失败或未验证时，必须修复后重跑受影响范围。
4. 不得用 Agent 叙述替代构建、测试、review 或 sensor 证据。
5. 工作流控制面是 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md`；平台 Hook 只观察状态，不能推进阶段或伪造 Evidence。

## Evidence

Evidence 路径由当前 directive 的 `evidence_root` 决定：

- 项目级：`.aidlc/evidence/<stage>/<sensor>.json`
- 模块级：`.aidlc/evidence/<stage>/<module>/<sensor>.json`
- 单元级：`.aidlc/evidence/<stage>/<module>/<unit>/<sensor>.json`

每个 Evidence 必须是合法 JSON，包含：

- `evidence_version: "1"`；
- 满足该证据语义新鲜度策略的合法 `timestamp`；
- 受控 producer 与执行 ID；
- 当前 `source_revision.commit`、`dirty` 与 `worktree_digest`；
- 对应 sensor 的结果字段；
- 语义检查时的内置 checker 信息，或构建/测试/静态检查的真实命令结果。

使用 `loeyae-aidlc evidence run` 生成 Evidence。Producer 只执行项目命令清单中受允许的 build、test、check 命令（清单按 `--config` 显式指定 → `.aidlc/commands/<stage>.json` → `.aidlc/evidence-commands.json` 查找；RED/GREEN/BASELINE 与 C8 只按 `.aidlc/commands/<stage>.json` → `.aidlc/evidence-commands.json` 查找，显式 `--config` 仅在指向同一文件时被接受，否则 producer 拒绝），采用无 shell 执行、路径边界、原子写入和输出脱敏。
选择性证据失效（MARS-271）：语义 sensor 证据记录 stage `consumes` 工件的输入指纹（`inputs.digest`）；`evidence run --refresh --instance <id>` 对输入指纹、执行上下文与受控状态均未变化的证据直接复用（`action: reused`），只有 diff 触及的 artifact 的直接依赖证据重跑（`action: regenerated`，输出 `inputs_changed` 失效范围）。RED/GREEN/BASELINE 相位证据不走该路径。

## 阶段质量

- `requires`、`condition`、`consumes`、`produces` 和 sensor 必须全部满足。
- instruction-only 阶段完成时传入 `--instruction-ack <stage>`。
- `application-design` 与 `operations-authorization` 等阶段图 `approval: block` 节点需要用户在审阅影响、产物、review、构建和测试状态后显式提交 `--user-input Approve`；`user-stories`、`units-generation`、`infrastructure-design` 和 `code-generation` 的 `notify` 覆盖规划、生成模板及完成标准，展示摘要后复用既有授权；用户显式要求审阅时等待。普通文档不得将 notify 升级为 block。
- 审批策略分级（MARS-271）：模块可在 module-manifest 的 `approval_overrides` 中按阶段 slug 覆盖审批层级（`block`/`confirm`/`notify`）。引擎级 `block` 阶段（契约/架构决策）禁止降级，只允许维持或加强；`notify` 层级阶段完成后产物自动登记进事后抽审台账（`orchestrate audit --list`），抽审发现经 `orchestrate audit --instance <id> --finding <text> --follow-up <CL|修订>` 回写，notify 类产物不中断推进。
- Code review 必须覆盖实际改动路径，且 spec/standards 两轴通过、无未解决关键/重要问题；有明确严重度统计的开放建议不阻断。
- Build/test evidence 按适用性记录真实构建、检查和测试；业务行为需要非零成功测试且无失败，可信无行为范围允许成功确定性检查及零测试数。
- Worktree merge plan 必须覆盖分支、base/head、review 及改动路径，且永远只提供建议；宿主按项目分支策略、受保护分支流程及用户明确授权决定执行者与整合。设计审批不构成 main 写入、push 或合并授权。

## 结果格式

```markdown
## 质量门禁结果
| 检查项 | 状态 | 证据/依据 |
| --- | --- | --- |
| {检查项} | 通过/失败/不适用/未验证 | {命令、文件或理由} |

结论：通过 / 阻断
```

## 验证适用性与历史观察复验

C8 普通行为变更要求实际适用的受控 build/check，以及真实非零通过且零失败的 test。按 `common-c8-role-applicability.md` 复核模块级来源和已批准项目政策；无声明默认要求 build/check，不用三角色配额制造重复检查。业务测试不能被角色不适用声明豁免。
无可执行业务行为的单元可由可信 I13 not_applicable 或空 UC-D 子集的已批准 ucd_exemption 证明适用性；producer 和门禁重新检查 I13 来源/单元声明。
I13 的覆盖与悬空校验在聚合层执行（MARS-273）：`_index.md` 的 `source_coverage` 声明每来源至少映射一个 UC-D，悬空引用记 `DANGLING_REF@source_coverage` 拦截；`ucd_sources` 以文件级 digest + UC-D ID 清单对账，旧逐条 file+SHA-256 形态继续兼容，存量证据零迁移。
此时只要求实际成功的确定性 check；不存在的 build/test 不必新增，测试统计如实为零。空声明、全 skipped、来源不匹配不能放行。

RED、GREEN、BASELINE、build/test、test-quality、I13 和代码审查属于绑定来源的历史观察，纯时间经过不要求重做；未来/畸形时间仍拒绝，来源、命令、scope、实例和基线世代仍须通过门禁。
确定性文档/源码 sensor 同样以内容绑定为准：frontend-platform-spec、template-completeness、document-slice-consistency、contract-baseline、functional-design-completeness、nfr-coverage、infrastructure-completeness、implementation-report、prd-completeness、diagram-contract、design-intent-coverage、ui-design-alignment、ui-artifact-consistency、inception-consistency、traceability-matrix、structural-invariants，以及七个 quality sensor 都读取本地受控输入/观察，不因纯时间失效。图表/外部 UI 的本地契约复核不授予远端 Provider 或凭据新的有效期。
recovery-evidence 涉及当前会话恢复状态，保留 24h；未知 sensor、外部/环境/凭据观察继续保守保留 24h。Provider、宿主知识确认的独立时效契约不变。外部依赖可在阶段命令配置中声明 freshness: { kind: external, max_age_ms: N, reason: 原因 } 收紧窗口，producer 将其写入证据，门禁核对配置绑定。Attestation 的显式 max_evidence_age_ms 继续作为收紧限制；producer、reuse planner、主门禁和 attestation 共用语义时间策略。
调度的 verify 表示重新核对门禁，不表示免检通过；新实例、输入/命令漂移、缺失或无效证据需要 revalidate。
新 producer 的语义 checker 记录 `command_version: 2` 并核对完整执行命令摘要；旧记录保留既有身份、摘要格式及来源门禁，迁移到新安装路径或新映射语义时重新生成。未来/畸形时间、身份/provenance、输入来源、命令和世代失配不能因取消纯时间失效而放行。

无行为替代检查可复用先前成功观察，绑定工作流、模块/单元、输入摘要、I13/单元声明、命令摘要/cwd、环境和基线世代；后续证据用 reused_from 指向原 observation_id。
存在模块所有权清单时复用现有 `evidenceScopeForInstance`：模块 paths、contract_paths、单元 `evidence_inputs.paths/shared_paths/depends_on_units` 及传递依赖定义范围；未分类文件、根 lockfile 和共享输入仍绑定。只排除明确属于无关模块/单元的私有文件。无清单时显式记录 `conservative-worktree` 全范围回退，不根据命令文字猜测依赖。范围声明本身参与摘要，基线世代仍单独绑定；不使用全仓 dirty 标志或全仓摘要覆盖已验证范围。
命令清单每条 check 可声明 `evidence_inputs: { environment: ["CONFIG_MODE", "API_ENDPOINT"] }`，表示完整的相关环境契约；执行器始终额外绑定 PATH/PATHEXT、SystemRoot/ComSpec、NODE_OPTIONS/NODE_PATH 和 Node 可执行文件/版本。未声明时保守绑定全部环境（仅显式会话发布令牌不参与计算）。声明为空数组表示命令无其他环境依赖，不能作为省略已知相关变量的捷径。值只保存摘要；新增/删除/变更声明和相关变量会重跑。输入共享依赖未知时应保留全范围，不得静默缩窄。
仅相同命令文字不足以复用。输入变化或检查修改输入均重新执行；业务 RED 与 GREEN 仍独立执行。
