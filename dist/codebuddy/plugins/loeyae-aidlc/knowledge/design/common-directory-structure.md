# 目录结构规范

**职责**：定义 AI-DLC 过程产物的位置。应用代码结构由目标项目现有约定和技术栈决定，本流程不另建平行代码目录。

## 通用规则

- 应用代码、测试和部署配置位于工作区正常项目结构中，不放入 `docs/aidlc/`。
- AI-DLC 需求、设计、计划、审计和报告仅放入 `docs/aidlc/`。
- `docs/aidlc/handoff.md` 是三平台唯一恢复状态源。
- 未执行的条件步骤不创建空目录或占位文件。
- 系统基线只保存索引、关系和证据引用，不复制 Secret、完整机器契约或外部平台数据。
- 多模块项目只加载当前模块产物、产品级契约和相关系统基线切片。

## CR 与变更文档约束

- `construction/` 仅存实现计划、审查记录、构建测试和实施报告；禁止创建 `CR-*`、`change-*`、`bug-*` 变更档案。
- L1/L2 变更和缺陷修复不创建独立文件；通过 handoff.md 活跃行和 Git commit 记录。
- L3+ 的 CR 暂态文件仅位于 `docs/aidlc/change-requests/`（单模块）或 `docs/aidlc/modules/<module>/change-requests/`（多模块）。
- CR 完成后暂态文件必须删除；Git 历史是唯一长期档案。
- 禁止创建 `{artifact}.backup.{timestamp}` 时间戳备份副本；Git 历史保留所有旧版本。

## 系统基线根目录

| 架构 | `<system-baseline-root>` |
|------|--------------------------|
| 单模块 | `docs/aidlc/inception/system-baseline/` |
| 多模块/多服务 | `docs/aidlc/product/system-baseline/` |

仅在检测到分布式能力或外部运行时依赖时创建。可包含 `service-catalog.md`、`runtime-dependencies.md`、`external-systems.md`、`configuration-inventory.md`、`consistency-scenarios.md` 和 `customization-baseline.md`；实际文件按触发条件生成。

## 单模块结构

```text
<workspace>/
├── <project source and tests>
└── docs/aidlc/
    ├── handoff.md
    ├── audit-summary.md
    ├── change-requests/               # 仅 L3+ CR 暂态文件；完成后删除
    ├── inception/
    │   ├── scenario-manifest.md        # I3 产物
    │   ├── prd.md                      # 条件，I15 产物
    │   ├── plans/
    │   ├── reverse-engineering/
    │   ├── system-baseline/            # 条件
    │   ├── requirements/
    │   │   └── business-flows.md       # I5 强制产物
    │   ├── user-stories/
    │   │   └── role-permission-matrix.md # I7 强制产物
    │   ├── ui-mock/                  # HTML Mock 条件；每端必须含 {端}-page-specs.md + 对应 HTML
    │   └── application-design/
    │       ├── test-cases/
    │       ├── unit-of-work.md
    │       ├── unit-of-work-dependency.md
    │       └── unit-of-work-story-map.md
    ├── construction/
    │   ├── plans/
    │   ├── audit/
    │   ├── <unit-name>/
    │   ├── build-and-test/
    │   └── implementation-report.md
    └── operations/
        ├── plans/operations-plan.md
        ├── deployment-guide.md
        └── operations-summary.md
```

步骤的实际文件名由对应 steering 定义；本图只规定目录职责。

## 多模块结构

```text
<workspace>/
├── <project source and tests>
└── docs/aidlc/
    ├── handoff.md
    ├── audit-summary.md
    ├── product/
    │   ├── product-overview.md
    │   ├── modules.md
    │   ├── contracts.md
    │   ├── decision-summary.md
    │   ├── scenarios/
    │   │   └── <scenario-id>/
    │   │       ├── scenario-manifest.md
    │   │       └── prd.md              # 条件，I15 产物
    │   └── system-baseline/            # 条件，产品级唯一维护
    ├── modules/
    │   └── <module-name>/
    │       ├── inception/
    │       └── construction/
    └── operations/
```

## 多模块规则

- 场景目录仅存放跨模块视图产物（`scenario-manifest.md`、`prd.md`）；I5-I10 产物一律按模块归档，禁止按场景归档。
- PRD 是汇编视图而非基线；禁止在场景目录保存与模块级产物内容重复的需求、故事或页面规格文件。
- 产品边界和跨边界契约索引只在 `product/contracts.md` 维护；完整机器契约留在项目既有事实来源。
- 服务目录和运行时关系只在产品级系统基线维护，模块级产物引用相关切片。
- 模块级 Inception/Construction 结构与单模块对应阶段一致，但不重复系统基线。
- Operations 是项目级部署准备；只有独立部署模块明确需要单独交付时，才在其模块目录生成部署补充说明。
- 切换模块前先更新 handoff.md 的活跃模块、活跃服务/单元、当前步骤、基线新鲜度和下一步交接。
