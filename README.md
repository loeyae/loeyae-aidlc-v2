# Loeyae AI-DLC

AIDLC 5 以用户目标、实际实现与验收为中心，提供一套执行规则和按需任务方法。宿主使用原生工具持续实施、测试、审查、返修；授权来自用户和宿主。CR、续作和普通需求使用相同规则。

直接说明目标、范围、约束和验收，已有授权继续沿用。按实际变化选择方法；无需创建阶段状态、领取任务、绑定会话或生成签名证据才能工作。必需质量检查、项目 CI 和真实权限仍须满足。

## 使用

- loeyae-aidlc install --harness codex：安装指定宿主；支持十个宿主。
- loeyae-aidlc work --work "修改表单校验"：可选只读 Git 摘要；始终不评估完成。
- loeyae-aidlc methods：查看方法目录；methods read aidlc-application-design 只读所选方法。
- loeyae-aidlc assess --input result.json：对已有真实事实生成完成视图；不运行检查、不写状态、不授予权限。
- loeyae-aidlc help tools：查看独立 docx、export 和 Provider 能力；它们不调度任务。

完整行为见 [执行规则](core/knowledge/protocols/host-execution.md)、[完成判定](core/knowledge/protocols/completion.md)、[验证](core/knowledge/protocols/verification.md) 与 [权限](core/knowledge/protocols/permissions.md)。方法目录由技能元信息生成，不需手工维护第二份说明。

## 从 4.x 升级

这是不兼容的主版本重建。orchestrate、module、autonomy、阶段 report/claim/grant、旧 wrapper、自动门禁 hook、阶段图与受管协议已移除。旧命令直接报错并指向当前用法，不隐式切换模式。历史版本仍可从 Git 历史查阅。

保留原业务文档、真实批准、原始验证、任务待办及他人修改，按当前 Git/实现/验收恢复工作；不迁移或重建旧状态机。未知进程不能自动接管。既有项目 CI、安全策略和用户明确的发布准出继续有效；缺失验收不能通过升级消除。

安装替换 AIDLC 拥有的文件，只清理可识别的 AIDLC hook；不创建项目 Git 合并驱动，不改写业务记录，不覆盖未知安装。旧安装的所有权核对和必要备份属于一次性升级保护，不是保留旧执行模式。

Provider 的来源锁定与独立文档工具保留。知识包使用当前章节声明契约，由包维护者显式重建和更新锁；不自动迁移领域包。知识加载不证明测试通过或任务完成。

## 开发

npm run build:all 生成全部宿主；npm run typecheck 检查类型；npm test 验证当前行为、权限边界、来源完整性、独立文档工具与分发一致性。npm run test:install 检查安装所有权保护；npm run test:package 检查实际发布包。

入口唯一来源是 core/ENTRY.md；任务方法在 core/skills，详细规则在 core/knowledge/protocols。宿主只保留布局和必要适配。详见 [CLI](docs/loeyae-aidlc-cli-guide.md)、[实施指南](docs/aidlc-ai-tools-implementation-guide.md)、[重建方案与结果](docs/aidlc-rebuild-plan-2026-11-13.md)。
