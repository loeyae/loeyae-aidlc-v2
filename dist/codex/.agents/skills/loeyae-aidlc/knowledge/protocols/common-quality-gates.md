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

## 阶段质量

- `requires`、`condition`、`consumes`、`produces` 和 sensor 必须全部满足。
- instruction-only 阶段完成时传入 `--instruction-ack <stage>`。
- `application-design` 与 `operations` 需要用户在审阅影响、产物、review、构建和测试状态后显式提交 `--user-input Approve`。
- Code review 必须覆盖实际改动路径，且 spec/standards 两轴通过、无未解决关键/重要问题；有明确严重度统计的开放建议不阻断。
- Build/test evidence 按适用性记录真实构建、检查和测试；业务行为需要非零成功测试且无失败，可信无行为范围允许成功确定性检查及零测试数。
- Worktree merge plan 必须覆盖分支、base/head、review 及改动路径，且永远只提供建议，人工执行 merge。

## 结果格式

```markdown
## 质量门禁结果
| 检查项 | 状态 | 证据/依据 |
| --- | --- | --- |
| {检查项} | 通过/失败/不适用/未验证 | {命令、文件或理由} |

结论：通过 / 阻断
```

## 验证适用性与历史观察复验

C8 普通行为变更仍需受控 build、test、check 和真实非零通过测试。
无可执行业务行为的单元可由可信 I13 not_applicable 或空 UC-D 子集的已批准 ucd_exemption 证明适用性；producer 和门禁重新检查 I13 来源/单元声明。
此时只要求实际成功的确定性 check；不存在的 build/test 不必新增，测试统计如实为零。空声明、全 skipped、来源不匹配不能放行。

RED、GREEN、BASELINE、build/test、test-quality、I13 和代码审查属于绑定来源的历史观察，纯时间经过不要求重做；未来/畸形时间仍拒绝，来源、命令、scope、实例和基线世代仍须通过门禁。
其他外部/时效性证据保留 24h 默认窗口；可在阶段命令配置中声明 freshness: { kind: external, max_age_ms: N, reason: 原因 } 收紧窗口，producer 将其写入证据，门禁核对配置绑定。Attestation 的显式 max_evidence_age_ms 继续作为收紧限制。
调度的 verify 表示重新核对门禁，不表示免检通过；新实例、输入/命令漂移、缺失或无效证据需要 revalidate。

无行为替代检查可复用先前成功观察，绑定工作流、模块/单元、源码摘要、I13/单元声明、命令摘要/cwd、环境和基线世代；后续证据用 reused_from 指向原 observation_id。
仅相同命令文字不足以复用。输入变化或检查修改输入均重新执行；业务 RED 与 GREEN 仍独立执行。
