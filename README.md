# Loeyae AI-DLC

Loeyae AI-DLC 是一个面向 AI 辅助软件交付的工作流工具。它把工作目标、阶段、需求与设计产物、代码审查、真实构建测试及交付证据连接起来，支持单人执行和多人按模块、单元协作。

流程由 Core 管理；AI 宿主决定模型、执行者和委派方式。具体阶段以项目 scope、适用条件和已批准的选择为准，不以固定阶段数衡量进度。

## 安装

需要 Node.js `^22.22.0 || >=24.8.0`。

```bash
npm install -g --ignore-scripts https://github.com/loeyae/loeyae-aidlc-v2/archive/refs/heads/main.tar.gz
loeyae-aidlc install
```

使用 `--ignore-scripts` 避免依赖的安装脚本引发平台构建问题。支持 Kiro Crew、Kiro IDE、Kiro CLI、Claude Code、OpenCode、Codex、CodeBuddy、Qoder 和 ZCode；可以指定宿主或安装到所有受支持的宿主：

```bash
loeyae-aidlc install --harness codex
loeyae-aidlc install --all
```

升级、卸载及安装细节见[安装指南](docs/loeyae-aidlc-v2-installation.md)。

## 开始与继续

在目标项目中，使用明确的工作描述启动：

```bash
loeyae-aidlc orchestrate next \
  --scope feature \
  --work "实现订单导出超时重试"
```

根据返回的 directive 执行当前阶段，Agent 原样展示 `handoff_prompt`。常见 scope 包括 `feature`、`enterprise`、`mvp`、`classic`、`express`、`workshop`、`bugfix` 和 `refactor`；具体选择见[实施指南](docs/aidlc-ai-tools-implementation-guide.md)。

继续已有工作时，先查看当前状态和下一步：

```bash
loeyae-aidlc orchestrate next --preview
loeyae-aidlc orchestrate state summary
```

需要模块视图时可使用 `orchestrate state summary --module <id> --format markdown`。摘要只读取已有状态和证据引用，不写文件或重新运行测试；`not_checked` 表示本次查看未重新验证门禁，不代表检查失败或通过。暂停的工作流使用 `orchestrate next --resume` 恢复。

完成阶段时按 directive 使用对应命令：

```bash
loeyae-aidlc orchestrate report --stage <slug> --result completed
# instruction-only 阶段额外传入 --instruction-ack <slug>
# 应用设计或部署决策按提示使用 --result approved --user-input Approve
```

## 协作与证据

单工作流的状态和审计位于 `aidlc/active/aidlc-state.md` 与 `aidlc/active/audit.md`；拆分后还使用 registry 和各工作流的状态。团队可用 `unit list` / `unit select` 记录分工，受管写入和交接仍须符合当前工作流的精确会话领取。跨模块依赖和集成条件由引擎检查；合并与推送由人执行。

阶段门禁检查实际产物和受控证据。构建、测试必须运行适用的真实命令，Agent 不应手写 Evidence JSON。单元审查在 `code-review.md` 记录 Spec、Standards 和问题；引擎维护状态及审计，无需重复编写单元实施摘要、构建测试汇总或最终报告。业务决策、契约及明确要求的交付报告仍按项目约定保留。

遇到阻塞时先阅读具体诊断：确认是产物缺失、真实测试失败、证据来源变化，还是状态和领取冲突，再按原因做最小修复。不要仅为消除提示反复增加测试或覆盖他人的状态。

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
