/**
 * src/ui/store/projectStore.ts
 *
 * Zustand store for the loaded AgentFlow project state.
 *
 * This store is the single source of truth for the UI. It holds:
 *   - The current project (serializable model from the IPC bridge)
 *   - The last validation result
 *   - Loading / error states for each async operation
 *
 * ALL mutations to the filesystem happen through the IPC bridge obtained
 * from getBridge() — never via window.agentsFlow directly. This keeps the
 * store safe in non-Electron environments (tests, Storybook).
 *
 * Bridge access pattern:
 *   - getBridge() returns window.agentsFlow in Electron, or a safe stub otherwise.
 *   - The stub returns empty arrays / throws descriptive errors so the UI
 *     degrades gracefully instead of crashing with "Cannot read property of undefined".
 */

import { create } from "zustand";
import type {
	BridgeLoadResult,
	SerializableProjectModel,
	BridgeValidationIssue,
	RecentProject,
	CreateProjectRequest,
	CreateProjectResult,
	NewProjectDirValidation,
} from "../../electron/bridge.types.ts";

// ── Safe bridge accessor ───────────────────────────────────────────────────
// Returns window.agentsFlow if in Electron, or a stub otherwise.
// Defined here (not in useElectronBridge) so the store can use it outside
// a React render cycle.

import type { AgentsFlowBridge } from "../../electron/bridge.types.ts";

function notAvailable(method: string): never {
	throw new Error(
		`[AgentsFlow] window.agentsFlow.${method}() is not available outside of Electron. ` +
			`Preload script may not have run — check contextIsolation + preload config.`,
	);
}

const _stub: AgentsFlowBridge = {
	openFolderDialog: () => notAvailable("openFolderDialog"),
	openFileDialog: () => notAvailable("openFileDialog"),
	selectNewProjectDir: () => notAvailable("selectNewProjectDir"),
	validateNewProjectDir: () => notAvailable("validateNewProjectDir"),
	createProject: () => notAvailable("createProject"),
	loadProject: () => notAvailable("loadProject"),
	validateProject: () => notAvailable("validateProject"),
	repairProject: () => notAvailable("repairProject"),
	saveProject: () => notAvailable("saveProject"),
	saveAgentGraph: () => notAvailable("saveAgentGraph"),
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
	// Adapter / OpenCode (added in adapter feature)
	adataGetAdapter: () => notAvailable("adataGetAdapter"),
	adataSetAdapter: () => notAvailable("adataSetAdapter"),
	adataGetOpenCodeConfig: () => notAvailable("adataGetOpenCodeConfig"),
	adataSetOpenCodeConfig: () => notAvailable("adataSetOpenCodeConfig"),
	// Agent Profiling (Phase 1 infrastructure)
	adataListProfiles: () => notAvailable("adataListProfiles"),
	adataAddProfile: () => notAvailable("adataAddProfile"),
	adataUpdateProfile: () => notAvailable("adataUpdateProfile"),
	adataRemoveProfile: () => notAvailable("adataRemoveProfile"),
	adataReorderProfiles: () => notAvailable("adataReorderProfiles"),
	// Permissions
	adataGetPermissions: () => notAvailable("adataGetPermissions"),
	adataSetPermissions: () => notAvailable("adataSetPermissions"),
	// Skills
	adataListSkills: () => notAvailable("adataListSkills"),
	// Agent rename (slug-first)
	renameAgentFolder: () => notAvailable("renameAgentFolder"),
	// Export modal
	selectExportDir: () => notAvailable("selectExportDir"),
	writeExportFile: () => notAvailable("writeExportFile"),
	listSkillsFull: () => notAvailable("listSkillsFull"),
	readAgentProfilesFull: () => notAvailable("readAgentProfilesFull"),
	readAgentAdataRaw: () => notAvailable("readAgentAdataRaw"),
	// Git remote origin detection
	getGitRemoteOrigin: () => Promise.resolve(null),
	gitListBranches: () => notAvailable("gitListBranches"),
	gitGetRemoteDiff: () => notAvailable("gitGetRemoteDiff"),
	gitFetchAndPull: () => notAvailable("gitFetchAndPull"),
	gitPullBranch: () => notAvailable("gitPullBranch"),
	gitCheckoutBranch: () => notAvailable("gitCheckoutBranch"),
	gitGetBranchCommits: () => notAvailable("gitGetBranchCommits"),
};

function getBridge(): AgentsFlowBridge {
	if (
		typeof window !== "undefined" &&
		typeof (window as Window & typeof globalThis).agentsFlow !== "undefined"
	) {
		return window.agentsFlow;
	}
	return _stub;
}

// ── View routing ───────────────────────────────────────────────────────────

export type AppView =
	| "browser" // Project browser (open/create project)
	| "validation" // Validation panel (errors/warnings)
	| "editor" // Canvas editor (agents list + placeholder canvas)
	| "assets"; // Asset panel (markdown file manager)

// ── Store state ────────────────────────────────────────────────────────────

export interface ProjectState {
	// ── Current view ────────────────────────────────────────────────────────
	currentView: AppView;

	// ── Project data ─────────────────────────────────────────────────────────
	/** The currently loaded project, or null if no project is open */
	project: SerializableProjectModel | null;

	/** Last load result — kept even after success for issue reporting */
	lastLoadResult: BridgeLoadResult | null;

	/** Last standalone validation result (from validateProject) */
	lastValidationResult: BridgeLoadResult | null;

	// ── Git remote origin ─────────────────────────────────────────────────────
	/**
	 * URL of the remote `origin` for the current project's Git repository.
	 * `null` when the project has no `.git`, no `origin` remote, or git is
	 * unavailable. Populated asynchronously after `openProject` succeeds.
	 */
	gitRemoteOrigin: string | null;

	// ── Recent projects ──────────────────────────────────────────────────────
	recentProjects: RecentProject[];

	// ── Async state ──────────────────────────────────────────────────────────
	isLoading: boolean;
	isValidating: boolean;
	isSaving: boolean;
	isExporting: boolean;
	isRepairing: boolean;

	/** Last error message from any async operation */
	lastError: string | null;
}

// ── Store actions ──────────────────────────────────────────────────────────

export interface ProjectActions {
	// ── View navigation ──────────────────────────────────────────────────────
	navigate(view: AppView): void;

	// ── Open a project via the native folder picker ──────────────────────────
	openProjectDialog(): Promise<void>;

	// ── Open a native folder-picker dialog for NEW project creation ──────────
	// Returns the chosen directory path, or null if the user cancelled.
	selectNewProjectDir(): Promise<string | null>;

	// ── Open a project from a known directory path ───────────────────────────
	openProject(projectDir: string): Promise<void>;

	// ── Validate a candidate directory for new project creation (no writes) ──
	validateNewProjectDir(dir: string): Promise<NewProjectDirValidation | null>;

	// ── Create a new project scaffold, then open it ──────────────────────────
	createProject(req: CreateProjectRequest): Promise<CreateProjectResult>;

	// ── Validate a project (dry-run — does NOT load it into memory) ──────────
	validateProject(projectDir: string): Promise<void>;

	// ── Apply repairs to a project and reload ────────────────────────────────
	repairAndReload(projectDir: string): Promise<void>;

	// ── Save the current project's top-level fields to disk ──────────────────
	saveProject(updates: {
		name?: string;
		description?: string;
		properties?: Record<string, unknown>;
	}): Promise<void>;

	// ── Export the current project as a JSON archive ─────────────────────────
	exportProject(): Promise<void>;

	// ── Load the list of recently opened projects ────────────────────────────
	loadRecentProjects(): Promise<void>;

	// ── Close the current project and return to the browser ──────────────────
	closeProject(): void;

	// ── Open a cloned project, prompting if another project is already open ──
	openProjectAfterClone(clonedPath: string): Promise<void>;

	// ── Clear the last error ─────────────────────────────────────────────────
	clearError(): void;
}

// ── Store type ─────────────────────────────────────────────────────────────

export type ProjectStore = ProjectState & ProjectActions;

// ── Initial state ──────────────────────────────────────────────────────────

const initialState: ProjectState = {
	currentView: "browser",
	project: null,
	lastLoadResult: null,
	lastValidationResult: null,
	gitRemoteOrigin: null,
	recentProjects: [],
	isLoading: false,
	isValidating: false,
	isSaving: false,
	isExporting: false,
	isRepairing: false,
	lastError: null,
};

// ── Store implementation ───────────────────────────────────────────────────

export const useProjectStore = create<ProjectStore>((set, get) => ({
	...initialState,

	// ── View navigation ────────────────────────────────────────────────────

	navigate(view) {
		set({ currentView: view });
	},

	// ── Open project via dialog ────────────────────────────────────────────

	async openProjectDialog() {
		// Guard: do not open a second dialog if already loading/validating
		if (get().isLoading || get().isValidating) return;

		set({ isLoading: true, lastError: null });

		const bridge = getBridge();
		let projectDir: string | null = null;

		try {
			projectDir = await bridge.openFolderDialog();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			set({ isLoading: false, lastError: message });
			return;
		}

		if (!projectDir) {
			// User cancelled the dialog — reset loading state
			set({ isLoading: false });
			return;
		}

		// openProject will handle its own isLoading lifecycle from here
		set({ isLoading: false });
		await get().openProject(projectDir);
	},

	// ── Open native folder-picker dialog for NEW project creation ─────────

	async selectNewProjectDir(): Promise<string | null> {
		const bridge = getBridge();
		try {
			const dir = await bridge.selectNewProjectDir();
			return dir ?? null;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			set({ lastError: message });
			return null;
		}
	},

	// ── Validate new project directory ────────────────────────────────────

	async validateNewProjectDir(
		dir: string,
	): Promise<NewProjectDirValidation | null> {
		try {
			const bridge = getBridge();
			return await bridge.validateNewProjectDir(dir);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			set({ lastError: message });
			return null;
		}
	},

	// ── Create new project ─────────────────────────────────────────────────
	// 1. Call bridge.createProject (main process: validate + scaffold + rollback)
	// 2. On success, load the new project and navigate to the editor

	async createProject(req: CreateProjectRequest): Promise<CreateProjectResult> {
		set({ isLoading: true, lastError: null });

		try {
			const bridge = getBridge();
			const createResult = await bridge.createProject(req);

			if (!createResult.success || !createResult.projectDir) {
				set({
					isLoading: false,
					lastError: createResult.error ?? "Failed to create project.",
				});
				return createResult;
			}

			// Project scaffold created — now load it into state
			const loadResult = await bridge.loadProject({
				projectDir: createResult.projectDir,
			});

			set({
				lastLoadResult: loadResult,
				lastValidationResult: null,
				isLoading: false,
			});

			if (loadResult.success && loadResult.project) {
				set({
					project: loadResult.project,
					currentView: "editor",
				});
			} else {
				// Created but failed to load (shouldn't happen with a fresh scaffold)
				set({
					project: null,
					currentView: "validation",
					lastError:
						"Project was created but could not be loaded. See the validation panel.",
				});
			}

			return createResult;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			set({ isLoading: false, lastError: message });
			return { success: false, error: message, errorCode: "IO_ERROR" };
		}
	},

	// ── Open project from path ─────────────────────────────────────────────

	async openProject(projectDir) {
		// Clear git badge immediately so the UI never shows a stale remote
		// from a previously opened project while this load is in flight.
		set({ isLoading: true, lastError: null, gitRemoteOrigin: null });

		try {
			const bridge = getBridge();
			const result = await bridge.loadProject({ projectDir });

			set({
				lastLoadResult: result,
				lastValidationResult: null, // Clear stale validation result on fresh load
				isLoading: false,
			});

			if (result.success && result.project) {
				// Load succeeded — navigate to editor (with optional warnings badge)
				set({
					project: result.project,
					currentView: result.issues.length > 0 ? "validation" : "editor",
				});

				// Detect Git remote origin in background — never blocks the UI.
				// `requestedDir` is captured in the closure so that if the user
				// switches to another project before this promise settles, the
				// stale response is silently discarded (race-condition guard).
				const requestedDir = projectDir;
				bridge
					.getGitRemoteOrigin(projectDir)
					.then((remoteUrl) => {
						// Only apply if the active project is still the one we queried.
						const activeProject = get().project;
						if (activeProject?.projectDir === requestedDir) {
							set({ gitRemoteOrigin: remoteUrl ?? null });
						}
					})
					.catch(() => {
						const activeProject = get().project;
						if (activeProject?.projectDir === requestedDir) {
							set({ gitRemoteOrigin: null });
						}
					});
			} else {
				// Load failed — show validation view with error list
				set({
					project: null,
					currentView: "validation",
					lastError:
						result.summary.errors > 0
							? `Project has ${result.summary.errors} blocking error(s). See the validation panel.`
							: "Project could not be loaded. See the validation panel for details.",
				});
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			set({
				isLoading: false,
				lastError: message,
				project: null,
			});
		}
	},

	// ── Validate project (dry-run) ─────────────────────────────────────────

	async validateProject(projectDir) {
		set({ isValidating: true, lastError: null });

		try {
			const bridge = getBridge();
			const result = await bridge.validateProject({ projectDir });

			set({
				lastValidationResult: result,
				isValidating: false,
				currentView: "validation",
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			set({ isValidating: false, lastError: message });
		}
	},

	// ── Repair and reload project ──────────────────────────────────────────
	// Uses the dedicated repairProject IPC channel (mode: "repair" on main process).
	// Applies all auto-fixes and reloads the model. Called from ValidationPanel.

	async repairAndReload(projectDir) {
		set({ isRepairing: true, lastError: null });

		try {
			const bridge = getBridge();
			const result = await bridge.repairProject({ projectDir });

			set({
				lastLoadResult: result,
				lastValidationResult: null,
				isRepairing: false,
			});

			if (result.success && result.project) {
				set({
					project: result.project,
					currentView: result.issues.length > 0 ? "validation" : "editor",
				});
			} else {
				set({
					project: null,
					currentView: "validation",
					lastError: `Repair completed but ${result.summary.errors} error(s) remain. Manual fix required.`,
				});
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			set({ isRepairing: false, lastError: message });
		}
	},

	// ── Save project ────────────────────────────────────────────────────────

	async saveProject(updates) {
		const { project } = get();
		if (!project) return;

		set({ isSaving: true, lastError: null });

		try {
			const bridge = getBridge();
			const result = await bridge.saveProject({
				projectDir: project.projectDir,
				updates,
			});

			if (result.success) {
				// Optimistically update local state to reflect saved changes
				set({
					project: {
						...project,
						...(updates.name !== undefined ? { name: updates.name } : {}),
						...(updates.description !== undefined
							? { description: updates.description }
							: {}),
						...(updates.properties !== undefined
							? { properties: updates.properties }
							: {}),
					},
					isSaving: false,
				});
			} else {
				set({ isSaving: false, lastError: result.error ?? "Save failed." });
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			set({ isSaving: false, lastError: message });
		}
	},

	// ── Export project ──────────────────────────────────────────────────────

	async exportProject() {
		const { project } = get();
		if (!project) return;

		set({ isExporting: true, lastError: null });

		try {
			const bridge = getBridge();
			// Omit destinationPath — the main process will open a native Save dialog
			const result = await bridge.exportProject({
				projectDir: project.projectDir,
			});

			if (!result.success) {
				set({ lastError: result.error ?? "Export failed." });
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			set({ lastError: message });
		} finally {
			set({ isExporting: false });
		}
	},

	// ── Load recent projects ────────────────────────────────────────────────

	async loadRecentProjects() {
		try {
			const bridge = getBridge();
			const recents = await bridge.getRecentProjects();
			set({ recentProjects: recents });
		} catch {
			// Non-critical — don't set lastError for this
		}
	},

	// ── Close project ────────────────────────────────────────────────────────

	closeProject() {
		set({
			project: null,
			lastLoadResult: null,
			lastValidationResult: null,
			gitRemoteOrigin: null,
			currentView: "browser",
			lastError: null,
		});
	},

	// ── Open project after clone (with confirmation if project is open) ──────

	async openProjectAfterClone(clonedPath: string) {
		const { project } = get();

		if (project !== null) {
			const confirmed = window.confirm(
				"A project is already open. Close it and open the cloned project?",
			);
			if (!confirmed) return;
		}

		await get().openProject(clonedPath);
	},

	// ── Clear error ─────────────────────────────────────────────────────────

	clearError() {
		set({ lastError: null });
	},
}));

// ── Selectors ──────────────────────────────────────────────────────────────

/** Returns all issues from the last load or validation result, or [] */
export function selectAllIssues(store: ProjectState): BridgeValidationIssue[] {
	const result = store.lastValidationResult ?? store.lastLoadResult;
	return result?.issues ?? [];
}

/** Returns only error-severity issues */
export function selectErrors(store: ProjectState): BridgeValidationIssue[] {
	return selectAllIssues(store).filter((i) => i.severity === "error");
}

/** Returns only warning-severity issues */
export function selectWarnings(store: ProjectState): BridgeValidationIssue[] {
	return selectAllIssues(store).filter((i) => i.severity === "warning");
}

/** Returns only info-severity issues */
export function selectInfos(store: ProjectState): BridgeValidationIssue[] {
	return selectAllIssues(store).filter((i) => i.severity === "info");
}
