---
slug: operations
number: "4.1"
name: 部署运维
execution: CONDITIONAL
lead_agent: aidlc-operations-agent
scopes: [feature, enterprise, mvp]
requires: [implementation-report]
consumes:
  - docs/aidlc/construction/build-test-report.md
  - docs/aidlc/construction/implementation-report.md
produces:
  - docs/aidlc/operation/operations-plan.md
  - docs/aidlc/operation/deployment-config.md
  - docs/aidlc/operation/deployment-guide.md
  - docs/aidlc/operation/operations-summary.md
approval: block
sensors: [doc-cascade]
---

# Operations：部署准备

**目的**：为需要部署的项目生成与目标环境匹配的交付配置和可执行部署说明。

**边界**：本阶段止于部署准备与配置验证，不覆盖部署后的监控、告警、事故响应、运营反馈或系统退役。

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

将确认结果保存到 `docs/aidlc/operation/plans/operations-plan.md`，经用户确认后再生成配置。

## 步骤 3：生成目标相关配置

仅生成用户已选择且项目实际需要的文件；不得固定生成 Jenkins 或 Kubernetes 文件。

| 目标/能力 | 可能产物 | 生成条件 |
|-----------|----------|----------|
| 容器镜像 | `Dockerfile`、`.dockerignore` | 用户选择容器化 |
| Jenkins | `Jenkinsfile` | 用户确认使用 Jenkins |
| Kubernetes | 用户确认命名的 manifest 或 Helm/Kustomize 文件 | 用户选择 Kubernetes |
| Docker Compose | `compose.yml` | 用户选择 Compose |
| 前端 Nginx | `nginx.conf` | 静态前端且选择 Nginx |
| 数据迁移 | 迁移执行/回滚说明或现有工具配置 | 存在数据库结构变更 |
| 手动部署 | 命令说明 | 用户不使用自动化流水线 |

生成规则：

- 优先复用项目现有结构、版本和工具；模板只作为起点。
- 仅在需要 Docker/Jenkins/Kubernetes/Nginx 时加载 `operations-templates.md` 的对应章节。
- 模板中的所有占位符必须在交付前替换或明确列入部署时参数；不得保留环境专属硬编码路径。
- 密钥、Token、密码和 kubeconfig 使用 Secret、凭据系统或环境变量引用。
- 生产发布不得默认自动触发；是否需要审批、分阶段或自动发布以用户确认结果为准。

## 步骤 4：验证配置

对实际生成的文件执行适用验证：

| 文件类型 | 最低验证 |
|----------|----------|
| Dockerfile | 构建命令或可用的 Dockerfile 静态检查 |
| Jenkinsfile | Jenkins 语法检查或项目现有验证方式 |
| Kubernetes | 客户端 dry-run、schema/模板渲染验证 |
| Compose | `docker compose config` |
| Nginx | `nginx -t` 或容器内等价检查 |
| Shell/部署命令 | shell 语法检查和参数完整性检查 |

工具不可用时必须标记"未验证"，提供精确验证命令，不能声明门禁通过。验证失败时最小修复并重跑。

## 步骤 5：生成部署文档

在 `docs/aidlc/operation/` 生成：

### `deployment-guide.md`

- 制品、环境和依赖前置条件
- 配置/Secret 清单及来源
- 构建、发布、迁移、验证和回滚步骤
- 健康检查和最小 smoke test
- 每条命令的工作目录、参数和预期结果

### `operations-summary.md`

- 实际生成文件及用途
- 已确认的部署决策
- 每项配置验证的命令、结果和限制
- 未生成项及原因

## 步骤 6：质量门禁与完成

仅对实际选择的部署目标应用 `common-quality-gates.md` 对应检查项：

- [ ] 产物与已确认目标一致，无多余平台配置
- [ ] 无硬编码敏感信息或环境专属私有路径
- [ ] 健康检查、资源和回滚策略按需求配置
- [ ] 所有占位符已替换或登记为部署参数
- [ ] 适用语法/静态验证已实际执行并记录证据
- [ ] 部署指南可从已通过构建的制品开始执行
- [ ] handoff.md、审计和下一步交接已更新

本阶段为🔴强制审批。存在未验证项时必须明确展示，由用户决定补齐环境后继续或接受"部署准备未验证"状态；后者不得标记为完全通过。
