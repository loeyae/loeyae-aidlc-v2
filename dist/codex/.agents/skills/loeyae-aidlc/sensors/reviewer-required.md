---
id: reviewer-required
name: Reviewer Required
description: Verifies that the code-review stage produced a non-empty review record.
---

# reviewer-required

该 sensor 检查代码审查阶段的 `produces` 中至少存在一个非空审查记录文件。缺少审查记录或记录为空时阻断阶段完成。
