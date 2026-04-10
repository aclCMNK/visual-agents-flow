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
  /**
   * Agent role as stored in .adata.metadata.agentType.
   * "Agent" or "Sub-Agent". Defaults to "Agent" if missing.
   */
  agentType: "Agent" | "Sub-Agent";
  /**
   * Whether this agent is an orchestrator, from .adata.metadata.isOrchestrator.
   * Stored as a string "true"/"false" in the file but exposed as boolean here.
   * Defaults to false if missing.
   */
  isOrchestrator: boolean;
  /**
   * Whether this sub-agent is hidden from the @ autocomplete menu.
   * From .adata.metadata.hidden. Defaults to false if missing.
   * Only meaningful when agentType === "Sub-Agent".
   */
  hidden: boolean;
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
  /**
   * Free-form edge metadata. Used to persist flow-editor properties:
   *   relationType:    "Delegation" | "Response"
   *   delegationType:  "Optional" | "Mandatory" | "Conditional"
   *   ruleDetails:     free-form string
   */
  metadata?: Record<string, string>;
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

  // Saves the agent graph (nodes + links) to .afproj and metadata/.adata files
  SAVE_AGENT_GRAPH: "project:save-agent-graph",

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

  // Reads the adapter field from a metadata/<agentId>.adata file.
  ADATA_GET_ADAPTER: "adata:get-adapter",

  // Writes (creates or updates) the adapter field in metadata/<agentId>.adata.
  ADATA_SET_ADAPTER: "adata:set-adapter",

  // Reads the opencode config object from metadata/<agentId>.adata.
  ADATA_GET_OPENCODE_CONFIG: "adata:get-opencode-config",

  // Writes (creates or updates) the opencode config object in metadata/<agentId>.adata.
  ADATA_SET_OPENCODE_CONFIG: "adata:set-opencode-config",

  // ── Agent Profiling channels ──────────────────────────────────────────────
  // These channels manage the `profile[]` array inside metadata/<agentId>.adata.
  // Each profile entry links an agent to a .md document under a named selector.

  // Returns the full profile[] array for an agent (sorted by order).
  ADATA_LIST_PROFILES: "adata:list-profiles",

  // Appends a new profile entry to the agent's profile list.
  ADATA_ADD_PROFILE: "adata:add-profile",

  // Updates specific fields of an existing profile entry (by id).
  ADATA_UPDATE_PROFILE: "adata:update-profile",

  // Removes a profile entry by id (does NOT delete the .md file).
  ADATA_REMOVE_PROFILE: "adata:remove-profile",

  // Reorders the profile list by supplying an array of ids in the new order.
  ADATA_REORDER_PROFILES: "adata:reorder-profiles",

  // ── Permissions channels ──────────────────────────────────────────────────
  // These channels manage the `permissions` object inside metadata/<agentId>.adata.
  // The object maps ungrouped permission names to values, and group names to
  // nested objects of { perm: value }.

  // Returns the full permissions object for an agent.
  ADATA_GET_PERMISSIONS: "adata:get-permissions",

  // Writes (replaces) the full permissions object for an agent.
  ADATA_SET_PERMISSIONS: "adata:set-permissions",
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

// ── Agent graph save types ─────────────────────────────────────────────────
// Used by the Save button in the editor to persist the visual agent graph.

/**
 * Serialized agent node for the graph save payload.
 * Contains all fields needed to write the .afproj entry and .adata file.
 */
export interface AgentGraphNode {
  /** UUID of the agent */
  id: string;
  /** Human-readable name */
  name: string;
  /** Optional description */
  description: string;
  /** Agent role: "Agent" or "Sub-Agent" */
  type: "Agent" | "Sub-Agent";
  /** Whether this agent acts as an orchestrator */
  isOrchestrator: boolean;
  /**
   * Whether this sub-agent is hidden from the @ autocomplete menu.
   * Only meaningful when type === "Sub-Agent". Always false for other types.
   */
  hidden: boolean;
  /** Canvas position */
  x: number;
  y: number;
}

/**
 * Serialized edge for the graph save payload.
 * Corresponds to AgentLink in the store.
 */
export interface AgentGraphEdge {
  /** Link UUID */
  id: string;
  /** Source agent UUID */
  fromAgentId: string;
  /** Target agent UUID */
  toAgentId: string;
  /** Whether this link is a Delegation or Response */
  relationType: "Delegation" | "Response";
  /** Delegation sub-type (only meaningful when relationType === "Delegation") */
  delegationType: "Optional" | "Mandatory" | "Conditional";
  /** Free-form rule description */
  ruleDetails: string;
}

export interface SaveAgentGraphRequest {
  /** Absolute path to the project directory */
  projectDir: string;
  /** All agent nodes currently on the canvas */
  agents: AgentGraphNode[];
  /** All directed links between agents */
  edges: AgentGraphEdge[];
}

export interface SaveAgentGraphResult {
  success: boolean;
  error?: string;
}

export interface ExportProjectResult {
  success: boolean;
  exportedPath?: string;
  error?: string;
}

// ── Adapter field IPC types ────────────────────────────────────────────────

/**
 * Request payload to read or write the adapter field in a .adata file.
 */
export interface AdataAdapterRequest {
  /** Absolute path to the project directory */
  projectDir: string;
  /** UUID of the agent */
  agentId: string;
}

/**
 * Request payload to write the adapter field in a .adata file.
 */
export interface AdataSetAdapterRequest extends AdataAdapterRequest {
  /**
   * The adapter identifier to set (e.g. "opencode").
   * Pass null to clear the adapter.
   */
  adapter: string | null;
}

/**
 * Result of reading the adapter field from a .adata file.
 */
export interface AdataGetAdapterResult {
  success: boolean;
  /** Current adapter value, or null if not set */
  adapter: string | null;
  error?: string;
}

/**
 * Result of writing the adapter field to a .adata file.
 */
export interface AdataSetAdapterResult {
  success: boolean;
  error?: string;
}

// ── OpenCode config IPC types ──────────────────────────────────────────────
// The opencode config object lives at .adata.opencode and contains
// `provider` and `model` fields specific to the OpenCode adapter.

/**
 * The OpenCode adapter configuration stored under .adata.opencode.
 */
export interface OpenCodeConfig {
  /** The LLM provider to use with OpenCode (e.g. "GitHub-Copilot", "OpenAI") */
  provider: string;
  /** The model identifier string */
  model: string;
  /**
   * Sampling temperature as a float in the range [0.0, 1.0].
   * Maps to a UI percentage (0–100); 0.05 = 5% is the default.
   * Always required — never null or undefined.
   */
  temperature: number;
}

/**
 * Request payload to read the opencode config from a .adata file.
 */
export interface AdataGetOpenCodeConfigRequest {
  /** Absolute path to the project directory */
  projectDir: string;
  /** UUID of the agent */
  agentId: string;
}

/**
 * Request payload to write the opencode config in a .adata file.
 */
export interface AdataSetOpenCodeConfigRequest {
  /** Absolute path to the project directory */
  projectDir: string;
  /** UUID of the agent */
  agentId: string;
  /** The opencode config to persist */
  config: OpenCodeConfig;
}

/**
 * Result of reading the opencode config from a .adata file.
 */
export interface AdataGetOpenCodeConfigResult {
  success: boolean;
  /** Current opencode config, or null if not set */
  config: OpenCodeConfig | null;
  error?: string;
}

/**
 * Result of writing the opencode config to a .adata file.
 */
export interface AdataSetOpenCodeConfigResult {
  success: boolean;
  error?: string;
}

// ── Agent Profiling IPC types ──────────────────────────────────────────────
//
// The `profile[]` array lives at the top level of each agent's .adata file.
// These DTOs are the IPC-safe (structured-clone-safe) representations of
// the AgentProfile domain type (src/types/agent.ts).
//
// Rule: ALL fields must be plain serialisable values (string, number, boolean,
// plain objects, arrays).  No Map, Set, class instances, or undefined values
// in required positions.

/**
 * IPC-safe representation of a single agent profile entry.
 *
 * Mirrors AgentProfile from src/types/agent.ts — kept as a separate
 * interface so bridge.types.ts has no import dependency on the storage layer.
 *
 * Shape stored in .adata:
 * ```json
 * {
 *   "id":       "550e8400-...",
 *   "selector": "System Prompt",
 *   "filePath": "behaviors/<agentId>/system.md",
 *   "label":    "Core identity",
 *   "order":    0,
 *   "enabled":  true
 * }
 * ```
 */
export interface BridgeAgentProfile {
  /** Stable UUID v4 — assigned on creation, never changes */
  id: string;
  /**
   * Functional role label (e.g. "System Prompt", "Memory", "Tools").
   * Free-form string; well-known values are listed in PROFILE_SELECTORS.
   */
  selector: string;
  /**
   * Relative path from project root to the .md document.
   * Convention: `behaviors/<agentId>/<filename>.md`
   */
  filePath: string;
  /** Optional human-readable label; falls back to the filename in the UI */
  label?: string;
  /**
   * Rendering / compilation order within the same selector group.
   * Non-negative integer; lower = earlier.
   */
  order: number;
  /** When false the profile is stored but excluded from compiled output */
  enabled: boolean;
}

// ── List profiles ─────────────────────────────────────────────────────────

/** Request payload for ADATA_LIST_PROFILES */
export interface AdataListProfilesRequest {
  /** Absolute path to the project directory */
  projectDir: string;
  /** UUID of the agent */
  agentId: string;
}

/** Result of listing the profile[] array from a .adata file */
export interface AdataListProfilesResult {
  success: boolean;
  /** Sorted profile list (by order). Empty array when no profiles exist. */
  profiles: BridgeAgentProfile[];
  error?: string;
  /**
   * Structured error code for programmatic handling in the renderer.
   * Maps to ProfileErrorCode in src/storage/profiles.ts.
   */
  errorCode?: "AGENT_NOT_FOUND" | "PROFILE_NOT_FOUND" | "INVALID_INPUT" | "UNKNOWN";
}

// ── Add profile ───────────────────────────────────────────────────────────

/** Request payload for ADATA_ADD_PROFILE */
export interface AdataAddProfileRequest {
  /** Absolute path to the project directory */
  projectDir: string;
  /** UUID of the agent */
  agentId: string;
  /**
   * Required fields for the new profile.
   * `id` and default `order` are assigned by the handler.
   */
  selector: string;
  filePath: string;
  label?: string;
  /** When omitted, appended after the current last entry */
  order?: number;
  /** Defaults to true when omitted */
  enabled?: boolean;
}

/** Result of adding a new profile entry */
export interface AdataAddProfileResult {
  success: boolean;
  /** The newly created profile entry (with assigned id and order) */
  profile?: BridgeAgentProfile;
  /** Complete updated profile list (sorted by order) */
  profiles?: BridgeAgentProfile[];
  error?: string;
  errorCode?: "AGENT_NOT_FOUND" | "INVALID_INPUT" | "UNKNOWN";
}

// ── Update profile ────────────────────────────────────────────────────────

/** Request payload for ADATA_UPDATE_PROFILE */
export interface AdataUpdateProfileRequest {
  /** Absolute path to the project directory */
  projectDir: string;
  /** UUID of the agent */
  agentId: string;
  /** UUID of the profile entry to update */
  profileId: string;
  /**
   * Fields to update (partial).
   * The `id` field is immutable and cannot be included here.
   * Fields not present in this object retain their current values.
   */
  patch: Partial<Omit<BridgeAgentProfile, "id">>;
}

/** Result of updating a profile entry */
export interface AdataUpdateProfileResult {
  success: boolean;
  /** Complete updated profile list (sorted by order) */
  profiles?: BridgeAgentProfile[];
  error?: string;
  errorCode?: "AGENT_NOT_FOUND" | "PROFILE_NOT_FOUND" | "INVALID_INPUT" | "UNKNOWN";
}

// ── Remove profile ────────────────────────────────────────────────────────

/** Request payload for ADATA_REMOVE_PROFILE */
export interface AdataRemoveProfileRequest {
  /** Absolute path to the project directory */
  projectDir: string;
  /** UUID of the agent */
  agentId: string;
  /** UUID of the profile entry to remove */
  profileId: string;
}

/** Result of removing a profile entry */
export interface AdataRemoveProfileResult {
  success: boolean;
  /** Complete updated profile list after removal */
  profiles?: BridgeAgentProfile[];
  error?: string;
  errorCode?: "AGENT_NOT_FOUND" | "PROFILE_NOT_FOUND" | "UNKNOWN";
}

// ── Reorder profiles ──────────────────────────────────────────────────────

/** Request payload for ADATA_REORDER_PROFILES */
export interface AdataReorderProfilesRequest {
  /** Absolute path to the project directory */
  projectDir: string;
  /** UUID of the agent */
  agentId: string;
  /**
   * Profile UUIDs in the desired new order.
   * Profiles NOT listed are appended after the ordered ones.
   */
  orderedIds: string[];
}

/** Result of reordering the profile list */
export interface AdataReorderProfilesResult {
  success: boolean;
  /** Complete updated profile list (sorted by new order) */
  profiles?: BridgeAgentProfile[];
  error?: string;
  errorCode?: "AGENT_NOT_FOUND" | "UNKNOWN";
}

export interface RecentProject {
  projectDir: string;
  name: string;
  lastOpenedAt: string;
}

// ── Permissions IPC types ──────────────────────────────────────────────────
//
// The `permissions` object lives at the top level of each agent's .adata file.
// It is serialized as a plain object where:
//
//   - Top-level string values are ungrouped permissions:
//       { "perm": "value" }
//
//   - Top-level object values are grouped permissions (group → { perm: value }):
//       { "group": { "perm": "value", ... } }
//
// Example:
//   {
//     "read": "allow",
//     "execute": "ask",
//     "Bash": {
//       "run-scripts": "allow",
//       "write-files": "deny"
//     }
//   }
//
// `value` is one of "allow" | "deny" | "ask".

/** Valid permission values */
export type PermissionValue = "allow" | "deny" | "ask";

/**
 * The permissions object shape stored under .adata.permissions.
 *
 * - String values represent ungrouped permissions (key → value).
 * - Object values represent permission groups (groupName → { perm: value, ... }).
 */
export type PermissionsObject = Record<string, PermissionValue | Record<string, PermissionValue>>;

// ── Get permissions ────────────────────────────────────────────────────────

/** Request payload for ADATA_GET_PERMISSIONS */
export interface AdataGetPermissionsRequest {
  /** Absolute path to the project directory */
  projectDir: string;
  /** UUID of the agent */
  agentId: string;
}

/** Result of reading the permissions object from a .adata file */
export interface AdataGetPermissionsResult {
  success: boolean;
  /** Current permissions object. Empty object when not set. */
  permissions: PermissionsObject;
  error?: string;
}

// ── Set permissions ────────────────────────────────────────────────────────

/** Request payload for ADATA_SET_PERMISSIONS */
export interface AdataSetPermissionsRequest {
  /** Absolute path to the project directory */
  projectDir: string;
  /** UUID of the agent */
  agentId: string;
  /** Full permissions object to persist */
  permissions: PermissionsObject;
}

/** Result of writing the permissions object to a .adata file */
export interface AdataSetPermissionsResult {
  success: boolean;
  error?: string;
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
   * Saves the agent graph (nodes + links) to the .afproj file and
   * creates/updates metadata/<uuid>.adata files for each agent.
   * Deletes .adata files for agents that no longer exist.
   */
  saveAgentGraph(req: SaveAgentGraphRequest): Promise<SaveAgentGraphResult>;

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

  // ── Adapter field ─────────────────────────────────────────────────────────

  /**
   * Reads the adapter field from the agent's .adata file.
   * Returns null if the adapter is not set.
   */
  adataGetAdapter(req: AdataAdapterRequest): Promise<AdataGetAdapterResult>;

  /**
   * Writes (creates or updates) the adapter field in the agent's .adata file.
   * Pass adapter: null to clear the adapter.
   */
  adataSetAdapter(req: AdataSetAdapterRequest): Promise<AdataSetAdapterResult>;

  // ── OpenCode config ───────────────────────────────────────────────────────

  /**
   * Reads the opencode config object from the agent's .adata file.
   * Returns null if not set.
   */
  adataGetOpenCodeConfig(req: AdataGetOpenCodeConfigRequest): Promise<AdataGetOpenCodeConfigResult>;

  /**
   * Writes (creates or updates) the opencode config object in the agent's .adata file.
   * Stored under the 'opencode' top-level key.
   */
  adataSetOpenCodeConfig(req: AdataSetOpenCodeConfigRequest): Promise<AdataSetOpenCodeConfigResult>;

  // ── Agent Profiling ───────────────────────────────────────────────────────

  /**
   * Returns the full profile[] list for an agent, sorted by order.
   * Returns an empty array when the agent has no profiles yet.
   */
  adataListProfiles(req: AdataListProfilesRequest): Promise<AdataListProfilesResult>;

  /**
   * Appends a new profile entry to the agent's profile list.
   * Returns the newly created entry and the updated full list.
   */
  adataAddProfile(req: AdataAddProfileRequest): Promise<AdataAddProfileResult>;

  /**
   * Updates specific fields of an existing profile entry.
   * Returns the complete updated profile list.
   */
  adataUpdateProfile(req: AdataUpdateProfileRequest): Promise<AdataUpdateProfileResult>;

  /**
   * Removes a profile entry by id.
   * Does NOT delete the underlying .md file.
   * Returns the complete updated profile list.
   */
  adataRemoveProfile(req: AdataRemoveProfileRequest): Promise<AdataRemoveProfileResult>;

  /**
   * Reorders the profile list by supplying profile UUIDs in the new desired order.
   * Returns the complete updated profile list.
   */
  adataReorderProfiles(req: AdataReorderProfilesRequest): Promise<AdataReorderProfilesResult>;

  // ── Permissions ───────────────────────────────────────────────────────────

  /**
   * Reads the permissions object from the agent's .adata file.
   * Returns an empty object when no permissions are set.
   */
  adataGetPermissions(req: AdataGetPermissionsRequest): Promise<AdataGetPermissionsResult>;

  /**
   * Writes (replaces) the full permissions object in the agent's .adata file.
   * Stored under the 'permissions' top-level key as a plain object.
   */
  adataSetPermissions(req: AdataSetPermissionsRequest): Promise<AdataSetPermissionsResult>;
}

// ── Global type augmentation ──────────────────────────────────────────────
// Extend the Window interface so TypeScript knows about window.agentsFlow
// everywhere in the renderer without casting.

declare global {
  interface Window {
    agentsFlow: AgentsFlowBridge;
  }
}
