---
slug: build-and-test
number: "3.7"
name: 构建与测试
phase: construction
execution: ALWAYS
lead_agent: aidlc-quality-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic, express, workshop, bugfix, refactor]
consumes:
  - src/
  - docs/aidlc/construction/code-review.md
produces:
  - docs/aidlc/construction/build-test-report.md
  - docs/aidlc/construction/build-and-test/build-and-test-summary.md
  - .aidlc/evidence/build-and-test/build-test-evidence.json
sensors: [doc-cascade, build-test-evidence]
requires: [code-generation, tdd, code-review]
---

# 构建和测试

**目的**：实际执行构建与测试命令，修复失败并保存可复现证据。生成说明文档不能替代命令执行。

## 前置条件

- 所有计划内单元已完成 TDD 和两阶段审查
- 最终全局审查已通过
- 已加载 `common-test-execution-strategy.md`

### 审查证据阻断（硬性，不可跳过）

进入本步骤前，编排方必须验证以下证据存在且结论为通过：

1. **每单元双轴审查记录**：`docs/aidlc/construction/audit/{unit-id}.md` 中包含 Spec 结果 + Standards 结果，且修复状态为"已修复并复审通过"或"无需修复"。
2. **最终全局审查记录**（C7 触发时）：审计文件中包含 `FINAL_GLOBAL` 模式审查结论且状态为通过。
3. **缺失任一记录或结论非通过时，C8 不得开始**——返回缺失步骤并告知用户原因。

不得以"快速通道""时间紧迫""已目测确认"等理由绕过。C7 条件不满足时只需验证条件 1。

## 步骤 1：识别验证范围和命令

1. 从变更文件、构建配置和 `handoff.md` 识别直接修改的模块、服务与工作单元；读取 I13 `test-cases/_index.md` 和“技术用例执行映射”，确保每个 ready UC-D 进入执行矩阵，I14 跳过时消费 `project/default` 范围。
2. 分布式项目加载 `common-runtime-dependency-analysis.md`，将构建依赖与运行时消费者闭包取并集，划分“必须构建 / 必须测试 / 仅观察”。
3. 按受影响内容加载契约、配置和一致性治理规则，把消费者适配、版本组合、故障恢复和迁移用例加入矩阵。
4. 按测试分层策略选择 L3 或 L4；选择 L3 时记录排除范围和依据。L4 可按服务批次执行，但不能遗漏运行时影响节点。
5. 从项目现有 wrapper、脚本、CI 配置和构建清单提取真实命令，不臆造 Maven、Gradle、npm 或其他命令。
6. 形成执行矩阵：组件/服务、工作目录、构建、静态检查、测试类型、环境、预期退出码和证据位置。

若命令、运行环境、系统基线新鲜度或必要凭据不明确，暂停并向用户询问，不得假设。

## 步骤 2：记录可复现说明

加载 `construction-build-and-test-templates.md`，在 `docs/aidlc/construction/build-and-test/` 生成或更新：

| 文件 | 条件 | 内容 |
|------|------|------|
| `build-instructions.md` | 始终 | 环境要求、真实构建命令、工作目录和故障排查 |
| `unit-test-instructions.md` | 始终 | L3/L4 范围、测试命令和预期结果 |
| `integration-test-instructions.md` | 有跨单元交互 | 环境、数据准备、命令和清理方式 |
| `performance-test-instructions.md` | 有已批准性能指标 | 指标、工具、负载模型和通过阈值 |
| 其他测试说明 | 按需求或风险 | E2E、契约、安全或迁移验证 |

说明文件必须与下一步实际执行的命令一致。

## 步骤 3：实际执行构建

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

1. 执行矩阵中的受影响模块、服务和运行时消费者测试（L3）。
2. 满足 L4 条件时执行全量测试；大型项目按规则分批，任一批失败立即停止。
3. 有对应需求时执行集成、契约、E2E、安全和性能测试。
4. 每次失败均执行根因分析、最小修复和相关范围回归。
5. 修复影响公共代码或接口时，重新计算影响域并扩大测试范围。

所有必需测试必须 0 失败；跳过测试必须有项目配置依据和明确记录。

## 步骤 6：保存验证证据

创建或更新 `build-and-test-summary.md`，至少记录：

| 字段 | 要求 |
|------|------|
| 命令 | 实际执行的完整命令和工作目录 |
| 范围 | L3/L4、模块、批次及跳过项 |
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
- [ ] 选定 L3/L4 测试实际执行且 0 失败
- [ ] 条件测试已执行，或已记录不适用依据
- [ ] `build-and-test-summary.md` 包含命令和结果证据
- [ ] `construction-implementation-report.md` 已生成或更新
- [ ] handoff.md、计划复选框和审计已同步

因环境、凭据、外部服务或资源限制无法执行时，状态必须是“阻塞/未验证”，并列出用户可执行的精确命令；外部证据只有在包含稳定运行标识、不可变代码提交、适用的制品标识/摘要，且与 handoff.md 当前验证目标一致时才能完成。缺失、无法比较或不匹配时保持“未验证”。

## 完成消息

完成消息只展示实际结果：构建命令数量、测试范围、通过/失败数量、条件测试、证据文件和未验证项。禁止使用“应该通过”“预计成功”或仅凭生成说明文档宣称完成。
