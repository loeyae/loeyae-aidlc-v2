# 提示词：为 AI-DLC 工作流新增「UI-Mock ↔ 用户故事 US」双向绑定映射与门禁

> 用途：新开一个会话，把本文件全文作为工作指令粘贴进去，驱动对**上游 AI-DLC 工作流**的改造。
> 目标是让 `ui-mock` 与 `用户故事(US)` 形成**双向绑定映射**，并由**门禁(sensor)强制校验**，
> 从根上杜绝「后续编码阶段没读 ui-mock 就实现」的问题。
> 本提示词自包含——执行者不需要读历史聊天即可开工。

---

## 事实修正（MARS-118，以引擎实际代码为准）

> ⚠️ 本节修正本提示词早期对引擎现状的事实偏差。下文一、二节的部分描述写于核对引擎代码之前，照原样执行会与现有 sensor 大量重叠。按本节口径理解，才不会重复造轮子。

经只读核对引擎实际代码（`core/tools/aidlc-semantic-checks.ts` 的 `ui-artifact-consistency`、`core/tools/aidlc-orchestrate.ts` 的 `ui-design-alignment`、阶段图 IO）：

1. **「US → mock-box 只是单向、无门禁」不成立。** manifest 级 mock→US 绑定已由 `ui-artifact-consistency` 校验：`ui-mock-manifest.json` / `figma-manifest.json` 每个 page 的 `stories[]` / `requirements[]` 必须在 `user-stories.md` / `requirements.md` 真实存在（反向存在性，不悬空），并校验 page-specs / HTML / `mock_box_id` 三者一致。真实缺的只是**正向全覆盖**——「有界面表现却零 mock-box 关联的 US」此前无人拦截。
2. **「到 code-generation 开发 AI 没有任何门禁强制消费 ui-mock」不成立。** code-review 阶段的 `ui-design-alignment` sensor 已强制实现↔mock 的**元素级对齐**（`styles_aligned` / `conditional_visibility_aligned` / `platform_constraints_respected` 为 true，`unmapped_elements` / `extra_elements` 为 0），且集成屏障要求选了 UI route 的模块必须有 passed 的 code-review `ui-design-alignment` 证据。真正缺的是 ui-mock 不在 `code-generation` 的 `consumes` 声明里（输入契约缺口，涉及 module 轴产物给 unit 轴消费的跨轴可行性，**另立 issue 评估，本次不含**），而非「完全无门禁」。
3. **不新增独立 sensor。** 不应新增 `ui-mock-story-binding`。正向全覆盖已作为**增量**加到现有 `ui-artifact-consistency`（见本节第 1 点），避免与现有两个 UI sensor（`ui-artifact-consistency`、`ui-design-alignment`）职责重叠。实现见该 sensor 的 `forwardStoryCoverage`：在 `ui-mock-generation` / `ui-figma-generation` 聚合 manifest `stories[]` 并集，与 `user-stories.md` 全部 US 减去显式豁免对账。
4. **显式豁免口径已落地**：无标记 US 默认不豁免、一律要求被 UI 覆盖；只有在声明该 US 的行内用 `[ui: n/a]` / `[ui: 无界面]` / `[无界面]` 显式声明时才豁免。元素级 `data-us` 强制（第三节第 3 层所述）**本次不含**，另立 issue 评估。

本提示词其余正确的方法论继续有效：以 directive 实际字段为准、加法式扩展不改 core stage 拓扑、显式豁免、brownfield 走 upgrade + CR/reflow 不伪造证据。

---

## 一、背景与问题（为什么要改）

当前 AI-DLC 工作流（引擎 `loeyae-aidlc`，本机 v4.13.0；Multica 协作层 skill `aidlc-multica-orchestration`；UI Mock 生成 skill `ui-mock-page`）里，三段追溯链 `需求FR ↔ 故事US ↔ ui-mock(mock-box)` 的现状如下（**本表已按上文「事实修正」节更新**；标 ⚠️ 的行是修正前的错误描述，仅保留作对照）：

| 链段 | 现状 | 根因 |
|---|---|---|
| FR ↔ US | ✅ 齐全、双向、`traceability` / `traceability-matrix` sensor 校验 | 引擎 `requirements-analysis` 阶段既有门禁覆盖 |
| mock-box → US/FR（反向存在性） | ✅ 已由 `ui-artifact-consistency` 校验 manifest `stories[]`/`requirements[]` 真实存在、三件产物一致 | ⚠️ 原表误记为「单向、只在 page-specs 半落地」 |
| US → mock-box（正向全覆盖） | ✅ 已由 `ui-artifact-consistency` 的 `forwardStoryCoverage` 增量校验（MARS-118）；显式豁免 `[ui: n/a]` | 本次改造补齐——此前「有界面却零 mock 覆盖的 US」漏网 |
| mock-box 元素 → US/AC | 🔴 元素级 `data-us`/`data-ac` 打标未强制 | 本次**不含**，另立 issue 评估 |

**后果（已部分缓解）**：到 `code-generation` 阶段，code-review 的 `ui-design-alignment` sensor 已强制实现↔mock 元素级对齐并在集成屏障把关（见「事实修正」第 2 点）；真正残留的缺口是 ui-mock 未进 `code-generation` 的 `consumes` 声明（输入契约缺口，另立 issue 评估）。「有界面却零 mock 覆盖的 US」这一正向全覆盖缺口已由 MARS-118 补齐。

**本次改造的硬目标**：把「US ↔ ui-mock 双向绑定」从「skill 的软约定」升级为「引擎可校验的门禁」，并保证 `code-generation` 阶段把 ui-mock 列为 **`consumes` 的强制输入**。

---

## 二、改造范围与分层（三处，按职责分工）

> ⚠️ 边界铁律（继承 `aidlc-multica-orchestration` 核心边界）：
> **保留 `loeyae-aidlc` 的确定性阶段图、状态机与证据门禁，不新增 / 不删除 AI-DLC V2 的 core stage。**
> 本次只做「**在既有阶段上增补 sensor + 增补 produces/consumes 声明 + 补 skill 的标记规范**」，
> 属**加法式扩展（additive extension）**，不改阶段拓扑。若引擎提供 `extension validate|compose` 的扩展机制，优先走扩展，不要直接改 core。

### 第 1 层：`loeyae-aidlc` 引擎（门禁与阶段 IO）—— 核心改动

需要你先用只读命令摸清引擎如何定义 stage 的 `produces` / `consumes` / `sensors`，以及 sensor 是怎么注册和运行的（`loeyae-aidlc check --sensor <name>`、`evidence run --stage <slug>`、`extension validate|compose|status`）。然后：

1. **新增一个确定性语义 sensor：`ui-mock-story-binding`**（或并入既有 traceability 家族，按引擎惯例命名）。它校验以下**双向一致性**，任一不满足即 fail：
   - **正向（US → mock-box）**：每个有界面表现的 US 在 `stories.md` 里带「关联 mock-box」标记；标记指向的 mock-box 文件/编号真实存在。
   - **反向（mock-box → US）**：每个 ui-mock 的 mock-box（HTML `.mock-box` / page-specs 行）都能回指到至少一个存在的 US；每个带 `data-change` 的改动元素带合法的 `data-us`（能定位 AC 时带 `data-ac`），且 `data-us`/`data-ac` 指向的 US/AC 在 `stories.md` 里真实存在。
   - **无悬空**：不存在「指向不存在 US 的 mock-box」或「指向不存在 mock-box 的 US」；不存在「有界面表现却零 mock-box 关联的 US」。
   - **豁免口径**：纯后端 / 无界面表现的 US 用显式标记（如 `ui-mock: n/a` 或 `无界面`）声明豁免，sensor 认这类显式豁免、不误报（对齐 `requirement-clarification` 的「无澄清项」显式声明惯例）。
2. **把该 sensor 挂到正确的阶段准出门禁上**：
   - 挂在产出 ui-mock 的阶段（通常是 `application-design` 或承载 ui-mock 的 inception 阶段）的 `sensors` 列，作为该阶段 `report` 的准出条件。
   - 判定具体挂哪个 stage：以 `orchestrate next` 返回的 directive 中「哪个阶段 `produces` 含 ui-mock 产物」为准，不要凭文件名猜。
3. **在 `code-generation`（及 `tdd` / `functional-design` 等 unit 轴构造阶段）的 `consumes` 里显式加入 ui-mock 产物**，使「开发阶段的输入契约里就包含 ui-mock」。这样开发 AI 读取输入时 ui-mock 是**声明级必读项**，不是可选参考。
4. **证据可控**：sensor 结论必须由 `evidence run` / `check` 等受控命令产出（带 execution_id / digests），**禁止手写伪造证据 JSON**。brownfield reflow 场景的降级放行（如 `MIGRATION_REQUIRED`）沿用引擎既有语义，不要为通过门禁而伪造 passed。
5. **向后兼容**：对存量模块（已完成 `requirements-analysis` 但 ui-mock 未打标的），走引擎既有的 `orchestrate upgrade --dry-run` 列出缺证据的阶段，再按 CR / reflow 流程补；不要让新 sensor 把历史模块一刀切判 fail 导致卡死。

### 第 2 层：`aidlc-multica-orchestration` skill（Multica 编排映射）—— 文档增补

1. 在 **§8.4 CR5 一致性验证清单**里，把现有的「页面链路（适用时）」从「适用时」升级为**当阶段 produces 含 ui-mock 时的必验项**，并明确它校验的就是 `US ↔ mock-box` 双向绑定（引用第 1 层新增的 sensor 名）。
2. 在 **§2 任务矩阵「验收标准」列**与 **§5 推进门禁**里补一句：承载 ui-mock 的阶段 `report` 前，`ui-mock-story-binding` sensor 必须 passed。
3. 不新增 core stage、不改阶段拓扑——只在既有条目里增补对该 sensor 的引用。

### 第 3 层：`ui-mock-page` skill（标记规范落地）—— 规范闭环

1. **第 2 步差异清单 / 第 4 步渲染**：把「每个带 `data-change` 的元素必须带 `data-us`（能定位 AC 时带 `data-ac`）」从建议升级为**硬性产出要求**；差异清单每一行必须有 `data-us` 槽位。
2. **page-specs 双列**：`*-page-specs.md` 现有「关联 US」列保留；**同时**要求 `stories.md` 侧新增/维护「关联 mock-box」回指列（两边由脚本互相校验，不手工维护造成漂移）。
3. **扩展 `scripts/validate-mock.py` 与 `scripts/check-diff.py`**：
   - `validate-mock.py` 增加校验：每个 `data-change` 元素是否有 `data-us`、`data-us`/`data-ac` 是否指向 `stories.md` 中真实存在的 US/AC。
   - 新增（或在 `sync-stories.py` 里）一个双向对账：`stories.md` 的「关联 mock-box」列 与 page-specs 的「关联 US」列、与 HTML 里的 `data-us`，三者必须一致，不一致报错。
   - 这些脚本可作为第 1 层引擎 sensor 的底层实现被调用，或由 sensor 独立实现、脚本做本地快速自检；二选一，但口径必须与引擎 sensor 完全一致。
4. 更新 `references/reading-rules.md`：把「`data-us` 必填、`data-ac` 能定位则填」写死为规则（现在是半建议），并说明这是 `code-generation` 阶段开发 AI 的强制跳转依据。

---

## 三、执行顺序（建议）

1. **只读探查**（不改任何状态）：`loeyae-aidlc orchestrate next` 看当前 directive 的 stage / produces / consumes / sensors；`loeyae-aidlc check --sensor` 列出已有 sensor；`extension status` 看扩展机制；读 `aidlc-multica-orchestration` §8.4、`ui-mock-page` 的 `validate-mock.py` / `check-diff.py`。摸清「sensor 注册点」「阶段 IO 声明点」「扩展是否可用」。
2. **设计一版方案**，落到 `_plan/{日期}-ui-mock-us-binding-方案.md`：新 sensor 的校验规则表、挂载的 stage、`consumes` 增补点、三层改动清单、向后兼容策略、豁免口径。
3. **先改第 3 层脚本**（最容易验证）：扩展 `validate-mock.py` / 对账脚本，用一个已有模块（如 m08-payment 或 m02-product 的 ui-mock）实跑，证明双向对账能跑通、能抓出悬空。
4. **再改第 1 层引擎**：按扩展机制新增 sensor + 挂 stage + 补 `consumes`。用 `evidence run --stage <承载ui-mock的stage> --module <某模块>` 验证 sensor 真的会 fail（故意制造一处悬空）再 pass（修好后）。
5. **最后改第 2 层 skill 文档**，使编排层引用新 sensor。
6. **回归**：对一个干净模块跑完整 inception 链到承载 ui-mock 的阶段，确认新门禁不误伤合法产物、能拦住缺标记产物。

---

## 四、验收标准（硬性）

- [ ] 引擎存在 `ui-mock-story-binding`（或等价）sensor，`loeyae-aidlc check --sensor <名>` 可运行，结论受控可复现。
- [ ] 该 sensor 已挂到承载 ui-mock 的阶段的 `sensors`；该阶段 `report` 在双向绑定缺失时**被阻断**（实测制造一处悬空会 fail）。
- [ ] `code-generation`（及相关 unit 阶段）的 `consumes` 显式含 ui-mock 产物（`orchestrate next` 的 directive 里可见）。
- [ ] `ui-mock-page` 的 `validate-mock.py` 能校验 `data-us` 必填 + `data-us`/`data-ac` 指向真实 US/AC；双向对账脚本能抓出 `stories.md`「关联 mock-box」列、page-specs「关联 US」列、HTML `data-us` 三者的任何不一致。
- [ ] `aidlc-multica-orchestration` §8.4 一致性清单与 §5 门禁已引用新 sensor，页面链路从「适用时」升级为「produces 含 ui-mock 时必验」。
- [ ] 向后兼容：存量模块不被新 sensor 一刀切判死，走 `orchestrate upgrade` + CR/reflow 补标。
- [ ] 核心边界守住：未新增 / 删除 AI-DLC core stage，未改阶段拓扑；全部为加法式扩展。
- [ ] 不改任何正式 PRD（PRD 是基准，只读）；证据不手写伪造。

---

## 五、不处理的项（避免范围蔓延）

- 不新增 / 删除 / 重排 AI-DLC core stage，不改状态机拓扑。
- 不改任何业务 PRD、不改任何模块的业务需求口径（本次只动追溯/门禁机制）。
- 不为某个具体模块回灌需求内容（那是模块侧 CR 的事，与本工作流改造解耦）。
- 不引入新的外部依赖 / 新服务；sensor 用引擎既有的确定性 checker 机制实现。

---

## 六、注意事项

- 改引擎前务必确认 `extension validate|compose` 是否是官方扩展点；若引擎禁止第三方直接注册 sensor，退回到「在承载 ui-mock 的 skill / 脚本层做校验 + 在阶段 produces 的证据里体现」的方案，并在方案文档里标注这是因引擎约束而降级，不要硬改 core。
- 一切「这个阶段 produces/consumes 是什么、sensor 挂在哪」的判断，**以 `orchestrate next` 返回的 directive 实际字段为准**，不凭文件名或记忆推断。
- 多模块布局下，sensor 要支持 `--module` 作用域（对齐 `check --sensor <name> --module <id>`）。
- 豁免口径（无界面 US）必须是**显式声明**才豁免，不能默认豁免——否则等于没门禁。

---

## 七、开始实施

从第三节第 1 步「只读探查」开工，产出第三节第 2 步的方案文档后，先把方案摘要发出来给成员过目（涉及引擎门禁改动，属需确认的写操作），确认后再按 3→4→5→6 落地。全程不碰 PRD、不伪造证据、不改 core stage 拓扑。
