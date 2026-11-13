---
name: aidlc-delivery-config-generation
description: "按实际部署目标生成或调整必要的运行与交付配置，复用已有配置。"
triggers: 交付配置, 部署配置生成, 发布配置, deployment config, 生成部署文件
---

# delivery-config-generation

从项目读取现有构建、启动方式和部署配置；新项目没有旧配置是正常情况。仅澄清本次确实需要的目标环境、端口、运行制品和敏感配置来源。

只生成目标需要的文件：例如选定容器方案才写 Dockerfile，不同时产出不使用的 Compose、Kubernetes 和多套 CI 模板。已有 CI/部署文件优先增量修改。配置生成与静态校验可在授权范围内直接做，实际发布按用户授权处理。

检查语法、引用、启动命令、权限和密钥处理；把结果写入既有交付说明或对话，不额外生成阶段计划。

默认由宿主执行，结果和必要业务文档是工作依据；共享边界见 [宿主执行协议](../../knowledge/protocols/host-execution.md)。
