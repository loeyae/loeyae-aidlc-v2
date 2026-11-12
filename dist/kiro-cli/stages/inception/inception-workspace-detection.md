---
slug: workspace-detection
number: "0.1"
name: 工作区检测
phase: inception
execution: ALWAYS
# execution: ALWAYS 阶段对所有 scope 无条件执行；下面的 scopes 仅作文档参考，不参与阶段过滤（过滤规则 execution==="ALWAYS" || scopes.includes(scope)，ALWAYS 短路了 scopes）。
scopes: [feature, enterprise, mvp, classic, express, workshop, bugfix, refactor]
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
4. 对完整 scope，向用户展示 `single-module` 与 `multi-module` 两种架构选择（directive 的 `choices` 与 `handoff_prompt` 列出全部选项），必须等待用户回答，不得自行选择；把用户回答的选项作为 `--user-input` 的值报告：

```bash
loeyae-aidlc orchestrate report \
  --stage workspace-detection \
  --result completed \
  --instruction-ack workspace-detection \
  --user-input <single-module|multi-module>
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

- 交给实施前一次核对实际修改的源码库、目标分支、现有未提交改动、可复用 worktree、构建测试命令及报告目录。默认只为本次需修改的源码库准备隔离工作树；用户明确要求更多隔离工作树时遵从其范围。
- 并行 CR 核对共享测试命令是否指向其他模块、报告目录是否会互相清理、数据库迁移版本是否与目标集成分支冲突。已确认的目录和命令写入现有工作区发现/交接产物，不另造重复清单。
- 已有效的工作树与工具能力证据按现有契约复用；不因阶段切换反复创建工作树、复制控制状态或重跑完整探针。发现引擎/扩展本身不兼容时，先完成短边界验证，再启动业务验收链。

- 不得跳过 instruction acknowledgement。
- 不得用未验证的构建或测试结论推进流程。
- 选择 `multi-module` 后，后续阶段以 module manifest 与 unit manifest 组织工作；成员在 Construction 前使用 `unit select` 记录分工。
