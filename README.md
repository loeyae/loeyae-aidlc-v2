# Loeyae AI-DLC

Loeyae AI-DLC 是一个面向 AI 辅助软件交付的工作流工具。它把工作目标、阶段、需求与设计产物、代码审查、真实构建测试及交付证据连接起来，支持单人执行和多人按模块、单元协作。

默认由 AI 宿主原生工具实施、调度、测试和返修；Core 提供按需工作方法和验收依据，不将流程状态或凭据作为本地编码前置条件。旧受管引擎保留为显式兼容接口。

## 安装

需要 Node.js `^22.22.0 || >=24.8.0`。

```bash
npm install -g --ignore-scripts https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
loeyae-aidlc install
```

使用 `--ignore-scripts` 避免依赖的安装脚本引发平台构建问题。支持 Kiro Crew、Kiro IDE、Kiro CLI、Claude Code、OpenCode、Codex、CodeBuddy、Qoder、ZCode 和 DeepSeek Harness；可以指定宿主或安装到所有受支持的宿主：

```bash
loeyae-aidlc install --harness codex
loeyae-aidlc install --harness deepseek
loeyae-aidlc install --all
```

升级、卸载及安装细节见[安装指南](docs/loeyae-aidlc-v2-installation.md)。

## 开始与继续

直接向宿主交代本次范围、已确认设计、验收标准与约束，Agent 按已有授权持续实施、测试、审查和返修。可选读取简短上下文：

```bash
loeyae-aidlc work --work "实现订单导出超时重试" --paths '["src","tests"]'
loeyae-aidlc work --input docs/design.md
loeyae-aidlc work --details --paths '["src","tests"]'
```

该命令只读 Git 与显式选择的文件，不创建 workflow/state/audit/claim/grant，不调用模型、探针或测试。没有它也可直接实施。续作从实际代码和验证结果开始，不要求恢复旧阶段指针。

默认只输出最多 20 条状态、2 KiB 状态摘要和 diff 总量，并标明总条数及截断。详细变更按 `--details --paths` 请求；默认帮助仅展示常用入口，`help legacy` 查看旧受管命令。默认安装不注册 Stop Hook；升级只移除可识别的 AI-DLC 旧钩子，保留用户钩子和其他配置。

按约定的功能和 UI 状态/尺寸执行真实验证，失败继续修复；不能因缺文档或旧状态冲突停止独立工作。只重验受实际输入变化影响的结果，纯交付说明不使业务测试失效。交付分别报告业务完成、验证缺口与性能，8 分钟不是通用执行限制。详见 [宿主执行协议](core/knowledge/protocols/host-execution.md)。

默认只维护必要的业务需求、设计、代码和测试，交付摘要在对话中即可；确需持久化时更新一份现有任务说明。不要生成重复状态权威或加载全部历史文档。

## 旧受管兼容

`orchestrate`、`module`、`autonomy` 和专用宿主 wrapper 仍可显式调用，其原有授权和状态保护不变。只有需要维护旧受管流程时才使用；不要求普通实施先采用它们。调用 work 不迁移旧运行、不解除旧 claim、不恢复旧 grant，也不宣称旧失败已通过。保留旧记录，在安全独立范围由宿主继续；不得覆盖他人修改或接管未知活动进程。

## Provider 与可选能力

项目可以通过 Git Provider 安装技术知识或验证能力；配置和 lock 固定来源及版本，受控执行和门禁以项目绑定为准。未安装 Provider 时使用 Core 流程。Loeyae Boot 支持通过外部 Provider 接入，详见[Provider 迁移与使用指南](docs/loeyae-boot-provider-migration.md)。

其他能力包括工作树与合并计划、图表、文档导出和只读上下文。`loeyae-aidlc --help` 查看入口，具体参数见 CLI 指南。

## 文档

- [在 AI 工具中实施项目](docs/aidlc-ai-tools-implementation-guide.md)：开工、继续、多人协作及常见阻塞。
- [CLI 指南](docs/loeyae-aidlc-cli-guide.md)：命令、阶段、证据、协作和维护。
- [安装与升级](docs/loeyae-aidlc-v2-installation.md)。
- [多仓库、工作树与恢复](docs/multi-repo-worktree-recovery.md)。
- [AI-DLC 关键词](docs/ai-dlc-keyword-guide.md)、[Context Source](docs/context-source-usage.md)、[图表视觉 Provider](docs/diagram-visual-provider.md)。
- [质量门禁协议](core/knowledge/protocols/quality-gates-v1.md)和[文档切片协议](core/knowledge/protocols/common-document-slices.md)：规则与数据契约。
- [真实宿主 Agent 评测](docs/evals/README.md)：任务包、记录方式及验证范围。
- [Provider 分仓集成验证](docs/provider-integration-guide.md)：按仓库固定版本、选择能力及检查实际 wire 契约。

版本变更见 [CHANGELOG](CHANGELOG.md)。

## 开发

```bash
npm ci --ignore-scripts
npm run typecheck
npm run build:all
npm test
```

`npm test` 包含本地 Core 和 Provider 回归；真实跨仓 Provider 集成需准备匹配的 checkout 和环境，命令及限制见 [CLI 指南](docs/loeyae-aidlc-cli-guide.md)。Windows 的 Python 若指向 Store 占位程序，可通过 `AIDLC_TEST_PYTHON` 指定实际 Python 3 路径。

## License

MIT

## 旧实验与迁移参考

P1/P2 的签名批次、H5、专用 Codex runtime、后继恢复和事实存储迁移均属于显式兼容功能，不是默认实施要求。历史契约与失败记录保留于 [自主实施设计](docs/aidlc-autonomous-implementation-design.md) 和 [P2 记录](docs/aidlc-autonomous-implementation-p2.md)。本轮默认路径调整及验证见 [修复方案](docs/aidlc-host-execution-repair-plan.md)。
