# MARS-244：流程职责、迁移与宿主适配

基线：main `a6329d6`（4.21.0，含 MARS-243）。本变更不提升版本，不安装或升级个人宿主，不改真实业务模块，不合并 main 或发布包。实现位于独立的 MARS-244 分支；共享工作区原有改动保留。

## 职责与正式接口

AI-DLC 负责阶段顺序与依赖、范围、产物/追溯、真实证据、质量验收、审批和共享状态领取。宿主负责执行者、模型、会话数、并行、委派拓扑、上下文和内部调度。单会话与宿主自主委派消费同一个流程契约。

`run-stage` 顶层继续提供 `execution_policy`、`requires`、`consumes`、`produces`、`sensors`、`approval`、规则/业务文档加载计划和证据复用计划。不再输出 `agent_execution`、`lead_agent`、`support_agents`、`reviewer_agent`、执行 `mode` 或固定 persona 派发步骤。宿主须读取顶层契约；不得继续只转发旧的 `agent_execution` 对象。不得以兼容开关恢复旧执行门禁。

阶段图为 38 节点。`subagent-execution`、`has_subagent_support` 和 `subagent-evidence` 从正式阶段、条件与 sensor/producer/checker 注册中移除。workflow plan 内的 parallel/并行/subagent 文本不创建执行阶段。运行时会规范化旧缓存图：去除退休阶段、执行元数据和专属日志产物；旧依赖若指向退休阶段，保留为真实上游 `code-generation` 依赖，不能跳过实现。

`agent describe/plan/validate-result` 兼容入口明确失败并说明退休原因。分发不再携带执行 persona 和执行技能；代码审查、设计、产证等独立能力保留。核心不创建 `.aidlc/subagents`，不读取或统计历史子代理日志。成功日志不能代替产物，失败日志也不能阻断其他模块。

审查保留真实 reviewer 记录、Spec/Standards 两轴、问题关闭与覆盖要求；默认不要求额外审查者、固定 persona 或 `execution_context: isolated` / `review_only` 声明。用户明确要求的独立审查仍按用户要求验收。C7 的条件性全局审查、C8/C9 集成和 Operations 审批保持原职责。

## 退休历史执行检查点

升级不会自动写任何业务工作流。先只读检查目标并备份其 state/audit；所有命令仅在需要迁移的项目内执行。

```text
loeyae-aidlc orchestrate upgrade --retire-execution --instance subagent-execution@module:shop@unit:api --human-instruction-ref <实际人类授权来源> --dry-run
loeyae-aidlc module inspect --instance subagent-execution@module:shop@unit:api
```

使用 inspect 返回的当前 claim token，按现有 module bind 协议领取同一精确 instance。更换 owner/session 时必须引用实际人类交接指令；旧会话不得拿新代次自行覆盖。将 bind 返回值仅作为本会话子命令的 `AIDLC_SESSION_BINDING`，然后执行：

```text
loeyae-aidlc orchestrate upgrade --retire-execution --instance subagent-execution@module:shop@unit:api --human-instruction-ref <实际人类授权来源>
loeyae-aidlc orchestrate next --preview
```

拆分布局可给 next preview 指定 `--module shop`。领取 preview 返回的真实下一阶段，再运行 next/report；parked 流程仍需显式 `--resume`。

迁移只写目标工作流：释放指定退休 claim；若它是 current，清空该 current；追加 `execution_retired` history 和 `EXECUTION_CHECKPOINT_RETIRED` audit。原有完成/跳过列表、审批、真实阶段历史、证据及日志不删除或伪造；兄弟模块和 registry 字节保持不变。迁移支持未完成、已完成、parked，以及没有 Current Instance、但 Current Stage/Module/Unit 能唯一匹配的旧单布局记录。无法证明精确归属的旧记录失败关闭，须先由人类澄清映射。

旧 unit manifest 的 `conditional_stages` 中退休值可读并忽略，文件不被隐式重写。正常阶段的审批和受控 Evidence 缺失仍阻断 next/report。已完成阶段的定向重验使用其精确领取，追加 re-attestation，不改变原 parked 状态或真实完成进度。

## 独立写入与发布边界

UI `lock/accept/refresh/reverify/resource-rebaseline/resource-css`、设计资源 staging/CSS API、切片 generate 与 recover --apply 在计算开始时捕获精确 module-axis claim，发布前在与转交相同的 workflow lock 内复验 owner/session/generation。unit claim 不能扩大成模块级发布；另一模块或旧 session 均不能写。切片同时验证 workflow identity。

UI 多文件重基线在同一发布边界内归档和重建；失败回滚旧锁、验收和 checkpoint，临时 JSON 文件会清理。切片保留内容寻址、canonical 不变式、writer/recovery 锁和来源变化检查。

Workflow 锁记录本机 pid、hostname 和 lock id。超过原有陈旧时间阈值时，只有能证明本机持锁进程已死亡才允许在串行恢复边界内回收；活跃、远端或旧格式未知锁不能因年龄被抢占，保证较慢的发布仍与转交互斥。旧格式锁、进程被强制终止留下的未知恢复锁，需要先确认整个目标流程已静止，再人工清理精确的锁路径；不能盲删未知或活跃进程的锁。

已有工作流但无绑定时拒写；没有任何工作流的独立离线 UI 准备保留可用性，期间出现工作流则拒绝采纳旧结果。`check/plan`、recover 预览、upgrade --dry-run 等只读操作不领取或接管流程。

## 版本化 freshness 范围

模块/单元新证据使用 `inputs-v2:module:<id>[:unit:<id>]`，与单/拆分存储布局解耦。默认保留未分类源码/测试、当前产物、共享文件和锁文件；排除已声明为其他模块私有且不与当前模块根重叠的路径。当前模块 `contract_paths` 明确声明的消费者输入优先保留。合理的项目/集成范围保持不变。

需要证明同模块单元互不依赖时，在既有 `unit-manifest.json` 每个单元声明：

```json
{
  "evidence_inputs": {
    "version": 1,
    "paths": ["src/shop/api", "tests/shop/api"],
    "shared_paths": ["contracts/shop-api.json"],
    "depends_on_units": []
  }
}
```

`paths` 必须是本模块 `paths` 下的规范化路径，单元私有根不能相互重叠。真实共享输入放在 `shared_paths` 或模块 `contract_paths`；单元依赖通过 `depends_on_units` 明确声明并传递展开。未知引用、越界、重叠和错误版本拒绝。未声明完整单元所有权时，保守绑定整个模块源码及单元文档。

完整声明后排除无依赖兄弟单元的源码和 Construction 产物；unit manifest 对 scope digest 使用当前单元及依赖的语义投影，同时绑定全部私有路径归属，避免兄弟单元改名导致重验，也不隐藏范围分类变化。当前模块与全局路径/契约归属声明继续绑定；这些经过验证的范围声明即使被 Git 忽略也不能从 scope digest 消失。Git 列出的完整原始文件仍进入诊断用 worktree digest。

新 scoped evidence 按 scope digest 判断 freshness；commit 保留且须能验证为 HEAD 或祖先，producer/checker、时间、身份、摘要格式与审批要求不变。无关模块提交/dirty 标志变化不要求重产证，真实共享依赖、锁文件、当前源码/测试变化仍失效。旧 worktree evidence 沿用原严格校验；旧 module scope 不能证明 v2 覆盖时拒绝复用，按缺失/失效 sensor 的最小充分矩阵重新产证。复用计划只是建议，真实 report 仍执行所有强制门禁。

## 验证与边界

```text
npm run typecheck
npm run build:all
npm run test:mars244
```

定向矩阵覆盖图/正式 directive、历史迁移、会话转交、UI/切片旧会话拒写和合法写入、计算中途交接、多文件重基线失败恢复、scope 正反例、受控审查及复用、I13/RED/GREEN、升级和九套 distribution parity。F2/F3/F4 临时审查探针的负向断言已转为正式回归；F1 通过移除执行门禁验证，不再读取跨模块结果。

测试使用临时 Git 项目和本地故障注入。没有执行真实业务模块 m02/m06/m11，没有把本地 fixture 称作真实 Figma/宿主/MCP 操作成功，没有默认运行全量 npm/Maven 回归。完整结果与命令记录见随本议题交付的验证报告及日志。
