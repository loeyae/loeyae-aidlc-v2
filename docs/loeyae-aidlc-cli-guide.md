# AIDLC 5 CLI

CLI 提供可选只读上下文、方法查询、完成视图、安装和独立工具。实际实施由宿主执行，任何 CLI 调用都不是开工前提。

| 命令 | 用途 |
| --- | --- |
| work --work <目标> --paths <JSON数组> | 有界 Git 摘要，可用 --input 读取单个已有文档片段 |
| methods / methods read <id> | 查看目录 / 仅打开指定方法 |
| assess --input <相对JSON路径> | 读取已有结果，生成完成结论；不执行命令或写入状态 |
| provider help | 显式锁定来源、更新、启停及按需读取知识 |
| docx --help / export --help | 独立文档操作及其必要权限和产物校验 |
| install / uninstall --harness <宿主> | 保护所有权的安装/卸载；--list 查看宿主 |
| build --all | 从单一入口和规则源重建十个宿主 |
| help migration | 查看不兼容升级说明 |

work 仅检查显式选择的输入预览；发现旧流程命令时返回行号和按需接手规则，不执行脚本或修改项目。截断内容会提示继续读取相关原文；没有发现旧命令不证明项目已清理，也不证明目标覆盖完整。

assess 的事实对象包含 scope、coverage、implementation、verification、acceptance，以及实际要求时的 delivery、closure、unresolved。每组事实包含唯一 id、status（met/unmet/unknown/stale）和真实 evidence 引用；缺少事实或依据不会评估为通过。coverage 只有从原始目标反查实际结果后才可填写 complete；遗漏目标后输入全绿子集仍可能得到 complete，CLI 不认证事实或覆盖真实性。无需为了调用此命令新增文档。

示例：本地实现与测试通过，但真实 API 验收等待时，implementation 与 verification 可以满足，acceptance 必须记录对应 unknown/unmet；不得把本地测试成功作为全部完成。提交、合并和部署保持独立动作，不从测试结果推断权限。

删除的旧命令不再执行；历史记录处理及当前约束见 [执行规则](../core/knowledge/protocols/host-execution.md)。
