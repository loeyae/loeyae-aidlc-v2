---
slug: implementation-report
traceability: not_applicable
number: "3.8"
name: 实现报告
phase: construction
execution: ALWAYS
scopes: [feature, enterprise, mvp, classic, express, workshop, bugfix, refactor]
consumes:
  - .aidlc/evidence/build-and-test/build-test-evidence.json
produces:
  - .aidlc/evidence/implementation-report/implementation-report.json
sensors: [doc-cascade, implementation-report]
requires: [build-and-test]
---

# 实施与交付核验

本阶段在 C8 通过后核验交付证据链，产出受控 `implementation-report.json`。它仍是 Construction 的机器核验阶段；不要求单元微型摘要或阶段完整 Markdown 报告。

## 执行

1. 从当前 workflow、模块/单元 manifest 与受控证据确定本次交付范围。
2. 运行当前 directive 的受控 producer 和 sensor，核验适用阶段、审查、构建测试及追溯证据。证据缺失或失效时按具体诊断修复，不能用文字摘要替代，也不因汇总工作重复执行仍有效的测试。
3. 使用 `orchestrate report` 提交结果，由引擎维护 state/audit/ledger；只有门禁通过才能宣称完成。
4. 简短说明实际结果、未解决风险和证据位置，并原样展示返回的 `handoff_prompt`。需要汇总时读取 `orchestrate state summary`。

## 证据完整性

受控核验保留以下适用性边界：

- 核验实际源码变更、批准的需求/UC-D 追溯、单元 Spec/Standards 审查以及真实构建测试结果；删除交付仍核验代码生成阶段的删除路径、基线 blob、需求归属和适用验证。
- 多模块交付覆盖 `module-manifest.json` 中的全部适用模块，不能用一个模块的证据替代另一个模块；跨模块核验引用实际交叉验证证据。
- 仅当初始化签名选择 PRD 时核验 PRD 完整性及 FR 到模块的映射。
- 仅当模块签名 I9 choice 选择 UI 时核验页面计划、HTML/Figma 分支证据及至少一个通过的单元级 UI 对齐证据。未选或跳过时不要求占位产物。
- 启用 validation Provider 时消费当前 scope/source revision 的 Core-signed Evidence 与 GateDecision；知识回执不能代替 validation Gate。
- 不适用项依现有批准来源和门禁记录；未执行、失败或无法核验的项保持真实状态，不写成通过。

## 展示与人工报告

`orchestrate state summary [--module <id>] [--format json|markdown]` 从现有状态和证据生成只读摘要，默认 JSON；供人阅读时使用 `--format markdown`。命令不写文件、不推进阶段、不代替门禁。简单任务默认直接展示简短结果，不同步多份统计文档；用户明确要求导出时可保存到 `.aidlc/views/`，该视图可随时重建，不作为审批或完成依据。

仅在用户明确要求、交付约定或具体风险需要人工说明时编写完整报告。报告引用现有证据与 `code-review.md`，补充真实业务结论、风险、决策和未验证限制；不复制逐 UC-D 清单、全部命令输出或已由机器维护的计数。报告的受众、位置与内容按该交付要求确定，不新增普遍门禁。

需求、设计、契约、运行说明等真正业务产物仍按各自阶段要求维护；精简汇总不豁免这些产物、审批或真实验证。
