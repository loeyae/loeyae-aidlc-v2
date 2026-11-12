# 显式旧受管模式参考

仅在用户明确选择维护旧受管流程或受控 Provider 契约时阅读；默认能力不加载此文件。以下历史规则不覆盖默认宿主协议。


# 逆向工程能力

开始时宣布："使用 aidlc-reverse-engineering 执行逆向工程"。

## 资源路径

共享资源路径以本 `SKILL.md` 所在目录为基准：`../..` 是发布包根目录，包含 `knowledge/`、`stages/` 等目录。下文链接中的 `../../` 必须保留，不按项目工作目录解析，也不改写为本技能的 `references/`。

读取前确认目标文件存在；缺失时报告解析后的绝对路径并返回 `NEEDS_CONTEXT`。

## 输入

调用方必须提供：

- 工作区根路径；
- 已检测到的包、框架和技术栈信息；
- 逆向分析范围（全量或增量）。

缺少必要输入时返回 `NEEDS_CONTEXT`，不推断项目是否为存量。

## 加载

加载发布包中的 [stages/inception/inception-reverse-engineering.md](../../stages/inception/inception-reverse-engineering.md)。图表需求通过调用 `aidlc-diagram-design` 执行。

## 输出

返回 `docs/aidlc/inception/reverse-engineering.md` 路径、业务概述、架构发现、包关系、基础设施发现和未解决问题。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 宣布阶段完成；
- 伪造 evidence。
