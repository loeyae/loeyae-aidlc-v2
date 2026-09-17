# 轻量工作流连续性

## 唯一状态来源

继续工作时只读取：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

`aidlc-state.md` 记录工作描述、scope、当前阶段和实例、已完成项、unit 选择与历史；`audit.md` 记录状态变化。

## 启动与继续

新工作必须携带明确工作描述：

```bash
loeyae-aidlc orchestrate next \
  --scope feature \
  --work "实现订单导出超时重试"
```

继续运行中的工作流：

```bash
loeyae-aidlc orchestrate next
```

如工作流已暂停：

```bash
loeyae-aidlc orchestrate next --resume
```

Agent 必须原样展示返回的 `handoff_prompt`。

## 团队分工与质量

成员使用 `unit list` 和 `unit select` 声明负责单元与分支。该记录只用于协作可见性。阶段推进仍以产物、review、构建、测试和 sensor 为依据；应用设计与部署决策使用 `--user-input Approve`。

## 新工作

需要处理不同目标时，不复用原工作流：由用户描述新目标后重新启动新的 Markdown workflow。