# 审计日志规范

**审计日志分段化**（参见 `common-token-management.md` 策略 B）

---

## 文件结构

- `docs/aidlc/audit-summary.md` — 项目级极简时间线（每次恢复按需加载，控制在 ~2KB）
- `<directive.artifact_root>/audit.md` — 当前 stage instance 的完整审计：
  - module axis：`docs/aidlc/modules/{module-id}/inception/audit.md`
  - unit axis：`docs/aidlc/modules/{module-id}/construction/{unit-id}/audit.md`
  - project axis：当前阶段项目目录下的 `audit.md`

审计条目必须记录 `stage_instance`，并在适用时同时记录 `module_id`、`unit_id`。不得把一个模块或单元的审计写入另一个上下文。

---

## 写入规则

- **当前阶段的审计**：写入对应的分段文件
- **审计摘要**：每次阶段转换或关键决策时，追加一行到 `audit-summary.md`
- **恢复时**：只加载 `audit-summary.md`，不加载历史分段
- **需要历史时**：按需读取特定分段文件

---

## 记录要求

- **必须**：在对应分段文件中记录每个用户输入（提示、问题、响应）并附时间戳
- **必须**：捕获用户的完整原始输入（不要总结）
- **必须**：在询问用户之前记录每个批准提示并附时间戳
- **必须**：收到用户响应后记录并附时间戳
- **关键**：始终追加编辑审计文件，不要使用完全覆盖其内容的工具和命令
- 使用 ISO 8601 格式的时间戳（YYYY-MM-DDTHH:MM:SSZ）
- 每个条目包含阶段上下文

---

## audit-summary.md 格式

```markdown
# 审计摘要

## 项目时间线
| 时间 | 阶段/步骤 | 关键事件 |
|------|-----------|----------|
| [ISO时间] | [步骤名] | [一句话描述关键决策或事件] |
```

---

## 分段审计日志格式

```markdown
## [阶段名称或交互类型]
**时间戳**: [ISO 时间戳]
**用户输入**: "[完整原始用户输入 - 不要总结]"
**AI 响应**: "[AI 的响应或采取的行动]"
**上下文**: [阶段、行动或做出的决定]

---
```

---

## 审计文件的正确工具使用

✅ 正确：
1. 读取对应分段的审计文件
2. 追加/编辑文件以进行更改

❌ 错误：
1. 读取审计文件
2. 用读取的内容加上新更改完全覆盖文件

---

## 向后兼容

如果检测到旧格式的单一 `audit.md` 文件，继续使用它（不强制迁移）。新项目默认使用分段格式。

---

## core-workflow 中的审计指令说明

core-workflow.md 中所有“在 audit.md 中记录”的指令，实际写入当前 directive 返回的 `<artifact_root>/audit.md`，并同步更新 `docs/aidlc/audit-summary.md`。旧签名 legacy-global 工作流若已存在旧分段审计文件，可继续追加，但不得在新 `module-unit-v1` 工作流中创建旧全局 Inception/Construction 审计路径。
