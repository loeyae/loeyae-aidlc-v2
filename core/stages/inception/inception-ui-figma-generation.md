---
slug: ui-figma-generation
number: "2.5.2"
name: Figma 生成
phase: inception
execution: CONDITIONAL
lead_agent: aidlc-design-agent
support_agents: []
mode: inline
scopes: [feature, enterprise, mvp, classic]
consumes: []
produces: []
sensors: []
requires: [ui-mock]
---
# Figma 设计生成与登记规范

## 职责

根据已批准的 `page-plan.md` 创建 Figma 原生设计，或只读登记外部 Figma 文件。本文件不定义模式选择、认证审批、用户审核、state/audit 或 I10 放行。

## 输入

- 页面计划路径；
- `source=created` 或 `source=external`；
- 编排层已验证的读写能力结果；
- 目标文件或创建目标；
- 团队设计系统、参考文件、design tokens 或现有文件基准；
- 当前批次。

页面计划必须不存在未决项。生成或登记结果不得改变页面 ID、名称、类型、来源、权限、状态差异或操作闭环。

## 流程创建模式

1. 创建或复用调用方指定的唯一主 Figma 文件，一个 AI-DLC 项目不得按模块创建多个主文件。
2. 单模块按端创建 Page；多模块按 `{module}-{endpoint}` 创建 Page。
3. 每个页面计划项创建一个可唯一定位的顶层 Frame；PC、平板和移动端使用适合其端的标准宽度。
4. 优先复用团队设计系统；没有设计系统时建立必要的 Color、Spacing、Typography Variables 和可复用 Components。
5. 使用 Auto Layout，避免绝对定位；重复结构达到 3 次时使用 Component/Instance，或返回明确例外。
6. 逐项投影计划中的页面内容契约、权限、状态差异和操作闭环，设计字段、按钮、Variants、弹窗或并列 Frame；不得自行推断计划外字段。
7. 局部改动标注改动范围，不删除或重设计未批准的既有内容。
8. 每批完成后读取截图验证布局、命名、内容和对齐，返回每个 Frame 的 nodeId 与证据。

## 外部提供模式

1. 只使用调用方提供且已验证可读的目标文件。
2. 读取 Page/Frame，并将每个页面计划项映射到唯一 nodeId。
3. 使用 metadata、variables 和 screenshot 证据验证页面可定位、视觉可读和设计资源可追溯。
4. 缺少计划页面、存在多重映射或产品语义不一致时返回问题，不调用任何写入工具。
5. 资产导出仅在调用方明确要求且不修改源文件时执行。

## 工具边界

- 文件与画布：`create_new_file`、`use_figma`；
- 设计系统：`get_libraries`、`search_design_system`；
- 读取验证：`get_metadata`、`get_variable_defs`、`get_screenshot`；
- 资产：`upload_assets`、`download_assets`。

工具是否可调用由编排层提供的能力结果决定，本文件不把配置存在视为可用。

## 输出

返回：

- 唯一主文件 URL；
- 页面 ID、Page、Frame 和 nodeId 映射；
- Variables/Components 使用结果；
- 每个页面或批次的截图证据；
- 资产结果；
- 未映射、冲突或未验证项。

## 自检

- 每个页面计划项恰有一个 Frame/nodeId；
- 页面名称、类型、权限、状态差异和操作闭环与计划一致；
- 流程创建模式使用 Variables、Auto Layout 和适用 Components；
- 外部提供模式零写入；
- 截图证据可复现，不使用“看起来一致”或百分比估算代替。
