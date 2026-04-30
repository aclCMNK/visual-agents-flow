import { useCallback, useEffect, useReducer } from "react";
import type { GitChangedFile, GitOperationError } from "../../electron/bridge.types.ts";
import {
	formatGitError,
	type UiGitError,
	toUiGitError,
} from "../utils/gitErrorUtils.ts";

interface GitChangesState {
	currentBranch: string;
	files: GitChangedFile[];
	stagedCount: number;
	unstagedCount: number;
	commitMessage: string;
	commitDescription: string;
	isLoadingStatus: boolean;
	isCommitting: boolean;
	isPushing: boolean;
	statusError: UiGitError | null;
	commitError: UiGitError | null;
	lastCommitSuccess: string | null;
	lastPushSuccess: boolean | null;
	pushError: UiGitError | null;
	lastPushBranch: string | null;
	lastPushRemote: string | null;
}

type GitChangesAction =
	| { type: "LOAD_STATUS_START" }
	| {
			type: "LOAD_STATUS_SUCCESS";
			currentBranch: string;
			files: GitChangedFile[];
			stagedCount: number;
			unstagedCount: number;
	  }
	| { type: "LOAD_STATUS_ERROR"; error: UiGitError }
	| { type: "SET_COMMIT_MESSAGE"; message: string }
	| { type: "SET_COMMIT_DESCRIPTION"; description: string }
	| { type: "COMMIT_START" }
	| { type: "COMMIT_SUCCESS"; commitHash: string }
	| { type: "COMMIT_ERROR"; error: UiGitError }
	| { type: "PUSH_SUCCESS"; branch: string; remote: string }
	| { type: "PUSH_SKIPPED" }
	| { type: "PUSH_ERROR"; error: UiGitError }
	| { type: "CLEAR_COMMIT_FEEDBACK" }
	| { type: "RESET_FORM" };

const initialState: GitChangesState = {
	currentBranch: "",
	files: [],
	stagedCount: 0,
	unstagedCount: 0,
	commitMessage: "",
	commitDescription: "",
	isLoadingStatus: false,
	isCommitting: false,
	isPushing: false,
	statusError: null,
	commitError: null,
	lastCommitSuccess: null,
	lastPushSuccess: null,
	pushError: null,
	lastPushBranch: null,
	lastPushRemote: null,
};

function reducer(state: GitChangesState, action: GitChangesAction): GitChangesState {
	switch (action.type) {
		case "LOAD_STATUS_START":
			return {
				...state,
				isLoadingStatus: true,
				statusError: null,
			};
		case "LOAD_STATUS_SUCCESS":
			return {
				...state,
				isLoadingStatus: false,
				statusError: null,
				currentBranch: action.currentBranch,
				files: action.files,
				stagedCount: action.stagedCount,
				unstagedCount: action.unstagedCount,
			};
		case "LOAD_STATUS_ERROR":
			return {
				...state,
				isLoadingStatus: false,
				statusError: action.error,
			};
		case "SET_COMMIT_MESSAGE":
			return {
				...state,
				commitMessage: action.message,
			};
		case "SET_COMMIT_DESCRIPTION":
			return {
				...state,
				commitDescription: action.description,
			};
		case "COMMIT_START":
			return {
				...state,
				isCommitting: true,
				isPushing: false,
				commitError: null,
				lastCommitSuccess: null,
				lastPushSuccess: null,
				pushError: null,
				lastPushBranch: null,
				lastPushRemote: null,
			};
		case "COMMIT_SUCCESS":
			return {
				...state,
				isCommitting: true,
				isPushing: true,
				commitError: null,
				lastCommitSuccess: action.commitHash,
			};
		case "COMMIT_ERROR":
			return {
				...state,
				isCommitting: false,
				isPushing: false,
				commitError: action.error,
			};
		case "PUSH_SUCCESS":
			return {
				...state,
				isCommitting: false,
				isPushing: false,
				lastPushSuccess: true,
				lastPushBranch: action.branch,
				lastPushRemote: action.remote,
				pushError: null,
			};
		case "PUSH_SKIPPED":
			return {
				...state,
				isCommitting: false,
				isPushing: false,
				lastPushSuccess: null,
			};
		case "PUSH_ERROR":
			return {
				...state,
				isCommitting: false,
				isPushing: false,
				lastPushSuccess: false,
				pushError: action.error,
			};
		case "CLEAR_COMMIT_FEEDBACK":
			return {
				...state,
				commitError: null,
				lastCommitSuccess: null,
				lastPushSuccess: null,
				pushError: null,
				lastPushBranch: null,
				lastPushRemote: null,
			};
		case "RESET_FORM":
			return {
				...state,
				commitMessage: "",
				commitDescription: "",
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

export function useGitChanges(
	projectDir: string | null,
	protectedBranch: string | null,
) {
	const [state, dispatch] = useReducer(reducer, initialState);

	const loadStatus = useCallback(async () => {
		if (!projectDir) return;
		const bridge = getBridge();
		if (!bridge) {
			dispatch({
				type: "LOAD_STATUS_ERROR",
				error: toUiGitError("Electron bridge unavailable."),
			});
			return;
		}

		dispatch({ type: "LOAD_STATUS_START" });
		try {
			const result = await bridge.gitGetStatus({ projectDir });
			if (!result.ok) {
				dispatch({
					type: "LOAD_STATUS_ERROR",
					error: mapGitErrorToMessage(result),
				});
				return;
			}
			dispatch({
				type: "LOAD_STATUS_SUCCESS",
				currentBranch: result.currentBranch,
				files: result.files,
				stagedCount: result.stagedCount,
				unstagedCount: result.unstagedCount,
			});
		} catch {
			dispatch({
				type: "LOAD_STATUS_ERROR",
				error: toUiGitError("Unexpected error loading status."),
			});
		}
	}, [projectDir]);

	const setCommitMessage = useCallback((message: string) => {
		dispatch({ type: "SET_COMMIT_MESSAGE", message });
	}, []);

	const setCommitDescription = useCallback((description: string) => {
		dispatch({ type: "SET_COMMIT_DESCRIPTION", description });
	}, []);

	const addAndCommit = useCallback(async () => {
		if (!projectDir) return;

		// Protected branch guard — absolute block, no git command is ever executed
		if (
			protectedBranch &&
			state.currentBranch &&
			state.currentBranch === protectedBranch
		) {
			dispatch({
				type: "COMMIT_ERROR",
				error: toUiGitError(
					"You cannot commit or push directly to the main branch.",
				),
			});
			return;
		}

		const bridge = getBridge();
		if (!bridge) {
			dispatch({
				type: "COMMIT_ERROR",
				error: toUiGitError("Electron bridge unavailable."),
			});
			return;
		}

		const message = state.commitMessage;
		const trimmedMessage = message.trim();
		if (!trimmedMessage) {
			dispatch({
				type: "COMMIT_ERROR",
				error: toUiGitError("Commit message cannot be empty."),
			});
			return;
		}

		dispatch({ type: "COMMIT_START" });
		try {
			const description = state.commitDescription;
			const result = await bridge.gitAddAndCommit({
				projectDir,
				message: trimmedMessage,
				description: description.trim().length > 0 ? description : undefined,
				protectedBranch: protectedBranch ?? undefined,
			});

			if (!result.ok) {
				dispatch({
					type: "COMMIT_ERROR",
					error: mapGitErrorToMessage(result),
				});
				return;
			}

			dispatch({ type: "COMMIT_SUCCESS", commitHash: result.commitHash });
			dispatch({ type: "RESET_FORM" });

			if (result.pushAttempted) {
				if (result.pushOk) {
					dispatch({
						type: "PUSH_SUCCESS",
						branch: result.pushBranch!,
						remote: result.pushRemote!,
					});
				} else {
					dispatch({
						type: "PUSH_ERROR",
						error: toUiGitError(result.pushError ?? "Push failed."),
					});
				}
			} else {
				dispatch({ type: "PUSH_SKIPPED" });
			}

			await loadStatus();
		} catch {
			dispatch({
				type: "COMMIT_ERROR",
				error: toUiGitError("Unexpected error during commit."),
			});
		}
	}, [
		projectDir,
		protectedBranch,
		state.currentBranch,
		state.commitMessage,
		state.commitDescription,
		loadStatus,
	]);

	const clearFeedback = useCallback(() => {
		dispatch({ type: "CLEAR_COMMIT_FEEDBACK" });
	}, []);

	useEffect(() => {
		if (!projectDir) return;
		void loadStatus();
	}, [projectDir, loadStatus]);

	return {
		state,
		loadStatus,
		setCommitMessage,
		setCommitDescription,
		addAndCommit,
		clearFeedback,
	};
}
