import { useEffect } from "react";
import type { GitBranch, GitCommit } from "../../../electron/bridge.types.ts";
import { useGitBranches } from "../../hooks/useGitBranches.ts";
import { useProjectStore } from "../../store/projectStore.ts";

interface RemoteChangesSectionProps {
	incomingCommits: GitCommit[];
	aheadCount: number;
	behindCount: number;
	noUpstream: boolean;
	isLoadingRemoteDiff: boolean;
	isFetchingAndPulling: boolean;
	error: string | null;
	successMessage: string | null;
	onFetchAndPull: () => void;
	onRefresh: () => void;
}

interface BranchSelectorSectionProps {
	currentBranch: string;
	selectableBranches: GitBranch[];
	selectedBranch: string;
	isLoadingBranches: boolean;
	isPullingBranch: boolean;
	isCheckingOut: boolean;
	pullError: string | null;
	checkoutError: string | null;
	checkoutSuccess: string | null;
	onSelectBranch: (branch: string) => void;
	onPullBranch: () => void;
	onCheckoutBranch: () => void;
}

interface BranchCommitsSectionProps {
	selectedBranch: string;
	commits: GitCommit[];
	isLoading: boolean;
	error: string | null;
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
				<div className="git-branches__error-banner" role="alert">
					{props.error}
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
					No other branches available. (main/master excluded)
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
								{branch.name}
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
							isCurrentSelected
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
				<div className="git-branches__error-banner" role="alert">
					{props.pullError}
				</div>
			)}
			{props.checkoutError && (
				<div className="git-branches__error-banner" role="alert">
					{props.checkoutError}
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
				<div className="git-branches__error-banner" role="alert">
					{props.error}
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

export function GitBranchesPanel() {
	const projectDir = useProjectStore((s) => s.project?.projectDir ?? null);
	const {
		state,
		loadRemoteDiff,
		fetchAndPull,
		pullBranch,
		checkoutBranch,
		selectBranch,
		clearErrors,
	} = useGitBranches(projectDir);

	useEffect(() => {
		if (!state.lastFetchPullSuccess && !state.lastCheckoutSuccess) return;
		const timeoutId = window.setTimeout(() => {
			clearErrors();
		}, 3000);
		return () => window.clearTimeout(timeoutId);
	}, [state.lastFetchPullSuccess, state.lastCheckoutSuccess, clearErrors]);

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
				selectableBranches={state.selectableBranches}
				selectedBranch={state.selectedBranch}
				isLoadingBranches={state.isLoadingBranches}
				isPullingBranch={state.isPullingBranch}
				isCheckingOut={state.isCheckingOut}
				pullError={state.pullBranchError}
				checkoutError={state.checkoutError}
				checkoutSuccess={state.lastCheckoutSuccess}
				onSelectBranch={selectBranch}
				onPullBranch={() => {
					if (!state.selectedBranch) return;
					void pullBranch(state.selectedBranch);
				}}
				onCheckoutBranch={() => {
					if (!state.selectedBranch) return;
					void checkoutBranch(state.selectedBranch);
				}}
			/>

			<div className="git-branches__note" aria-live="polite">
				main/master excluded from selector.
			</div>

			<div className="git-branches__divider" />

			<BranchCommitsSection
				selectedBranch={state.selectedBranch}
				commits={state.branchCommits}
				isLoading={state.isLoadingCommits}
				error={state.commitsError}
			/>

			{state.branchesError && (
				<div className="git-branches__error-banner">{state.branchesError}</div>
			)}
		</div>
	);
}
