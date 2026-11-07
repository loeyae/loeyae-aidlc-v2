# 已退役：OpenCode 精简路由

此文件仅为兼容历史引用而保留，已不作为 OpenCode 启动指令或流程路由入口。

现行入口、控制面与阶段执行规则见 [AI-DLC 核心工作流](core-workflow.md)。阶段选择由编排器依据当前阶段图、scope、execution profile 和用户选择决定；执行时加载当前 directive 的 `rule_load_plan.load_now`。

本文件不再维护独立阶段顺序或审批门禁。PRD 是否生成遵循现行图中的用户可选阶段，恢复会话遵循 [会话交接协议](common-session-handoff.md)。
