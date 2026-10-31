# 实际宿主 Agent 任务评测

此任务包衡量宿主 Agent 能否按照流程完成软件工作。确定性引擎测试可以验证拒绝与放行规则，真实 Agent 试跑还需记录理解错误、反复调用及人工修订。两类结果分别记录。

使用独立临时仓库运行 [任务包](agent-task-pack.json) 中的六项任务。任务执行者根据真实项目准备可复现输入和断言，不对多个任务复用同一活动 workflow。宿主、模型、执行者数量由试跑环境决定。不要以编造日志、人工填写通过字段或本仓库脚本测试替代真实试跑。

每次试跑保存 `run.json` 及原始会话、CLI 输出、状态、审查和构建测试证据。每条 criterion 对应可核验文件。可按下列格式记录一个任务；其余任务未提供时保留 `not_evaluated`：

```json
{
  "host": "实际宿主名称及版本",
  "model": "实际使用的模型",
  "started_at": "2026-10-30T00:00:00Z",
  "finished_at": "2026-10-30T00:10:00Z",
  "tasks": [{
    "id": "local-bugfix",
    "transcript": "raw/transcript.txt",
    "interventions": 0,
    "tool_calls": 12,
    "false_passes": 0,
    "observations": [{ "criterion": "reproduction", "passed": true, "evidence": ["raw/red.log"] }]
  }]
}
```

运行 `node scripts/evaluate-agent-run.mjs <run.json>` 汇总记录。记录器核查时间、计数、任务覆盖和证据文件存在，不自行判断原始会话内容。`recorded_pass` 只表示提交的观察记录满足格式，仍需审阅证据。缺任务、缺证据及误放行均返回非零；无需设置未经测量的通过率目标。

当前状态：已提供任务和记录入口；尚无六项任务在真实宿主上的完整试跑记录，因此没有跨宿主成功率结论。

完整脚本回归运行 `npm test`。核心清单在独立 Git 副本中执行，源码分发不会被安装回归改写；结果中的 `isolated_checkout` 可用于复查候选，原始日志保存在 `AIDLC_TEST_OUTPUT` 或系统临时目录。安装生命周期、分发一致性和打包按串行屏障执行。Python 环境通过进程级 `AIDLC_TEST_PYTHON` 指定。单项命令超过 30 分钟会失败并保留输出。
