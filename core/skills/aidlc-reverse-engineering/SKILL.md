---
name: aidlc-reverse-engineering
description: "按本次问题分析存量代码、技术栈和行为，给出可追溯的架构发现。"
triggers: 逆向工程, 存量系统分析, 代码库分析, 架构发现, reverse engineering, 现有系统梳理
---

# 存量分析

未加载时先读[共用规则](../../knowledge/protocols/host-execution.md)，已加载则复用。

从指定仓库与当前问题定位包、配置、入口和相关调用链，自行查明技术栈；沿实际依赖扩大范围。

区分代码事实、运行结果与推断，说明关键路径、依据和未知项。结论写在对话或原架构说明；用户要求完整文档时再生成，必要图示优先 Mermaid。
