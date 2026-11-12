# 显式旧受管模式参考

仅在用户明确选择维护旧受管流程或受控 Provider 契约时阅读；默认能力不加载此文件。以下历史规则不覆盖默认宿主协议。


## 默认宿主执行

默认复用现有设计并只补充本次需要的组件、接口与约束，不为进入编码新增必填流程文档或阶段记录。已有批准不重复询问；只有新的重大决定需要人类确认。固定产物及受控阶段要求仅适用于显式旧受管流程。 参见 [宿主执行协议](../../knowledge/protocols/host-execution.md)。

## 能力说明与旧受管兼容

# 应用设计能力

开始时宣布："使用 aidlc-application-design 执行应用设计"。

## 资源路径

共享资源路径以本 `SKILL.md` 所在目录为基准：`../..` 是发布包根目录，包含 `knowledge/`、`stages/` 等目录。下文链接中的 `../../` 必须保留，不按项目工作目录解析，也不改写为本技能的 `references/`。

读取前确认目标文件存在；缺失时报告解析后的绝对路径并返回 `NEEDS_CONTEXT`。

## 输入

调用方必须提供：

- 已批准的需求和用户故事路径；
- 设计范围和复杂度判定；
- 已有架构约束（技术栈、部署边界等）。

缺少必要输入时返回 `NEEDS_CONTEXT`。

## 加载

加载发布包中的 [stages/inception/inception-application-design.md](../../stages/inception/inception-application-design.md)。图表需求通过调用 `aidlc-diagram-design` 执行。

## 输出

返回组件列表、组件方法、应用服务、组件依赖和架构设计文档路径。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 代替用户的架构审批（本阶段保留 `approval: block`，但审批由编排层负责）；
- 放行质量门禁；
- 宣布阶段完成；
- 伪造 diagram-contract evidence。

默认输出一份 application-design.md（标记 `<!-- aidlc-design: application-design/v1 -->`），在二级标题“组件列表、组件方法、应用服务、组件依赖”下完整记录设计。不再为相同内容生成四份子文档；旧项目按旧布局读取。UI 设计与真实证据仍依各自协议。
