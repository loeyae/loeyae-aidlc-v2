---
slug: operations-authorization
number: "4.2"
name: 部署授权
execution: CONDITIONAL
lead_agent: aidlc-operations-agent
scopes: [feature, enterprise, mvp]
requires: [operations-planning]
consumes:
  - docs/aidlc/operation/operations-plan.md
produces:
  - docs/aidlc/operation/deployment-config.md
  - docs/aidlc/operation/deployment-guide.md
  - docs/aidlc/operation/operations-summary.md
approval: block
condition: has_deployment_needs
sensors: [doc-cascade]
---

# Operations 授权：配置生成、验证与部署授权

**目的**：依据已确认的部署规划（`operations-plan.md`）生成目标相关配置、执行验证，并作为部署授权点（🔴强制审批）。本阶段产出的配置是不可逆部署的直接依据，因此审批为 block。

**边界**：止于部署准备、配置验证与授权，不覆盖部署后的监控、告警、事故响应、运营反馈或系统退役。

## 前置条件

- `operations-planning` 已完成，`docs/aidlc/operation/operations-plan.md` 记录了经用户确认的部署决策
- 不得在无规划授权的情况下生成配置

## 步骤 1：生成目标相关配置

仅生成规划文档中用户已选择且项目实际需要的文件；不得固定生成 Jenkins 或 Kubernetes 文件。

| 目标/能力 | 可能产物 | 生成条件 |
|-----------|----------|----------|
| 容器镜像 | `Dockerfile`、`.dockerignore` | 规划选择容器化 |
| Jenkins | `Jenkinsfile` | 规划确认使用 Jenkins |
| Kubernetes | 规划确认命名的 manifest 或 Helm/Kustomize 文件 | 规划选择 Kubernetes |
| Docker Compose | `compose.yml` | 规划选择 Compose |
| 前端 Nginx | `nginx.conf` | 静态前端且选择 Nginx |
| 数据迁移 | 迁移执行/回滚说明或现有工具配置 | 存在数据库结构变更 |
| 手动部署 | 命令说明 | 规划不使用自动化流水线 |

生成规则：

- 优先复用项目现有结构、版本和工具；模板只作为起点。
- 仅在需要 Docker/Jenkins/Kubernetes/Nginx 时加载 `operations-templates.md` 的对应章节。
- 模板中的所有占位符必须在交付前替换或明确列入部署时参数；不得保留环境专属硬编码路径。
- 密钥、Token、密码和 kubeconfig 使用 Secret、凭据系统或环境变量引用。
- 生产发布不得默认自动触发；是否需要审批、分阶段或自动发布以规划确认结果为准。

配置写入 `docs/aidlc/operation/deployment-config.md`（或规划指定的具体文件）。

## 步骤 2：验证配置

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

## 步骤 3：生成部署文档

在 `docs/aidlc/operation/` 生成：

### `deployment-guide.md`

- 制品、环境和依赖前置条件
- 配置/Secret 清单及来源
- 构建、发布、迁移、验证和回滚步骤
- 健康检查和最小 smoke test
- 每条命令的工作目录、参数和预期结果

### `operations-summary.md`

- 实际生成文件及用途
- 已确认的部署决策（来自 operations-plan.md）
- 每项配置验证的命令、结果和限制
- 未生成项及原因

## 步骤 4：质量门禁与授权

仅对实际选择的部署目标应用 `common-quality-gates.md` 对应检查项：

- [ ] 产物与规划已确认目标一致，无多余平台配置
- [ ] 无硬编码敏感信息或环境专属私有路径
- [ ] 健康检查、资源和回滚策略按需求配置
- [ ] 所有占位符已替换或登记为部署参数
- [ ] 适用语法/静态验证已实际执行并记录证据
- [ ] 部署指南可从已通过构建的制品开始执行
- [ ] handoff.md、审计和下一步交接已更新

本阶段为🔴强制审批（block）。存在未验证项时必须明确展示，由用户决定补齐环境后继续或接受"部署准备未验证"状态；后者不得标记为完全通过。授权通过后方可据此执行实际部署。
