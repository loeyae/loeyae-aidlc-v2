---
name: aidlc-code-review
description: "对指定变更执行 Spec/Standards 双轴或最终全局代码审查并返回可追溯报告；不负责 Construction 触发和完成判定。"
triggers: 代码审查, 代码评审, Code Review, code review, Spec 审查, Standards 审查
---

# 代码审查能力

开始时宣布：“使用 aidlc-code-review 执行代码审查”。

## 资源路径

共享资源路径以本 `SKILL.md` 所在目录为基准：`../..` 是发布包根目录，包含 `knowledge/`、`stages/` 等目录。下文链接中的 `../../` 必须保留，不按项目工作目录解析，也不改写为本技能的 `references/`。

读取前确认目标文件存在；缺失时报告解析后的绝对路径并返回 `NEEDS_CONTEXT`。

## 输入

输入项、复审附加输入和缺失处理以发布包中的 [stages/construction/construction-code-review.md](../../stages/construction/construction-code-review.md) 的“输入要求”为准，本文件不复制该清单。调用方必须提供该章节要求的全部输入，并显式给出审查模式取值；缺失时返回 `NEEDS_CONTEXT`，不自行选择审查时机或模式。

## 加载

加载发布包中的 [stages/construction/construction-code-review.md](../../stages/construction/construction-code-review.md)。平台将该逻辑文件映射到自己的规则目录；平台入口不得改变其内容或语义。

## 输出

返回状态（`DONE`、`NEEDS_CONTEXT` 或 `BLOCKED`）、分别保留的 Spec/Standards 结论、含定位与严重度的问题清单、修复建议与复审结果，以及证据不足或技术阻断项。单元人工记录只维护 `code-review.md`，引用受控证据，不另写单元 audit 或逐 UC-D 对账副本。`FINAL_GLOBAL` 模式给出最终全局审查清单逐项结论并引用受控 `ucd_coverage`。

## 禁止事项

不得：

- 决定 C5/C7 是否触发；
- 合并或批准代码；
- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 宣布单元或 Construction 完成；
- 伪造 review evidence。
