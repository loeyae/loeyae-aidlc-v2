# Loeyae AI-DLC for Kiro Crew

此分发物提供 AWS-style 轻量 AI-DLC Skill：用户明确工作目标后，由 Markdown workflow 协调阶段、单元分工、review、构建、测试和人工 merge。

## 使用方式

```bash
loeyae-aidlc orchestrate next --scope feature --work "修复订单导出超时"
loeyae-aidlc orchestrate next
```

控制面：

```text
aidlc/active/aidlc-state.md
aidlc/active/audit.md
```

Agent 应原样展示每个 directive 的 `handoff_prompt`。该提示词包含工作目标、当前阶段、单元、产物和下一步质量动作。

## 团队开发

```bash
loeyae-aidlc unit list
loeyae-aidlc unit select --module module-a --unit unit-a --member alice --branch feat/unit-a
```

成员选择是协作记录；review、构建、测试和 merge plan 才是交付依据。

## 审批与交付

应用设计和部署决策使用：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result approved --user-input Approve
```

完成分支工作后生成 merge plan，并由具有仓库权限的成员人工执行 merge。