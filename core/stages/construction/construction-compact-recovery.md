---
slug: compact-recovery
number: "3.9"
name: 压缩恢复
phase: construction
execution: CONDITIONAL
lead_agent: aidlc-developer-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces: []
sensors: []
---

# Construction 上下文压缩恢复

**职责**：定义 Construction 在上下文压缩或新会话后的断点恢复。统一入口和通用规则见 `common-session-continuity.md`。

## 唯一状态源

`docs/aidlc/state.md` 是阶段、批次和单元进度的唯一事实来源。不得创建或优先读取独立 `progress.md`；单元级进度记录在 state.md 的“单元与批次进度”表中。

## 恢复步骤

1. 读取 state.md，确认当前阶段、模块、批次、单元及活跃变更请求。
2. 若当前阶段不是 Construction，返回 `common-session-continuity.md` 对应阶段路由。
3. 重新加载当前单元的需求、故事、设计、共享接口和 Construction steering。
4. 找到第一个状态不是 `complete` 的可执行单元。
5. 对 `complete` 单元检查验证证据引用；证据缺失或产物不存在时标记 `blocked`，不得推断完成。
6. 宣布恢复位置，从 `in_progress` 或首个 `pending` 单元继续。

## 平台适配

Kiro、Claude Code 和 OpenCode 均执行同一恢复步骤。平台 Hook、Workflow 或启动指令只能触发读取 state.md，不得引入第二套状态文件或覆盖 state.md。

## 恢复输出

```text
检测到未完成的 Construction 任务
阶段/模块：{stage}/{module}
进度：{completed}/{total} 单元
恢复点：{unit-id} - {step}
```

## 无法确定恢复点

- state.md 缺失：停止并询问用户是重建状态还是退出 AI-DLC。
- state.md 与产物冲突：列出冲突，标记 blocked，等待用户确认；不得根据文件存在推断测试或审查已通过。
- 活跃变更请求存在：优先恢复 CR 路由，不直接继续代码生成。
