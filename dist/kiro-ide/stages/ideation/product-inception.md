---
slug: product-inception
number: "1.1"
name: 产品 Inception
execution: CONDITIONAL
lead_agent: aidlc-product-agent
scopes: [feature, enterprise, mvp, classic]
produces: [docs/aidlc/ideation/product-inception.md]
requires: [workspace-detection]
---

# 产品级 Inception

**职责**：在多模块或多服务项目中确定产品范围、业务模块、部署服务映射和跨边界契约索引。详细需求、故事和组件设计留在模块级 Inception。

## 触发条件

- 新项目选择多模块模式；
- 存量多模块/多服务项目尚无产品级产物；
- 用户继续产品规划、新增模块或调整产品边界。

## 产物

- `docs/aidlc/product/product-overview.md`：定位、业务域和全局约束；
- `docs/aidlc/ideation/module-division.md`：模块边界、服务映射和 Owner；
- `docs/aidlc/ideation/product-contracts.md`：跨边界契约索引；
- `docs/aidlc/product/decision-summary.md`：产品级决策摘要。

审计与状态位置按通用目录和步骤完成协议执行。

## 步骤 0：产品级系统基线（存量分布式项目）

在模块划分和契约索引之前执行：
1. 加载 `inception-reverse-engineering.md` 的系统级基线子流程与 `common-runtime-dependency-analysis.md`。
2. 在 `docs/aidlc/product/system-baseline/` 建立服务目录、运行时依赖和外部系统目录。
3. 按实际风险建立配置与一致性基线，并记录代码版本和新鲜度。
4. 无法确认的服务、消费者、数据 Owner 或外部边界列入待确认项。

全新项目或确认无分布式能力时跳过并记录依据。完成步骤 0 后，后续 I4 只补模块级逆向切片；已有有效产品级基线不得重复生成。

## 步骤 1：产品需求概览

生成并确认 `product-overview.md`，至少包含：

```markdown
# 产品需求概览

## 产品定位
{面向对象、解决问题和交付边界}

## 核心业务域
| 业务域 | 说明 | 优先级 | Owner |
|--------|------|--------|-------|

## 全局约束
- {业务、技术、时间和合规约束}

## 非功能需求概要
- {性能、安全、可用性和恢复目标；未知项明确标记}
```

只确认产品级范围，不在此展开模块级验收细节。

## 步骤 2：模块与服务映射

1. 加载 `product-module-division.md`。
2. 基于业务域提出模块边界；存量项目以服务目录和数据 Owner 为约束。
3. 明确每个模块映射到哪个部署服务；一个模块跨多个服务时拆分或记录明确理由。
4. 与用户确认后保存 `modules.md`。

模块可渐进追加，但不得创建"未来可能使用"的空模块。新增、合并或拆分必须同步评估契约和系统基线。

## 步骤 3：跨边界契约索引

1. 加载 `product-contracts.md` 与 `common-contract-governance.md`。
2. 从运行时依赖基线识别提供方、消费者及外部系统；全新项目依据已确认设计建立初始关系。
3. 定位机器可读契约或明确标记"文档契约"。
4. 记录契约 ID、权威来源、版本策略、兼容状态和逐消费者状态。
5. 与用户确认后保存 `contracts.md`。

进程内模块方法签名留在应用设计；跨进程契约不在 `contracts.md` 复制完整字段。业务 Entity 和数据库模型不作为默认共享契约。

## 步骤 4：决策摘要与状态

生成 `decision-summary.md`，包含：
- 模块及部署服务映射；
- 数据所有权和关键运行时依赖；
- 契约权威来源与未完成消费者；
- 开发/迁移顺序、关键约束和待确认项；
- 产品级系统基线路径与新鲜度（适用时）。

更新 handoff.md 的产品级进度、活跃层级和基线引用。后续 I3 始终加载 `product-scenario-module-mapping.md`，按具体场景确认边界和主次模块；单模块项目也不得跳过 I3。

## 新增或调整模块

1. 读取当前 `modules.md`、`contracts.md` 和相关系统基线切片。
2. 评估服务、消费者、数据、配置和外部系统影响。
3. 通过 CR 更新模块边界及机器契约/索引。
4. 更新逐消费者状态、decision-summary 和 handoff.md。

不得只追加模块名而跳过运行时影响评估。

## 完成标准

- [ ] 产品定位、业务域、交付边界和全局约束已确认
- [ ] 存量分布式项目的产品级系统基线先于模块和契约索引建立且新鲜度有效
- [ ] 每个模块有职责、Owner、服务映射和数据边界
- [ ] 不要求强制基础模块；共享内容符合 `product-module-division.md`
- [ ] 跨边界契约有权威来源或"文档契约"标记及逐消费者状态
- [ ] 不存在以方法签名清单或共享业务 Entity 形成的第二契约事实源
- [ ] 依赖循环、未知项和阻断项已解决或明确记录
- [ ] decision-summary 与 handoff.md 已更新
- [ ] 已明确后续场景通过 `product-scenario-module-mapping.md` 进入 I3，不以模块菜单替代场景分析
