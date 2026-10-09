---
slug: operations-planning
number: "4.1"
name: 部署规划
execution: CONDITIONAL
lead_agent: aidlc-operations-agent
scopes: [feature, enterprise, mvp]
requires: [implementation-report]
consumes:
  - docs/aidlc/construction/build-test-report.md
  - docs/aidlc/construction/implementation-report.md
produces:
  - docs/aidlc/operation/operations-plan.md
approval: notify
condition: has_deployment_needs
sensors: [doc-cascade]
---

# Operations 规划：部署需求分析与决策

**目的**：分析部署需求、与用户确认部署决策，产出一份可逆的部署规划文档。本阶段只做规划，不生成任何部署配置、不触发任何部署副作用，因此审批为 notify。

**边界**：止于规划与决策记录。目标相关配置的生成、验证与部署授权在下一阶段 `operations-authorization` 完成（🔴强制审批）。

## 前置条件

- Construction 的实际构建和测试已通过并有证据
- handoff.md 已记录技术栈、构建方式和项目类型
- 项目是可部署服务，或用户明确要求部署准备

纯库、纯本地工具或用户明确不需要部署时跳过，并在 handoff.md 记录理由。

## 步骤 1：分析部署需求

读取 handoff.md、构建配置和 Construction 证据，识别：

- 运行制品及启动方式
- 外部依赖、端口、健康检查和数据迁移
- 现有部署/CI 配置（存量配置优先，不得无依据替换）
- 待确认的部署目标、环境、镜像仓库、资源和发布策略

## 步骤 2：确认部署决策

只询问当前项目需要的关键决策，每次一个问题并给出 2-3 个选项。至少确认：

1. 目标：Kubernetes、Docker Compose、裸机/平台托管或其他。
2. 环境：需要哪些 dev/test/staging/prod 环境。
3. CI/CD：沿用现有工具、Jenkins、其他工具或只生成手动步骤。
4. 容器：是否需要镜像、仓库和标签策略。
5. 网络与运行参数：端口、域名、健康检查、资源、Secret 来源。

将确认结果保存到 `docs/aidlc/operation/operations-plan.md`。本规划文档是下一阶段生成配置的唯一授权依据。

## 步骤 3：完成规划

- [ ] 部署需求分析完整（制品、依赖、现有配置、迁移点）
- [ ] 关键部署决策已逐项与用户确认并记录
- [ ] 规划文档不含任何环境专属硬编码或密钥
- [ ] handoff.md 已记录规划结论与下一步（进入 operations-authorization 生成并授权配置）

本阶段为可逆规划，审批为 notify；规划确认后进入 `operations-authorization` 生成目标配置并执行强制审批。
