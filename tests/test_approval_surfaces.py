#!/usr/bin/env python3
"""Static contract checks for approval Skills and host entry points."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(path: Path, *needles: str) -> str:
    assert path.is_file(), f"missing approval surface: {path}"
    content = path.read_text()
    for needle in needles:
        assert needle in content, f"{path} is missing required contract: {needle}"
    return content


def main() -> None:
    skill = require(
        ROOT / "core" / "skills" / "aidlc-approval" / "SKILL.md",
        "name: aidlc-approval",
        "--request",
        "--approval-response-stdin",
        "--instance",
        "--claim-receipt-stdin",
        "claim receipt",
        "stdin envelope",
        "NEEDS_TRUSTED_APPROVAL",
        "普通聊天",
        "真人 TTY",
    )
    assert "非交互 token generator" in skill

    command = require(
        ROOT / "harness" / "claude" / "commands" / "aidlc-approve.md",
        "description:",
        "skills/aidlc-approval/SKILL.md",
        "--approval-response-stdin",
        "--instance",
        "--claim-receipt-stdin",
        "Slash Command 本身不是安全凭据",
    )
    assert "AIDLC_APPROVAL_TOKEN=" not in command

    kiro = require(
        ROOT / "harness" / "kiro-crew" / "skills" / "loeyae-aidlc" / "trusted-approval-provider.md",
        "ask_question",
        "NEEDS_HOST_CAPABILITY",
        "Agent 上下文",
        "真人 TTY fallback",
        "claim_receipt",
        "approval_response",
    )
    assert "不实现 Dashboard 后端" in kiro

    claude_manifest = require(
        ROOT / "harness" / "claude" / "manifest.ts",
        'src: "commands/aidlc-approve.md"',
        'dst: "commands/aidlc-approve.md"',
    )
    kiro_manifest = require(
        ROOT / "harness" / "kiro-crew" / "manifest.ts",
        'src: "skills/loeyae-aidlc/trusted-approval-provider.md"',
    )
    assert claude_manifest and kiro_manifest
    print("Approval surface contract tests passed")


if __name__ == "__main__":
    main()
