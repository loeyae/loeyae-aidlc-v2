# 独立 Provider 与当前 AIDLC

Provider 的职责是提供可选领域参考或独立能力。AIDLC 5 不保留旧阶段解析器、受管 runner、知识确认回执或质量门禁投票。

来源通过 provider add/update 显式锁定，保留来源策略、提交信任、清单和内容哈希校验。独立 docx/export 指定已锁定 host-provider 后执行并校验实际产物；其他外部工具由宿主按真实权限使用。读取知识不能扩大权限或证明验收。

知识操作见[知识读取规则](../core/knowledge/protocols/provider-offline-knowledge.md)，真实 CLI/MCP 入口与能力边界见[宿主调用规则](../core/knowledge/protocols/provider-invocation.md)。`provider inspect <instance>` 只读返回锁定声明和裸缓存位置，不执行包、不授予权限。领域包独立交付；已有项目需要显式更新 Provider 锁才能使用新入口或 v3 知识契约。

宿主首次调用本地 CLI 时，沿[裸缓存准备步骤](../core/knowledge/protocols/provider-invocation.md#从裸缓存准备可执行包)核对锁定子树、读取实际说明，在新目录物化并校验文件后调用。已有可核验的同提交副本直接复用；无需新增 Core Runner 或项目状态。

本地来源/完整性和攻击性候选测试由 `npm test` 执行；真实文档能力使用显式锁定的独立包运行 `npm run test:providers -- --providers <registry.json>`。注册表使用 `aidlc.integration-providers/v1`，在 `providers.document-render` 提供 `source`、40 位 `revision` 和干净 `checkout`；缺少真实包不能报告渲染验收通过。具体范围见 [测试说明](../tests/README.md)。
