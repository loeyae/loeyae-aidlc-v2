# 显式旧受管模式参考

仅在用户明确选择维护旧受管流程或受控 Provider 契约时阅读；默认能力不加载此文件。以下历史规则不覆盖默认宿主协议。


# 交付配置生成能力

开始时宣布："使用 aidlc-delivery-config-generation 生成交付配置"。

## 资源路径

共享资源路径以本 `SKILL.md` 所在目录为基准：`../..` 是发布包根目录，包含 `knowledge/`、`stages/` 等目录。下文链接中的 `../../` 必须保留，不按项目工作目录解析，也不改写为本技能的 `references/`。

读取前确认目标文件存在；缺失时报告解析后的绝对路径并返回 `NEEDS_CONTEXT`。

## 输入

调用方必须提供：

- 确认的部署决策（目标、环境、CI/CD、容器、网络参数）；
- 运行制品信息和启动方式；
- 项目技术栈和构建方式；
- 已有部署/CI 配置（存量优先）。

缺少必要输入时返回 `NEEDS_CONTEXT`。

## 加载

1. 发布包中的 [stages/operation/operations-authorization.md](../../stages/operation/operations-authorization.md)（步骤 1 生成目标相关配置）；
2. 发布包中的 [stages/operation/operations-templates.md](../../stages/operation/operations-templates.md)。

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
