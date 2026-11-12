# 显式旧受管模式参考

仅在用户明确选择维护旧受管流程或受控 Provider 契约时阅读；默认能力不加载此文件。以下历史规则不覆盖默认宿主协议。


# HTML UI Mock 设计能力

开始时宣布："使用 aidlc-ui-mock-design 生成 HTML UI Mock"。

## 资源路径

共享资源路径以本 `SKILL.md` 所在目录为基准：`../..` 是发布包根目录，包含 `knowledge/`、`stages/` 等目录。下文链接中的 `../../` 必须保留，不按项目工作目录解析，也不改写为本技能的 `references/`。

读取前确认目标文件存在；缺失时报告解析后的绝对路径并返回 `NEEDS_CONTEXT`。

## 输入

调用方必须提供：

- 已批准页面计划路径；
- `stage=skeleton` 或 `stage=content`；
- 存量页面证据；
- 已选视觉来源或默认样式。

缺少任一输入时返回 `NEEDS_CONTEXT`，不推断流程状态。

## 加载

1. 发布包中的 [stages/inception/inception-ui-mock-generation.md](../../stages/inception/inception-ui-mock-generation.md)；
2. 按该文件要求加载 HTML 设计、推导和样式细则（同目录的 `inception-ui-mock-*.md` 文件）；
3. UI 生成流程（代表页定标·全量连续生成·每批轻量技术读回）见 [knowledge/design/common-ui-generation-flow.md](../../knowledge/design/common-ui-generation-flow.md)：调用方按该流程以**连续模式**传入全部页面，本能力不逐页等待用户审批，每批完成后自动技术读回。

## 输出

返回生成或修改的 page-specs/HTML 路径，以及当前模块 canonical `ui-mock-manifest.json` 的路径和完整内容。manifest 必须把 `skeleton`、`content` 两段分别标记为 `validated`，两段 PAGE 集合与已批准 `page-plan.md` 完全一致，并记录每页 page-specs、HTML、mock-box、REQ/FR 与 US 映射。另返回页面计划对账结果、内容自检结果和未解决问题。

本能力不生成 Evidence；调用方必须在当前签名 `html-mock` Stage 实例中通过受控 Producer 运行 `ui-artifact-consistency`。未选择 HTML、UI condition=false 或选择 `skip` 时不得调用本能力、创建 manifest 或要求占位 Evidence。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 等待或代替用户审批；
- 执行 I10（交叉验证）；
- 宣布 I9/I10 完成；
- 伪造 evidence。
