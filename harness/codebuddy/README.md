# 默认：宿主直接实施

使用宿主原生工具按用户已明确的设计和验收标准实施、测试、审查及返修。可选 `loeyae-aidlc work` 只读获取 Git/所选输入；无需 H5、claim、专用 worker 或逐阶段 report。真实验收失败继续修复，不得宣称完成；流程记录缺失不阻止独立工作。

## 兼容参考

以下旧 orchestrate、会话及专用 runtime 说明仅在用户明确选择维护旧受管流程时适用，不是默认实施前置条件。

# Loeyae AI-DLC for WorkBuddy Enterprise / CodeBuddy

本目录构建为 CodeBuddy 本地 marketplace，包含原生 Skill；默认不注册 Stop Hook。正式安装由 `loeyae-aidlc install --harness codebuddy` 调用 CodeBuddy 官方 CLI 完成，不直接编辑宿主 registry 或 cache。Core 不声明领域 MCP；`--project` 仅选择部署范围，不授权连接。历史宿主 MCP 保留，卸载不释放受管连接。

默认安装为 user scope。项目级安装使用：

```bash
loeyae-aidlc install --harness codebuddy --project /absolute/path/to/project
```

安装或升级后新开 CodeBuddy 会话；已打开会话不会保证热重载插件配置。
