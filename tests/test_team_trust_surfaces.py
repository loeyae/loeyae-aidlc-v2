#!/usr/bin/env python3
"""Static contract checks for schema v3 per-device trust and enrollment surfaces."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    path = ROOT / relative
    assert path.is_file(), f"missing team trust surface: {path}"
    return path.read_text()


def require(relative: str, *needles: str) -> str:
    content = read(relative)
    for needle in needles:
        assert needle in content, f"{relative} is missing team trust contract: {needle}"
    return content


def main() -> None:
    contract = require(
        "docs/aidlc-collaboration-v3-contract.md",
        'algorithm: "ed25519"',
        "device-signature-v1",
        "team-enrollment-confirmation",
        "--team-enrollment-confirmation-stdin",
        "event_head_hash",
        "Provider/SCM",
        "完整成员授权 PKI",
        "旧 HMAC Git coordination log",
        "旧 HMAC Evidence",
    )
    assert "共享 `AIDLC_TRUST_SECRET`" in contract

    require(
        "README.md",
        "device-signing-key.json",
        "team-enrollment-confirmation",
        "--team-enrollment-confirmation-stdin",
        "device-signature-v1",
        "event head",
        "Provider/SCM",
        "v3 Evidence 不要求",
        "schema v2/HMAC/recovery",
    )
    require(
        "docs/loeyae-aidlc-cli-guide.md",
        "team-enrollment-confirmation",
        "--team-enrollment-confirmation-stdin",
        "device-signature-v1",
        "rollback/fork fail-closed",
        "schema v3 不应要求 `AIDLC_TRUST_SECRET`",
        "不是远程跨设备 Provider 协议",
    )
    require(
        "bin/cli.ts",
        "--team-enrollment-confirmation-stdin",
        "team members do not configure or share AIDLC_TRUST_SECRET",
        "Schema v2 HMAC and recovery remain",
        "not a remote cross-device Provider protocol",
    )
    require(
        "core/knowledge/protocols/common-quality-gates.md",
        "schema v3 使用本机自动管理、可跨设备验证的 Ed25519 envelope",
        "不创建 `trust.key`",
        "schema v2 legacy",
        "--instance <stage-instance>",
    )
    require(
        "core/sensors/build-test-evidence.md",
        '"algorithm": "ed25519"',
        '"public_key"',
        "only v2 legacy requires",
        "--instance <stage-instance>",
    )

    harnesses = (
        "harness/claude/CLAUDE.md",
        "harness/codebuddy/SKILL.md",
        "harness/codex/skills/loeyae-aidlc/SKILL.md",
        "harness/kiro-cli/SKILL.md",
        "harness/kiro-crew/skills/loeyae-aidlc/SKILL.md",
        "harness/kiro-ide/SKILL.md",
        "harness/opencode/INSTALL.md",
        "harness/qoder/SKILL.md",
        "harness/zcode/SKILL.md",
    )
    forbidden = (
        "必须在第一次 `next` 前向",
        "同一份至少 32 字节的 `AIDLC_TRUST_SECRET`",
        "Evidence 工作流必须在第一次",
    )
    for relative in harnesses:
        content = require(
            relative,
            "Ed25519",
            "team-enrollment-confirmation",
            "--team-enrollment-confirmation-stdin",
            "结束回合",
            "event head",
            "Provider/SCM",
            "AIDLC_TRUST_SECRET",
            "schema v2",
        )
        for stale in forbidden:
            assert stale not in content, f"{relative} retains stale shared-secret guidance: {stale}"

    print("Schema v3 per-device trust and enrollment surface tests passed")


if __name__ == "__main__":
    main()
