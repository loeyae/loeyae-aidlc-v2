# 显式旧受管模式参考

仅在用户明确选择维护旧受管流程或受控 Provider 契约时阅读；默认能力不加载此文件。以下历史规则不覆盖默认宿主协议。


## 默认宿主执行

默认按用户明确的交付范围选择或调整可实施单元，依赖用于安排工作顺序和验证，不强制生成新的 manifest/claim 或等待逐单元批准。现有合理单元直接复用，固定受管文件仅用于显式旧受管流程。 参见 [宿主执行协议](../../knowledge/protocols/host-execution.md)。

## 能力说明与旧受管兼容

# 工作单元生成能力

开始时宣布："使用 aidlc-unit-generation 生成工作单元"。

## 资源路径

共享资源路径以本 `SKILL.md` 所在目录为基准：`../..` 是发布包根目录，包含 `knowledge/`、`stages/` 等目录。下文链接中的 `../../` 必须保留，不按项目工作目录解析，也不改写为本技能的 `references/`。

读取前确认目标文件存在；缺失时报告解析后的绝对路径并返回 `NEEDS_CONTEXT`。

## 输入

调用方必须提供：

- 已批准的应用设计产物路径（组件、方法、服务、依赖）；
- 用户故事路径；
- 项目类型和分布式/单体标识；
- 设计意图标记（如有）。

缺少必要输入时返回 `NEEDS_CONTEXT`。

## 加载

加载发布包中的 [stages/inception/inception-units-generation.md](../../stages/inception/inception-units-generation.md)。

## 输出

返回单元列表（`units.md`）、单元详情（`unit-of-work.md`）、依赖矩阵和故事映射路径。

## 输入归属声明（evidence_inputs）

生成的 `unit-manifest.json` 中，每个单元应带 `evidence_inputs`（version 1）：

- `paths`：该单元独占的源码/文档输入（私有路径）；
- `shared_paths`：与其他单元真实共享的路径（契约、公共模块）；
- `depends_on_units`：真实依赖的其他单元。

未声明 `evidence_inputs` 的单元无法获得单元级证据 scope（`inputs-v2:module:<m>:unit:<u>`），其私有文件变更会影响整个模块的证据有效性。引擎在 units-generation 完成信息中对缺失声明的单元给出 ⚠️ 提示。

存量工作流补齐（只能首次声明，且须由绑定该单元的 session 执行）：

```
aidlc orchestrate unit inputs --module <m> --unit <u> --paths <p1,p2> [--shared-paths <s1>] [--depends-on-units <u2>]
```

声明会通过引擎的 scope 探针验证；重叠/非法路径导致声明回滚。不得猜测归属——无法确定时先与用户确认。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 跨越服务所有权边界合并单元；
- 宣布阶段完成；
- 伪造 design-intent-coverage evidence。

### 显式自主批次补充（P1-05）

遵循 inception-units-generation 的 v1 单元契约：显式 autonomy_version、canonical unit-extension/capability/dependency、行为与 AC/UI 归属、实际能力版本、消费检查点、完整共享/传递输入及 write_scope Owner。不得把 consume/verify 写成实施任务；不得用声明的 passed/ready 代替实际生产者证据。来源不完整时保留 module scope 和串行模式。本技能只生成定义，不签发 grant、准入凭据或完成状态。
