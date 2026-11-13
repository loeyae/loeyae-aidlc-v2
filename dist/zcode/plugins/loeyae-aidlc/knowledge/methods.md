# 方法目录

由技能元信息生成；只选择当前问题需要的方法，不按顺序执行或批量加载。质量、权限和完成边界见[执行规则](protocols/host-execution.md)。

- [aidlc-application-design](../skills/aidlc-application-design/SKILL.md)：梳理本次变更的组件、接口、数据和约束，按需要更新现有应用设计。
- [aidlc-approval](../skills/aidlc-approval/SKILL.md)：审阅尚未授权的重大业务、架构或部署决定，记录用户真实答复。
- [aidlc-build-test-evidence](../skills/aidlc-build-test-evidence/SKILL.md)：运行项目真实构建与测试，解释结果并选择最小充分复验范围。
- [aidlc-code-review](../skills/aidlc-code-review/SKILL.md)：审查实际变更的需求符合性、正确性、安全和可维护性，给出可定位的问题。
- [aidlc-continuity](../skills/aidlc-continuity/SKILL.md)：Continue from actual code, Git and verification using native host tools.
- [aidlc-delivery-config-generation](../skills/aidlc-delivery-config-generation/SKILL.md)：按实际部署目标生成或调整必要的运行与交付配置，复用已有配置。
- [aidlc-deployment-validation](../skills/aidlc-deployment-validation/SKILL.md)：检查指定交付配置的语法、引用、安全边界及实际可执行性，不默认执行部署。
- [aidlc-diagram-design](../skills/aidlc-diagram-design/SKILL.md)：按已确认语义制作 Mermaid 或显式要求的 SVG 图表，并验证可读性和关系正确性。
- [aidlc-docx-beautification](../skills/aidlc-docx-beautification/SKILL.md)：独立 DOCX 检查与保守美化能力：只修改关系解析出的 styles Part，报告直接格式覆盖率并验证所有非样式内容不变；不负责 AI-DLC 阶段路由和完成判定。
- [aidlc-figma-design](../skills/aidlc-figma-design/SKILL.md)：使用宿主已有 Figma 工具读取、创建或调整指定设计，保留设计来源与视觉验证。
- [aidlc-handoff](../skills/aidlc-handoff/SKILL.md)：Summarize scope, actual implementation, verification and remaining work without execution gates.
- [aidlc-prd-synthesis](../skills/aidlc-prd-synthesis/SKILL.md)：把已有业务范围、需求和关键决定整合为面向业务方的 PRD，显式保留未知项。
- [aidlc-release-forecast](../skills/aidlc-release-forecast/SKILL.md)：基于需求清单、关键澄清和显式团队假设生成相对时间范围与 Phase 排期预测；不负责 AI-DLC 阶段路由和完成判定。
- [aidlc-requirement-estimation](../skills/aidlc-requirement-estimation/SKILL.md)：基于需求清单、项目模式和轻量功能点分析生成可解释的工作量区间；不负责 AI-DLC 阶段路由和完成判定。
- [aidlc-reverse-engineering](../skills/aidlc-reverse-engineering/SKILL.md)：按本次问题分析存量代码、技术栈和行为，给出可追溯的架构发现。
- [aidlc-systematic-debugging](../skills/aidlc-systematic-debugging/SKILL.md)：基于实际错误和可检验假设定位问题，进行最小修复并验证。
- [aidlc-test-case-derivation](../skills/aidlc-test-case-derivation/SKILL.md)：从已确认行为与技术风险补充可执行测试，复用项目现有测试结构。
- [aidlc-ui-implementation-bridge](../skills/aidlc-ui-implementation-bridge/SKILL.md)：将已有 UI 设计映射到实际平台组件与布局，支持必要的跨端实现。
- [aidlc-ui-mock-design](../skills/aidlc-ui-mock-design/SKILL.md)：按确认的页面行为制作或修改 HTML Mock，复用现有设计与视觉资源。
- [aidlc-unit-generation](../skills/aidlc-unit-generation/SKILL.md)：按交付范围划分可实施任务，明确依赖和并行写入边界。
- [aidlc-user-story-generation](../skills/aidlc-user-story-generation/SKILL.md)：把已有需求转化为用户场景和可验证验收标准，复用已有故事。
