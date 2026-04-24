/**
 * src/ui/components/CloneFromGitModal.tsx
 *
 * Modal dialog for cloning a project from a Git repository.
 *
 * Fields:
 *   1. Repository URL  — free text; validated for Git URL format
 *   2. Repo name       — read-only, auto-derived from the URL
 *   3. Directory       — native folder picker (starts at home dir)
 *
 * Buttons:
 *   - Cancel  → closes modal, resets form (disabled while cloning)
 *   - Clone   → enabled only when URL is valid AND a directory is selected
 *
 * Clone operation states: idle → cloning → success | error
 *
 * Reuses the shared modal CSS classes (.modal-backdrop, .modal, .modal__*,
 * .form-field__*, .btn) established by NewProjectModal.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { validateGitUrl, isValidGitUrl } from "../utils/gitUrlUtils.ts";
import type {
	CloneRepositoryResult,
	CloneProgressEvent,
} from "../../electron/bridge.types.ts";
import {
	detectRepoVisibility,
	parseRepoUrl,
	type GitProvider,
	type RepoVisibility,
	type VisibilityStatus,
} from "../utils/repoVisibility.ts";
import { RepoVisibilityBadge } from "./RepoVisibilityBadge.tsx";
import {
	getClonePermission,
	getCloneUIState,
} from "../utils/clonePermission.ts";
import {
	CredentialsBlock,
	type Credentials,
} from "./CredentialsBlock.tsx";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Derives a repository name from a Git URL.
 * Strips trailing ".git" and returns the last path segment.
 * Returns an empty string if the URL is blank or unparseable.
 */
function deriveRepoName(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) return "";
	const normalized = trimmed.replace(/\/+$/, "");
	const lastSegment = normalized.split(/[/:]/g).pop() ?? "";
	return lastSegment.replace(/\.git$/i, "");
}

/**
 * Returns the home directory from the Electron context bridge,
 * or "/" as a safe fallback.
 */
function getHomeDir(): string {
	try {
		return (
			(window as unknown as { appPaths?: { home?: string } }).appPaths?.home ??
			"/"
		);
	} catch {
		return "/";
	}
}

/**
 * Returns the agentsFlow bridge if available, or undefined.
 */
function getBridge() {
	try {
		return (
			window as unknown as {
				agentsFlow?: {
					openFolderDialog?: () => Promise<string | null>;
					cloneRepository?: (req: {
						url: string;
						destDir: string;
						repoName?: string;
						cloneId: string;
						/** Ephemeral auth for private repos — receiver must NOT persist */
						auth?: { username: string; token: string };
					}) => Promise<CloneRepositoryResult>;
					cancelClone?: (req: { cloneId: string }) => Promise<{ sent: boolean; message: string }>;
					validateCloneToken?: (req: { token: string; username?: string }) => Promise<{ valid: boolean; status?: number; message: string; errorCode?: string }>;
					onCloneProgress?: (callback: (event: CloneProgressEvent) => void) => void;
					offCloneProgress?: () => void;
				};
			}
		).agentsFlow;
	} catch {
		return undefined;
	}
}

/**
 * Maps a CloneRepositoryResult errorCode to a user-friendly message.
 */
function getUxErrorMessage(
	errorCode: CloneRepositoryResult["errorCode"] | undefined,
	fallback: string | undefined,
): string {
	switch (errorCode) {
		case "AUTH_ERROR":
			return "Authentication failed. Check your username and token, and make sure the token has the 'repo' scope.";
		case "DEST_EXISTS":
			return "A folder with that name already exists in the selected directory. Choose a different destination or rename the existing folder.";
		case "NETWORK_ERROR":
			return "Could not reach the repository. Check your internet connection and verify the URL.";
		case "GIT_NOT_FOUND":
			return "Git is not installed or not found on PATH. Install Git and try again.";
		case "INVALID_URL":
			return "The repository URL is invalid. Make sure it starts with https:// or git@.";
		case "CANCELLED":
			return "Clone was cancelled.";
		case "CONCURRENT_LIMIT":
			return "Too many clones running at once. Wait for one to finish and try again.";
		case "IO_ERROR":
			return "A filesystem error occurred. Check that you have write permissions for the selected folder.";
		case "UNKNOWN":
		default:
			return fallback ?? "An unexpected error occurred during cloning.";
	}
}

/**
 * Returns a human-readable label for a CloneProgressStage.
 */
function stageLabel(stage: CloneProgressEvent["stage"]): string {
	switch (stage) {
		case "COUNTING_OBJECTS":   return "Counting objects";
		case "COMPRESSING":        return "Compressing objects";
		case "RECEIVING_OBJECTS":  return "Receiving objects";
		case "RESOLVING_DELTAS":   return "Resolving deltas";
		case "CHECKING_OUT":       return "Checking out files";
		default:                   return "Cloning";
	}
}

// ── Types ──────────────────────────────────────────────────────────────────

type ClonePhase = "idle" | "cloning" | "success" | "error";

// ── Props ──────────────────────────────────────────────────────────────────

interface CloneFromGitModalProps {
	isOpen: boolean;
	onClose: () => void;
	/** Called with the cloned directory path on successful clone */
	onCloned?: (clonedPath: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function CloneFromGitModal({
	isOpen,
	onClose,
	onCloned,
}: CloneFromGitModalProps) {
	// ── Form state ─────────────────────────────────────────────────────────
	const [repoUrl, setRepoUrl] = useState("");
	const [selectedDir, setSelectedDir] = useState<string | null>(null);

	// ── Validation state ───────────────────────────────────────────────────
	/** Whether the URL field has been touched (to delay showing errors) */
	const [urlTouched, setUrlTouched] = useState(false);
	const urlValidation = validateGitUrl(repoUrl);

	// ── Visibility detection state ─────────────────────────────────────────
	const [visibility, setVisibility] = useState<VisibilityStatus>("idle");
	/** Provider detected from the URL — used by clonePermission logic */
	const [provider, setProvider] = useState<GitProvider | null>(null);
	/** Raw RepoVisibility result (excluding transient UI states) for permission logic */
	const [repoVisibility, setRepoVisibility] = useState<RepoVisibility | null>(null);

	/** Tracks component mounted state to avoid setState after unmount */
	const mountedRef = useRef(true);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	/**
	 * Monotonically-increasing counter used to detect stale async responses.
	 */
	const visibilityRequestIdRef = useRef(0);

	// ── Credentials state (ephemeral — never persisted) ───────────────────
	// SECURITY: Do NOT log credentials
	const [credentials, setCredentials] = useState<Credentials>({
		username: "",
		token: "",
	});
	const [credentialsTouched, setCredentialsTouched] = useState(false);
	const [validateStatus, setValidateStatus] = useState<"idle" | "validating" | "ok" | "error">("idle");
	const [validateMessage, setValidateMessage] = useState<string | null>(null);

	// ── Clone operation state ──────────────────────────────────────────────
	const [phase, setPhase] = useState<ClonePhase>("idle");
	const [cloneError, setCloneError] = useState<string | null>(null);
	const [clonedPath, setClonedPath] = useState<string | null>(null);
	const [technicalDetails, setTechnicalDetails] = useState<string | null>(null);
	const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

	// ── Progress state ─────────────────────────────────────────────────────
	const [progressStage, setProgressStage] = useState<CloneProgressEvent["stage"] | null>(null);
	const [progressPercent, setProgressPercent] = useState<number | undefined>(undefined);

	// ── Clone ID (UUID per operation) ──────────────────────────────────────
	const cloneIdRef = useRef<string>("");

	// ── Derived ────────────────────────────────────────────────────────────
	const repoName = deriveRepoName(repoUrl);
	const isCloning = phase === "cloning";
	/** True while the visibility check is in progress — blocks UI to prevent race conditions */
	const isCheckingVisibility = visibility === "checking";

	/**
	 * Show credentials block only for private GitHub repos.
	 */
	const credentialsVisible = provider === "github" && visibility === "private";

	// ── Permission / UI state ──────────────────────────────────────────────
	const clonePermission = getClonePermission(provider, repoVisibility);
	const { buttonDisabled, errorMessage } = getCloneUIState(clonePermission);

	const visibilityPending = urlValidation.valid && visibility === "idle";
	const credentialsOk =
		!credentialsVisible ||
		(credentials.username.trim() !== "" && credentials.token.trim() !== "");
	const canClone =
		urlValidation.valid &&
		selectedDir !== null &&
		!isCloning &&
		!isCheckingVisibility &&
		!visibilityPending &&
		!buttonDisabled &&
		credentialsOk;

	// ── Refs ───────────────────────────────────────────────────────────────
	const urlInputRef = useRef<HTMLInputElement>(null);

	// ── Subscribe / unsubscribe to progress events ─────────────────────────
	useEffect(() => {
		const bridge = getBridge();
		if (!bridge?.onCloneProgress) return;

		bridge.onCloneProgress((event: CloneProgressEvent) => {
			// Only handle events for the current clone operation
			if (event.cloneId !== cloneIdRef.current) return;
			setProgressStage(event.stage);
			setProgressPercent(event.percent);
		});

		return () => {
			bridge.offCloneProgress?.();
		};
	}, []);

	// ── Reset form when modal opens ────────────────────────────────────────
	useEffect(() => {
		if (isOpen) {
			// Invalidate any in-flight visibility check
			visibilityRequestIdRef.current += 1;
			setRepoUrl("");
			setSelectedDir(null);
			setUrlTouched(false);
			setVisibility("idle");
			setProvider(null);
			setRepoVisibility(null);
			setPhase("idle");
			setCloneError(null);
			setClonedPath(null);
			setTechnicalDetails(null);
			setShowTechnicalDetails(false);
			setProgressStage(null);
			setProgressPercent(undefined);
			// SECURITY: Do NOT log credentials — clear on open
			setCredentials({ username: "", token: "" });
			setCredentialsTouched(false);
			setValidateStatus("idle");
			setValidateMessage(null);
			cloneIdRef.current = "";
			setTimeout(() => urlInputRef.current?.focus(), 50);
		}
	}, [isOpen]);

	// ── Credentials handlers ───────────────────────────────────────────────

	// SECURITY: Do NOT log credentials
	const clearCredentials = useCallback(() => {
		setCredentials({ username: "", token: "" });
		setCredentialsTouched(false);
		setValidateStatus("idle");
		setValidateMessage(null);
	}, []);

	const handleCredentialsChange = useCallback((next: Credentials) => {
		// SECURITY: Do NOT log credentials
		setCredentials(next);
		setCredentialsTouched(true);
		// Reset validate status when credentials change
		setValidateStatus("idle");
		setValidateMessage(null);
	}, []);

	// ── Validate token ─────────────────────────────────────────────────────
	const handleValidateToken = useCallback(async () => {
		const bridge = getBridge();
		if (!bridge?.validateCloneToken) return;
		if (!credentials.token.trim()) {
			setValidateStatus("error");
			setValidateMessage("Enter a token before validating.");
			return;
		}

		setValidateStatus("validating");
		setValidateMessage(null);

		try {
			// SECURITY: Do NOT log credentials
			const result = await bridge.validateCloneToken({
				token: credentials.token.trim(),
				username: credentials.username.trim() || undefined,
			});

			if (result.valid) {
				setValidateStatus("ok");
				setValidateMessage(result.message);
			} else {
				setValidateStatus("error");
				setValidateMessage(result.message);
			}
		} catch {
			setValidateStatus("error");
			setValidateMessage("Validation request failed. Check your connection.");
		}
	}, [credentials]);

	// ── Handle close (Cancel button / X button / Escape) ──────────────────
	const handleClose = useCallback(() => {
		if (isCloning) return;
		// SECURITY: Do NOT log credentials — clear on close
		clearCredentials();
		onClose();
	}, [isCloning, onClose, clearCredentials]);

	// ── Escape key closes modal (unless cloning) ───────────────────────────
	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !isCloning) handleClose();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, isCloning, handleClose]);

	// ── Backdrop click closes modal (unless cloning) ───────────────────────
	const handleBackdropClick = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (e.target === e.currentTarget && !isCloning) {
				// SECURITY: Do NOT log credentials — clear on close
				clearCredentials();
				onClose();
			}
		},
		[isCloning, onClose, clearCredentials],
	);

	// ── Directory picker ───────────────────────────────────────────────────
	const handleChooseDir = useCallback(async () => {
		try {
			const bridge = getBridge();
			if (!bridge?.openFolderDialog) return;
			const dir = await bridge.openFolderDialog();
			if (dir) setSelectedDir(dir);
		} catch {
			// No-op — picker was cancelled or bridge unavailable
		}
	}, []);

	// ── URL field change ───────────────────────────────────────────────────
	const handleUrlChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			setRepoUrl(e.target.value);
			// Invalidate any in-flight visibility check so stale results are ignored
			visibilityRequestIdRef.current += 1;
			// Reset visibility, provider and permission state on every keystroke
			setVisibility("idle");
			setProvider(null);
			setRepoVisibility(null);
			// SECURITY: Do NOT log credentials — clear on URL change
			clearCredentials();
			// Reset clone error when user edits the URL
			if (phase === "error") {
				setPhase("idle");
				setCloneError(null);
				setTechnicalDetails(null);
			}
		},
		[phase, clearCredentials],
	);

	/**
	 * Core visibility detection logic — shared between blur and submit.
	 */
	const runVisibilityCheck = useCallback(async (urlToCheck: string): Promise<import("../utils/repoVisibility.ts").RepoVisibility | "invalid" | null> => {
		if (!urlToCheck.trim() || !isValidGitUrl(urlToCheck)) {
			setVisibility("idle");
			setProvider(null);
			setRepoVisibility(null);
			clearCredentials();
			return "invalid";
		}

		visibilityRequestIdRef.current += 1;
		const thisRequestId = visibilityRequestIdRef.current;

		const parsed = parseRepoUrl(urlToCheck);
		const detectedProvider = parsed?.provider ?? null;
		setProvider(detectedProvider);
		setVisibility("checking");

		const result = await detectRepoVisibility(urlToCheck);

		if (!mountedRef.current) return null;
		if (visibilityRequestIdRef.current !== thisRequestId) return null;

		setRepoVisibility(result);
		const resolvedVisibility = result === "not_found" ? "private" : result;
		setVisibility(resolvedVisibility);

		if (!(detectedProvider === "github" && resolvedVisibility === "private")) {
			clearCredentials();
		}

		return result;
	}, [clearCredentials]);

	// ── URL field blur — trigger visibility detection ──────────────────────
	const handleUrlBlur = useCallback(async () => {
		setUrlTouched(true);
		await runVisibilityCheck(repoUrl);
	}, [repoUrl, runVisibilityCheck]);

	// ── Cancel clone ───────────────────────────────────────────────────────
	const handleCancelClone = useCallback(async () => {
		const bridge = getBridge();
		if (!bridge?.cancelClone || !cloneIdRef.current) return;
		try {
			await bridge.cancelClone({ cloneId: cloneIdRef.current });
		} catch {
			// No-op — the clone will resolve with CANCELLED errorCode anyway
		}
	}, []);

	// ── Done (post-success) ────────────────────────────────────────────────
	const handleDone = useCallback(() => {
		// SECURITY: Do NOT log credentials — clear before closing
		clearCredentials();
		if (clonedPath && onCloned) {
			onCloned(clonedPath);
		}
		onClose();
	}, [clonedPath, onCloned, onClose, clearCredentials]);

	// ── Clone ──────────────────────────────────────────────────────────────
	const handleClone = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			setUrlTouched(true);

			let effectiveVisibilityResult = repoVisibility;
			let effectiveProvider = provider;
			if (urlValidation.valid && visibility === "idle") {
				const parsed = parseRepoUrl(repoUrl);
				effectiveProvider = parsed?.provider ?? null;
				const checkResult = await runVisibilityCheck(repoUrl);
				if (checkResult === null) return;
				if (checkResult === "invalid") return;
				effectiveVisibilityResult = checkResult;
			}

			const freshPermission = getClonePermission(effectiveProvider, effectiveVisibilityResult);
			const { buttonDisabled: freshButtonDisabled } = getCloneUIState(freshPermission);

			const freshCredentialsVisible =
				effectiveProvider === "github" &&
				(effectiveVisibilityResult === "private" || effectiveVisibilityResult === "not_found");

			if (freshCredentialsVisible) {
				setCredentialsTouched(true);
				if (
					credentials.username.trim() === "" ||
					credentials.token.trim() === ""
				) {
					return;
				}
			}

			const canCloneNow =
				urlValidation.valid &&
				selectedDir !== null &&
				!isCloning &&
				!freshButtonDisabled;

			if (!canCloneNow || !selectedDir) return;

			const bridge = getBridge();
			if (!bridge?.cloneRepository) {
				setPhase("error");
				setCloneError(
					"Git clone is not available in this environment. " +
						"Make sure the Electron bridge is loaded.",
				);
				return;
			}

			// Generate a fresh UUID for this clone operation
			const newCloneId = crypto.randomUUID();
			cloneIdRef.current = newCloneId;

			setPhase("cloning");
			setCloneError(null);
			setTechnicalDetails(null);
			setShowTechnicalDetails(false);
			setProgressStage(null);
			setProgressPercent(undefined);

			try {
				// SECURITY: Do NOT log credentials — pass in-memory only, never persist
				const cloneRequest: {
					url: string;
					destDir: string;
					repoName?: string;
					cloneId: string;
					auth?: { username: string; token: string };
				} = {
					url: repoUrl.trim(),
					destDir: selectedDir,
					repoName: repoName || undefined,
					cloneId: newCloneId,
				};
				if (freshCredentialsVisible) {
					cloneRequest.auth = {
						username: credentials.username.trim(),
						token: credentials.token.trim(),
					};
				}

				const result = await bridge.cloneRepository(cloneRequest);

				// SECURITY: Clear credentials immediately after the request
				clearCredentials();

				if (result.success && result.clonedPath) {
					setPhase("success");
					setClonedPath(result.clonedPath);
				} else {
					setPhase("error");
					setCloneError(getUxErrorMessage(result.errorCode, result.error));
					if (result.technicalDetails) {
						setTechnicalDetails(result.technicalDetails);
					}
				}
			} catch (err) {
				clearCredentials();
				setPhase("error");
				setCloneError(
					err instanceof Error ? err.message : "An unexpected error occurred.",
				);
			}
		},
		[canClone, selectedDir, repoUrl, repoName, repoVisibility, provider, urlValidation.valid, visibility, isCloning, runVisibilityCheck, credentials, credentialsVisible, clearCredentials],
	);

	// ── Render ─────────────────────────────────────────────────────────────
	if (!isOpen) return null;

	/** Show URL format error only after the field has been touched and lost focus */
	const showUrlError =
		urlTouched && repoUrl.trim().length > 0 && !urlValidation.valid;

	return (
		<div
			className="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="clone-git-modal-title"
			onClick={handleBackdropClick}
		>
			<div className="modal" tabIndex={-1}>
				{/* ── Header ──────────────────────────────────────────────── */}
				<header className="modal__header">
					<h2 className="modal__title" id="clone-git-modal-title">
						Clone from Git
					</h2>
					<button
						className="modal__close-btn"
						onClick={handleClose}
						aria-label="Close dialog"
						disabled={isCloning}
					>
						✕
					</button>
				</header>

				{/* ── Form ─────────────────────────────────────────────────── */}
				<form className="modal__body" onSubmit={handleClone} noValidate>
					{/* Repository URL */}
					<div className="form-field">
						<label htmlFor="clone-git-url" className="form-field__label">
							Repository URL{" "}
							<span aria-hidden="true" className="form-field__required">
								*
							</span>
						</label>
						<input
							id="clone-git-url"
							ref={urlInputRef}
							type="url"
							className={[
								"form-field__input",
								showUrlError ? "form-field__input--error" : "",
							]
								.join(" ")
								.trim()}
							value={repoUrl}
							onChange={handleUrlChange}
							onBlur={handleUrlBlur}
							placeholder="https://github.com/org/repo.git"
							autoComplete="off"
							spellCheck={false}
						disabled={isCloning || isCheckingVisibility}
						aria-describedby={
							showUrlError ? "clone-git-url-error" : undefined
						}
							aria-invalid={showUrlError ? "true" : undefined}
						/>
						{showUrlError && (
							<span
								id="clone-git-url-error"
								className="form-field__error"
								role="alert"
							>
								{urlValidation.error}
							</span>
						)}
						<RepoVisibilityBadge status={visibility} />
						{errorMessage && (
							<p className="text-red-500 text-sm mt-1" role="alert">
								{errorMessage}
							</p>
						)}
					</div>

					{/* Repo name — read-only, auto-derived */}
					<div className="form-field">
						<label htmlFor="clone-git-name" className="form-field__label">
							Repository Name
						</label>
						<input
							id="clone-git-name"
							type="text"
							className="form-field__input form-field__input--readonly"
							value={repoName}
							readOnly
							aria-readonly="true"
							tabIndex={-1}
							placeholder="Auto-filled from URL"
						/>
						<span className="form-field__hint">
							Auto-filled from the URL. Not editable.
						</span>
					</div>

					{/* Destination directory */}
					<div className="form-field">
						<label className="form-field__label">
							Destination Folder{" "}
							<span aria-hidden="true" className="form-field__required">
								*
							</span>
						</label>
						<p className="form-field__hint">
							The repository will be cloned into a subfolder inside the selected
							location. Starts in your home directory ({getHomeDir()}).
						</p>

						<div className="form-field__dir-row">
							<span
								className="form-field__dir-path"
								title={selectedDir ?? "No folder selected"}
								aria-live="polite"
							>
								{selectedDir ?? (
									<span className="form-field__dir-placeholder">
										No folder selected
									</span>
								)}
							</span>

							<button
								type="button"
								className="btn btn--secondary form-field__dir-btn"
								onClick={handleChooseDir}
						disabled={isCloning || isCheckingVisibility}
							>
								Choose Folder
							</button>
						</div>

						{selectedDir && repoName && (
							<p
								className="form-field__hint form-field__hint--ok"
								aria-live="polite"
							>
								Will clone into:{" "}
								<code>
									{selectedDir}/{repoName}
								</code>
							</p>
						)}
					</div>

					{/* ── Credentials (private GitHub repos only) ───────────── */}
				{credentialsVisible && (
					<>
						<CredentialsBlock
							credentials={credentials}
							onChange={handleCredentialsChange}
							onClear={clearCredentials}
							disabled={isCloning || isCheckingVisibility}
							show={credentialsVisible}
							validation={{
								usernameOk: credentialsTouched
									? credentials.username.trim() !== ""
									: undefined,
								tokenOk: credentialsTouched
									? credentials.token.trim() !== ""
									: undefined,
							}}
						/>
						{/* Validate token button */}
						<div className="form-field" style={{ marginTop: "-0.5rem" }}>
							<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
								<button
									type="button"
									className="btn btn--secondary"
									onClick={handleValidateToken}
									disabled={isCloning || validateStatus === "validating" || !credentials.token.trim()}
								>
									{validateStatus === "validating" ? "Validating…" : "Validate Token"}
								</button>
								{validateStatus === "ok" && validateMessage && (
									<span className="form-field__hint" style={{ color: "var(--color-success, #22c55e)" }} role="status">
										✓ {validateMessage}
									</span>
								)}
								{validateStatus === "error" && validateMessage && (
									<span className="form-field__error" role="alert">
										{validateMessage}
									</span>
								)}
							</div>
						</div>
					</>
				)}

				{/* ── Clone status messages ──────────────────────────────── */}

					{phase === "cloning" && (
						<div
							className="form-field__status form-field__status--loading"
							role="status"
							aria-live="polite"
						>
							<span className="form-field__status-spinner" aria-hidden="true" />
							{progressStage
								? `${stageLabel(progressStage)}${progressPercent !== undefined ? ` — ${progressPercent}%` : "…"}`
								: "Cloning repository… This may take a moment."}
							{progressPercent !== undefined && (
								<progress
									value={progressPercent}
									max={100}
									aria-label="Clone progress"
									style={{ display: "block", width: "100%", marginTop: "0.5rem" }}
								/>
							)}
						</div>
					)}

					{phase === "success" && clonedPath && (
						<div
							className="form-field__status form-field__status--success"
							role="status"
							aria-live="polite"
						>
							✓ Repository cloned successfully into <code>{clonedPath}</code>
						</div>
					)}

					{phase === "error" && cloneError && (
						<div
							className="form-field__status form-field__status--error"
							role="alert"
							aria-live="assertive"
						>
							⚠ {cloneError}
							{technicalDetails && (
								<details style={{ marginTop: "0.5rem" }}>
									<summary
										style={{ cursor: "pointer", fontSize: "0.8em", opacity: 0.75 }}
										onClick={() => setShowTechnicalDetails((v) => !v)}
									>
										{showTechnicalDetails ? "Hide" : "Show"} technical details
									</summary>
									<pre
										style={{
											marginTop: "0.4rem",
											fontSize: "0.75em",
											whiteSpace: "pre-wrap",
											wordBreak: "break-all",
											opacity: 0.85,
										}}
									>
										{technicalDetails}
									</pre>
								</details>
							)}
						</div>
					)}

					{/* ── Footer ──────────────────────────────────────────────── */}
					<footer className="modal__footer">
						{phase === "success" ? (
							<button
								type="button"
								className="btn btn--primary"
								onClick={handleDone}
							>
								Done
							</button>
						) : (
							<>
							{isCloning ? (
								<button
									type="button"
									className="btn btn--ghost"
									onClick={handleCancelClone}
								>
									Cancel Clone
								</button>
							) : (
								<button
									type="button"
									className="btn btn--ghost"
									onClick={handleClose}
									disabled={isCheckingVisibility}
								>
									Cancel
								</button>
							)}
								<button
									type="submit"
									className="btn btn--primary"
									disabled={!canClone}
								>
									{isCloning ? "Cloning…" : "Clone"}
								</button>
							</>
						)}
					</footer>
				</form>
			</div>
		</div>
	);
}
