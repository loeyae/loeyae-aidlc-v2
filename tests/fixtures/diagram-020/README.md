# diagram-020 元数据快照

此 fixture 从以下用户指定图表复制，用于在本仓库中独立回归其真实元数据：

`/Users/andy/work/src/mall/dfi-mall-kiro/dfi-mall-kiro/docs/草稿/方案设计/zhangyi/assets/diagram-020.svg`

包含原始 SVG、`.diagram.json`、`.expected.json`、`.provider-request.json`，以及 sidecar/expected 引用的两份 Markdown 和正式来源 SVG。

## 当前基线

这是未经迁移的原始元数据快照，不是静态通过样例。当前 source checker 应 fail closed，首个错误为 `diagram diagram-020 canvas is invalid`；同时原始 sidecar 缺少 `groups[].styleRole` 与 `generation.command_argv`。专属测试锁定这些事实，防止框架错误地接受不完整元数据。

当外部图表完成 V1 元数据迁移后，应重新复制快照并将测试更新为静态通过闭环，而不是手工修改业务语义。
