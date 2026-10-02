---
slug: test-case-derivation
number: "2.8.1"
name: 测试用例派生
phase: inception
axis: module
execution: ALWAYS
lead_agent: aidlc-product-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic, express, workshop, bugfix, refactor]
requires: [workspace-detection]
consumes: []
produces:
  - docs/aidlc/modules/{module-id}/inception/application-design/test-cases/
  - .aidlc/evidence/test-case-derivation/{module-id}/test-case-derivation.json
sensors: [test-case-derivation]
traceability: not_applicable
condition: ""
approval: notify
---

# 测试用例派生（I13）

本阶段对所有会进入 `code-generation` 的 scope 执行，不受快速通道绕过。它加载 `knowledge/protocols/test-case-derivation.md`，将产品行为和已批准的系统级技术风险翻译为可执行测试用例点 UC-D，并建立“需求/设计/CR → 执行锚点 → Construction 证据”的追溯链。

当当前单元确实没有可执行业务行为（纯声明、纯样式、纯配置或其他经批准的例外）时，必须基于至少一个需求、故事、应用设计或澄清来源，在测试用例目录中生成结构化 `non-applicable.json`，写明 `reason_code`、批准依据、`alternative_validation` 和验证命令；I13 传感器据此输出 `status: not_applicable`。RED/GREEN 阶段还必须在命令清单（`.aidlc/commands/<stage>.json`，不存在时为 `.aidlc/evidence-commands.json`）中各声明且执行唯一一个 `role: "check"` 的受控替代验证命令。缺少来源、文件或成功执行记录均不是跳过，而是阻断。

## 执行约束

1. 收集可用的 I7 用户故事 Gherkin 和已批准的 NFR、CR、契约、配置、迁移或一致性风险来源。
2. 有可执行业务行为时，对每个来源派生至少一个可执行 UC-D；每个用例必须包含 `id`、`source_ref`、`scenario_ref`、`type`、`status`、`service_ids` 和覆盖映射。
3. 产品 Gherkin 必须原样保留，不得用技术用例引入未经批准的业务语义。
4. 无法执行的用例标记 `blocked` 并记录待决策项；存在 `blocked` 时不得进入 RED/GREEN。
5. 在 `docs/aidlc/modules/{module-id}/inception/application-design/test-cases/` 生成 `_index.md`，列出用例、来源、类型、服务、状态和证据位置。
6. 没有业务行为时只能使用 `non-applicable.json`；不得只在 handoff、计划或聊天文本中声明跳过。
7. 任何来源未覆盖、执行锚点不真实或必填字段缺失时，不得报告完成。
8. 每个 UC-D 可在 frontmatter 声明 `tdd_mode`（`new` 默认 / `characterization`）。`characterization` 只用于基线中已存在的行为，必须写非空 `code_refs`（`<项目相对路径>[::<符号>]`，落在源码根内）、`reason` 和 `approval_ref`；`new` 不得写这三项。`bugfix` 至少保留 1 条 `new` 复现 bug。使用 characterization 前工作流须已登记基线（存量工作流执行 `orchestrate baseline --set`）。
9. ready 状态以每个 UC-D 自己的用例文件为准，`_index.md` 中的状态不参与计数。

## 完成标准

- [ ] 每个产品 Gherkin 场景至少有一个 UC-D，或有结构化 `non-applicable.json` 及确定性替代验证
- [ ] 每个已批准高风险技术场景有 UC-D，或有结构化不适用依据
- [ ] 每个用例有真实执行锚点和可验证断言
- [ ] `_index.md` 已生成且列出 ready/blocked/deprecated 状态；不适用时目录含 `non-applicable.json`
- [ ] 证据 producer 输出 `test-case-derivation.json`，明确 `required` 或 `not_applicable`
- [ ] 用例 ID 可被 RED、GREEN、代码审查和构建测试阶段追溯
