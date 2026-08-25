---
name: aidlc-delivery-config-generation
description: "基于确认的部署决策生成与目标环境匹配的交付配置文件；不负责部署审批和阶段路由。"
---

# 交付配置生成能力

开始时宣布："使用 aidlc-delivery-config-generation 生成交付配置"。

## 输入

调用方必须提供：

- 确认的部署决策（目标、环境、CI/CD、容器、网络参数）；
- 运行制品信息和启动方式；
- 项目技术栈和构建方式；
- 已有部署/CI 配置（存量优先）。

缺少必要输入时返回 `NEEDS_CONTEXT`。

## 加载

1. 发布包中的 `stages/operation/operations.md`（步骤 3）；
2. 发布包中的 `stages/operation/operations-templates.md`。

## 输出

返回生成的配置文件路径（Dockerfile、docker-compose、k8s manifests、CI pipeline 等）和验证结果。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 代替用户的部署审批（本阶段保留 `approval: block`，审批由编排层负责）；
- 放行质量门禁；
- 无依据替换现有部署配置；
- 宣布 Operations 完成；
- 伪造 evidence。
