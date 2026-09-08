#!/usr/bin/env python3

import hashlib
import hmac
import json
import os
import pty
import select
import shutil
import stat
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
ENGINE = REPO_ROOT / "core" / "tools" / "aidlc-orchestrate.ts"
RECOVER = REPO_ROOT / "core" / "tools" / "aidlc-recover.ts"
TSX = subprocess.check_output(
    ["node", "-p", "require.resolve('tsx/cli')"], cwd=REPO_ROOT, text=True
).strip()
SCRATCH_ROOT = Path(os.environ.get("KIROCREW_SCRATCH") or os.environ.get("TMPDIR") or tempfile.gettempdir())
OLD_SECRET = "old-recovery-secret-value-1234567890"
NEW_SECRET = "new-active-secret-value-1234567890"
THIRD_SECRET = "third-active-secret-value-123456789"
WRONG_SECRET = "wrong-source-secret-value-1234567890"
ORPHAN_WORKFLOW = "orphan-current-enrollment-workflow"
REASON = "受控迁移旧签名工作流到当前主机信任链"


def canonical(value):
    if isinstance(value, dict):
        return {key: canonical(item) for key, item in sorted(value.items()) if key != "integrity"}
    if isinstance(value, list):
        return [canonical(item) for item in value]
    return value


def key_id(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()[:16]


def sign(record: dict, secret: str) -> dict:
    encoded = json.dumps(canonical(record), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    result = dict(record)
    result["integrity"] = {
        "algorithm": "hmac-sha256",
        "key_id": key_id(secret),
        "signature": hmac.new(secret.encode(), encoded, hashlib.sha256).hexdigest(),
    }
    return result


def verify(record: dict, secret: str) -> bool:
    integrity = record.get("integrity", {})
    if integrity.get("key_id") != key_id(secret):
        return False
    encoded = json.dumps(canonical(record), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    expected = hmac.new(secret.encode(), encoded, hashlib.sha256).hexdigest()
    return hmac.compare_digest(integrity.get("signature", ""), expected)


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def ts_command(script: Path, *args: str) -> list[str]:
    return ["node", TSX, str(script), *args]


def run(script: Path, args: list[str], cwd: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(ts_command(script, *args), cwd=cwd, env=env, capture_output=True, text=True)


def pty_run(
    script: Path,
    args: list[str],
    cwd: Path,
    env: dict[str, str],
    phrase: str,
    timeout: float = 30,
) -> tuple[int, str, bool]:
    master_fd, slave_fd = pty.openpty()
    process = subprocess.Popen(
        ts_command(script, *args),
        cwd=cwd,
        env=env,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
    )
    os.close(slave_fd)
    output = bytearray()
    sent = False
    deadline = time.time() + timeout
    try:
        while time.time() < deadline:
            ready, _, _ = select.select([master_fd], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(master_fd, 8192)
                except OSError:
                    break
                if not chunk:
                    break
                output.extend(chunk)
                if not sent and b"Type exactly:" in output:
                    os.write(master_fd, f"{phrase}\n".encode())
                    sent = True
            if process.poll() is not None:
                break
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
    finally:
        os.close(master_fd)
    return process.returncode, output.decode(errors="replace"), sent


class Assertions:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors: list[str] = []

    def ok(self, condition: bool, message: str):
        if condition:
            self.passed += 1
            print(f"  ✅ {message}")
        else:
            self.failed += 1
            self.errors.append(message)
            print(f"  ❌ {message}")


class Fixture:
    def __init__(self, name: str, parked: bool = True, mismatched_enrollment: bool = True):
        self.base = Path(tempfile.mkdtemp(prefix=f"{name}-", dir=SCRATCH_ROOT))
        self.project = self.base / "project"
        self.old_trust = self.base / "old-trust"
        self.new_trust = self.base / "new-trust"
        for directory in (self.project, self.old_trust, self.new_trust):
            directory.mkdir(mode=0o700)
        subprocess.run(["git", "init", "-q"], cwd=self.project, check=True)
        subprocess.run(["git", "config", "user.email", "aidlc-recovery-tests@example.invalid"], cwd=self.project, check=True)
        subprocess.run(["git", "config", "user.name", "AI-DLC Recovery Tests"], cwd=self.project, check=True)
        subprocess.run(["git", "commit", "--allow-empty", "-qm", "test baseline"], cwd=self.project, check=True)
        initialized = run(ENGINE, ["next", "--scope", "express"], self.project, self.old_env())
        if initialized.returncode != 0:
            raise RuntimeError(initialized.stderr or initialized.stdout)
        if parked:
            parked_result = run(ENGINE, ["park"], self.project, self.old_env())
            if parked_result.returncode != 0:
                raise RuntimeError(parked_result.stderr or parked_result.stdout)
        self.state_path = self.project / "docs" / "aidlc" / "aidlc-state.json"
        self.original_state = self.state_path.read_bytes()
        self.original_state_record = json.loads(self.original_state)
        self.source_enrollment_path = self.enrollment_file(self.old_trust)
        self.source_enrollment = self.source_enrollment_path.read_bytes()
        if mismatched_enrollment:
            self.write_enrollment(self.new_trust, ORPHAN_WORKFLOW, NEW_SECRET)
        self.enrollment_path = self.enrollment_file(self.new_trust)
        self.original_enrollment = self.enrollment_path.read_bytes() if self.enrollment_path.exists() else None

    def clean_env(self) -> dict[str, str]:
        env = os.environ.copy()
        for name in (
            "npm_config_prefix",
            "npm_execpath",
            "npm_command",
            "AIDLC_RECOVERY_FAILPOINT",
            "AIDLC_RECOVERY_KEY_FILE",
            "AIDLC_RECOVERY_SECRET",
            "AIDLC_RECOVERY_ENROLLMENT_FILE",
        ):
            env.pop(name, None)
        return env

    def old_env(self) -> dict[str, str]:
        env = self.clean_env()
        env["AIDLC_TRUST_SECRET"] = OLD_SECRET
        env["AIDLC_TRUST_DIR"] = str(self.old_trust)
        return env

    def active_env(self, source_secret: Optional[str] = OLD_SECRET) -> dict[str, str]:
        env = self.clean_env()
        env["AIDLC_TRUST_SECRET"] = NEW_SECRET
        env["AIDLC_TRUST_DIR"] = str(self.new_trust)
        env["AIDLC_RECOVERY_ENROLLMENT_FILE"] = str(self.source_enrollment_path)
        if source_secret is not None:
            env["AIDLC_RECOVERY_SECRET"] = source_secret
        return env

    def enrollment_file(self, trust_dir: Path) -> Path:
        identity = hashlib.sha256(os.path.realpath(self.project).encode()).hexdigest()
        return trust_dir / "enrollments" / f"{identity}.json"

    def write_enrollment(self, trust_dir: Path, workflow_id: str, secret: str, status_value: str = "active") -> Path:
        path = self.enrollment_file(trust_dir)
        path.parent.mkdir(mode=0o700, exist_ok=True)
        record = sign(
            {
                "schema_version": 1,
                "project_root": os.path.realpath(self.project),
                "workflow_id": workflow_id,
                "enrolled_at": "2026-01-01T00:00:00.000Z",
                "status": status_value,
            },
            secret,
        )
        path.write_text(json.dumps(record, indent=2) + "\n")
        os.chmod(path, 0o600)
        return path

    def dry_plan(self, env: Optional[dict[str, str]] = None) -> tuple[subprocess.CompletedProcess[str], dict]:
        result = run(RECOVER, ["re-enroll"], self.project, env or self.active_env())
        return result, json.loads(result.stdout) if result.returncode == 0 else {}

    def apply_args(self, plan: dict, reason: str = REASON) -> list[str]:
        flags = plan["required_apply_flags"]
        return [
            "re-enroll",
            "--expect-workflow", flags["expect_workflow"],
            "--expect-state-sha256", flags["expect_state_sha256"],
            "--expect-source-key", flags["expect_source_key"],
            "--expect-source-enrollment-sha256", flags["expect_source_enrollment_sha256"],
            "--expect-source-root-sha256", flags["expect_source_root_sha256"],
            "--expect-active-key", flags["expect_active_key"],
            "--expect-enrollment-workflow", flags["expect_enrollment_workflow"],
            "--expect-enrollment-sha256", flags["expect_enrollment_sha256"],
            "--reason", reason,
            "--apply",
        ]

    def phrase(self, plan: dict) -> str:
        flags = plan["required_apply_flags"]
        enrollment = flags["expect_enrollment_workflow"]
        rendered = "NONE" if enrollment == "none" else enrollment
        return (
            f"RECOVER {flags['expect_workflow']} {flags['expect_state_sha256'][:12]} "
            f"FROM {flags['expect_source_root_sha256'][:12]} "
            f"TO {plan['target_project_root_sha256'][:12]} REPLACE {rendered}"
        )

    def audit_transactions(self) -> list[Path]:
        root = self.new_trust / "recovery-audit"
        return sorted(path for path in root.glob("*/*") if path.is_dir()) if root.exists() else []

    def close(self):
        shutil.rmtree(self.base, ignore_errors=True)


def test_success_and_refusals(assertions: Assertions):
    print("\n--- recovery: proof, dry-run, exact expectations, TTY, audit ---")
    fixture = Fixture("aidlc-recovery-success")
    try:
        inspect_result = run(RECOVER, ["inspect"], fixture.project, fixture.active_env())
        inspection = json.loads(inspect_result.stdout)
        assertions.ok(
            inspect_result.returncode == 0
            and inspection["mismatches"] == {"state_key": True, "workflow": True, "enrollment_missing": False}
            and inspection["state"]["source_key"]["verified"] is True
            and inspection["state"]["source_key"]["enrollment"]["verified"] is True,
            "inspect reports both mismatches and verifies the supplied source key without exposing signatures",
        )
        assertions.ok("signature" not in inspect_result.stdout.lower(), "inspect output omits full signatures")

        state_before = fixture.state_path.read_bytes()
        enrollment_before = fixture.enrollment_path.read_bytes()
        dry_result, plan = fixture.dry_plan()
        assertions.ok(
            dry_result.returncode == 0
            and plan["recovery_required"] is True
            and plan["transaction_status"] == "not-started"
            and plan["source_enrollment"]["sha256"] == sha256(fixture.source_enrollment)
            and fixture.state_path.read_bytes() == state_before
            and fixture.enrollment_path.read_bytes() == enrollment_before
            and not fixture.audit_transactions(),
            "re-enroll defaults to a zero-write dry-run",
        )

        no_proof, _ = fixture.dry_plan(fixture.active_env(source_secret=None))
        wrong_proof, _ = fixture.dry_plan(fixture.active_env(source_secret=WRONG_SECRET))
        assertions.ok(
            no_proof.returncode == 2 and "AIDLC_RECOVERY" in no_proof.stderr,
            "missing old-key proof is rejected",
        )
        assertions.ok(
            wrong_proof.returncode == 2 and "source state signature proof failed" in wrong_proof.stderr,
            "wrong old-key proof is rejected",
        )

        missing_binding_env = fixture.active_env()
        missing_binding_env.pop("AIDLC_RECOVERY_ENROLLMENT_FILE")
        missing_binding, _ = fixture.dry_plan(missing_binding_env)
        assertions.ok(
            missing_binding.returncode == 2 and "source project binding" in missing_binding.stderr,
            "old state key alone is insufficient without a signed source enrollment",
        )

        wrong_binding_path = fixture.base / "wrong-source-enrollment.json"
        wrong_binding = sign(
            {
                "schema_version": 1,
                "project_root": os.path.realpath(fixture.project),
                "workflow_id": "different-old-workflow",
                "enrolled_at": "2026-01-01T00:00:00.000Z",
                "status": "active",
            },
            OLD_SECRET,
        )
        wrong_binding_path.write_text(json.dumps(wrong_binding, indent=2) + "\n")
        os.chmod(wrong_binding_path, 0o600)
        wrong_binding_env = fixture.active_env()
        wrong_binding_env["AIDLC_RECOVERY_ENROLLMENT_FILE"] = str(wrong_binding_path)
        wrong_binding_result, _ = fixture.dry_plan(wrong_binding_env)
        assertions.ok(
            wrong_binding_result.returncode == 2 and "active schema v1 enrollment" in wrong_binding_result.stderr,
            "source enrollment for another workflow cannot authorize state transplant",
        )

        windows_root = r"E:\\Work\\mall\\dfi-mall-kiro"
        cross_host_path = fixture.base / "cross-host-source-enrollment.json"
        cross_host_record = sign(
            {
                "schema_version": 1,
                "project_root": windows_root,
                "workflow_id": fixture.original_state_record["workflow_id"],
                "enrolled_at": "2026-01-01T00:00:00.000Z",
                "status": "active",
            },
            OLD_SECRET,
        )
        cross_host_path.write_text(json.dumps(cross_host_record, indent=2) + "\n")
        os.chmod(cross_host_path, 0o600)
        cross_host_env = fixture.active_env()
        cross_host_env["AIDLC_RECOVERY_ENROLLMENT_FILE"] = str(cross_host_path)
        cross_host_result, cross_host_plan = fixture.dry_plan(cross_host_env)
        assertions.ok(
            cross_host_result.returncode == 0
            and cross_host_plan["source_enrollment"]["project_root"] == windows_root
            and cross_host_plan["source_enrollment"]["project_root_sha256"]
            != cross_host_plan["target_project_root_sha256"],
            "signed source enrollment plus explicit root digests supports controlled cross-host path migration",
        )

        apply_args = fixture.apply_args(plan)
        noninteractive = run(RECOVER, apply_args, fixture.project, fixture.active_env())
        assertions.ok(
            noninteractive.returncode == 2
            and "interactive human terminal" in noninteractive.stderr
            and fixture.state_path.read_bytes() == state_before,
            "--apply cannot run without a human TTY and has no non-interactive override",
        )

        wrong_hash_args = list(apply_args)
        hash_index = wrong_hash_args.index("--expect-enrollment-sha256") + 1
        wrong_hash_args[hash_index] = "0" * 64
        wrong_hash = run(RECOVER, wrong_hash_args, fixture.project, fixture.active_env())
        assertions.ok(
            wrong_hash.returncode == 2
            and "--expect-enrollment-sha256" in wrong_hash.stderr
            and fixture.enrollment_path.read_bytes() == enrollment_before,
            "mismatched expected enrollment hash is rejected before confirmation",
        )

        no_reason_args = apply_args[:]
        reason_index = no_reason_args.index("--reason")
        del no_reason_args[reason_index:reason_index + 2]
        no_reason = run(RECOVER, no_reason_args, fixture.project, fixture.active_env())
        assertions.ok(no_reason.returncode == 2 and "--reason" in no_reason.stderr, "--apply requires a non-empty audit reason")

        returncode, output, sent = pty_run(
            RECOVER,
            apply_args,
            fixture.project,
            fixture.active_env(),
            fixture.phrase(plan),
        )
        assertions.ok(returncode == 0 and sent and '"status": "completed"' in output, "human-confirmed recovery commits successfully")

        state_after_raw = fixture.state_path.read_bytes()
        state_after = json.loads(state_after_raw)
        enrollment_after = json.loads(fixture.enrollment_path.read_bytes())
        ignored = {"revision", "updated_at", "integrity", "approval_challenges"}
        semantics_before = {key: value for key, value in fixture.original_state_record.items() if key not in ignored}
        semantics_after = {key: value for key, value in state_after.items() if key not in ignored}
        assertions.ok(
            state_after["workflow_id"] == fixture.original_state_record["workflow_id"]
            and state_after["status"] == "parked"
            and state_after["revision"] == fixture.original_state_record["revision"] + 1
            and state_after["integrity"]["key_id"] == key_id(NEW_SECRET)
            and semantics_after == semantics_before,
            "recovery preserves workflow semantics and only advances machine revision/time/trust metadata",
        )
        assertions.ok(
            enrollment_after["workflow_id"] == state_after["workflow_id"]
            and enrollment_after["project_root"] == os.path.realpath(fixture.project)
            and enrollment_after["status"] == "active"
            and verify(enrollment_after, NEW_SECRET),
            "new enrollment binds the canonical project path and original workflow to the active key",
        )
        formal = run(ENGINE, ["next", "--status"], fixture.project, fixture.active_env(source_secret=None))
        assertions.ok(formal.returncode == 0 and "Status: parked" in formal.stdout, "formal workflow loader accepts the recovered trust chain")

        transactions = fixture.audit_transactions()
        assertions.ok(len(transactions) == 1, "exactly one recovery audit transaction is retained")
        if transactions:
            transaction = transactions[0]
            plan_record = json.loads((transaction / "plan.json").read_text())
            result_record = json.loads((transaction / "result.json").read_text())
            assertions.ok(
                (transaction / "state.before.json").read_bytes() == state_before
                and (transaction / "source.enrollment.json").read_bytes() == fixture.source_enrollment
                and (transaction / "enrollment.before.json").read_bytes() == enrollment_before,
                "state and enrollment backups preserve the exact original bytes",
            )
            assertions.ok(
                verify(plan_record, NEW_SECRET)
                and verify(result_record, NEW_SECRET)
                and result_record["state_sha256_before"] == sha256(state_before)
                and result_record["state_sha256_after"] == sha256(state_after_raw)
                and result_record["enrollment_sha256_before"] == sha256(enrollment_before)
                and result_record["source_enrollment_sha256"] == sha256(fixture.source_enrollment),
                "prepared and completed audit records are active-key signed and hash both before/after records",
            )
            if os.name != "nt":
                files_secure = all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in transaction.iterdir() if path.is_file())
                assertions.ok(
                    stat.S_IMODE(transaction.stat().st_mode) == 0o700 and files_secure,
                    "recovery audit directories/files use 0700/0600 permissions",
                )
        retry_result, retry_plan = fixture.dry_plan()
        assertions.ok(
            retry_result.returncode == 0
            and retry_plan["recovery_required"] is False
            and len(fixture.audit_transactions()) == 1,
            "retry after a durable completed result is an idempotent no-op dry-run",
        )
        next_source_enrollment = fixture.base / "next-source-enrollment.json"
        next_source_enrollment.write_bytes(fixture.enrollment_path.read_bytes())
        os.chmod(next_source_enrollment, 0o600)
        fixture.write_enrollment(fixture.new_trust, "second-orphan-workflow", THIRD_SECRET)
        next_rotation_env = fixture.clean_env()
        next_rotation_env["AIDLC_TRUST_SECRET"] = THIRD_SECRET
        next_rotation_env["AIDLC_TRUST_DIR"] = str(fixture.new_trust)
        next_rotation_env["AIDLC_RECOVERY_SECRET"] = NEW_SECRET
        next_rotation_env["AIDLC_RECOVERY_ENROLLMENT_FILE"] = str(next_source_enrollment)
        next_rotation_result, next_rotation_plan = fixture.dry_plan(next_rotation_env)
        assertions.ok(
            next_rotation_result.returncode == 0
            and next_rotation_plan["recovery_required"] is True
            and next_rotation_plan["state"]["source_key_id"] == key_id(NEW_SECRET)
            and next_rotation_plan["active_trust"]["key_id"] == key_id(THIRD_SECRET),
            "a completed audit remains verifiable by the next source key and does not block a later rotation",
        )
    finally:
        fixture.close()


def test_running_tamper_and_symlinks(assertions: Assertions):
    print("\n--- recovery: parked-only, tamper and symlink refusal ---")
    running = Fixture("aidlc-recovery-running", parked=False)
    try:
        result, _ = running.dry_plan()
        assertions.ok(result.returncode == 2 and "state.status=parked" in result.stderr, "running workflows cannot be re-enrolled")
    finally:
        running.close()

    tampered = Fixture("aidlc-recovery-tampered")
    try:
        record = json.loads(tampered.state_path.read_text())
        record["scope"] = "feature"
        tampered.state_path.write_text(json.dumps(record, indent=2) + "\n")
        result, _ = tampered.dry_plan()
        assertions.ok(result.returncode == 2 and "source state signature proof failed" in result.stderr, "tampered state cannot be recovered even with the original key")
    finally:
        tampered.close()

    state_link = Fixture("aidlc-recovery-state-link")
    try:
        target = state_link.base / "state-target.json"
        target.write_bytes(state_link.state_path.read_bytes())
        state_link.state_path.unlink()
        state_link.state_path.symlink_to(target)
        result, _ = state_link.dry_plan()
        assertions.ok(result.returncode == 2 and "non-symlink" in result.stderr, "symlink workflow state is rejected")
    finally:
        state_link.close()

    enrollment_link = Fixture("aidlc-recovery-enrollment-link")
    try:
        target = enrollment_link.base / "enrollment-target.json"
        target.write_bytes(enrollment_link.enrollment_path.read_bytes())
        enrollment_link.enrollment_path.unlink()
        enrollment_link.enrollment_path.symlink_to(target)
        result, _ = enrollment_link.dry_plan()
        assertions.ok(result.returncode == 2 and "regular file" in result.stderr, "symlink enrollment is rejected")
    finally:
        enrollment_link.close()

    invalid_enrollment = Fixture("aidlc-recovery-invalid-enrollment")
    try:
        record = json.loads(invalid_enrollment.enrollment_path.read_text())
        record["workflow_id"] = "tampered-enrollment-workflow"
        invalid_enrollment.enrollment_path.write_text(json.dumps(record, indent=2) + "\n")
        result, _ = invalid_enrollment.dry_plan()
        assertions.ok(
            result.returncode == 2 and "enrollment integrity failed" in result.stderr,
            "invalid active enrollment is never overwritten by recovery",
        )
    finally:
        invalid_enrollment.close()

    missing_active = Fixture("aidlc-recovery-missing-active")
    try:
        env = missing_active.active_env()
        env.pop("AIDLC_TRUST_SECRET")
        result, _ = missing_active.dry_plan(env)
        assertions.ok(
            result.returncode == 2 and "trust key is missing" in result.stderr,
            "recovery never generates a missing active trust key implicitly",
        )
    finally:
        missing_active.close()

    secret_argument = Fixture("aidlc-recovery-secret-argument")
    try:
        result = run(
            RECOVER,
            ["re-enroll", "--recovery-secret", OLD_SECRET],
            secret_argument.project,
            secret_argument.active_env(),
        )
        assertions.ok(
            result.returncode == 2
            and "unknown recovery argument" in result.stderr
            and secret_argument.state_path.read_bytes() == secret_argument.original_state,
            "trust secrets are rejected as CLI arguments",
        )
    finally:
        secret_argument.close()

    key_file = Fixture("aidlc-recovery-key-file")
    try:
        source_key = key_file.base / "old-trust.key"
        import base64
        source_key.write_text(base64.b64encode(OLD_SECRET.encode()).decode() + "\n")
        os.chmod(source_key, 0o600)
        env = key_file.active_env(source_secret=None)
        env["AIDLC_RECOVERY_KEY_FILE"] = str(source_key)
        valid, plan = key_file.dry_plan(env)
        assertions.ok(valid.returncode == 0 and plan["state"]["source_key_id"] == key_id(OLD_SECRET), "0600 base64 source key file proves the old signature")

        os.chmod(source_key, 0o644)
        broad, _ = key_file.dry_plan(env)
        assertions.ok(
            os.name == "nt" or (broad.returncode == 2 and "permissions" in broad.stderr),
            "group/world-readable recovery key files are rejected on POSIX",
        )
        os.chmod(source_key, 0o600)
        link = key_file.base / "old-trust-link.key"
        link.symlink_to(source_key)
        env["AIDLC_RECOVERY_KEY_FILE"] = str(link)
        linked, _ = key_file.dry_plan(env)
        assertions.ok(linked.returncode == 2 and "non-symlink" in linked.stderr, "symlink recovery key files are rejected")
    finally:
        key_file.close()


def test_failpoint_resume(assertions: Assertions, failpoint: str, invoke_loader: bool):
    print(f"\n--- recovery: resume {failpoint} ---")
    fixture = Fixture(f"aidlc-recovery-{failpoint}")
    try:
        _, plan = fixture.dry_plan()
        args = fixture.apply_args(plan)
        env = fixture.active_env()
        env["AIDLC_RECOVERY_FAILPOINT"] = failpoint
        returncode, output, sent = pty_run(RECOVER, args, fixture.project, env, fixture.phrase(plan))
        assertions.ok(returncode == 2 and sent and f"recovery failpoint {failpoint}" in output, f"{failpoint} interrupts after a durable prepared plan")
        transactions = fixture.audit_transactions()
        assertions.ok(len(transactions) == 1 and not (transactions[0] / "result.json").exists(), "interrupted transaction retains backups/staged files without claiming completion")

        if invoke_loader:
            formal = run(ENGINE, ["next", "--status"], fixture.project, fixture.active_env(source_secret=None))
            assertions.ok(
                formal.returncode == 2 and "recovery transaction" in formal.stderr,
                "formal loader refuses to activate an incomplete recovery transaction",
            )

        resumed_dry, resumed_plan = fixture.dry_plan()
        assertions.ok(
            resumed_dry.returncode == 0
            and resumed_plan["transaction_status"] == "incomplete"
            and resumed_plan["recovery_id"] == transactions[0].name,
            "dry-run detects the exact incomplete signed transaction",
        )
        resumed_code, resumed_output, resumed_sent = pty_run(
            RECOVER,
            args,
            fixture.project,
            fixture.active_env(),
            fixture.phrase(resumed_plan),
        )
        assertions.ok(resumed_code == 0 and resumed_sent and '"status": "completed"' in resumed_output, "rerun resumes and completes the existing transaction")
        result_record = json.loads((transactions[0] / "result.json").read_text())
        expected_activation = "recovery-transaction"
        assertions.ok(
            result_record["enrollment_activation"] == expected_activation and verify(result_record, NEW_SECRET),
            "completed audit records the verified enrollment activation path",
        )
        formal_after = run(ENGINE, ["next", "--status"], fixture.project, fixture.active_env(source_secret=None))
        assertions.ok(formal_after.returncode == 0, "resumed recovery passes the formal loader")
    finally:
        fixture.close()


def test_unexpected_active_enrollment_rejected(assertions: Assertions):
    print("\n--- recovery: unexpected active enrollment refusal ---")
    fixture = Fixture("aidlc-recovery-unexpected-active")
    try:
        _, plan = fixture.dry_plan()
        args = fixture.apply_args(plan)
        env = fixture.active_env()
        env["AIDLC_RECOVERY_FAILPOINT"] = "after-state"
        interrupted_code, interrupted_output, sent = pty_run(
            RECOVER,
            args,
            fixture.project,
            env,
            fixture.phrase(plan),
        )
        assertions.ok(
            interrupted_code == 2
            and sent
            and "recovery failpoint after-state" in interrupted_output,
            "after-state failpoint prepares an incomplete exact-hash transaction",
        )

        workflow_id = plan["required_apply_flags"]["expect_workflow"]
        fixture.write_enrollment(fixture.new_trust, workflow_id, NEW_SECRET)
        resumed_code, resumed_output, resumed_sent = pty_run(
            RECOVER,
            args,
            fixture.project,
            fixture.active_env(),
            fixture.phrase(plan),
        )
        assertions.ok(
            resumed_code == 2
            and resumed_sent
            and "live state or enrollment does not match the prepared recovery transaction" in resumed_output,
            "a valid but non-planned active enrollment cannot finalize recovery",
        )
        transactions = fixture.audit_transactions()
        assertions.ok(
            len(transactions) == 1 and not (transactions[0] / "result.json").exists(),
            "unexpected enrollment replacement never creates a completed audit result",
        )
    finally:
        fixture.close()


def test_concurrent_and_noop(assertions: Assertions):
    print("\n--- recovery: concurrency and no-op refusal ---")
    fixture = Fixture("aidlc-recovery-concurrent")
    try:
        _, plan = fixture.dry_plan()
        args = fixture.apply_args(plan)
        phrase = fixture.phrase(plan)
        barrier = threading.Barrier(3)
        results: list[Optional[tuple[int, str, bool]]] = [None, None]

        def worker(index: int):
            barrier.wait()
            results[index] = pty_run(RECOVER, args, fixture.project, fixture.active_env(), phrase)

        threads = [threading.Thread(target=worker, args=(index,)) for index in range(2)]
        for thread in threads:
            thread.start()
        barrier.wait()
        for thread in threads:
            thread.join(timeout=45)
        codes = sorted(result[0] for result in results if result is not None)
        assertions.ok(codes == [0, 2], f"exactly one concurrent recovery commits (return codes {codes})")
        assertions.ok(len(fixture.audit_transactions()) == 1, "concurrent recovery creates only one completed transaction")
    finally:
        fixture.close()

    noop = Fixture("aidlc-recovery-noop", mismatched_enrollment=False)
    try:
        env = noop.old_env()
        env["AIDLC_RECOVERY_SECRET"] = OLD_SECRET
        result = run(RECOVER, ["re-enroll"], noop.project, env)
        plan = json.loads(result.stdout)
        assertions.ok(result.returncode == 0 and plan["recovery_required"] is False, "consistent active state/enrollment is reported as no recovery required")
        apply_result = run(RECOVER, ["re-enroll", "--apply"], noop.project, env)
        assertions.ok(apply_result.returncode == 2 and "recovery is not required" in apply_result.stderr, "no-op re-signing is refused")
    finally:
        noop.close()


def main() -> int:
    print("=" * 64)
    print("LOEYAE AI-DLC v2 — CONTROLLED RECOVERY TESTS")
    print("=" * 64)
    assertions = Assertions()
    test_success_and_refusals(assertions)
    test_running_tamper_and_symlinks(assertions)
    test_failpoint_resume(assertions, "after-pending-enrollment", invoke_loader=False)
    test_failpoint_resume(assertions, "after-state", invoke_loader=True)
    test_unexpected_active_enrollment_rejected(assertions)
    test_concurrent_and_noop(assertions)
    print(f"\n{'=' * 64}")
    print(f"TOTAL: {assertions.passed} ✅ passed, {assertions.failed} ❌ failed")
    print("=" * 64)
    if assertions.failed:
        print("\nFailed assertions:")
        for error in assertions.errors:
            print(f"  - {error}")
        return 1
    print("\n🎉 Controlled recovery tests passed!")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
