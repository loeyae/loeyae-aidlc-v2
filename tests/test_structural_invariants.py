"""
structural-invariants(形态一致性)sensor + traceability-matrix 归属断言(D) 单测。

核心回归(落地自检):需求以并行/影子实体的错误形态落地、但追溯完整 ——
traceability-matrix 通过,structural-invariants 在生成阶段当场 fail-closed 阻断。

运行: python3 tests/test_structural_invariants.py
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
PRODUCER = os.path.join(REPO_ROOT, "core", "tools", "aidlc-evidence.ts")
NPX = shutil.which("npx") or shutil.which("npx.cmd") or "npx"
SCRATCH_ROOT = os.environ.get("KIROCREW_SCRATCH") or os.environ.get("TMPDIR") or tempfile.gettempdir()
MODULE = "order"
MANIFEST = f"docs/aidlc/modules/{MODULE}/inception/application-design/structural-invariants.json"


def make_temp(prefix: str) -> str:
    return tempfile.mkdtemp(prefix=prefix, dir=SCRATCH_ROOT)


def write(project: str, path: str, content: str) -> None:
    target = os.path.join(project, path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def write_json(project: str, path: str, value: dict) -> None:
    write(project, path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def write_state(project: str, stage: str, module_id: str = MODULE) -> None:
    state_uri = (Path(REPO_ROOT) / "core" / "tools" / "aidlc-light-state.ts").as_uri()
    script = (
        "import { createInitialState, loadWorkflowState, saveWorkflowState } from " + json.dumps(state_uri) + ";\n"
        "const state = loadWorkflowState(process.cwd()) || createInitialState('feature','4.0.0','invariant-test',[],'invariant test');\n"
        "state.current_phase = 'construction';\n"
        "state.current_stage = " + json.dumps(stage) + ";\n"
        "state.current_module = " + json.dumps(module_id) + ";\n"
        "saveWorkflowState(process.cwd(), state);\n"
    )
    runner = os.path.join(project, "_write_state.mts")
    with open(runner, "w", encoding="utf-8") as handle:
        handle.write(script)
    result = subprocess.run([NPX, "--no-install", "--prefix", REPO_ROOT, "tsx", runner],
                            cwd=project, env=os.environ.copy(), capture_output=True, text=True)
    os.remove(runner)
    assert result.returncode == 0, result.stderr or result.stdout


def run_checker(project: str, sensor: str) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["AIDLC_ACTIVE_MODULE"] = MODULE
    return subprocess.run([NPX, "--no-install", "--prefix", REPO_ROOT, "tsx", CHECKER, "--sensor", sensor],
                          cwd=project, env=env, capture_output=True, text=True, encoding="utf-8")


def passed(project: str, sensor: str = "structural-invariants") -> dict:
    result = run_checker(project, sensor)
    assert result.returncode == 0, result.stderr or result.stdout
    return json.loads(result.stdout)


def blocked(project: str) -> dict:
    result = run_checker(project, "structural-invariants")
    assert result.returncode != 0, result.stdout
    assert "structural" in result.stderr, result.stderr
    first = result.stdout.strip().splitlines()[0] if result.stdout.strip() else "{}"
    payload = json.loads(first)
    return {"payload": payload, "stderr": result.stderr}


# ---- fixtures ------------------------------------------------------------------------------

def base_project(prefix: str) -> str:
    """追溯完整的 data-track 需求:设计层、功能设计层、代码层(@ReqId)全部覆盖。"""
    project = make_temp(prefix)
    write(project, f"docs/aidlc/modules/{MODULE}/inception/requirements.md",
          "# 需求\n### REQ-ORDER-003 下单时记录客户信息\n- track: [data]\n- data_ownership: [INV-CUSTOMER-SSOT]\n")
    write(project, f"docs/aidlc/modules/{MODULE}/inception/user-stories.md",
          "### STORY-001（REQ-ORDER-003）\n- AC-001 下单成功\n")
    write(project, f"docs/aidlc/modules/{MODULE}/inception/application-design.md",
          "# 应用设计\n- OrderService 负责 REQ-ORDER-003,客户信息复用 customer 模块真源\n")
    write(project, f"docs/aidlc/modules/{MODULE}/construction/unit-a/functional-design.md",
          "# 功能设计\n- REQ-ORDER-003 下单引用 customer_id\n")
    write(project, "src/main/java/demo/order/OrderEntity.java",
          "package demo.order;\n// @ReqId REQ-ORDER-003\n@TableName(\"t_order\")\npublic class OrderEntity { Long customerId; }\n")
    write(project, "src/main/resources/mapper/OrderMapper.xml",
          "<mapper><select id=\"c\">select * from t_customer where id = #{id}</select>\n"
          "<insert id=\"i\">insert into t_order (id, customer_id) values (#{id}, #{cid})</insert></mapper>\n")
    return project


def ssot_manifest(**extra) -> dict:
    manifest = {
        "schema_version": "1",
        "invariants": [{
            "id": "INV-CUSTOMER-SSOT",
            "kind": "single-source-of-truth",
            "subject": "Customer",
            "owner": {"module": "customer", "tables": ["t_customer"], "entities": ["CustomerEntity"]},
            "aliases": ["client"],
            "patterns": ["customer_(?:copy|snapshot|mirror)$"],
            "requirements": ["REQ-ORDER-003"],
        }],
    }
    manifest.update(extra)
    return manifest


def approve_manifest(project: str) -> str:
    """在 application-design 阶段跑 checker,把其 manifest_digest 写成受控形态的应用设计证据。"""
    write_state(project, "application-design")
    out = passed(project)
    assert out["manifest_binding"] == "authoring", out
    write_json(project, f".aidlc/evidence/application-design/{MODULE}/structural-invariants.json", {
        **out,
        "evidence_version": "1",
        "producer": {"name": "loeyae-aidlc-evidence", "mode": "controlled", "execution_id": "fixture"},
        "checker": {"id": "builtin:structural-invariants", "sensor": "structural-invariants",
                    "argv_digest": "0" * 64, "exit_code": 0, "status": "passed"},
    })
    return out["manifest_digest"]


SHADOW_DDL = "CREATE TABLE IF NOT EXISTS `t_order_customer_snapshot` (id BIGINT, name VARCHAR(64));\n"


# ---- tests ---------------------------------------------------------------------------------

def test_no_manifest_is_not_applicable() -> None:
    project = base_project("aidlc-inv-na-")
    write(project, "src/main/resources/db/V2__shadow.sql", SHADOW_DDL)
    write_state(project, "code-generation")
    out = passed(project)
    assert out["status"] == "not_applicable" and out["violations"] == [] and out["skip_reason"], out
    print("PASS test_no_manifest_is_not_applicable")


def test_self_check_shadow_entity_blocked_while_traceability_complete() -> None:
    """落地自检:追溯完整 + 影子实体 → 覆盖门禁 PASS,形态门禁在 code-generation 当场阻断。"""
    project = base_project("aidlc-inv-shadow-")
    write_json(project, MANIFEST, ssot_manifest())
    approve_manifest(project)
    write(project, "src/main/resources/db/V2__order_customer.sql", SHADOW_DDL)
    write(project, "src/main/java/demo/order/OrderCustomerSnapshotEntity.java",
          "@TableName(value = \"t_order_customer_snapshot\")\npublic class OrderCustomerSnapshotEntity {}\n")
    write_state(project, "code-generation")
    matrix = passed(project, "traceability-matrix")
    assert matrix["broken_rows"] == [], matrix
    assert matrix["matrix"][0]["coverage_status"] == "COMPLETE", matrix
    assert matrix["matrix"][0]["ownership_status"] == "resolved", matrix
    result = blocked(project)
    violations = result["payload"]["violations"]
    assert result["payload"]["status"] == "blocked", result
    assert {v["rule"] for v in violations} == {"shadow-entity"}, violations
    assert {v["file"] for v in violations} == {"src/main/resources/db/V2__order_customer.sql",
                                                "src/main/java/demo/order/OrderCustomerSnapshotEntity.java"}, violations
    assert all(v["invariant"] == "INV-CUSTOMER-SSOT" and v["requirements"] == ["REQ-ORDER-003"] for v in violations), violations
    print("PASS test_self_check_shadow_entity_blocked_while_traceability_complete")


def test_positive_reuse_of_source_of_truth_passes() -> None:
    project = base_project("aidlc-inv-ok-")
    write_json(project, MANIFEST, ssot_manifest())
    digest = approve_manifest(project)
    write_state(project, "code-generation")
    out = passed(project)
    assert out["status"] == "passed" and out["violations"] == [], out
    assert out["manifest_binding"] == "bound" and out["manifest_digest"] == digest, out
    assert out["invariants_declared"] == 1 and out["operations_detected"] >= 2, out
    print("PASS test_positive_reuse_of_source_of_truth_passes")


def test_duplicate_canonical_and_foreign_write_blocked() -> None:
    project = base_project("aidlc-inv-dup-")
    write_json(project, MANIFEST, ssot_manifest())
    approve_manifest(project)
    write(project, "src/main/resources/db/V3__dup.sql",
          "CREATE TABLE t_customer (id BIGINT);\nUPDATE t_customer SET name = 'x' WHERE id = 1;\n")
    write_state(project, "code-generation")
    rules = {v["rule"] for v in blocked(project)["payload"]["violations"]}
    assert rules == {"duplicate-canonical", "foreign-write"}, rules
    print("PASS test_duplicate_canonical_and_foreign_write_blocked")


def test_deprecated_written_in_mapper_blocked_and_exemption_applies() -> None:
    project = base_project("aidlc-inv-dep-")
    write_json(project, MANIFEST, ssot_manifest(invariants=[{
        "id": "INV-LEGACY-ADDR", "kind": "deprecated", "subject": "OrderAddress", "targets": ["t_order_address"],
        "exemptions": [{"path": "src/main/resources/db/V1__init.sql", "reason": "历史基线建表,保留只读"}],
    }]))
    write(project, "src/main/resources/db/V1__init.sql", "CREATE TABLE t_order_address (id BIGINT);\n")
    approve_manifest(project)
    write_state(project, "code-generation")
    ok = passed(project)
    assert ok["exemptions_applied"] and ok["exemptions_applied"][0]["file"] == "src/main/resources/db/V1__init.sql", ok
    write(project, "src/main/resources/mapper/AddrMapper.xml",
          "<insert id=\"a\">INSERT INTO t_order_address (id) VALUES (#{id})</insert>\n")
    violations = blocked(project)["payload"]["violations"]
    assert [v["rule"] for v in violations] == ["deprecated-written"], violations
    print("PASS test_deprecated_written_in_mapper_blocked_and_exemption_applies")


def test_strict_persistence_requires_authorization() -> None:
    project = base_project("aidlc-inv-strict-")
    write_json(project, MANIFEST, ssot_manifest(persistence={
        "mode": "strict", "authorized": [{"names": ["t_order"], "refs": ["REQ-ORDER-003"]}],
    }))
    approve_manifest(project)
    write_state(project, "functional-design")
    assert passed(project)["persistence_mode"] == "strict"
    # 功能设计里新增一个未授权、也不匹配任何别名的实体 → unauthorized-entity
    write(project, f"docs/aidlc/modules/{MODULE}/construction/unit-a/functional-design/domain-entities.md",
          "# 领域实体\n## 订单 [实体:Order table=t_order]\n## 买家档案 [实体:BuyerProfile table=t_buyer_profile]\n")
    violations = blocked(project)["payload"]["violations"]
    assert [(v["rule"], v["name"]) for v in violations] == [("unauthorized-entity", "BuyerProfile")], violations
    print("PASS test_strict_persistence_requires_authorization")


def test_manifest_changed_after_approval_blocked() -> None:
    project = base_project("aidlc-inv-tamper-")
    write_json(project, MANIFEST, ssot_manifest())
    approve_manifest(project)
    weakened = ssot_manifest()
    weakened["invariants"][0]["exemptions"] = [{"path": "src/", "reason": "为了通过门禁临时豁免"}]
    write_json(project, MANIFEST, weakened)
    write_state(project, "code-generation")
    result = run_checker(project, "structural-invariants")
    assert result.returncode != 0 and "changed after application-design approval" in result.stderr, result.stderr
    print("PASS test_manifest_changed_after_approval_blocked")


def test_invalid_manifest_fails_closed() -> None:
    project = base_project("aidlc-inv-invalid-")
    manifest = ssot_manifest()
    manifest["invariants"][0]["requirements"] = ["REQ-ORDER-999"]
    manifest["invariants"][0]["patterns"] = ["("]
    write_json(project, MANIFEST, manifest)
    write_state(project, "application-design")
    result = run_checker(project, "structural-invariants")
    assert result.returncode != 0, result.stdout
    assert "REQ-ORDER-999" in result.stderr and "invalid regex" in result.stderr, result.stderr
    print("PASS test_invalid_manifest_fails_closed")


def test_traceability_ownership_dangling_is_broken() -> None:
    project = base_project("aidlc-inv-own-")
    write_state(project, "application-design")  # 声明了 data_ownership 但没有任何清单
    matrix = passed(project, "traceability-matrix")
    assert "REQ-ORDER-003: BROKEN@ownership" in matrix["broken_rows"], matrix
    write_state(project, "user-stories")  # 设计阶段前不判归属
    early = passed(project, "traceability-matrix")
    assert not any("ownership" in row for row in early["broken_rows"]), early
    print("PASS test_traceability_ownership_dangling_is_broken")


def test_baseline_ref_scans_only_changed_files() -> None:
    project = base_project("aidlc-inv-base-")
    write_json(project, MANIFEST, ssot_manifest(baseline_ref="HEAD"))
    write(project, "src/main/resources/db/V0__legacy.sql", SHADOW_DDL)  # 存量影子表,基线之前
    git = lambda *args: subprocess.run(["git", *args], cwd=project, capture_output=True, text=True, check=True)
    git("init", "-q")
    git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "baseline")
    approve_manifest(project)
    write_state(project, "code-generation")
    assert passed(project)["violations"] == []
    write(project, "src/main/resources/db/V9__new.sql", "CREATE TABLE client (id BIGINT);\n")
    violations = blocked(project)["payload"]["violations"]
    assert [(v["rule"], v["file"]) for v in violations] == [("shadow-entity", "src/main/resources/db/V9__new.sql")], violations
    print("PASS test_baseline_ref_scans_only_changed_files")


def test_producer_writes_blocked_report_and_no_evidence() -> None:
    project = base_project("aidlc-inv-producer-")
    write_json(project, MANIFEST, ssot_manifest())
    approve_manifest(project)
    write(project, "src/main/resources/db/V2__order_customer.sql", SHADOW_DDL)
    write_state(project, "code-generation")
    write_json(project, ".aidlc/evidence-commands.json", {
        "version": "1", "stage": "code-generation",
        "commands": [{"id": "si", "role": "semantic", "sensor": "structural-invariants",
                      "argv": ["loeyae-aidlc", "check", "--sensor", "structural-invariants"]}],
    })
    result = subprocess.run([NPX, "--no-install", "--prefix", REPO_ROOT, "tsx", PRODUCER, "run", "--stage", "code-generation",
                             "--sensor", "structural-invariants"],
                            cwd=project, env=os.environ.copy(), capture_output=True, text=True, encoding="utf-8")
    assert result.returncode != 0, result.stdout
    report_path = os.path.join(project, ".aidlc", "reports", "code-generation", MODULE, "structural-invariants.blocked.json")
    assert os.path.exists(report_path), result.stderr
    with open(report_path, encoding="utf-8") as handle:
        report = json.load(handle)
    assert report["status"] == "blocked" and report["violations"][0]["rule"] == "shadow-entity", report
    evidence_path = os.path.join(project, ".aidlc", "evidence", "code-generation", MODULE, "structural-invariants.json")
    assert not os.path.exists(evidence_path), "blocked run must not write gate evidence"
    leaked = [str(p) for p in Path(project, ".aidlc", "evidence").rglob("*.blocked.json")]
    assert not leaked, f"blocked report must stay outside .aidlc/evidence: {leaked}"
    print("PASS test_producer_writes_blocked_report_and_no_evidence")


def main() -> None:
    test_no_manifest_is_not_applicable()
    test_self_check_shadow_entity_blocked_while_traceability_complete()
    test_positive_reuse_of_source_of_truth_passes()
    test_duplicate_canonical_and_foreign_write_blocked()
    test_deprecated_written_in_mapper_blocked_and_exemption_applies()
    test_strict_persistence_requires_authorization()
    test_manifest_changed_after_approval_blocked()
    test_invalid_manifest_fails_closed()
    test_traceability_ownership_dangling_is_broken()
    test_baseline_ref_scans_only_changed_files()
    test_producer_writes_blocked_report_and_no_evidence()
    print("\nAll structural-invariants tests passed.")


if __name__ == "__main__":
    main()
