/**
 * src/ui/components/CloneFromGitModal.tsx
 *
 * Modal dialog for cloning a project from a Git repository.
 *
 * UI only — no real cloning logic is implemented yet.
 *
 * Fields:
 *   1. Repository URL  — free text, typed by the user
 *   2. Repo name       — read-only, auto-derived from the URL
 *   3. Directory       — native folder picker (starts at home dir)
 *
 * Buttons:
 *   - Cancel  → closes modal, resets form
 *   - Clone   → placeholder (no-op for now)
 *
 * Reuses the shared modal CSS classes (.modal-backdrop, .modal, .modal__*,
 * .form-field__*, .btn) established by NewProjectModal.
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Derives a repository name from a Git URL.
 * Strips trailing ".git" and returns the last path segment.
 * Returns an empty string if the URL is blank or unparseable.
 *
 * Examples:
 *   "https://github.com/org/my-repo.git" → "my-repo"
 *   "git@github.com:org/my-repo.git"     → "my-repo"
 *   "https://github.com/org/my-repo"     → "my-repo"
 */
function deriveRepoName(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) return "";

	// Remove trailing slash(es) before processing
	const normalized = trimmed.replace(/\/+$/, "");

	// Extract the last path segment (works for both https and ssh URLs)
	const lastSegment = normalized.split(/[/:]/g).pop() ?? "";

	// Strip .git suffix
	return lastSegment.replace(/\.git$/i, "");
}

/**
 * Returns the home directory from the Electron context bridge,
 * or "/" as a safe fallback.
 */
function getHomeDir(): string {
	try {
		// window.appPaths is exposed by the preload script via contextBridge
		return (
			(window as unknown as { appPaths?: { home?: string } }).appPaths?.home ??
			"/"
		);
	} catch {
		return "/";
	}
}

// ── Props ──────────────────────────────────────────────────────────────────

interface CloneFromGitModalProps {
	isOpen: boolean;
	onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function CloneFromGitModal({ isOpen, onClose }: CloneFromGitModalProps) {
	// ── Form state ─────────────────────────────────────────────────────────
	const [repoUrl, setRepoUrl] = useState("");
	const [selectedDir, setSelectedDir] = useState<string | null>(null);

	// ── Derived ────────────────────────────────────────────────────────────
	const repoName = deriveRepoName(repoUrl);

	// ── Refs ───────────────────────────────────────────────────────────────
	const urlInputRef = useRef<HTMLInputElement>(null);

	// ── Reset form when modal opens ────────────────────────────────────────
	useEffect(() => {
		if (isOpen) {
			setRepoUrl("");
			setSelectedDir(null);
			setTimeout(() => urlInputRef.current?.focus(), 50);
		}
	}, [isOpen]);

	// ── Escape key closes modal ────────────────────────────────────────────
	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	// ── Backdrop click closes modal ────────────────────────────────────────
	const handleBackdropClick = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (e.target === e.currentTarget) onClose();
		},
		[onClose],
	);

	// ── Directory picker ───────────────────────────────────────────────────
	const handleChooseDir = useCallback(async () => {
		try {
			const bridge = (
				window as unknown as {
					agentsFlow?: { openFolderDialog?: () => Promise<string | null> };
				}
			).agentsFlow;
			if (!bridge?.openFolderDialog) return;

			const dir = await bridge.openFolderDialog();
			if (dir) setSelectedDir(dir);
		} catch {
			// No-op — picker was cancelled or bridge unavailable
		}
	}, []);

	// ── Clone (placeholder — no real logic yet) ────────────────────────────
	const handleClone = useCallback((e: React.FormEvent) => {
		e.preventDefault();
		// TODO: implement real clone logic in a future iteration
	}, []);

	// ── Render ─────────────────────────────────────────────────────────────
	if (!isOpen) return null;

	const canClone = repoUrl.trim().length > 0 && selectedDir !== null;

	return (
		<div
			className="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="clone-git-modal-title"
			onClick={handleBackdropClick}
		>
			<div className="modal clone-git-modal" tabIndex={-1}>
				{/* ── Header ──────────────────────────────────────────────── */}
				<header className="modal__header">
					<h2 className="modal__title" id="clone-git-modal-title">
						Clone from Git
					</h2>
					<button
						className="modal__close-btn"
						onClick={onClose}
						aria-label="Close dialog"
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
							className="form-field__input"
							value={repoUrl}
							onChange={(e) => setRepoUrl(e.target.value)}
							placeholder="https://github.com/org/repo.git"
							autoComplete="off"
							spellCheck={false}
						/>
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
						<p className="form-field__hint form-field__hint--info">
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

					{/* ── Footer ──────────────────────────────────────────────── */}
					<footer className="modal__footer">
						<button type="button" className="btn btn--ghost" onClick={onClose}>
							Cancel
						</button>
						<button
							type="submit"
							className="btn btn--primary"
							disabled={!canClone}
						>
							Clone
						</button>
					</footer>
				</form>
			</div>
		</div>
	);
}
