# 会话连续性模板

---

## 状态源边界

- `docs/aidlc/aidlc-state.json` 是唯一机器路由状态。schema v3 由签名 append-only events 归约出 instance map、ready set、claim/lease 和单调 revision，并通过 CAS 原子更新；Agent 和协议文档不得直接编辑。
- `docs/aidlc/handoff.md` 是从机器状态及协作产物派生的人类交接视图，可记录模块、单元、UI 和 CR 细节，但不能改变实例完成、跳过、审批、assignment、claim、lease 或 ready set。
- 恢复时先执行 `loeyae-aidlc orchestrate next --status` 验证机器状态，再读取 handoff；两者冲突时立即阻断，以签名机器状态为准并重新生成 handoff。
- 如果状态检查因 key ID、签名或 enrollment workflow mismatch 失败，Agent 最多执行只读 `loeyae-aidlc recover inspect` 并报告结果；不得读取/索要/输出 trust secret，不得调用 `recover re-enroll --apply`，不得手改 state、删除 enrollment 或复制签名。持有旧 key 以及同 workflow、旧 key 签名 active source enrollment 的真人必须先确认 state 已 parked，再在独立交互终端完成 dry-run 和绑定 source/target root 摘要的精确短语确认；之后 Agent 重新运行正式状态检查。

## 自动 Checkpoint 与接手语义

- 每次成功 `next`、`report`、条件跳过和审批状态变化都必须先完成签名、revision 递增与原子持久化，再向调用方返回成功。
- Stage instance 成功完成本身就是稳定交接点，不要求用户额外执行“暂停并交接”。其他会话应从已验证 state 发现当前位置或后继工作。
- schema v3 可同时暴露多个稳定排序的 ready instance；恢复时以 actor/device/client identity 取得或恢复当前 client focus 和 execution lease。schema v2 仅保留单游标兼容路径。
- claim receipt 是提交能力，只能通过安全 stdin 用于 `report --instance ... --claim-receipt-stdin`；不得放入 handoff、聊天或 argv。
- `park` 在 schema v3 中冻结整个 workflow，也仍是现有跨 trust-domain re-enroll 的安全前提，但不是同一信任域内日常会话交接或单实例 release 的手段。
- 未完成实例的接手不能仅依据部分产物或聊天声明。协作状态 v3 启用后，必须通过 execution lease 的 release、transfer 或 expiry。

## 统一恢复检查点（所有上下文流转场景）

**本章节是所有会话恢复场景的强制入口点。** 无论是正常恢复、Context Compact 恢复、跨会话交接还是团队协作接手，都必须先执行此检查点。

### 恢复场景识别

| 场景 | 识别信号 | 处理 |
|------|---------|------|
| 新项目启动 | 无有效 enrollment/签名 state | 正常启动流程，不执行恢复检查点 |
| 信任链冲突 | state key/signature 或 enrollment workflow mismatch | fail-closed；只读 `recover inspect`，由真人终端按受控 re-enroll 流程处理 |
| 正常会话恢复 | 存在有效签名 state + 用户说"继续" | 执行本检查点 → 恢复流程 |
| Context Compact 恢复 | 会话摘要中有 compact 标记 或 AI 检测到上下文被压缩 | 执行本检查点（**额外纪律**） |
| 跨会话交接 | 用户粘贴 handoff.md 中的交接提示词 | 执行本检查点 → 交接流程 |
| 团队协作接手 | handoff.md 显示协作模式 + 新角色 | 执行本检查点 → 协作恢复流程 |
| 多模块模式恢复 | handoff.md 显示多模块 + 有活跃模块 | 执行本检查点 → 模块恢复流程 |
| 变更请求恢复 | handoff.md 中有"活跃变更请求"记录 | 执行本检查点 → CR 流程 |

### 强制恢复流程（4 步）

**所有恢复场景必须顺序执行以下 4 步：**

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: 验证签名 state，再读取 handoff.md 人类摘要               │
│ - 运行 orchestrate next --status 确认 ready/active/resolved instances │
│ - 取得 actor/device/client identity 后再用 next 恢复或 claim focus  │
│ - 从签名 state 确认当前模块、单元、choice 与 condition skip     │
│ - handoff 只补充活跃协调、批次、协作者和变更请求说明            │
│ - handoff.md 存在“活跃产品协调”，或 UI `设计状态` 为            │
│   `blocked`/`reconcile_in_progress` 时，读取协调表和问题文件， │
│   加载 `common-workflow-changes.md`，不得跳到后续步骤          │
│ - 存在 `rework_required` 单元时，先恢复上游协调并更新单元定义 │
│   与旧证据；转为 `pending` 前不得调度                         │
│ - 确认系统基线路径、新鲜度和本次受影响节点（如适用）          │
│ - 当前或待恢复的 Construction 单元有 `contract` 依赖时，读取 │
│   可选“共享契约基线”区块中的相关基线状态、代码版本和证据；   │
│   仅 `verified` 可恢复消费者代码生成，其他状态先加载          │
│   `construction-shared-contract-baseline.md` 处理门禁         │
│ - 基线为待复核/过期时先增量刷新，不直接进入实现               │
│ - 只加载当前服务/单元相关的契约、配置和外部证据切片           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 2: 激活对应 Skill                                      │
│ - INCEPTION 阶段 → aidlc-inception                          │
│ - CONSTRUCTION 阶段 → aidlc-construction                    │
│ - OPERATIONS 阶段 → aidlc-operations                        │
│ - 变更请求进行中 → 按变更影响的阶段选择 skill               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 3: 宣布恢复状态                                        │
│ 格式："使用 aidlc-{阶段} 执行 {阶段名称} 阶段"              │
│ 示例："使用 aidlc-construction 执行 Construction 阶段"     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 4: 按场景继续                                          │
│ - 正常恢复 → 展示"欢迎回来"提示，等待用户选择               │
│ - Compact 恢复 → 直接从签名当前 directive 继续              │
│ - 交接恢复 → 从交接提示词指定的步骤继续                     │
│ - 协作恢复 → 展示协作恢复提示，等待角色选择                 │
│ - 模块恢复 → 展示模块恢复提示或直接继续活跃模块             │
└─────────────────────────────────────────────────────────────┘
```

当 Step 1 判定当前阶段为 Construction 时，Step 2 激活 `aidlc-construction` 的同时加载 `construction-compact-recovery.md`，按其步骤定位批次、单元和验证证据；证据缺失时标记 `blocked`，不得按文件存在推断完成。

### Context Compact 恢复的额外纪律

当检测到会话是从 context compact 恢复时（会话摘要中有 compact 标记，或 AI 检测到上下文窗口被压缩重建），除执行上述 4 步外，**额外遵守以下纪律**：

**额外规则**：
1. **检查状态模式** — `状态模式版本` 缺失/低于 2，或缺少分布式治理字段时，保存原恢复位置，先执行定向 I1 检测与必要的 I4 系统基线回填；完成后再恢复原步骤。
2. **不信任会话摘要或 handoff 的机器游标** — 两者都不能替代签名 state。
3. **以签名 `aidlc-state.json` 为唯一机器路由事实** — ready/active/resolved instances、client focus、模块、单元、choice 与跳过结果由编排器验证；handoff.md 只补充人类协作摘要。
4. **重新加载当前步骤的 steering 文件** — 不依赖压缩前的上下文，确保执行规则完整。
5. **检查活跃协调状态** — handoff.md 存在“活跃产品协调”、UI 为 `blocked`/`reconcile_in_progress`，或存在 `rework_required` 单元时，优先按 `common-workflow-changes.md` 恢复冲突裁决、产物同步和失效传播，不得按原下一步骤或原单元继续。
6. **检查“下一步交接”表格** — 不存在活跃协调状态时，优先按其中提示词恢复。

**Compact 恢复的简化流程**：

```
Compact 恢复
    ↓
运行 orchestrate next --status，验证签名 state/ready set/active leases
    ↓
读取 handoff.md 补充活跃协调与人类交接摘要
    ↓
├── 有活跃协调状态？
│     是 → 加载 common-workflow-changes.md 恢复协调；不得改变签名游标
│     否 → 按签名当前 directive 恢复
    ↓
激活对应 skill + 宣布恢复状态
    ↓
从恢复目标继续（不展示完整欢迎提示，直接工作）
```

**Compact 恢复的宣布格式**：

```markdown
Boss，检测到会话上下文被压缩。已验证签名 state，并从 handoff.md 补充人类摘要：

- **阶段**：{当前阶段}
- **步骤**：{当前步骤}
- **下一步**：{下一步描述}

使用 aidlc-{阶段} 继续执行。
```

### 禁止的恢复行为（适用于所有场景）

- ❌ **不要直接从会话摘要的 Pending Tasks 继续编码** — 会话摘要是 AI 生成的，可能不准确
- ❌ **不要跳过 skill 激活直接读取代码文件** — skill 包含必要的执行规则
- ❌ **不要假设阶段状态** — 必须由编排器验证签名 state、ready set、stage_instance 与 lease；handoff 不能代替
- ❌ **不要跳过宣布恢复状态** — 这是团队协作和审计的必要记录
- ❌ **不要在恢复后立即大量加载前序产出物** — 按延迟加载策略按需读取
- ❌ **不要用手改 state、删除 enrollment、任意重签或非交互参数修复信任链** — 只允许真人终端执行受控 `recover re-enroll`

### 恢复后的上下文加载

恢复检查点完成后，按 `common-token-management.md` 的策略加载上下文。核心原则：

**立即加载（~5-8KB）**：
- `handoff.md` — 已在 Step 1 加载
- `audit-summary.md` — 关键决策时间线

**按当前阶段加载（~5-10KB）**：
- 当前步骤的 steering 文件
- 当前步骤的 `decision-summary.md`（如有）

**延迟加载（AI 判断需要时）**：
- 完整需求文档、用户故事、应用设计
- 其他单元/模块的产出物
- 历史审计日志分段

---

## 欢迎回来提示模板
当用户返回继续处理现有的 AI-DLC 项目时，展示此提示：

```markdown
**欢迎回来！我发现您有一个正在进行中的 AI-DLC 项目。**

根据已验证的签名 state（handoff.md 仅补充协作摘要），以下是您当前的状态：
- **项目**：[project-name]
- **当前阶段**：[INCEPTION/CONSTRUCTION/OPERATIONS]
- **当前步骤**：[Stage Name]
- **上次完成**：[上次完成的步骤]
- **下一步**：[下一个要处理的步骤]

**您今天想做什么？**

A) 从上次中断的地方继续（[下一步描述]）
B) 回顾之前的阶段（[显示可用阶段]）

[回答]: 
```

## 强制要求：会话连续性指令
1. **检测到现有项目时，始终先运行编排器状态检查，再读取 handoff.md 补充人类上下文**
2. **从签名 state/current directive 解析机器状态**以填充提示内容
3. **延迟加载产出物**（参见 `common-token-management.md`）— 不再预加载所有前序产物：

   **必须立即加载（~5-8KB）**：
   - `handoff.md` — 全局进度和当前位置
   - `audit-summary.md` — 关键决策时间线

   **按当前阶段加载（~5-10KB）**：
   - 当前步骤的 `decision-summary.md`
   - 当前单元的相关切片文件（如有）
   - 当前步骤的 steering 文件
   - 当前单元存在 `contract` 依赖时，对应共享契约基线表行及 `construction-shared-contract-baseline.md`

   **延迟加载（AI 判断需要时主动读取）**：
   - 完整需求文档 / 需求切片
   - 完整用户故事 / 故事切片
   - 完整应用设计 / 设计切片
   - 其他单元的产出物
   - 历史审计日志分段

4. **按阶段智能加载上下文**：
   - **早期阶段（工作区检测、逆向工程）**：仅加载 handoff.md + audit-summary.md
   - **需求/故事**：加载前序步骤的 decision-summary.md
   - **设计阶段**：加载需求 decision-summary + 故事 decision-summary + 按需读取具体产物
   - **代码阶段**：加载当前单元切片 + shared-interfaces.md + 代码生成计划
5. **根据架构选择和当前阶段调整选项**
6. **显示具体的下一步操作**而非通用描述
7. **在审计分段文件中记录连续性提示**并附带时间戳
8. **上下文摘要**：恢复后，向用户简要说明已加载的上下文和当前位置
9. **提问方式**：始终将澄清问题或用户反馈问题放在 .md 文件中。不要在聊天会话中内联放置多选题。

### 禁止的恢复行为
- ❌ 恢复时预加载所有 Inception 产出物
- ❌ 开始新单元时加载所有已完成单元的设计
- ❌ 每次恢复都加载完整审计日志
- ❌ 加载与当前单元无关的需求/故事/设计

### 页面级修改上下文加载

**触发条件**：用户意图为修改某个具体前端页面（修 bug、调整样式、添加/移除功能入口）。

**加载策略**：当修改目标是一个具体页面时，不能仅加载"该页面原属单元"的产出物，必须按**页面维度**聚合所有相关上下文。

**必须加载**：
1. 该页面的 UI 设计（html-mock 模式为对应端 HTML 文件中的 mock-box；figma 模式为对应 nodeId 的 Frame）— 这是该页面的权威完整描述
2. 需求文档中描述该页面功能的完整段落（通过页面名称检索）
3. 所有提及该页面的用户故事（可能分布在多个单元的故事文件中）
4. 该页面的实际代码文件

**加载方法**：
- 先由编排器验证签名 state/history 中的 I9 choice，再按模式定位 canonical 设计基准：
  - `html-mock` 标准模式：读取当前模块 `ui-mock-manifest.json`，再按其中路径搜索 HTML 页面
  - `html-mock` 大型模式：同样以 manifest 的 PAGE→文件映射定位，不从 handoff 推断目录
  - `figma-create` / `figma-existing`：读取当前模块 `figma-manifest.json` 的 `file_url`、PAGE/Frame/nodeId，再调用 `get_design_context` + `get_screenshot`
    - handoff 中的 `selected/file_created/designing/review_pending/approved` 仅用于向人类展示进度，不能改变签名 choice 或补齐 manifest
  - manifest 页面进度缺失时阻断并重新执行对应 UI Stage/`ui-artifact-consistency`；不得从 handoff 或临时 `get_metadata` 结果静默回填机器事实，也不得重新创建主文件或同名 Frame
- 在需求文档中搜索页面名称，定位相关段落
- 在用户故事文件中搜索页面名称，收集所有相关故事
- 如果 handoff.md 中记录了历史变更（含该页面），加载变更记录确认最新状态

**禁止行为**：
- ❌ 仅加载"创建该页面的原始单元"的产出物就开始修改
- ❌ 忽略后续变更请求中迁入该页面的功能
- ❌ 以旧版 UI 设计或旧版需求为准进行修改（必须以当前产出物内容为准；figma 模式须重新拉取 Frame，不得复用历史上下文中的旧快照）

**规则参考**：页面级单一真相源的完整定义见 `common-page-source-of-truth.md`

## 错误处理
如果在会话恢复期间产物缺失或损坏，加载 `common-error-handling.md` 获取恢复流程指导。

## Session 交接

当用户选择在新 session 中继续时，参见 `common-session-handoff.md` 了解提示词生成规则。新 session 启动后，AI 会通过 handoff.md 自动恢复到正确的位置。

---

## 团队协作模式的会话连续性

### 接力恢复（Inception 阶段，不同角色接手）

当检测到团队协作模式且新角色接手时：

```markdown
**欢迎！检测到团队协作项目。**

**Inception 进度：**
| 步骤 | 状态 | 负责人 | 完成时间 |
|------|------|--------|----------|
[从 handoff.md 读取]

**已完成步骤的关键决策：**
[从各步骤的 decision-summary.md 读取并展示摘要]

**下一步**：[下一个待执行的步骤]

**你要以什么角色继续？**

A) 产品经理 — [具体工作描述]
B) 架构师 — [具体工作描述]

[回答]:
```

**上下文加载策略**：
- 只加载前序步骤的**决策摘要**（decision-summary.md），不加载完整 audit
- 只加载前序步骤的**最终产出物**，不加载中间过程文件
- 如需更多上下文，按需加载（用户请求或 AI 判断必要时）

### 认领恢复（Construction 阶段，开发者接手）

当检测到团队协作模式且 Inception 已完成时：

```markdown
**欢迎！Inception 阶段已完成，可以开始开发。**

**单元认领状态：**
| 单元 | 状态 | 认领人 | 前置依赖 |
|------|------|--------|----------|
[从 handoff.md / unit-of-work.md 读取]

**你想做什么？**

A) 认领一个新单元
B) 继续已认领的单元（[单元名]）

[回答]:
```

**上下文加载策略**（认领或继续单元后）：
- **必须加载**：handoff.md（全局概览）+ 该单元定义 + 依赖接口 + 映射的用户故事
- **加载决策摘要**：需求分析和应用设计的 decision-summary.md
- **不加载**：其他单元的设计、完整 audit、需求讨论过程
- **按需加载**：完整需求文档、应用设计详情（仅在需要时）

### 继续开发恢复（已认领单元，中断后恢复）

当检测到当前用户已认领某单元且 Construction 进行中时：

```markdown
**欢迎回来！你正在开发 [单元名]。**

**当前进度：**
- **单元**：[unit-name]
- **当前步骤**：[功能设计/代码生成/...]
- **计划进度**：[已完成 X/Y 步]
- **上次完成**：[上次完成的具体步骤]

**继续从上次中断处开发？**

A) 继续（从 [下一步描述] 开始）
B) 回顾当前单元的设计产物

[回答]:
```


---

## 多模块模式的会话连续性

### 产品级恢复

当检测到多模块模式且产品级 Inception 进行中时：

```markdown
**欢迎回来！检测到多模块项目的产品级规划。**

**产品级进度：**
| 步骤 | 状态 | 完成时间 |
|------|------|----------|
[从 handoff.md 读取]

**继续产品级规划？**

A) 继续（从 [下一步描述] 开始）
B) 回顾已完成的产品级产出物

[回答]:
```

**上下文加载策略**：
- 加载 `product/` 目录下已有的产出物
- 加载 `product-inception.md` steering 文件
- 不加载任何模块级产出物

### 模块菜单恢复

当检测到多模块模式且产品级 Inception 已完成时：

```markdown
**欢迎回来！检测到多模块项目。**

**模块状态：**
| 模块 | 类型 | 状态 | 进度 |
|------|------|------|------|
[从 handoff.md 读取]

**你想做什么？**

A) 继续产品规划 — 修改模块划分或接口契约
B) 新增模块 — 添加新的业务模块
C) 进入「[模块名]」— [状态描述]
D) ...
[按模块数量动态生成选项]

[回答]:
```

**上下文加载策略**：
- 仅加载 handoff.md + audit-summary.md
- 用户选择模块后，再加载该模块的上下文

### 模块级恢复

当检测到多模块模式且 handoff.md 中有"活跃模块"时：

```markdown
**欢迎回来！你正在开发模块「[模块名]」。**

**模块进度：**
- **模块**：[module-name]
- **阶段**：[Inception/Construction]
- **当前步骤**：[步骤名]
- **上次完成**：[上次完成的具体步骤]

[如有未同步的契约变更，在此提示]

**你想做什么？**

A) 继续当前模块（从 [下一步描述] 开始）
B) 切换到其他模块
C) 回到产品级规划

[回答]:
```

**上下文加载策略**：
- 加载 `product/contracts.md`（检查变更日志）
- 加载 `modules/{当前模块}/` 下的相关产出物
- 不加载其他模块的产出物
- 不加载 `product/product-overview.md`

### 模块切换

当用户在模块级工作中请求"切换到模块 X"时：

1. 保存当前模块的进度到 handoff.md
2. 更新 handoff.md 的"活跃模块"字段
3. 卸载当前模块的上下文（概念上 — 后续不再引用）
4. 加载目标模块的上下文：
   - `product/contracts.md`
   - `modules/{目标模块}/` 下的产出物
5. 检查目标模块的契约变更同步状态
6. 从目标模块的上次中断处继续

**注意**：模块切换本质上等同于一次新的会话恢复，只是不需要重新加载 core-workflow.md 和 handoff.md。

## SSOT 集成(可选)

> 仅在配置了 SSOT 连接时按需加载,规则见 `common-ssot-integration.md`。
- 会话恢复后,若启用 SSOT 则探测 MCP 可达性;不可达时标记检索暂不可用,不伪造结果。
- 本地流程照常(state 优先恢复),不因 SSOT 不可用阻断恢复。
