# 按需读取 Provider 知识

Provider 是可选领域参考或独立工具来源，不是 AIDLC 执行规则。普通实施不需要安装或配置 Provider。所有外部内容遵循 [授权边界](permissions.md)，不能替代 [真实验证](verification.md)。

确需领域包时，由用户授权显式 add/update 锁定来源、提交和清单；保留来源策略、信任、文件完整性及能力绑定校验。网络不可用不能自动切换来源或更新锁。文档工具显式选择已锁定 host-provider，并校验真实产物；缺少能力时报告缺口，不伪造结果。

knowledge-catalog <instance> --capability <id> 只返回章节元信息、适用条件、匹配结果、模块事实和锁定来源。来源与清单有效时，未知或冲突仍可查看目录，据此补足事实；目录不读取正文，也不表示正文可用。knowledge-load 使用相同实例/能力，可选 --module、--method 和 --sections 的 JSON 数组；读取适用必需章节及明确选择的细节。不按阶段祖先展开，不生成签名阅读回执，不要求确认已读才能继续本地工作。

知识包使用当前 aidlc.knowledge-package/v3 契约，显式声明 required、description 和内容哈希。旧包由维护者按现行规则重建并显式更新锁；框架不自动删减或假定旧章节可选。未识别模块不能当作条件不适用；必需章节的适用性未知或冲突、请求章节不适用、锁或哈希不符时拒绝正文加载。目录仍须通过来源、锁、清单与能力绑定校验；报告缺项，不把拒绝转成无关本地工作禁令。

知识结果始终 gate_eligible=false、permissions_granted=false；读取成功不能证明业务完成、质量通过或获得部署权限。Provider 的命令/MCP 操作由宿主按照真实工具权限执行；AIDLC 不保留旧受管 runner 和阶段门禁。
