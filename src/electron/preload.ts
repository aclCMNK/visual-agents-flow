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
 * This file uses contextBridge.exposeInMainWorld() to expose a safe,
 * typed API (window.agentsFlow) to the renderer. Every function maps
 * directly to a named IPC channel — no raw ipcRenderer.send() is exposed.
 *
 * Only plain, serializable values cross the bridge (no functions, no DOM
 * references). This is enforced by the bridge.types.ts contracts.
 */

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
} from "./bridge.types.ts";

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
};

// ── Expose on window.agentsFlow ───────────────────────────────────────────

contextBridge.exposeInMainWorld("agentsFlow", bridge);

console.log("[preload] window.agentsFlow bridge exposed — IPC channels ready");
