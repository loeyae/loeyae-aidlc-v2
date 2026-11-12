# 显式旧受管模式参考

仅在用户明确选择维护旧受管流程或受控 Provider 契约时阅读；默认能力不加载此文件。以下历史规则不覆盖默认宿主协议。


# 系统化调试能力

开始时宣布："使用 aidlc-systematic-debugging 执行系统化调试"。

## 资源路径

共享资源路径以本 `SKILL.md` 所在目录为基准：`../..` 是发布包根目录，包含 `knowledge/`、`stages/` 等目录。下文链接中的 `../../` 必须保留，不按项目工作目录解析，也不改写为本技能的 `references/`。

读取前确认目标文件存在；缺失时报告解析后的绝对路径并返回 `NEEDS_CONTEXT`。

## 输入

输入项和证据不足时的处理以发布包中的 [knowledge/standards/common-systematic-debugging.md](../../knowledge/standards/common-systematic-debugging.md) 的"输入要求"为准，本文件不复制该清单。无法稳定复现或缺少必要证据时返回 `NEEDS_CONTEXT`，不猜测根因。

## 加载

加载发布包中的 [knowledge/standards/common-systematic-debugging.md](../../knowledge/standards/common-systematic-debugging.md)；实施修复时按该规则加载 [stages/construction/construction-tdd.md](../../stages/construction/construction-tdd.md)。

## 输出

返回状态（`DONE`、`NEEDS_CONTEXT` 或 `BLOCKED`）、假设—验证记录、根因证据或明确未决结论、最小修复建议、修复后的验证结果，或继续处理所需上下文。

## 禁止事项

不得：

- 绕过三次失败停止条件；
- 决定是否回退 Inception 或进入 CR；
- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 宣布阶段完成；
- 伪造 evidence。
