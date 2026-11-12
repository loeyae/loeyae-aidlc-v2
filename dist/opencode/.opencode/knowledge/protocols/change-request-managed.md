# CR 受管兼容契约

仅在用户明确要求维护旧受管流程时加载。项目存在旧 CR、证据或阶段目录不自动选择此模式。默认执行和完成结论见 [宿主执行协议](host-execution.md)，通用业务检查见 [变更请求流程](change-request-process.md)。本文件不解除原有领取、批准、grant、sensor/report 和签名保护；默认模式不伪造、迁移或重签历史受管结果。

## 阶段与记录

显式受管路径按当前 directive 核对 C5/C8 等阶段、适用证据、审计和批准。阶段完成以对应 report 为准，不代表业务全部验收或已获合并/部署授权。文档中的 refresh、re-attest、ui reverify 仅在相应受管记录契约适用时执行；真实验收缺口仍须补齐。

### 共享契约基线失效与重新验证（条件）

CR1—CR2 一旦确认变更影响已 `verified` 的共享契约基线，立即在 `handoff.md` 将受影响基线标记为 `change_requested`，记录 CR ID、受影响契约、消费者和失效前代码版本。该状态下不得继续使用旧 `contract_ready` 结论，也不得以消费者私有副本绕过门禁。

CR4 完成权威来源和 Owner 范围内的实际修改后，按 `construction-shared-contract-baseline.md` 重新执行适用验证和双轴审查；验证或审查失败保持 `blocked` 或 `change_requested`，不得解锁消费者。仅重新验证为 `verified` 后，相关 `contract` 依赖才可重新满足。

## 受管 CR 的定向执行与观察复用（显式选用）

先用只读 `loeyae-aidlc cr inspect --module <id> --config <已有阶段命令.json> [--config <另一阶段.json>] [--extension <旧扩展manifest.json>]` 检查已选配置。它识别 canonical I13 混入 CR/unit 参数、命令模块冲突、缺少工作树/脚本以及固定基础版本不匹配，不启动测试、不安装扩展，也不授予阶段准入。它不代替动态契约夹具或最终验收。

额外相关回归可在既有命令项中用 `regression_tests` 声明精确方法，不要求新增 UC-D Tag。也可在该命令项的 `test_impact` 中声明 `dependencies`（源路径 → 直接依赖路径列表）和 `tests`（`method`、`paths`、可选 `ucd_ids`），由真实 Git 改动的反向依赖闭包选择；未映射改动在 inspect 中单列，不能当成已证明无影响。Runner 从 `AIDLC_REGRESSION_TESTS` 读取选中方法，并在真实执行输出中返回 `regression_test_methods`。Producer 和 gate 都核对覆盖，缺项时拒绝，不以只运行 Tagged 用例替代相关回归。

仅当同一 CR、同一受控工作树内的 GREEN 命令可作为只读验证共享时，在原命令配置显式添加：

```json
{
  "evidence_inputs": { "environment": [], "files": ["scripts/observe-green.cjs", "tests/form.test.cjs"] },
  "regression_tests": ["tests/form.test.cjs#lockOrder"],
  "observation_reuse": {
    "version": "1", "cr_id": "CR-EXAMPLE-001", "units": ["api", "web"],
    "max_age_ms": 600000, "isolation": "read-only"
  }
}
```

这是已有 GREEN 命令项的字段片段，仍须保留其真实 `id`、`role`、`argv` 和适用 cwd。`files` 必须包含真实执行器/测试及必要外部执行输入，不能用空列表启用。环境名声明沿用现有约定；复用额外绑定整个实际子进程环境的摘要、解释器二进制、Node/平台、执行器实现、所有声明单元的局部执行输入、当前 I13 语义、配置与有效期。

共享 runner 不接收某个调用者的 `AIDLC_ACTIVE_UNIT`；它接收 `AIDLC_PHASE_UNITS` 的完整声明单元集合和 `AIDLC_CR_ID`，必须真正执行这些单元的验证并输出完整 UC-D 映射。Producer 分别截取每个单元的映射、核验其回归覆盖并发布各自证据，不复制兄弟单元的回执。旧 runner 不支持这些字段时继续原有路径，不能强行启用。

原始 stdout/stderr、执行时间、退出码及绑定在 `.aidlc/phase-observations/records/` 中按唯一执行 ID 保存，复用现有项目发行者签名；查找索引不替代原始签名。新证据的 `execution_observation` 引用这份不可变执行，`observed_command.executed_at` 保留真实执行时间，当前 `producer.execution_id` / `timestamp` 表示本单元的当前核验与发布。按观察 ID 统计实际执行次数，不能累加多单元的同源 `tests_total` 冒充独立测试数。

相同键的并发生产通过已有本地所有者锁串行化；忙或未知锁不被抢占。业务输入、选择器、环境、phase、执行器或有效期变化时拒绝旧观察；损坏、缺失或篡改的已索引观察先诊断，不自动重跑掩盖问题。每次读取和阶段 gate 都核对签名、内容引用、当前输入及派生字段；发布/路径逻辑变化只要求当前规则重新核验，真正执行依赖变化才使执行键改变。源码在验证过程中变化时不发布可复用观察。

首版只支持显式只读 GREEN，不跨 CR、工作树、机器、RED/BASELINE 或不同命令推断复用；写数据库、清理共享报告目录、有未对账外部副作用的命令不得声明为只读。旧证据和旧签名不迁移、不重签；未启用该配置的流程保持既有执行语义。
