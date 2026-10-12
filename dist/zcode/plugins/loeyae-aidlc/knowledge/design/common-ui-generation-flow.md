# UI 设计生成流程（代表页定标 · 全量连续生成 · 自动技术读回 · 一次集中验收 · 差异增量修正）

本文件是 UI 设计生成阶段的**流程单一真相源**。`inception-ui-mock.md`、`inception-ui-figma.md`、`inception-ui-mock-generation.md`、`inception-ui-figma-generation.md`、`inception-cross-validation.md`（审查项 e）均引用本文件定义的流程、暂停边界和交付登记。

## 适用范围

仅适用于当前模块签名 I9 choice 为 `html-mock`、`figma-create` 或 `figma-existing` 的 UI 设计生成，以及 Figma 既有页面增量更新和 UI 设计的自动验证与交付登记。

**不改变**：正式 PRD 权威性；requirements 与 user stories 的需求确认流程；安全/数据删除/生产环境/不可逆操作的确认机制；代码实现、发布、部署阶段已有的必要质量门禁。

## 通用化约束（禁止硬编码）

本流程所有对象必须参数化，禁止写死任何：模块 ID（如 `M02`/`m02-product`）、Figma `fileKey`/`nodeId`、Git commit、用户账号、临时报告目录、页面数量。文内一律用占位：`{module-id}`、`{figma-file-url}`、`{page-id}`、`{prd-path}`、`{stories-path}`、`{base-commit}`。页面编号来自已批准 `page-plan.md`，不假设固定数量。

---

## 阶段 1：输入与版本锁定

`page-plan.md` 完成后、任何 HTML/Figma 生成动作前，先确保本地 remote-tracking ref 是当前版本（通常执行 `git fetch origin main`），再运行：

```bash
loeyae-aidlc ui lock --module {module-id} --route <html-mock|figma-create|figma-existing> [--upstream-ref origin/main]
```

命令生成不可覆盖的 canonical 文件：

`docs/aidlc/modules/{module-id}/inception/ui-design/ui-generation-lock.json`

锁由确定性工具采集并由 `ui-artifact-consistency` 受控 producer 复核：

- 正式 PRD（存在或通过 `--prd` 指定时）、requirements、user stories、page-plan、已确认设计决定（存在或通过 `--design-decisions` 指定时）；
- 每个文件的 SHA-256、Git blob、REQ/FR、US/STORY、AC、PAGE 分段摘要；
- 页面清单及其需求/故事/AC 映射；
- 当前 HEAD、upstream ref 与 upstream commit；
- UI route 与模块身份。

锁已存在时命令拒绝覆盖，避免在生成后静默重置基线。存量任务首次接入必须使用 `--adopt --approval-ref <批准记录> --reason <原因>` 显式登记接管基线；不能把接管伪装成生成开始锁。

**需求优先级（固定）**：

```
当前用户明确指令 > 正式 PRD > 已确认用户故事/AC > 已批准设计来源 > 基座源码现状 > 通用 UX 规范
```

当前任务已指定用户故事为主要操作输入时保持该约定；正式 PRD 只补充故事未覆盖的空白，不推翻已有故事结论。

---

## 阶段 2：设计系统与代表页定标

全量生成前：

1. 建立或复用 Variables、Components、Variants、Effects、Auto Layout 规范；
2. 从 `page-plan.md` 选择一张信息量最丰富的**代表页**（通常是字段/状态/交互最多的页面，非空态或终态）；
3. 完成代表页的视觉、密度、标注、状态条件表和交互清单；
4. 对代表页只执行**一次定标确认**。

**定标确认的自动化边界**：用户已明确批准参考设计，或已存在稳定设计系统时，跳过人工代表页确认，直接自动定标，但必须在 canonical manifest 或 `cross-validation-report.md` 中记录所用参考节点（`fileKey`/`nodeId` 或设计系统标识）。

代表页定标确认后，**后续页面不得逐页暂停确认**。定标是整个任务**唯一**的页面级人工确认点（且在上述条件下可自动化）。

---

## 阶段 3：全量连续生成

按 `page-plan.md` 的页面依赖顺序**连续生成全部页面**：

- **不设置逐页人工确认门禁**；
- **不设置每批“独立审查 → 修正 → 复验”的 repeat loop**；
- 一个 Figma 文件同一时间只能有一个写者；
- 可按批次写入，但批次**只用于控制写入规模和错误恢复**，不是人工评审门禁；
- 每次回复、汇报或状态更新后，生成任务继续运行，不因进度回复而停顿；
- 普通写入、布局调整、API 重试和自验证不请求用户确认。

**不影响其他页面的需求缺口不得阻塞全量生成**：在“开发说明 · 不渲染”中标记阻断缺口并继续生成其余内容，禁止臆造规则。

### 允许暂停的情形（唯一）

只有以下情况允许暂停并请用户确认（对应 stage-graph 中仍需人工裁决的高风险动作）：

1. 存在会改变业务结论的真实需求歧义；
2. 多个同级权威需求源冲突；
3. 需要执行删除、覆盖原稿、强推、生产写入等高风险操作；
4. 连续两次等价工具失败且替代方案也不可用。

高风险暂停按 `common-workflow-changes.md` 协调；需求源冲突按其“产品产物一致性协调”裁决。

---

## 阶段 4：每批轻量技术读回

**不取消批次检查，但限定为自动技术检查，不做深度语义审查，不启动独立 reviewer，不等待用户确认。** 由当前写者自动完成。

每批写入后只检查：

- 节点是否真实生成；
- 编号和顶层 Frame 是否唯一；
- 目标 `nodeId` 是否稳定；
- 是否误改只读来源或旧版本；
- 是否发生 API 原子回滚；
- 是否有顶层碰撞、明显越界、缺失字体或文字截断；
- Variables、Components、Auto Layout 是否存在真实引用；
- 临时截图和报告是否生成。

**Figma 写入失败处理**：

1. 根据错误修改调用参数；
2. 将脚本拆成更小批次；
3. 先建立 Auto Layout 父级，再设置 FILL；
4. 自动重试；
5. 同一等价方案连续失败两次后切换实现方式，不得无限重试。

非必要临时文件不清理，避免因删除确认阻塞主任务。

---

## 阶段 5：最终需求新鲜度检查

全量生成结束、最终验收开始前，先更新锁中声明的本地 upstream ref（默认 `origin/main`），并对比：

```
ui-generation-lock.json 中的生成时文件/ID digest 与 upstream commit
vs
当前 worktree 文件/ID digest 与当前 upstream commit
```

比较由 `loeyae-aidlc ui accept` 和 `inception-consistency` 使用同一确定性实现完成，覆盖 PRD、requirements、user stories、STORY/AC 实际正文、页面清单及设计决定；禁止只比较时间或数量。

- 无变化：影响矩阵为空，报告 `synchronized_pages: none`；
- 有变化：机械计算新增、删除、改写的 REQ/FR、US/STORY、AC、PAGE，并用锁定与当前 page-plan 的并集建立影响矩阵；
- 任一变化 ID 未映射、任一正文变化无法归类，立即 fail-closed；
- `synchronized_pages` 必须与 `affected_pages` **完全相等**，从而既不遗漏受影响页，也不重生未受影响页。

完成同步与一次验收后执行：

```bash
loeyae-aidlc ui accept --module {module-id} --route <route> \
  --review-report docs/aidlc/modules/{module-id}/inception/cross-validation-report.md
```

命令生成 `ui-generation-acceptance.json`。随后 `orchestrate report --stage cross-validation` 会由受控 producer 重新计算全部内容；upstream 在登记后再次推进、worktree 文件变化、影响矩阵漏报或报告被改写都会使门禁失败。

---

## 阶段 6：一次全量集中验收

**同一任务只能登记一次全量语义和视觉验收**（I10 审查项 e）。`cross-validation-report.md` 必须恰好有一个 `## UI full acceptance` 机器段；`ui-generation-acceptance.json` 的 schema 只允许单个 `full_acceptance` 对象，且文件一旦存在，`ui accept` 拒绝第二次创建。最终验收不得递归触发另一轮同级全量审查。检查项：

- 页面数量、编号、顺序和唯一性；
- 已取消页面是否确实不存在；
- 用户故事和 AC 是否完整追溯；
- 局部改动是否正确标注新增、变更和移除；
- 多状态和表单联动是否完整；
- Modal、Drawer、Toast、确认操作和返回路径是否闭环；
- 确认类操作的信息量是否足够；
- Loading、Empty、Error、Disabled、Focus、Selected 是否覆盖；
- Variables、Components、Variants、Auto Layout 是否实际使用；
- 缺失字体、文字截断、可见越界、裁切和碰撞；
- 只读来源、旧版本和无关页面是否保持不变；
- HTML 的 `data-change`/`data-us`/`data-ac`/`data-src` 是否有效；
- Figma 节点登记、截图和交互说明是否齐全。

**最终验收不得递归触发另一轮同级全量审查。**

---

## 阶段 7：定向修正

最终验收发现问题后：

- 按问题清单**只修受影响页面**；
- 保留原 `nodeId`，禁止删除重建已登记 Frame；
- 修复后**只做定向复验**，在报告追加 `## UI targeted reverification <run-id>` 段（仅复查受影响页面及其直接依赖）；所有且仅有 full acceptance 的 `issue_pages` 必须被结果为 `passed` 的定向段覆盖；
- 除非发现共享组件、公共契约或全局设计系统问题，否则**不得再次执行全量验收**。

**完成条件**：

- 无未解决 HIGH/MEDIUM 问题；
- LOW 问题已修复或明确记录；
- 未确认需求缺口已标注但未臆造；
- 当前需求 revision 与设计登记一致。

---

## 自动执行与用户确认边界

UI 设计阶段**默认自动执行**（对应 stage-graph `approval: notify`，引擎自动推进，不阻塞）：读取需求、创建或修改 Figma、普通布局修正、工具重试、截图、metadata 读回、结构检查、状态检查、生成登记表和报告。

**仅以下情况请求用户确认**（高风险，需显式裁决）：

- 覆盖或删除现有正式 Figma 版本；
- 改变正式需求结论；
- 多个正式来源无法判定优先级；
- 修改生产数据；
- 执行不可逆 Git 操作；
- 页面拆分、合并或编号变化。

**进度汇报不得暂停工作流**：发送普通 info 消息后必须继续当前步骤。

---

## HTML 与 Figma 职责边界

- 业务规则、校验、计算、边界：看正式 PRD 及用户故事/AC；
- 最终视觉、布局、组件、状态：看 Figma；
- HTML 单页 Mock：作为机器可读开发差异地图；
- HTML 中 `data-change`/`data-us`/`data-ac`/`data-src` 用于定位改动和源码；
- 阶段 1 汇总骨架不得被误认为最终 UI；
- 没有单页 HTML 的页面不得从阶段 1 骨架反推最终实现；
- 不要求把所有 Figma 页面再复制成完整 HTML；
- 只有研发确实需要源码级定位时，才补缺失页面的 `data-src` 差异地图。

---

## 受控登记文件

机器闭环由两份按模块隔离的 canonical JSON 承担，不再依赖人工填写 Markdown hash：

1. `ui-generation-lock.json`：阶段 1 由 `loeyae-aidlc ui lock` 生成，锁定 upstream、文件/ID digest 和页面映射；文件不可覆盖。
2. `ui-generation-acceptance.json`：阶段 5–7 完成后由 `loeyae-aidlc ui accept` 生成，记录当前 upstream、实际变化、影响矩阵、同步页面、唯一 full acceptance 和定向复验；文件存在时拒绝第二次生成。

`cross-validation-report.md` 是人工可读审查记录，同时必须包含以下机器段：

```markdown
## UI requirement freshness
- checked_at: {iso}
- synchronized_pages: PAGE-001, PAGE-002 | none

## UI full acceptance
- run_id: UIA-{id}
- completed_at: {iso}
- result: passed | issues-found
- reviewed_pages: PAGE-001, PAGE-002
- issue_pages: none | PAGE-002

## UI targeted reverification UIT-{id}
- run_id: UIT-{id}
- completed_at: {iso}
- result: passed
- pages: PAGE-002
```

最后一个定向段仅在 full acceptance 发现问题时出现。`handoff.md` 和可选的 `ui-generation-ledger.md` 只能派生展示摘要，不能替代上述 JSON、报告机器段或受控 Evidence。
