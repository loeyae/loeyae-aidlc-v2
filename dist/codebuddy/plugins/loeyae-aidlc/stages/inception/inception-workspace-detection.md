---
slug: workspace-detection
number: "0.1"
name: 工作区检测
phase: inception
execution: ALWAYS
lead_agent: aidlc-architect-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic, express, workshop]
consumes: []
produces: []
sensors: []
completion_contract: instruction_only
choices: [single-module, multi-module]
---
# 工作区检测

## 目标

基于用户给出的明确工作描述，识别项目根目录、现有代码、构建与测试入口、模块边界以及当前变更的风险范围。

工作流状态与审计位于：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

## 执行步骤

1. 读取当前 directive 的工作目标与 `handoff_prompt`。
2. 检查项目根目录、版本控制状态、主要语言、构建系统、测试入口和现有模块。
3. 记录实际发现，不从文件名、聊天记录或未验证的假设推断技术栈。
4. 对完整 scope，向用户展示 `single-module` 与 `multi-module` 两种架构选择；通过报告保存选择：

```bash
loeyae-aidlc orchestrate report \
  --stage workspace-detection \
  --result completed \
  --instruction-ack workspace-detection \
  --user-input single-module
```

5. 生成工作区发现产物，并在 `handoff_prompt` 中清楚说明下一个阶段、当前 module/unit 与所需证据。

## 输出要求

工作区发现应包含：

- 现有代码与主要技术栈；
- 构建、测试、静态检查入口；
- 项目结构与模块边界；
- 需要补充或确认的风险；
- 对本次工作目标的直接影响。

## 质量边界

- 不得跳过 instruction acknowledgement。
- 不得用未验证的构建或测试结论推进流程。
- 选择 `multi-module` 后，后续阶段以 module manifest 与 unit manifest 组织工作；成员在 Construction 前使用 `unit select` 记录分工。
