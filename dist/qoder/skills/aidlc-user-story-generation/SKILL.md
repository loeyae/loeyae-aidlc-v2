---
name: aidlc-user-story-generation
description: "把已有需求转化为用户场景和可验证验收标准，复用已有故事。"
triggers: 用户故事, 故事生成, 验收标准, 用户场景, user story, acceptance criteria
---

# user-story-generation

读取已确认需求和现有故事，围绕用户目标、成功路径、失败与边界提炼验收标准。不要求先取得交叉验证报告或固定深度参数；未知业务规则明确标注，必要时澄清。

只补充缺失的行为，避免把同一需求换写成多份重复故事。故事和验收保存在已有业务文档/任务清单，需要专门文档时再生成。输出可用于直接实现和测试的标准，不以阶段记录代替业务完整性。

默认由宿主执行，结果和必要业务文档是工作依据；共享边界见 [宿主执行协议](../../knowledge/protocols/host-execution.md)。

## 兼容参考

仅明确使用旧受管/受控产证模式时读取 [旧契约](../../knowledge/legacy-skills/aidlc-user-story-generation.md)，默认不加载。
