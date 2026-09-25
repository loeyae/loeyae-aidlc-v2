# 存量项目追溯 ID 迁移计划

> 对象：`E:\Work\src\loeyae\loeyae-boot-workspace`（13 module 单体：Java 后端 + admin-ui-vue3 + duxapp）
> 目标：让存量产物通过分类追溯矩阵门禁（补 `track` + 统一 `REQ-` 前缀 + 补 `CL/STORY/AC` 链路 ID），从 `MIGRATION_REQUIRED` 收敛到 `COMPLETE`。
> 范围：纯 ID/元数据迁移，**不改业务代码、不改需求内容语义**。
> 版本：基于实测 ID 现状（2026-09-25 只读扫描全 13 module）。

---

## 一、ID 现状盘点（实测，非假设）

### 需求层 `requirements.md` —— 三套格式混用，均需统一到 `REQ-`

| 格式 | module | 合规性 |
|------|--------|--------|
| `REQ-{MODULE}-xxx`（如 `REQ-DUXAPP-001`）| admin-ui、duxapp | ✅ 已合规 |
| `REQ-nnn` / `SC-nnn`（如 `REQ-015`）| genealogy（部分）| 🟡 REQ 合规，SC 需并入 |
| `{MODULE}-FR-xxx`（如 `SYSTEM-FR-001`、`LOWCODE-FR-001`）| system、lowcode、flowable | 🔴 非 `REQ-` 前缀，漏识别 |
| `FR-{MODULE}-xxx`（如 `FR-MALL-001`、`FR-AI-001`）| mall、member、pay、ai、cms、sso、visualization、infra、demo、flowable | 🔴 非 `REQ-` 前缀，漏识别 |

> 另注：多数 requirements.md 头部有 `> 模块追溯：REQ-V2-CONTRACT-001…` 行 —— 这是**契约引用**，被矩阵误当需求抓取（B2 已确认）。迁移时需与真正的功能需求区分。

### 故事层 `user-stories.md` —— 全项目统一用 `US-{MODULE}-xxx`，无 `AC-xxx`

- 13 module 全部用 `US-{MODULE}-nnn`（规范要求 `STORY-nnn`）。
- **无一个 `AC-xxx` 验收标准 ID**（故事正文有验收描述，但无稳定 ID）。

### 澄清层 —— 几乎空白

- 仅 `ai` module 有 `requirement-clarification.md`/`clarification-record.md`，且无 `CL-xxx` ID。
- 其余 12 module 无澄清产物（多数走 instruction-only，未落盘）。

### track 标签 —— 全项目 0 覆盖

- 13 module 全部无 `track:` 标签 → 全部 `missing_track` → 无法进入正向全覆盖对账。

---

## 二、迁移决策（需你逐条确认，标 ★ 的是关键取舍）

1. **★ REQ-ID 统一口径**：`{MODULE}-FR-xxx` / `FR-{MODULE}-xxx` → `REQ-{MODULE}-xxx`（保留模块段，语义清晰，与已合规的 admin-ui/duxapp 一致）。**不**压成纯数字 `REQ-001`（会丢模块可读性且跨 module 冲突）。
2. **★ 原 ID 保留映射**：迁移时在每条需求下保留 `原ID: FR-MALL-001` 一行，建立 `原ID→新REQ-ID` 映射表，供下游已引用旧 ID 的产物（story/design/test）批量换引用，避免断链。
3. **★ track 标注来源**：track 不能瞎填。规则 = 按 module 性质 + 需求内容推断：后端模块（system/sso/pay/mall/member/cms/flowable/infra/ai/genealogy/lowcode）需求默认 `backend`（+含数据建模的加 `data`）；admin-ui/duxapp 需求默认 `frontend`；NFR-* 需求 → `nfr`。**每条仍需人工/审阅确认**，不接受纯自动填充直接过门禁。
4. **STORY-ID**：`US-{MODULE}-xxx` → `STORY-{MODULE}-xxx`（同样保留模块段），每条声明 `来源: REQ-{MODULE}-xxx`。
5. **AC-ID**：从现有故事正文的验收描述提取，编号 `AC-{MODULE}-xxx`，隶属某 STORY，映射到 REQ。**这是纯新增工作量最大的一项**（现状 0 个 AC ID）。
6. **CL-ID**：仅对已有澄清产物的 module（ai）补 `CL-xxx`；其余 module 无澄清产物则该层标 `not_applicable`（澄清是条件阶段，无歧义时本就无产物，不强造）。

---

## 三、分批执行计划（按风险/收益排序）

### 批次 0 · 迁移基建（1 次性，全 module 共用）
- **0.1** 建立 `原ID→新REQ-ID` 映射表模板（每 module 一份 `docs/aidlc/modules/{m}/inception/id-migration-map.md`）。
- **0.2** 写一个**只读校验脚本**（非破坏）：跑矩阵 producer 采集每 module 当前 `matrix_rows/missing_track/broken_rows`，作为迁移前基线快照。
- **0.3** 确认迁移**在存量项目的 git 分支上进行**（可回滚），不直接改主干。
- **产出**：基线快照 + 映射表骨架 + 迁移分支。**不改任何产物内容**。

### 批次 1 · 试点 1 个后端 module（建议 `sso`，最小：3 FR + NFR）
- 1.1 `FR-SSO-xxx` → `REQ-SSO-xxx`，保留原 ID 映射行。
- 1.2 每条 REQ 补 `track:`（sso 全 `backend`；NFR-SSO → `nfr`）。
- 1.3 `US-SSO-xxx` → `STORY-SSO-xxx`，声明来源 REQ。
- 1.4 提取 AC → `AC-SSO-xxx`，隶属 STORY、映射 REQ。
- 1.5 下游产物（application-design/functional-design）批量换旧 ID 引用为新 REQ-ID。
- 1.6 跑矩阵 producer，确认 sso 从 `MIGRATION_REQUIRED` → `COMPLETE`（或明确列出仍缺项）。
- **验收**：sso `broken_rows=[]` 且 `missing_track=[]` 且 `migration_status=passed`。这是迁移方法论的**样板**，跑通后固化为可复制流程。

### 批次 2 · 前端 module（`admin-ui` + `duxapp`，REQ-ID 已合规，只需补 track + STORY/AC）
- 这两个 module REQ-ID 已是 `REQ-{MODULE}-xxx`，工作量小于后端 module，适合紧接试点做。
- 补 `track: [frontend]`、`US→STORY`、提取 AC。
- **额外收益**：前端 module 迁移后，可顺带验证矩阵的 `pages` 层对账（frontend track 专属层）。

### 批次 3 · 其余 9 个后端 module（按依赖顺序）
- 顺序建议：`infra`（被多方消费的基础）→ `system` → `member`/`mall`/`pay`/`cms`/`flowable`/`ai`/`visualization`/`lowcode`/`genealogy`/`demo`。
- 每个 module 复用批次 1 的样板流程。
- `genealogy` 特殊：已暂停（`SC-015` 暂停边界），只需最小合规化，不强推。

### 批次 4 · 收口验证
- 全 13 module 跑矩阵 producer，出"迁移前 vs 迁移后"对比总表。
- 确认无 `missing_track`、无 `broken_rows`、`migration_status=passed`。
- 更新 `id-migration-map.md` 汇总为全项目 ID 映射总表（供后续任何引用旧 ID 的地方查证）。

---

## 四、工作量与风险评估（诚实）

**量级（实测统计）：**
- 需求条目：约 100+ 条 FR（13 module，每 module 4-16 条）需重命名 + 补 track。
- 故事条目：约 100+ 条 US → STORY 重命名 + 声明来源。
- AC：**从 0 新建**，按每故事 2-4 条估，约 200-400 个 AC ID —— **这是最大工作量项**。
- 下游引用换链：application-design/functional-design 里对旧 FR-ID 的引用需同步替换。

**主要风险：**
1. **断链风险**（最高）：重命名 REQ-ID 后，下游产物仍引用旧 ID → 矩阵反向对账报 DANGLING。**必须靠批次 0 的映射表 + 批次内 1.5 的同步换引用**根治，不能只改需求侧。
2. **track 误标**：track 决定正向覆盖对账的适用层，标错会误判覆盖。需人工确认，不接受纯自动。
3. **AC 提取的语义准确性**：从散文验收描述提炼 AC 是**内容级**工作，矩阵只能验 AC-ID 存在与映射（结构），AC 内容是否忠实故事意图仍需 review。
4. **契约引用干扰**：`REQ-V2-CONTRACT-xxx` 头部行会被矩阵当需求抓 —— 迁移时需决定：是把它规范成真正的 REQ，还是移出需求 ID 命名空间（如改 `CT-*`）。

---

## 五、需你拍板的决策点

1. REQ-ID 统一到 `REQ-{MODULE}-xxx`（保留模块段），接受吗？
2. AC 从 0 新建约 200-400 个 —— 是全量补，还是先只补 backend/frontend track 的核心故事、其余later？
3. 迁移用什么执行体：我逐 module 手工迁移（慢但可控），还是先写一个半自动重命名+映射脚本（快但需你审脚本）？
4. 从试点 `sso` 开始，还是你指定另一个 module 试点？
