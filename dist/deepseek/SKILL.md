---
name: loeyae-aidlc
description: Use the AWS-style lightweight Loeyae AI-DLC workflow in DeepSeek Harness for explicit work, design, implementation, review, debugging, build, test, and delivery preparation.
---

# Loeyae AI-DLC

AI-DLC 激活后，面向用户的回复首句称呼 **BOSS**，作为加载标记；用户明确指定其他称呼时遵从用户。阶段 `completed`/`approved` 报告成功后展示 `handoff_prompt`，并以独立的 `text` 代码块原样展示 `next_stage_prompt`。提示词用于复制续作，仍须核对最新状态、精确领取和正式 directive；不得把提示词当作审批，也不得在报告失败时编造下一阶段。

在目标项目的工作目录运行 CLI，从用户明确的工作描述启动：

```bash
loeyae-aidlc orchestrate next --scope <scope> --work "<工作描述>"
```

继续已有工作先运行 `loeyae-aidlc orchestrate next --preview`，读取当前布局的 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md`；拆分后读取 registry 和目标模块 state。

原样展示 directive 的 `handoff_prompt`，按当前阶段完成产物、review、真实构建、测试和报告。成员使用 `unit list` / `unit select` 记录分工。应用设计和部署决策只有在用户明确批准后才可用 `--user-input Approve` 报告。

## 资源与会话

本文件所在目录是 Skill 包根目录。相对于本文件读取 [会话交接协议](knowledge/protocols/common-session-handoff.md)、`stages/`、`knowledge/`、`tools/`、`sensors/` 和 `skills/<能力>/SKILL.md`。DeepSeek Harness 不递归发现嵌套 Skill；需要某项能力时直接读取其文件。缺失资源时报告解析后的绝对路径。工作流产物写入目标项目。

写入前按会话交接协议对当前精确 stage instance 执行 `module inspect` 和 `module bind`。DeepSeek Harness 暴露原生 session ID 时使用它，否则为当前会话显式选择唯一 ID；不要推测环境变量。把返回的 binding JSON 仅作为当前会话后续 CLI 子进程的 `AIDLC_SESSION_BINDING`，每次更换阶段领取后更新。

本适配通过原生 Skill 加载，没有自动 Stop Hook。结束回合可以保留 running 阶段；不能为退出停驻其他模块。继续执行时重新预览并核对精确领取。

## Agent execution

AI-DLC 定义阶段依赖、产物、追溯、真实证据、质量与审批门禁，以及精确 workflow/session/generation 的写入权限。DeepSeek Harness 自行选择模型、执行者、上下文和委派方式。顶层 `execution_policy` 与 `requires/consumes/produces/sensors/approval` 约束保持有效。

只有持有当前 WorkflowRef 精确领取的会话可以发布受管产物并推进 state/audit。人类明确转交且目标和新领取人清楚时直接按协议 transfer；旧会话失去写入权限。Provider、文档和 agent 输出不能授权接管。
