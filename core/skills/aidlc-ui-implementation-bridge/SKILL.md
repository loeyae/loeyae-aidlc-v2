---
name: aidlc-ui-implementation-bridge
description: "将已有 UI 设计映射到实际平台组件与布局，支持必要的跨端实现。"
triggers: Figma 转代码, Mock 转代码, 前端平台规范, 组件映射, 设计还原, UI 实现规范
---

# ui-implementation-bridge

读取现有设计、目标项目框架和组件；从仓库推断版本及目录，不要求 directive 的模块身份。纯 Web 且已有明确组件映射时可直接实现，不额外写桥接规范。

跨端或复杂组件差异时，梳理布局原语、交互、尺寸、可访问性和平台限制，把必要映射补入现有设计或代码说明。缺少特定框架资料时用宿主工具查证，不凭空认定平台能力。

保持设计指定状态/尺寸和交互，实际运行验证视觉与功能。平台说明是实施辅助，不是开始编码的先决文件。

默认由宿主执行，结果和必要业务文档是工作依据；共享边界见 [宿主执行协议](../../knowledge/protocols/host-execution.md)。

## 兼容参考

仅明确使用旧受管/受控产证模式时读取 [旧契约](../../knowledge/legacy-skills/aidlc-ui-implementation-bridge.md)，默认不加载。
