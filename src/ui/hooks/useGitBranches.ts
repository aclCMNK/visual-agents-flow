import { useCallback, useEffect, useReducer } from "react";
import type {
	GitBranch,
	GitCommit,
	GitOperationError,
} from "../../electron/bridge.types.ts";
import {
	formatGitError,
	type UiGitError,
	toUiGitError,
} from "../utils/gitErrorUtils.ts";

interface GitBranchesState {
	currentBranch: string;
	branches: GitBranch[];
	selectedBranch: string;
	incomingCommits: GitCommit[];
	aheadCount: number;
	behindCount: number;
	noUpstream: boolean;
	branchCommits: GitCommit[];

	isLoadingBranches: boolean;
	isLoadingRemoteDiff: boolean;
	isFetchingAndPulling: boolean;
	isPullingBranch: boolean;
	isCheckingOut: boolean;
	isLoadingCommits: boolean;
	isCreatingBranch: boolean;

	branchesError: UiGitError | null;
	remoteDiffError: UiGitError | null;
	fetchPullError: UiGitError | null;
	pullBranchError: UiGitError | null;
	checkoutError: UiGitError | null;
	commitsError: UiGitError | null;
	createBranchError: UiGitError | null;

	lastFetchPullSuccess: string | null;
	lastCheckoutSuccess: string | null;
	lastCreateBranchSuccess: string | null;
}

type GitBranchesAction =
	| { type: "LOAD_BRANCHES_START" }
	| {
			type: "LOAD_BRANCHES_SUCCESS";
			branches: GitBranch[];
			currentBranch: string;
			preferredBranch: string | null;
	  }
	| { type: "LOAD_BRANCHES_ERROR"; error: UiGitError }
	| { type: "SELECT_BRANCH"; branch: string }
	| { type: "LOAD_REMOTE_DIFF_START" }
	| {
			type: "LOAD_REMOTE_DIFF_SUCCESS";
			incomingCommits: GitCommit[];
			aheadCount: number;
			behindCount: number;
			noUpstream: boolean;
	  }
	| { type: "LOAD_REMOTE_DIFF_ERROR"; error: UiGitError }
	| { type: "FETCH_PULL_START" }
	| { type: "FETCH_PULL_SUCCESS"; output: string; alreadyUpToDate: boolean }
	| { type: "FETCH_PULL_ERROR"; error: UiGitError }
	| { type: "PULL_BRANCH_START" }
	| { type: "PULL_BRANCH_SUCCESS"; output: string }
	| { type: "PULL_BRANCH_ERROR"; error: UiGitError }
	| { type: "CHECKOUT_START" }
	| { type: "CHECKOUT_SUCCESS"; branch: string }
	| { type: "CHECKOUT_ERROR"; error: UiGitError }
	| { type: "LOAD_COMMITS_START" }
	| { type: "LOAD_COMMITS_SUCCESS"; commits: GitCommit[]; branch: string }
	| { type: "LOAD_COMMITS_ERROR"; error: UiGitError }
	| { type: "CREATE_BRANCH_START" }
	| { type: "CREATE_BRANCH_SUCCESS"; branch: string }
	| { type: "CREATE_BRANCH_ERROR"; error: UiGitError }
	| { type: "CLEAR_CREATE_BRANCH_FEEDBACK" }
	| { type: "CLEAR_ERRORS" };

const initialState: GitBranchesState = {
	currentBranch: "",
	branches: [],
	selectedBranch: "",
	incomingCommits: [],
	aheadCount: 0,
	behindCount: 0,
	noUpstream: false,
	branchCommits: [],

	isLoadingBranches: false,
	isLoadingRemoteDiff: false,
	isFetchingAndPulling: false,
	isPullingBranch: false,
	isCheckingOut: false,
	isLoadingCommits: false,
	isCreatingBranch: false,

	branchesError: null,
	remoteDiffError: null,
	fetchPullError: null,
	pullBranchError: null,
	checkoutError: null,
	commitsError: null,
	createBranchError: null,

	lastFetchPullSuccess: null,
	lastCheckoutSuccess: null,
	lastCreateBranchSuccess: null,
};

function reducer(
	state: GitBranchesState,
	action: GitBranchesAction,
): GitBranchesState {
		switch (action.type) {
		case "LOAD_BRANCHES_START":
			return {
				...state,
				isLoadingBranches: true,
				branchesError: null,
			};
		case "LOAD_BRANCHES_SUCCESS": {
			const selectableBranches = action.branches.filter((b) => !b.isRemote);
			const preferredBranch = (action.preferredBranch ?? "").trim();
			const selectedBranch =
				(preferredBranch
					? selectableBranches.find((b) => b.name === preferredBranch)?.name
					: undefined) ??
				selectableBranches.find((b) => b.isCurrent)?.name ??
				selectableBranches[0]?.name ??
				"";
			return {
				...state,
				isLoadingBranches: false,
				branchesError: null,
				branches: action.branches,
				currentBranch: action.currentBranch,
				selectedBranch,
			};
		}
		case "LOAD_BRANCHES_ERROR":
			return {
				...state,
				isLoadingBranches: false,
				branchesError: action.error,
			};
		case "SELECT_BRANCH":
			return {
				...state,
				selectedBranch: action.branch,
				pullBranchError: null,
				checkoutError: null,
				commitsError: null,
			};
		case "LOAD_REMOTE_DIFF_START":
			return {
				...state,
				isLoadingRemoteDiff: true,
				remoteDiffError: null,
			};
		case "LOAD_REMOTE_DIFF_SUCCESS":
			return {
				...state,
				isLoadingRemoteDiff: false,
				remoteDiffError: null,
				incomingCommits: action.incomingCommits,
				aheadCount: action.aheadCount,
				behindCount: action.behindCount,
				noUpstream: action.noUpstream,
			};
		case "LOAD_REMOTE_DIFF_ERROR":
			return {
				...state,
				isLoadingRemoteDiff: false,
				remoteDiffError: action.error,
			};
		case "FETCH_PULL_START":
			return {
				...state,
				isFetchingAndPulling: true,
				fetchPullError: null,
				lastFetchPullSuccess: null,
			};
		case "FETCH_PULL_SUCCESS":
			return {
				...state,
				isFetchingAndPulling: false,
				fetchPullError: null,
				lastFetchPullSuccess: action.alreadyUpToDate
					? "Already up to date with remote."
					: "Fetch & Pull completed successfully.",
			};
		case "FETCH_PULL_ERROR":
			return {
				...state,
				isFetchingAndPulling: false,
				fetchPullError: action.error,
			};
		case "PULL_BRANCH_START":
			return {
				...state,
				isPullingBranch: true,
				pullBranchError: null,
			};
		case "PULL_BRANCH_SUCCESS":
			return {
				...state,
				isPullingBranch: false,
				pullBranchError: null,
			};
		case "PULL_BRANCH_ERROR":
			return {
				...state,
				isPullingBranch: false,
				pullBranchError: action.error,
			};
		case "CHECKOUT_START":
			return {
				...state,
				isCheckingOut: true,
				checkoutError: null,
				lastCheckoutSuccess: null,
			};
		case "CHECKOUT_SUCCESS":
			return {
				...state,
				isCheckingOut: false,
				checkoutError: null,
				selectedBranch: action.branch,
				lastCheckoutSuccess: action.branch,
			};
		case "CHECKOUT_ERROR":
			return {
				...state,
				isCheckingOut: false,
				checkoutError: action.error,
			};
		case "LOAD_COMMITS_START":
			return {
				...state,
				isLoadingCommits: true,
				commitsError: null,
			};
		case "LOAD_COMMITS_SUCCESS":
			return {
				...state,
				isLoadingCommits: false,
				commitsError: null,
				branchCommits: action.commits,
			};
		case "LOAD_COMMITS_ERROR":
			return {
				...state,
				isLoadingCommits: false,
				commitsError: action.error,
			};
		case "CREATE_BRANCH_START":
			return {
				...state,
				isCreatingBranch: true,
				createBranchError: null,
				lastCreateBranchSuccess: null,
			};
		case "CREATE_BRANCH_SUCCESS":
			return {
				...state,
				isCreatingBranch: false,
				createBranchError: null,
				lastCreateBranchSuccess: action.branch,
			};
		case "CREATE_BRANCH_ERROR":
			return {
				...state,
				isCreatingBranch: false,
				createBranchError: action.error,
			};
		case "CLEAR_CREATE_BRANCH_FEEDBACK":
			return {
				...state,
				createBranchError: null,
			};
		case "CLEAR_ERRORS":
			return {
				...state,
				branchesError: null,
				remoteDiffError: null,
				fetchPullError: null,
				pullBranchError: null,
				checkoutError: null,
				commitsError: null,
				createBranchError: null,
				lastFetchPullSuccess: null,
				lastCheckoutSuccess: null,
				lastCreateBranchSuccess: null,
			};
		default:
			return state;
	}
}

function mapGitErrorToMessage(error: GitOperationError): UiGitError {
	return formatGitError(error);
}

function getBridge() {
	if (
		typeof window !== "undefined" &&
		typeof window.agentsFlow !== "undefined"
	) {
		return window.agentsFlow;
	}
	return null;
}

export function useGitBranches(
	projectDir: string | null,
	protectedBranch: string | null,
) {
	const [state, dispatch] = useReducer(reducer, initialState);

	const loadBranches = useCallback(async () => {
		if (!projectDir) return;
		const bridge = getBridge();
		if (!bridge) {
			dispatch({
				type: "LOAD_BRANCHES_ERROR",
				error: toUiGitError("Electron bridge unavailable."),
			});
			return;
		}

		dispatch({ type: "LOAD_BRANCHES_START" });
		const res = await bridge.gitListBranches({ projectDir });
		if (!res.ok) {
			dispatch({
				type: "LOAD_BRANCHES_ERROR",
				error: mapGitErrorToMessage(res),
			});
			return;
		}

		const desiredProtectedBranch = (protectedBranch ?? "").trim();
		const hasLocalProtectedBranch =
			desiredProtectedBranch.length > 0 &&
			res.branches.some(
				(branch) => !branch.isRemote && branch.name === desiredProtectedBranch,
			);

		let branches = res.branches;
		let currentBranch = res.currentBranch;

		if (desiredProtectedBranch.length > 0 && !hasLocalProtectedBranch) {
			const ensureRes = await bridge.gitEnsureLocalBranch({
				projectDir,
				branch: desiredProtectedBranch,
			});
			if (!ensureRes.ok) {
				dispatch({
					type: "LOAD_BRANCHES_ERROR",
					error: mapGitErrorToMessage(ensureRes),
				});
				return;
			}

			const refreshedRes = await bridge.gitListBranches({ projectDir });
			if (!refreshedRes.ok) {
				dispatch({
					type: "LOAD_BRANCHES_ERROR",
					error: mapGitErrorToMessage(refreshedRes),
				});
				return;
			}

			branches = refreshedRes.branches;
			currentBranch = refreshedRes.currentBranch;
		}

		dispatch({
			type: "LOAD_BRANCHES_SUCCESS",
			branches,
			currentBranch,
			preferredBranch: protectedBranch,
		});
	}, [projectDir, protectedBranch]);

	const loadRemoteDiff = useCallback(async () => {
		if (!projectDir) return;
		const bridge = getBridge();
		if (!bridge) {
			dispatch({
				type: "LOAD_REMOTE_DIFF_ERROR",
				error: toUiGitError("Electron bridge unavailable."),
			});
			return;
		}

		dispatch({ type: "LOAD_REMOTE_DIFF_START" });
		const res = await bridge.gitGetRemoteDiff({ projectDir });
		if (!res.ok) {
			dispatch({
				type: "LOAD_REMOTE_DIFF_ERROR",
				error: mapGitErrorToMessage(res),
			});
			return;
		}
		dispatch({
			type: "LOAD_REMOTE_DIFF_SUCCESS",
			incomingCommits: res.incomingCommits,
			aheadCount: res.aheadCount,
			behindCount: res.behindCount,
			noUpstream: res.noUpstream,
		});
	}, [projectDir]);

	const fetchAndPull = useCallback(async () => {
		if (!projectDir) return;
		const bridge = getBridge();
		if (!bridge) {
			dispatch({
				type: "FETCH_PULL_ERROR",
				error: toUiGitError("Electron bridge unavailable."),
			});
			return;
		}

		dispatch({ type: "FETCH_PULL_START" });
		const res = await bridge.gitFetchAndPull({ projectDir });
		if (!res.ok) {
			dispatch({ type: "FETCH_PULL_ERROR", error: mapGitErrorToMessage(res) });
			return;
		}

		dispatch({
			type: "FETCH_PULL_SUCCESS",
			output: res.output,
			alreadyUpToDate: res.alreadyUpToDate,
		});

		await loadRemoteDiff();
		await loadBranches();
	}, [projectDir, loadBranches, loadRemoteDiff]);

	const pullBranch = useCallback(
		async (branch: string) => {
			if (!projectDir || !branch) return;
			const bridge = getBridge();
			if (!bridge) {
				dispatch({
					type: "PULL_BRANCH_ERROR",
					error: toUiGitError("Electron bridge unavailable."),
				});
				return;
			}

			dispatch({ type: "PULL_BRANCH_START" });
			const res = await bridge.gitPullBranch({ projectDir, branch });
			if (!res.ok) {
				dispatch({
					type: "PULL_BRANCH_ERROR",
					error: mapGitErrorToMessage(res),
				});
				return;
			}

			dispatch({ type: "PULL_BRANCH_SUCCESS", output: res.output });
			await loadRemoteDiff();
		},
		[projectDir, loadRemoteDiff],
	);

	const checkoutBranch = useCallback(
		async (branch: string) => {
			if (!projectDir || !branch) return;
			const bridge = getBridge();
			if (!bridge) {
				dispatch({
					type: "CHECKOUT_ERROR",
					error: toUiGitError("Electron bridge unavailable."),
				});
				return;
			}

			dispatch({ type: "CHECKOUT_START" });
			const res = await bridge.gitCheckoutBranch({ projectDir, branch });
			if (!res.ok) {
				dispatch({ type: "CHECKOUT_ERROR", error: mapGitErrorToMessage(res) });
				return;
			}

			dispatch({ type: "CHECKOUT_SUCCESS", branch: res.branch });
			await loadBranches();
			await loadRemoteDiff();
		},
		[projectDir, loadBranches, loadRemoteDiff],
	);

	const loadBranchCommits = useCallback(
		async (branch: string) => {
			if (!projectDir || !branch) return;
			const bridge = getBridge();
			if (!bridge) {
				dispatch({
					type: "LOAD_COMMITS_ERROR",
					error: toUiGitError("Electron bridge unavailable."),
				});
				return;
			}

			dispatch({ type: "LOAD_COMMITS_START" });
			const res = await bridge.gitGetBranchCommits({
				projectDir,
				branch,
				limit: 20,
			});
			if (!res.ok) {
				dispatch({
					type: "LOAD_COMMITS_ERROR",
					error: mapGitErrorToMessage(res),
				});
				return;
			}

			dispatch({
				type: "LOAD_COMMITS_SUCCESS",
				commits: res.commits,
				branch: res.branch,
			});
		},
		[projectDir],
	);

	const createBranch = useCallback(
		async (newBranchName: string, sourceBranch: string) => {
			if (!projectDir || !newBranchName || !sourceBranch) return;
			const bridge = getBridge();
			if (!bridge) {
				dispatch({
					type: "CREATE_BRANCH_ERROR",
					error: toUiGitError("Electron bridge unavailable."),
				});
				return;
			}

			dispatch({ type: "CREATE_BRANCH_START" });
			const res = await bridge.gitCreateBranch({
				projectDir,
				newBranchName,
				sourceBranch,
				protectedBranch: protectedBranch ?? undefined,
			});
			if (!res.ok) {
				dispatch({
					type: "CREATE_BRANCH_ERROR",
					error: mapGitErrorToMessage(res),
				});
				return;
			}

			dispatch({ type: "CREATE_BRANCH_SUCCESS", branch: res.branch });
			await loadBranches();
			await loadRemoteDiff();
		},
		[projectDir, protectedBranch, loadBranches, loadRemoteDiff],
	);

	const selectBranch = useCallback((branch: string) => {
		dispatch({ type: "SELECT_BRANCH", branch });
	}, []);

	const clearErrors = useCallback(() => {
		dispatch({ type: "CLEAR_ERRORS" });
	}, []);

	const clearCreateBranchFeedback = useCallback(() => {
		dispatch({ type: "CLEAR_CREATE_BRANCH_FEEDBACK" });
	}, []);

	useEffect(() => {
		if (!projectDir) return;
		void loadBranches();
	}, [projectDir, loadBranches]);

	useEffect(() => {
		if (!projectDir) return;
		void loadRemoteDiff();
	}, [projectDir, loadRemoteDiff]);

	useEffect(() => {
		if (!projectDir || !state.selectedBranch) return;
		void loadBranchCommits(state.selectedBranch);
	}, [state.selectedBranch, projectDir, loadBranchCommits]);

	return {
		state,
		loadBranches,
		loadRemoteDiff,
		fetchAndPull,
		pullBranch,
		checkoutBranch,
		createBranch,
		selectBranch,
		clearErrors,
		clearCreateBranchFeedback,
	};
}
