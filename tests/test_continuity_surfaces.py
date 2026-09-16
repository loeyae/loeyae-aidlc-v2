#!/usr/bin/env python3
"""Static contract checks for continuity and handoff Skills."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def text(path: Path) -> str:
    assert path.is_file(), f"missing continuity surface: {path}"
    return path.read_text()


def main() -> None:
    continuity = text(ROOT / "core" / "skills" / "aidlc-continuity" / "SKILL.md")
    for required in (
        "name: aidlc-continuity",
        "orchestrate next --status",
        "running",
        "不要求 park",
        "recover inspect",
        "TRUST_BLOCKED",
        "schema v2 不提供多人排他 claim",
        "actor/device/client",
        "ready set",
        "execution lease",
        "handoff_prompt",
        "下一步工作提示词",
        "handoff_status",
        "claim receipt",
        "--claim-receipt-stdin",
        "Local Provider",
        "team-enrollment-confirmation",
        "--team-enrollment-confirmation-stdin",
        "migration-claim-recovery-confirmation",
        "--migration-claim-recovery-confirmation-stdin",
        "TAKEOVER",
        "MIGRATION_CLAIM_CONFIRMATION_REQUIRED",
        "同一 actor",
        "有限期 receipt",
        "结束当前回合",
        "ENROLLMENT_CONFIRMATION_REQUIRED",
        "独立、不可共享",
        "event head",
        "完整成员授权 PKI",
        "AIDLC_TRUST_SECRET",
        "V1_REGENERATION_REQUIRED",
        "state regenerate-v3",
        "旧 Markdown 进度不得转成 completed/skipped/approval",
    ):
        assert required in continuity, f"continuity contract missing: {required}"
    assert "自动执行 `park`" in continuity
    assert "recover re-enroll --apply" in continuity

    stale_prompt = "复制 `handoff.md` 中的交接提示词到新对话继续"
    stale_files = [path for path in (ROOT / "core" / "stages").rglob("*.md") if stale_prompt in path.read_text()]
    assert not stale_files, f"legacy copy-handoff prompt remains in: {stale_files}"

    collaboration_contract = text(ROOT / "docs" / "aidlc-collaboration-v3-contract.md")
    for required in (
        "handoff_prompt",
        "兼容迁移矩阵",
        "V1 `docs/aidlc/state.md`",
        "schema v2 machine state",
        "schema v3 signed state",
        "progress_imported",
        "JOIN 后独立 TAKEOVER",
        "不能替代 Provider ACK",
    ):
        assert required in collaboration_contract, f"v3 migration contract missing: {required}"

    protocol = text(
        ROOT / "core" / "knowledge" / "protocols" / "common-session-continuity.md"
    )
    for required in (
        "migration_locked_instances",
        "migration-claim-recovery-confirmation",
        "TAKEOVER",
        "--migration-claim-recovery-confirmation-stdin",
        "同一 actor",
        "有限期 receipt",
        "JOIN 不自动夺取 claim",
        "state regenerate-v3",
        "workflow_regenerated.progress_imported",
    ):
        assert required in protocol, f"continuity protocol missing: {required}"

    handoff = text(ROOT / "core" / "skills" / "aidlc-handoff" / "SKILL.md")
    for required in (
        "name: aidlc-handoff",
        "skills/aidlc-continuity/SKILL.md",
        "不执行 `park`",
        "明确要求冻结整个 workflow",
        "release/transfer/expiry",
    ):
        assert required in handoff, f"handoff alias missing: {required}"

    print("Continuity surface contract tests passed")


if __name__ == "__main__":
    main()
