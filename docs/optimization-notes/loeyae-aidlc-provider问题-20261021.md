# loeyae-aidlc Provider 知识确认问题

> 环境：Windows，项目 dfi-mall-kiro
> 发现时间：2026-10-21，M06 搜索域 MARS-237 迁回 Kiro 时
> 引擎版本：v4.22.9 发现，v4.22.10 复测
> 影响：所有模块的 `orchestrate next` / `orchestrate report` 被阻断

## 问题描述

三个 `kind: knowledge` 的 Provider 无法正常工作：

| Provider 实例 | provider_id | 实际协议 | 状态 |
|---|---|---|---|
| ssot-readonly | context.ssot-readonly | `aidlc.context-source` + `aidlc.mcp` | 无法安装 |
| visual | design.design-resource | `aidlc.design-resource` | 无法安装 |
| figma-reader | ui.figma-existing | `aidlc.ui-read-source` + `aidlc.mcp` | 无法安装 |

三者清单均声明 `kind: knowledge`，但没有 `extensions["aidlc.knowledge"]`，使用的是各自的扩展协议（context-source / design-resource / ui-read-source）。

## 引擎行为

### v4.22.9

- `orchestrate next` 返回 `ask_type: provider-knowledge-confirmation`
- `provider knowledge-load` 报 `PROVIDER_KNOWLEDGE_INVALID: expected object`
- `orchestrate report` 同样被拦
- **原因**：`aidlc-provider-resolver.ts` 的 `buildDirectiveActions` 对所有 `kind: knowledge` 的能力生成 `required_before: "stage-execution"`；`aidlc-orchestrate.ts`（约 5132 行）对这些动作调用 `verifyProviderKnowledge`，而 `aidlc-provider-knowledge.ts:68` 只认 `aidlc.knowledge` 扩展，缺失即报错

### v4.22.10

- `provider add` 直接拒绝：`PROVIDER_MANIFEST_INVALID: extensions["aidlc.knowledge"]: missing required extension for knowledge manifest`
- 即引擎要求 Provider 侧补 `aidlc.knowledge` 扩展（或把 kind 改为非 knowledge）
- 三个 Provider 仓库 main 仍是原提交，未更新，因此目前无法安装

### 附带问题：`provider disable` 无效

- 停用后实例仍计入默认能力表达式（`all_of` 绑定能力），报 `PROVIDER_CAPABILITY_MISSING`
- 只能用 `provider remove` 彻底移除

## Provider 仓库信息

| 仓库 | 当前 HEAD |
|---|---|
| `https://git.dev.loeyae.com/libraries/loeyae-aidlc-provider-ssot-readonly.git` | `5c1a70dd15fe78bfbf510c7f4e7bc0bcc197bbe4` |
| `https://git.dev.loeyae.com/libraries/loeyae-aidlc-provider-design-resource.git` | `ed0ea6eb9084825da5398f485d6df80ee0201e56` |
| `https://git.dev.loeyae.com/libraries/loeyae-aidlc-provider-figma-existing.git` | `645307e2061f0b5f50d08959d6f8bd56bca1a9eb` |

## 期望

二选一：

1. **Provider 侧**：在清单中补上合规的 `extensions["aidlc.knowledge"]` 段（包含 `topics`、`sections` 等），或者把 `kind` 改为非 `knowledge`（如果这些 Provider 本意不是走知识确认通道）
2. **引擎侧**：知识确认门禁只作用于声明了 `aidlc.knowledge` 的 Provider；context-source / design-resource / ui-read-source 走各自通道，不触发知识确认流程

## 本机临时处理

- 已 `provider remove` 三个实例
- 原配置备份在 `.multica/tmp/provider-backup-20261021/`（`providers.yaml`、`providers.lock.yaml`）
- 修复后恢复方式：拷回备份文件，或按上述仓库地址和提交重新 `provider add`
