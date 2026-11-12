> 适用范围：以下强制路由、凭据和状态写入规则仅适用于显式选择的旧受管引擎。默认实施遵循 [宿主执行协议](host-execution.md)，不加载本协议作为开工或续作门禁。业务质量要求仍按任务需要使用。

# 轻量工作流连续性

## 唯一状态来源

先读取 `common-session-handoff.md` 的精确会话绑定与转交契约。单工作流的控制面为：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

`aidlc-state.md` 记录工作描述、scope、当前阶段和实例、已完成项、unit 选择与历史；`audit.md` 记录状态变化。

per-module 布局由引擎校验 registry 与目标模块身份。Agent 先运行 `orchestrate state context --module <id> [--unit <id>]`；集成工作流使用 `--integration`。不整读 state/audit、兄弟模块或历史快照，不以旧聊天记录、handoff/progress 展示文档代替当前状态。

## 启动与继续

新工作必须携带明确工作描述：

```bash
loeyae-aidlc orchestrate next \
  --scope feature \
  --work "实现订单导出超时重试"
```

继续运行中的工作流，先只读定位目标：

```bash
loeyae-aidlc orchestrate next --preview
```

复用有效的精确 binding，或按交接契约 inspect/bind/transfer 后执行 `orchestrate next`。如用户明确继续已暂停工作流：

```bash
loeyae-aidlc orchestrate next --resume
```

Agent 必须原样展示返回的 `handoff_prompt`。

“继续”保持既有工作目标、单元和批准范围。阻塞时先确定是缺真实测试、映射缺失、证据失效还是领取/状态冲突；只执行与原因对应的最小修复。相同输入和相同阻塞连续出现时转入诊断，保留已尝试动作，不重复新增测试或扩大覆盖范围。

显式自主批次额外读取 [自主批次实施协议](common-autonomous-execution.md)。受支持宿主在实际 grant/准入内连续推进 notify/none，无需逐阶段人工继续；从正式路由中按已冻结 implement 顺序调度，不重复要求用户选择已确认单元。pending 人类复核不暂停实施，真实 block/暂停/授权不足仍阻断。普通未采用 workflow 的模块选择保持由用户决定，不能从本协议推导自主授权。

## 团队分工与质量

成员使用 `unit list` 和 `unit select` 声明负责单元与分支。该记录只用于协作可见性。阶段推进仍以产物、review、构建、测试和 sensor 为依据；应用设计与部署决策使用 `--user-input Approve`。

## 新工作

需要处理不同目标时，不复用原工作流：由用户描述新目标后重新启动新的 Markdown workflow。

## 显式事实存储迁移

已有工作流可在其当前合法 binding 下执行 `orchestrate state migrate-facts [--module <id> | --integration]`。范围仅为指定工作流，不暂停兄弟模块，也不补造批准。默认不批量迁移项目。

迁移后，同目录 `aidlc-facts.json` 保存设计选择、基线、完成及历史报告；报告附带提交 ID、产物/证据文件摘要和未解析来源清单。它们证明历史记录，不证明当前候选通过。运行位置、领取和选择保存在 `.aidlc/workflow-runtime/`；Markdown 状态页成为显式投影，普通进度不再重写该页或重复追加 STATE_UPDATED。其他业务审计事件保留。

`state facts` 不需要有效领取即可读取事实；`state rebuild-view` 仅重建 Markdown。缺失/伪造 Markdown 不改变事实。事实或本地运行文件缺失时，不从旧投影推断有效授权或空领取表；读取事实可用于诊断，但必须明确对账。中断在迁移双文件发布之间也会被识别为不完整迁移，不静默恢复。

旧 Markdown 全仓 maintenance/recover 不适用于已迁移工作流，会明确拒绝以免覆盖事实；正常模块级过期领取恢复仍沿用原 expected token、明确授权、generation 和 binding 规则。迁移不会解决未知运行状态，也不会延长执行授权。新工作流和未迁移工作流暂沿用兼容格式。
