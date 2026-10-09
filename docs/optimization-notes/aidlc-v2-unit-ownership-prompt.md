# 任务:loeyae-aidlc-v2 单元所有权与 Provenance 协作约定重构

> 降维版本说明:本提示词的目标载体是**单机、Markdown 文件驱动的 AI-DLC 控制面**
> (`aidlc/active/aidlc-state.md` + `aidlc/active/audit.md`),不是分布式状态服务。
> 因此本重构只落地**该载体能真实执行与审查**的协作约定:unit 分区、分支所有权、
> `depends_on` 调度、provenance 标注、审查/调试检查项。
> 分布式一致性机制(lease broker / fencing token / epoch CAS / split-brain /
> registry 恢复)统一剔除,**不写入本提示词**
> ——避免产出不可执行、不可验收的占位规范。

## 背景

当前 `aidlc-agent-execution` 约定 conductor 为唯一 state authority(单写者串行)。
两个真实痛点:

1. **多设备/多成员想并行处理不同 unit**,但缺少明确的"谁写哪块、边界在哪"的约定。
2. **跨单元写交错**导致 audit / 产物里 provenance 噪声,事后难追溯某条改动属于哪个 unit。

现状里 `unit select` 已明确"选择是**公开协作记录,不是锁**",冲突靠成员沟通。
本重构不改变这一本质,而是把"一 unit 一分支一 writer"的所有权语义、依赖调度语义、
provenance 标注维度**写清楚、可审查**,消除上述两类噪声。

## 目标

1. 明确 **unit 分区 + 分支所有权** 约定:并行处理不同 unit 被鼓励且边界清晰。
2. 引入 **`depends_on` 字段与调度语义**:依赖关系显式化,可决定串行等待或快照并行。
3. 统一 **provenance 标注**:每份 unit 产物/audit 条目带 `unit_id / holder / branch / ts`
   等字段,跨 unit 触发的写补 `parent_unit`,使来源可追溯。
4. 扩充 **code-review / systematic-debugging** 的审查与检查维度,零运行时成本地
   守住上述约定。

## 待修改 skill 文件

- `aidlc-agent-execution.md` —— state authority 段落(改为分区所有权约定)
- `aidlc-unit-generation.md` —— unit 认领 / 依赖矩阵段落
- `aidlc-continuity.md` —— 状态恢复段落(补 provenance 追溯与并行恢复说明)
- `aidlc-code-review.md` / `aidlc-systematic-debugging.md` —— provenance 审查与检查项

## 模型定义(落地为 skill 内的协作约定,非运行时协议)

### 实体

- **Unit**:最小可独立处理单元,稳定 `unit_id`。一个 unit 在任一时刻**约定**只由一个
  holder 在一条分支上推进。
- **Holder**:当前推进该 unit 的成员/设备标识(约定字段,非运行时凭证)。
- **Branch ownership**:一 unit 一 Git 分支;该分支即该 unit 写入的边界。
- **Conductor**:仍是唯一可 orchestrate report / 更新 `aidlc-state.md` 全局态的角色
  (约定,不是运行时守卫)。unit 产物在各自分支产生,合并/汇报经 conductor。

### 写边界约定(核心)

```
边界 = 全局态(conductor 串行) ∪ ⋃_unit 各 unit 分支产物
```

- 一个 holder 只在自己认领 unit 对应的分支上写该 unit 的产物。
- 跨 unit **读**:任意时刻允许(读其他 unit 已提交产物)。
- 跨 unit **写**:禁止直接写。需要影响其他 unit 或全局态时,**发 message 给 conductor**,
  由 conductor 走全局串行路径处理。
- 冲突仍按现状**靠成员沟通 + 公开协作记录**解决;本约定使"越界写"在审查阶段可被识别,
  而不是靠运行时拒写。

### Unit 生命周期(协作约定)

1. **认领(Select)**:成员通过 `unit select` 声明认领某 unit,记录 `holder + branch`。
   现状已支持公开协作记录;本约定新增所有权语义:同一 unit 同时应只有一个已声明 holder,
   若发现重复认领,**由成员沟通解决**(记录冲突,不做运行时锁)。
2. **推进(Work)**:在该 unit 分支上产出/修改产物;每份产物与 audit 条目带 provenance 标注。
3. **依赖(Depends)**:若本 unit 依赖其他 unit 输出,在依赖矩阵声明 `depends_on`(见下)。
4. **汇报/合并(Report)**:完成后经 conductor 汇报/合并到全局态;conductor 串行更新
   `aidlc-state.md` 并追加 `audit.md`。
5. **接手(Handover)**:换人推进同一 unit 时,新 holder 从**已提交**产物起步,
   未合并的中途修改视为该分支的未完成工作,按常规 Git 流程处理(rebase / 丢弃 / 继续),
   provenance 中 holder 字段随之更新。

### Provenance 标注(可落地)

每份写入 unit 分支的产物、以及每条与该 unit 相关的 audit 条目,标注以下字段
(写入产物头部 front-matter 或 audit 行,以现有 Markdown 载体承载):

```
provenance = {
  unit_id      : string   // 目标 unit
  holder       : string   // 当前推进者标识
  branch       : string   // 所在 Git 分支
  ts           : RFC3339  // 写入时刻
  parent_unit  : string?  // 触发本次写的来源 unit;跨 unit 协调触发时必填
  revision     : string?  // 关联的 revision / commit(若适用)
}
```

规则:

1. **必填字段**:`unit_id` / `holder` / `branch` / `ts` 四项为必填;缺失在 code-review
   视为 finding。
2. **归属一致**:产物/条目的 `unit_id` 必须与其所在分支所认领的 unit 一致;
   出现某 unit 分支上写入了非本 unit 的 `unit_id`,视为越界写 finding。
3. **跨 unit 因果**:因其他 unit 触发而产生的写,填 `parent_unit`(可再补一句来源说明),
   用于事后追溯依赖链;同 unit 内部后续写可不填。
4. **全局态 provenance**:conductor 写全局态时标 `holder=conductor`,不与 unit 产物
   provenance 混淆;`audit.md` 的全局条目沿用现有格式,只补 `holder=conductor` 语义。
5. **只读不标 provenance**:跨 unit 只读访问不产生产物 provenance;如需记录可走 audit
   备注,不污染 unit 产物头部。

### 单元间依赖

unit B 依赖 unit A 输出时,在依赖矩阵为 B 声明 `depends_on:[A]`。调度语义二选一:

- **默认(阻塞)**:A 已 report/committed 后才认领/推进 B;
- **快照(并行)**:B 声明 `snapshot:true`,基于 A 当前**已提交**产物快照推进,不阻塞 A
  继续演进(接受 A 后续变更可能需要 B 再校准)。

依赖矩阵输出新增 `depends_on` 字段(数组,默认空)与可选 `snapshot`(布尔,默认 false)。

## 各 skill 具体修改要求

### 1. aidlc-agent-execution.md

**替换**:

- 定位「conductor 是唯一 state authority」段落。保留其**全局态**的单写者约定,
  但补充**按 unit 分区的产物所有权**语义,替换/新增小节
  `## State Authority & Unit Ownership`:

```
## State Authority & Unit Ownership

- 全局态(aidlc-state.md)权威仍归 conductor,串行更新;unit 不直写全局态。
- unit 产物权威按分区:每个 unit 的产物在其认领分支上,由当前 holder 推进。
- 这是**协作约定**,由 unit select 的公开记录 + code-review 审查守护,
  不是运行时锁;冲突靠成员沟通解决。

### 角色边界
- Conductor:更新全局态(串行),orchestrate report,合并 unit 汇报。
- Holder:在自己认领 unit 的分支上推进该 unit 产物;不写其他 unit 或全局态。

### 跨边界写
需影响其他 unit 或全局态时,发 message 给 conductor,由 conductor 走全局串行路径,
不得直接跨 unit 分支写。
```

**新增小节** `## Unit Lifecycle`:粘上文「Unit 生命周期」5 步
(Select / Work / Depends / Report / Handover),逐步写明 conductor 与 holder 各自动作。

**保留**:portable persona、isolated review、structured return 等既有段不动。
阶段路由职责不动(仍「不负责阶段路由和完成判定」)。

### 2. aidlc-unit-generation.md

- unit 认领段落补充**所有权语义**:认领即公开声明 `holder + branch`;同一 unit 同时应只有
  一个已声明 holder;**鼓励并发认领不同 unit**。认领返回记录扩展为
  `{unit_id, holder, branch, ts}`。
- dependency 矩阵输出新增 `depends_on` 字段(数组,默认空)与可选 `snapshot`(默认 false)。
- 新增 `depends_on` 调度语义说明:B 声明 `depends_on:[A]` 默认在 A report/committed 后
  才推进;声明 `snapshot:true` 则基于 A 已提交快照并行推进,不阻塞 A。

### 3. aidlc-continuity.md

- 状态恢复段落新增 `## 并行 Unit 的恢复与追溯`:
  - 恢复时按分支枚举各 unit 的进行中工作;每份产物 provenance 的 `unit_id/holder/branch`
    即恢复起点线索。
  - 未合并的中途修改属该分支未完成工作,按 Git 常规流程处理,不作为全局态事实。
  - 全局态权威始终以 `aidlc-state.md` 为准;unit 分支产物需经 conductor 汇报后才进入全局态。
- 新增 `## Provenance 追溯`:说明如何用 `parent_unit` 链追溯"某改动由哪个 unit 触发",
  作为审查/调试的追溯手段。

### 4. aidlc-code-review.md

- 审查维度新增 `## Provenance 校验`:
  - 审查每份 unit 产物/相关 audit 条目含 `unit_id`/`holder`/`branch`/`ts` 四项必填字段;
    缺任一 → finding,severity=high。
  - 产物 `unit_id` 与所在分支认领 unit 不一致 → 越界写 finding,severity=high。
  - 某 unit 分支上出现非本 unit 的写入(应走 conductor 路径而未走)→ finding,severity=high。
  - 跨 unit 触发的写缺 `parent_unit` 因果标注 → finding,severity=medium。
- 不改 Spec/Standards 双轴主体结构。

### 5. aidlc-systematic-debugging.md

- 根因分析检查清单新增「Provenance 与边界」项:
  - 复现失败时先查产物/audit 的 `unit_id/branch` 是否与预期 unit 一致,排除"改到了错 unit"。
  - 用 `parent_unit` 链回溯:某状态由哪个 unit 的写触发,是否越界写导致不一致。
  - 查跨 unit 影响是否绕过 conductor 全局串行路径(直接跨分支写)导致全局态与 unit 产物脱节。
- 不改「最小修复与验证」输出格式。

## 验收标准(全部可在当前 Markdown 载体上观测/审查)

1. **并行认领**:多成员/设备并发认领不同 unit,`unit select` 公开记录各自 `holder+branch`,
   无边界混淆;同一 unit 若被重复认领,记录中可见冲突并有沟通解决痕迹。
2. **依赖调度**:unit B 依赖矩阵含 `depends_on:[A]`;默认时 B 在 A report/committed 前不推进;
   `snapshot:true` 时 B 基于 A 已提交快照推进且不阻塞 A —— 可在依赖矩阵与 audit 时序上核对。
3. **Provenance 完整**:每份 unit 产物/相关 audit 条目含 `unit_id/holder/branch/ts` 四项;
   跨 unit 触发写含 `parent_unit` —— code-review 可逐条核对。
4. **归属正确**:任一 unit 分支产物的 `unit_id` 均与该分支认领 unit 一致;无越界写。
5. **跨边界走全局路径**:跨 unit / 全局影响均经 conductor,`aidlc-state.md` 由 conductor 串行更新;
   unit 分支上无直接的跨 unit 写。
6. **可追溯**:给定任一改动,能经 provenance(必要时 `parent_unit` 链)定位其来源 unit 与 holder。
7. **职责不越界**:各 skill 仍「不负责阶段路由和完成判定」;新增约束均为文档规范 + 审查维度,
   无运行时守卫声明。

## 约束

- 不改 skill 间阶段路由职责。
- **不引入新外部依赖、不新增运行时组件**;所有约定以现有 Markdown 控制面
  (`aidlc-state.md` / `audit.md` / 产物 front-matter)承载。
- 不得写入"声称运行时生效但无任何组件执行"的规范(如自动拒写、原子 CAS);
  一致性靠**公开协作记录 + 成员沟通 + code-review 审查**守护。
- provenance 字段名跨 skill 保持一致(`unit_id`/`holder`/`branch`/`ts`/`parent_unit`/`revision`)。
