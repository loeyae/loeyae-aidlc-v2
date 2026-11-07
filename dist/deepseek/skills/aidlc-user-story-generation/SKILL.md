---
name: aidlc-user-story-generation
description: "将已批准需求转化为以用户为中心的故事和验收标准；不负责 I7 路由和完成判定。"
triggers: 用户故事, 故事生成, 验收标准, 用户场景, user story, acceptance criteria
---

# 用户故事生成能力

开始时宣布："使用 aidlc-user-story-generation 生成用户故事"。

## 资源路径

共享资源路径以本 `SKILL.md` 所在目录为基准：`../..` 是发布包根目录，包含 `knowledge/`、`stages/` 等目录。下文链接中的 `../../` 必须保留，不按项目工作目录解析，也不改写为本技能的 `references/`。

读取前确认目标文件存在；缺失时报告解析后的绝对路径并返回 `NEEDS_CONTEXT`。

## 输入

调用方必须提供：

- 已批准的需求文档路径；
- 已通过交叉验证的需求（I6 通过）；
- 深度指南取值（全面/标准/精简）；
- 模块或服务范围。

缺少必要输入时返回 `NEEDS_CONTEXT`，不推断需求审批状态。

## 加载

加载发布包中的 [stages/inception/inception-user-stories.md](../../stages/inception/inception-user-stories.md)。

## 输出

返回 `docs/aidlc/inception/user-stories.md` 路径、用户画像、故事列表、验收标准和未解决问题。

## 禁止事项

不得：

- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 修改需求文档；
- 宣布阶段完成；
- 伪造 evidence。
