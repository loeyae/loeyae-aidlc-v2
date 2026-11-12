---
name: aidlc-ui-mock-design
description: "按确认的页面行为制作或修改 HTML Mock，复用现有设计与视觉资源。"
triggers: UI 原型, HTML Mock, 页面原型, 交互原型, UI mock, 页面 Mock
---

# ui-mock-design

已有设计稿或明确页面描述可以直接使用，不要求先生成页面计划文件。先确认本次页面、重要状态、尺寸和视觉方向；只询问影响结果的缺失业务信息。

用宿主工具生成或修改 HTML，复用现有 CSS/组件/素材。简单页面一次完成，复杂批次按实现需要拆分；不强制 skeleton/content 两套产物和 validated 标记。

通过真实浏览器检查要求的布局、文字、状态与交互，注明 Mock 模拟行为和实际后端行为的区别。保存必要 HTML/资源及已有设计说明，不额外生成 manifest、签名阶段或受控证据；实际产品实现仍需真实 API/结果验证。

默认由宿主执行，结果和必要业务文档是工作依据；共享边界见 [宿主执行协议](../../knowledge/protocols/host-execution.md)。

## 兼容参考

仅明确使用旧受管/受控产证模式时读取 [旧契约](../../knowledge/legacy-skills/aidlc-ui-mock-design.md)，默认不加载。
