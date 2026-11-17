---
name: aidlc-deployment-validation
description: "检查指定交付配置的语法、引用、安全边界及实际可执行性，不默认执行部署。"
triggers: 部署配置验证, 交付配置校验, 发布配置检查, deployment validation, 部署可执行性检查
---

# 部署配置验证

未加载时先读[共用规则](../../knowledge/protocols/host-execution.md)，已加载则复用。

按实际环境约束使用项目解析器、校验器或 dry-run，检查制品路径、端口、依赖、变量、权限与密钥暴露；涉及契约或安全细节时读[工程检查](../../knowledge/protocols/engineering-checks.md)。

复用适用检查结果。缺集群、凭据或外部环境时继续本地检查并列明未验证项；分别报告静态有效、运行成功和实际部署，部署须有具体授权。
