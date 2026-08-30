---
name: aidlc-application-design
description: "识别主要功能组件、接口和应用服务并生成架构设计产物；不负责架构审批和阶段路由。"
triggers: 架构设计, 应用设计, 组件设计, 服务设计, 应用服务设计, 系统分层
---

# 应用设计能力

开始时宣布："使用 aidlc-application-design 执行应用设计"。

## 输入

调用方必须提供：

- 已批准的需求和用户故事路径；
- 设计范围和复杂度判定；
- 已有架构约束（技术栈、部署边界等）。

缺少必要输入时返回 `NEEDS_CONTEXT`。

## 加载

加载发布包中的 `stages/inception/inception-application-design.md`。图表需求通过调用 `aidlc-diagram-design` 执行。

## 输出

返回组件列表、组件方法、应用服务、组件依赖和架构设计文档路径。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 代替用户的架构审批（本阶段保留 `approval: block`，但审批由编排层负责）；
- 放行质量门禁；
- 宣布阶段完成；
- 伪造 diagram-contract evidence。
