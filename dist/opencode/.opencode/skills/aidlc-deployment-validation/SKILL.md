---
name: aidlc-deployment-validation
description: "检查指定交付配置的语法、引用、安全边界及实际可执行性，不默认执行部署。"
triggers: 部署配置验证, 交付配置校验, 发布配置检查, deployment validation, 部署可执行性检查
---

# deployment-validation

读取配置和实际环境约束，使用项目已有的解析器、校验或 dry-run。可先完成本地静态检查；缺集群、凭据或外部环境时标注哪些运行验证未做，不阻断其他检查。

检验制品路径、端口、依赖、配置变量、权限及密钥暴露。复用输入未变的真实检查结果。清楚区分静态有效、实际运行成功和已经部署，不能相互替代。实际部署必须在用户授权范围内进行。

默认由宿主执行，结果和必要业务文档是工作依据；共享边界见 [宿主执行协议](../../knowledge/protocols/host-execution.md)。


涉及接口、数据、安全或配置时按需读取 [工程检查](../../knowledge/protocols/engineering-checks.md)。
