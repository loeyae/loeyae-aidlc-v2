---
name: aidlc-reverse-engineering
description: "按本次问题分析存量代码、技术栈和行为，给出可追溯的架构发现。"
triggers: 逆向工程, 存量系统分析, 代码库分析, 架构发现, reverse engineering, 现有系统梳理
---

# reverse-engineering

从指定仓库和任务目标开始，自己读取包、配置、入口和相关调用链，不要求调用方先提供已经检测的技术栈。优先增量和相关范围，不默认扫描整个项目或全部历史文档。

区分代码事实、运行验证和推断，记录关键路径与未知项。结论在对话或现有架构说明中即可；只有用户要求完整逆向文档时才生成。需要图示时普通 Mermaid 足够，不为分析创建图表状态或受控产物。

默认由宿主执行，结果和必要业务文档是工作依据；共享边界见 [宿主执行协议](../../knowledge/protocols/host-execution.md)。

## 兼容参考

仅明确使用旧受管/受控产证模式时读取 [旧契约](../../knowledge/legacy-skills/aidlc-reverse-engineering.md)，默认不加载。
