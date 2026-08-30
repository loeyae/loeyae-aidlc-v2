---
name: aidlc-reverse-engineering
description: "分析存量代码库生成业务概述、架构发现和设计产物；不负责阶段路由和完成判定。"
triggers: 逆向工程, 存量系统分析, 代码库分析, 架构发现, reverse engineering, 现有系统梳理
---

# 逆向工程能力

开始时宣布："使用 aidlc-reverse-engineering 执行逆向工程"。

## 输入

调用方必须提供：

- 工作区根路径；
- 已检测到的包、框架和技术栈信息；
- 逆向分析范围（全量或增量）。

缺少必要输入时返回 `NEEDS_CONTEXT`，不推断项目是否为存量。

## 加载

加载发布包中的 `stages/inception/inception-reverse-engineering.md`。图表需求通过调用 `aidlc-diagram-design` 执行。

## 输出

返回 `docs/aidlc/inception/reverse-engineering.md` 路径、业务概述、架构发现、包关系、基础设施发现和未解决问题。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 宣布阶段完成；
- 伪造 evidence。
