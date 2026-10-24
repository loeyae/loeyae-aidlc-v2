---
name: aidlc-unit-generation
description: "将系统分解为可独立实现的工作单元并建立依赖矩阵和故事映射；不负责单元认领和阶段完成判定。"
triggers: 工作单元, 单元拆分, 依赖矩阵, 故事映射, 工作单元规划, 开发单元
---

# 工作单元生成能力

开始时宣布："使用 aidlc-unit-generation 生成工作单元"。

## 输入

调用方必须提供：

- 已批准的应用设计产物路径（组件、方法、服务、依赖）；
- 用户故事路径；
- 项目类型和分布式/单体标识；
- 设计意图标记（如有）。

缺少必要输入时返回 `NEEDS_CONTEXT`。

## 加载

加载发布包中的 `stages/inception/inception-units-generation.md`。

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
