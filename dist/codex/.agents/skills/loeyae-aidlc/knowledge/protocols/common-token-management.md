# Token 管理策略

## 概述

本文档定义 AI-DLC 工作流中的 token 消耗控制策略，确保在中大型项目中上下文窗口被高效利用。

**核心原则**：只加载当前任务需要的最小上下文，其余按需获取。

---

## 策略 A：分层摘要机制

### 产出物的三层结构

每个 Inception 阶段的产出物维护三层内容：

| 层级 | 内容 | 大小 | 加载时机 |
|------|------|------|----------|
| L0 - 索引 | 文件列表 + 一句话描述 | ~1-2KB | 每次恢复必加载 |
| L1 - 决策摘要 | 关键决策、约束、注意事项 | ~2-3KB | 跨阶段/跨角色恢复时加载 |
| L2 - 完整内容 | 完整产出物 | ~10-30KB | 仅在当前阶段工作时加载 |

### 决策摘要（L1）生成规则

每个 Inception 步骤完成时，**强制**生成决策摘要文件 `decision-summary.md`，位于该步骤的产出物目录下。

**格式**：
```markdown
# [步骤名称] - 决策摘要

**负责人**：[角色/姓名]
**完成时间**：[ISO 时间戳]

## 关键决策
- [决策1]：[选择的方案]，原因：[理由]
- [决策2]：[选择的方案]，原因：[理由]

## 核心需求/设计要点（精炼列表）
- [要点1]
- [要点2]

## 约束条件
- [约束1]
- [约束2]

## 注意事项
- [需要后续阶段特别注意的点]

## 未解决问题
- [问题1]：建议由 [角色] 在 [步骤] 中决定
```

**大小控制**：决策摘要不超过 3KB。如果超过，说明内容不够精炼，需要进一步提取。

---

## 策略 B：审计日志分段化

### 分段规则

审计日志按阶段和单元拆分为多个文件：

```
docs/aidlc/
├── audit-summary.md                    ← 极简时间线（必加载，~2KB）
├── inception/
│   ├── audit-inception.md              ← Inception 阶段完整审计
│   └── ...
└── construction/
    ├── audit-construction-unit-1.md    ← unit-1 的审计
    ├── audit-construction-unit-2.md    ← unit-2 的审计
    └── ...
```

### audit-summary.md 格式

```markdown
# 审计摘要

## 项目时间线
| 时间 | 阶段/步骤 | 关键事件 |
|------|-----------|----------|
| 2026-05-01 | 工作区检测 | 识别为存量项目，Vue 3 + Spring Boot |
| 2026-05-02 | 需求分析 | 确定 8 个功能需求，3 个 NFR |
| 2026-05-03 | 用户故事 | 生成 12 个用户故事，3 个角色 |
| 2026-05-04 | 应用设计 | 5 个服务组件，3 个前端模块 |
| 2026-05-05 | 单元生成 | 拆分为 5 个单元 |
| 2026-05-06 | unit-1 代码生成 | 完成 7/7 步 |
| 2026-05-07 | unit-2 代码生成 | 进行中 3/5 步 |

## 当前状态
- **活跃单元**：unit-2 (payment-service)
- **最近决策**：选择 Stripe 作为支付网关
```

### 写入规则

- **当前阶段的审计**：写入对应的分段文件（如 `audit-construction-unit-2.md`）
- **审计摘要**：每次阶段转换或关键决策时，追加一行到 `audit-summary.md`
- **恢复时**：只加载 `audit-summary.md`（~2KB），不加载历史分段
- **需要历史时**：按需读取特定分段文件

### 向后兼容

如果检测到旧格式的单一 `audit.md` 文件，继续使用它（不强制迁移）。新项目默认使用分段格式。

---

## 策略 C：Steering 文件按需加载

### 加载层级

**第一层：启动时加载（必须，~15KB）**
- `core-workflow.md` — 主控逻辑（始终加载）

**第二层：恢复时按需加载（~3-5KB）**
- `common-session-continuity.md` — 仅在检测到现有项目时加载
- `common-team-collaboration.md` — 仅在团队协作模式时加载

**第三层：进入阶段时加载（~5-10KB）**
- 当前阶段的 steering 文件（如 `inception-requirements-analysis.md`）
- `common-content-validation.md` — 仅在需要创建文件时加载
- `common-question-format-guide.md` — 仅在需要提问时加载

**第四层：执行特定任务时加载（按需）**
- `common-quality-gates.md` — 仅加载当前阶段的检查清单片段（见下方）
- 编码规范文件 — 仅在代码生成阶段加载
- `common-ascii-diagram-standards.md` — 仅在需要创建图表时加载

### 质量门禁按需加载

**不再**在每个阶段都加载完整的 `common-quality-gates.md`（~8KB）。

**改为**：core-workflow.md 中已经内联了每个阶段的质量门禁检查清单（以 `- [ ]` 列表形式）。执行质量门禁时：
1. 使用 core-workflow.md 中内联的检查清单
2. 仅在需要了解门禁执行流程或失败处理时，才加载完整的 `common-quality-gates.md`

### 欢迎消息优化

`common-welcome-message.md` 仅在新工作流首次启动时加载一次，后续交互不再加载（当前已实现）。

---

## 策略 D：产出物延迟加载

### 恢复时的加载策略

**必须立即加载（~5-8KB）**：
- `state.md` — 全局进度和当前位置
- `audit-summary.md` — 关键决策时间线

**按当前阶段决定是否加载**：
- 当前步骤的 decision-summary.md（~2-3KB）
- 当前单元的相关切片文件（如有，见策略 E）

**延迟加载（AI 判断需要时主动读取）**：
- 完整需求文档
- 完整用户故事
- 完整应用设计
- 其他单元的产出物
- 历史审计日志

### 延迟加载的触发条件

AI 在以下情况下主动读取延迟加载的文件：
- 需要理解某个需求的详细验收标准
- 需要确认接口契约的具体参数
- 需要查看依赖单元的设计细节
- 用户提问涉及之前阶段的决策

### 禁止预加载

以下行为**不再允许**：
- ❌ 恢复到代码生成阶段时，预加载所有 Inception 产出物
- ❌ 开始新单元时，加载所有已完成单元的设计
- ❌ 每次恢复都加载完整 audit.md

---

## 策略 E：文档切片（多单元项目）

### 触发条件

当单元生成完成且项目有 **2 个或以上单元**时，执行文档切片。

### 切片操作

在单元生成步骤完成后，自动将以下 Inception 产出物按单元拆分：

**需求文档切片**：
```
docs/aidlc/inception/requirements/
├── index.md                      ← 需求索引（极简）
├── shared-requirements.md        ← 跨单元共享需求（NFR、全局约束）
├── unit-{name}-requirements.md   ← 各单元的需求子集
└── decision-summary.md           ← 决策摘要
```

**用户故事切片**：
```
docs/aidlc/inception/user-stories/
├── index.md                      ← 故事索引
├── shared-stories.md             ← 跨单元共享故事（如有）
├── unit-{name}-stories.md        ← 各单元映射的故事
└── decision-summary.md           ← 决策摘要
```

**应用设计切片**：
```
docs/aidlc/inception/application-design/
├── index.md                      ← 设计索引
├── shared-interfaces.md          ← 跨单元接口契约
├── unit-{name}-design.md         ← 各单元的组件/服务设计
├── unit-of-work.md               ← 保留（含认领状态表）
├── unit-of-work-dependency.md    ← 保留
├── unit-of-work-story-map.md     ← 保留
└── decision-summary.md           ← 决策摘要
```

### 索引文件格式

```markdown
# [产出物类型] 索引

## 项目概述
[一句话描述]

## 单元分布
| 单元 | 条目数 | 文件 | 摘要 |
|------|--------|------|------|
| user-service | 8 | unit-user-service-requirements.md | 用户注册、登录、权限管理 |
| payment-service | 6 | unit-payment-service-requirements.md | 支付、退款、账单 |

## 共享内容
- 文件：shared-requirements.md
- 包含：[简要描述]
```

### 切片依据

- **需求**：根据 `unit-of-work-story-map.md` 中故事到单元的映射，反向追溯需求到单元
- **用户故事**：直接使用 `unit-of-work-story-map.md` 的映射关系
- **应用设计**：根据 `unit-of-work.md` 中单元包含的组件/服务进行切片

### 原始文件处理

切片后，原始完整文件**重命名为归档**：
- `requirements.md` → `requirements.full.md`
- `stories.md` → `stories.full.md`

归档文件不删除，但不再默认加载。仅在需要全局视图时按需读取。

### 单单元项目

如果项目只有 1 个单元，**不执行切片**（没有意义，反而增加文件数量）。

---

## 策略 F：模块隔离加载（多模块项目）

### 触发条件

当 state.md 中 `架构模式 = 多模块` 时，启用模块隔离加载策略。

### 加载规则

| 工作层级 | 加载内容 | 禁止加载 |
|----------|---------|---------|
| 产品级工作 | `product/` 目录下的产出物 | 任何模块的产出物 |
| 模块级工作 | `product/contracts.md` + `modules/{当前模块}/` | 其他模块的产出物、`product/product-overview.md` |
| 模块切换 | 卸载旧模块上下文，加载新模块上下文 | 同时加载两个模块 |

### 模块级恢复的加载清单

```
恢复到模块 X 的 Inception：
- core-workflow.md: ~15KB
- state.md: ~3KB（只看模块进度）
- audit-summary.md: ~2KB
- product/contracts.md: ~3-5KB（模块间契约）
- modules/X/inception/ 下的当前步骤产出物: ~5-10KB
- 当前步骤的 steering 文件: ~5-10KB
总计: ~35-45KB
```

```
恢复到模块 X 的 Construction unit-N：
- core-workflow.md: ~15KB
- state.md: ~3KB
- audit-summary.md: ~2KB
- product/contracts.md: ~3-5KB
- modules/X/inception/ 的需求切片: ~3KB
- modules/X/inception/ 的故事切片: ~2KB
- modules/X/inception/ 的设计切片: ~3KB
- modules/X/construction/ 当前单元设计: ~3KB
- 当前步骤的 steering 文件: ~8KB
总计: ~42-50KB
```

### 关键优势

- 上下文消耗不随产品规模（模块数量）增长
- 只与当前模块的复杂度相关
- 模块间物理隔离，不会意外加载无关内容

### 契约变更检查

模块级恢复时，额外执行：
1. 读取 `product/contracts.md` 的"变更日志"区域
2. 筛选"状态 = 待同步"且"影响模块"包含当前模块的记录
3. 如有未同步变更，在恢复后立即提示用户

---

## 加载策略总览

### 新会话启动（新项目）

```
加载：core-workflow.md（~15KB）
加载：common-welcome-message.md（一次性，~4KB）
总计：~19KB
```

### 会话恢复（Inception 阶段）

```
加载：core-workflow.md（~15KB）
加载：state.md（~3-5KB）
加载：audit-summary.md（~2KB）
加载：当前步骤的 steering 文件（~5-10KB）
加载：前序步骤的 decision-summary.md（~2-3KB × N）
总计：~30-40KB（vs 当前 ~100KB+）
```

### 会话恢复（Construction 阶段，单元开发）

```
加载：core-workflow.md（~15KB）
加载：state.md（~3-5KB）
加载：audit-summary.md（~2KB）
加载：当前单元的需求切片（~3KB）
加载：当前单元的故事切片（~2KB）
加载：当前单元的设计切片（~3KB）
加载：shared-interfaces.md（~3KB）
加载：当前步骤的 steering 文件（~5-10KB）
加载：代码生成计划（如在代码生成阶段，~5KB）
总计：~45-55KB（vs 当前 ~150KB+）
```

### 会话恢复（多模块模式，产品级工作）

```
加载：core-workflow.md（~15KB）
加载：state.md（~3KB）
加载：audit-summary.md（~2KB）
加载：product/product-overview.md（~3KB）
加载：product/modules.md（~3KB）
加载：product/contracts.md（~5KB）
加载：product-inception.md steering（~5KB）
总计：~36KB
```

### 会话恢复（多模块模式，模块级 Inception）

```
加载：core-workflow.md（~15KB）
加载：state.md（~3KB）
加载：audit-summary.md（~2KB）
加载：product/contracts.md（~3-5KB）
加载：modules/{name}/inception/ 当前步骤产出物（~5-10KB）
加载：当前步骤的 steering 文件（~5-10KB）
总计：~35-45KB
```

### 会话恢复（多模块模式，模块级 Construction）

```
加载：core-workflow.md（~15KB）
加载：state.md（~3KB）
加载：audit-summary.md（~2KB）
加载：product/contracts.md（~3-5KB）
加载：modules/{name}/inception/ 需求切片（~3KB）
加载：modules/{name}/inception/ 故事切片（~2KB）
加载：modules/{name}/inception/ 设计切片（~3KB）
加载：modules/{name}/construction/ 当前单元设计（~3KB）
加载：当前步骤的 steering 文件（~8KB）
总计：~42-50KB
```

---

## 实施优先级

1. **审计日志分段化**（策略 B）— 立即生效，无需改动现有产出物
2. **Steering 按需加载**（策略 C）— 修改加载指令即可
3. **延迟加载**（策略 D）— 修改 session-continuity 的恢复策略
4. **决策摘要**（策略 A）— 每个步骤完成时生成
5. **文档切片**（策略 E）— 在单元生成步骤中增加切片操作

---

## 监控与调优

### Token 消耗警告

如果单次恢复加载的上下文超过 60KB，AI 应：
1. 在 audit-summary.md 中记录警告
2. 评估是否有文件可以延迟加载
3. 向用户建议优化（如手动归档已完成单元的产出物）

### 定期清理

每个单元完成并合并后：
- 该单元的 audit 分段可以归档（移到 `archive/` 目录）
- 该单元的设计切片不再需要加载
- state.md 中标记为"已完成"的单元信息可以精简
