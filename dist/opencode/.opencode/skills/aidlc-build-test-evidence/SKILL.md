---
name: aidlc-build-test-evidence
description: "执行真实构建和测试命令并生成结构化证据；不负责 C8 路由和完成判定。"
triggers: 构建测试证据, 测试证据, 构建证据, 生成测试报告, build test evidence, 受控测试证据
---

# 构建测试证据能力

开始时宣布："使用 aidlc-build-test-evidence 执行构建与测试"。

## 输入

调用方必须提供：

- 执行矩阵（组件/服务、构建命令、测试命令、预期退出码）；
- 审查证据确认（双轴审查和可选全局审查已通过）；
- 测试分层策略取值（L3 或 L4）；
- 工作目录。

缺少必要输入时返回 `NEEDS_CONTEXT`。命令不明确时返回 `BLOCKED`，不臆造构建命令。

## 加载

加载发布包中的 `stages/construction/construction-build-and-test.md`。

## 执行

在业务项目根目录准备 `.aidlc/evidence-commands.json` 命令清单（格式见下节），然后执行：

```bash
loeyae-aidlc evidence run --stage build-and-test
```

Producer 只执行命令清单中的命令，解析真实测试输出，记录退出码、耗时、测试统计、源代码 revision 和已配置 artifact 的 SHA-256，并以原子方式写入 `.aidlc/evidence/build-and-test/build-test-evidence.json`。任何命令失败、测试统计无法解析或 artifact 缺失时都不写入通过证据。

## 命令清单 `.aidlc/evidence-commands.json`

默认路径为 `.aidlc/evidence-commands.json`，可用 `evidence run --config <path>` 指定，路径必须位于项目根目录内。

### 何时需要

- 需要非语义命令的阶段必须提供：`build-and-test`（build/test/check），`tdd`（red），`code-generation`（green）。
- 只需语义证据的阶段（内置语义检查器，如 `traceability-matrix`、`structural-invariants`、`diagram-contract`）不需要该文件；文件不存在或 `stage` 写的是其他阶段时直接忽略。

### 顶层字段

| 字段 | 必填 | 规则 |
|------|------|------|
| `version` | 是 | 固定为 `"1"` |
| `stage` | 是 | 必须等于本次 `evidence run --stage` 的阶段 |
| `commands` | 是 | 数组；需要非语义命令的阶段必须非空 |
| `artifacts` | 否 | 数组，每项 `{ "id", "path" }`；`id` 不可重复，`path` 必须是项目内的普通文件（不能是符号链接），Producer 记录其 SHA-256 |

`stage` 是锁定字段：每进入一个需要非语义命令的阶段，都要把 `stage` 改为该阶段，并声明该阶段需要的命令；写的是其他阶段时，这些阶段的产证会失败。

### `commands[]` 字段

| 字段 | 必填 | 规则 |
|------|------|------|
| `id` | 是 | 非空字符串，清单内唯一 |
| `role` | 是 | `build`、`test`、`check`、`semantic`、`red`、`green` 之一 |
| `sensor` | 仅 `semantic` | 受支持的语义传感器名 |
| `argv` | 是 | 非空字符串数组；`argv[0]` 必须是 PATH 中的可执行名或项目相对路径，不能是绝对路径、不能含 `..` 或 `; & \| < > \` $`；不经 shell 执行 |
| `cwd` | 否 | 项目内的目录（不能是符号链接），默认项目根目录 |
| `timeout_ms` | 否 | 整数，范围 1～1800000（30 分钟），默认 600000（10 分钟） |

### role 用途

| role | 使用阶段 | 用途 |
|------|----------|------|
| `build` | `build-and-test` | 构建命令 |
| `test` | `build-and-test` | 测试命令；必须能解析出测试统计，且通过数 ≥ 1、失败数为 0 |
| `check` | `build-and-test`；`tdd`、`code-generation` 的 I13 `not_applicable` 场景 | 静态检查或替代验证；I13 不适用时该阶段必须恰好声明一条 |
| `red` | `tdd` | 恰好一条；必须以退出码 1 结束，且失败属于行为断言失败 |
| `green` | `code-generation` | 恰好一条；必须以退出码 0 结束，失败数为 0 |
| `semantic` | 任意阶段 | 可选，仅用于为内置检查器指定 `timeout_ms`；如声明，`argv` 必须是 `["loeyae-aidlc", "check", "--sensor", "<sensor-name>"]`，不要追加 `--module` 等参数；同一 `sensor` 最多声明一次 |

`build-and-test` 执行的命令（全部非 semantic 命令，或 `--command-id` 选中的命令）必须同时包含 `build`、`test`、`check` 三种 role。

### 最小示例

```json
{
  "version": "1",
  "stage": "build-and-test",
  "commands": [
    { "id": "build", "role": "build", "argv": ["npm", "run", "build"] },
    { "id": "unit-tests", "role": "test", "argv": ["npm", "test"], "timeout_ms": 1200000 },
    { "id": "lint", "role": "check", "argv": ["npm", "run", "lint"] }
  ]
}
```

## 输出

返回构建报告路径、测试结果摘要、结构化 evidence（`build-test-evidence.json`）和失败项。

## 禁止事项

不得：

- 臆造构建或测试命令；
- 编造命令执行结果；
- 更新项目 state 或 audit；
- 代替用户审批；
- 放行质量门禁；
- 宣布 C8 或 Construction 完成；
- 手动写入 evidence 文件绕过实际执行。
