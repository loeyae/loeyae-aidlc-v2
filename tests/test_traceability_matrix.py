"""
traceability-matrix producer + prd-completeness(B3) 单测。

覆盖存量项目实测才暴露的缺陷类别,防回归:
- B1(路径): {module-id} 占位符必须被解析,真实 module 能读到产物(非 not_applicable)。
- B3(阶段感知): 分叉 stage(shared-contract-baseline)不在线性序,不得退化为"全层都判"。
- C2(累积对账): PRD 的 FR / 澄清 CL 纳入矩阵;已迁移 module 未覆盖=broken,存量 module 降级放行。
- B3(prd-completeness): 4 字段确定性;legacy PRD 返回 MIGRATION_REQUIRED 不硬拦。

运行: python3 tests/test_traceability_matrix.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHECKER = os.path.join(REPO_ROOT, "core", "tools", "aidlc-semantic-checks.ts")
NPX = shutil.which("npx") or shutil.which("npx.cmd") or "npx"
SCRATCH_ROOT = os.environ.get("KIROCREW_SCRATCH") or os.environ.get("TMPDIR") or tempfile.gettempdir()


def make_temp(prefix: str) -> str:
    return tempfile.mkdtemp(prefix=prefix, dir=SCRATCH_ROOT)


def write(project: str, path: str, content: str) -> None:
    target = os.path.join(project, path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8") as handle:
        handle.write(content)


def write_state(project: str, stage: str, module_id: str) -> None:
    """写一个指定 current_stage / current_module 的 lightweight 工作流状态。
    用临时 .ts 文件执行(tsx --eval 在本环境不可靠执行 ESM 体)。"""
    state_uri = (Path(REPO_ROOT) / "core" / "tools" / "aidlc-light-state.ts").as_uri()
    script = (
        "import { createInitialState, saveWorkflowState } from " + json.dumps(state_uri) + ";\n"
        "const state = createInitialState('feature','4.0.0','matrix-test',[],'matrix test');\n"
        "state.current_phase = 'construction';\n"
        "state.current_stage = " + json.dumps(stage) + ";\n"
        "state.current_module = " + json.dumps(module_id) + ";\n"
        "saveWorkflowState(process.cwd(), state);\n"
    )
    runner = os.path.join(project, "_write_state.mts")
    with open(runner, "w", encoding="utf-8") as handle:
        handle.write(script)
    result = subprocess.run(
        [NPX, "--no-install", "--prefix", REPO_ROOT, "tsx", runner],
        cwd=project, env=os.environ.copy(), capture_output=True, text=True,
    )
    os.remove(runner)
    assert result.returncode == 0, result.stderr or result.stdout


def run_matrix(project: str, module_id: str) -> dict:
    env = os.environ.copy()
    env["AIDLC_ACTIVE_MODULE"] = module_id
    result = subprocess.run(
        [NPX, "--no-install", "--prefix", REPO_ROOT, "tsx", CHECKER, "--sensor", "traceability-matrix"],
        cwd=project, env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr or result.stdout
    return json.loads(result.stdout)


def run_prd(project: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [NPX, "--no-install", "--prefix", REPO_ROOT, "tsx", CHECKER, "--sensor", "prd-completeness"],
        cwd=project, env=os.environ.copy(), capture_output=True, text=True,
    )


# ---- B1 + B3(阶段感知): {module-id} 解析 + 分叉 stage 不误判 ----
def test_b1_path_resolved_and_b3_stage_awareness() -> None:
    project = make_temp("aidlc-matrix-b1-")
    # 已迁移 module:REQ 带 track,引用 PRD 的 FR。current_stage=shared-contract-baseline(分叉 stage)。
    # doc-only track:不要求 stories/design/test/code 任何下游层 → 纯验证 B1 路径解析 + 不误判。
    write(project, "docs/aidlc/modules/sample/inception/requirements.md",
          "# 需求\n### REQ-SAMPLE-001 说明文档\n- track: [doc-only]\n- 来源: FR-001\n")
    write(project, "docs/aidlc/modules/sample/inception/user-stories.md",
          "### STORY-SAMPLE-001 登录（REQ-SAMPLE-001）\n- 来源: REQ-SAMPLE-001\n- AC-001 成功登录\n")
    write(project, "docs/aidlc/ideation/prd.md",
          "# 概述\n# 目标\n# 功能需求\nFR-001 登录\n## 验收标准\n- 登录 acceptance 成功\n# 非目标\n- 不支持匿名\n# 来源索引\n- 用户输入\n# 待确认问题\n无\n")
    write_state(project, "shared-contract-baseline", "sample")
    out = run_matrix(project, "sample")
    # B1:真实读到产物,不是 not_applicable
    assert out.get("status") == "passed", out
    assert out.get("matrix_rows") == 1, out
    # B3 阶段感知:shared-contract-baseline 映射到 functional-design 之前,code_refs/tests 层不判 →
    # REQ 已被 story 覆盖(stories 层),不应 BROKEN@code_refs
    assert out.get("broken_rows") == [], out
    print("PASS test_b1_path_resolved_and_b3_stage_awareness")


# ---- C2: 已迁移 module,PRD 的 FR 未被 REQ 承接 → broken(硬拦) ----
def test_c2_uncovered_fr_on_migrated_module_is_broken() -> None:
    project = make_temp("aidlc-matrix-c2m-")
    # REQ 带 track(已迁移),不引用 FR-002 → FR-002 未承接。doc-only 避免下游层干扰。
    write(project, "docs/aidlc/modules/sample/inception/requirements.md",
          "# 需求\n### REQ-SAMPLE-001 登录\n- track: [doc-only]\n- 来源: FR-001\n")
    write(project, "docs/aidlc/modules/sample/inception/user-stories.md",
          "### STORY-SAMPLE-001（REQ-SAMPLE-001）\n- 来源: REQ-SAMPLE-001\n")
    write(project, "docs/aidlc/ideation/prd.md",
          "# 概述\n# 目标\n# 功能需求\nFR-001 登录\nFR-002 登出\n## 验收标准\n- acceptance\n# 非目标\n- x\n# 来源索引\n- y\n# 待确认问题\n无\n")
    write_state(project, "shared-contract-baseline", "sample")
    out = run_matrix(project, "sample")
    assert out.get("prd_fr_total") == 2, out
    assert "FR-002" in out.get("uncovered_fr", []), out
    assert "FR-001" not in out.get("uncovered_fr", []), out
    # 已迁移 module(无 missing_track)→ 累积缺口进 broken_rows,cumulative_status=BROKEN
    assert out.get("missing_track") == [], out
    assert any("FR-002" in b for b in out.get("broken_rows", [])), out
    assert out.get("cumulative_status") == "BROKEN", out
    print("PASS test_c2_uncovered_fr_on_migrated_module_is_broken")


# ---- C2: 存量 module(REQ 无 track)+ PRD FR 未覆盖 → 降级,不进 broken ----
def test_c2_legacy_module_downgrades_cumulative() -> None:
    project = make_temp("aidlc-matrix-c2l-")
    # REQ 无 track(存量未迁移)
    write(project, "docs/aidlc/modules/sample/inception/requirements.md",
          "# 需求\n### REQ-SAMPLE-001 登录\n- 描述: 登录\n")
    write(project, "docs/aidlc/modules/sample/inception/user-stories.md",
          "### STORY-SAMPLE-001\n- 来源: REQ-SAMPLE-001\n")
    write(project, "docs/aidlc/ideation/prd.md",
          "# 概述\n# 目标\n# 功能需求\nFR-001 登录\nFR-009 未承接\n## 验收标准\n- a\n# 非目标\n- b\n# 来源索引\n- c\n# 待确认问题\n无\n")
    write_state(project, "shared-contract-baseline", "sample")
    out = run_matrix(project, "sample")
    # 存量:missing_track 非空,累积缺口降级 → broken_rows 不含 FR,cumulative_status 降级
    assert out.get("missing_track"), out
    assert out.get("broken_rows") == [], out
    assert "FR-009" in out.get("uncovered_fr", []), out
    assert "MIGRATION_REQUIRED" in out.get("cumulative_status", ""), out
    print("PASS test_c2_legacy_module_downgrades_cumulative")


# ---- C2: 无 PRD 产物 → cumulative not_applicable ----
def test_c2_no_prd_is_not_applicable() -> None:
    project = make_temp("aidlc-matrix-c2n-")
    write(project, "docs/aidlc/modules/sample/inception/requirements.md",
          "# 需求\n### REQ-SAMPLE-001 登录\n- track: [doc-only]\n")
    write(project, "docs/aidlc/modules/sample/inception/user-stories.md",
          "### STORY-SAMPLE-001（REQ-SAMPLE-001）\n- 来源: REQ-SAMPLE-001\n")
    write_state(project, "shared-contract-baseline", "sample")
    out = run_matrix(project, "sample")
    assert out.get("prd_fr_total") == 0, out
    assert "not_applicable" in out.get("cumulative_status", ""), out
    print("PASS test_c2_no_prd_is_not_applicable")


# ---- B3: 合规新 PRD → 4 字段确定性 true ----
def test_b3_compliant_prd_fields_true() -> None:
    project = make_temp("aidlc-prd-ok-")
    write(project, "docs/aidlc/ideation/prd.md",
          "# 概述\n背景\n# 目标\n目标\n# 功能需求\nFR-001 登录\n## 验收标准\n- FR-001 验收: 登录成功\n"
          "# 非目标\n- 不支持匿名\n# 来源索引\n- 用户输入\n- 产品契约\n# 待确认问题\n无\n# 一致性检查\n通过\n")
    write_state(project, "prd-generation", "")
    res = run_prd(project)
    assert res.returncode == 0, res.stderr or res.stdout
    payload = json.loads(res.stdout)
    assert payload.get("acceptance_criteria_complete") is True, payload
    assert payload.get("non_goals_complete") is True, payload
    assert payload.get("source_index_complete") is True, payload
    assert payload.get("pending_questions_indexed") is True, payload
    print("PASS test_b3_compliant_prd_fields_true")


# ---- B3: 节存在但内容空的 PRD → 确定性判 false,gate 拦截 ----
def test_b3_empty_sections_prd_blocked() -> None:
    project = make_temp("aidlc-prd-empty-")
    # 6 节都在(过 required_sections),但验收/非目标/来源节无实际条目(内容空) → B3 确定性判 false。
    write(project, "docs/aidlc/ideation/prd.md",
          "# 概述\n背景\n# 目标\n目标\n# 功能需求\nFR-001 登录\n## 验收标准\n（待补充）\n# 非目标\n（待补充）\n# 来源索引\n（待补充）\n# 待确认问题\n无\n# 一致性检查\n通过\n")
    write_state(project, "prd-generation", "")
    res = run_prd(project)
    payload = json.loads(res.stdout) if res.stdout.strip() else {}
    # 内容空 → 至少 non_goals/source 判 false(验收因 acceptance 字样存在但无条目也应 false)
    assert payload.get("non_goals_complete") is False, payload
    assert payload.get("source_index_complete") is False, payload
    print("PASS test_b3_empty_sections_prd_blocked")


def main() -> None:
    test_b1_path_resolved_and_b3_stage_awareness()
    test_c2_uncovered_fr_on_migrated_module_is_broken()
    test_c2_legacy_module_downgrades_cumulative()
    test_c2_no_prd_is_not_applicable()
    test_b3_compliant_prd_fields_true()
    test_b3_empty_sections_prd_blocked()
    print("\nAll traceability-matrix + B3 tests passed.")


if __name__ == "__main__":
    main()
