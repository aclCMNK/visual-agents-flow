/**
 * src/electron/preload.ts
 *
 * Electron preload script — runs in the renderer process BEFORE any page
 * JavaScript, with full Node.js access. It is the ONLY file that bridges
 * the main process (Node/Electron) and the renderer (browser/React).
 *
 * Security configuration:
 *   - contextIsolation: true   → renderer cannot access Node APIs directly
 *   - nodeIntegration: false   → renderer cannot require() Node modules
 *   - sandbox: false           → preload can use Node APIs (needed for IPC)
 *
 * This file uses contextBridge.exposeInMainWorld() to expose two safe,
 * typed APIs to the renderer:
 *   - window.agentsFlow    — main app bridge (all project/asset/adata IPC)
 *   - window.folderExplorer — home-sandboxed directory browser bridge
 *
 * Every function maps directly to a named IPC channel — no raw
 * ipcRenderer.send() is exposed. Only plain, serializable values cross the
 * bridge (no functions, no DOM references).
 *
 * ── Build & tooling notes ──────────────────────────────────────────────────
 *
 * VITE (vite-plugin-electron/simple):
 *   - Entry: src/electron/preload.ts → vite.config.ts `preload.input`
 *   - Output: dist/electron/preload.cjs (forced CJS via entryFileNames:"[name].cjs")
 *   - WHY CJS: Electron preload runs in a Node context where package.json
 *     "type":"module" would normally pick ESM, but preload MUST be CJS because
 *     Electron loads it with require() internally before running the page.
 *     The .cjs extension overrides the "type":"module" field — safe on all platforms.
 *   - WHY entryFileNames: without this, Rollup emits preload.js which is treated
 *     as ESM (because package.json has "type":"module"), causing
 *     "require is not defined in ES module scope" at runtime.
 *
 * MAIN PROCESS (main.ts):
 *   - Resolves preload via: path.join(__dirname, "preload.cjs")
 *   - __dirname in dist/electron/main.js points to dist/electron/
 *   - Therefore preload path = dist/electron/preload.cjs ✓
 *
 * ELECTRON-BUILDER:
 *   - Package.json `build.files` includes "dist/electron/**" — covers preload.cjs.
 *   - No extra copy step needed; builder packs the full dist/electron/ tree.
 *   - Gotcha: if you rename the preload output file, update main.ts AND
 *     electron-builder config simultaneously.
 *
 * DEV MODE (vite dev):
 *   - vite-plugin-electron rebuilds the preload on every file change.
 *   - The preload is served from the in-memory Vite dev server, not from disk.
 *   - Gotcha: if a renderer component calls window.folderExplorer before the
 *     preload has loaded (very early render), hasBridge() returns false and
 *     you see "E_BRIDGE" errors. Add a small delay or wait for DOMContentLoaded.
 *
 * GOTCHAS:
 *   - contextBridge.exposeInMainWorld() can only be called once per key.
 *     Calling it twice with the same key throws at runtime.
 *     → Both window.agentsFlow and window.folderExplorer are exposed here in
 *       the SAME preload — not in separate preload files.
 *   - Electron requires the preload to be a LOCAL file path (not a URL).
 *     In dev mode vite-plugin-electron writes the compiled preload to disk
 *     before launching Electron — the path in main.ts always points to disk.
 *   - Structured-clone serialisation: only plain objects/arrays/primitives
 *     survive the bridge. Never pass class instances, Maps, Sets, or functions.
 */

import os from "os";
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./bridge.types.ts";
import type {
	AgentsFlowBridge,
	LoadProjectRequest,
	ValidateProjectRequest,
	RepairProjectRequest,
	SaveProjectRequest,
	SaveAgentGraphRequest,
	ExportProjectRequest,
	CreateProjectRequest,
	AssetDirContents,
	AssetReadResult,
	AssetOpResult,
	AssetDirEntry,
	AssetMovePayload,
	AssetMoveResult,
	AdataAdapterRequest,
	AdataSetAdapterRequest,
	AdataGetOpenCodeConfigRequest,
	AdataSetOpenCodeConfigRequest,
	AdataListProfilesRequest,
	AdataAddProfileRequest,
	AdataUpdateProfileRequest,
	AdataRemoveProfileRequest,
	AdataReorderProfilesRequest,
	AdataGetPermissionsRequest,
	AdataSetPermissionsRequest,
	AdataListSkillsRequest,
	RenameAgentFolderRequest,
	WriteExportFileRequest,
	ListSkillsFullRequest,
	ReadAgentProfilesFullRequest,
	ReadAgentAdataRawRequest,
	ExportSkillsRequest,
	ExportSkillsConflictPrompt,
	ExportSkillsConflictResponse,
	ExportAgentProfilesRequest,
	ExportProfileConflictPrompt,
	ExportProfileConflictResponse,
	SyncTasksRequest,
	CloneRepositoryRequest,
	CloneCancelRequest,
	CloneValidateRequest,
	SaveGitCredentialsRequest,
	CloneProgressEvent,
	GitHubFetchRequest,
	// ── Folder Explorer ───────────────────────────────────────────────────────
	FolderExplorerListRequest,
	FolderExplorerStatRequest,
	FolderExplorerReadChildrenRequest,
} from "./bridge.types.ts";

// ── Diagnostic log — fires as soon as the preload module is evaluated ─────
//
// If you do NOT see this line in DevTools console, the preload is not being
// loaded at all (check main.ts preloadPath + existsSync warning output).
console.log(
	"[preload] module evaluated — contextIsolation:true, nodeIntegration:false, sandbox:false",
);

// ── Bridge implementation ─────────────────────────────────────────────────

const bridge: AgentsFlowBridge = {
	// ── Dialogs ─────────────────────────────────────────────────────────────

	openFolderDialog() {
		return ipcRenderer.invoke(IPC_CHANNELS.OPEN_FOLDER_DIALOG);
	},

	openFileDialog(options) {
		return ipcRenderer.invoke(IPC_CHANNELS.OPEN_FILE_DIALOG, options ?? {});
	},

	// ── New project creation ─────────────────────────────────────────────────

	selectNewProjectDir() {
		return ipcRenderer.invoke(IPC_CHANNELS.SELECT_NEW_PROJECT_DIR);
	},

	validateNewProjectDir(dir: string) {
		return ipcRenderer.invoke(IPC_CHANNELS.VALIDATE_NEW_PROJECT_DIR, dir);
	},

	createProject(req: CreateProjectRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.CREATE_PROJECT, req);
	},

	// ── Project operations ───────────────────────────────────────────────────

	loadProject(req: LoadProjectRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.LOAD_PROJECT, req);
	},

	validateProject(req: ValidateProjectRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.VALIDATE_PROJECT, req);
	},

	repairProject(req: RepairProjectRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.REPAIR_PROJECT, req);
	},

	saveProject(req: SaveProjectRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.SAVE_PROJECT, req);
	},

	saveAgentGraph(req: SaveAgentGraphRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.SAVE_AGENT_GRAPH, req);
	},

	exportProject(req: ExportProjectRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.EXPORT_PROJECT, req);
	},

	// ── Recents ──────────────────────────────────────────────────────────────

	getRecentProjects() {
		return ipcRenderer.invoke(IPC_CHANNELS.GET_RECENT_PROJECTS);
	},

	// ── Asset panel ───────────────────────────────────────────────────────────

	assetListDirs(dirPath: string): Promise<AssetDirEntry[]> {
		return ipcRenderer.invoke(IPC_CHANNELS.ASSET_LIST_DIRS, dirPath);
	},

	assetListDirContents(dirPath: string): Promise<AssetDirContents> {
		return ipcRenderer.invoke(IPC_CHANNELS.ASSET_LIST_DIR_CONTENTS, dirPath);
	},

	assetReadFile(filePath: string): Promise<AssetReadResult> {
		return ipcRenderer.invoke(IPC_CHANNELS.ASSET_READ_FILE, filePath);
	},

	assetWriteFile(filePath: string, content: string): Promise<AssetOpResult> {
		return ipcRenderer.invoke(IPC_CHANNELS.ASSET_WRITE_FILE, filePath, content);
	},

	assetCreateDir(dirPath: string): Promise<AssetOpResult> {
		return ipcRenderer.invoke(IPC_CHANNELS.ASSET_CREATE_DIR, dirPath);
	},

	assetRename(oldPath: string, newPath: string): Promise<AssetOpResult> {
		return ipcRenderer.invoke(IPC_CHANNELS.ASSET_RENAME, oldPath, newPath);
	},

	assetDelete(targetPath: string): Promise<AssetOpResult> {
		return ipcRenderer.invoke(IPC_CHANNELS.ASSET_DELETE, targetPath);
	},

	assetImportFile(srcPath: string, destDir: string): Promise<AssetOpResult> {
		return ipcRenderer.invoke(IPC_CHANNELS.ASSET_IMPORT_FILE, srcPath, destDir);
	},

	assetOpenMdDialog(): Promise<string | null> {
		return ipcRenderer.invoke(IPC_CHANNELS.ASSET_OPEN_MD_DIALOG);
	},

	assetMove(payload: AssetMovePayload): Promise<AssetMoveResult> {
		return ipcRenderer.invoke(IPC_CHANNELS.ASSET_MOVE, payload);
	},

	// ── Adapter field ────────────────────────────────────────────────────────

	adataGetAdapter(req: AdataAdapterRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.ADATA_GET_ADAPTER, req);
	},

	adataSetAdapter(req: AdataSetAdapterRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.ADATA_SET_ADAPTER, req);
	},

	// ── OpenCode config ───────────────────────────────────────────────────────

	adataGetOpenCodeConfig(req: AdataGetOpenCodeConfigRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.ADATA_GET_OPENCODE_CONFIG, req);
	},

	adataSetOpenCodeConfig(req: AdataSetOpenCodeConfigRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.ADATA_SET_OPENCODE_CONFIG, req);
	},

	// ── Agent Profiling ───────────────────────────────────────────────────────

	adataListProfiles(req: AdataListProfilesRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.ADATA_LIST_PROFILES, req);
	},

	adataAddProfile(req: AdataAddProfileRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.ADATA_ADD_PROFILE, req);
	},

	adataUpdateProfile(req: AdataUpdateProfileRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.ADATA_UPDATE_PROFILE, req);
	},

	adataRemoveProfile(req: AdataRemoveProfileRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.ADATA_REMOVE_PROFILE, req);
	},

	adataReorderProfiles(req: AdataReorderProfilesRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.ADATA_REORDER_PROFILES, req);
	},

	// ── Permissions ───────────────────────────────────────────────────────────

	adataGetPermissions(req: AdataGetPermissionsRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.ADATA_GET_PERMISSIONS, req);
	},

	adataSetPermissions(req: AdataSetPermissionsRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.ADATA_SET_PERMISSIONS, req);
	},

	// ── Skills ────────────────────────────────────────────────────────────────

	adataListSkills(req: AdataListSkillsRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.ADATA_LIST_SKILLS, req);
	},

	// ── Agent rename (slug-first) ─────────────────────────────────────────────

	renameAgentFolder(req: RenameAgentFolderRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.RENAME_AGENT_FOLDER, req);
	},

	// ── Export modal ──────────────────────────────────────────────────────────

	selectExportDir() {
		return ipcRenderer.invoke(IPC_CHANNELS.SELECT_EXPORT_DIR);
	},

	writeExportFile(req: WriteExportFileRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.WRITE_EXPORT_FILE, req);
	},

	listSkillsFull(req: ListSkillsFullRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.LIST_SKILLS_FULL, req);
	},

	readAgentProfilesFull(req: ReadAgentProfilesFullRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.READ_AGENT_PROFILES_FULL, req);
	},

	readAgentAdataRaw(req: ReadAgentAdataRawRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.READ_AGENT_ADATA_RAW, req);
	},

	// ── Folder Explorer ───────────────────────────────────────────────────────
	//
	// Three channels that expose the home-sandboxed directory browser to the
	// renderer. All validation is performed in the main process — the preload
	// simply forwards the payload and returns the typed response.
	//
	// Usage in renderer:
	//   const res = await window.agentsFlow.folderExplorerList({ path: "/home/user/projects" });
	//   if (res.ok) console.log(res.entries);
	//   else        console.error(res.code, res.message);

	folderExplorerList(req: FolderExplorerListRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_EXPLORER_LIST, req);
	},

	folderExplorerStat(req: FolderExplorerStatRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_EXPLORER_STAT, req);
	},

	folderExplorerReadChildren(req: FolderExplorerReadChildrenRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_EXPLORER_READ_CHILDREN, req);
	},

	// ── Skills export ─────────────────────────────────────────────────────────
	//
	// exportSkills invokes the main process to copy active skill directories.
	// onSkillConflict / offSkillConflict register/remove the SKILL_CONFLICT_PROMPT
	// listener. respondSkillConflict sends the user's choice back to main.
	//
	// Usage pattern (in ExportModal or App.tsx):
	//
	//   bridge.onSkillConflict((prompt) => {
	//     // show dialog, then:
	//     bridge.respondSkillConflict({ promptId: prompt.promptId, action: "replace" });
	//   });
	//
	//   const result = await bridge.exportSkills({ projectDir, destDir });
	//
	//   bridge.offSkillConflict();

	exportSkills(req: ExportSkillsRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.EXPORT_SKILLS, req);
	},

	onSkillConflict(callback: (prompt: ExportSkillsConflictPrompt) => void) {
		// Remove any existing listener first to avoid duplicates
		ipcRenderer.removeAllListeners(IPC_CHANNELS.SKILL_CONFLICT_PROMPT);
		ipcRenderer.on(
			IPC_CHANNELS.SKILL_CONFLICT_PROMPT,
			(_event, prompt: ExportSkillsConflictPrompt) => {
				callback(prompt);
			},
		);
	},

	offSkillConflict() {
		ipcRenderer.removeAllListeners(IPC_CHANNELS.SKILL_CONFLICT_PROMPT);
	},

	respondSkillConflict(response: ExportSkillsConflictResponse) {
		ipcRenderer.send(IPC_CHANNELS.SKILL_CONFLICT_RESPONSE, response);
	},

	// ── Agent Profile Export ────────────────────────────────────────────────
	// exportAgentProfiles invokes the main process to export profiles from
	// metadata/*.adata files to [destDir]/prompts/[projectName]/[agentName].md.
	// onProfileConflict / offProfileConflict register/remove the PROFILE_CONFLICT_PROMPT
	// listener. respondProfileConflict sends the user's choice back to main.
	//
	// Usage pattern (in ExportModal):
	//
	//   bridge.onProfileConflict((prompt) => {
	//     // show dialog, then:
	//     bridge.respondProfileConflict({ promptId: prompt.promptId, action: "replace" });
	//   });
	//
	//   const result = await bridge.exportAgentProfiles({ projectDir, destDir });
	//
	//   bridge.offProfileConflict();

	exportAgentProfiles(req: ExportAgentProfilesRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.EXPORT_AGENT_PROFILES, req);
	},

	onProfileConflict(callback: (prompt: ExportProfileConflictPrompt) => void) {
		// Remove any existing listener first to avoid duplicates
		ipcRenderer.removeAllListeners(IPC_CHANNELS.PROFILE_CONFLICT_PROMPT);
		ipcRenderer.on(
			IPC_CHANNELS.PROFILE_CONFLICT_PROMPT,
			(_event, prompt: ExportProfileConflictPrompt) => {
				callback(prompt);
			},
		);
	},

	offProfileConflict() {
		ipcRenderer.removeAllListeners(IPC_CHANNELS.PROFILE_CONFLICT_PROMPT);
	},

	respondProfileConflict(response: ExportProfileConflictResponse) {
		ipcRenderer.send(IPC_CHANNELS.PROFILE_CONFLICT_RESPONSE, response);
	},

	// ── Sync Tasks ─────────────────────────────────────────────────────────────
	//
	// Bulk-writes permissions.task for delegator agents.
	// Renderer passes a list of { agentId, taskAgentIds[] } entries.
	// Returns { updated, errors[] }.

	syncTasks(req: SyncTasksRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.SYNC_TASKS, req);
	},

	// ── GitHub HTTP fetch ──────────────────────────────────────────────────────
	//
	// Proxies HTTPS GET requests to api.github.com through the main process.
	// The renderer cannot call fetch("https://api.github.com/...") directly
	// because the CSP connect-src directive restricts external origins in the
	// Chromium renderer. This method delegates the network call to Node.js
	// (main process), which is not subject to CSP.
	//
	// Only "https://api.github.com/*" URLs are accepted — all others are
	// rejected by the main process with errorCode "INVALID_URL".

	githubFetch(req: GitHubFetchRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.GITHUB_FETCH, req);
	},

	// ── Git Clone ──────────────────────────────────────────────────────────────

	cloneRepository(req: CloneRepositoryRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.GIT_CLONE, req);
	},

	cancelClone(req: CloneCancelRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.GIT_CLONE_CANCEL, req);
	},

	validateCloneToken(req: CloneValidateRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.GIT_CLONE_VALIDATE, req);
	},

	saveGitCredentials(req: SaveGitCredentialsRequest) {
		return ipcRenderer.invoke(IPC_CHANNELS.GIT_SAVE_CREDENTIALS, req);
	},

	onCloneProgress(callback: (event: CloneProgressEvent) => void) {
		ipcRenderer.removeAllListeners(IPC_CHANNELS.GIT_CLONE_PROGRESS);
		ipcRenderer.on(
			IPC_CHANNELS.GIT_CLONE_PROGRESS,
			(_event, progressEvent: CloneProgressEvent) => {
				callback(progressEvent);
			},
		);
	},

	offCloneProgress() {
		ipcRenderer.removeAllListeners(IPC_CHANNELS.GIT_CLONE_PROGRESS);
	},

	// ── Git remote origin detection ────────────────────────────────────────────

	getGitRemoteOrigin(projectDir: string): Promise<string | null> {
		return ipcRenderer.invoke(IPC_CHANNELS.GET_GIT_REMOTE_ORIGIN, projectDir);
	},
};

// ── Expose on window.agentsFlow ───────────────────────────────────────────

contextBridge.exposeInMainWorld("agentsFlow", bridge);

console.log("[preload] window.agentsFlow exposed — all IPC channels ready");

// ── window.folderExplorer bridge ──────────────────────────────────────────
//
// The FolderExplorer React component (src/renderer/components/FolderExplorer/)
// and its IPC service (src/renderer/services/ipc.ts) call:
//
//   window.folderExplorer.list(path, options?)
//   window.folderExplorer.stat(path)
//   window.folderExplorer.readChildren(paths[], options?)
//
// These are intentionally different from the agentsFlow.folderExplorer*
// methods above (which take request-object payloads). The renderer-facing API
// uses positional arguments for ergonomics; the IPC payload is built here.
//
// Both sets of methods invoke the same IPC channels:
//   "folder-explorer:list"          (FOLDER_EXPLORER_LIST)
//   "folder-explorer:stat"          (FOLDER_EXPLORER_STAT)
//   "folder-explorer:read-children" (FOLDER_EXPLORER_READ_CHILDREN)
//
// Gotcha: contextBridge.exposeInMainWorld can only be called once per key.
// Adding a second exposeInMainWorld("folderExplorer", ...) call in another
// preload file would throw. Everything MUST live in this single preload.

contextBridge.exposeInMainWorld("folderExplorer", {
	/**
	 * Lists visible entries of a directory inside $HOME.
	 * @param path    - Absolute path validated server-side (jail: $HOME).
	 * @param options - Optional filter overrides (showHidden, directoriesOnly…).
	 */
	list(path: string, options?: Record<string, unknown>) {
		return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_EXPLORER_LIST, {
			path,
			options,
		});
	},

	/**
	 * Returns lightweight metadata for a single path inside $HOME.
	 * Returns { ok: true, stat: { exists: false } } for non-existent paths
	 * that are inside HOME — never throws for "path not found" queries.
	 * @param path - Absolute path inside $HOME.
	 */
	stat(path: string) {
		return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_EXPLORER_STAT, { path });
	},

	/**
	 * Batch-lists multiple directories in parallel.
	 * Partial failures are per-entry; one bad path does not fail the whole batch.
	 * @param paths   - Array of absolute paths inside $HOME.
	 * @param options - Filter options applied to ALL paths.
	 */
	readChildren(paths: string[], options?: Record<string, unknown>) {
		return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_EXPLORER_READ_CHILDREN, {
			paths,
			options,
		});
	},
});

console.log(
	"[preload] window.folderExplorer exposed — scanning bridge availability:",
	typeof (globalThis as Record<string, unknown>)["folderExplorer"] !==
		"undefined"
		? "OK (folderExplorer found on globalThis — expected in preload scope)"
		: "PENDING (will be visible on window after contextBridge resolves in renderer)",
);

// ── window.appPaths — static OS paths resolved in the Node/Electron context ─
//
// Exposes platform-agnostic paths that the renderer needs but cannot compute
// itself (contextIsolation: true means no direct access to Node's `os` module).
//
// Currently:
//   window.appPaths.home  → os.homedir()   (e.g. /home/user, C:\Users\User, /Users/user)
//
// Why expose it here instead of via IPC:
//   These values are static for the process lifetime and tiny — there is no need
//   to pay an async IPC round-trip every time a component needs HOME.
//   contextBridge.exposeInMainWorld() is synchronous and evaluated before any
//   renderer code runs, so window.appPaths is always available immediately.
//
// Gotcha: os.homedir() is only available in the preload's Node context.
//   Never import 'os' in renderer files — it will throw at runtime because
//   nodeIntegration is false. Always read the value through window.appPaths.home.

contextBridge.exposeInMainWorld("appPaths", {
	/**
	 * The current user's home directory, resolved cross-platform via os.homedir().
	 *
	 * Examples:
	 *   Linux / macOS : "/home/kamiloid"  /  "/Users/kamiloid"
	 *   Windows       : "C:\\Users\\kamiloid"
	 *
	 * Use this as the fallback initial path for the FolderExplorer instead of
	 * hardcoding "/home/<username>/" — which breaks on every other platform/user.
	 */
	home: os.homedir(),
});

console.log(`[preload] window.appPaths exposed — home: ${os.homedir()}`);
