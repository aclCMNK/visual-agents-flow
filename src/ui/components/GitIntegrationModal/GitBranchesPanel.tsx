import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type { GitBranch, GitCommit } from "../../../electron/bridge.types.ts";
import { useGitBranches } from "../../hooks/useGitBranches.ts";
import { useProjectStore } from "../../store/projectStore.ts";
import type { UiGitError } from "../../utils/gitErrorUtils.ts";

interface RemoteChangesSectionProps {
	incomingCommits: GitCommit[];
	aheadCount: number;
	behindCount: number;
	noUpstream: boolean;
	isLoadingRemoteDiff: boolean;
	isFetchingAndPulling: boolean;
	error: UiGitError | null;
	successMessage: string | null;
	onFetchAndPull: () => void;
	onRefresh: () => void;
}

interface BranchSelectorSectionProps {
	currentBranch: string;
	selectableBranches: GitBranch[];
	protectedBranch: string | null;
	selectedBranch: string;
	isLoadingBranches: boolean;
	isPullingBranch: boolean;
	isCheckingOut: boolean;
	pullError: UiGitError | null;
	checkoutError: UiGitError | null;
	checkoutSuccess: string | null;
	onSelectBranch: (branch: string) => void;
	onPullBranch: () => void;
	onCheckoutBranch: () => void;
}

interface BranchCommitsSectionProps {
	selectedBranch: string;
	commits: GitCommit[];
	isLoading: boolean;
	error: UiGitError | null;
}

interface BranchCreatorSectionProps {
	currentBranch: string;
	protectedBranch: string | null;
	allLocalBranches: GitBranch[];
	isCreatingBranch: boolean;
	createBranchError: UiGitError | null;
	lastCreateBranchSuccess: string | null;
	onCreateBranch: (newName: string, sourceBranch: string) => void;
	onClearCreateBranchError: () => void;
}

function validateBranchName(
	name: string,
	existingNames: string[],
	protectedBranch: string | null,
): string | null {
	if (name.length === 0) return null;
	if (/\s/.test(name)) return "Branch name cannot contain spaces.";
	if (!/^[a-zA-Z0-9\-]+$/.test(name)) {
		return "Only letters, numbers and hyphens are allowed.";
	}
	if (name.startsWith("-")) return "Branch name cannot start with a hyphen.";
	if (name.endsWith("-")) return "Branch name cannot end with a hyphen.";
	if (/--/.test(name)) {
		return "Branch name cannot contain consecutive hyphens.";
	}
	if (protectedBranch && name === protectedBranch) {
		return `Cannot use '${protectedBranch}' as branch name.`;
	}
	if (existingNames.includes(name)) {
		return "A branch with this name already exists.";
	}
	return null;
}

function RemoteChangesSection(props: RemoteChangesSectionProps) {
	const canFetchPull =
		!props.isFetchingAndPulling &&
		!props.isLoadingRemoteDiff &&
		!props.noUpstream;

	return (
		<section
			className="git-branches__section"
			aria-labelledby="git-branches-remote-title"
		>
			<header className="git-branches__section-header">
				<h3
					id="git-branches-remote-title"
					className="git-branches__section-title"
				>
					Remote Changes
				</h3>
				<button
					type="button"
					className="btn btn--ghost"
					onClick={props.onRefresh}
					disabled={props.isLoadingRemoteDiff || props.isFetchingAndPulling}
					aria-label="Refresh remote changes"
				>
					↻ Refresh
				</button>
			</header>

			{props.error && (
				<div
					className="git-branches__error-banner git-branches__error-banner--multiline"
					role="alert"
					title={props.error.fullMessage}
				>
					{props.error.displayMessage}
				</div>
			)}
			{props.successMessage && (
				<div className="git-branches__success-banner" role="status">
					{props.successMessage}
				</div>
			)}

			{props.isLoadingRemoteDiff ? (
				<div className="git-branches__spinner" role="status" aria-live="polite">
					Loading remote changes…
				</div>
			) : props.noUpstream ? (
				<div className="git-branches__empty-state">
					No remote tracking branch configured.
				</div>
			) : (
				<>
					<div
						className={`git-branches__remote-status${props.behindCount > 0 ? " git-branches__remote-status--behind" : " git-branches__remote-status--uptodate"}`}
						aria-live="polite"
					>
						↓ {props.behindCount} commits behind · ↑ {props.aheadCount} commits
						ahead
					</div>

					{props.incomingCommits.length === 0 ? (
						<div className="git-branches__empty-state">
							✓ Up to date with remote.
						</div>
					) : (
						<div className="git-branches__commit-list">
							{props.incomingCommits.map((commit) => (
								<div
									key={commit.fullHash}
									className="git-branches__commit-item"
								>
									<span className="git-branches__commit-hash">
										{commit.hash}
									</span>
									<span
										className="git-branches__commit-message"
										title={commit.message}
									>
										{commit.message}
									</span>
									<span className="git-branches__commit-author">
										{commit.author}
									</span>
									<span className="git-branches__commit-date">
										{commit.relativeDate}
									</span>
								</div>
							))}
						</div>
					)}

					<div>
						<button
							type="button"
							className="btn btn--secondary"
							disabled={!canFetchPull}
							onClick={props.onFetchAndPull}
						>
							{props.isFetchingAndPulling ? "Loading…" : "⬇ Fetch & Pull"}
						</button>
					</div>
				</>
			)}
		</section>
	);
}

function BranchSelectorSection(props: BranchSelectorSectionProps) {
	const isCurrentSelected = props.selectedBranch === props.currentBranch;
	const isProtectedSelected =
		Boolean(props.protectedBranch) && props.selectedBranch === props.protectedBranch;
	const hasBranches = props.selectableBranches.length > 0;

	return (
		<section
			className="git-branches__section"
			aria-labelledby="git-branches-branch-title"
		>
			<header className="git-branches__section-header">
				<h3
					id="git-branches-branch-title"
					className="git-branches__section-title"
				>
					Branch
				</h3>
			</header>

			<p className="git-branches__current-label">
				Current:{" "}
				<span className="git-branches__current-name">
					{props.currentBranch || "(none)"}
				</span>
			</p>

			{props.isLoadingBranches ? (
				<div className="git-branches__spinner" role="status" aria-live="polite">
					Loading branches…
				</div>
			) : !hasBranches ? (
				<div className="git-branches__empty-state">
					No branches available.
				</div>
			) : (
				<div className="git-branches__selector-row">
					<select
						id="git-branches-select"
						className="git-branches__select"
						aria-label="Select branch"
						value={props.selectedBranch}
						onChange={(e) => props.onSelectBranch(e.target.value)}
						disabled={props.isCheckingOut || props.isPullingBranch}
					>
						{props.selectableBranches.map((branch) => (
							<option key={branch.name} value={branch.name}>
								{branch.name === props.protectedBranch
									? `🔒 ${branch.name} (protected)`
									: branch.name.startsWith("local-changes-")
										? `${branch.name} (saved)`
										: branch.name}
							</option>
						))}
					</select>

					<button
						type="button"
						className="btn btn--secondary"
						disabled={
							props.isPullingBranch ||
							!props.selectedBranch ||
							props.isCheckingOut
						}
						onClick={props.onPullBranch}
					>
						{props.isPullingBranch ? "Loading…" : "⬇ Pull"}
					</button>

					<button
						type="button"
						className="btn btn--secondary"
						disabled={
							props.isCheckingOut ||
							!props.selectedBranch ||
							props.isPullingBranch ||
							isCurrentSelected ||
							isProtectedSelected
						}
						title={
							isProtectedSelected
								? "Cannot checkout the protected branch directly"
								: undefined
						}
						onClick={props.onCheckoutBranch}
					>
						{isCurrentSelected
							? "✓ Current"
							: props.isCheckingOut
								? "Loading…"
								: "⎇ Checkout"}
					</button>
				</div>
			)}

			{props.pullError && (
				<div
					className="git-branches__error-banner git-branches__error-banner--multiline"
					role="alert"
					title={props.pullError.fullMessage}
				>
					{props.pullError.displayMessage}
				</div>
			)}
			{props.checkoutError && (
				<div
					className="git-branches__error-banner git-branches__error-banner--multiline"
					role="alert"
					title={props.checkoutError.fullMessage}
				>
					{props.checkoutError.displayMessage}
				</div>
			)}
			{props.checkoutSuccess && (
				<div className="git-branches__success-banner" role="status">
					Switched to branch '{props.checkoutSuccess}'
				</div>
			)}
		</section>
	);
}

function BranchCommitsSection(props: BranchCommitsSectionProps) {
	return (
		<section
			className="git-branches__section git-branches__commits-section"
			aria-labelledby="git-branches-commits-title"
		>
			<header className="git-branches__section-header">
				<h3
					id="git-branches-commits-title"
					className="git-branches__section-title"
				>
					Commits in &quot;{props.selectedBranch || "-"}&quot;
				</h3>
			</header>

			{!props.selectedBranch ? (
				<div className="git-branches__empty-state">
					Select a branch to see its commits.
				</div>
			) : props.isLoading ? (
				<div className="git-branches__spinner" role="status" aria-live="polite">
					Loading commits…
				</div>
			) : props.error ? (
				<div
					className="git-branches__error-banner git-branches__error-banner--multiline"
					role="alert"
					title={props.error.fullMessage}
				>
					{props.error.displayMessage}
				</div>
			) : props.commits.length === 0 ? (
				<div className="git-branches__empty-state">
					No commits found in this branch.
				</div>
			) : (
				<div className="git-branches__commits-list">
					{props.commits.map((commit) => (
						<div key={commit.fullHash} className="git-branches__commit-item">
							<span className="git-branches__commit-hash">{commit.hash}</span>
							<span
								className="git-branches__commit-message"
								title={commit.message}
							>
								{commit.message}
							</span>
							<span className="git-branches__commit-author">
								{commit.author}
							</span>
							<span className="git-branches__commit-date">
								{commit.relativeDate}
							</span>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

function BranchCreatorSection(props: BranchCreatorSectionProps) {
	const [newBranchName, setNewBranchName] = useState<string>("");
	const [sourceBranch, setSourceBranch] = useState<string>("");
	const [validationError, setValidationError] = useState<string | null>(null);
	const orderedLocalBranches = useMemo(() => {
		const current = props.allLocalBranches.find(
			(branch) => branch.name === props.currentBranch,
		);
		const rest = props.allLocalBranches
			.filter((branch) => branch.name !== props.currentBranch)
			.sort((a, b) => a.name.localeCompare(b.name));
		return current ? [current, ...rest] : rest;
	}, [props.allLocalBranches, props.currentBranch]);
	const hasLocalBranches = orderedLocalBranches.length > 0;
	const hasRealBranches = hasLocalBranches || Boolean(props.protectedBranch);

	const isFormValid =
		hasLocalBranches &&
		sourceBranch.length > 0 &&
		newBranchName.length > 0 &&
		validationError === null;

	useEffect(() => {
		if (orderedLocalBranches.length === 0) {
			setSourceBranch("");
			return;
		}

		if (
			props.protectedBranch &&
			orderedLocalBranches.some(
				(branch) => branch.name === props.protectedBranch,
			) &&
			sourceBranch !== props.protectedBranch
		) {
			setSourceBranch(props.protectedBranch);
			return;
		}

		if (
			sourceBranch &&
			orderedLocalBranches.some((branch) => branch.name === sourceBranch)
		) {
			return;
		}

		setSourceBranch(orderedLocalBranches[0]?.name ?? "");
	}, [orderedLocalBranches, sourceBranch, props.protectedBranch]);

	useEffect(() => {
		if (props.lastCreateBranchSuccess) {
			setNewBranchName("");
			setValidationError(null);
		}
	}, [props.lastCreateBranchSuccess]);

	const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setNewBranchName(value);
		setValidationError(
			validateBranchName(
				value,
				props.allLocalBranches.map((branch) => branch.name),
				props.protectedBranch,
			),
		);
		if (props.createBranchError) {
			props.onClearCreateBranchError();
		}
	};

	const handleCreate = () => {
		if (!isFormValid || props.isCreatingBranch) return;
		props.onCreateBranch(newBranchName, sourceBranch);
	};

	return (
		<section
			className="git-branches__section"
			aria-labelledby="git-branches-creator-title"
		>
			<header className="git-branches__section-header">
				<h3 id="git-branches-creator-title" className="git-branches__section-title">
					Create Branch
				</h3>
			</header>

			<div className="git-branches__creator-row">
				<label
					htmlFor="git-branches-source-select"
					className="git-branches__creator-label"
				>
					From:
				</label>
				<select
					id="git-branches-source-select"
					className="git-branches__select"
					value={sourceBranch}
					onChange={(e) => setSourceBranch(e.target.value)}
					disabled={props.isCreatingBranch || !hasLocalBranches}
					aria-label="Source branch"
				>
					{hasLocalBranches ? (
						orderedLocalBranches.map((branch) => (
							<option key={branch.name} value={branch.name}>
								{branch.name}
								{branch.name === props.currentBranch ? " (current)" : ""}
								{branch.name === props.protectedBranch
									? " 🔒 protected"
									: ""}
							</option>
						))
					) : (
						<option value="" disabled>
							No branches available
						</option>
					)}
				</select>
			</div>

			{!hasRealBranches && (
				<div className="git-branches__error-banner" role="alert">
					No branches found in this repository.
				</div>
			)}

			<div className="git-branches__creator-row">
				<label
					htmlFor="git-branches-new-name"
					className="git-branches__creator-label"
				>
					New branch:
				</label>
				<input
					id="git-branches-new-name"
					type="text"
					className={`git-branches__input${validationError ? " git-branches__input--error" : ""}`}
					value={newBranchName}
					onChange={handleNameChange}
					placeholder="feature/my-branch"
					disabled={props.isCreatingBranch}
					aria-describedby={validationError ? "git-branches-name-error" : undefined}
					aria-invalid={validationError ? "true" : "false"}
					autoComplete="off"
					spellCheck={false}
					onKeyDown={(e) => {
						if (e.key === "Enter" && isFormValid) {
							handleCreate();
						}
					}}
				/>
			</div>

			{validationError && (
				<p
					id="git-branches-name-error"
					className="git-branches__validation-error"
					role="alert"
					aria-live="assertive"
				>
					{validationError}
				</p>
			)}

			<div className="git-branches__creator-actions">
				<button
					type="button"
					className="btn btn--primary"
					disabled={!isFormValid || props.isCreatingBranch || !hasLocalBranches}
					onClick={handleCreate}
					aria-busy={props.isCreatingBranch}
				>
					{props.isCreatingBranch ? "Creating…" : "⎇ Create & Checkout"}
				</button>
			</div>

			{props.createBranchError && (
				<div
					className="git-branches__error-banner git-branches__error-banner--multiline"
					role="alert"
					title={props.createBranchError.fullMessage}
				>
					{props.createBranchError.displayMessage}
				</div>
			)}

			{props.lastCreateBranchSuccess && (
				<div className="git-branches__success-banner" role="status">
					✓ Branch '{props.lastCreateBranchSuccess}' created and checked out.
				</div>
			)}
		</section>
	);
}

export interface GitBranchesPanelProps {
	protectedBranch: string | null;
}

export function GitBranchesPanel({ protectedBranch }: GitBranchesPanelProps) {
	const projectDir = useProjectStore((s) => s.project?.projectDir ?? null);
	const {
		state,
		loadRemoteDiff,
		fetchAndPull,
		pullBranch,
		checkoutBranch,
		createBranch,
		selectBranch,
		clearErrors,
		clearCreateBranchFeedback,
	} = useGitBranches(projectDir, protectedBranch);

	const localBranches = useMemo(() => {
		return state.branches.filter((b) => !b.isRemote);
	}, [state.branches]);

	const selectableBranches = localBranches;

	const effectiveSelectedBranch = useMemo(() => {
		if (selectableBranches.some((b) => b.name === state.selectedBranch)) {
			return state.selectedBranch;
		}
		return selectableBranches[0]?.name ?? "";
	}, [state.selectedBranch, selectableBranches]);

	useEffect(() => {
		if (!effectiveSelectedBranch) return;
		if (state.selectedBranch === effectiveSelectedBranch) return;
		selectBranch(effectiveSelectedBranch);
	}, [effectiveSelectedBranch, state.selectedBranch, selectBranch]);

	useEffect(() => {
		if (
			!state.lastFetchPullSuccess &&
			!state.lastCheckoutSuccess &&
			!state.lastCreateBranchSuccess
		)
			return;
		const timeoutId = window.setTimeout(() => {
			clearErrors();
		}, 3000);
		return () => window.clearTimeout(timeoutId);
	}, [
		state.lastFetchPullSuccess,
		state.lastCheckoutSuccess,
		state.lastCreateBranchSuccess,
		clearErrors,
	]);

	if (!projectDir) {
		return <div className="git-branches__no-project">No project open.</div>;
	}

	return (
		<div className="git-branches">
			<RemoteChangesSection
				incomingCommits={state.incomingCommits}
				aheadCount={state.aheadCount}
				behindCount={state.behindCount}
				noUpstream={state.noUpstream}
				isLoadingRemoteDiff={state.isLoadingRemoteDiff}
				isFetchingAndPulling={state.isFetchingAndPulling}
				error={state.remoteDiffError ?? state.fetchPullError}
				successMessage={state.lastFetchPullSuccess}
				onFetchAndPull={() => {
					void fetchAndPull();
				}}
				onRefresh={() => {
					void loadRemoteDiff();
				}}
			/>

			<div className="git-branches__divider" />

			<BranchSelectorSection
				currentBranch={state.currentBranch}
				selectableBranches={selectableBranches}
				protectedBranch={protectedBranch}
				selectedBranch={effectiveSelectedBranch}
				isLoadingBranches={state.isLoadingBranches}
				isPullingBranch={state.isPullingBranch}
				isCheckingOut={state.isCheckingOut}
				pullError={state.pullBranchError}
				checkoutError={state.checkoutError}
				checkoutSuccess={state.lastCheckoutSuccess}
				onSelectBranch={selectBranch}
				onPullBranch={() => {
					if (!effectiveSelectedBranch) return;
					void pullBranch(effectiveSelectedBranch);
				}}
				onCheckoutBranch={() => {
					if (!effectiveSelectedBranch) return;
					void checkoutBranch(effectiveSelectedBranch);
				}}
			/>

			<div className="git-branches__divider" />

			<BranchCreatorSection
				currentBranch={state.currentBranch}
				protectedBranch={protectedBranch}
				allLocalBranches={localBranches}
				isCreatingBranch={state.isCreatingBranch}
				createBranchError={state.createBranchError}
				lastCreateBranchSuccess={state.lastCreateBranchSuccess}
				onCreateBranch={(name, source) => {
					void createBranch(name, source);
				}}
				onClearCreateBranchError={clearCreateBranchFeedback}
			/>

			<div className="git-branches__divider" />

			<BranchCommitsSection
				selectedBranch={effectiveSelectedBranch}
				commits={state.branchCommits}
				isLoading={state.isLoadingCommits}
				error={state.commitsError}
			/>

			{state.branchesError && (
				<div
					className="git-branches__error-banner git-branches__error-banner--multiline"
					role="alert"
					title={state.branchesError.fullMessage}
				>
					{state.branchesError.displayMessage}
				</div>
			)}
		</div>
	);
}
