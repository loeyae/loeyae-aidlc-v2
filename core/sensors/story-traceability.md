---
id: story-traceability
name: Story Traceability
description: Verifies user stories carry STORY/AC IDs and bidirectionally reconcile against requirements (and clarifications when present).
type: builtin
---
# story-traceability

## 目的
把用户故事阶段从"无门禁裸奔"升级为确定性对账,确保故事忠实覆盖上游需求与澄清。校验 `user-stories.md`:

- 每个故事带 `STORY-xxx`,验收标准带 `AC-xxx`(ID 规范见 `knowledge/common-traceability-id-chain.md`);
- **正向覆盖**:`requirements.md` 每个 `REQ-xxx`/`R-xxx` 至少被一个故事的来源声明覆盖;
- **反向存在**:故事引用的每个 REQ 真实存在于 requirements.md(无悬空);
- **澄清遵循(条件)**:`clarifications.md` 存在且含 CL 时,每个 `CL-xxx` 至少被一个故事引用;不存在(澄清阶段条件跳过)则不校验澄清项;
- **遗留兼容**:requirements.md 无任何 REQ-xxx(未迁移旧项目)时记 `not_applicable`,只要求故事非空,不硬阻断。

## 门禁语义
builtin sensor(无独立 evidence),由引擎解析 user-stories.md + requirements.md(+ 条件 clarifications.md)判定。任一实质失败即阻断,经 Phase A 的 `next` 前置门禁与 Stop hook 强制。

## 确定性边界
只判 ID 的双向覆盖/悬空(可确定性)。"故事内容是否真的忠实于需求/澄清意图"由 review/LLM 辅助,不由本 checker 假装判定。

## 依赖设计注记
`clarifications.md` **不**放入 stage 的 `consumes`(硬 准入),因为需求澄清是 CONDITIONAL 阶段、无歧义时会跳过、产物可能不存在;若作硬 consume 会在澄清跳过时误阻断故事阶段。故本 sensor 对澄清做**条件对账**(存在才校验)。
