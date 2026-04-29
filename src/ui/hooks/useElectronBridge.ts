/**
 * src/ui/hooks/useElectronBridge.ts
 *
 * React hook that provides safe access to the Electron IPC bridge.
 *
 * Returns window.agentsFlow if running inside Electron, or a stub
 * implementation that throws descriptive errors if running in a plain
 * browser (e.g., during Storybook or unit tests).
 *
 * Usage:
 *   const bridge = useElectronBridge();
 *   const dir = await bridge.openFolderDialog();
 */

import type { AgentsFlowBridge } from "../../electron/bridge.types.ts";

// ── Runtime detection ──────────────────────────────────────────────────────

function isElectronRenderer(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof (window as Window & typeof globalThis).agentsFlow !== "undefined"
	);
}

// ── Stub for non-Electron environments ────────────────────────────────────

function notAvailable(method: string): never {
	throw new Error(
		`[AgentsFlow] window.agentsFlow.${method}() is not available outside of Electron. ` +
			`Are you running in a plain browser? Preload script may not have loaded.`,
	);
}

const browserStub: AgentsFlowBridge = {
	openFolderDialog: () => notAvailable("openFolderDialog"),
	openFileDialog: () => notAvailable("openFileDialog"),
	selectNewProjectDir: () => notAvailable("selectNewProjectDir"),
	validateNewProjectDir: () => notAvailable("validateNewProjectDir"),
	createProject: () => notAvailable("createProject"),
	loadProject: () => notAvailable("loadProject"),
	validateProject: () => notAvailable("validateProject"),
	repairProject: () => notAvailable("repairProject"),
	saveProject: () => notAvailable("saveProject"),
	exportProject: () => notAvailable("exportProject"),
	getRecentProjects: () => Promise.resolve([]),
	assetListDirs: () => Promise.resolve([]),
	assetListDirContents: () =>
		Promise.resolve({ dirPath: "", files: [], subdirs: [] }),
	assetReadFile: () =>
		Promise.resolve({ success: false, error: "Not in Electron" }),
	assetWriteFile: () => notAvailable("assetWriteFile"),
	assetCreateDir: () => notAvailable("assetCreateDir"),
	assetRename: () => notAvailable("assetRename"),
	assetDelete: () => notAvailable("assetDelete"),
	assetImportFile: () => notAvailable("assetImportFile"),
	assetOpenMdDialog: () => Promise.resolve(null),
	assetMove: () => notAvailable("assetMove"),
	adataGetAdapter: () => notAvailable("adataGetAdapter"),
	adataSetAdapter: () => notAvailable("adataSetAdapter"),
	adataGetOpenCodeConfig: () => notAvailable("adataGetOpenCodeConfig"),
	adataSetOpenCodeConfig: () => notAvailable("adataSetOpenCodeConfig"),
	adataListProfiles: () => notAvailable("adataListProfiles"),
	adataAddProfile: () => notAvailable("adataAddProfile"),
	adataUpdateProfile: () => notAvailable("adataUpdateProfile"),
	adataRemoveProfile: () => notAvailable("adataRemoveProfile"),
	adataReorderProfiles: () => notAvailable("adataReorderProfiles"),
	adataGetPermissions: () => notAvailable("adataGetPermissions"),
	adataSetPermissions: () => notAvailable("adataSetPermissions"),
	adataListSkills: () => notAvailable("adataListSkills"),
	renameAgentFolder: () => notAvailable("renameAgentFolder"),
	selectExportDir: () => notAvailable("selectExportDir"),
	writeExportFile: () => notAvailable("writeExportFile"),
	listSkillsFull: () => notAvailable("listSkillsFull"),
	readAgentProfilesFull: () => notAvailable("readAgentProfilesFull"),
	readAgentAdataRaw: () => notAvailable("readAgentAdataRaw"),
	folderExplorerList: () => notAvailable("folderExplorerList"),
	folderExplorerStat: () => notAvailable("folderExplorerStat"),
	folderExplorerReadChildren: () => notAvailable("folderExplorerReadChildren"),
	exportSkills: () => notAvailable("exportSkills"),
	onSkillConflict: () => undefined,
	offSkillConflict: () => undefined,
	respondSkillConflict: () => undefined,
	exportAgentProfiles: () => notAvailable("exportAgentProfiles"),
	onProfileConflict: () => undefined,
	offProfileConflict: () => undefined,
	respondProfileConflict: () => undefined,
	syncTasks: () => notAvailable("syncTasks"),
	githubFetch: () => notAvailable("githubFetch"),
	cloneRepository: () => notAvailable("cloneRepository"),
	cancelClone: () => notAvailable("cancelClone"),
	validateCloneToken: () => notAvailable("validateCloneToken"),
	saveGitCredentials: () => notAvailable("saveGitCredentials"),
	gitGetConfig: () => notAvailable("gitGetConfig"),
	gitInit: () => notAvailable("gitInit"),
	gitSetRemote: () => notAvailable("gitSetRemote"),
	gitSaveCredentials: () => notAvailable("gitSaveCredentials"),
	gitSetIdentity: () => notAvailable("gitSetIdentity"),
	gitDetectMainBranch: () => notAvailable("gitDetectMainBranch"),
	gitHandleDivergence: () => notAvailable("gitHandleDivergence"),
	onCloneProgress: () => undefined,
	offCloneProgress: () => undefined,
	getGitRemoteOrigin: () => Promise.resolve(null),
	gitListBranches: () => notAvailable("gitListBranches"),
	gitGetRemoteDiff: () => notAvailable("gitGetRemoteDiff"),
	gitFetchAndPull: () => notAvailable("gitFetchAndPull"),
	gitPullBranch: () => notAvailable("gitPullBranch"),
	gitCheckoutBranch: () => notAvailable("gitCheckoutBranch"),
	gitEnsureLocalBranch: () => notAvailable("gitEnsureLocalBranch"),
	gitGetBranchCommits: () => notAvailable("gitGetBranchCommits"),
	gitCreateBranch: () => notAvailable("gitCreateBranch"),
	gitGetStatus: () => notAvailable("gitGetStatus"),
	gitAddAndCommit: () => notAvailable("gitAddAndCommit"),
};

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Returns the Electron IPC bridge (window.agentsFlow).
 * Falls back to a stub in non-Electron environments.
 */
export function useElectronBridge(): AgentsFlowBridge {
	if (isElectronRenderer()) {
		return window.agentsFlow;
	}
	return browserStub;
}

/**
 * Returns true if the app is running inside Electron with the bridge available.
 * Useful for conditionally rendering features that require native APIs.
 */
export function useIsElectron(): boolean {
	return isElectronRenderer();
}
