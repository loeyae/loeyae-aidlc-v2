---
id: clarification-traceability
name: Clarification Traceability
description: Verifies clarification conclusions carry stable CL-xxx IDs so downstream stages can reconcile against them.
type: builtin
---
# clarification-traceability

## 目的
把需求澄清结论纳入贯穿追溯链,修复"澄清文档是孤儿产物"的根源缺口。校验 `clarifications.md`:

- 产物存在且可读;
- 每条已确认澄清结论带稳定 `CL-xxx` ID(正则 `CL-\d{3,}`);
- 每个 CL 后有实质结论内容(非裸 ID);
- 若确认无歧义,必须显式声明"无澄清项/无需澄清/no clarifications",不接受空文件蒙混。

## 门禁语义
builtin sensor(无独立 evidence 文件),由引擎直接解析 `clarifications.md` 判定。任一条不满足即阻断该阶段(准出门禁),经 Phase A 的 `next` 前置门禁与 Stop hook 强制。

## 下游对账
本 sensor 只保证澄清结论**可被消费**(有 ID、有内容)。下游是否**遵循**澄清(user-stories / application-design / cross-validation 覆盖每个 CL)由各自阶段的对账 sensor 校验。ID 规范见 `knowledge/common-traceability-id-chain.md`。
