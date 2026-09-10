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
    ):
        assert required in continuity, f"continuity contract missing: {required}"
    assert "自动执行 `park`" in continuity
    assert "recover re-enroll --apply" in continuity

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
