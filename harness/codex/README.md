# AIDLC for codex

运行 loeyae-aidlc install --harness codex 安装当前规则。宿主负责执行与权限，AIDLC 提供任务方法和完成判断。安装保留用户配置，只替换拥有的文件并清理识别出的 AIDLC 旧 hook。

多端项目规范由共享的 knowledge/protocols/project-rules.md 定义。项目 AGENTS.md 保持短入口，正文位于各仓库 .agents/rules/；按实际仓库、受影响路径和任务选择，共用规范不复制。可选 rules adapter --host codex 仅输出入口片段，安装不会改造业务项目。

入口从 core/ENTRY.md 生成；按需查阅方法目录与执行规则。此分发不含旧阶段图、wrapper、claim/grant 或阶段 report；历史业务资料和真实批准继续作为参考。
