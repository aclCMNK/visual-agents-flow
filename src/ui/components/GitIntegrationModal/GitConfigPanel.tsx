import { useEffect, useMemo, useState } from "react";
import type { UseGitConfigResult } from "../../hooks/useGitConfig.ts";
import { RemoteConnectForm } from "./RemoteConnectForm.tsx";
import { RepoVisibilityBadge } from "../RepoVisibilityBadge.tsx";

function NoGitSection(props: {
	isInitializing: boolean;
	initError: string | null;
	onConnectToGit: () => void;
}) {
	return (
		<section className="git-config__section" aria-labelledby="git-config-repo-title">
			<header className="git-config__section-header">
				<h3 id="git-config-repo-title" className="git-config__section-title">
					Repository
				</h3>
			</header>

			<p className="git-config__no-git-description">
				No Git repository detected in this directory.
			</p>

			<button
				type="button"
				className="btn btn--primary"
				onClick={props.onConnectToGit}
				disabled={props.isInitializing}
				aria-busy={props.isInitializing ? "true" : "false"}
			>
				{props.isInitializing ? "Initializing…" : "Connect to Git"}
			</button>

			{props.initError && (
				<div className="git-branches__error-banner" role="alert">
					{props.initError}
				</div>
			)}
		</section>
	);
}

interface MainBranchInputSectionProps {
	isDetecting: boolean;
	onConfirm: (branch: string) => void;
}

function MainBranchInputSection(props: MainBranchInputSectionProps) {
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);

	const validate = (v: string): string | null => {
		if (!v.trim()) return "Branch name is required.";
		if (/\s/.test(v)) return "Branch name cannot contain spaces.";
		return null;
	};

	const handleConfirm = () => {
		const err = validate(value);
		if (err) {
			setError(err);
			return;
		}
		props.onConfirm(value.trim());
	};

	return (
		<section
			className="git-config__section"
			aria-labelledby="git-config-main-branch-title"
		>
			<header className="git-config__section-header">
				<h3 id="git-config-main-branch-title" className="git-config__section-title">
					Main Branch
				</h3>
			</header>

			<p className="git-config__hint">
				Could not detect the main branch automatically. Enter its name to protect it.
			</p>

			<div className="git-config__field">
				<label htmlFor="git-config-main-branch-input" className="git-config__label">
					Branch name <span aria-hidden="true">*</span>
				</label>
				<input
					id="git-config-main-branch-input"
					type="text"
					className={`git-config__input${error ? " git-config__input--error" : ""}`}
					value={value}
					onChange={(e) => {
						setValue(e.target.value);
						setError(null);
					}}
					placeholder="e.g. main, master, trunk"
					disabled={props.isDetecting}
					aria-required="true"
					aria-invalid={error ? "true" : "false"}
					aria-describedby={error ? "git-config-main-branch-error" : undefined}
					autoComplete="off"
					spellCheck={false}
					onKeyDown={(e) => {
						if (e.key === "Enter") handleConfirm();
					}}
				/>
				{error && (
					<p
						id="git-config-main-branch-error"
						className="git-config__validation-error"
						role="alert"
						aria-live="assertive"
					>
						{error}
					</p>
				)}
			</div>

			<button
				type="button"
				className="btn btn--primary"
				onClick={handleConfirm}
				disabled={!value.trim() || props.isDetecting}
			>
				Confirm & Checkout
			</button>
		</section>
	);
}

export interface GitConfigPanelProps {
	projectDir: string | null;
	gitConfig: UseGitConfigResult;
}

export function GitConfigPanel({ projectDir, gitConfig }: GitConfigPanelProps) {
	const {
		state,
		connectToGit,
		connect,
		checkVisibility,
		setProtectedBranch,
		dismissDivergence,
	} = gitConfig;
	const [isEditingRemote, setIsEditingRemote] = useState(false);
	const [urlInputValue, setUrlInputValue] = useState("");

	useEffect(() => {
		if (!projectDir) return;
		if (!state.remoteUrl) return;
		void checkVisibility(state.remoteUrl);
	}, [projectDir, state.remoteUrl, checkVisibility]);

	useEffect(() => {
		if (!state.remoteUrl) return;
		setUrlInputValue(state.remoteUrl);
	}, [state.remoteUrl]);

	useEffect(() => {
		if (!isEditingRemote) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setIsEditingRemote(false);
				setUrlInputValue(state.remoteUrl ?? "");
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [isEditingRemote, state.remoteUrl]);

	useEffect(() => {
		if (!state.connectSuccess) return;
		setIsEditingRemote(false);
	}, [state.connectSuccess]);

	useEffect(() => {
		const trimmed = urlInputValue.trim();
		if (!trimmed) return;
		const timeoutId = window.setTimeout(() => {
			void checkVisibility(trimmed);
		}, 600);
		return () => window.clearTimeout(timeoutId);
	}, [urlInputValue, checkVisibility]);

	const showRemoteDisplay = useMemo(() => {
		return state.hasGit === true && state.remoteUrl !== null && !isEditingRemote;
	}, [state.hasGit, state.remoteUrl, isEditingRemote]);

	if (!projectDir) {
		return <div className="git-config__no-project">No project open.</div>;
	}

	if (state.isLoadingConfig) {
		return (
			<div className="git-config__loading" role="status" aria-live="polite">
				<span className="git-config__loading-spinner" aria-hidden="true" />
				Loading repository config…
			</div>
		);
	}

	if (state.hasGit === null) {
		return (
			<div className="git-config">
				{state.connectError && (
					<div className="git-branches__error-banner" role="alert">
						{state.connectError}
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="git-config">
			{state.divergenceHandled && state.divergenceMessage && (
				<div className="git-config__divergence-notice" role="status" aria-live="polite">
					<span className="git-config__divergence-notice-icon" aria-hidden="true">
						🔀
					</span>
					<div className="git-config__divergence-notice-body">
						<strong>Local changes preserved</strong>
						<p>{state.divergenceMessage}</p>
					</div>
					<button
						type="button"
						className="git-config__divergence-notice-dismiss"
						onClick={dismissDivergence}
						aria-label="Dismiss"
					>
						✕
					</button>
				</div>
			)}

			{state.isHandlingDivergence && (
				<p className="git-config__status" role="status" aria-live="polite">
					Saving local changes to a safety branch…
				</p>
			)}

			{state.divergenceError && (
				<div className="git-branches__error-banner" role="alert">
					{state.divergenceError}
				</div>
			)}

			{state.connectError && state.hasGit === true && state.remoteUrl !== null && !isEditingRemote && (
				<div className="git-branches__error-banner" role="alert">
					{state.connectError}
				</div>
			)}

			{state.hasGit === false ? (
				<NoGitSection
					isInitializing={state.isInitializing}
					initError={state.initError}
					onConnectToGit={() => {
						void connectToGit();
					}}
				/>
			) : (
				<>
					<section
						className="git-config__section"
						aria-labelledby="git-config-repo-title"
					>
						<header className="git-config__section-header">
							<h3 id="git-config-repo-title" className="git-config__section-title">
								Repository
							</h3>
						</header>
						<div className="git-config__repo-row">
							<span className="git-config__repo-icon" aria-hidden="true">
								✓
							</span>
							<span>Git repository detected</span>
						</div>
					</section>

					<div className="git-branches__divider" />

					<section
						className="git-config__section"
						aria-labelledby="git-config-remote-title"
					>
						<header className="git-config__section-header">
							<h3 id="git-config-remote-title" className="git-config__section-title">
								Remote
							</h3>
						</header>

						{showRemoteDisplay && state.remoteUrl ? (
							<>
								<p className="git-config__remote-url">{state.remoteUrl}</p>
								<RepoVisibilityBadge status={state.visibilityStatus} />
								<div className="git-config__remote-actions">
									<button
										type="button"
										className="btn btn--ghost"
										onClick={() => setIsEditingRemote(true)}
										aria-label="Change remote URL"
									>
										Change Remote
									</button>
								</div>
							</>
						) : (
							<RemoteConnectForm
								initialUrl={state.remoteUrl ?? ""}
								isConnecting={state.isConnecting}
								connectError={state.connectError}
								visibilityStatus={state.visibilityStatus}
								onUrlChange={setUrlInputValue}
								onConnect={(params) => {
									void connect(params);
								}}
								onCancel={
									state.remoteUrl !== null
										? () => {
											setIsEditingRemote(false);
											setUrlInputValue(state.remoteUrl ?? "");
										}
										: undefined
								}
							/>
						)}

						{state.connectSuccess && (
							<div className="git-branches__success-banner" role="status" aria-live="polite">
								Connected successfully.
							</div>
						)}
					</section>

					{state.isDetectingMainBranch && (
						<div
							className="git-config__detecting-branch"
							role="status"
							aria-live="polite"
						>
							Detecting main branch…
						</div>
					)}

					{state.protectedBranch && !state.isDetectingMainBranch && (
						<section
							className="git-config__section"
							aria-labelledby="git-config-protected-title"
						>
							<header className="git-config__section-header">
								<h3
									id="git-config-protected-title"
									className="git-config__section-title"
								>
									Protected Branch
								</h3>
							</header>
							<p className="git-config__protected-branch">
								<span className="git-config__protected-icon" aria-hidden="true">
									🔒
								</span>
								<span className="git-config__branch-name">{state.protectedBranch}</span>
							</p>
							<p className="git-config__hint">
								Direct commits and pushes to this branch are blocked.
							</p>
						</section>
					)}

					{state.needsMainBranchInput && !state.isDetectingMainBranch && (
						<MainBranchInputSection
							isDetecting={state.isDetectingMainBranch}
							onConfirm={(branch) => {
								if (!projectDir) return;
								void setProtectedBranch(branch, projectDir);
							}}
						/>
					)}
				</>
			)}
		</div>
	);
}
