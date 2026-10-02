---
id: baseline-test-evidence
name: Controlled BASELINE Test Evidence
description: Verifies that characterization tests pass on the unmodified workflow-baseline code before code-generation changes it.
evidence_path: .aidlc/evidence/tdd/<module-id>/<unit-id>/baseline-test-evidence.json
---

# baseline-test-evidence Sensor

适用于 `tdd` 阶段中 I13 `tdd_mode: characterization` 的 UC-D（存量行为）。新行为走 RED→GREEN，存量行为走 BASELINE→GREEN：BASELINE 证明刻画测试在改动前的基线代码上全部通过，GREEN 证明改动后仍然通过。

## 命令清单

`.aidlc/commands/tdd.json`（或 `.aidlc/evidence-commands.json`）中恰好一条 `role: baseline` 命令，`stage` 为 `tdd`。与 RED/GREEN 相同，只认默认查找顺序；`evidence run --sensor baseline-test-evidence`（或 `--all-sensors`）带指向其他文件的 `--config` 时，在执行任何命令、写任何证据之前拒绝。

```json
{
  "version": "1",
  "stage": "tdd",
  "commands": [
    { "id": "uc-red", "role": "red", "argv": ["pytest", "tests/test_retry.py"] },
    { "id": "uc-baseline", "role": "baseline", "argv": ["pytest", "tests/test_exporter.py"] }
  ]
}
```

命令须退出 0，并输出一个 JSON 观察对象：`phase: BASELINE`、`status: passed`、`tests_total >= 1`、`tests_failed: 0`、`compile_status` / `environment_status` 为 `passed`、`traceability_complete: true`、`uc_mapping`。

## Producer

1. 执行命令**之前**，对 I13 `characterization[]` 中每个 code ref 用 `git hash-object`（数组参数、不经 shell）计算当前工作区文件的 blob，与 I13 记录的 `baseline_blob` 比较；任一不同或文件缺失直接失败，不执行命令、不出证据。
2. 执行唯一的 `role: baseline` 命令，校验退出码与观察对象。
3. 写入受控证据：

```json
{
  "phase": "BASELINE",
  "status": "passed",
  "tests_total": 3,
  "tests_failed": 0,
  "compile_status": "passed",
  "environment_status": "passed",
  "traceability_complete": true,
  "uc_mapping": [{ "use_case": "UC-D-003", "test_methods": ["tests/test_exporter.py::test_pagination"] }],
  "baseline_commit": "<workflow baseline sha>",
  "code_ref_digests": [{ "path": "app/exporter.py", "baseline_blob": "<sha>", "worktree_blob": "<sha>" }],
  "observed_command": { "id": "uc-baseline", "phase": "BASELINE", "argv_digest": "…", "exit_code": 0, "expected_exit_code": 0, "duration_ms": 1 },
  "producer": { "mode": "controlled" },
  "checker": { "id": "builtin:baseline-test-evidence" },
  "source_revision": {}
}
```

I13 没有 characterization UC-D（含 I13 为 `not_applicable`）时写 `status: "not_required"`、`ucd_ids: []`，不执行命令，清单也不必声明 `role: baseline`。

## tdd 门禁

- producer / checker / provenance 契约与 RED 相同；`observed_command.argv_digest` 等于清单中唯一 baseline 命令 argv 的 SHA-256，`checker.argv_digest` 等于 `SHA-256(JSON.stringify(["BASELINE-observation", observed_command.argv_digest]))`，`observed_command.exit_code` 为 0。
- `uc_mapping` 恰好覆盖全部 characterization UC-D，不得包含 `new` UC-D。
- `baseline_commit` 在工作流状态（split 布局读父工作流）、I13 与证据三处一致，且基线提交仍可从 HEAD 到达。
- `code_ref_digests` 与 I13 code ref 一一对应，`worktree_blob == baseline_blob`，且门禁现场在基线提交中重新解析 blob 比对。
- `not_required` 只在 I13 没有 characterization UC-D 时接受；缺 `ucd_modes` 的旧 I13 视为全部 `new`，BASELINE 必须为 `not_required`。

## 下游

- `code-generation` 完成（及其 re-attest）时连同 RED 复验 BASELINE：只容忍工作区漂移，`source_revision.commit` 须为 HEAD 或其祖先；producer、checker、基线绑定校验不变。基线被替换后，旧基线下产出的 BASELINE 证据会被拒。
- GREEN 的 `uc_mapping` 须覆盖全部 UC-D（`new` 与 characterization）。
- `test-quality`：有 characterization UC-D 时要求 BASELINE `passed`（`baseline_seen: true`），有 `new` UC-D 时要求 RED `failed`（`red_seen: true`）。
- `next` 复验上游时不容忍漂移。

## 升级

升级前已完成的 tdd 实例没有该证据，`next` 复验时会阻断。执行 `loeyae-aidlc evidence run --stage tdd --module <id> --unit <id> --sensor baseline-test-evidence --refresh` 补齐。
