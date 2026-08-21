<!-- OpenCode 启动时注入的精简路由；权威流程见 core-workflow.md。 -->

# AI-DLC 路由指令（OpenCode）

- 用户明确提到 AI-DLC/aidlc 时，先加载 `core-workflow.md`，不得直接编码。
- 未明确使用 AI-DLC 时，复杂功能、架构或多文件任务进入 AI-DLC；简单变更可直接处理。
- 进入后先执行工作区检测，再按 `common-complexity-assessment.md` 选择路径。
- 存量分布式系统按实际风险加载运行时依赖、契约、配置和一致性规则；技术适配只有检测到工作区证据时加载。
- 阶段顺序：Inception（规划）→ Construction（实现与实际验证）→ Operations（部署准备，条件）。
- Inception 中 I3“场景分析与模块映射”始终执行；业务产物门禁完成后必须触发 PRD 决策检查点，选择产出时在 I11 前执行 I15 汇编和 I16 一致性审查，I16 未通过不得继续 I11 或 Construction。
- Operations 不覆盖部署后的生产运营。
- 只加载当前路由需要的 steering；恢复时以 `docs/aidlc/state.md` 为唯一状态源。
