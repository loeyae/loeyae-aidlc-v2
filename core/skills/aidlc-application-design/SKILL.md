---
name: aidlc-application-design
description: "梳理本次变更的组件、接口、数据和约束，按需要更新现有应用设计。"
triggers: 架构设计, 应用设计, 组件设计, 服务设计, 应用服务设计, 系统分层
---

# 应用设计

未加载时先读[共用规则](../../knowledge/protocols/host-execution.md)，已加载则复用。

从已确认范围、现有代码和设计确定本次变化的组件职责、接口、数据流及依赖；补充相关 NFR 和基础设施约束，复用已有方案。

影响业务或契约的关键未知按[定向澄清](../../knowledge/protocols/design-clarification.md)处理；涉及接口、数据、安全或配置时查[工程检查](../../knowledge/protocols/engineering-checks.md)。重大新架构取舍需用户决定，可逆细节自主选择。

更新原设计；简单变化在任务说明解释即可，图示有助理解时优先 Mermaid。
