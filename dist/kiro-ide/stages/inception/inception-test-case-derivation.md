---
slug: test-case-derivation
number: "2.8.1"
name: 测试用例派生
phase: inception
execution: CONDITIONAL
lead_agent: aidlc-product-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
requires: [application-design]
consumes: [docs/aidlc/inception/application-design.md, docs/aidlc/inception/user-stories.md]
produces: [docs/aidlc/inception/application-design/test-cases/]
sensors: []
condition: has_test_case_sources
approval: notify
---

# 测试用例派生（I13）

本阶段加载 `knowledge/protocols/test-case-derivation.md`，将产品行为和已批准的系统级技术风险翻译为可执行测试用例点 UC-D，建立“需求/设计/CR → 执行锚点 → Construction 证据”的追溯链。

## 执行约束

1. 收集 I7 用户故事中的 Gherkin 场景和已批准的 NFR、CR、契约、配置、迁移或一致性风险来源。
2. 对每个来源派生至少一个可执行 UC-D；每个用例必须包含 `id`、`source_ref`、`scenario_ref`、`type`、`status`、`service_ids` 和覆盖映射。
3. 产品 Gherkin 必须原样保留，不得用技术用例引入未经批准的业务语义。
4. 无法执行的用例标记 `blocked` 并记录待决策项，不得伪造通过。
5. 在 `docs/aidlc/inception/application-design/test-cases/` 生成 `_index.md`，列出用例、来源、类型、服务、状态和证据位置。
6. 任何来源未覆盖、执行锚点不真实或必填字段缺失时，不得报告完成。

## 完成标准

- [ ] 每个产品 Gherkin 场景至少有一个 UC-D，或记录明确不适用依据
- [ ] 每个已批准高风险技术场景有 UC-D，或记录明确不适用依据
- [ ] 每个用例有真实执行锚点和可验证断言
- [ ] `_index.md` 已生成且列出 ready/blocked/deprecated 状态
- [ ] 用例 ID 可被 TDD、代码审查和构建测试阶段追溯
