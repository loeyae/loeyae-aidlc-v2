# 显式旧受管模式参考

仅在用户明确选择维护旧受管流程或受控 Provider 契约时阅读；默认能力不加载此文件。以下历史规则不覆盖默认宿主协议。


# UI 实现桥接能力

开始时宣布："使用 aidlc-ui-implementation-bridge 执行 UI 实现桥接"。

## 资源路径

共享资源路径以本 `SKILL.md` 所在目录为基准：`../..` 是发布包根目录，包含 `knowledge/`、`stages/` 等目录。下文链接中的 `../../` 必须保留，不按项目工作目录解析，也不改写为本技能的 `references/`。

读取前确认目标文件存在；缺失时报告解析后的绝对路径并返回 `NEEDS_CONTEXT`。

## 输入

调用方必须提供：

- UI 设计产物路径（HTML Mock 或 Figma 设计稿）；
- 已批准目标平台、模块身份、实际框架与版本来源；知识引用按 `provider-offline-knowledge.md` 的显式绑定和兼容章节核验，不由跨端类型推断框架；
- 当前 directive 的 `module_id`、`unit_id` 和 `artifact_root`；
- 当前单元的 `frontend-platform-spec.md` 路径（存在时）；
- 当前工作单元范围。

缺少任一输入时返回 `NEEDS_CONTEXT`。纯 Web 项目（Vue3+ElementPlus 等纯浏览器方案）不需要本能力。

## 加载

加载发布包中的 [stages/construction/construction-ui-implementation-bridge.md](../../stages/construction/construction-ui-implementation-bridge.md)。

本能力由桥接 directive 在 RED 完成后、代码生成前调用，是本单元 spec 的创建/更新入口。Inception 提供批准事实，代码生成消费并复验；不要求前一阶段提前创建本阶段产物。

## 输出

返回生成或更新的 `docs/aidlc/modules/{module-id}/construction/{unit-id}/frontend-platform-spec.md` 路径、布局原语映射表、组件映射表、CSS 约束禁止列表和未解决问题。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 执行代码审查或代码生成；
- 宣布 Construction 阶段完成；
- 伪造 frontend-platform-spec evidence。
