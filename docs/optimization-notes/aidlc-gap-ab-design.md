# 缺口 A/B 技术方案：并行协作门禁 + 跨 module 契约累积对账（供评审）

> 背景：全流程门禁完整性验证发现当前门禁是"单 module 纵向完整",缺"跨 module 横向/并行完整"。
> 两个同源缺口：
> - **缺口A**：`moduleDependencyGraph()` 已算出跨 module 契约消费图,但**未接入 next 门禁**——并行 module 间"消费方等 Owner 交付"无强制。
> - **缺口B**：追溯矩阵是单 module 视角,缺"REQ 消费的跨 module 契约(CT-*)其 Owner module 已交付"的累积对账。
> 本文只定方案,不含实现;评审通过再动手。

---

## 现状锚点（源码核实）

- `checkConsumes(instance, state, graph, instances)`（orchestrate L630）：对**同 module 内** consumes 做"产物存在 + producer 阶段实例完成"校验,返回 failures[]。next 推进时被调用,failures 非空即阻断。
- `moduleDependencyGraph(): ModuleDependency[]`（orchestrate L395）：从 `product-contracts.md`/`runtime-dependencies.md` 解析出 `{provider_module, consumer_module, provider_stage, consumer_stage}` 列表。**已构建但无调用点强制**。
- `isInstanceResolved(state, instanceId)`（L314）/ `completedInstanceIds(state)`：判某阶段实例是否完成。
- `contract-baseline` sensor（L1193）：验单个契约自身 Owner/Consumer 字段齐全,**非**跨 module 交付时序。
- 契约 ID 形态：产物中 `CT-{MODULE}-{NAME}`（如 `CT-SSO-OAUTH2`、`CT-SYSTEM-MANAGER`）,contracts 表列 Owner/Consumers。

---

## 缺口 A 方案：跨 module 契约依赖门禁（接线已有机制）

### 设计原则
不造新对账。把已存在的 `moduleDependencyGraph()` 接入 next 推进门禁,复用 `checkConsumes` 的"provider 已完成"判定模式,只是把范围从"同 module 阶段依赖"扩展到"跨 module 契约依赖"。

### 新增函数 `checkCrossModuleDependencies(instance, state)`（orchestrate）
```
输入:当前要推进的 stage instance(含 module_id, stage.slug)
逻辑:
  1. deps = moduleDependencyGraph()  // 已有
  2. 过滤出 consumer_module === instance.module_id 且 consumer_stage === instance.stage.slug 的边
  3. 对每条边(provider_module, provider_stage):
     - 判 provider_module 的 provider_stage 实例是否已完成(用 isInstanceResolved/completedInstanceIds)
     - 未完成 → failure: "跨 module 依赖未就绪: {provider_module}@{provider_stage} 未完成,
       但本阶段 {consumer_module}@{consumer_stage} 消费其契约"
返回 failures[]
```

### 接入点
在 next 推进的门禁序列里,`checkConsumes` failures 检查**之后**追加 `checkCrossModuleDependencies` failures（同样非空即阻断）。二者互补:checkConsumes 管同 module 纵向,新函数管跨 module 横向。

### 遗留兼容
- `moduleDependencyGraph()` 返回空(无 product-contracts/runtime-dependencies 或无跨 module 边)→ 无 failure,不阻断。存量项目若未声明跨 module 依赖表,自然跳过。
- provider_stage/consumer_stage 默认值已是 `application-design`（L408/409）,与现有解析一致。

### 确定性边界
- ✅ 可确定性判:provider module 的指定阶段**是否完成**(state 实例状态)。
- ❌ 不判:provider 交付的契约**内容**是否满足 consumer 需要(语义)——那是 contract-baseline + review 的职责。
- 门禁只保证**时序**:消费方不能在 Owner 未交付对应阶段时抢跑。

### 改动面
- orchestrate:新增 1 函数 + next 门禁序列 1 处接入。
- 无新 sensor/无产物模板改动/无 stage frontmatter 改动。**纯编排层接线,改动小。**

---

## 缺口 B 方案：矩阵跨 module 契约累积层

### 设计原则
矩阵当前 per-module 跑(`ACTIVE_MODULE`),只看本 module 产物。缺口B 要让矩阵识别"本 module 的 REQ 消费了跨 module 契约 CT-*",并验证该契约的 Owner module 已交付。

### 矩阵 producer 新增"contract 层"
```
在 traceabilityMatrix() 内:
  1. 解析本 module 产物中引用的 CT-{OTHER}-* 契约 ID(REQ/设计/需求文档里)
  2. 对每个被消费的 CT-*:
     - 从 product-contracts.md 查该契约的 Owner module
     - 判 Owner module 是否已交付(其 contract-baseline evidence 存在 / 其 application-design 完成)
  3. 未交付 → 记入新字段 uncovered_contracts(而非 broken_rows)
输出新增:
  consumed_contracts: [CT-SYSTEM-MANAGER, ...]
  uncovered_contracts: [{ct, owner_module, reason}]
  contract_status: passed | BROKEN | not_applicable(无跨module契约)
```

### 硬拦 vs 降级（与 C2 一致）
- 已迁移 module(有 track):consumed 契约的 Owner 未交付 → 进 broken_rows 硬拦。
- 存量 module(缺 track):降级为 advisory(contract_status: MIGRATION_REQUIRED),不阻断。
- 无跨 module 契约消费 → not_applicable。

### 确定性边界
- ✅ 可判:本 module 引用了哪些 CT-*(ID 扫描)、这些 CT 的 Owner module 是否交付(跨 module 状态)。
- ❌ 不判:消费方用法是否符合契约 schema(语义)——contract-baseline/review 职责。

### 改动面
- semantic-checks:`traceabilityMatrix()` 加契约层解析 + 跨 module Owner 交付判定(需读其他 module 的 product-contracts + 状态)。
- **难点**:矩阵 producer 目前只读 `ACTIVE_MODULE` 的产物路径。跨 module 读需要读 product-contracts(产品级,已在 ideation 目录)+ 判 Owner module 完成状态(需访问 workflowState 的 completed 实例)。workflowState 在 producer 里可用(全局),product-contracts 路径固定,可行但比缺口A 改动大。
- 无新 sensor(复用 traceability-matrix);无 stage 改动。

---

## 与缺口 A 的关系

- **缺口A(门禁时序)**:消费方阶段推进前,provider module 对应阶段已完成——**编排层,粗粒度,管"能不能推进"**。
- **缺口B(矩阵内容)**:REQ 消费的具体契约 CT-* 其 Owner 已交付——**对账层,细粒度,管"哪个契约断了"**。
- 二者互补:A 是阶段级时序闸门,B 是契约级覆盖对账。A 拦"整个消费方阶段抢跑",B 定位"具体哪个 REQ 消费的哪个契约缺 Owner"。

---

## 建议实施顺序

1. **先缺口A**:纯编排接线(moduleDependencyGraph→next 门禁),改动最小、风险最低、立即兑现"并行协作门禁"。
2. **再缺口B**:矩阵契约层,改动较大(跨 module 读),但提供细粒度定位。

两者都遵循项目一贯的**存量降级**原则(MIGRATION_REQUIRED/not_applicable + 缺失清单,不硬阻断旧项目)。

---

## 需评审确认的决策点

1. **缺口A 接入点**:在 checkConsumes 之后追加 checkCrossModuleDependencies,provider 未完成即阻断推进 —— 接受吗?
2. **缺口A 判定粒度**:只判"provider module 的 provider_stage 是否完成"(时序),不判契约内容 —— 接受吗?
3. **缺口B 硬拦条件**:已迁移 module 消费的 CT-* 其 Owner 未交付→broken 硬拦;存量降级 —— 接受吗?
4. **缺口B 改动范围**:矩阵 producer 跨 module 读 product-contracts + Owner 状态 —— 接受这个复杂度,还是缺口B 先只做 advisory(不硬拦,纯可见性)?
5. **实施顺序**:先A后B,还是只做A(B 另议)?
