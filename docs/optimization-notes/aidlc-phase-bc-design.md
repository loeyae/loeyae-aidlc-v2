# AI-DLC 门禁加固 Phase B / C 技术方案（供评审）

> 目标：把"涉及核心产物的对账"从 **LLM 自证**升级为**确定性 checker**(Phase B),并把 traceability 从"扫需求号"升级为**内容级对账 + 贯穿累积**(Phase C)。
> 前置：Phase A 已交付 harness 无关的 `next` 前置门禁 + Stop hook 门禁 + kiro-crew SKILL 契约。B/C 新增的 checker 一旦挂进 stage 的 sensors,即被 Phase A 底座自动强制执行。
> 本文只定方案与契约,**不含实现代码**;评审通过后再动手。

---

## ★ 最终落地状态（2026-09-25 更新，已实现并提交 60dd252 + 2fea092）

原方案的 B1/B2/B3 逐 checker 思路，在实现中**演化为"分类追溯矩阵"治本方案**（见 `aidlc-traceability-matrix-design.md`）——用一条贯穿 ID 链的矩阵替换零散的两两对账。最终落地状态：

| 计划项 | 落地 | 实现要点 |
|--------|------|---------|
| **B1** 前端↔设计稿元素级对账 | ✅ | `uiAlignment` 计数级 diff 替换硬编码字面量(Vue3+Element Plus,元素/token/条件级) |
| **B2** functional-design UC-D 覆盖确定性 | ✅ | `functionalDesign` 引擎算 UC-D 覆盖差集(`covered.length !== sourceCases.length`) |
| **B3** prd-completeness 结构确定性 | ✅ | 4 字段(acceptance/non_goals/source_index/pending_questions_indexed)从硬编码 true 升为从 PRD 文本算出;required_sections 保证节存在,B3 查节内容充实度;**放弃 legacy 降级**(与 required 重叠成死代码) |
| **C1** 内容级 ID 双向覆盖 | ✅ | 矩阵 producer 正向(track 条件化)+ 反向 + 悬空 |
| **C2** 从 PRD 起累积 | ✅ | 矩阵纳入 PRD 的 FR→REQ 承接 + 澄清 CL→下游遵循;已迁移 module 硬拦,存量降级 |
| **治本机制** 分类追溯矩阵 | ✅ | `track` 标签 + `traceabilityMatrix` producer + `traceability-matrix` 门禁 |
| **CL 入链** | ✅ | `clarification-traceability` + CL-xxx 规范 |
| **AC 可见性** | ✅ | 矩阵 derived_gaps advisory(STORY 缺 AC 提示,不阻断) |
| **门禁前移** | ✅ | 矩阵挂到 8 个产出阶段:requirements/user-stories/application-design/test-case-derivation/functional-design/code-generation/tdd/code-review——每个产出阶段当场累积对账 |

**确定性边界（最终，诚实）：** 矩阵保证**结构覆盖**(ID 双向、无断点、无需求消失),纯确定性、可强制、不误报(靠 track 分类 + 存量降级)。**不**保证内容"忠实"上游意图(代码是否真实现语义)——那仍靠 review/测试。

**遗留兼容（最终）：** 所有新 checker 对旧产物走降级(`MIGRATION_REQUIRED`/`not_applicable` + 缺失清单),不硬阻断存量项目迁移。存量迁移工具见 `legacy-migration-plan.md` + `scripts/legacy-id-migrate.ts`。

**验证：** tsc / graph compile(46 stages) / matrix 单测(`tests/test_traceability_matrix.py` 6 用例) / build 9 harness / distribution parity(1667) / 存量项目 loeyae-boot-workspace 实测降级正确。

---

## 以下为原始评审方案（保留作设计留档，实际落地以上表为准）



---

## 0. 现状分级(源码核实)

把所有核心产物 sensor 按"证据如何产生"分三级:

| 级别 | 含义 | 现有 sensor |
|------|------|------------|
| **D — 确定性** | 引擎真解析产物算出结论,Agent 无法伪造 | `diagram-contract`、`ui-artifact-consistency`(部分)、`traceability`(弱正则) |
| **H — 半确定性** | 引擎校验 manifest/产物内部自洽 + 引用合法,但不校验"实现 vs 设计基准"或"内容 vs 上游意图" | `htmlArtifactContract`/`figmaArtifactContract`(在 ui-artifact-consistency 内)、`prd-completeness`(部分字段) |
| **S — 自证** | 引擎只读 Agent 写进 evidence 的布尔/计数字段 | `ui-design-alignment`、`functional-design-completeness`、`prd-completeness`(核心质量字段)、`inception-consistency`(部分) |

**你两个痛点的根因定位:**
- "前端代码与设计稿差距大" → `ui-design-alignment` 是 **S 级**。它只读 `styles_aligned:true` / `unmapped_elements:0` 等 Agent 自填字段,**从不解析实现代码与设计基准做 diff**。而设计侧的 `htmlArtifactContract`/`figmaArtifactContract`(H 级)只校验 manifest↔HTML/figma 三者自洽,不碰实现代码。→ 实现↔设计这一段完全无确定性对账。
- "用户故事与 PRD 差距大" → `traceability` 是弱 D(只扫 `REQ-xxx` 字样),`prd-completeness`/`inception-consistency` 的内容质量字段是 **S 级**。→ 故事内容是否真的覆盖 PRD 条目,无确定性对账。

---

## Phase B —— 核心产物确定性对账 checker

### B 的判定原则

一个对账要成为"确定性 checker",必须满足:**结论由引擎解析真实产物算出,Agent 改 evidence 字段无法使其通过。** Agent 的职责变成"让真实产物满足门禁",而非"让证据字段满足门禁"。

### B1. `ui-design-alignment` 升级:实现代码 ↔ 设计基准 元素级对账(最高优先)

**这是解决"前端偏离设计稿"的核心。**

**输入(全部已存在):**
- 设计基准:`html-mock` 模式 → `ui-mock-manifest.json` + 各 page 的 HTML/mock-box;`figma` 模式 → `figma-manifest.json` + nodeId/screenshot。
- 实现代码:该 unit 的前端产物(Vue 3 SFC / TSX),含 PAGE 追溯标记(现规范已要求"目标代码须保留可搜索的 PAGE 追溯标记")。

**确定性对账逻辑(新增 checker,拟放 `core/tools/aidlc-semantic-checks.ts` 或新建 `aidlc-ui-alignment-checks.ts`):**
1. 从设计基准提取**元素集**:每个 PAGE 的表单字段(name/type/required)、操作按钮、列表列、状态展示、条件可见性标注。
   - html-mock:解析 mock HTML 的 `<input|select|button|table>` + mock-box class + `<style>`/CSS 变量的色值/圆角/字号/间距。
   - figma:从 figma-manifest 的 nodeId 结构 + `get_variable_defs`/`get_design_context` 导出的元素与 token。
2. 从实现代码提取**元素集**:按 PAGE 标记定位 SFC,解析 `<template>` 的表单控件、按钮、`el-table` 列、`v-if`/`v-show` 条件、`<style>`/绑定的 token。
3. **对账并算出**(引擎算,非 Agent 填):
   - `unmapped_elements` = 设计有但实现缺 → high。
   - `extra_elements` = 实现有但设计无(过度实现)→ high。
   - `styles_aligned` = 色值/圆角/字号/间距是否引用设计 token 而非硬编码/框架默认色 → 偏差计数。
   - `conditional_visibility_aligned` = `v-if`/`v-show` 条件是否覆盖设计标注的角色/状态显隐。
4. evidence 由 producer 写入**算出的计数**,`ui-design-alignment` gate 校验这些计数(现有字段名不变,语义从"自填"变"算出")。

**范围决策(需评审):** 实现侧解析先限定 **Vue 3 + Element Plus**(你的栈,见 lessons)。做成"解析器可插拔"以便日后加 React/其他,但首版只实现 Vue 3。理由:通用 AST 抽象成本高且易漏,先覆盖真实栈。

**残余边界(如实):** 像素级视觉一致(间距渲染、字体度量)仍需 chrome Provider(已有,且按前面用户诉求默认不阻断)。B1 做到**元素/字段/token/条件级**的结构对账,不做像素级 —— 但这一层正是"差距颇大"的主因(缺字段、多按钮、错 token、漏条件),结构对账即可抓住绝大部分。

### B2. `functional-design-completeness` 升级:用例覆盖确定性对账

**现状 S 级** —— `use_cases_covered` 是 Agent 自填的字符串数组。
**升级:** 引擎从 `inception/application-design/test-cases/` 读取 UC-D 清单(权威),从功能设计文档解析已设计的用例引用,**算出**覆盖差集。`use_cases_covered` 改为引擎算出的"已覆盖 UC-D 列表",缺失即 high。复用 code-review 已有的 UC-D 对账机制,前移到功能设计阶段。

### B3. `prd-completeness` 升级:结构确定性 + 内容留给 C

- **可确定性化的**:`required_sections` 是否真实存在(解析 PRD 标题)、`functional_requirements` 计数(数 FR-xxx)、`source_index_complete`(来源索引条目 vs 引用)、`pending_questions_indexed`(待确认项是否都进索引)。这些从 S 升 D。
- **内容质量**(验收标准是否可实施、非目标是否合理)难确定性化,**保留人工审批门**,不假装 checker。诚实标注:这部分仍靠 review,不升 D。

### B 优先级与交付顺序

B1(实现↔设计) → B2(用例覆盖) → B3(PRD 结构)。B1 最痛、价值最高,先做。

---

## Phase C —— traceability 内容级对账 + 贯穿累积

### C 的两层要求(来自你的指令)

> "traceability 升级为内容级对账。后继流程的对账都应该囊括前序流程的所有产物。"

**层C1 — 内容级对账**:不止扫 `REQ-xxx` 字样,而是校验**引用关系的语义完整性**:每条下游条目映射到上游具体条目,且上游每条都被下游覆盖(双向)。
**层C2 — 贯穿累积**:建立一条 ID 追溯链,后序阶段的对账覆盖**全部前序产物**,不只相邻一层。

### C 的核心:贯穿式追溯链模型

定义一条稳定的 ID 链,每层产物必须携带上游 ID 并被下游引用:

```
PRD(FR-xxx) → 需求(REQ-xxx) → 用户故事(STORY-xxx, 验收标准 AC-xxx)
   → 应用设计(组件/UC-D-xxx) → 单元(unit_id) → 代码(@ReqId/PAGE 标记) → 测试(@TestCaseId)
```

**追溯矩阵(新增确定性 checker `aidlc-traceability-checks.ts`):**
- 每个阶段结束,引擎构建"上游全集 → 本阶段产物"的**覆盖矩阵**。
- **正向**:上游每个 ID(累积到本阶段的全部前序)是否都被本阶段至少一个产物引用/承接。缺失 = 覆盖漏洞 = high。
- **反向**:本阶段每个引用的上游 ID 是否真实存在于上游产物。悬空引用 = high。
- **累积**:矩阵的"上游全集"不是相邻一层,而是**从 PRD 起的全部已完成前序阶段产物**(C2 要求)。

### C 与 Phase A 底座的咬合

- traceability checker 挂进各阶段 sensors → 被 Phase A 层1(`next` 前置)+ 层2(Stop hook)自动强制。
- 因为层1 复验的是"下一阶段所依赖的**全部上游** completed 阶段门禁",天然契合 C2 的"累积覆盖":推进到 code 阶段时,story/design 阶段的 traceability 门禁都会被重验,漏覆盖会在推进时被拦。

### C 的现实边界(需评审确认)

- **"内容级"到什么程度?** 完全语义对账(判断 story 内容是否"真的"实现了 FR 意图)需要 LLM 判断,不可确定性化。C 的确定性部分做到 **ID 映射的完整性 + 双向覆盖 + 悬空检测**;"内容是否忠实于意图"这层仍需 review 或 LLM 辅助,**不假装 checker**。建议:确定性做覆盖,LLM 判断做内容质量并明确标注其非确定性。
- **ID 规范落地成本**:要求所有产物携带贯穿 ID 标记(AC-xxx、UC-D-xxx、PAGE、@ReqId、@TestCaseId)。部分已有(REQ/UC-D/PAGE/TestCaseId),需补齐 **AC-xxx(验收标准级)**。这要改产物模板 + 生成阶段 skill。

---

## 跨 Phase 的工程事项

1. **改动落点**:全部在源仓库 `core/tools/`(新增 checker)+ `core/sensors/*.md`(schema 更新)+ 相关 stage skill(产物模板加 ID)。改完 `tsx scripts/build.ts --all` 重新分发 9 harness。
2. **测试**:每个新 checker 配单测(仿 `tests/test_diagram_contract.ts`);跑 `test_v4_phase1_phase2.ts` 回归。
3. **前置阻塞(当前)**:checkout 无 `node_modules`,build/test 跑不了,需先 `npm install`。
4. **兼容**:新 checker 对**遗留产物**(无新 ID/无设计基准)应走类似 Phase A 方案1 的降级路径(标 `MIGRATION_REQUIRED`/`not_applicable` 放行 + 缺失清单),不硬 throw 阻断旧项目迁移。

---

## 评审决策点(已决,记录最终结论)

1. **B1 实现侧解析范围** → ✅ 先做 Vue 3 + Element Plus(计数级元素对账),解析器保留可插拔。
2. **B1 对账深度** → ✅ 元素/字段/token/条件级结构对账;像素级留给 chrome Provider(默认不阻断)。
3. **C "内容级"边界** → ✅ 确定性做 ID 双向覆盖 + 悬空检测;"内容忠实意图"标为非确定性(review/LLM 辅助),不假装 checker。
4. **C 追溯链 ID** → ✅ 补齐 CL-xxx(澄清入链)、STORY/AC-xxx(故事模板);REQ 统一 `REQ-` 前缀。AC 作 advisory 可见性,不硬门禁(存量兼容)。
5. **遗留兼容** → ✅ 全部降级放行(MIGRATION_REQUIRED/not_applicable + 缺失清单),不硬阻断旧项目。
6. **交付顺序** → 实际:治本方案(分类追溯矩阵)替换零散 B1/B2/B3 → 增量①②③(澄清/故事/前端) → C2 累积 + B3 确定性 + AC → 门禁前移到 8 个产出阶段。

**演化说明(对原方案的偏离,已记录):**
- 原 B1/B2/B3/④⑤⑥⑦ 零散对账 → 收敛为**单一分类追溯矩阵**(治本,消除"正向覆盖误报"+"断点累积"两个结构漏洞)。
- B3 原设计含 legacy 降级 → 实现中发现与 required_sections 重叠成死代码,**移除**,改纯确定性。
- 增量④⑤(存在性对账显式化) → 核实后确认已被 `uiArtifactConsistency`(反向)+ 矩阵(正向 track)覆盖,**关闭不新增**(避免冗余门禁互相矛盾)。
- 存量项目实测暴露并修复 producer 3 缺陷(B1 路径 {module-id} / B2 ID 格式 / B3 阶段感知)。
- 实际 checker 落点是 `aidlc-semantic-checks.ts` 的 `traceabilityMatrix`(非原设想的独立 `aidlc-traceability-checks.ts`)。
