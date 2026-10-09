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

## 轻量 scope 的 UC-D 来源（bugfix / refactor / express / workshop）

本阶段 `execution: ALWAYS`，对所有会进入 `code-generation` 的 scope 执行。I13 producer 要求至少存在一个 UC-D 来源锚点文件（四选一），用于把派生出的 UC-D 追溯回一个受控来源：

```text
docs/aidlc/modules/{module-id}/inception/requirements.md
docs/aidlc/modules/{module-id}/inception/user-stories.md
docs/aidlc/modules/{module-id}/inception/application-design.md
docs/aidlc/modules/{module-id}/inception/clarifications.md
```

`feature` / `enterprise` / `mvp` / `classic` 走完整 Inception 路径，上述文件由 `requirements-analysis` / `user-stories` / `application-design` / `requirement-clarification` 等上游阶段产出，本阶段直接消费即可。

**轻量 scope（`bugfix` / `refactor` / `express` / `workshop`）不运行这些上游阶段，不会自动产出任何来源文件。** 这是有意的轻量取舍——执行者针对具体 bug / 重构点 / 微需求直接手写 UC-D，而不是先铺一遍需求/故事/设计。因此在这些 scope 下，**执行者必须在派生 UC-D 之前，手工在上面任一规范路径放置至少一个来源锚点文件**，否则 I13 producer 会以“至少需要一个需求/故事/应用设计/澄清来源文件”硬失败。缺来源不是跳过，而是阻断。

来源锚点文件没有强制 schema，只要求是该路径下的真实 Markdown 文本，并承载 UC-D 的 `source_ref` 可以指向的内容。最小样例（`bugfix`，把 UC-D 锚定到缺陷身份）：

```markdown
<!-- docs/aidlc/modules/{module-id}/inception/clarifications.md -->
# 缺陷澄清：订单导出超时（BUG-123）

## 背景
导出大于 N 条的订单时请求在 30s 处超时，无重试。

## 期望行为
- 导出失败时按指数退避重试，最多 3 次。
- 单次导出超时上限提升到可配置值。

## UC-D 来源锚点
- source_ref: clarifications.md#订单导出超时
- defect_ref: BUG-123
```

随后在 `docs/aidlc/modules/{module-id}/inception/application-design/test-cases/` 下派生 UC-D，令其 frontmatter 的 `source_ref` 指向该锚点（`bugfix` 的 `new` UC-D 还须声明 `defect_ref`，见追溯矩阵的轻量来源锚点规则）。`refactor` 同理：放置一个描述被重构行为基线的来源文件，并为 `characterization` UC-D 声明 `code_refs`。

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
10. 模块拆成多个 unit 时，可在 frontmatter 声明 `unit_refs: [<unit-id>, ...]`（4.8.0）：只能写在 frontmatter，非空、不重复、必须是本模块 `unit-manifest.json` 中的 unit；模块内一旦有 UC-D 声明，全部 UC-D 都必须声明。声明后各 unit 的 tdd / code-generation 只覆盖本单元的 UC-D，build-and-test 对账模块全集；不被任何 `unit_refs` 指向的 unit 须在 `unit-manifest.json` 中声明 `ucd_exemption`（字段见 `knowledge/protocols/test-case-derivation.md`）。全部不声明时保持模块全集覆盖。
11. `code_refs` 指向嵌套独立 git 仓库（4.9.0，`.aidlc/source-roots.json` 中的 `{ "path": "<dir>", "repo": "nested" }`）时，先确认基线已登记该仓库（`orchestrate baseline` 显示待迁移仓库与迁移命令）。已有工作流新增这类 characterization UC-D：用 `unit_refs` 只分配给还没开始 tdd 的单元；模块原来没用 `unit_refs` 时一次给全部 UC-D 补上，已完成单元的 UC-D 指向它们原来的单元。I13 原本产出失败时，迁移后对活动中的 test-case-derivation 执行普通 `evidence run`；I13 已完成时执行 `evidence run --refresh`。已完成单元的 RED / BASELINE / GREEN 不需要任何操作（按单元子集复验，工作流仓库部分仍绑定第 0 代）。

## 完成标准

- [ ] 每个产品 Gherkin 场景至少有一个 UC-D，或有结构化 `non-applicable.json` 及确定性替代验证
- [ ] 每个已批准高风险技术场景有 UC-D，或有结构化不适用依据
- [ ] 每个用例有真实执行锚点和可验证断言
- [ ] `_index.md` 已生成且列出 ready/blocked/deprecated 状态；不适用时目录含 `non-applicable.json`
- [ ] 证据 producer 输出 `test-case-derivation.json`，明确 `required` 或 `not_applicable`
- [ ] 用例 ID 可被 RED、GREEN、代码审查和构建测试阶段追溯
