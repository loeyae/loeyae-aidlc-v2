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
- 合法且新鲜的 `timestamp`；
- 受控 producer 与执行 ID；
- 当前 `source_revision.commit`、`dirty` 与 `worktree_digest`；
- 对应 sensor 的结果字段；
- 语义检查时的内置 checker 信息，或构建/测试/静态检查的真实命令结果。

使用 `loeyae-aidlc evidence run` 生成 Evidence。Producer 只执行项目 `.aidlc/evidence-commands.json` 中受允许的 build、test、check 命令，采用无 shell 执行、路径边界、原子写入和输出脱敏。

## 阶段质量

- `requires`、`condition`、`consumes`、`produces` 和 sensor 必须全部满足。
- instruction-only 阶段完成时传入 `--instruction-ack <stage>`。
- `application-design` 与 `operations` 需要用户在审阅影响、产物、review、构建和测试状态后显式提交 `--user-input Approve`。
- Code review 必须覆盖实际改动路径，且 spec/standards 两轴通过、无未关闭问题。
- Build/test evidence 必须包含成功构建、通过的检查和至少一个成功测试；测试不能有失败。
- Worktree merge plan 必须覆盖分支、base/head、review 及改动路径，且永远只提供建议，人工执行 merge。

## 结果格式

```markdown
## 质量门禁结果
| 检查项 | 状态 | 证据/依据 |
| --- | --- | --- |
| {检查项} | 通过/失败/不适用/未验证 | {命令、文件或理由} |

结论：通过 / 阻断
```
