# 审计日志规范

**审计日志分段化**（参见 `common-token-management.md` 策略 B）

---

## 文件结构

- `docs/aidlc/audit-summary.md` — 极简时间线（每次恢复必加载，控制在 ~2KB）
- `docs/aidlc/inception/audit-inception.md` — Inception 阶段完整审计
- `docs/aidlc/construction/audit-construction-{unit-name}.md` — 各单元的审计
- `docs/aidlc/operations/audit-operations.md` — Operations 阶段审计

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

core-workflow.md 中所有"在 audit.md 中记录"的指令，实际写入对应的分段文件：
- Inception 阶段 → `audit-inception.md`
- Construction 阶段 → `audit-construction-{unit-name}.md`
- Operations 阶段 → `audit-operations.md`

同时同步更新 `audit-summary.md`。
