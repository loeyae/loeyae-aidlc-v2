# AI-DLC 跨产物对账 —— 全量清单与缺口分析

> 基于 `core/stages/**` 的权威 frontmatter(consumes / produces / sensors)逐阶段核实。
> 目的:列举**应该存在的**跨产物对账关系全集,标出**当前有无门禁 sensor**,以及门禁是 **D 确定性 / H 半确定性 / S 自证 / ✗ 无**。
> 供 Phase B 补全对账用。

## 图例
- **D** 确定性:引擎解析产物算出结论,不可伪造。
- **H** 半确定性:校验 manifest/产物自洽+引用合法,不校验"实现↔基准"或"内容↔意图"。
- **S** 自证:引擎只读 Agent 自填字段。
- **✗** 无门禁:该关系无任何 sensor,纯靠 Agent 自觉。

---

## A. 全量应然对账关系(按流程顺序)

### Ideation 阶段

| # | 上游产物 | 下游产物 | 应对账内容 | 当前 sensor | 级别 | 缺口 |
|---|---------|---------|-----------|------------|------|------|
| A1 | 澄清文档 | product-contracts(产品契约) | 契约是否覆盖澄清结论 | 无(product-contracts 无 produces/无 sensor) | ✗ | **缺失** |
| A2 | module-division | prd(PRD) | PRD 是否覆盖所有模块 | prd-completeness | S/部分H | **内容对账缺失**(只自证) |
| A3 | **澄清文档** | **PRD** | PRD 是否消化了所有澄清结论(你点名) | 无 | ✗ | **完全缺失** |
| A4 | scenario-module-mapping | 需求(requirements) | 场景是否全映射到需求 | traceability(弱 D,扫号) | 弱D | 内容对账缺失 |

### Inception 阶段

| # | 上游产物 | 下游产物 | 应对账内容 | 当前 sensor | 级别 | 缺口 |
|---|---------|---------|-----------|------------|------|------|
| B1 | scenario-module-mapping | requirements-analysis | 需求覆盖场景 | traceability(弱) | 弱D | 内容对账缺失 |
| B2 | **PRD + 澄清文档** | **需求** | 需求是否忠实 PRD+澄清(你点名) | 无(requirements-analysis 只 consumes scenario-mapping) | ✗ | **完全缺失** |
| B3 | requirements + **PRD + 澄清** | **用户故事** | 故事是否覆盖需求/PRD/澄清(你点名) | 无(user-stories 无 consumes/无 produces/无 sensor) | ✗ | **完全缺失** |
| B4 | requirements + user-stories | application-design(应用设计) | 设计覆盖需求与故事 | diagram-contract(只管图!) | D(仅图) | **设计↔需求/故事内容对账缺失** |
| B5 | **澄清文档** | **应用设计** | 设计是否遵循澄清约束(你点名) | 无 | ✗ | **完全缺失** |
| B6 | requirements + user-stories | ui-page-planning(页面规划) | 页面覆盖需求/故事 | ui-artifact-consistency | H | 引用合法性有,内容覆盖弱 |
| B7 | page-plan | ui-mock/figma(设计稿) | 稿↔page-plan 自洽 | ui-artifact-consistency | H | manifest 自洽有 |
| B8 | **PRD + 用户故事** | **设计稿(mock/figma)** | 稿是否覆盖 PRD/故事的功能点(你点名) | 无(mock/figma 只 consumes page-plan) | ✗ | **完全缺失**(稿只对 page-plan,不回溯 PRD/故事) |
| B9 | requirements + user-stories(+PRD+设计) | cross-validation(交叉验证) | Inception 全产物一致 | inception-consistency | S/部分 | 内容一致靠自证 |
| B10 | application-design | units-generation | 设计意图全被单元承接 | design-intent-coverage | D | 已确定性(意图覆盖) |

### Construction 阶段

| # | 上游产物 | 下游产物 | 应对账内容 | 当前 sensor | 级别 | 缺口 |
|---|---------|---------|-----------|------------|------|------|
| C1 | 需求/故事/设计 | functional-design(功能设计) | 用例全覆盖 | functional-design-completeness | S | **用例覆盖靠自证** |
| C2 | test-cases(UC-D) | functional-design | UC-D 全被设计承接 | functional-design-completeness | S | 同上 |
| C3 | 功能设计/契约 | code-generation(代码) | 代码符合设计 | doc-cascade(仅文档级联) | 弱 | **代码↔设计对账缺失** |
| C4 | **设计稿(mock/figma)** | **前端代码** | 实现↔设计基准元素级(你点名) | ui-design-alignment | **S** | **实现↔稿对账靠自证(核心痛点)** |
| C5 | UC-D 用例点 | 测试(tdd) | 每 UC-D 有测试 | test-quality + code-review 的 UC-D 对账 | D | 已有(code-review 末尾对账) |
| C6 | 需求全集 | code-review | 规格合规 | review-evidence | S/H | 内容靠 reviewer |

---

## B. 缺口汇总(你点名的 + 我发现的)

### 你点名的四类 —— 全部证实为缺口

| 关系 | 现状 | 严重度 |
|------|------|--------|
| **PRD ↔ 澄清文档**(A3) | 完全无对账。PRD 只 consumes module-division,不 consumes 澄清文档 | 🔴 高 |
| **用户故事 ↔ PRD+澄清**(B3) | user-stories 阶段**无 consumes、无 produces 声明、无 sensor** —— 完全裸奔 | 🔴 高 |
| **设计稿 ↔ PRD+用户故事**(B8) | mock/figma 只对 page-plan 自洽,不回溯 PRD/故事功能点 | 🔴 高 |
| **应用设计 ↔ 澄清文档**(B5) | 应用设计只 consumes requirements+stories,澄清约束不进对账 | 🟠 中 |

### 我额外发现的结构性缺口

| 关系 | 现状 | 严重度 |
|------|------|--------|
| **澄清文档 → 全下游**(A1/A3/B2/B5) | **澄清文档 `requirement-clarification` 阶段 produces 为空、无 sensor** —— 它产出的澄清结论**没有任何下游对账消费它**,等于澄清了个寂寞 | 🔴 高(根源性) |
| **需求 ↔ PRD**(B2) | requirements-analysis 只 consumes scenario-mapping,不 consumes PRD —— 有 PRD 时需求不回溯 PRD | 🟠 中 |
| **应用设计 ↔ 需求/故事内容**(B4) | 只有 diagram-contract(管图的几何),设计的**功能组件是否覆盖需求/故事**无对账 | 🟠 中 |
| **代码 ↔ 功能设计**(C3) | 只有 doc-cascade(文档级联),代码是否实现设计无确定性对账 | 🟠 中 |
| **前端代码 ↔ 设计稿**(C4) | ui-design-alignment 是 S 级自证 | 🔴 高(Phase B1 已规划) |

---

## C. 根源洞察:澄清文档是"孤儿产物"

最深的结构缺口:**`requirement-clarification`(需求澄清)产出的澄清文档,在整个 consumes 链里从未被任何下游阶段声明消费,也没有任何 sensor 校验下游是否遵循了澄清结论。**

这解释了你的核心观察 —— 澄清了半天,PRD/故事/设计/代码都可以无视澄清结论,因为**引擎层面澄清文档与下游零绑定**。这不是某一个 sensor 弱,而是**澄清结论没有进入追溯链**。

---

## D. 对 Phase B/C 方案的修正建议

原 Phase B 方案聚焦 B1(前端↔稿)、B2(用例覆盖)、B3(PRD 结构),**漏了澄清文档这条主线和几条上游对账**。修正后的完整补全清单:

**Phase B 补全(确定性对账,按严重度排序):**
1. **B1 前端代码↔设计稿**(C4)—— 原计划,最痛,保留最高优先。
2. **澄清文档纳入追溯链**(A3/B2/B5)—— 让 PRD/需求/应用设计的 consumes 显式包含澄清文档,并加对账:下游是否引用/遵循每条澄清结论(需澄清结论带 ID,如 `CL-xxx`)。**这是根源修复。**
3. **用户故事对账**(B3)—— 给 user-stories 阶段补 consumes(PRD+需求+澄清)、produces(带 STORY/AC ID)、sensor(覆盖对账)。**故事阶段目前完全裸奔,必须补。**
4. **设计稿↔PRD/故事**(B8)—— 稿的 page/元素回溯到 PRD 功能点与故事,不止对 page-plan。
5. **应用设计↔需求/故事内容**(B4)—— 补功能组件覆盖对账(不止图几何)。
6. **用例覆盖确定性化**(C1/C2 = 原 B2)。
7. **代码↔功能设计**(C3)。

**Phase C(贯穿累积)**:追溯链 ID 补 `CL-xxx`(澄清)、`AC-xxx`(验收标准),使 C2"累积覆盖全部前序"能真正贯穿到澄清文档这条线。

---

## E. 需你确认的决策点

1. **澄清文档 ID 化**:接受给澄清结论引入 `CL-xxx` ID 并修改 `requirement-clarification` 产物模板,使其可被下游对账吗?(这是修复"孤儿澄清"的前提)
2. **补全范围**:Phase B 是否按上面 7 项全补,还是先做最痛的 1(前端↔稿)+ 2(澄清入链)+ 3(故事对账)?
3. **改动面**:补齐这些要改多个阶段的 consumes/produces/sensors 声明 + 产物模板 skill + 新 checker —— 面比原 Phase B 大。确认按这个扩展范围推进吗?
