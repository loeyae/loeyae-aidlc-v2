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

命令清单按以下顺序查找，路径必须位于项目根目录内：

1. `evidence run --config <path>` 显式指定（仅 build/test/check 与其他 semantic sensor；RED/GREEN/BASELINE 见下文）；
2. 当前阶段专用的 `.aidlc/commands/<stage>.json`（如 `.aidlc/commands/tdd.json`、`.aidlc/commands/build-and-test.json`），多阶段工作流无需反复覆盖同一文件；
3. 默认 `.aidlc/evidence-commands.json`。

无论来源如何，文件中的 `stage` 都必须等于当前阶段，否则拒绝（不会跳过而改用下一来源）。`orchestrate report` 自动产证时使用同一查找顺序。

RED/GREEN/BASELINE 证据还会被门禁反向绑定到命令清单：门禁按上面第 2、3 步（不考虑 `--config`）重新解析 `tdd` / `code-generation` 的清单，要求证据里 `observed_command.argv_digest` 与清单中唯一 red/green/baseline 命令的 argv digest 一致。因此 TDD 流程请使用 `.aidlc/commands/tdd.json` 与 `.aidlc/commands/code-generation.json`：`code-generation` 完成时还要按 `tdd` 清单复验 RED 与 BASELINE，共用 `.aidlc/evidence-commands.json` 并改写为 `code-generation` 后，复验会被拒。修改 red/green/baseline 命令 argv 后须重新产证。producer 会拒绝 RED/GREEN/BASELINE 的 `--config` 指向其他清单（与默认查找结果不是同一文件时直接报错，不执行命令、不写证据）；指向默认查找到的同一文件则允许。

### 存量行为（characterization）流程

I13 中 `tdd_mode: characterization` 的 UC-D 描述要保留的存量行为（I13 已把其 `code_refs` 绑定到工作流基线 blob）：

1. `tdd` 阶段：在 `.aidlc/commands/tdd.json` 声明恰好一条 `role: baseline` 命令，在**未修改** code ref 的代码上运行刻画测试；producer 先用 `git hash-object` 比对每个 code ref 与基线 blob，不一致直接拒绝，命令须退出 0、失败数为 0，`uc_mapping` 恰好覆盖全部 characterization UC-D。有 `new` UC-D 时同一清单再声明 `role: red`；没有 `new` UC-D 时 RED 为 `not_required`，没有 characterization UC-D 时 BASELINE 为 `not_required`，均无需对应命令。
2. `code-generation` 阶段：修改代码后，唯一的 `role: green` 命令须覆盖全部 UC-D（`new` 与 characterization）并通过。
3. `test-quality` 按 `ucd_modes` 判定：有 characterization 时要求 BASELINE passed，有 `new` 时要求 RED failed。

### 何时需要

- 需要非语义命令的阶段必须提供：`build-and-test`（build/test/check），`tdd`（red；有 characterization UC-D 时另需 baseline），`code-generation`（green）。
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
| `role` | 是 | `build`、`test`、`check`、`semantic`、`red`、`green`、`baseline` 之一 |
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
| `red` | `tdd` | 恰好一条（I13 有 `new` UC-D 时）；必须以退出码 1 结束，且失败属于行为断言失败 |
| `baseline` | `tdd` | 恰好一条（I13 有 characterization UC-D 时）；在未修改的基线代码上以退出码 0 结束，失败数为 0 |
| `green` | `code-generation` | 恰好一条；必须以退出码 0 结束，失败数为 0，`uc_mapping` 覆盖全部 UC-D |
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
