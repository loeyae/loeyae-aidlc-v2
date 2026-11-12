# P1-08 最终候选与批次完成验证

本目录记录 P1-08 的工程验收。实现、边界与退出结论见 [P1 记录第 18/19 节](../../../aidlc-autonomous-implementation-p1.md#18-p1-08最终候选native完整矩阵与委托决策汇合)，字段与发布协议见 [契约第 16 节](../../../aidlc-autonomous-contracts-v1.md#16-p1-08最终候选汇合与批次终点)。

批次终结同时核验当前实际候选、完整矩阵、原 Native 门禁、委托决策、真实依赖消费和必需交付物。结果为 verified/failed/blocked/incomplete，人类评审状态独立；只有 current verified 才有 batch_completed=true。范围耗尽、模型 final、观察 passed 和宿主正常退出不替代终结。批次结果不直接将项目设成 done。

## 验证范围

| 项目 | 最终记录 |
| --- | --- |
| 批次结果与真实汇合 | 4 + 12 个场景：预览/签名/幂等/漂移/期限/分母缺失/制品/精确 binding/真实断言失败/委托验证/未来单元范围 |
| 原生宿主配置与执行 | 29 个场景，包含冻结候选命令类型、实际工具前校验、预算和取消 |
| 持续路由 | 22 个场景，包含正式 C8、协调候选准备、四种结果、未知操作阻断和有界证据刷新 |
| 功能、runtime/external 与 UI | 17 + 11 + 10 个场景，真实 Node/HTTP/Chrome；新增 UI passed 仍须 Native UI 接收/还原的拒绝用例 |
| 多单元与准入 | 20 + 20 个依赖场景；40 个准入、1 个路由及 3 个预检场景 |
| 范围、策略与授权 | 44 / 55 / 48 个场景 |
| 其他回归 | sessions、layout、handoff、delivery summary、provider runner、execution policy、TDD gates、TypeScript 检查 |

合计 23 项不同检查。最终选择顺序为 test-results-final.json → test-results-final-2.json → test-results-final-3.json，同名检查采用最后的实际复验。native-host-final-3.log 修正配置夹具必填 input_paths 后覆盖上一轮拒绝；batch-convergence 的最终记录为 final-2。原始失败和开发日志保留，不将失败轮次算作通过。

最终所选 23 项检查全部通过，十种 Harness 构建成功，2938 文件的 Core/宿主分发一致性通过。封存已核验六组实际观察归档，其中订单汇合结果为工程 verified、人类评审 pending，批次完成不设置项目 done。

`run-verification.cjs` 在隔离临时 Git 根运行相关套件，观察归档通过 AIDLC_EVAL_DIR 定位到本目录，不覆盖 P1-07 历史证据。`build-verification.ps1` 对十种 Harness 重建，删除前验证绝对目标在 workspace/dist 内且无链接；仅清理可重建的指定输出。`run-final-checks.cjs` 检查分发一致性、最终 checker 身份、根项目公开只读投影和 diff whitespace。

[verification.json](verification.json) 是封存索引：包含所选日志/源码 SHA-256、实际退出码、十种构建、分发检查、归档签名与原始来源核对、根 state/audit 保持及根授权/运行目录缺席检查。`seal-verification.cjs` 要求全部所选检查及构建退出码为 0，任何签名、摘要或保留条件不符均拒绝封存。[双轴审查](code-review.md) 单独保留 Spec 和 Standards 结论，不冒充业务项目 C7。

首次封存在默认沙箱读取 Git HEAD 时遇到 spawnSync git EPERM，未产生封存索引；在获准的子进程执行环境复验成功，原始日志 seal-final.log 保留。该执行环境限制不计作签名或业务验证通过。

## 实际观察与协议夹具

orders-converged 执行真实 Native I13、RED（实际失败退出 1）、BASELINE 适用性、GREEN、质量/追踪/结构、审查和 C8 生产者，运行真实订单函数/HTTP 断言，然后发布签名 BatchResult。夹具另含未纳入批次的 future 单元，证明它不成为当前实施/审查分母。模拟 H3/实际操作端适配、夹具审查人员和预置 Native completed 行明确标注，不能将它们算为真实人类批准或 Native 模型贯穿运行。

| 归档 | 用途 |
| --- | --- |
| orders-converged/receipt.json | 当前最终候选的完整受控实际观察 |
| orders-converged/batch-result.json | 同候选的签名工程 verified；人类评审 pending，workflow_completed=false |
| orders-converged/decision-declared-observation.json | 委托声明引用的历史签名依据；当前验证另由 current_validation 绑定新观察 |
| orders-converged/batch-state.md | 夹具全局 state 中的唯一当前结果引用 |
| orders-converged/native、batch-inputs、source、observed | Native 及汇合原始引用、候选/来源和运行输出，按封存索引核对 |
| publish-actual | 真实浏览器、交互、版本匹配 HTTP 和整页/关键区域视觉观察；不能替代 Native UI 设计接收 |
| orders-actual、runtime-actual、external-actual、external-preflight-actual | 真实功能/依赖/前置外部观察，partial 保持 partial |

fixture-public-key.json 仅导出公钥和 key_id，不导出 issuer 私钥。归档只是历史工程快照，临时项目已清理；原 grant、观察和服务租期不会因归档延长，不能当作当前业务完成凭据。

## 退出边界

P1-08 工程完成由封存结果确认，P1-09 继续规则/模板/分发消费一致性收口，P1-10 才验收 UI 与无 UI 两个完整真实宿主内部试点。本次没有重跑实际 Native 模型能力探针，不将 P1-06 的历史探针重复计为新证据；没有完整 UI Native 正向批次、完整 npm test 或 P2 故障恢复验收。

当前根项目保持原 DeepSeek workflow 的 state/audit SHA-256，未签发根项目业务 grant、admission、host attempt 或 BatchResult；变更保留在工作区。开发失败留下的指定临时目录已按边界验证清理，记录见 development-cleanup.json。
