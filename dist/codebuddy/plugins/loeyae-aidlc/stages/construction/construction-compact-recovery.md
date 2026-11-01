---
slug: compact-recovery
number: "3.9"
name: 压缩恢复
phase: construction
execution: CONDITIONAL
scopes: [feature, enterprise, mvp, classic]
requires: [workspace-detection]
consumes: []
produces: [.aidlc/evidence/compact-recovery/recovery-evidence.json]
sensors: [recovery-evidence]
traceability: not_applicable
condition: context_compacted
---

# Construction 上下文压缩恢复

**职责**：定义 Construction 在上下文压缩或新会话后的断点恢复。统一入口和通用规则见 `common-session-continuity.md`。

## 状态源

按 `common-session-handoff.md` 读取当前布局的 state/audit（per-module 布局还读取 registry 和目标模块状态），验证精确 workflow、领取代次和 revision。阶段路由与完成状态以引擎为准，交接使用返回的 `handoff_prompt`。旧 `docs/aidlc/handoff.md` 仅是可选上下文；缺失或过期不阻断恢复，也不能覆盖机器状态。

## 恢复步骤

1. 使用 `orchestrate next --preview` 定位当前 workflow、阶段与模块/单元；需要概览时读取 `orchestrate state summary`。
2. 若当前阶段不是 Construction，返回 `common-session-continuity.md` 对应阶段路由。
3. 重新加载当前单元的需求、故事、设计、共享接口和 Construction steering。
4. 复用有效的精确 session binding；需要转交时遵循会话契约，不从产物自行选择或重建阶段。
5. 由当前 directive 的门禁核验所需产物与证据。存在真实缺口时按具体诊断处理，不手工修改 state，也不逐一重跑已完成单元的全部验证。
6. 运行 `orchestrate next`，展示 `handoff_prompt` 并从引擎确定的恢复点继续；明确恢复暂停实例时追加 `--resume`。

## 平台适配

Kiro、Claude Code 和 OpenCode 均执行同一恢复步骤。平台 Hook、Workflow 或启动指令只触发权威状态读取和引擎恢复，不引入第二套状态文件。

## 恢复输出

```text
检测到未完成的 Construction 任务
阶段/模块：{stage}/{module}
进度：{completed}/{total} 单元
恢复点：{unit-id} - {step}
```

## 无法确定恢复点

- state/registry 无法读取或精确领取冲突：按会话契约及引擎诊断恢复，涉及显式转交或维护授权时遵循原要求。
- 实际产物或证据缺失/失效：处理具体缺口，不得根据文件存在推断测试或审查已通过；派生摘要过期时重新读取，不升级成业务冲突。
- 活跃变更请求存在：优先恢复 CR 路由，不直接继续代码生成。
