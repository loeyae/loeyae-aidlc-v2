import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	statSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
	type WorkflowState,
	loadWorkflowState,
	statePath,
	validateWorkflowState,
} from "./aidlc-state";
import {
	type EnrollmentRecord,
	createEnrollmentRecord,
	enrollmentPath,
	getRecoveryTrustKey,
	getTrustKey,
	keyIdentifier,
	projectIdentity,
	readEnrollment,
	signRecordWithKey,
	trustRootPath,
	verifyRecordWithKey,
	writeEnrollmentRecord,
} from "./aidlc-trust";

interface ReEnrollOptions {
	apply: boolean;
	reason?: string;
	expectWorkflow?: string;
	expectStateSha256?: string;
	expectSourceKey?: string;
	expectActiveKey?: string;
	expectEnrollmentWorkflow?: string;
	expectEnrollmentSha256?: string;
	expectSourceEnrollmentSha256?: string;
	expectSourceRootSha256?: string;
}

interface SourceEnrollmentProof {
	path: string;
	raw: Buffer;
	record: EnrollmentRecord;
	sha256: string;
	projectRoot: string;
	projectRootSha256: string;
	keyId: string;
}

interface RecoveryContext {
	projectRoot: string;
	state: WorkflowState;
	stateRaw: Buffer;
	stateSha256: string;
	stateKeyId: string;
	activeKeyId: string;
	enrollment: EnrollmentRecord | null;
	enrollmentRaw: Buffer | null;
	enrollmentSha256: string | null;
	enrollmentWorkflowId: string | null;
	sourceEnrollment: SourceEnrollmentProof | null;
	recoveryRequired: boolean;
}

interface RecoveryPlan extends Record<string, unknown> {
	schema_version: 1;
	operation: "re-enroll";
	status: "prepared";
	recovery_id: string;
	project_root: string;
	workflow_id: string;
	state_status: "parked";
	state_before_revision: number;
	state_after_revision: number;
	state_before_sha256: string;
	state_after_sha256: string;
	source_key_id: string;
	source_enrollment_sha256: string;
	source_project_root: string;
	source_project_root_sha256: string;
	target_project_root_sha256: string;
	active_key_id: string;
	enrollment_before_sha256: string | null;
	enrollment_before_workflow_id: string | null;
	enrollment_pending_sha256: string;
	enrollment_after_sha256: string;
	reason: string;
	created_at: string;
	integrity?: Record<string, unknown>;
}

interface PendingRecovery {
	directory: string;
	plan: RecoveryPlan;
	stateBefore: Buffer;
	stateAfter: Buffer;
	sourceEnrollment: Buffer;
	enrollmentBefore: Buffer | null;
	enrollmentPending: EnrollmentRecord;
	enrollmentAfter: EnrollmentRecord;
}

const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_ENROLLMENT_BYTES = 512 * 1024;
const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 30000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const KEY_ID_PATTERN = /^[a-f0-9]{16}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: Buffer | string): string {
	return createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value: Record<string, unknown>): Buffer {
	return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readRegularFile(
	path: string,
	label: string,
	maximumBytes?: number,
): Buffer {
	if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.isSymbolicLink())
		throw new Error(`${label} must be a regular non-symlink file: ${path}`);
	if (maximumBytes !== undefined && stat.size > maximumBytes)
		throw new Error(`${label} exceeds ${maximumBytes} bytes: ${path}`);
	return readFileSync(path);
}

function readOptionalRegularFile(path: string, label: string): Buffer | null {
	return existsSync(path) ? readRegularFile(path, label) : null;
}

function parseRecord(raw: Buffer, label: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw.toString("utf8"));
	} catch (error) {
		throw new Error(
			`${label} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(parsed)) throw new Error(`${label} must contain a JSON object`);
	return parsed;
}

function integrityKeyId(value: Record<string, unknown>, label: string): string {
	if (
		!isRecord(value.integrity) ||
		typeof value.integrity.key_id !== "string"
	) {
		throw new Error(`${label} has no integrity.key_id`);
	}
	return value.integrity.key_id;
}

function canonicalProjectRoot(): string {
	const root = realpathSync(resolve(process.cwd()));
	const path = statePath(root);
	const parent = realpathSync(dirname(path));
	const contained = relative(root, parent);
	if (contained.startsWith("..") || isAbsolute(contained)) {
		throw new Error(
			`state directory resolves outside the project root: ${parent}`,
		);
	}
	return root;
}

function readState(root: string): {
	state: WorkflowState;
	raw: Buffer;
	record: Record<string, unknown>;
} {
	const raw = readRegularFile(
		statePath(root),
		"workflow state",
		MAX_STATE_BYTES,
	);
	const record = parseRecord(raw, "workflow state");
	const state = validateWorkflowState(record, false);
	return { state, raw, record };
}

function readEnrollmentSnapshot(root: string): {
	record: EnrollmentRecord | null;
	raw: Buffer | null;
} {
	const record = readEnrollment(root);
	const raw = readOptionalRegularFile(
		enrollmentPath(root),
		"project enrollment",
	);
	if ((record === null) !== (raw === null))
		throw new Error("project enrollment changed while it was being inspected");
	return { record, raw };
}

function validateSourceEnrollmentProof(
	raw: Buffer,
	label: string,
	path: string,
	workflowId: string,
	sourceKey: Buffer,
): SourceEnrollmentProof {
	const value = parseRecord(raw, label);
	const allowed = new Set([
		"schema_version",
		"project_root",
		"workflow_id",
		"enrolled_at",
		"status",
		"integrity",
	]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) throw new Error(`${label} has unknown field ${key}`);
	}
	const integrityError = verifyRecordWithKey(value, sourceKey);
	if (integrityError)
		throw new Error(
			`${label} source signature proof failed: ${integrityError}`,
		);
	if (
		value.schema_version !== 1 ||
		typeof value.project_root !== "string" ||
		value.project_root.trim().length === 0 ||
		value.workflow_id !== workflowId ||
		value.status !== "active" ||
		typeof value.enrolled_at !== "string" ||
		Number.isNaN(new Date(value.enrolled_at).getTime())
	) {
		throw new Error(
			`${label} must be an active schema v1 enrollment for workflow ${workflowId}`,
		);
	}
	return {
		path,
		raw,
		record: value as EnrollmentRecord,
		sha256: sha256(raw),
		projectRoot: value.project_root,
		projectRootSha256: sha256(Buffer.from(value.project_root, "utf8")),
		keyId: integrityKeyId(value, label),
	};
}

function readSourceEnrollmentProof(
	workflowId: string,
	sourceKey: Buffer,
): SourceEnrollmentProof {
	const configured = process.env.AIDLC_RECOVERY_ENROLLMENT_FILE;
	if (configured === undefined) {
		throw new Error(
			"AIDLC_RECOVERY_ENROLLMENT_FILE is required to prove the source project binding",
		);
	}
	if (configured !== resolve(configured)) {
		throw new Error(
			"AIDLC_RECOVERY_ENROLLMENT_FILE must be an absolute normalized path",
		);
	}
	const path = resolve(configured);
	const raw = readRegularFile(
		path,
		"source enrollment proof",
		MAX_ENROLLMENT_BYTES,
	);
	return validateSourceEnrollmentProof(
		raw,
		"source enrollment proof",
		path,
		workflowId,
		sourceKey,
	);
}

function recoveryContext(
	root: string,
	sourceKey: Buffer,
	activeKey: Buffer,
): RecoveryContext {
	const { state, raw, record } = readState(root);
	if (state.status !== "parked") {
		throw new Error(
			`controlled re-enrollment requires state.status=parked; found ${state.status}`,
		);
	}
	const enrollment = readEnrollmentSnapshot(root);
	if (enrollment.record?.status === "pending") {
		throw new Error(
			"a pending enrollment exists without a matching recovery transaction; refusing to overwrite it",
		);
	}
	const activeError = verifyRecordWithKey(record, activeKey);
	const enrollmentWorkflowId = enrollment.record?.workflow_id ?? null;
	const enrollmentActive =
		enrollment.record !== null &&
		(enrollment.record.status ?? "active") === "active";
	const recoveryRequired =
		activeError !== null ||
		!enrollmentActive ||
		enrollmentWorkflowId !== state.workflow_id;
	let sourceEnrollment: SourceEnrollmentProof | null = null;
	if (recoveryRequired) {
		const sourceError = verifyRecordWithKey(record, sourceKey);
		if (sourceError)
			throw new Error(`source state signature proof failed: ${sourceError}`);
		sourceEnrollment = readSourceEnrollmentProof(state.workflow_id, sourceKey);
	}
	return {
		projectRoot: root,
		state,
		stateRaw: raw,
		stateSha256: sha256(raw),
		stateKeyId: integrityKeyId(record, "workflow state"),
		activeKeyId: keyIdentifier(activeKey),
		enrollment: enrollment.record,
		enrollmentRaw: enrollment.raw,
		enrollmentSha256: enrollment.raw ? sha256(enrollment.raw) : null,
		enrollmentWorkflowId,
		sourceEnrollment,
		recoveryRequired,
	};
}

function safeReason(value: string | undefined): string {
	if (value === undefined) throw new Error("--reason is required with --apply");
	const reason = value.trim();
	if ([...reason].length < 10 || [...reason].length > 500)
		throw new Error("--reason must contain 10 to 500 characters");
	if (
		[...reason].some((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint < 0x20 || codePoint === 0x7f;
		})
	) {
		throw new Error("--reason must not contain control characters");
	}
	return reason;
}

function expectedEnrollment(value: string | null): string {
	return value ?? "none";
}

function requiredOption(value: string | undefined, flag: string): string {
	if (!value) throw new Error(`${flag} is required with --apply`);
	return value;
}

function verifyApplyOptions(
	options: ReEnrollOptions,
	values: {
		workflowId: string;
		stateSha256: string;
		sourceKeyId: string;
		sourceEnrollmentSha256: string;
		sourceRootSha256: string;
		activeKeyId: string;
		enrollmentWorkflowId: string | null;
		enrollmentSha256: string | null;
		reason?: string;
	},
): string {
	const workflow = requiredOption(options.expectWorkflow, "--expect-workflow");
	const stateHash = requiredOption(
		options.expectStateSha256,
		"--expect-state-sha256",
	);
	const sourceKey = requiredOption(
		options.expectSourceKey,
		"--expect-source-key",
	);
	const sourceEnrollmentHash = requiredOption(
		options.expectSourceEnrollmentSha256,
		"--expect-source-enrollment-sha256",
	);
	const sourceRootHash = requiredOption(
		options.expectSourceRootSha256,
		"--expect-source-root-sha256",
	);
	const activeKey = requiredOption(
		options.expectActiveKey,
		"--expect-active-key",
	);
	const enrollment = requiredOption(
		options.expectEnrollmentWorkflow,
		"--expect-enrollment-workflow",
	);
	const enrollmentHash = requiredOption(
		options.expectEnrollmentSha256,
		"--expect-enrollment-sha256",
	);
	const reason = safeReason(options.reason);
	if (workflow !== values.workflowId)
		throw new Error("--expect-workflow does not match the signed state");
	if (stateHash !== values.stateSha256)
		throw new Error(
			"--expect-state-sha256 does not match the original state bytes",
		);
	if (sourceKey !== values.sourceKeyId)
		throw new Error(
			"--expect-source-key does not match the verified source key",
		);
	if (sourceEnrollmentHash !== values.sourceEnrollmentSha256)
		throw new Error(
			"--expect-source-enrollment-sha256 does not match the verified source enrollment bytes",
		);
	if (sourceRootHash !== values.sourceRootSha256)
		throw new Error(
			"--expect-source-root-sha256 does not match the source enrollment project root",
		);
	if (activeKey !== values.activeKeyId)
		throw new Error("--expect-active-key does not match the active trust key");
	if (enrollment !== expectedEnrollment(values.enrollmentWorkflowId)) {
		throw new Error(
			"--expect-enrollment-workflow does not match the current enrollment; use none only when no enrollment exists",
		);
	}
	if (enrollmentHash !== expectedEnrollment(values.enrollmentSha256)) {
		throw new Error(
			"--expect-enrollment-sha256 does not match the original enrollment bytes; use none only when no enrollment exists",
		);
	}
	if (values.reason !== undefined && reason !== values.reason)
		throw new Error(
			"--reason does not match the prepared recovery transaction",
		);
	return reason;
}

function planView(values: {
	projectRoot: string;
	workflowId: string;
	stateStatus: string;
	stateRevision: number;
	stateSha256: string;
	sourceKeyId: string;
	sourceEnrollmentSha256: string | null;
	sourceProjectRoot: string | null;
	sourceRootSha256: string | null;
	targetRootSha256: string;
	activeKeyId: string;
	enrollmentWorkflowId: string | null;
	enrollmentSha256: string | null;
	recoveryRequired: boolean;
	recoveryId?: string;
}): Record<string, unknown> {
	return {
		kind: "recovery-plan",
		operation: "re-enroll",
		transaction_status: values.recoveryId ? "incomplete" : "not-started",
		recovery_id: values.recoveryId ?? null,
		apply: false,
		recovery_required: values.recoveryRequired,
		project_root: values.projectRoot,
		state: {
			workflow_id: values.workflowId,
			status: values.stateStatus,
			revision: values.stateRevision,
			sha256: values.stateSha256,
			source_key_id: values.sourceKeyId,
		},
		active_trust: { key_id: values.activeKeyId },
		source_enrollment:
			values.sourceEnrollmentSha256 === null
				? null
				: {
						workflow_id: values.workflowId,
						project_root: values.sourceProjectRoot,
						project_root_sha256: values.sourceRootSha256,
						sha256: values.sourceEnrollmentSha256,
					},
		target_project_root_sha256: values.targetRootSha256,
		current_enrollment:
			values.enrollmentWorkflowId === null
				? null
				: {
						workflow_id: values.enrollmentWorkflowId,
						sha256: values.enrollmentSha256,
					},
		required_apply_flags: {
			expect_workflow: values.workflowId,
			expect_state_sha256: values.stateSha256,
			expect_source_key: values.sourceKeyId,
			expect_source_enrollment_sha256: values.sourceEnrollmentSha256,
			expect_source_root_sha256: values.sourceRootSha256,
			expect_active_key: values.activeKeyId,
			expect_enrollment_workflow: expectedEnrollment(
				values.enrollmentWorkflowId,
			),
			expect_enrollment_sha256: expectedEnrollment(values.enrollmentSha256),
			reason: "human-readable reason, 10-500 characters",
			apply: true,
		},
	};
}

function assertDirectory(path: string, label: string): void {
	const stat = lstatSync(path);
	if (!stat.isDirectory() || stat.isSymbolicLink())
		throw new Error(
			`${label} must be a regular non-symlink directory: ${path}`,
		);
}

function ensureDirectory(path: string, label: string): void {
	if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
	assertDirectory(path, label);
	chmodSync(path, 0o700);
}

function ensureChildDirectory(
	parent: string,
	name: string,
	label: string,
): string {
	assertDirectory(parent, dirname(label));
	const path = resolve(parent, name);
	if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
	assertDirectory(path, label);
	chmodSync(path, 0o700);
	return path;
}

function atomicWrite(path: string, content: Buffer): void {
	assertDirectory(dirname(path), "recovery output directory");
	const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
	let fd: number | undefined;
	try {
		fd = openSync(temporary, "wx", 0o600);
		writeSync(fd, content);
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		renameSync(temporary, path);
		chmodSync(path, 0o600);
	} finally {
		if (fd !== undefined) closeSync(fd);
		if (existsSync(temporary)) unlinkSync(temporary);
	}
}

function auditProjectDirectory(root: string): string {
	return resolve(trustRootPath(), "recovery-audit", projectIdentity(root).id);
}

function prepareAuditProjectDirectory(root: string): string {
	const trustRoot = trustRootPath();
	ensureDirectory(trustRoot, "trust root");
	const auditRoot = ensureChildDirectory(
		trustRoot,
		"recovery-audit",
		"recovery audit root",
	);
	return ensureChildDirectory(
		auditRoot,
		projectIdentity(root).id,
		"project recovery audit directory",
	);
}

function validatePlan(
	value: Record<string, unknown>,
	root: string,
	verificationKey: Buffer,
): RecoveryPlan {
	const integrityError = verifyRecordWithKey(value, verificationKey);
	if (integrityError)
		throw new Error(`recovery plan integrity failed: ${integrityError}`);
	const valid =
		value.schema_version === 1 &&
		value.operation === "re-enroll" &&
		value.status === "prepared" &&
		typeof value.recovery_id === "string" &&
		value.recovery_id.length > 0 &&
		value.project_root === root &&
		typeof value.workflow_id === "string" &&
		value.workflow_id.length > 0 &&
		value.state_status === "parked" &&
		Number.isInteger(value.state_before_revision) &&
		Number.isInteger(value.state_after_revision) &&
		typeof value.state_before_sha256 === "string" &&
		SHA256_PATTERN.test(value.state_before_sha256) &&
		typeof value.state_after_sha256 === "string" &&
		SHA256_PATTERN.test(value.state_after_sha256) &&
		typeof value.source_key_id === "string" &&
		KEY_ID_PATTERN.test(value.source_key_id) &&
		typeof value.source_enrollment_sha256 === "string" &&
		SHA256_PATTERN.test(value.source_enrollment_sha256) &&
		typeof value.source_project_root === "string" &&
		value.source_project_root.length > 0 &&
		typeof value.source_project_root_sha256 === "string" &&
		SHA256_PATTERN.test(value.source_project_root_sha256) &&
		value.source_project_root_sha256 ===
			sha256(Buffer.from(value.source_project_root, "utf8")) &&
		typeof value.target_project_root_sha256 === "string" &&
		value.target_project_root_sha256 === sha256(Buffer.from(root, "utf8")) &&
		typeof value.active_key_id === "string" &&
		KEY_ID_PATTERN.test(value.active_key_id) &&
		value.active_key_id === keyIdentifier(verificationKey) &&
		(value.enrollment_before_sha256 === null ||
			(typeof value.enrollment_before_sha256 === "string" &&
				SHA256_PATTERN.test(value.enrollment_before_sha256))) &&
		(value.enrollment_before_workflow_id === null ||
			typeof value.enrollment_before_workflow_id === "string") &&
		typeof value.enrollment_pending_sha256 === "string" &&
		SHA256_PATTERN.test(value.enrollment_pending_sha256) &&
		typeof value.enrollment_after_sha256 === "string" &&
		SHA256_PATTERN.test(value.enrollment_after_sha256) &&
		typeof value.reason === "string" &&
		typeof value.created_at === "string" &&
		!Number.isNaN(new Date(value.created_at).getTime());
	if (!valid) throw new Error("recovery plan schema is invalid");
	if (
		value.state_after_revision !==
		(value.state_before_revision as number) + 1
	) {
		throw new Error("recovery plan revision transition is invalid");
	}
	return value as RecoveryPlan;
}

function parseEnrollment(
	raw: Buffer,
	label: string,
	activeKey: Buffer,
): EnrollmentRecord {
	const value = parseRecord(raw, label);
	const error = verifyRecordWithKey(value, activeKey);
	if (error) throw new Error(`${label} integrity failed: ${error}`);
	return value as EnrollmentRecord;
}

function loadPendingRecovery(
	directory: string,
	root: string,
	sourceKey: Buffer,
	activeKey: Buffer,
): PendingRecovery {
	assertDirectory(directory, "recovery transaction directory");
	const planRaw = readRegularFile(
		resolve(directory, "plan.json"),
		"recovery plan",
	);
	const plan = validatePlan(
		parseRecord(planRaw, "recovery plan"),
		root,
		activeKey,
	);
	const stateBefore = readRegularFile(
		resolve(directory, "state.before.json"),
		"state backup",
		MAX_STATE_BYTES,
	);
	const stateAfter = readRegularFile(
		resolve(directory, "state.after.json"),
		"staged recovered state",
		MAX_STATE_BYTES,
	);
	const sourceEnrollment = readRegularFile(
		resolve(directory, "source.enrollment.json"),
		"source enrollment backup",
		MAX_ENROLLMENT_BYTES,
	);
	const enrollmentBefore =
		plan.enrollment_before_sha256 === null
			? null
			: readRegularFile(
					resolve(directory, "enrollment.before.json"),
					"enrollment backup",
				);
	const pendingRaw = readRegularFile(
		resolve(directory, "enrollment.pending.json"),
		"staged pending enrollment",
	);
	const afterRaw = readRegularFile(
		resolve(directory, "enrollment.after.json"),
		"staged active enrollment",
	);
	if (
		sha256(stateBefore) !== plan.state_before_sha256 ||
		sha256(stateAfter) !== plan.state_after_sha256
	) {
		throw new Error(
			`recovery state backup or staged file hash mismatch: ${directory}`,
		);
	}
	if (sha256(sourceEnrollment) !== plan.source_enrollment_sha256) {
		throw new Error(
			`recovery source enrollment backup hash mismatch: ${directory}`,
		);
	}
	const sourceProof = validateSourceEnrollmentProof(
		sourceEnrollment,
		"source enrollment backup",
		resolve(directory, "source.enrollment.json"),
		plan.workflow_id,
		sourceKey,
	);
	if (
		sourceProof.projectRoot !== plan.source_project_root ||
		sourceProof.projectRootSha256 !== plan.source_project_root_sha256
	) {
		throw new Error(
			`recovery source enrollment root does not match the signed plan: ${directory}`,
		);
	}
	if (
		(enrollmentBefore ? sha256(enrollmentBefore) : null) !==
		plan.enrollment_before_sha256
	) {
		throw new Error(`recovery enrollment backup hash mismatch: ${directory}`);
	}
	if (
		sha256(pendingRaw) !== plan.enrollment_pending_sha256 ||
		sha256(afterRaw) !== plan.enrollment_after_sha256
	) {
		throw new Error(`recovery staged enrollment hash mismatch: ${directory}`);
	}
	const beforeRecord = parseRecord(stateBefore, "state backup");
	const beforeState = validateWorkflowState(beforeRecord, false);
	const sourceError = verifyRecordWithKey(beforeRecord, sourceKey);
	if (sourceError)
		throw new Error(
			`recovery state backup source proof failed: ${sourceError}`,
		);
	const afterRecord = parseRecord(stateAfter, "staged recovered state");
	const afterState = validateWorkflowState(afterRecord, false);
	const activeError = verifyRecordWithKey(afterRecord, activeKey);
	if (activeError)
		throw new Error(`staged recovered state integrity failed: ${activeError}`);
	if (
		beforeState.workflow_id !== plan.workflow_id ||
		beforeState.status !== "parked" ||
		beforeState.revision !== plan.state_before_revision ||
		afterState.workflow_id !== plan.workflow_id ||
		afterState.status !== "parked" ||
		afterState.revision !== plan.state_after_revision
	) {
		throw new Error(
			`recovery staged state semantics do not match the signed plan: ${directory}`,
		);
	}
	const enrollmentPending = parseEnrollment(
		pendingRaw,
		"staged pending enrollment",
		activeKey,
	);
	const enrollmentAfter = parseEnrollment(
		afterRaw,
		"staged active enrollment",
		activeKey,
	);
	if (enrollmentPending.recovery_id !== plan.recovery_id) {
		throw new Error(
			`staged pending enrollment is not bound to recovery ${plan.recovery_id}`,
		);
	}
	if (enrollmentAfter.recovery_id !== undefined) {
		throw new Error("staged active enrollment must not retain recovery_id");
	}
	return {
		directory,
		plan,
		stateBefore,
		stateAfter,
		sourceEnrollment,
		enrollmentBefore,
		enrollmentPending,
		enrollmentAfter,
	};
}

function findPendingRecovery(
	root: string,
	sourceKey: Buffer,
	activeKey: Buffer,
): PendingRecovery | null {
	const projectDirectory = auditProjectDirectory(root);
	if (!existsSync(projectDirectory)) return null;
	assertDirectory(projectDirectory, "project recovery audit directory");
	const pending: PendingRecovery[] = [];
	for (const entry of readdirSync(projectDirectory, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
		const directory = resolve(projectDirectory, entry.name);
		const planPath = resolve(directory, "plan.json");
		const resultPath = resolve(directory, "result.json");
		if (!existsSync(planPath)) continue;
		if (existsSync(resultPath)) {
			const completedPlanValue = parseRecord(
				readRegularFile(planPath, "completed recovery plan"),
				"completed recovery plan",
			);
			const result = parseRecord(
				readRegularFile(resultPath, "completed recovery result"),
				"completed recovery result",
			);
			const auditKeyId = integrityKeyId(
				completedPlanValue,
				"completed recovery plan",
			);
			const auditKey =
				auditKeyId === keyIdentifier(activeKey)
					? activeKey
					: auditKeyId === keyIdentifier(sourceKey)
						? sourceKey
						: null;
			if (auditKey === null) continue;
			const completedPlan = validatePlan(completedPlanValue, root, auditKey);
			const resultError = verifyRecordWithKey(result, auditKey);
			if (resultError)
				throw new Error(
					`completed recovery result integrity failed: ${resultError}`,
				);
			if (
				result.status !== "completed" ||
				result.operation !== "re-enroll" ||
				result.recovery_id !== completedPlan.recovery_id ||
				result.project_root !== root
			) {
				throw new Error(
					`completed recovery result does not match its plan: ${directory}`,
				);
			}
			continue;
		}
		pending.push(loadPendingRecovery(directory, root, sourceKey, activeKey));
	}
	if (pending.length > 1)
		throw new Error(
			`multiple incomplete recovery transactions exist for ${root}`,
		);
	return pending[0] ?? null;
}

function createRecoveryTransaction(
	context: RecoveryContext,
	sourceKey: Buffer,
	activeKey: Buffer,
	reason: string,
): PendingRecovery {
	const recoveryId = randomUUID();
	const createdAt = new Date().toISOString();
	if (context.sourceEnrollment === null) {
		throw new Error("source enrollment proof is required to prepare recovery");
	}
	const nextState = {
		...context.state,
		revision: context.state.revision + 1,
		updated_at: createdAt,
		approval_challenges: {},
	} as WorkflowState;
	const unsignedState = { ...nextState } as Record<string, unknown>;
	nextState.integrity = signRecordWithKey(
		unsignedState,
		activeKey,
	) as unknown as Record<string, unknown>;
	validateWorkflowState(nextState, false);
	const stateAfter = jsonBytes(nextState);
	const enrollmentPending = createEnrollmentRecord(
		context.projectRoot,
		context.state.workflow_id,
		"pending",
		createdAt,
		recoveryId,
	);
	const enrollmentAfter = createEnrollmentRecord(
		context.projectRoot,
		context.state.workflow_id,
		"active",
		createdAt,
	);
	const pendingBytes = jsonBytes(enrollmentPending);
	const afterBytes = jsonBytes(enrollmentAfter);
	const unsignedPlan: RecoveryPlan = {
		schema_version: 1,
		operation: "re-enroll",
		status: "prepared",
		recovery_id: recoveryId,
		project_root: context.projectRoot,
		workflow_id: context.state.workflow_id,
		state_status: "parked",
		state_before_revision: context.state.revision,
		state_after_revision: nextState.revision,
		state_before_sha256: context.stateSha256,
		state_after_sha256: sha256(stateAfter),
		source_key_id: keyIdentifier(sourceKey),
		source_enrollment_sha256: context.sourceEnrollment.sha256,
		source_project_root: context.sourceEnrollment.projectRoot,
		source_project_root_sha256: context.sourceEnrollment.projectRootSha256,
		target_project_root_sha256: sha256(
			Buffer.from(context.projectRoot, "utf8"),
		),
		active_key_id: keyIdentifier(activeKey),
		enrollment_before_sha256: context.enrollmentSha256,
		enrollment_before_workflow_id: context.enrollmentWorkflowId,
		enrollment_pending_sha256: sha256(pendingBytes),
		enrollment_after_sha256: sha256(afterBytes),
		reason,
		created_at: createdAt,
	};
	const plan = {
		...unsignedPlan,
		integrity: signRecordWithKey(unsignedPlan, activeKey) as unknown as Record<
			string,
			unknown
		>,
	};
	const projectDirectory = prepareAuditProjectDirectory(context.projectRoot);
	const directory = ensureChildDirectory(
		projectDirectory,
		recoveryId,
		"recovery transaction directory",
	);
	atomicWrite(resolve(directory, "state.before.json"), context.stateRaw);
	atomicWrite(
		resolve(directory, "source.enrollment.json"),
		context.sourceEnrollment.raw,
	);
	if (context.enrollmentRaw)
		atomicWrite(
			resolve(directory, "enrollment.before.json"),
			context.enrollmentRaw,
		);
	atomicWrite(resolve(directory, "state.after.json"), stateAfter);
	atomicWrite(resolve(directory, "enrollment.pending.json"), pendingBytes);
	atomicWrite(resolve(directory, "enrollment.after.json"), afterBytes);
	atomicWrite(resolve(directory, "plan.json"), jsonBytes(plan));
	return loadPendingRecovery(
		directory,
		context.projectRoot,
		sourceKey,
		activeKey,
	);
}

function fileShaOrNull(path: string, label: string): string | null {
	const raw = readOptionalRegularFile(path, label);
	return raw ? sha256(raw) : null;
}

function writeStateFile(root: string, content: Buffer): void {
	const path = statePath(root);
	const parent = dirname(path);
	assertDirectory(parent, "state directory");
	const temporary = `${path}.recovery-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
	let fd: number | undefined;
	try {
		fd = openSync(temporary, "wx", 0o600);
		writeSync(fd, content);
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		renameSync(temporary, path);
		chmodSync(path, 0o600);
	} finally {
		if (fd !== undefined) closeSync(fd);
		if (existsSync(temporary)) unlinkSync(temporary);
	}
}

function failpoint(name: string): void {
	if (process.env.AIDLC_RECOVERY_FAILPOINT === name)
		throw new Error(`recovery failpoint ${name}`);
}

function executeRecovery(
	transaction: PendingRecovery,
	activeKey: Buffer,
): Record<string, unknown> {
	const root = transaction.plan.project_root;
	const stateFile = statePath(root);
	const enrollmentFile = enrollmentPath(root);
	let stateHash = fileShaOrNull(stateFile, "workflow state");
	let enrollmentHash = fileShaOrNull(enrollmentFile, "project enrollment");
	const beforeEnrollmentHash = transaction.plan.enrollment_before_sha256;
	const validInitial =
		(stateHash === transaction.plan.state_before_sha256 &&
			enrollmentHash === beforeEnrollmentHash) ||
		(stateHash === transaction.plan.state_before_sha256 &&
			enrollmentHash === transaction.plan.enrollment_pending_sha256) ||
		(stateHash === transaction.plan.state_after_sha256 &&
			enrollmentHash === transaction.plan.enrollment_pending_sha256) ||
		(stateHash === transaction.plan.state_after_sha256 &&
			enrollmentHash === transaction.plan.enrollment_after_sha256);
	if (!validInitial) {
		throw new Error(
			`live state or enrollment does not match the prepared recovery transaction ${transaction.plan.recovery_id}`,
		);
	}
	if (
		stateHash === transaction.plan.state_before_sha256 &&
		enrollmentHash === beforeEnrollmentHash
	) {
		writeEnrollmentRecord(root, transaction.enrollmentPending);
		enrollmentHash = transaction.plan.enrollment_pending_sha256;
		failpoint("after-pending-enrollment");
	}
	if (
		stateHash === transaction.plan.state_before_sha256 &&
		enrollmentHash === transaction.plan.enrollment_pending_sha256
	) {
		writeStateFile(root, transaction.stateAfter);
		stateHash = transaction.plan.state_after_sha256;
		failpoint("after-state");
	}
	if (
		stateHash === transaction.plan.state_after_sha256 &&
		enrollmentHash === transaction.plan.enrollment_pending_sha256
	) {
		writeEnrollmentRecord(root, transaction.enrollmentAfter);
		enrollmentHash = transaction.plan.enrollment_after_sha256;
	}
	if (
		stateHash !== transaction.plan.state_after_sha256 ||
		enrollmentHash !== transaction.plan.enrollment_after_sha256
	) {
		throw new Error(
			`recovery transaction ${transaction.plan.recovery_id} did not reach a verified committed state`,
		);
	}
	if (enrollmentHash === null)
		throw new Error(
			`recovery transaction ${transaction.plan.recovery_id} has no active enrollment`,
		);
	const committedEnrollmentHash = enrollmentHash;
	const loaded = loadWorkflowState(root);
	if (
		!loaded ||
		loaded.workflow_id !== transaction.plan.workflow_id ||
		loaded.revision !== transaction.plan.state_after_revision ||
		loaded.status !== "parked"
	) {
		throw new Error(
			`formal state verification failed after recovery ${transaction.plan.recovery_id}`,
		);
	}
	const completedAt = new Date().toISOString();
	const unsignedResult: Record<string, unknown> = {
		schema_version: 1,
		operation: "re-enroll",
		status: "completed",
		recovery_id: transaction.plan.recovery_id,
		project_root: root,
		reason: transaction.plan.reason,
		source_workflow_id: transaction.plan.workflow_id,
		previous_enrollment_workflow_id:
			transaction.plan.enrollment_before_workflow_id,
		active_workflow_id: loaded.workflow_id,
		source_key_id: transaction.plan.source_key_id,
		source_enrollment_sha256: transaction.plan.source_enrollment_sha256,
		source_project_root: transaction.plan.source_project_root,
		source_project_root_sha256: transaction.plan.source_project_root_sha256,
		target_project_root_sha256: transaction.plan.target_project_root_sha256,
		active_key_id: keyIdentifier(activeKey),
		state_revision_before: transaction.plan.state_before_revision,
		state_revision_after: loaded.revision,
		state_sha256_before: transaction.plan.state_before_sha256,
		state_sha256_after: transaction.plan.state_after_sha256,
		enrollment_sha256_before: transaction.plan.enrollment_before_sha256,
		enrollment_sha256_after: committedEnrollmentHash,
		enrollment_activation: "recovery-transaction",
		state_backup: resolve(transaction.directory, "state.before.json"),
		source_enrollment_backup: resolve(
			transaction.directory,
			"source.enrollment.json",
		),
		enrollment_backup: transaction.enrollmentBefore
			? resolve(transaction.directory, "enrollment.before.json")
			: null,
		prepared_at: transaction.plan.created_at,
		completed_at: completedAt,
	};
	const result = {
		...unsignedResult,
		integrity: signRecordWithKey(unsignedResult, activeKey),
	};
	atomicWrite(resolve(transaction.directory, "result.json"), jsonBytes(result));
	return {
		kind: "recovery-result",
		status: "completed",
		recovery_id: transaction.plan.recovery_id,
		project_root: root,
		workflow_id: loaded.workflow_id,
		revision: loaded.revision,
		state_sha256: transaction.plan.state_after_sha256,
		enrollment_sha256: committedEnrollmentHash,
		audit_directory: transaction.directory,
	};
}

function sleep(milliseconds: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireStateLock(root: string): { fd: number; path: string } {
	const path = `${statePath(root)}.lock`;
	const started = Date.now();
	while (true) {
		try {
			return { fd: openSync(path, "wx", 0o600), path };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const stat = lstatSync(path);
			if (!stat.isFile() || stat.isSymbolicLink())
				throw new Error(`state lock is not a regular file: ${path}`);
			if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
				unlinkSync(path);
				continue;
			}
			if (Date.now() - started >= LOCK_WAIT_MS)
				throw new Error(`timed out waiting for state lock: ${path}`);
			sleep(20);
		}
	}
}

function releaseStateLock(lock: { fd: number; path: string }): void {
	closeSync(lock.fd);
	if (existsSync(lock.path)) unlinkSync(lock.path);
}

async function confirmRecovery(values: {
	workflowId: string;
	stateSha256: string;
	sourceRootSha256: string;
	targetRootSha256: string;
	enrollmentWorkflowId: string | null;
}): Promise<void> {
	if (!stdin.isTTY || !stdout.isTTY) {
		throw new Error(
			"--apply requires an interactive human terminal; no non-interactive confirmation override exists",
		);
	}
	const phrase = `RECOVER ${values.workflowId} ${values.stateSha256.slice(0, 12)} FROM ${values.sourceRootSha256.slice(0, 12)} TO ${values.targetRootSha256.slice(0, 12)} REPLACE ${values.enrollmentWorkflowId ?? "NONE"}`;
	stdout.write(
		`This will migrate the proven source project binding to the current project root, preserve backups, increment the parked state revision, sign it with the active key, and replace the current enrollment.\nType exactly: ${phrase}\n`,
	);
	const reader = createInterface({ input: stdin, output: stdout });
	try {
		const response = await reader.question("> ");
		if (response.trim() !== phrase)
			throw new Error(
				"recovery confirmation phrase did not match; no files were changed",
			);
	} finally {
		reader.close();
	}
}

function parseReEnrollOptions(args: string[]): ReEnrollOptions {
	const options: ReEnrollOptions = { apply: false };
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--apply") {
			options.apply = true;
			continue;
		}
		if (argument === "--help" || argument === "-h") {
			printHelp();
			process.exit(0);
		}
		const value = args[index + 1];
		if (!value || value.startsWith("--"))
			throw new Error(`${argument} requires a value`);
		index += 1;
		if (argument === "--reason") options.reason = value;
		else if (argument === "--expect-workflow") options.expectWorkflow = value;
		else if (argument === "--expect-state-sha256")
			options.expectStateSha256 = value;
		else if (argument === "--expect-source-key")
			options.expectSourceKey = value;
		else if (argument === "--expect-active-key")
			options.expectActiveKey = value;
		else if (argument === "--expect-enrollment-workflow")
			options.expectEnrollmentWorkflow = value;
		else if (argument === "--expect-enrollment-sha256")
			options.expectEnrollmentSha256 = value;
		else if (argument === "--expect-source-enrollment-sha256")
			options.expectSourceEnrollmentSha256 = value;
		else if (argument === "--expect-source-root-sha256")
			options.expectSourceRootSha256 = value;
		else throw new Error(`unknown recovery argument: ${argument}`);
	}
	return options;
}

function inspect(): void {
	const root = canonicalProjectRoot();
	const activeKey = getTrustKey(false);
	const { state, raw, record } = readState(root);
	const enrollment = readEnrollmentSnapshot(root);
	let sourceVerification: Record<string, unknown> = {
		supplied: false,
		verified: false,
		key_id: null,
	};
	if (
		process.env.AIDLC_RECOVERY_SECRET !== undefined ||
		process.env.AIDLC_RECOVERY_KEY_FILE !== undefined
	) {
		const sourceKey = getRecoveryTrustKey();
		const sourceStateVerified = verifyRecordWithKey(record, sourceKey) === null;
		const sourceEnrollment =
			process.env.AIDLC_RECOVERY_ENROLLMENT_FILE !== undefined &&
			sourceStateVerified
				? readSourceEnrollmentProof(state.workflow_id, sourceKey)
				: null;
		sourceVerification = {
			supplied: true,
			verified: sourceStateVerified,
			key_id: keyIdentifier(sourceKey),
			enrollment: sourceEnrollment
				? {
						verified: true,
						workflow_id: sourceEnrollment.record.workflow_id,
						project_root: sourceEnrollment.projectRoot,
						project_root_sha256: sourceEnrollment.projectRootSha256,
						sha256: sourceEnrollment.sha256,
					}
				: { supplied: false, verified: false },
		};
	}
	const activeError = verifyRecordWithKey(record, activeKey);
	console.log(
		JSON.stringify(
			{
				kind: "recovery-inspection",
				project_root: root,
				state: {
					path: statePath(root),
					workflow_id: state.workflow_id,
					status: state.status,
					revision: state.revision,
					sha256: sha256(raw),
					key_id: integrityKeyId(record, "workflow state"),
					active_key_verified: activeError === null,
					active_key_error: activeError,
					source_key: sourceVerification,
				},
				active_trust: { key_id: keyIdentifier(activeKey) },
				enrollment: enrollment.record
					? {
							path: enrollmentPath(root),
							workflow_id: enrollment.record.workflow_id,
							status: enrollment.record.status ?? "active",
							key_id: integrityKeyId(
								parseRecord(enrollment.raw as Buffer, "project enrollment"),
								"project enrollment",
							),
							sha256: sha256(enrollment.raw as Buffer),
						}
					: null,
				mismatches: {
					state_key: activeError !== null,
					workflow:
						enrollment.record !== null &&
						enrollment.record.workflow_id !== state.workflow_id,
					enrollment_missing: enrollment.record === null,
				},
			},
			null,
			2,
		),
	);
}

async function reEnroll(args: string[]): Promise<void> {
	const options = parseReEnrollOptions(args);
	const root = canonicalProjectRoot();
	const sourceKey = getRecoveryTrustKey();
	const activeKey = getTrustKey(false);
	const sourceKeyId = keyIdentifier(sourceKey);
	const activeKeyId = keyIdentifier(activeKey);
	const pending = findPendingRecovery(root, sourceKey, activeKey);
	let values: {
		projectRoot: string;
		workflowId: string;
		stateStatus: string;
		stateRevision: number;
		stateSha256: string;
		sourceKeyId: string;
		sourceEnrollmentSha256: string | null;
		sourceProjectRoot: string | null;
		sourceRootSha256: string | null;
		targetRootSha256: string;
		activeKeyId: string;
		enrollmentWorkflowId: string | null;
		enrollmentSha256: string | null;
		recoveryRequired: boolean;
		recoveryId?: string;
		reason?: string;
	};
	if (pending) {
		values = {
			projectRoot: root,
			workflowId: pending.plan.workflow_id,
			stateStatus: pending.plan.state_status,
			stateRevision: pending.plan.state_before_revision,
			stateSha256: pending.plan.state_before_sha256,
			sourceKeyId: pending.plan.source_key_id,
			sourceEnrollmentSha256: pending.plan.source_enrollment_sha256,
			sourceProjectRoot: pending.plan.source_project_root,
			sourceRootSha256: pending.plan.source_project_root_sha256,
			targetRootSha256: pending.plan.target_project_root_sha256,
			activeKeyId: pending.plan.active_key_id,
			enrollmentWorkflowId: pending.plan.enrollment_before_workflow_id,
			enrollmentSha256: pending.plan.enrollment_before_sha256,
			recoveryRequired: true,
			recoveryId: pending.plan.recovery_id,
			reason: pending.plan.reason,
		};
	} else {
		const context = recoveryContext(root, sourceKey, activeKey);
		values = {
			projectRoot: root,
			workflowId: context.state.workflow_id,
			stateStatus: context.state.status,
			stateRevision: context.state.revision,
			stateSha256: context.stateSha256,
			sourceKeyId: context.stateKeyId,
			sourceEnrollmentSha256: context.sourceEnrollment?.sha256 ?? null,
			sourceProjectRoot: context.sourceEnrollment?.projectRoot ?? null,
			sourceRootSha256: context.sourceEnrollment?.projectRootSha256 ?? null,
			targetRootSha256: sha256(Buffer.from(root, "utf8")),
			activeKeyId: context.activeKeyId,
			enrollmentWorkflowId: context.enrollmentWorkflowId,
			enrollmentSha256: context.enrollmentSha256,
			recoveryRequired: context.recoveryRequired,
		};
	}
	if (values.recoveryRequired && values.sourceKeyId !== sourceKeyId) {
		throw new Error(
			"source recovery key does not match the prepared or signed state key ID",
		);
	}
	if (values.activeKeyId !== activeKeyId)
		throw new Error(
			"active trust key changed since the recovery plan was prepared",
		);
	if (!options.apply) {
		console.log(JSON.stringify(planView(values), null, 2));
		return;
	}
	if (!values.recoveryRequired)
		throw new Error(
			"state and enrollment already match the active trust chain; recovery is not required",
		);
	if (
		values.sourceEnrollmentSha256 === null ||
		values.sourceRootSha256 === null
	) {
		throw new Error(
			"verified source enrollment proof is required for recovery",
		);
	}
	const reason = verifyApplyOptions(options, {
		workflowId: values.workflowId,
		stateSha256: values.stateSha256,
		sourceKeyId: values.sourceKeyId,
		sourceEnrollmentSha256: values.sourceEnrollmentSha256,
		sourceRootSha256: values.sourceRootSha256,
		activeKeyId: values.activeKeyId,
		enrollmentWorkflowId: values.enrollmentWorkflowId,
		enrollmentSha256: values.enrollmentSha256,
		reason: values.reason,
	});
	await confirmRecovery({
		workflowId: values.workflowId,
		stateSha256: values.stateSha256,
		sourceRootSha256: values.sourceRootSha256,
		targetRootSha256: values.targetRootSha256,
		enrollmentWorkflowId: values.enrollmentWorkflowId,
	});
	const lock = acquireStateLock(root);
	try {
		const lockedPending = findPendingRecovery(root, sourceKey, activeKey);
		let transaction: PendingRecovery;
		if (lockedPending) {
			verifyApplyOptions(options, {
				workflowId: lockedPending.plan.workflow_id,
				stateSha256: lockedPending.plan.state_before_sha256,
				sourceKeyId: lockedPending.plan.source_key_id,
				sourceEnrollmentSha256: lockedPending.plan.source_enrollment_sha256,
				sourceRootSha256: lockedPending.plan.source_project_root_sha256,
				activeKeyId: lockedPending.plan.active_key_id,
				enrollmentWorkflowId: lockedPending.plan.enrollment_before_workflow_id,
				enrollmentSha256: lockedPending.plan.enrollment_before_sha256,
				reason: lockedPending.plan.reason,
			});
			transaction = lockedPending;
		} else {
			const context = recoveryContext(root, sourceKey, activeKey);
			if (!context.recoveryRequired)
				throw new Error(
					"state and enrollment already match the active trust chain; recovery is not required",
				);
			if (context.sourceEnrollment === null) {
				throw new Error(
					"verified source enrollment proof is required for recovery",
				);
			}
			verifyApplyOptions(options, {
				workflowId: context.state.workflow_id,
				stateSha256: context.stateSha256,
				sourceKeyId: context.stateKeyId,
				sourceEnrollmentSha256: context.sourceEnrollment.sha256,
				sourceRootSha256: context.sourceEnrollment.projectRootSha256,
				activeKeyId: context.activeKeyId,
				enrollmentWorkflowId: context.enrollmentWorkflowId,
				enrollmentSha256: context.enrollmentSha256,
			});
			transaction = createRecoveryTransaction(
				context,
				sourceKey,
				activeKey,
				reason,
			);
		}
		console.log(
			JSON.stringify(executeRecovery(transaction, activeKey), null, 2),
		);
	} finally {
		releaseStateLock(lock);
	}
}

function printHelp(): void {
	console.log(`Usage:
  loeyae-aidlc recover inspect
  loeyae-aidlc recover re-enroll [--apply] [confirmation flags]

Source proof (secret via exactly one key source; enrollment proof is also required for a new transaction):
  AIDLC_RECOVERY_SECRET          Original UTF-8 AIDLC_TRUST_SECRET value
  AIDLC_RECOVERY_KEY_FILE        Absolute path to the original base64 trust.key (0600 on POSIX)
  AIDLC_RECOVERY_ENROLLMENT_FILE Absolute path to the original signed active enrollment JSON

Apply confirmation flags (copy exact values from the dry-run output):
  --expect-workflow <id>
  --expect-state-sha256 <sha256>
  --expect-source-key <key-id>
  --expect-source-enrollment-sha256 <sha256>
  --expect-source-root-sha256 <sha256>
  --expect-active-key <key-id>
  --expect-enrollment-workflow <id|none>
  --expect-enrollment-sha256 <sha256|none>
  --reason <10-500 character explanation>
  --apply

The state must be parked. --apply also requires an interactive human terminal and an exact phrase; there is no --yes override.`);
}

async function main(): Promise<void> {
	const [command, ...rest] = process.argv.slice(2);
	if (command === "inspect") {
		if (
			rest.length > 0 &&
			!rest.every((value) => value === "--help" || value === "-h")
		) {
			throw new Error(
				`recover inspect does not accept arguments: ${rest.join(" ")}`,
			);
		}
		if (rest.length > 0) printHelp();
		else inspect();
		return;
	}
	if (command === "re-enroll") {
		await reEnroll(rest);
		return;
	}
	if (command === undefined || command === "--help" || command === "-h") {
		printHelp();
		return;
	}
	throw new Error(`unknown recover command: ${command}`);
}

main().catch((error) => {
	process.stderr.write(
		`${JSON.stringify({ kind: "error", message: error instanceof Error ? error.message : String(error) })}\n`,
	);
	process.exit(2);
});
