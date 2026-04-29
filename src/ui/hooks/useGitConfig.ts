import { useCallback, useEffect, useReducer, useRef } from "react";
import type { VisibilityStatus } from "../utils/repoVisibility.ts";
import { detectRepoVisibility } from "../utils/repoVisibility.ts";

export interface ConnectParams {
	url: string;
	credentials?: {
		username: string;
		password: string;
	};
	userName: string;
	userEmail: string;
}

export interface GitConfigState {
	hasGit: boolean | null;
	remoteUrl: string | null;
	protectedBranch: string | null;
	divergenceHandled: boolean;
	savedBranch: string | null;
	divergenceMessage: string | null;
	isHandlingDivergence: boolean;
	divergenceError: string | null;
	isDetectingMainBranch: boolean;
	mainBranchDetectError: string | null;
	needsMainBranchInput: boolean;
	visibilityStatus: VisibilityStatus;
	isLoadingConfig: boolean;
	isInitializing: boolean;
	isConnecting: boolean;
	initError: string | null;
	connectError: string | null;
	connectSuccess: boolean;
}

export interface UseGitConfigResult {
	state: GitConfigState;
	connectToGit: () => Promise<void>;
	connect: (params: ConnectParams) => Promise<void>;
	checkVisibility: (url: string) => Promise<void>;
	clearFeedback: () => void;
	dismissDivergence: () => void;
	detectMainBranch: () => Promise<void>;
	setProtectedBranch: (branch: string, projectDir: string) => Promise<void>;
}

type GitConfigAction =
	| { type: "LOAD_CONFIG_START" }
	| { type: "LOAD_CONFIG_SUCCESS"; hasGit: boolean; remoteUrl: string | null }
	| { type: "LOAD_CONFIG_ERROR"; error: string }
	| { type: "INIT_START" }
	| { type: "INIT_SUCCESS" }
	| { type: "INIT_ERROR"; error: string }
	| { type: "CONNECT_START" }
	| { type: "CONNECT_SUCCESS"; remoteUrl: string }
	| { type: "CONNECT_ERROR"; error: string }
	| { type: "DETECT_MAIN_BRANCH_START" }
	| { type: "DETECT_MAIN_BRANCH_SUCCESS"; branch: string }
	| { type: "DETECT_MAIN_BRANCH_NEEDS_INPUT" }
	| { type: "DETECT_MAIN_BRANCH_ERROR"; error: string }
	| { type: "DIVERGENCE_START" }
	| { type: "DIVERGENCE_SUCCESS"; savedBranch: string | null; message: string | null }
	| { type: "DIVERGENCE_ERROR"; error: string }
	| { type: "DIVERGENCE_DISMISS" }
	| { type: "SET_PROTECTED_BRANCH"; branch: string }
	| { type: "SET_VISIBILITY_STATUS"; status: VisibilityStatus }
	| { type: "CLEAR_FEEDBACK" };

const initialState: GitConfigState = {
	hasGit: null,
	remoteUrl: null,
	protectedBranch: null,
	divergenceHandled: false,
	savedBranch: null,
	divergenceMessage: null,
	isHandlingDivergence: false,
	divergenceError: null,
	isDetectingMainBranch: false,
	mainBranchDetectError: null,
	needsMainBranchInput: false,
	visibilityStatus: "idle",
	isLoadingConfig: false,
	isInitializing: false,
	isConnecting: false,
	initError: null,
	connectError: null,
	connectSuccess: false,
};

function reducer(state: GitConfigState, action: GitConfigAction): GitConfigState {
	switch (action.type) {
		case "LOAD_CONFIG_START":
			return {
				...state,
				isLoadingConfig: true,
				initError: null,
				connectError: null,
			};
		case "LOAD_CONFIG_SUCCESS":
			return {
				...state,
				isLoadingConfig: false,
				hasGit: action.hasGit,
				remoteUrl: action.remoteUrl,
				...(action.remoteUrl === null
					? {
						protectedBranch: null,
						needsMainBranchInput: false,
						mainBranchDetectError: null,
					}
					: {}),
				initError: null,
				connectError: null,
			};
		case "LOAD_CONFIG_ERROR":
			return {
				...state,
				isLoadingConfig: false,
				connectError: action.error,
			};
		case "INIT_START":
			return {
				...state,
				isInitializing: true,
				initError: null,
			};
		case "INIT_SUCCESS":
			return {
				...state,
				isInitializing: false,
				initError: null,
			};
		case "INIT_ERROR":
			return {
				...state,
				isInitializing: false,
				initError: action.error,
			};
		case "CONNECT_START":
			return {
				...state,
				isConnecting: true,
				connectError: null,
				connectSuccess: false,
			};
		case "CONNECT_SUCCESS":
			return {
				...state,
				isConnecting: false,
				remoteUrl: action.remoteUrl,
				connectError: null,
				connectSuccess: true,
			};
		case "CONNECT_ERROR":
			return {
				...state,
				isConnecting: false,
				connectError: action.error,
				connectSuccess: false,
			};
		case "DETECT_MAIN_BRANCH_START":
			return {
				...state,
				isDetectingMainBranch: true,
				mainBranchDetectError: null,
			};
		case "DETECT_MAIN_BRANCH_SUCCESS":
			return {
				...state,
				isDetectingMainBranch: false,
				protectedBranch: action.branch,
				needsMainBranchInput: false,
				mainBranchDetectError: null,
			};
		case "DETECT_MAIN_BRANCH_NEEDS_INPUT":
			return {
				...state,
				isDetectingMainBranch: false,
				needsMainBranchInput: state.protectedBranch ? false : true,
				mainBranchDetectError: null,
			};
		case "DETECT_MAIN_BRANCH_ERROR":
			return {
				...state,
				isDetectingMainBranch: false,
				mainBranchDetectError: action.error,
				needsMainBranchInput: state.protectedBranch ? false : true,
			};
		case "DIVERGENCE_START":
			return {
				...state,
				isHandlingDivergence: true,
				divergenceError: null,
			};
		case "DIVERGENCE_SUCCESS":
			return {
				...state,
				isHandlingDivergence: false,
				divergenceHandled: action.savedBranch !== null,
				savedBranch: action.savedBranch,
				divergenceMessage: action.message,
				divergenceError: null,
			};
		case "DIVERGENCE_ERROR":
			return {
				...state,
				isHandlingDivergence: false,
				divergenceError: action.error,
			};
		case "DIVERGENCE_DISMISS":
			return {
				...state,
				divergenceHandled: false,
				savedBranch: null,
				divergenceMessage: null,
			};
		case "SET_PROTECTED_BRANCH":
			return {
				...state,
				protectedBranch: action.branch,
				needsMainBranchInput: false,
				mainBranchDetectError: null,
			};
		case "SET_VISIBILITY_STATUS":
			return {
				...state,
				visibilityStatus: action.status,
			};
		case "CLEAR_FEEDBACK":
			return {
				...state,
				initError: null,
				connectError: null,
				mainBranchDetectError: null,
				connectSuccess: false,
			};
		default:
			return state;
	}
}

function getBridge() {
	if (typeof window !== "undefined" && typeof window.agentsFlow !== "undefined") {
		return window.agentsFlow;
	}
	return null;
}

export function useGitConfig(projectDir: string | null): UseGitConfigResult {
	const [state, dispatch] = useReducer(reducer, initialState);
	const loadRequestIdRef = useRef(0);
	const visibilityRequestIdRef = useRef(0);

	const detectMainBranch = useCallback(async () => {
		if (!projectDir) return;
		const bridge = getBridge();
		if (!bridge) return;

		dispatch({ type: "DETECT_MAIN_BRANCH_START" });
		try {
			const result = await bridge.gitDetectMainBranch({ projectDir });
			if (!result.ok) {
				dispatch({ type: "DETECT_MAIN_BRANCH_ERROR", error: result.message });
				return;
			}
			if (result.branch === null) {
				dispatch({ type: "DETECT_MAIN_BRANCH_NEEDS_INPUT" });
			} else {
				dispatch({ type: "DETECT_MAIN_BRANCH_SUCCESS", branch: result.branch });
			}
		} catch {
			dispatch({
				type: "DETECT_MAIN_BRANCH_ERROR",
				error: "Could not detect main branch.",
			});
		}
	}, [projectDir]);

	const setProtectedBranch = useCallback(
		async (branch: string, checkoutProjectDir: string) => {
			const trimmed = branch.trim();
			if (!trimmed) return;
			dispatch({ type: "SET_PROTECTED_BRANCH", branch: trimmed });

			const bridge = getBridge();
			if (bridge && checkoutProjectDir) {
				const ensureResult = await bridge.gitEnsureLocalBranch({
					projectDir: checkoutProjectDir,
					branch: trimmed,
				});
				if (!ensureResult.ok) {
					dispatch({
						type: "DETECT_MAIN_BRANCH_ERROR",
						error: ensureResult.message,
					});
				}
			}
		},
		[],
	);

	const loadConfig = useCallback(async () => {
		if (!projectDir) return;
		const bridge = getBridge();
		if (!bridge) {
			dispatch({
				type: "LOAD_CONFIG_ERROR",
				error: "Electron bridge unavailable.",
			});
			return;
		}

		loadRequestIdRef.current += 1;
		const requestId = loadRequestIdRef.current;

		dispatch({ type: "LOAD_CONFIG_START" });
		try {
			const result = await bridge.gitGetConfig({ projectDir });
			if (requestId !== loadRequestIdRef.current) return;
			if (!result.ok) {
				dispatch({ type: "LOAD_CONFIG_ERROR", error: result.message });
				return;
			}
			dispatch({
				type: "LOAD_CONFIG_SUCCESS",
				hasGit: result.hasGit,
				remoteUrl: result.remoteUrl,
			});
			if (result.remoteUrl !== null) {
				await detectMainBranch();
			}
		} catch {
			if (requestId !== loadRequestIdRef.current) return;
			dispatch({
				type: "LOAD_CONFIG_ERROR",
				error: "Unexpected error loading config.",
			});
		}
	}, [projectDir, detectMainBranch]);

	const checkVisibility = useCallback(async (url: string) => {
		const trimmed = url.trim();
		visibilityRequestIdRef.current += 1;
		const requestId = visibilityRequestIdRef.current;

		if (!trimmed) {
			dispatch({ type: "SET_VISIBILITY_STATUS", status: "idle" });
			return;
		}

		if (
			!(
				trimmed.startsWith("https://") ||
				trimmed.startsWith("http://") ||
				trimmed.startsWith("git@") ||
				trimmed.startsWith("ssh://")
			)
		) {
			dispatch({ type: "SET_VISIBILITY_STATUS", status: "idle" });
			return;
		}

		dispatch({ type: "SET_VISIBILITY_STATUS", status: "checking" });
		const result = await detectRepoVisibility(trimmed);
		if (requestId !== visibilityRequestIdRef.current) return;

		if (result === "not_found") {
			dispatch({ type: "SET_VISIBILITY_STATUS", status: "private" });
			return;
		}
		dispatch({ type: "SET_VISIBILITY_STATUS", status: result });
	}, []);

	const connectToGit = useCallback(async () => {
		if (!projectDir) return;
		const bridge = getBridge();
		if (!bridge) {
			dispatch({
				type: "INIT_ERROR",
				error: "Electron bridge unavailable.",
			});
			return;
		}

		dispatch({ type: "INIT_START" });
		try {
			const result = await bridge.gitInit({ projectDir });
			if (!result.ok) {
				dispatch({ type: "INIT_ERROR", error: result.message });
				return;
			}
			dispatch({ type: "INIT_SUCCESS" });
			await loadConfig();
		} catch {
			dispatch({
				type: "INIT_ERROR",
				error: "Unexpected error initializing repository.",
			});
		}
	}, [projectDir, loadConfig]);

	const connect = useCallback(
		async (params: ConnectParams) => {
			if (!projectDir) return;
			const bridge = getBridge();
			if (!bridge) {
				dispatch({
					type: "CONNECT_ERROR",
					error: "Electron bridge unavailable.",
				});
				return;
			}

			dispatch({ type: "CONNECT_START" });
			try {
				const remoteResult = await bridge.gitSetRemote({
					projectDir,
					url: params.url,
				});
				if (!remoteResult.ok) {
					dispatch({ type: "CONNECT_ERROR", error: remoteResult.message });
					return;
				}

				if (params.credentials) {
					const credResult = await bridge.gitSaveCredentials({
						projectDir,
						url: params.url,
						username: params.credentials.username,
						password: params.credentials.password,
					});
					if (!credResult.ok) {
						dispatch({
							type: "CONNECT_ERROR",
							error:
								"Failed to save credentials. Remote was configured, but you may need to enter credentials again on next push.",
						});
						return;
					}
				}

				const identityResult = await bridge.gitSetIdentity({
					projectDir,
					userName: params.userName,
					userEmail: params.userEmail,
				});
				if (!identityResult.ok) {
					dispatch({
						type: "CONNECT_ERROR",
						error:
							"Failed to configure Git identity. Remote was configured successfully.",
					});
					return;
				}

				dispatch({ type: "CONNECT_SUCCESS", remoteUrl: params.url });

				const detectResult = await bridge.gitDetectMainBranch({ projectDir });
				if (!detectResult.ok) {
					dispatch({ type: "DETECT_MAIN_BRANCH_ERROR", error: detectResult.message });
					return;
				}

				if (detectResult.branch === null) {
					dispatch({ type: "DETECT_MAIN_BRANCH_NEEDS_INPUT" });
				} else {
					dispatch({
						type: "DETECT_MAIN_BRANCH_SUCCESS",
						branch: detectResult.branch,
					});

					dispatch({ type: "DIVERGENCE_START" });
					const divergenceResult = await bridge.gitHandleDivergence({
						projectDir,
						remoteBranch: detectResult.branch,
					});

					if (!divergenceResult.ok) {
						dispatch({
							type: "DIVERGENCE_ERROR",
							error: divergenceResult.message,
						});

						const ensureResult = await bridge.gitEnsureLocalBranch({
							projectDir,
							branch: detectResult.branch,
						});
						if (!ensureResult.ok) {
							dispatch({
								type: "CONNECT_ERROR",
								error: ensureResult.message,
							});
							return;
						}
					} else {
						dispatch({
							type: "DIVERGENCE_SUCCESS",
							savedBranch: divergenceResult.savedBranch,
							message: divergenceResult.message,
						});
						void checkVisibility(params.url);
						return;
					}
				}

				void checkVisibility(params.url);
			} catch {
				dispatch({
					type: "CONNECT_ERROR",
					error: "Unexpected error during connection.",
				});
			}
		},
		[projectDir, checkVisibility],
	);

	const clearFeedback = useCallback(() => {
		dispatch({ type: "CLEAR_FEEDBACK" });
	}, []);

	const dismissDivergence = useCallback(() => {
		dispatch({ type: "DIVERGENCE_DISMISS" });
	}, []);

	useEffect(() => {
		if (!projectDir) return;
		void loadConfig();
	}, [projectDir, loadConfig]);

	useEffect(() => {
		if (!state.connectSuccess) return;
		const timeoutId = window.setTimeout(() => {
			dispatch({ type: "CLEAR_FEEDBACK" });
		}, 3000);
		return () => window.clearTimeout(timeoutId);
	}, [state.connectSuccess]);

	return {
		state,
		connectToGit,
		connect,
		checkVisibility,
		clearFeedback,
		dismissDivergence,
		detectMainBranch,
		setProtectedBranch,
	};
}
