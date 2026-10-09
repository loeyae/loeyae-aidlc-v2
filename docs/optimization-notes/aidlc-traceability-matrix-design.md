# 全覆盖对账机制建议：分类追溯矩阵（Classified Traceability Matrix）

> 目标：从根上杜绝"每一步都有差距、累积到代码与需求/设计大相径庭"。
> 核心洞察：**逐阶段两两对账治标**（易漏、易误报）；真正治本的是一条**贯穿全程、机器可验的追溯矩阵**——每个上游条目被打上"去向标签"，引擎在每个阶段**强制验证覆盖率=100%**，任何断点在发生的那一步就被门禁拦住，drift 无法进入下一步。

---

## 一、为什么"逐阶段对账"堵不住

我们前几轮做的是"阶段 A 产物 ↔ 阶段 B 产物"的点对点对账。它有两个结构性漏洞：

1. **正向覆盖会误报**：强制"每个 REQ 都要到达前端页面"会 false-block 后端需求。于是只能做反向/悬空(弱)，正向覆盖不敢开——**漏的正是"某需求根本没人实现"这种最致命的 drift**。
2. **断点会累积**：A→B 对账过了、B→C 对账过了，不代表 A 的某条真的活到了 C。中间任一步"换了话题"，端到端就断，但每一步的局部对账都显示绿。

要治本，必须让**每个上游条目有明确的"预期去向"**，并让引擎**端到端**验证它真的到达了那个去向。

---

## 二、机制：分类追溯矩阵

### 1. 给每个可追溯条目打"去向分类标签"

在源头（PRD/需求阶段）就为每个 `FR-xxx`/`REQ-xxx` 标注它的**实现去向**（machine-readable，产物模板强制）：

```markdown
## REQ-012 用户可导出订单为 Excel
- track: [backend, frontend]     # 去向:后端 + 前端(可多选)
- ui_relevant: true
```

`track` 枚举：`backend` / `frontend` / `data` / `infra` / `nfr` / `doc-only`。

**这一个标签解决了误报根因**：正向覆盖不再是"每个 REQ 都要到每个下游"，而是"每个 REQ 必须到达**它自己声明的 track**对应的下游产物"。UI-only REQ 不要求后端代码覆盖；backend-only REQ 不要求页面覆盖。误报消失，覆盖率却能拉满到 100%。

### 2. 单一权威矩阵文件

引擎维护一个机器可读的追溯矩阵 `.aidlc/traceability-matrix.json`（由确定性 producer 每阶段增量构建，非人写）：

```jsonc
{
  "REQ-012": {
    "track": ["backend", "frontend"],
    "clarifications": ["CL-003"],          // 澄清是否遵循
    "stories": ["STORY-008"],               // 到达故事层?
    "acceptance": ["AC-021", "AC-022"],     // 验收标准?
    "design_components": ["OrderExportService"],  // 应用设计?
    "pages": ["PAGE-ORDER-LIST"],           // 前端页面(track含frontend才要求)
    "test_cases": ["UC-D-045"],             // 用例点?
    "code_refs": ["@ReqId REQ-012 in OrderExportService.java, OrderList.vue"],  // 代码?
    "tests": ["@TestCaseId UC-D-045"],      // 测试?
    "coverage_status": "COMPLETE | BROKEN@<layer>"
  }
}
```

### 3. 每阶段门禁 = 矩阵的"截至本阶段应完成列"必须 100%

不再是"A↔B 点对账"，而是**每个阶段的准出门禁校验矩阵到本阶段为止的所有必需列全满**：

| 阶段 | 矩阵必须满足（按 track 条件化） |
|------|------------------------------|
| 需求 | 每个 FR 有对应 REQ；每个 REQ 有 `track` 标签 |
| 澄清 | 每个受影响 REQ 的 `clarifications` 列填齐(遵循 CL) |
| 用户故事 | 每个 `track` 含 frontend/backend 的 REQ 有 `stories` + `acceptance` |
| 应用设计 | 每个 backend REQ 有 `design_components`;每个 frontend REQ 有 `pages` |
| 设计稿 | 每个 frontend REQ 的 `pages` 在 mock/figma 中存在 |
| 功能设计 | 每个相关 REQ 有 `test_cases`(UC-D) |
| 代码 | 每个 REQ 的 `code_refs` 覆盖其 track 对应层(@ReqId 标记) |
| 测试 | 每个 UC-D 有 `tests`(@TestCaseId) |
| 最终 | 矩阵 100% `COMPLETE`,无任何 `BROKEN@<layer>` |

**关键**：`coverage_status=BROKEN@design` 意味着"某 REQ 活到了故事层但在设计层断了"——门禁在**设计阶段**就拦住,drift 当场暴露,进不了代码。这就是"每一步都不许有差距"的机器保证。

### 4. 与已有工作的关系

- 前几轮的 CL-xxx 入链、STORY/AC ID、UC-D 覆盖、PAGE 标记、@ReqId/@TestCaseId —— **全部是这个矩阵的列**,已做的不浪费,是矩阵的填充器。
- Phase A 的 `next` 前置门禁 —— 天然执行矩阵门禁(推进即验矩阵到本阶段列)。
- 唯一新增的根件:**`track` 分类标签** + **矩阵 producer/checker** + **每阶段的"矩阵列完整性"门禁**。

---

## 三、确定性边界（诚实）

矩阵保证的是**结构覆盖**:每个 REQ 的每一层都有对应产物条目、无断点。它**机器可判**、**100% 可拉满**、**不误报**(靠 track 分类)。

它**不**保证:下游内容"忠实"上游意图(REQ-012 的代码是否真导出了 Excel 而非 CSV)——那是语义,仍需 review/测试。但矩阵把"漏实现/漏设计/漏测试/换了话题"这类**结构性 drift**(你说的"大相径庭"的主因)全部堵死:一个需求不可能"悄悄消失",因为它的矩阵行会在断掉的那一层亮红并阻断推进。

**结构覆盖(矩阵) + 内容忠实(review/测试) = 你要的"不再大相径庭"。** 矩阵负责前者(占 drift 的绝大多数),且是纯确定性、可强制的。

---

## 四、落地增量（替换原 ④⑤⑥⑦ 的零散补丁）

1. **track 标签入产物模板**:需求阶段模板加 `track` + `ui_relevant`;checker 校验每个 REQ 有合法 track。
2. **矩阵 producer**:`aidlc-traceability-matrix.ts` —— 每阶段增量扫描所有产物,按 ID 构建/更新 `.aidlc/traceability-matrix.json`,算每行 `coverage_status`。
3. **矩阵门禁 sensor** `traceability-matrix`:挂到每个追溯相关阶段;校验"截至本阶段的必需列(按 track 条件化)100% 满,无 BROKEN"。
4. **遗留兼容**:无 track 标签的旧项目 → 矩阵行标 `MIGRATION_REQUIRED`,降级放行 + 缺失清单(同图表方案1)。
5. 已完成的 CL/STORY/AC/UC-D/PAGE/@ReqId 检查 → 收敛为矩阵的列填充器,去重。

---

## 五、需你确认

1. **接受 `track` 分类标签**(REQ 级 backend/frontend/data/infra/nfr/doc-only)吗?这是"正向全覆盖不误报"的唯一前提。
2. **接受用单一矩阵 + 每阶段矩阵门禁**替换零散的两两对账吗?(前者治本,后者治标)
3. 落地节奏:先做 track 标签 + 矩阵 producer + 矩阵门禁(核心三件),还是先出更细的矩阵 schema 供评审?
