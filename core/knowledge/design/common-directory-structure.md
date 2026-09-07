# 目录结构规范

**职责**：定义 AI-DLC 过程产物的位置。应用代码结构由目标项目现有约定和技术栈决定，本流程不另建平行代码目录。

## 通用规则

- 应用代码、测试和部署配置位于工作区正常项目结构中，不放入 `docs/aidlc/`。
- AI-DLC 需求、设计、计划、审计和报告仅放入 `docs/aidlc/`。
- `docs/aidlc/aidlc-state.json` 是唯一机器路由状态；`docs/aidlc/handoff.md` 是由成功 report 派生的跨平台人类恢复视图。
- 未执行的条件步骤不创建空目录或占位文件。
- 系统基线只保存索引、关系和证据引用，不复制 Secret、完整机器契约或外部平台数据。
- 多模块项目只加载当前模块产物、产品级契约和相关系统基线切片。

## CR 与变更文档约束

- `construction/` 仅存实现计划、审查记录、构建测试和实施报告；禁止创建 `CR-*`、`change-*`、`bug-*` 变更档案。
- L1/L2 变更和缺陷修复不创建独立文件；通过 handoff.md 活跃行和 Git commit 记录。
- L3+ 的 CR 暂态文件位于 `docs/aidlc/modules/<module-id>/change-requests/`；跨模块 CR 的协调索引可位于 `docs/aidlc/ideation/change-requests/`。
- CR 完成后暂态文件必须删除；Git 历史是唯一长期档案。
- 禁止创建 `{artifact}.backup.{timestamp}` 时间戳备份副本；Git 历史保留所有旧版本。

## 统一目录结构（module-unit-v1）

新工作流不再按“单模块写全局目录、多模块写 modules 目录”分叉。单模块项目也声明一个模块和至少一个工作单元，以保证状态、审批、Evidence 和产物路径使用同一模型。

```text
<workspace>/
├── <project source and tests>
└── docs/aidlc/
    ├── aidlc-state.json                         # 签名机器状态，唯一机器路由事实
    ├── handoff.md                               # 派生的人类交接视图
    ├── audit-summary.md
    ├── ideation/                                # project axis
    │   ├── module-division.md
    │   ├── module-manifest.json                 # schema_version=1，至少一个 module
    │   └── ...
    ├── modules/
    │   └── <module-id>/
    │       ├── inception/                       # module axis
    │       │   ├── requirements.md
    │       │   ├── user-stories.md
    │       │   ├── application-design.md
    │       │   ├── unit-manifest.json           # schema_version=1，至少一个 unit；新签名工作流含逐单元 conditional_stages
    │       │   ├── plans/
    │       │   ├── requirements/
    │       │   ├── application-design/
    │       │   └── ...
    │       ├── construction/
    │       │   └── <unit-id>/                   # unit axis
    │       │       ├── plans/
    │       │       ├── audit/
    │       │       ├── functional-design.md
    │       │       ├── implementation-summary.md
    │       │       └── ...
    │       └── change-requests/                 # 仅 L3+ 暂态文件
    ├── construction/                            # project 聚合 axis
    │   ├── build-and-test/
    │   ├── build-test-report.md
    │   └── implementation-report.md
    └── operations/                              # project axis
        ├── plans/operations-plan.md
        ├── deployment-guide.md
        └── operations-summary.md
```

步骤的实际文件名由对应 Stage frontmatter 和 directive 定义。`orchestrate next` 返回的已解析 `artifact_root`、`consumes` 和 `produces` 优先于正文中的抽象示例。

## 路径与隔离规则

- 模块清单固定为 `docs/aidlc/ideation/module-manifest.json`；每项必须有稳定、小写短横线格式的 `module_id`、名称和服务映射。
- 单元清单固定为 `docs/aidlc/modules/<module-id>/inception/unit-manifest.json`；其 `module_id` 必须匹配目录，且至少包含一个稳定 `unit_id`。新签名工作流由 I14 为每个单元写入 `conditional_stages`（允许空数组），只控制该单元的 unit 轴条件 Stage；旧清单缺字段时引擎保守使用模块级条件事实。
- 模块级 Inception 只读写 `docs/aidlc/modules/<module-id>/inception/`；不得用另一个模块的产物满足当前实例门禁。
- 单元级 Construction 只读写 `docs/aidlc/modules/<module-id>/construction/<unit-id>/`；共享源码仍按项目正常源码目录修改，但设计、计划、审查和摘要必须归档到当前单元。
- 构建测试、实施报告和 Operations 是项目级聚合；只有全部相关单元实例完成/跳过后才能执行。
- 场景和跨模块契约继续由项目级产物维护；模块产物引用它们，不复制权威事实。
- 系统基线属于产品级事实，统一位于 `docs/aidlc/ideation/system-baseline/`；模块目录只保存相关引用或切片。
- 切换上下文前先通过成功的 `report` 更新签名 state；handoff 只能派生展示，不能自行改变当前模块、单元或 Stage。

## 旧状态兼容

缺少 `routing_model` 的已签名旧状态继续使用 legacy-global 路由和旧目录，避免破坏签名与在途流程。新状态一律使用上述 module-unit-v1 目录；不得在执行中通过复制旧全局产物绕过当前上下文门禁。
