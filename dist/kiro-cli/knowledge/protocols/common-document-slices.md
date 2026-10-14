# 权威文档与派生切片 v1

`requirements.md`、`user-stories.md` 是完整权威全文。业务修改先回写全文，随后重新生成。
模块校验、UI 来源锁、交付/开发准入始终读取权威路径；开发上下文使用 directive 的
独立 `business_document_load_plan`（当前单元、适用共享正文与必要契约）。
`rule_load_plan` 只管理阶段规则。切片缺失/过期阻断，不能降级读旧切片。

新 feature/enterprise/mvp/classic 工作流记录 Document Slices Version: 1；执行单元生成
且 ≥2 单元时强制采用。单单元、未执行单元生成、轻量 scope、未采用旧项目保留原路径。
已有 adoption 或 manifest 时必须验证，不得以损坏、删单元、改 scope 获得豁免。

中断后 writer.lock 只允许在确认本机原进程不存在时由 `recover --apply` 清除。
未知主机、损坏记录、仍存活或无法确认的进程一律报告冲突，不抢占另一个写入者。
`recover --apply` 使用独立 recovery.lock 串行化恢复。若恢复进程被强制终止，dry-run
会报告该锁的 PID、主机、状态和恢复办法；先停止本机所有 generate/recover，核实旧
进程已退出后，只删除报告所指的 `document-slices/recovery.lock`，再重试。此锁不自动
抢占，避免并发清理再次破坏互斥；活进程/未知 owner 必须先解决归属。

批准的 `application-design/unit-of-work-story-map.md` 包含唯一机器投影：

```aidlc-story-map
{"schema_version":1,"status":"approved","approved_by":"产品负责人","mappings":[{"story_id":"STORY-001","unit_ids":["api","web"]}],"shared_req_refs":["REQ-NFR"]}
```

该块是批准映射的结构化表达，不另建人工维护的 story_refs。需求由故事的独立
`来源: REQ-...` / `Source: REQ-...` 行反向追溯，并与 unit-manifest 的 req_refs 精确对账。
无故事来源的全局需求必须显式列入 shared_req_refs。定义以标题或列表项起始，支持
STORY-*、US-*、REQ-*、AC-*；普通引用不定义 ID。AC 从属于前面的故事，所有正文、
Gherkin、表格、代码与中文按原始区间保留。歧义/重复定义/孤立 AC 一律报错。

```sh
npx tsx core/tools/aidlc-document-slices.ts generate --module MODULE
npx tsx core/tools/aidlc-document-slices.ts check --module MODULE
npx tsx core/tools/aidlc-document-slices.ts plan --module MODULE --unit UNIT
npx tsx core/tools/aidlc-evidence.ts run --stage units-generation --module MODULE --sensor document-slice-consistency
```

`document-slices/manifest.json` v1 绑定 workflow/module/scope、schema/generator 版本、
canonical/批准映射/unit-manifest 的路径和摘要、独立 REQ/Story/AC 分母、AC owner、
unit/shared 条目集合、实际正文路径与摘要、导航索引。工具从真实输入重建投影，不能
相信自报覆盖。内容寻址对象只归工具所有；最后原子发布 manifest，禁止清理用户目录。
正文、格式、映射、单元变化立即使旧证据失效。重新 generate 比较旧/新消费者，报告
affected_units（包含删除条目的旧消费者）、invalidation_reasons；未变化正文沿用对象。
不递归触发全量业务语义评审，原有定向复验、UI freshness 与下游门禁继续执行。

旧改名项目执行 `recover --module MODULE` 只读报告；仅旧全文存在时可加 `--apply`
恢复 canonical（保留旧文件）。双方内容不同必须裁决，禁止覆盖。恢复后重验原有输入锁、
证据、UI freshness 与追溯链，不自动改锁或证据路径，无静默 .full.md fallback。

加载计划报告实际 UTF-8 字节数及 ceil(bytes/4) 的粗略 token 估计，不宣称实测 token
改善。没有计划或数据时为未知；不以目录存在推断节省，不裁剪 AC 和共享约束。
