---
id: traceability-id-chain
name: 贯穿式追溯链 ID 规范
type: knowledge
---
# 贯穿式追溯链 ID 规范（单一权威）

本文件定义 AI-DLC 全流程的稳定追溯 ID。所有跨产物对账 checker 以此为准；产物模板必须按此标注 ID，使后序阶段能对上游做**双向覆盖对账**（正向:上游每条被下游覆盖;反向:下游引用的上游真实存在）。

## ID 定义

| ID 前缀 | 层 | 产出阶段 | 载体产物 | 正则 | 说明 |
|---------|----|---------|---------|------|------|
| `CL-xxx` | 澄清 | requirement-clarification | `clarifications.md` | `CL-\d{3,}` | 每条已确认的澄清结论一个稳定 ID |
| `FR-xxx` | PRD 功能需求 | prd-generation | `prd.md` | `FR-\d{3,}` | PRD 的功能需求条目 |
| `REQ-xxx` | 需求 | requirements-analysis | `requirements.md` | `REQ-[A-Z0-9][A-Z0-9_-]*\d` | 模块需求条目。**必须 `REQ-` 前缀**（数字如 `REQ-001`，或带模块段如 `REQ-DUXAPP-001`）。**禁止** `{MODULE}-FR-xxx`（如 `SYSTEM-FR-001`）等非 `REQ-` 前缀的遗留格式——追溯矩阵只识别 `REQ-` 前缀，非此前缀的需求会被漏识别；存量此类 ID 归为待迁移（`MIGRATION_REQUIRED`），须统一改为 `REQ-` 前缀 |
| `STORY-xxx` | 用户故事 | user-stories | `user-stories.md` | `STORY-\d{3,}` | 用户故事条目 |
| `AC-xxx` | 验收标准 | user-stories | `user-stories.md` | `AC-\d{3,}` | 故事下的验收标准，隶属某 STORY |
| `UC-D-xxx` | 测试用例点 | test-case-derivation | `test-cases/` | `UC-D-\d+` | 设计级用例点 |
| `PAGE-xxx` | 页面 | ui-page-planning | `page-plan.md` | `PAGE[-_]?[A-Z0-9]+` | 页面标识，贯穿 mock/figma/前端代码 |
| `@ReqId` | 代码追溯 | code-generation | 源码注释/标记 | `@ReqId\s*[:=]?\s*(REQ-\d+)` | 代码回溯到需求 |
| `@TestCaseId` | 测试追溯 | tdd | 测试代码 | `@TestCaseId\s*[:=]?\s*(UC-D-\d+)` | 测试回溯到用例点 |

## 追溯链（每层携带上游 ID，被下游引用）

```
CL-xxx(澄清)
  ├─→ FR-xxx(PRD)          PRD 每条 FR 声明其消化的 CL；澄清每条 CL 至少被一个 FR 或 REQ 承接
  ├─→ REQ-xxx(需求)        需求每条声明来源 FR/CL；需求覆盖 PRD 全部 FR + 澄清全部 CL
  │     └─→ STORY-xxx(故事)  故事每条声明来源 REQ；故事覆盖需求全部 REQ
  │           └─→ AC-xxx     验收标准隶属 STORY，映射到具体 REQ/FR
  ├─→ 应用设计(组件)         设计声明其实现的 REQ/STORY/CL；覆盖需求+故事+相关澄清约束
  │     └─→ PAGE-xxx(页面)   页面声明覆盖的 FR/STORY
  │           └─→ 设计稿      mock/figma 每 PAGE 回溯 FR/STORY(不止 page-plan)
  │                 └─→ 前端代码  实现按 PAGE 标记对齐设计稿元素/token/条件
  └─→ UC-D-xxx(用例点)
        └─→ 功能设计            设计承接全部 UC-D
              └─→ 代码(@ReqId)  代码回溯 REQ
                    └─→ 测试(@TestCaseId)  测试覆盖全部 UC-D
```

## 对账语义（checker 通用规则）

对任一"上游集合 U → 下游产物 D"的对账:
1. **正向覆盖**:U 中每个 ID 必须被 D 中至少一处引用/承接;未覆盖 = `UNCOVERED_<上游>` = high。
2. **反向存在**:D 引用的每个上游 ID 必须真实存在于 U;悬空 = `DANGLING_REF` = high。
3. **累积**(Phase C):后序阶段的 U 为"从澄清/PRD 起的全部已完成前序产物",非仅相邻层。
4. **遗留兼容**:上游产物无对应 ID(未迁移旧项目)时,该对账记 `not_applicable` + `MIGRATION_REQUIRED` 降级放行并列缺失,不硬阻断(与图表方案1一致)。
5. **确定性边界**:checker 只判 ID 映射的覆盖/悬空(可确定性);"下游内容是否忠实上游意图"由 review/LLM 辅助,不由 checker 假装判定。
