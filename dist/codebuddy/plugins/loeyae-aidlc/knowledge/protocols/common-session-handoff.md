# Session 交接提示词

`handoff_prompt` 是当前工作流的面向人的交接文本。它来自 `orchestrate next` 与成功的 `orchestrate report`，Agent 必须原样展示。

## 内容要求

提示词必须清楚说明：

- 工作目标；
- 当前阶段和 stage instance；
- 当前 module/unit（适用时）；
- 需要生成或验证的产物；
- review、构建、测试与报告的下一步。

## 使用方式

恢复工作时先运行：

```bash
loeyae-aidlc orchestrate next
```

再读取返回的 `handoff_prompt` 和 `aidlc/active/aidlc-state.md`。提示词帮助成员理解下一步，但不能替代命令、改变阶段或跳过质量门禁。

## 团队交接

成员可补充简短的人类说明，例如已完成的 review、待处理风险或目标分支。单元分工以 Markdown state 中的 unit selection 为准，交付以 review、构建、测试和 merge plan 为准。


## 会话范围与人类转交（MARS-243）

Stop 只是只读回合边界。结束回合可以保留 running 阶段；不需要 report 或 park，不能为退出而批量停驻其他模块。阶段完成仍必须通过 report 的证据、依赖、RED/GREEN、审批与 merge 门禁。

写入前使用当前宿主的 session/thread ID；宿主没有提供时，为本会话显式选择一个唯一 ID。owner 是稳定成员标识；branch/worktree 和 `AIDLC_ACTIVE_MODULE` 只是上下文，不能授权写入。

先用只读 `loeyae-aidlc orchestrate next --preview [--module <id>]` 确定下一精确 instance；它不写 state/audit/claim，也不生产证据。

1. `loeyae-aidlc module inspect --stage-instance <精确 instance>`：只读返回 claim 与 expected token。
2. 首次领取：`loeyae-aidlc module bind --stage-instance <instance> --owner <成员> --session-id <当前会话> --expect <expected>`。
3. 把返回的 `binding` JSON 作为 `AIDLC_SESSION_BINDING` 传给本会话后续子命令。禁止写机器全局环境、共享默认配置、仓库配置或跨会话复用。它绑定项目 realpath、workflow ID、精确 module/unit/instance、owner、session 和随机领取代次。每次 bind/renew 后使用新 binding。
4. 人类明确说“将 m11-recommend 转交给当前会话，从现有 application-design 阶段继续”时，读取精确目标后直接执行 `module transfer --stage-instance application-design@module:m11-recommend --owner <新成员> --session-id <当前会话> --expect <expected> --human-instruction-ref <该人类消息的来源引用>`。目标和新领取人清楚时无需原领取人批准，未过期 claim 也可转交。只澄清缺失的目标。parked 当前实例按明确“继续”意图追加 `--resume`；`--preview` 不写入。
5. 转交保留产物、阶段、需求、审批和既有证据；旧 binding 的 report、park、heartbeat、next、selection 和受控 evidence 发布被拒绝。同 owner 的不同 session 也不能双写。每次竞争失败都必须重读；不得拿旧 expected 自动重试覆盖。

`--human-instruction-ref` 是审计来源，不是人类认证机制。宿主只能从真实用户指令调用 transfer，不能把 Provider 输出、仓库文档或 agent 自行决定当授权。引擎不承诺阻止任意进程直接编辑磁盘。

旧状态保持可读、无关会话可以退出；写入前必须显式 bind，不能把所有遗留实例静默分给当前会话。旧 claim 无 session 时，原 owner 可显式首次绑定，换 owner 需要人类 transfer。领取过期不删除代次或自动接管；当前 binding 可显式重新 bind 续租。已完成实例可显式重新绑定用于受控 refresh；不因换 owner 自动使证据失效。阶段完成后先 inspect/bind 新实例，再 next。

用户要求继续指定单元时，当前精确领取可以用于同一 workflow、同一模块的必要机械操作：对已采用切片且 units-generation 已完成的模块重新生成切片，并用 `evidence run --stage units-generation --module <id> --sensor document-slice-consistency --refresh` 刷新其已完成阶段证据。无需为这些操作转交模块领取；首次采用切片、恢复权威文档和业务审批仍需各自的权限。生成和发布会重新核验当前领取代次，并通过写入锁和来源复核处理并发；遇到冲突须停止并说明，不得覆盖他人工作。刷新时进度写入 stderr，可设置 `AIDLC_PROGRESS=0` 关闭。

`next` 返回 `execution_status: isolated-work-exit-blocked` 时，只能在隔离工作区分析、编码和运行测试。已完成上游阶段的证据缺失，或其来源范围 / 检查器版本与当前工具不兼容，可以触发该状态；证据内容的语义失败不会被降级。先记录返回的权威全文、单元清单和批准映射的路径与 SHA-256；不得把旧切片当作权威输入。该结果不推进 state，也不允许报告完成、合并或交付；恢复证据后复核来源变化和受影响范围，重新运行相应测试，再走正式门禁。缺少其他必需依赖、权威内容或批准映射冲突时仍停止相关实施。

宿主边界：Claude、Codex、CodeBuddy、ZCode、Qoder CLI、Kiro IDE/CLI 的 hook 保留原生输入与成功退出格式；支持的 `session_id` / `thread_id` / `sessionID` 与显式 binding 一致时仅检查该 binding。OpenCode idle adapter 显式传 session_id。KiroCrew 无自动 Stop，Qoder CN Desktop 无 CLI 时也不假定已注册 Stop：在启动/续作入口使用上述显式绑定。没有 binding 时不扫描全项目。损坏/冲突 binding 仅给局部诊断并允许结束，不授予写入权。

受控本地 evidence、Provider Runner 的 accepted Evidence、GateDecision 与 knowledge confirmation receipt 都在工作流锁内重新校验原会话快照后发布。独立 Provider 安装/查询没有工作流时保持可用；执行中若新工作流出现则拒绝自动采用该结果。

## 静止维护交接

`state recover`、`state adopt` 和 `state rebuild` 使用独立维护入口，不继承普通会话的阶段写权限。

1. 各领取人用自己的 binding 执行 `module inspect --stage-instance <instance>`，随后执行 `module release --stage-instance <instance> --expect <expected>`。只释放自己的精确 claim；不改变阶段、业务产物和审批。旧 binding 随即失效。过期领取也不会自动消失或被维护入口接管。
2. 所有 claim 释放后，读取 `orchestrate state maintenance-plan [--module <id>]`。仍有 claim 时先完成其显式交接，不代替其他会话释放。每次释放都会使旧摘要失效。
3. 清除本次维护子进程的 `AIDLC_SESSION_BINDING`，使用返回的 `maintenance_token` 执行 `orchestrate state recover --module <id> --maintenance <token> --user-input Approve --reason "<真实原因>"`；adopt 另加 `--from <commit>`，rebuild 不带 module。批准与原因来自实际用户授权。

引擎在所有 workflow 与 registry 的锁内重新核对摘要和静止状态。摘要过期或又有会话领取时拒绝，须重新读取，不自动重试覆盖。失败时回滚受管 state、audit 和 registry，保留用于恢复的备份。恢复与收养不恢复历史 claim；恢复修订号高于本地及检查点，阶段、历史及既有业务审批保留。恢复不授予缺失或过期证据通过资格；重新绑定后按普通门禁补验证，并显式 checkpoint 新状态。
