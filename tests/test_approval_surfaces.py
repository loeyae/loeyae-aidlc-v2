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
        "confirmation_phrase",
        "下一条新的用户消息",
        "结束当前 Agent 回合",
        "aidlc.approval.confirmation",
        "approval_confirmation",
        "--approval-confirmation-stdin",
        "--instance",
        "--claim-receipt-stdin",
        "NEEDS_CONFIRMATION",
        "可选本机通道",
        "同一设备",
        "migration_locked_instances",
        "aidlc-continuity",
        "TAKEOVER",
        "同一 `actor_id`",
        "新 device/client",
        "JOIN/TAKEOVER 短语当作 APPROVE",
        "AIDLC_TRUST_SECRET",
        "不是远程跨设备 Provider 协议",
        "真人交互式终端仍是备用路径",
    )
    assert "NEEDS_TRUSTED_APPROVAL" not in skill
    assert "预填 Approve 按钮" in skill

    command = require(
        ROOT / "harness" / "claude" / "commands" / "aidlc-approve.md",
        "description:",
        "skills/aidlc-approval/SKILL.md",
        "confirmation_phrase",
        "下一条新的用户消息",
        "--approval-confirmation-stdin",
        "--instance",
        "--claim-receipt-stdin",
        "Slash Command 本身不是批准",
        "可选的一键审批增强",
    )
    assert "AIDLC_APPROVAL_TOKEN=" not in command

    kiro = require(
        ROOT / "harness" / "kiro-crew" / "skills" / "loeyae-aidlc" / "trusted-approval-provider.md",
        "默认 AI-DLC 审批不依赖 KiroCrew 专用安全卡",
        "confirmation_phrase",
        "下一条真实用户消息",
        "approval_confirmation",
        "--approval-confirmation-stdin",
        "可选 Provider 响应",
        "同一受信设备",
        "本机 device credential",
        "不是远程跨设备 Provider 协议",
        "不配置、传递或共享 `AIDLC_TRUST_SECRET`",
        "不得要求用户另开终端",
    )
    assert "NEEDS_HOST_CAPABILITY" not in kiro

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
