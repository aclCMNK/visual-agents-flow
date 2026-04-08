/**
 * src/electron/bridge.types.ts
 *
 * TypeScript contracts for the IPC bridge between the Electron main process
 * and the React renderer. These types are shared by:
 *
 *   - src/electron/preload.ts       (exposes the API on window.agentsFlow)
 *   - src/electron/ipc-handlers.ts  (implements the handlers in main)
 *   - src/ui/hooks/useElectronBridge.ts (consumes the API in React)
 *
 * IMPORTANT: These types must only reference plain, serializable values —
 * no Map, no Set, no class instances. The IPC channel serializes via
 * structured clone, so non-plain objects are dropped silently.
 */

import type { LoaderOptions } from "../loader/types.ts";

// ── Serializable project model subset ─────────────────────────────────────
// The full ProjectModel uses Map<> internally. We flatten it for IPC.

export interface SerializableAgentModel {
  id: string;
  name: string;
  profilePath: string;
  adataPath: string;
  isEntrypoint: boolean;
  position?: { x: number; y: number };
  description: string;
  aspects: SerializableAspectRef[];
  skills: SerializableSkillRef[];
  subagents: SerializableSubagentModel[];
  profileContent: string;
}

export interface SerializableAspectRef {
  id: string;
  name: string;
  filePath: string;
  order: number;
  enabled: boolean;
}

export interface SerializableSkillRef {
  id: string;
  name: string;
  filePath: string;
  enabled: boolean;
}

export interface SerializableSubagentModel {
  id: string;
  name: string;
  description: string;
  profileContent?: string;
  aspects: SerializableAspectRef[];
  skills: SerializableSkillRef[];
}

export interface SerializableConnection {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  label?: string;
  type: "default" | "conditional" | "fallback";
}

export interface SerializableProjectModel {
  projectDir: string;
  afprojPath: string;
  id: string;
  name: string;
  /** Short project description (stored as `description` in .afproj) */
  description: string;
  version: number;
  agents: SerializableAgentModel[];
  connections: SerializableConnection[];
  properties: Record<string, unknown>;
  entrypointId?: string;
  loadedAt: string;
}

// ── Validation issue (same shape as loader — safe to reuse directly) ───────

export interface BridgeValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  source: string;
  repairHint?: string;
}

// ── Repair action (serializable subset) ───────────────────────────────────

export interface BridgeRepairAction {
  kind: string;
  description: string;
  targetFile: string;
  fieldPath?: string;
  applied: boolean;
}

// ── Load result (IPC-safe) ─────────────────────────────────────────────────

export interface BridgeLoadResult {
  success: boolean;
  project?: SerializableProjectModel;
  issues: BridgeValidationIssue[];
  repairActions: BridgeRepairAction[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    repairsApplied: number;
    repairsProposed: number;
    agentsLoaded: number;
    filesRead: number;
  };
  timestamp: string;
  durationMs: number;
}

// ── Asset panel types ──────────────────────────────────────────────────────
// Used by the Assets panel for directory browsing and .md file management.

/** A directory node in the project tree */
export interface AssetDirEntry {
  name: string;
  /** Absolute path */
  path: string;
  /** Relative path from project root */
  relativePath: string;
  /** Child directories (populated on expand) */
  children?: AssetDirEntry[];
}

/** An entry in the file listing (right panel) */
export interface AssetFileEntry {
  name: string;
  /** Absolute path */
  path: string;
  /** Relative path from project root */
  relativePath: string;
  /** Always "md" — we only expose .md files */
  ext: "md";
}

/** Contents of a directory: immediate .md files + immediate subdirectories */
export interface AssetDirContents {
  dirPath: string;
  files: AssetFileEntry[];
  subdirs: AssetDirEntry[];
}

/** Result of a write/rename/delete operation */
export interface AssetOpResult {
  success: boolean;
  error?: string;
}

/** Read result for a .md file */
export interface AssetReadResult {
  success: boolean;
  content?: string;
  error?: string;
}

// ── IPC channel names ─────────────────────────────────────────────────────
// Centralized here to avoid typos when registering/invoking.

export const IPC_CHANNELS = {
  // Opens a native folder picker dialog and returns the chosen directory path
  // OPEN_FOLDER_DIALOG: "project:open-folder-dialog",
  OPEN_FOLDER_DIALOG: "dialog:openFolder",

  // Opens a native folder picker dialog specifically for selecting where to create a NEW project
  SELECT_NEW_PROJECT_DIR: "dialog:selectNewProjectDir",

  // Validates a candidate directory for new project creation (checks permissions, emptiness, etc.)
  VALIDATE_NEW_PROJECT_DIR: "project:validate-new-dir",

  // Creates a new project scaffold in the chosen directory (atomic, with rollback on error)
  CREATE_PROJECT: "project:create",

  // Loads a project from a directory path using the ProjectLoader
  LOAD_PROJECT: "project:load",

  // Validates a project (dry-run mode — no model built, no file writes)
  VALIDATE_PROJECT: "project:validate",

  // Applies auto-repairs to a project and reloads it (repair mode)
  REPAIR_PROJECT: "project:repair",

  // Saves changes back to disk (atomic write via lock-manager)
  SAVE_PROJECT: "project:save",

  // Exports the project as a single JSON archive to a user-chosen path
  EXPORT_PROJECT: "project:export",

  // Returns the path of the most recently opened project (from app settings)
  GET_RECENT_PROJECTS: "project:get-recent",

  // Opens a native file picker and returns path(s) for import
  OPEN_FILE_DIALOG: "project:open-file-dialog",

  // ── Asset panel channels ─────────────────────────────────────────────────

  // Lists immediate child directories of a path (not files). Used for the sidebar tree.
  ASSET_LIST_DIRS: "asset:list-dirs",

  // Lists .md files + immediate subdirs inside a directory. Used for the right panel.
  ASSET_LIST_DIR_CONTENTS: "asset:list-dir-contents",

  // Reads a .md file from disk and returns its content.
  ASSET_READ_FILE: "asset:read-file",

  // Writes (creates or overwrites) a .md file atomically.
  ASSET_WRITE_FILE: "asset:write-file",

  // Creates a new directory.
  ASSET_CREATE_DIR: "asset:create-dir",

  // Renames a directory or file.
  ASSET_RENAME: "asset:rename",

  // Deletes a directory (recursive) or a file.
  ASSET_DELETE: "asset:delete",

  // Copies a file into a target directory (import .md).
  ASSET_IMPORT_FILE: "asset:import-file",

  // Opens a file picker dialog scoped to .md files for importing.
  ASSET_OPEN_MD_DIALOG: "asset:open-md-dialog",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// ── Request / response payloads ────────────────────────────────────────────

export interface LoadProjectRequest {
  projectDir: string;
  options?: Omit<LoaderOptions, "mode">;
}

export interface RepairProjectRequest {
  projectDir: string;
  options?: Omit<LoaderOptions, "mode">;
}

export interface ValidateProjectRequest {
  projectDir: string;
  options?: Omit<LoaderOptions, "mode">;
}

export interface SaveProjectRequest {
  projectDir: string;
  /**
   * The full current project state to persist.
   * All editable fields from SerializableProjectModel — the main process
   * will merge these over the existing .afproj file on disk.
   */
  updates: {
    name?: string;
    description?: string;
    properties?: Record<string, unknown>;
  };
}

export interface ExportProjectRequest {
  projectDir: string;
  /**
   * Destination path for the exported JSON archive.
   * When omitted (or undefined), the main process opens a native Save dialog
   * to let the user choose the path.
   */
  destinationPath?: string;
}

export interface SaveProjectResult {
  success: boolean;
  error?: string;
}

export interface ExportProjectResult {
  success: boolean;
  exportedPath?: string;
  error?: string;
}

export interface RecentProject {
  projectDir: string;
  name: string;
  lastOpenedAt: string;
}

// ── New-project creation types ─────────────────────────────────────────────

/**
 * Result of validating a candidate directory for new project creation.
 * Returned by the VALIDATE_NEW_PROJECT_DIR channel.
 */
export interface NewProjectDirValidation {
  /** The validated directory path */
  dir: string;
  /** Whether the directory is acceptable for new project creation */
  valid: boolean;
  /**
   * Severity of the situation when valid=false, or "warn" when the dir
   * is usable but has content worth noting (e.g. non-empty).
   */
  severity?: "error" | "warn" | "info";
  /** Human-readable description of the validation result */
  message: string;
  /**
   * True when the directory exists and has contents.
   * The UI can show a "non-empty folder" warning and ask for confirmation.
   */
  nonEmpty?: boolean;
  /**
   * When the user wants a subfolder to be created inside the selected dir,
   * this is the computed path for that subfolder.
   */
  suggestedSubdir?: string;
}

/**
 * Request payload for the CREATE_PROJECT channel.
 */
export interface CreateProjectRequest {
  /** Absolute path of the directory where the project subdirectory will be created */
  projectDir: string;
  /** Human-readable project name */
  name: string;
  /**
   * Optional project description (stored as `description` in .afproj).
   * Editable from the UI after creation.
   */
  description?: string;
}

/**
 * Result of creating a new project.
 */
export interface CreateProjectResult {
  success: boolean;
  /**
   * The actual directory where the project was created.
   * This is always a subdirectory named after the project slug inside the
   * user-selected directory (e.g. /selected/dir/my_project).
   */
  projectDir?: string;
  /** Name of the created .afproj file */
  afprojName?: string;
  /** Human-readable error message when success=false */
  error?: string;
  /**
   * Error code for programmatic handling:
   *   "PERMISSION_DENIED"  — cannot write to that directory
   *   "NOT_EMPTY"          — project subdirectory already exists and is not empty
   *   "ALREADY_EXISTS"     — an .afproj already exists in the project subdirectory
   *   "IO_ERROR"           — generic filesystem error
   *   "CANCELLED"          — user cancelled directory selection
   */
  errorCode?: "PERMISSION_DENIED" | "NOT_EMPTY" | "ALREADY_EXISTS" | "IO_ERROR" | "CANCELLED";
}

// ── Window.agentsFlow API shape ───────────────────────────────────────────
// This is what window.agentsFlow looks like after the preload runs.

export interface AgentsFlowBridge {
  /**
   * Opens a native folder picker dialog.
   * Returns the chosen directory path, or null if the user cancelled.
   */
  openFolderDialog(): Promise<string | null>;

  /**
   * Opens a native folder picker dialog specifically for selecting where
   * to create a NEW project. Returns the chosen directory path or null.
   */
  selectNewProjectDir(): Promise<string | null>;

  /**
   * Validates a candidate directory for new project creation.
   * Checks: existence, write permission, emptiness, existing .afproj.
   */
  validateNewProjectDir(dir: string): Promise<NewProjectDirValidation>;

  /**
   * Creates a new project scaffold atomically.
   * On error, attempts rollback of any files already written.
   */
  createProject(req: CreateProjectRequest): Promise<CreateProjectResult>;

  /**
   * Opens a native file picker dialog for importing a project JSON.
   * Returns the chosen file path, or null if cancelled.
   */
  openFileDialog(options?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;

  /**
   * Loads a project from disk using the ProjectLoader (mode: "load").
   */
  loadProject(req: LoadProjectRequest): Promise<BridgeLoadResult>;

  /**
   * Validates a project without loading it into memory (mode: "dry-run").
   */
  validateProject(req: ValidateProjectRequest): Promise<BridgeLoadResult>;

  /**
   * Applies auto-repairs to a project and reloads it (mode: "repair").
   */
  repairProject(req: RepairProjectRequest): Promise<BridgeLoadResult>;

  /**
   * Saves changes to the project manifest back to disk.
   */
  saveProject(req: SaveProjectRequest): Promise<SaveProjectResult>;

  /**
   * Exports the full project as a JSON archive.
   */
  exportProject(req: ExportProjectRequest): Promise<ExportProjectResult>;

  /**
   * Returns the list of recently opened projects (persisted in app settings).
   */
  getRecentProjects(): Promise<RecentProject[]>;

  // ── Asset panel methods ───────────────────────────────────────────────────

  /**
   * Lists the immediate child directories of `dirPath`.
   * Never returns files. Safe for building the sidebar tree.
   */
  assetListDirs(dirPath: string): Promise<AssetDirEntry[]>;

  /**
   * Returns all .md files and immediate subdirectories inside `dirPath`.
   */
  assetListDirContents(dirPath: string): Promise<AssetDirContents>;

  /**
   * Reads a .md file and returns its text content.
   */
  assetReadFile(filePath: string): Promise<AssetReadResult>;

  /**
   * Writes (creates or overwrites) a .md file atomically.
   * The caller must confirm overwrites before calling this.
   */
  assetWriteFile(filePath: string, content: string): Promise<AssetOpResult>;

  /**
   * Creates a new directory at `dirPath`.
   */
  assetCreateDir(dirPath: string): Promise<AssetOpResult>;

  /**
   * Renames a file or directory from `oldPath` to `newPath`.
   */
  assetRename(oldPath: string, newPath: string): Promise<AssetOpResult>;

  /**
   * Deletes a file or directory recursively.
   */
  assetDelete(targetPath: string): Promise<AssetOpResult>;

  /**
   * Copies a file into `destDir`. If a file with the same name exists, it
   * is overwritten (the UI must confirm before calling this).
   */
  assetImportFile(srcPath: string, destDir: string): Promise<AssetOpResult>;

  /**
   * Opens a native file picker scoped to .md files.
   * Returns the chosen file path or null if the user cancelled.
   */
  assetOpenMdDialog(): Promise<string | null>;
}

// ── Global type augmentation ──────────────────────────────────────────────
// Extend the Window interface so TypeScript knows about window.agentsFlow
// everywhere in the renderer without casting.

declare global {
  interface Window {
    agentsFlow: AgentsFlowBridge;
  }
}
