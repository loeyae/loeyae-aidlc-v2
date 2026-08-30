# AI-DLC 能力关键词与提示词指南

本指南说明 Loeyae AI-DLC v2 的自然语言能力关键词如何使用，以及什么时候应该调用独立 Skill、什么时候应该启动完整的 AI-DLC 阶段流程。

关键词的作用是**发现能力**，不是替代阶段路由、审批、门禁、状态记录或 evidence 协议。能力 Skill 可以独立运行，但仍必须满足自身的输入要求和治理边界。

## 1. 先判断：独立能力还是完整流程

### 独立能力请求

当只需要一次估算、一次代码审查、一次图表调整或一次调试分析时，直接描述能力和目标即可：

```text
请做一次代码审查，检查 /Users/andy/work/my-project/src/order-service.ts
是否符合当前需求和项目编码规范，只返回审查报告，不推进 AI-DLC 阶段。
```

这类请求会发现相应的能力 Skill。Skill 负责完成自己的分析和产物，不自动代替 AI-DLC 的阶段路由、审批或完成判定。

### 完整 AI-DLC 流程请求

当目标是按照确定性流程开发或交付一个功能时，明确使用 AI-DLC：

```text
使用 AI-DLC 开发用户认证模块，范围为 feature。
```

完整流程由引擎返回下一阶段 directive，Agent 必须按 `next`、stage 文件、`report` 和门禁要求执行，不能仅因为命中了“架构设计”或“用户故事”等关键词而跳过其他阶段。

### 关键词请求的通用结构

推荐使用以下结构表达需求：

```text
<能力关键词> + <要做的目标> + <输入/来源路径> + <约束> + <输出或验证要求>
```

例如：

```text
请做需求估算，输入是 /Users/andy/work/my-project/docs/requirements.md，
项目模式是 product-extension，输出工作量区间、假设和置信度，不修改 AI-DLC state。
```

## 2. 关键词速查

下表中的关键词均对应当前独立能力 Skill 的触发词。自然语言不必机械复制整句，但使用高特异性表达更容易发现正确能力。

| 能力 | 推荐关键词 | 适合场景 | 最小输入 |
|------|------------|----------|----------|
| 需求估算 | `需求估算`、`工作量估算`、`人天估算`、`功能点估算`、`功能点分析`、`FPA`、`规模估算`、`effort estimation` | 在详细设计前估算规模、工作量和不确定性 | 需求清单；项目模式必须为 `greenfield`、`product-extension` 或 `legacy-modification` 之一 |
| 粗粒度排期 | `项目排期`、`粗粒度排期`、`排期预测`、`交付预测`、`发布预测`、`里程碑预测`、`release forecast` | 根据需求范围、依赖和团队假设给出 Phase/里程碑时间范围 | 需求或估算结果、团队容量、关键依赖和明确假设 |
| PRD 合成 | `PRD`、`产品需求文档`、`需求文档合成`、`需求整理`、`PRD synthesis`、`业务需求文档` | 将 Discovery 和 Inception 产物整理成业务方可读的 PRD | 已有 Discovery、需求和相关 Inception 产物 |
| 逆向工程 | `逆向工程`、`存量系统分析`、`代码库分析`、`架构发现`、`现有系统梳理`、`reverse engineering` | 分析已有代码库、存量系统和架构边界 | 代码库路径、运行方式、已有文档或关注范围 |
| 用户故事 | `用户故事`、`故事生成`、`验收标准`、`用户场景`、`user story`、`acceptance criteria` | 将已批准需求转成用户中心的故事和验收标准 | 已批准需求、角色、目标和业务约束 |
| 应用/架构设计 | `架构设计`、`应用设计`、`组件设计`、`服务设计`、`应用服务设计`、`系统分层` | 识别功能组件、接口、应用服务和系统分层 | 已确认需求、边界、技术约束和非功能要求 |
| 图表设计 | `画图`、`图表设计`、`业务流程图`、`系统架构图`、`架构图`、`流程图`、`泳道图`、`时序图`、`状态图`、`ER 图`、`部署图`、`diagram`、`architecture diagram`、`flowchart`、`sequence diagram`、`svg` | 创建新图、迁移图表或调整已有 SVG 的布局和路径 | 业务/设计来源、图表目的、输出位置；已有图还应提供 SVG、sidecar、expected contract 和来源文档 |
| 工作单元 | `工作单元`、`单元拆分`、`依赖矩阵`、`故事映射`、`工作单元规划`、`开发单元` | 将系统拆成可独立实现的单元并建立依赖关系 | 已批准需求、用户故事、设计意图和技术边界 |
| UI Mock | `UI 原型`、`HTML Mock`、`页面原型`、`交互原型`、`UI mock`、`页面 Mock` | 根据已批准页面计划生成 HTML Mock | 页面计划、用户流程、组件/布局约束和目标平台 |
| Figma 设计 | `Figma`、`Figma 设计`、`UI 设计稿`、`外部设计稿`、`Figma 页面` | 创建 Figma 设计或登记外部设计稿 | 已批准页面计划、Figma 文件/节点信息或外部设计稿链接 |
| UI 实现桥接 | `Figma 转代码`、`Mock 转代码`、`前端平台规范`、`组件映射`、`设计还原`、`UI 实现规范` | 将 Figma/HTML Mock 翻译为目标平台组件、布局和 CSS 规范 | 设计稿或 Mock、目标前端平台、现有组件和设计系统 |
| 测试用例派生 | `测试用例派生`、`UC-D`、`测试场景`、`验收测试设计`、`test case derivation`、`测试用例设计` | 从批准的产品行为或技术风险派生可执行测试 | 用户故事/验收标准、风险、异常路径和测试环境约束 |
| 系统化调试 | `系统化调试`、`根因分析`、`故障定位`、`问题排查`、`debugging`、`reproducible failure` | 根据可复现失败和原始证据定位最小根因 | 复现命令、原始日志、期望/实际结果、环境和最近变更 |
| 代码审查 | `代码审查`、`代码评审`、`Code Review`、`code review`、`Spec 审查`、`Standards 审查` | 对指定变更做 Spec/Standards 双轴或最终全局审查 | diff/提交范围、需求或 Spec、项目规范和审查范围 |
| 构建测试证据 | `构建测试证据`、`测试证据`、`构建证据`、`生成测试报告`、`build test evidence`、`受控测试证据` | 执行真实构建/测试命令并生成结构化 evidence | 业务项目根目录、受控命令清单、目标 stage/sensor；不要只说“测试一下” |
| 交付配置生成 | `交付配置`、`部署配置生成`、`发布配置`、`deployment config`、`生成部署文件` | 根据已确认部署决策生成目标环境配置 | 已确认部署决策、目标环境、配置模板和密钥/变量来源 |
| 部署配置验证 | `部署配置验证`、`交付配置校验`、`发布配置检查`、`deployment validation`、`部署可执行性检查` | 检查交付配置的静态合法性和可执行性 | 已生成配置、目标环境约束、必需变量和验证命令 |

## 3. 关键词选择的边界

### 使用高特异性关键词

以下表达可以明确发现目标能力：

- “请做**代码审查**”比“帮我看看代码”更明确；
- “生成**构建测试证据**”比“运行测试”更明确；
- “做**部署配置验证**”比“检查部署”更明确；
- “调整已有 **SVG 流程图**”比“优化一下图”更明确；
- “做**需求估算**，项目模式为 `legacy-modification`”比“这个要多久”更明确。

“构建”“测试”“设计”“部署”“代码”这些单独的宽泛词不应被当作可靠路由表达。尤其是构建测试 evidence 需要真实命令和受控 Producer，关键词不能替代 evidence 协议。

### 关键词不会绕过输入要求

命中 Skill 后，仍可能因为信息不足返回 `NEEDS_CONTEXT`。常见缺口包括：

- 估算没有说明项目模式，无法区分全新建设、标品扩展和存量改造；
- 图表没有业务来源或 expected contract，只能看到一张 SVG；
- 调试没有可复现命令和原始失败证据；
- 代码审查没有指定变更范围、需求或规范；
- Figma/UI 请求没有页面计划、目标平台或可访问设计稿；
- 部署验证没有目标环境和配置变量约束。

不要用关键词要求 Skill 猜测缺失的业务事实。补充路径、来源、约束或明确假设后再继续。

## 4. 调整已有 SVG 流程图：推荐提示词

“调整某个 SVG 流程图”通常属于图表设计能力，而不是普通图片编辑。为了让 Agent 能保持业务语义并完成静态/视觉闭环，建议一次性提供以下信息：

1. **目标文件**：SVG 的绝对路径；
2. **来源上下文**：引用该 SVG 的 Markdown、章节或业务蓝图绝对路径；
3. **配套产物**：`.diagram.json`、独立 `.expected.json`、`.provider-request.json`；
4. **生成来源**：如果 SVG 由脚本或公共生成器产生，提供 generator/config 路径；
5. **精确范围**：要移动的节点、要调整的 edge ID 或布局目标；
6. **保持不变项**：节点/边集合、稳定 ID、from/to、端口、业务语义和标签；
7. **目标操作**：`source-only`、`preview`、`render` 或 `export`；未明确时先做 `source-only`；
8. **是否允许提交**：默认不创建 Git commit，除非用户明确要求。

### 示例 A：只调整一条已有连线

```text
请使用 AI-DLC 图表设计能力，修复已有 SVG 流程图中的一条冗余连线。

目标 SVG：/Users/andy/work/my-project/docs/design/assets/order-flow.svg
来源文档：/Users/andy/work/my-project/docs/design/order-flow.md
sidecar：/Users/andy/work/my-project/docs/design/assets/order-flow.diagram.json
expected contract：/Users/andy/work/my-project/docs/design/assets/order-flow.expected.json
Provider Request：/Users/andy/work/my-project/docs/design/assets/order-flow.provider-request.json

目标边：order-flow-edge-pending-to-cancel
问题：当前路径绕到外侧，直达或一折 Manhattan 路径即可完成。

约束：
1. 保留所有节点、边、稳定 ID、from/to、端口和业务语义；
2. 只修改目标边及其必要的 SVG、sidecar、expected/验证同步内容；
3. 先读取来源文档上下文，不能根据坐标或当前折线猜业务关系；
4. 按直达 → 一折 → 最少折点 → 必要外侧 lane 选择合法路径；
5. 同步箭头、标签、points 和受影响 edge 的 changeImpactReview；
6. 目标操作为 source-only，不调用浏览器，不修改 AI-DLC state/audit，不创建 Git commit。

请返回：修改文件、受影响边清单、最终端口和路径、静态检查结果、未验证的 Provider 视图以及仍需我确认的事项。
```

### 示例 B：移动节点并闭包重算相关连线

```text
请使用 AI-DLC 图表设计能力调整已有 SVG 流程图的布局。

目标 SVG：/Users/andy/work/my-project/docs/design/assets/fulfillment-flow.svg
来源章节：/Users/andy/work/my-project/docs/blueprint/fulfillment.md
sidecar：/Users/andy/work/my-project/docs/design/assets/fulfillment-flow.diagram.json
expected contract：/Users/andy/work/my-project/docs/design/assets/fulfillment-flow.expected.json
生成器：/Users/andy/work/my-project/tools/generate_fulfillment_flow.py

布局目标：将“支付成功”节点移动到 Payment Hub 泳道，保持其两条既有业务关系。
约束：不新增或删除节点/边，不改变 from/to、稳定 ID、业务标签和泳道语义。
移动节点后必须枚举全部 incident edges，重新计算端口、路径、箭头和标签；如果最终 SVG 由生成器产生，修改生成源并重新生成 SVG、sidecar、expected 和 Provider Request，不能只手工修改派生 SVG。

先做 source-only 静态验证。只有我随后要求 preview 时，才运行 Provider 的 normal、fit、zoom 三视图；没有三视图证据不得声明视觉 PASS。
```

### 示例 C：完成静态后再请求浏览器视觉验证

```text
上一步 source-only 已通过。请对同一组产物执行 preview：

SVG：/Users/andy/work/my-project/docs/design/assets/order-flow.svg
Provider Request：/Users/andy/work/my-project/docs/design/assets/order-flow.provider-request.json

只验证 normal、fit、zoom 三视图，保存截图和 snapshot。检查节点、连线、标签、箭头、结构性区域遮挡、水平溢出和实际阅读路径。不要修改业务语义或借机重排无关节点；如果 Provider 不可用，返回 NEEDS_CAPABILITY/UNVERIFIED，不要伪造 PASS。
```

### SVG 调整时不要这样提问

```text
把这个图画得好看一点，顺便修一下线。
```

这句话缺少目标文件、来源、修改范围和验收目标，Agent 可能无法区分局部路径修复、连接线驱动布局优化和完整重绘。应明确“哪一张图、哪条边/哪个节点、保持什么不变、需要 source-only 还是三视图 preview”。

## 5. 其他常用提示词模板

### 需求估算与排期

```text
请做需求估算。
需求清单：/Users/andy/work/my-project/docs/requirements.md
项目模式：legacy-modification
已知约束：复用现有订单、库存和支付模块，团队 2 名后端、1 名前端。
请输出类比估算、T-shirt Size、可选 FPA、三点估算、假设、风险和置信度。
不要修改 AI-DLC state/audit，也不要把结果当作阶段完成证据。
```

```text
基于以下需求和估算结果做粗粒度排期预测：
需求：/Users/andy/work/my-project/docs/requirements.md
估算：/Users/andy/work/my-project/docs/estimation.md
团队容量：每周 20 个有效人日；发布窗口为每两周一次。
请按 Phase 输出相对时间范围、里程碑、关键依赖和高风险假设；缺少信息时标记 NEEDS_CONTEXT。
```

项目模式必须明确区分：

- `greenfield`：全新建设；
- `product-extension`：已有标品二次开发；
- `legacy-modification`：存量系统改造。

FPA 是可选的粗估方法，不是所有项目唯一的估算算法。

### 代码审查

```text
请做一次 Code Review。
项目：/Users/andy/work/my-project
变更范围：main..HEAD
需求/Spec：/Users/andy/work/my-project/docs/spec/order-cancel.md
编码规范：/Users/andy/work/my-project/docs/standards/backend.md
请分别检查 Spec 合规性和 Standards 合规性，按 Critical/High/Medium/Low 输出问题、文件行号、证据、修复建议和未覆盖范围。
只生成审查报告，不推进 Construction 阶段。
```

实际使用时也可以直接给出提交范围，例如“审查 `main..HEAD` 的变更”，但应同时说明项目根目录和需求/规范来源。

### 系统化调试

```text
请进行系统化调试和根因分析。
项目：/Users/andy/work/my-project
复现命令：cd /Users/andy/work/my-project && npm run test:checkout -- --runInBand
原始日志：/Users/andy/work/my-project/artifacts/checkout-failure.log
期望结果：取消订单后库存释放一次。
实际结果：库存释放两次，第二次返回 duplicate key。
最近变更：/Users/andy/work/my-project/.git/COMMIT_EDITMSG 对应的提交。
请先复现并区分症状、直接原因和根因，只提出最小修复；修复后运行针对性验证并报告证据。
```

### 用户故事和测试用例

```text
请从已批准需求生成用户故事和验收标准。
输入：/Users/andy/work/my-project/docs/approved-requirements.md
角色：消费者、门店操作员、客服
请保持需求中的非目标和待确认项，不自行补充业务规则，并按故事拆分输出可验证的验收标准。
```

```text
请从以下用户故事和技术风险派生 UC-D 测试用例。
用户故事：/Users/andy/work/my-project/docs/user-stories.md
风险清单：/Users/andy/work/my-project/docs/risks.md
请覆盖主流程、边界、失败、重试、权限和数据一致性场景，输出前置条件、步骤、预期结果、优先级和来源追踪。
```

### UI Mock、Figma 和前端实现桥接

```text
请生成 UI 原型。
页面计划：/Users/andy/work/my-project/docs/ui/page-plan.md
目标：订单取消确认页，包含加载、成功、失败和权限不足状态。
输出 HTML Mock 到 /Users/andy/work/my-project/docs/ui/assets/order-cancel.html。
先使用已有设计系统和组件约束，不接入 Construction，不修改业务代码。
```

```text
请把以下 Figma 页面转换为前端平台规范和组件映射：
Figma 页面说明：/Users/andy/work/my-project/docs/ui/figma-order-detail.md
目标平台：Vue 3 + Element Plus
现有组件目录：/Users/andy/work/my-project/src/components
请输出布局原语、组件映射、响应式约束、状态/可见性规则和无法映射的差异，不要直接修改业务代码。
```

### 构建测试证据、交付配置和部署验证

```text
请生成构建测试证据。
业务项目：/Users/andy/work/my-project
目标 stage：build-and-test
请使用项目已有的 /Users/andy/work/my-project/.aidlc/evidence-commands.json allowlist，执行真实 build、test、check 命令，写入受控 evidence，并报告执行 ID、命令摘要、退出码和失败项。
不要手写 evidence，也不要把“命令没有执行”报告成通过。
```

```text
请生成交付配置。
部署决策：/Users/andy/work/my-project/docs/operations/deployment-decision.md
目标环境：staging
配置模板：/Users/andy/work/my-project/deploy/templates
请生成与目标环境匹配的配置文件，明确变量来源、密钥引用、版本组合和回滚方式；不要执行实际部署。
```

```text
请执行部署配置验证。
配置目录：/Users/andy/work/my-project/deploy/staging
目标环境约束：/Users/andy/work/my-project/docs/operations/staging-constraints.md
请检查 schema、必需变量、引用路径、版本组合和可执行性，只做静态验证和 dry-run，不执行真实发布。
```

## 6. 图表任务的验证状态怎么理解

图表能力的输出状态不能混用：

| 状态 | 含义 |
|------|------|
| `STATIC_PASS` | SVG/sidecar/expected、结构、几何和源级检查通过；没有完整浏览器三视图证据 |
| `PASS` | 源级检查通过，并且本次目标操作取得了真实 Provider 的 normal、fit、zoom 证据 |
| `UNVERIFIED` | 有关键层尚未验证，例如目标浏览器未运行或证据不新鲜 |
| `NEEDS_CONTEXT` | 缺少来源、业务语义、expected contract 或其他必需输入 |
| `NEEDS_CAPABILITY` | 需要的 Provider/平台能力当前不可用 |
| `FAIL` | 已发现结构、几何、语义或视觉问题 |

静态 XML/JSON 检查通过、节点和边数量正确，不能单独证明流程图视觉可读或业务路径清晰。涉及 SVG 流程图时，应根据实际可见图检查主轴、分支、回路、合流、每条边的 from/to、端口法向、箭头、标签和节点/连线遮挡。

## 7. 安装、更新和维护者说明

修改或新增关键词后，已安装平台不会自动刷新当前会话。用户侧需要重新构建/安装并重启对应平台，例如：

```bash
loeyae-aidlc install --all
```

维护者侧的关键词事实来源是：

```text
/Users/andy/work/src/loeyae-framework/loeyae-aidlc-v2/core/skills/*/SKILL.md
```

Kiro Crew 总入口位于：

```text
/Users/andy/work/src/loeyae-framework/loeyae-aidlc-v2/harness/kiro-crew/skills/loeyae-aidlc/SKILL.md
```

源 Skill 通过构建同步到 Claude、Codex、Kiro CLI、Kiro Crew、Kiro IDE 和 OpenCode。更新触发词后，应运行：

```bash
cd /Users/andy/work/src/loeyae-framework/loeyae-aidlc-v2
npm run build:all
npx --no-install tsx tests/test_distribution_parity.ts
git diff --check
```

这份指南用于帮助用户选择和组织请求；新增或删除关键词时，应同步更新速查表和示例，避免 README、指南与 Skill frontmatter 产生漂移。
