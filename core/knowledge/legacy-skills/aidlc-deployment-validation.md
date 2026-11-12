# 显式旧受管模式参考

仅在用户明确选择维护旧受管流程或受控 Provider 契约时阅读；默认能力不加载此文件。以下历史规则不覆盖默认宿主协议。


# 部署准备验证能力

开始时宣布："使用 aidlc-deployment-validation 验证部署配置"。

## 资源路径

共享资源路径以本 `SKILL.md` 所在目录为基准：`../..` 是发布包根目录，包含 `knowledge/`、`stages/` 等目录。下文链接中的 `../../` 必须保留，不按项目工作目录解析，也不改写为本技能的 `references/`。

读取前确认目标文件存在；缺失时报告解析后的绝对路径并返回 `NEEDS_CONTEXT`。

## 输入

调用方必须提供：

- 待验证的配置文件路径列表；
- 部署目标类型和环境；
- 验证范围（语法、引用完整性、安全基线）。

缺少必要输入时返回 `NEEDS_CONTEXT`。

## 加载

加载发布包中的 [stages/operation/operations-authorization.md](../../stages/operation/operations-authorization.md)（步骤 2 验证配置及步骤 4 质量门禁）。

## 输出

返回每个配置文件的验证结果（语法、引用完整性、安全基线）和未解决问题。

## 禁止事项

不得：

- 执行实际部署；
- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 宣布 Operations 完成；
- 伪造 evidence。
