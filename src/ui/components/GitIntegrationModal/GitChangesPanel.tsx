import { useEffect, useMemo } from "react";
import type { GitChangedFile } from "../../../electron/bridge.types.ts";
import { useGitChanges } from "../../hooks/useGitChanges.ts";
import { useProjectStore } from "../../store/projectStore.ts";
import type { UiGitError } from "../../utils/gitErrorUtils.ts";

interface CurrentBranchSectionProps {
	currentBranch: string;
	isLoading: boolean;
}

interface CommitFormSectionProps {
	commitMessage: string;
	commitDescription: string;
	isCommitting: boolean;
	onMessageChange: (msg: string) => void;
	onDescriptionChange: (desc: string) => void;
}

interface ChangedFilesSectionProps {
	files: GitChangedFile[];
	stagedCount: number;
	unstagedCount: number;
	isLoading: boolean;
	error: UiGitError | null;
	onRefresh: () => void;
}

interface GitFileRowProps {
	file: GitChangedFile;
}

interface CommitActionSectionProps {
	commitMessage: string;
	hasChanges: boolean;
	isCommitting: boolean;
	commitError: UiGitError | null;
	lastCommitSuccess: string | null;
	onAddAndCommit: () => void;
}

function getStatusLabel(file: GitChangedFile): string {
	if (file.isUntracked) return "Untracked";
	const staged = file.stagedStatus;
	const unstaged = file.unstagedStatus;
	if (staged === "A") return "Added";
	if (staged === "M" || unstaged === "M") return "Modified";
	if (staged === "D" || unstaged === "D") return "Deleted";
	if (staged === "R") return "Renamed";
	if (staged === "C") return "Copied";
	if (staged === "U" || unstaged === "U") return "Unmerged";
	return "Changed";
}

function getStatusIcon(file: GitChangedFile): string {
	if (file.isUntracked) return "?";
	const staged = file.stagedStatus;
	const unstaged = file.unstagedStatus;
	if (staged === "A") return "+";
	if (staged === "D" || unstaged === "D") return "−";
	if (staged === "R") return "→";
	if (staged === "U" || unstaged === "U") return "!";
	return "~";
}

function getStatusClass(
	file: GitChangedFile,
): "added" | "modified" | "deleted" | "renamed" | "untracked" | "unmerged" {
	if (file.isUntracked) return "untracked";
	if (file.stagedStatus === "A") return "added";
	if (file.stagedStatus === "D" || file.unstagedStatus === "D") return "deleted";
	if (file.stagedStatus === "R") return "renamed";
	if (file.stagedStatus === "U" || file.unstagedStatus === "U") return "unmerged";
	return "modified";
}

function CurrentBranchSection({ currentBranch, isLoading }: CurrentBranchSectionProps) {
	return (
		<section className="git-changes__section" aria-labelledby="git-changes-branch-title">
			<header className="git-changes__section-header">
				<h3 id="git-changes-branch-title" className="git-changes__section-title">
					Current Branch
				</h3>
			</header>
			{isLoading ? (
				<div className="git-changes__spinner" role="status" aria-live="polite">
					Loading…
				</div>
			) : (
				<p className="git-changes__current-branch">
					<span className="git-changes__branch-icon" aria-hidden="true">
						⎇
					</span>
					<span className="git-changes__branch-name">
						{currentBranch || "(detached HEAD)"}
					</span>
				</p>
			)}
		</section>
	);
}

function CommitFormSection(props: CommitFormSectionProps) {
	const messageError =
		props.commitMessage.trim().length === 0 && props.commitMessage.length > 0
			? "Commit message cannot be only whitespace."
			: null;

	const messageHint =
		props.commitMessage.length > 72
			? "Commit message should be 72 characters or less."
			: `${props.commitMessage.length}/72 characters recommended`;

	return (
		<section className="git-changes__section" aria-labelledby="git-changes-commit-title">
			<header className="git-changes__section-header">
				<h3 id="git-changes-commit-title" className="git-changes__section-title">
					Commit
				</h3>
			</header>

			<div className="git-changes__field">
				<label htmlFor="git-changes-commit-msg" className="git-changes__label">
					Message <span className="git-changes__required" aria-hidden="true">*</span>
				</label>
				<input
					id="git-changes-commit-msg"
					type="text"
					className={`git-changes__input${messageError ? " git-changes__input--error" : ""}`}
					value={props.commitMessage}
					onChange={(e) => props.onMessageChange(e.target.value)}
					placeholder="Short summary of changes"
					disabled={props.isCommitting}
					maxLength={200}
					aria-required="true"
					aria-describedby={messageError ? "git-changes-msg-error" : "git-changes-msg-hint"}
					aria-invalid={messageError ? "true" : "false"}
					autoComplete="off"
					spellCheck={true}
				/>
				{messageError ? (
					<p
						id="git-changes-msg-error"
						className="git-changes__validation-error"
						role="alert"
						aria-live="assertive"
					>
						{messageError}
					</p>
				) : (
					<p id="git-changes-msg-hint" className="git-changes__hint">
						{messageHint}
					</p>
				)}
			</div>

			<div className="git-changes__field">
				<label htmlFor="git-changes-commit-desc" className="git-changes__label">
					Description <span className="git-changes__optional">(optional)</span>
				</label>
				<textarea
					id="git-changes-commit-desc"
					className="git-changes__textarea"
					value={props.commitDescription}
					onChange={(e) => props.onDescriptionChange(e.target.value)}
					placeholder="Extended description of the changes (optional)"
					disabled={props.isCommitting}
					rows={3}
					aria-required="false"
					spellCheck={true}
				/>
			</div>
		</section>
	);
}

function GitFileRow({ file }: GitFileRowProps) {
	const statusLabel = getStatusLabel(file);
	const statusClass = getStatusClass(file);

	return (
		<div
			className={`git-changes__file-row git-changes__file-row--${statusClass}`}
			role="listitem"
			title={file.originalPath ? `Renamed from: ${file.originalPath}` : file.path}
		>
			<span
				className={`git-changes__file-status git-changes__file-status--${statusClass}`}
				aria-label={statusLabel}
				title={statusLabel}
			>
				{getStatusIcon(file)}
			</span>
			<span className="git-changes__file-path" title={file.path}>
				{file.path}
				{file.originalPath && (
					<span className="git-changes__file-original" aria-label={`renamed from ${file.originalPath}`}>
						← {file.originalPath}
					</span>
				)}
			</span>
			<span className="git-changes__file-badges">
				{file.isStaged && (
					<span className="git-changes__badge git-changes__badge--staged" title="Staged">
						S
					</span>
				)}
				{file.isUnstaged && (
					<span className="git-changes__badge git-changes__badge--unstaged" title="Unstaged">
						U
					</span>
				)}
				{file.isUntracked && (
					<span className="git-changes__badge git-changes__badge--untracked" title="Untracked">
						?
					</span>
				)}
			</span>
		</div>
	);
}

function ChangedFilesSection(props: ChangedFilesSectionProps) {
	const sortedFiles = useMemo(() => {
		return [...props.files].sort((a, b) => {
			const aGroup = a.isStaged ? 0 : 1;
			const bGroup = b.isStaged ? 0 : 1;
			if (aGroup !== bGroup) return aGroup - bGroup;
			return a.path.localeCompare(b.path);
		});
	}, [props.files]);

	const displayCount = props.files.length > 50 ? "50+" : String(props.files.length);

	return (
		<section className="git-changes__section" aria-labelledby="git-changes-files-title">
			<header className="git-changes__section-header">
				<h3 id="git-changes-files-title" className="git-changes__section-title">
					Changes
					{props.files.length > 0 && (
						<span className="git-changes__count-badge" aria-label={`${props.files.length} files changed`}>
							{displayCount}
						</span>
					)}
				</h3>
				<button
					type="button"
					className="btn btn--ghost"
					onClick={props.onRefresh}
					disabled={props.isLoading}
					aria-label="Refresh file status"
				>
					<span aria-hidden="true">↻</span> Refresh
				</button>
			</header>

			<p className="git-changes__hint" aria-live="polite">
				Staged: {props.stagedCount} · Unstaged: {props.unstagedCount}
			</p>

			{props.error && (
				<div
					className="git-branches__error-banner git-branches__error-banner--multiline"
					role="alert"
					title={props.error.fullMessage}
				>
					{props.error.displayMessage}
				</div>
			)}

			{props.isLoading ? (
				<div className="git-changes__spinner" role="status" aria-live="polite">
					Loading changes…
				</div>
			) : props.files.length === 0 ? (
				<div className="git-branches__empty-state">✓ No changes detected. Working tree is clean.</div>
			) : (
				<div className="git-changes__file-list" role="list" aria-label="Changed files" tabIndex={0}>
					{sortedFiles.map((file) => (
						<GitFileRow key={`${file.path}-${file.originalPath ?? ""}`} file={file} />
					))}
				</div>
			)}
		</section>
	);
}

function CommitActionSection(props: CommitActionSectionProps) {
	const canCommit = props.commitMessage.trim().length > 0 && props.hasChanges && !props.isCommitting;

	return (
		<section
			className="git-changes__section git-changes__action-section"
			aria-labelledby="git-changes-action-title"
		>
			<header className="git-changes__section-header">
				<h3 id="git-changes-action-title" className="git-changes__section-title">
					Stage &amp; Commit
				</h3>
			</header>

			{props.commitError && (
				<div
					className="git-branches__error-banner git-branches__error-banner--multiline"
					role="alert"
					title={props.commitError.fullMessage}
				>
					{props.commitError.displayMessage}
				</div>
			)}

			{props.lastCommitSuccess && (
				<div className="git-branches__success-banner" role="status">
					✓ Committed successfully — {props.lastCommitSuccess}
				</div>
			)}

			<div className="git-changes__action-row">
				<button
					type="button"
					className="btn btn--primary"
					disabled={!canCommit}
					onClick={props.onAddAndCommit}
					aria-busy={props.isCommitting}
					aria-describedby={!canCommit ? "git-changes-commit-hint" : undefined}
					title="Stages all pending changes and creates one commit"
				>
					{props.isCommitting ? (
						"Committing…"
					) : (
						<>
							<span aria-hidden="true">✔</span> Add and Commit
						</>
					)}
				</button>
			</div>

			{!props.hasChanges && !props.isCommitting && (
				<p id="git-changes-commit-hint" className="git-changes__hint" role="status">
					No changes to commit.
				</p>
			)}
			{props.hasChanges && props.commitMessage.trim().length === 0 && !props.isCommitting && (
				<p id="git-changes-commit-hint" className="git-changes__hint">
					Enter a commit message to continue.
				</p>
			)}
		</section>
	);
}

export function GitChangesPanel() {
	const projectDir = useProjectStore((s) => s.project?.projectDir ?? null);
	const {
		state,
		loadStatus,
		setCommitMessage,
		setCommitDescription,
		addAndCommit,
		clearFeedback,
	} = useGitChanges(projectDir);

	useEffect(() => {
		if (!state.lastCommitSuccess) return;
		const id = window.setTimeout(clearFeedback, 3000);
		return () => window.clearTimeout(id);
	}, [state.lastCommitSuccess, clearFeedback]);

	if (!projectDir) {
		return <div className="git-changes__no-project">No project open.</div>;
	}

	return (
		<div className="git-changes">
			<CurrentBranchSection
				currentBranch={state.currentBranch}
				isLoading={state.isLoadingStatus}
			/>

			<div className="git-branches__divider" />

			<CommitFormSection
				commitMessage={state.commitMessage}
				commitDescription={state.commitDescription}
				isCommitting={state.isCommitting}
				onMessageChange={setCommitMessage}
				onDescriptionChange={setCommitDescription}
			/>

			<div className="git-branches__divider" />

			<ChangedFilesSection
				files={state.files}
				stagedCount={state.stagedCount}
				unstagedCount={state.unstagedCount}
				isLoading={state.isLoadingStatus || state.isCommitting}
				error={state.statusError}
				onRefresh={() => {
					void loadStatus();
				}}
			/>

			<div className="git-branches__divider" />

			<CommitActionSection
				commitMessage={state.commitMessage}
				hasChanges={state.files.length > 0}
				isCommitting={state.isCommitting}
				commitError={state.commitError}
				lastCommitSuccess={state.lastCommitSuccess}
				onAddAndCommit={() => {
					void addAndCommit();
				}}
			/>
		</div>
	);
}
