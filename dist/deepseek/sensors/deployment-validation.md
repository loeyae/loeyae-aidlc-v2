---
id: deployment-validation
name: Deployment Validation
description: Binds actual deployment configuration files to successful allowlisted checks.
---

# 部署配置验证

在 `.aidlc/commands/operations-authorization.json` 登记所选部署配置 `artifacts`（id、项目相对 path）和允许执行的 `commands`。每个配置必须有相同 id 的 `role: check` 命令，使用实际验证工具及结构化 argv；不调用 shell，不执行部署。

```json
{
  "version": "1",
  "stage": "operations-authorization",
  "artifacts": [{"id": "compose", "path": "compose.yml"}],
  "commands": [{"id": "compose", "role": "check", "argv": ["docker", "compose", "-f", "compose.yml", "config"]}]
}
```

`evidence run --stage operations-authorization --sensor deployment-validation` 执行真实检查，记录配置摘要、命令摘要、工作目录和成功退出状态。配置缺失、命令失败、配置或 allowlist 漂移、遗漏验证均阻断阶段完成。工具不可用保持未验证，不用文本“通过”代替执行。该证据不授予实际部署权限。
