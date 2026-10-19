---
slug: build-and-test
number: "3.7"
name: 构建与测试
phase: construction
execution: ALWAYS
scopes: [feature, enterprise, mvp, classic, express, workshop, bugfix, refactor]
consumes:
  - src/
  - docs/aidlc/modules/{module-id}/construction/{unit-id}/code-review.md
  - .aidlc/evidence/code-generation/{module-id}/{unit-id}/green-test-evidence.json
produces:
  - docs/aidlc/construction/build-test-report.md
  - docs/aidlc/construction/build-and-test/build-and-test-summary.md
  - .aidlc/evidence/build-and-test/build-test-evidence.json
sensors: [doc-cascade, build-test-evidence, test-quality]
requires: [code-generation, code-review]
---

# 构建和测试

**目的**：实际执行构建与测试命令，修复失败并保存可复现证据。生成说明文档不能替代命令执行。

**适用性**：普通行为变更执行实际所需 build/check 与真实非零通过测试。加载 `common-c8-role-applicability.md`：按模块复核已批准项目政策及来源，无声明默认必需；无独立构建/检查时可按契约记录角色不适用，不制造空 build 或重复执行同一检查。可信 I13 已声明无可执行业务行为，或单元的空 UC-D 子集有已批准 ucd_exemption 时，producer 与完成门禁复核来源和声明后允许用真实成功的确定性 check 完成该范围；不存在的构建/测试记录为不适用，测试数如实为零。C8 项目轴必须覆盖所有模块，任一模块需要构建时不能被其他模块豁免。业务范围仍需真实测试；空声明、全 skipped/todo 或来源失效不能豁免。

`consumes` 中的 `src/` 是源码根的规范占位，按 `module-manifest` 的 `paths`（本阶段为 project 轴，取所有模块并集）→ `.aidlc/source-roots.json` → 默认 `src/` 解析，规则见 `construction-code-generation.md`“源码根解析”。命令清单优先使用 `.aidlc/commands/build-and-test.json`，不存在时回退 `.aidlc/evidence-commands.json`；显式 `--config` 仅在指向同一默认查找文件时接受，以便门禁重新绑定命令。

## 前置条件

- 所有计划内单元已完成 GREEN 代码生成、两阶段审查，并具备可复核的 UC-D 测试质量证据
- C7 触发时，最终全局审查已通过
- 已加载 `common-test-execution-strategy.md`

### 审查证据阻断（硬性，不可跳过）

进入本步骤前，编排方必须验证以下证据存在且结论为通过：

1. **每单元双轴审查记录**：`docs/aidlc/modules/{module-id}/construction/{unit-id}/code-review.md` 中包含通过的 Spec + Standards 结果，且无未解决的关键/重要问题；仅建议开放时按严重度计数契约记录，不阻断。
2. **最终全局审查记录**（C7 触发时）：审计文件中包含 `FINAL_GLOBAL` 模式审查结论且状态为通过。
3. **缺失任一记录或结论非通过时，C8 不得开始**——返回缺失步骤并告知用户原因。

不得以"快速通道""时间紧迫""已目测确认"等理由绕过。C7 条件不满足时只需验证条件 1。

## 步骤 1：识别验证范围和命令

1. 从变更文件、构建配置和 `handoff.md` 识别直接修改的模块、服务与工作单元；读取 I13 `test-cases/_index.md` 和“技术用例执行映射”，确保每个 ready UC-D 进入执行矩阵，I14 跳过时消费 `project/default` 范围。
2. 分布式项目加载 `common-runtime-dependency-analysis.md`，将构建依赖与运行时消费者闭包取并集，划分“必须构建 / 必须测试 / 仅观察”。
3. 按受影响内容加载契约、配置和一致性治理规则，把消费者适配、版本组合、故障恢复和迁移用例加入矩阵。
4. 按测试分层策略选择 L1–L4 中最小充分范围，覆盖必要 UC-D 和影响闭包，记录排除依据；不得因单模块、模块数量或进入本阶段自动全量。扩大到 L2/L4 时记录触发原因，L4 可分批，但不能遗漏运行时影响节点。
5. 从项目现有 wrapper、脚本、CI 配置和构建清单提取真实命令，不臆造 Maven、Gradle、npm 或其他命令。
6. 形成执行矩阵：组件/服务、工作目录、构建、静态检查、测试类型、环境、预期退出码和证据位置。

若命令、运行环境、系统基线新鲜度或必要凭据不明确，暂停并向用户询问，不得假设。

## 步骤 2：记录可复现说明

加载 `construction-build-and-test-templates.md`，在 `docs/aidlc/construction/build-and-test/` 生成或更新：

| 文件 | 条件 | 内容 |
|------|------|------|
| `build-instructions.md` | 始终 | 环境要求、真实构建命令、工作目录和故障排查 |
| `unit-test-instructions.md` | 始终 | L1–L4 选定范围、扩大理由、测试命令和预期结果 |
| `integration-test-instructions.md` | 有跨单元交互 | 环境、数据准备、命令和清理方式 |
| `performance-test-instructions.md` | 有已批准性能指标 | 指标、工具、负载模型和通过阈值 |
| 其他测试说明 | 按需求或风险 | E2E、契约、安全或迁移验证 |

说明文件必须与下一步实际执行的命令一致。

## 步骤 3：实际执行构建

TypeScript 开发依赖若仅用于可核实的 noEmit 静态检查，可按 `common-c8-role-applicability.md` 保留批准的 build 不适用政策；核对实际 argv、脚本、所选 tsconfig、本地继承与 CLI 覆盖后的最终语义及来源绑定。被最终 noEmit 抑制的输出设置或闲置 tsconfig 不要求增加构建；真实 emit、增量 build-info、构建流程或未知包装器仍须准确诊断。原生 TAP 可附完整 Node 覆盖率表，不关闭现有覆盖率、不重复运行测试来换摘要。

按执行矩阵逐项运行构建命令：

1. 读取完整输出和退出码。
2. 退出码非 0 时加载 `common-systematic-debugging.md`，定位根因、最小修复并重跑。
3. 不得通过忽略错误、关闭检查或删除失败测试获得通过。
4. 任一必要组件构建失败时，整体状态为阻塞，不进入完成步骤。

## 步骤 4：实际执行静态与安全检查

根据项目已有配置执行适用检查：

- lint、格式检查、类型检查
- 编译器或静态分析
- 依赖/漏洞扫描（项目已配置或需求明确要求时）
- 生成代码、数据库迁移或配置语法检查（适用时）

项目未配置某类检查时记录“未配置（原因）”，不得伪造通过结果，也不得为通过门禁擅自引入新工具。

## 步骤 5：实际执行测试

按 `common-test-execution-strategy.md` 从小到大执行：

1. 按 `common-test-execution-strategy.md` 核对已有证据范围与有效性，复用仍被当前门禁接受的结果；对缺失或失效部分执行目标行为及受影响消费者测试，不默认整个模块。
2. 满足 L4 条件时执行全量测试；大型项目按规则分批，任一批失败立即停止。
3. 有对应需求时执行集成、契约、E2E、安全和性能测试。
4. 每次失败均执行根因分析、最小修复，先复测失败用例及关联范围；不自动重跑已通过且仍有效的全部批次。
5. 修复影响公共代码或接口时，重新计算影响域并扩大测试范围。

所有必需测试必须 0 失败；跳过测试必须有项目配置依据和明确记录。

## 步骤 6：保存验证证据

创建或更新 `build-and-test-summary.md`，至少记录：

| 字段 | 要求 |
|------|------|
| 命令 | 实际执行的完整命令和工作目录 |
| 范围 | 实际 L1–L4 范围、模块、批次、影响分析、排除依据和扩大/全量触发原因 |
| 复用 | 原命令、代码/工作树内容标识、时间、范围、证据位置及相关输入未变化的依据；不满足 freshness 校验时重新受控执行 |
| 结果 | 退出码、通过/失败数量、关键摘要 |
| 修复 | 失败根因、修改文件、重跑结果 |
| 时间 | 执行时间 |
| 外部证据 | CI/契约/测试/配置平台的稳定运行标识、不可变代码提交、适用的制品标识/摘要、范围、结果、位置与时间 |
| 限制 | 未执行项及原因 |

不得把密钥、令牌或含敏感信息的完整日志写入文档；保留足以复现和审计的脱敏摘要。

## 步骤 7：完成判定

仅当以下条件全部满足，才能将构建和测试标记完成：

- [ ] 所有必要组件实际构建成功
- [ ] 适用的静态检查实际通过
- [ ] 选定最小充分范围的必要测试具备实际执行且 0 失败的有效证据；复用满足当前门禁和 freshness 校验
- [ ] 条件测试已执行，或已记录不适用依据
- [ ] `build-and-test-summary.md` 包含命令和结果证据
- [ ] `construction-implementation-report.md` 已生成或更新
- [ ] handoff.md、计划复选框和审计已同步

因环境、凭据、外部服务或资源限制无法执行时，状态必须是“阻塞/未验证”，并列出用户可执行的精确命令；外部证据只有在包含稳定运行标识、不可变代码提交、适用的制品标识/摘要，且与 handoff.md 当前验证目标一致时才能完成。缺失、无法比较或不匹配时保持“未验证”。

## 完成消息

完成消息只展示实际结果：构建命令数量、测试范围、通过/失败数量、条件测试、证据文件和未验证项。禁止使用“应该通过”“预计成功”或仅凭生成说明文档宣称完成。
