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
	/**
	 * The user node descriptor, if a User node is present in the project.
	 * When present, `user.user_id` is always "user-node".
	 * When absent, no User node exists in the graph.
	 *
	 * @deprecated The legacy flat `user_id: string` field has been replaced
	 * by this object. Old files are migrated on save.
	 */
	user?: { user_id: string; position?: { x: number; y: number } };
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

	// ── Skills channels ───────────────────────────────────────────────────────
	// Scans {projectDir}/skills/ recursively for SKILL.md files and returns
	// their names as dash-joined relative paths from the skills root.

	// Returns a sorted list of skill names found under {projectDir}/skills/.
	ADATA_LIST_SKILLS: "adata:list-skills",

	// ── Agent rename (slug-first) ──────────────────────────────────────────────
	// Renames the behaviors/<oldSlug> folder to behaviors/<newSlug> on disk,
	// and rewrites all path references inside the agent's .adata file so they
	// point to the new folder. Also updates agentName inside .adata.
	RENAME_AGENT_FOLDER: "agent:rename-folder",

	// ── OpenCode export ─────────────────────────────────────────────────────────
	// Opens a native folder picker dialog for selecting the export destination directory.
	SELECT_EXPORT_DIR: "dialog:selectExportDir",

	// Writes the generated OpenCode config (JSON/JSONC) to the chosen directory.
	WRITE_EXPORT_FILE: "export:writeFile",

	// Lists all skill .md files and their contents under {projectDir}/skills/
	LIST_SKILLS_FULL: "export:listSkillsFull",

	// Reads the profile .md files for a given agent (all profile entries by order)
	READ_AGENT_PROFILES_FULL: "export:readAgentProfilesFull",

	// Reads the raw .adata object for a given agent (for properties display)
	READ_AGENT_ADATA_RAW: "export:readAgentAdataRaw",

	// ── Folder Explorer channels ───────────────────────────────────────────────
	//
	// These channels power the home-sandboxed in-app folder browser. They are
	// purposely grouped at the end so they do NOT conflict with any existing
	// channel name. The "folder-explorer:" prefix is the authoritative namespace.
	//
	// ⚠️  CONFLICT NOTE: These channels are also declared in
	//     FOLDER_EXPLORER_CHANNELS (electron-main/src/ipc/folder-explorer.ts).
	//     Both constant objects MUST agree on the exact string values — if you
	//     rename a channel here, rename it there too (and vice-versa).
	//     The TypeScript compiler will NOT catch a mismatch between two `const`
	//     objects that happen to have different string literals.
	//
	// Lists visible entries of a directory under $HOME (apply filter options).
	FOLDER_EXPLORER_LIST: "folder-explorer:list",

	// Returns metadata (exists, isDirectory, readable) for a single $HOME path.
	FOLDER_EXPLORER_STAT: "folder-explorer:stat",

	// Batch-lists multiple sub-directories in parallel (virtualised tree support).
	FOLDER_EXPLORER_READ_CHILDREN: "folder-explorer:read-children",

	// ── Skills export channels ─────────────────────────────────────────────────
	//
	// Copies all active skill directories from {projectDir}/skills/ to
	// {destDir}/skills/. When a destination file already exists, the main process
	// sends a conflict prompt to the renderer and waits for a response before
	// continuing or aborting.
	//
	// Channels:
	//   EXPORT_SKILLS            — renderer→main invoke: starts the export
	//   SKILL_CONFLICT_PROMPT    — main→renderer send:   asks user what to do with a conflict
	//   SKILL_CONFLICT_RESPONSE  — renderer→main send:   user's answer to the conflict prompt

	// Renderer invokes this to start skills export. Resolves with ExportSkillsResult.
	EXPORT_SKILLS: "export:skills",

	// Main sends this to renderer when a destination file already exists.
	// Renderer must reply with SKILL_CONFLICT_RESPONSE using the same promptId.
	SKILL_CONFLICT_PROMPT: "skill-conflict:prompt",

	// Renderer sends this back to main as the user's response to a conflict prompt.
	SKILL_CONFLICT_RESPONSE: "skill-conflict:response",

	// ── Profile export channels ────────────────────────────────────────────────
	//
	// Concatenates and exports agent profile .md files from {projectDir}/metadata/*.adata
	// to {destDir}/prompts/[projectName]/[agentName].md. When a destination file already
	// exists, the main process sends a conflict prompt to the renderer and waits for a
	// response before continuing or aborting.
	//
	// Channels:
	//   EXPORT_AGENT_PROFILES      — renderer→main invoke: starts the export
	//   PROFILE_CONFLICT_PROMPT    — main→renderer send:   asks user what to do with a conflict
	//   PROFILE_CONFLICT_RESPONSE  — renderer→main send:   user's answer to the conflict prompt

	// Renderer invokes this to start agent profile export. Resolves with ExportAgentProfilesResult.
	EXPORT_AGENT_PROFILES: "export:agent-profiles",

	// Main sends this to renderer when a destination file already exists.
	// Renderer must reply with PROFILE_CONFLICT_RESPONSE using the same promptId.
	PROFILE_CONFLICT_PROMPT: "profile-conflict:prompt",

	// Renderer sends this back to main as the user's response to a conflict prompt.
	PROFILE_CONFLICT_RESPONSE: "profile-conflict:response",

	// ── Sync Tasks channel ─────────────────────────────────────────────────────
	//
	// Writes `permissions.task` for each delegator agent in the payload.
	// Only `permissions.task` is modified — all other .adata fields are preserved.
	// Returns { updated: number, errors: string[] }.
	SYNC_TASKS: "adata:sync-tasks",

	// ── GitHub HTTP fetch channel ─────────────────────────────────────────────
	//
	// Proxies an HTTPS GET request to api.github.com through the main process.
	// The renderer is never subject to CSP connect-src restrictions because the
	// actual network call happens in Node.js (main process), not in Chromium.
	//
	// Only "https://api.github.com/*" URLs are accepted — all others are rejected
	// with errorCode "INVALID_URL" before any network call is made.
	GITHUB_FETCH: "github:fetch",

	// ── Git Clone channel ──────────────────────────────────────────────────────
	//
	// Clones a remote Git repository into `<destDir>/<repoName>` by spawning
	// `git clone --progress -- <url> <destPath>` in the main process.
	//
	// The renderer sends CloneRepositoryRequest (with cloneId UUID); main returns
	// CloneRepositoryResult. Progress is streamed via GIT_CLONE_PROGRESS events.
	// Cancellation is supported via GIT_CLONE_CANCEL.
	GIT_CLONE: "git:clone",

	// ── Git Clone Progress event ───────────────────────────────────────────────
	//
	// Emitted by the main process to the renderer during a clone operation.
	// Payload: CloneProgressEvent { cloneId, stage, percent?, raw }.
	// This is a `send` (not `invoke`) — renderer listens via ipcRenderer.on().
	GIT_CLONE_PROGRESS: "git:clone:progress",

	// ── Git Clone Cancel channel ───────────────────────────────────────────────
	//
	// Renderer sends CloneCancelRequest { cloneId } to abort an in-progress clone.
	// Main sends SIGTERM to the child process; if it does not exit within 5s,
	// SIGKILL is sent. Returns CloneCancelResult.
	GIT_CLONE_CANCEL: "git:clone:cancel",

	// ── Git Clone Validate channel ─────────────────────────────────────────────
	//
	// Validates a GitHub token against GET https://api.github.com/user.
	// Returns CloneValidateResult with status 200/401/403/429.
	// SECURITY: token is used only for the API call — never logged or persisted.
	GIT_CLONE_VALIDATE: "git:clone:validate",

	// ── Git Clone Save Credentials channel ──────────────────────────────────────
	//
	// Writes GIT_USERNAME and GIT_TOKEN into <projectDir>/.env (overwrite) and
	// ensures .env is listed in <projectDir>/.gitignore.
	// SECURITY: token must never be logged or persisted elsewhere.
	GIT_CLONE_SAVE_CREDENTIALS: "git:clone:save-credentials",

	// ── Asset move channel ─────────────────────────────────────────────────────
	//
	// Moves a file or directory to a new parent directory.
	// Validates: no cycle (dir into itself), no name conflicts, protected dirs.
	// Returns AssetMoveResult.
	ASSET_MOVE: "asset:move",

	// ── Git remote origin detection ────────────────────────────────────────────
	//
	// Detects whether the given project directory is a Git repository and, if so,
	// returns the URL of the remote named `origin`.
	// Returns string | null. Never throws — all errors resolve to null.
	GET_GIT_REMOTE_ORIGIN: "git:get-remote-origin",

	// ── Git Branches channels ──────────────────────────────────────────────────

	// Detecta la configuración base de Git del directorio (hasGit + remote origin).
	GIT_GET_CONFIG: "git:get-config",

	// Ejecuta `git init` en el directorio del proyecto.
	GIT_INIT: "git:init",

	// Agrega o actualiza el remote origin.
	GIT_SET_REMOTE: "git:set-remote",

	// Guarda credenciales para repos privados (helper de Git).
	GIT_SAVE_CREDENTIALS: "git:save-credentials",

	// Configura user.name y user.email en scope local del repo.
	GIT_SET_IDENTITY: "git:set-identity",

	// Detecta la rama principal del repositorio remoto.
	// Retorna { ok: true, branch: string | null }.
	// branch === null significa que no pudo detectarse automáticamente.
	GIT_DETECT_MAIN_BRANCH: "git:detect-main-branch",

	// Lista todas las ramas locales y remotas del repositorio.
	// Retorna la rama activa actual y el listado completo.
	GIT_LIST_BRANCHES: "git:list-branches",

	// Obtiene los commits del remoto que no están en local (ahead/behind).
	// Equivale a: git fetch --dry-run + git log HEAD..origin/<branch>
	GIT_GET_REMOTE_DIFF: "git:get-remote-diff",

	// Ejecuta git fetch + git pull en la rama actual.
	GIT_FETCH_AND_PULL: "git:fetch-and-pull",

	// Ejecuta git pull en la rama especificada.
	GIT_PULL_BRANCH: "git:pull-branch",

	// Ejecuta git checkout para cambiar a la rama especificada.
	GIT_CHECKOUT_BRANCH: "git:checkout-branch",

	// Asegura que la rama exista localmente desde origin y sincroniza con pull.
	// Si no existe local: fetch + checkout -b <branch> origin/<branch> (+ pull).
	// Si ya existe local: checkout + pull.
	GIT_ENSURE_LOCAL_BRANCH: "git:ensure-local-branch",

	// Detecta divergencia local vs remoto y, si existe, guarda cambios en una
	// rama de seguridad temporal antes de sincronizar la rama principal remota.
	GIT_HANDLE_DIVERGENCE: "git:handle-divergence",

	// Obtiene el historial de commits de una rama específica.
	GIT_GET_BRANCH_COMMITS: "git:get-branch-commits",

	// Crea una nueva rama local desde una rama base y hace checkout automático.
	GIT_CREATE_BRANCH: "git:create-branch",

	// ── Git Changes channels ───────────────────────────────────────────────────

	// Obtiene el estado de archivos del working tree (staged, unstaged, untracked).
	// Equivale a: git status --porcelain=v1 -u
	GIT_GET_STATUS: "git:get-status",

	// Ejecuta git add -A && git commit -m <message> [-m <description>]
	GIT_ADD_AND_COMMIT: "git:add-and-commit",
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
	/**
	 * The current canvas position of the User node, if one is placed.
	 * When present, the .afproj `user` object is written with this position.
	 * When absent, the `user` object is omitted (or cleared) from .afproj.
	 */
	userPosition?: { x: number; y: number };
}

export interface SaveAgentGraphResult {
	success: boolean;
	error?: string;
	/**
	 * Result of the automatic `permissions.task` sync run after every save.
	 * Present when `success === true` and the sync was attempted.
	 * Absent when the graph save itself failed (no sync is attempted then).
	 */
	syncResult?: SyncTasksResult;
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
	/**
	 * Whether the sub-agent is hidden from the @ autocomplete menu.
	 * Only meaningful when agentType === "Sub-Agent". Defaults to false.
	 * Stored as boolean true/false.
	 */
	hidden: boolean;
	/**
	 * Number of steps for the agent to execute.
	 * Optional integer in the range [7, 100]. Defaults to 7.
	 * null means the field is not set (uses model default).
	 */
	steps: number | null;
	/**
	 * UI accent color for the agent, stored as a hex string (e.g. "#ffffff").
	 * Required — never null or undefined. Defaults to "#ffffff".
	 */
	color: string;
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
	errorCode?:
		| "AGENT_NOT_FOUND"
		| "PROFILE_NOT_FOUND"
		| "INVALID_INPUT"
		| "UNKNOWN";
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
	errorCode?:
		| "AGENT_NOT_FOUND"
		| "PROFILE_NOT_FOUND"
		| "INVALID_INPUT"
		| "UNKNOWN";
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
export type PermissionsObject = Record<
	string,
	PermissionValue | Record<string, PermissionValue>
>;

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

// ── Skills IPC types ───────────────────────────────────────────────────────
//
// Skills are .md documents stored under `{projectDir}/skills/` as:
//   skills/<subdir>/SKILL.md
//   skills/<category>/<name>/SKILL.md
//
// Their "skill name" is the relative path from `skills/` to the SKILL.md's
// parent directory, with path separators replaced by dashes:
//   skills/kb-search/SKILL.md           → "kb-search"
//   skills/agents/summarizer/SKILL.md   → "agents-summarizer"

/** Request payload for ADATA_LIST_SKILLS */
export interface AdataListSkillsRequest {
	/** Absolute path to the project directory */
	projectDir: string;
}

/** Result of listing skills found under {projectDir}/skills/ */
export interface AdataListSkillsResult {
	success: boolean;
	/** Sorted array of skill names (dash-joined relative paths). Empty when no skills exist. */
	skills: string[];
	error?: string;
}

// ── Agent rename (slug-first) IPC types ───────────────────────────────────
//
// When the user renames an agent, the new name is immediately converted to a
// slug and stored as the agent name. On disk, the behaviors/<oldSlug> folder
// is renamed to behaviors/<newSlug> and all path references inside the agent's
// .adata file are updated accordingly.

/**
 * Request payload for the RENAME_AGENT_FOLDER channel.
 */
export interface RenameAgentFolderRequest {
	/** Absolute path to the project directory */
	projectDir: string;
	/** UUID of the agent */
	agentId: string;
	/** The old slug (current behaviors folder name, e.g. "old-agent") */
	oldSlug: string;
	/** The new slug (target behaviors folder name, e.g. "new-agent") */
	newSlug: string;
}

/**
 * Result of renaming the agent's behaviors folder.
 */
export interface RenameAgentFolderResult {
	success: boolean;
	error?: string;
	/**
	 * Error code for programmatic handling:
	 *   "CONFLICT"       — the target slug folder already exists
	 *   "NOT_FOUND"      — the old slug folder does not exist (non-fatal if new folder already correct)
	 *   "IO_ERROR"       — generic filesystem error
	 */
	errorCode?: "CONFLICT" | "NOT_FOUND" | "IO_ERROR";
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
	errorCode?:
		| "PERMISSION_DENIED"
		| "NOT_EMPTY"
		| "ALREADY_EXISTS"
		| "IO_ERROR"
		| "CANCELLED";
}

// ── Window.agentsFlow API shape ───────────────────────────────────────────
// This is what window.agentsFlow looks like after the preload runs.

// ── Export IPC types ───────────────────────────────────────────────────────

/** Result of selecting an export destination directory */
export interface SelectExportDirResult {
	/** The chosen directory path, or null if cancelled */
	dirPath: string | null;
}

/** Request to write the OpenCode export config to disk */
export interface WriteExportFileRequest {
	/** Absolute path to the destination directory */
	destDir: string;
	/** The filename (e.g. "opencode.json" or "opencode.jsonc") */
	fileName: string;
	/** The file content (JSON string) */
	content: string;
}

/** Result of writing the export file */
export interface WriteExportFileResult {
	success: boolean;
	/** The final absolute path of the written file */
	filePath?: string;
	error?: string;
}

/** A skill entry with both name and content */
export interface SkillFullEntry {
	/** Skill name (e.g. "kb-search") */
	name: string;
	/** Relative path from project root to the SKILL.md */
	relativePath: string;
	/** Content of the SKILL.md file */
	content: string;
}

/** Request to list all skills with full content */
export interface ListSkillsFullRequest {
	/** Absolute path to the project directory */
	projectDir: string;
}

/** Result of listing all skills with full content */
export interface ListSkillsFullResult {
	success: boolean;
	skills: SkillFullEntry[];
	error?: string;
}

/** Request to read all profile .md files for an agent */
export interface ReadAgentProfilesFullRequest {
	/** Absolute path to the project directory */
	projectDir: string;
	/** UUID of the agent */
	agentId: string;
}

/** Result of reading all profile .md files for an agent */
export interface ReadAgentProfilesFullResult {
	success: boolean;
	/** Concatenated content of all profile .md files (by order) */
	concatenatedContent: string;
	/** Individual profile contents in order */
	profiles: Array<{
		filePath: string;
		selector: string;
		label?: string;
		content: string;
	}>;
	error?: string;
}

/** Request to read the raw .adata object for an agent */
export interface ReadAgentAdataRawRequest {
	/** Absolute path to the project directory */
	projectDir: string;
	/** UUID of the agent */
	agentId: string;
}

/** Result of reading the raw .adata object */
export interface ReadAgentAdataRawResult {
	success: boolean;
	/** The raw .adata content as a plain object */
	adata: Record<string, unknown> | null;
	error?: string;
}

// ── Folder Explorer IPC types ──────────────────────────────────────────────
//
// These are re-declared here (mirroring the authoritative types in
// electron-main/src/ipc/folder-explorer.ts) so that:
//   - preload.ts can import them from a single bridge-level location.
//   - renderer hooks can import them from bridge.types.ts without depending
//     on the electron-main module tree.
//
// Rule: if the authoritative shape changes in folder-explorer.ts, update here
// too. A future refactor may re-export directly from the source file.

/** A single directory entry surfaced to the renderer */
export interface FolderExplorerDirEntry {
	/** Basename only (never a full path) */
	name: string;
	/** True if the entry is a directory */
	isDirectory: boolean;
	/**
	 * Resolved absolute path (guaranteed to be inside $HOME).
	 * The renderer can pass this back directly in subsequent IPC calls.
	 */
	path: string;
}

/** Lightweight metadata about a single path (from `folder-explorer:stat`) */
export interface FolderExplorerPathStat {
	path: string;
	exists: boolean;
	isDirectory: boolean;
	readable: boolean;
}

/** All normalised error codes the folder-explorer IPC can return */
export type FolderExplorerErrorCode =
	| "E_NOT_IN_HOME"
	| "E_NOT_FOUND"
	| "E_NOT_A_DIR"
	| "E_ACCESS_DENIED"
	| "E_UNKNOWN";

/** Error envelope — always serialisable over IPC */
export interface FolderExplorerError {
	ok: false;
	code: FolderExplorerErrorCode;
	message: string;
}

/** Successful response from `folder-explorer:list` */
export interface FolderExplorerListResult {
	ok: true;
	dirPath: string;
	entries: FolderExplorerDirEntry[];
}

/** Successful response from `folder-explorer:stat` */
export interface FolderExplorerStatResult {
	ok: true;
	stat: FolderExplorerPathStat;
}

/** Successful response from `folder-explorer:read-children` */
export interface FolderExplorerReadChildrenResult {
	ok: true;
	results: Record<string, FolderExplorerListResult | FolderExplorerError>;
}

/** Union response for `folder-explorer:list` */
export type FolderExplorerListResponse =
	| FolderExplorerListResult
	| FolderExplorerError;

/** Union response for `folder-explorer:stat` */
export type FolderExplorerStatResponse =
	| FolderExplorerStatResult
	| FolderExplorerError;

/** Union response for `folder-explorer:read-children` */
export type FolderExplorerReadChildrenResponse =
	| FolderExplorerReadChildrenResult
	| FolderExplorerError;

/**
 * Filter options passed as part of the folder-explorer:list and
 * folder-explorer:read-children payloads.
 * Mirrors FilterOptions from electron-main/src/fs/filter.ts.
 */
export interface FolderExplorerFilterOptions {
	/** When true, hidden entries (starting with ".") are included. Default: false */
	showHidden?: boolean;
	/** When true, only directories are returned. Default: false */
	directoriesOnly?: boolean;
	/** Additional entry names to block (on top of the built-in blocklist). */
	extraBlocklist?: string[];
	/**
	 * When provided, only entries whose extension matches one of these values
	 * are returned. Extensions should NOT include the leading dot ("ts", not ".ts").
	 * Only meaningful when directoriesOnly is false.
	 */
	allowedExtensions?: string[];
}

/** Request payload for `folder-explorer:list` */
export interface FolderExplorerListRequest {
	path: string;
	options?: FolderExplorerFilterOptions;
}

/** Request payload for `folder-explorer:stat` */
export interface FolderExplorerStatRequest {
	path: string;
}

/** Request payload for `folder-explorer:read-children` */
export interface FolderExplorerReadChildrenRequest {
	paths: string[];
	options?: FolderExplorerFilterOptions;
}

// ── Skills export IPC types ────────────────────────────────────────────────
//
// Skills export copies active skill directories from the project's `skills/`
// folder to `<destDir>/skills/`. When a file already exists at the destination
// the main process sends a conflict prompt to the renderer; the renderer
// displays a dialog and responds with the user's choice.
//
// Flow:
//   1. Renderer calls bridge.exportSkills({ projectDir, destDir }) via IPC
//   2. Main process detects a conflict and sends SKILL_CONFLICT_PROMPT to renderer
//   3. Renderer shows the dialog and sends SKILL_CONFLICT_RESPONSE back
//   4. Main process continues or aborts based on the response
//   5. bridge.exportSkills resolves with ExportSkillsResult

/** Request payload for the EXPORT_SKILLS channel */
export interface ExportSkillsRequest {
	/** Absolute path to the project directory (source) */
	projectDir: string;
	/** Absolute path to the export destination directory */
	destDir: string;
}

/** Result returned by the EXPORT_SKILLS channel */
export interface ExportSkillsResult {
	success: boolean;
	/** Whether the user cancelled the operation */
	aborted?: boolean;
	/** Skills that were successfully copied */
	copiedSkills?: string[];
	/** Skills that were skipped (source missing or not a directory) */
	skippedSkills?: string[];
	/**
	 * Skill names (dash-joined) that appear in permissions.skills with value "allow"
	 * (or matched by a wildcard pattern) but have NO matching directory in skills/.
	 */
	skillWarnings?: string[];
	error?: string;
}

/**
 * Conflict prompt sent FROM main TO renderer via ipcRenderer.on().
 * Renderer shows a dialog and replies with ExportSkillsConflictResponse.
 */
export interface ExportSkillsConflictPrompt {
	/** Unique ID for this prompt — used to correlate the response */
	promptId: string;
	/** Skill directory name (e.g. "kb-search") */
	skillName: string;
	/** File that already exists (relative to skill dir, e.g. "SKILL.md") */
	fileName: string;
}

/** User's response to a conflict prompt */
export type ExportSkillsConflictAction = "replace" | "replace-all" | "cancel";

/**
 * Response sent FROM renderer TO main via ipcRenderer.send().
 * Correlates to a specific ExportSkillsConflictPrompt via promptId.
 */
export interface ExportSkillsConflictResponse {
	/** Must match the promptId from ExportSkillsConflictPrompt */
	promptId: string;
	/** User's chosen action */
	action: ExportSkillsConflictAction;
}

// ── Profile Export Types ───────────────────────────────────────────────────

/** Request sent by renderer to main to export agent profiles */
export interface ExportAgentProfilesRequest {
	/** Absolute path to the project directory (source) */
	projectDir: string;
	/** Absolute path to the export destination directory */
	destDir: string;
}

/** Result returned by the EXPORT_AGENT_PROFILES channel */
export interface ExportAgentProfilesResult {
	success: boolean;
	/** Agents that were successfully exported */
	exported: Array<{ agentName: string; path: string }>;
	/** Agents that were skipped (no profiles or all failed) */
	skipped: Array<{ agentName: string; reason: string }>;
	/** Warnings (missing files, permissions, etc.) */
	warnings: string[];
	/** Summary statistics */
	summary: {
		totalAgents: number;
		exportedCount: number;
		skippedCount: number;
		warningCount: number;
	};
	error?: string;
}

/**
 * Conflict prompt sent FROM main TO renderer via ipcRenderer.on().
 * Renderer shows a dialog and replies with ExportProfileConflictResponse.
 */
export interface ExportProfileConflictPrompt {
	/** Unique ID for this prompt — used to correlate the response */
	promptId: string;
	/** Agent name (e.g. "research-agent") */
	agentName: string;
	/** Absolute path to the destination file that already exists */
	destinationPath: string;
}

/** User's response to a profile conflict prompt */
export type ExportProfileConflictAction = "replace" | "replace-all" | "cancel";

/**
 * Response sent FROM renderer TO main via ipcRenderer.send().
 * Correlates to a specific ExportProfileConflictPrompt via promptId.
 */
export interface ExportProfileConflictResponse {
	/** Must match the promptId from ExportProfileConflictPrompt */
	promptId: string;
	/** User's chosen action */
	action: ExportProfileConflictAction;
}

// ── Asset Move ────────────────────────────────────────────────────────────────
//
// Moves a file or directory to a new parent directory by renaming it.
// Protected directories (metadata, .afproj) are never moveable.
// The handler validates cycles, name conflicts, and protected paths server-side.

/** What kind of item is being dragged */
export type DraggedItemKind = "file" | "dir";

/** The item being dragged in the asset panel */
export interface DraggedItem {
	/** "file" for .md files, "dir" for directories */
	kind: DraggedItemKind;
	/** Absolute path of the source item */
	path: string;
	/** Basename of the source item */
	name: string;
	/** Absolute path of the source item's parent directory */
	parentPath: string;
}

/** Payload sent to the ASSET_MOVE IPC channel */
export interface AssetMovePayload {
	/** Absolute path of the source item (file or directory) */
	sourcePath: string;
	/** Absolute path of the TARGET directory (where item will be moved into) */
	targetDirPath: string;
	/** Project root — used for protected-path validation */
	projectRoot: string;
}

/** Result from the ASSET_MOVE IPC channel */
export interface AssetMoveResult {
	success: boolean;
	/** New absolute path after the move */
	newPath?: string;
	error?: string;
	/**
	 * Structured error code:
	 *   "CYCLE"      — would create a directory cycle (dir moved into itself)
	 *   "CONFLICT"   — an item with the same name already exists at target
	 *   "PROTECTED"  — source or target is a protected system directory
	 *   "SAME_PARENT"— source is already inside the target directory
	 *   "IO_ERROR"   — generic filesystem error
	 */
	errorCode?: "CYCLE" | "CONFLICT" | "PROTECTED" | "SAME_PARENT" | "IO_ERROR";
}

/** Client-side drop validation result (before any IPC call) */
export interface DropValidation {
	valid: boolean;
	/** Human-readable reason when valid === false */
	reason?: string;
}

// ── Sync Tasks ────────────────────────────────────────────────────────────────

/**
 * One entry in the sync-tasks payload: maps a delegator agent's .adata file
 * (located at metadata/<agentId>.adata) to the real names of the agents it
 * currently delegates to.
 *
 * The handler will write `permissions.task` as an object whose keys are the
 * agent names and whose values are 'allow' (or the pre-existing value when the
 * agent was already present).  Agents that are no longer delegated are removed.
 */
export interface SyncTasksEntry {
	/** Agent ID (file: metadata/<agentId>.adata) */
	agentId: string;
	/** Real names (not IDs) of the currently-delegated target agents */
	taskAgentNames: string[];
}

export interface SyncTasksRequest {
	projectDir: string;
	/**
	 * One entry per real canvas agent (user-node excluded).
	 *
	 * Agents with no outgoing Delegation links MUST still be included with
	 * `taskAgentNames: []` so that the handler can clear any stale
	 * `permissions.task` values that were written by a previous save.
	 *
	 * Use `buildSyncTaskEntries()` from `src/shared/syncTaskEntries.ts` to
	 * construct this array — it handles all edge-cases automatically.
	 */
	entries: SyncTasksEntry[];
}

export interface SyncTasksResult {
	/** Number of .adata files successfully updated */
	updated: number;
	/** Per-agent error messages for any that failed */
	errors: string[];
}

// ── GitHub HTTP fetch IPC types ────────────────────────────────────────────
//
// Proxies HTTP GET requests to api.github.com through the main process so
// that the renderer is never subject to CSP connect-src restrictions when
// querying the GitHub API.
//
// Only GET requests are supported. The renderer passes the full URL and an
// optional Authorization header (Bearer token); the main process performs
// the fetch using Node's built-in `https` module and returns the status code
// plus the raw response body as a string.
//
// Security notes:
//   - Only HTTPS URLs starting with "https://api.github.com/" are accepted.
//     Any other URL is rejected with errorCode "INVALID_URL" before any
//     network call is made.
//   - The Authorization header value is never logged.
//   - The renderer never gets a raw Node http.ClientRequest — only the
//     serialized result crosses the bridge.

/**
 * Request payload for the GITHUB_FETCH channel.
 */
export interface GitHubFetchRequest {
	/**
	 * Full HTTPS URL to fetch. Must start with "https://api.github.com/".
	 * Any other origin is rejected with errorCode "INVALID_URL".
	 */
	url: string;
	/**
	 * Optional Bearer token sent as the Authorization header.
	 * When omitted, the request is made without authentication (rate-limited).
	 */
	token?: string;
}

/**
 * Result returned by the GITHUB_FETCH channel.
 *
 * Always resolves — never rejects. Errors are surfaced via `errorCode`.
 */
export interface GitHubFetchResult {
	success: boolean;
	/** HTTP status code returned by the GitHub API (e.g. 200, 404, 403) */
	status?: number;
	/** Raw response body as a UTF-8 string (typically JSON) */
	body?: string;
	/** Human-readable error message when success === false */
	error?: string;
	/**
	 * Machine-readable error code:
	 *   "INVALID_URL"    — URL rejected before any network call (not api.github.com)
	 *   "NETWORK_ERROR"  — connection failed or timed out
	 *   "UNKNOWN"        — unexpected error
	 */
	errorCode?: "INVALID_URL" | "NETWORK_ERROR" | "UNKNOWN";
}

// ── Git Clone IPC types ────────────────────────────────────────────────────
//
// Clones a remote Git repository by spawning `git clone` in the main process.
// The renderer passes a URL and a destination directory; the main process
// runs `git clone --progress -- <url> <destDir>/<repoName>` and returns the result.
//
// Cancellation: supported via GIT_CLONE_CANCEL channel (sends SIGTERM/SIGKILL).
// Progress streaming: supported via GIT_CLONE_PROGRESS events (stderr parsing).
// Token validation: supported via GIT_CLONE_VALIDATE channel (GitHub API check).
//
// Correlation: every clone operation is identified by a UUID `cloneId` that
// the renderer generates and passes in the request. All progress events and
// the final result are tagged with this ID.
//
// Security:
//   - Credentials (username + token) are NEVER logged or persisted.
//   - The authenticated URL is cleared from memory immediately after spawn.
//   - GIT_TERMINAL_PROMPT=0 and GIT_ASKPASS="" prevent interactive prompts.
//   - Maximum concurrent clones: MAX_CONCURRENT_CLONES (3).

/**
 * Ephemeral auth credentials for private repos.
 * SECURITY: Do NOT log or persist — in-memory only.
 */
export interface CloneRepositoryAuth {
	/** GitHub username */
	username: string;
	/** GitHub Personal Access Token — scope: repo (or minimum required) */
	token: string;
}

/**
 * Request payload for the GIT_CLONE channel.
 */
export interface CloneRepositoryRequest {
	/**
	 * Unique identifier for this clone operation (UUID v4 generated by the renderer).
	 * Used to correlate progress events, the final result, and cancellation requests.
	 */
	cloneId: string;
	/** Git remote URL (validated by the renderer before sending) */
	url: string;
	/** Absolute path to the parent directory where the repo will be cloned */
	destDir: string;
	/**
	 * Target folder name inside destDir.
	 * When omitted, the main process derives it from the URL (last segment, no .git).
	 */
	repoName?: string;
	/**
	 * Ephemeral credentials for private repos.
	 * SECURITY: The receiver MUST NOT persist or log these values.
	 */
	auth?: CloneRepositoryAuth;
}

/**
 * Result returned by the GIT_CLONE channel.
 *
 * Always resolves (never rejects) — errors are surfaced via `errorCode`.
 */
export interface CloneRepositoryResult {
	success: boolean;
	/** The cloneId from the request — for correlation in the renderer */
	cloneId?: string;
	/** Absolute path of the cloned repository on success */
	clonedPath?: string;
	/** Human-readable error message when success === false */
	error?: string;
	/**
	 * Machine-readable error code for pattern-matching in the UI:
	 *   "INVALID_URL"    — URL rejected before git was invoked
	 *   "GIT_NOT_FOUND"  — `git` binary not found on PATH
	 *   "AUTH_ERROR"     — authentication failure (exit 128 + auth hint)
	 *   "DEST_EXISTS"    — destination directory already exists and is non-empty
	 *   "NETWORK_ERROR"  — network unreachable / could not resolve host
	 *   "IO_ERROR"       — generic filesystem error
	 *   "CANCELLED"      — operation was cancelled by the user
	 *   "CONCURRENT_LIMIT" — maximum concurrent clones reached
	 *   "UNKNOWN"        — git exited with a non-zero code not matched above
	 */
	errorCode?:
		| "INVALID_URL"
		| "GIT_NOT_FOUND"
		| "AUTH_ERROR"
		| "DEST_EXISTS"
		| "NETWORK_ERROR"
		| "IO_ERROR"
		| "CANCELLED"
		| "CONCURRENT_LIMIT"
		| "UNKNOWN";
	/**
	 * Sanitized technical details (no credentials) for display in the UI's
	 * "Detalles técnicos" collapsible section.
	 */
	technicalDetails?: string;
}

/**
 * Progress event emitted by the main process during a clone operation.
 * Sent via `event.sender.send('git:clone:progress', payload)`.
 *
 * Stage keys map to git's progress output:
 *   COUNTING_OBJECTS   — "Counting objects: N% (n/total)"
 *   COMPRESSING        — "Compressing objects: N%"
 *   RECEIVING_OBJECTS  — "Receiving objects: N% (n/total), X MiB"
 *   RESOLVING_DELTAS   — "Resolving deltas: N% (n/total)"
 *   CHECKING_OUT       — "Checking out files: N%"
 */
export type CloneProgressStage =
	| "COUNTING_OBJECTS"
	| "COMPRESSING"
	| "RECEIVING_OBJECTS"
	| "RESOLVING_DELTAS"
	| "CHECKING_OUT"
	| "UNKNOWN_STAGE";

export interface CloneProgressEvent {
	/** Correlates to the cloneId in CloneRepositoryRequest */
	cloneId: string;
	/** Normalized stage key */
	stage: CloneProgressStage;
	/** Completion percentage (0–100), or undefined if not parseable */
	percent?: number;
	/** Raw sanitized line from git stderr (no credentials) */
	raw: string;
}

/**
 * Request payload for the GIT_CLONE_CANCEL channel.
 */
export interface CloneCancelRequest {
	/** The cloneId of the operation to cancel */
	cloneId: string;
}

/**
 * Result returned by the GIT_CLONE_CANCEL channel.
 */
export interface CloneCancelResult {
	/** Whether the cancel signal was sent (false if cloneId not found) */
	sent: boolean;
	/** Human-readable status message */
	message: string;
}

/**
 * Request payload for the GIT_CLONE_VALIDATE channel.
 * Validates a GitHub token against the GitHub API before cloning.
 *
 * SECURITY: token is used only for the API request and never logged or persisted.
 */
export interface CloneValidateRequest {
	/** GitHub Personal Access Token to validate */
	token: string;
	/** GitHub username (used for display only — not sent to the API) */
	username?: string;
}

/**
 * Result returned by the GIT_CLONE_VALIDATE channel.
 */
export interface CloneValidateResult {
	/** Whether the token is valid and has the required permissions */
	valid: boolean;
	/**
	 * HTTP status code from the GitHub API:
	 *   200 — token valid
	 *   401 — token invalid or expired
	 *   403 — token lacks required scope or rate-limited
	 *   429 — rate limited
	 */
	status?: number;
	/** Human-readable result message */
	message: string;
	/**
	 * Specific validation error code:
	 *   "TOKEN_INVALID"      — 401: token invalid or expired
	 *   "TOKEN_NO_SCOPE"     — 403: token valid but lacks repo scope
	 *   "RATE_LIMITED"       — 429 or 403 with rate-limit headers
	 *   "NETWORK_ERROR"      — could not reach api.github.com
	 *   "UNKNOWN"            — unexpected error
	 */
	errorCode?:
		| "TOKEN_INVALID"
		| "TOKEN_NO_SCOPE"
		| "RATE_LIMITED"
		| "NETWORK_ERROR"
		| "UNKNOWN";
}

/**
 * Request payload for the GIT_SAVE_CREDENTIALS channel.
 */
export interface SaveGitCredentialsRequest {
	/** Absolute path to the cloned project root */
	projectDir: string;
	/** GitHub username */
	username: string;
	/** GitHub Personal Access Token — NEVER log this value */
	token: string;
}

/**
 * Result returned by the GIT_SAVE_CREDENTIALS channel.
 */
export interface SaveGitCredentialsResult {
	success: boolean;
	/** Absolute path to the written .env file (on success) */
	envPath?: string;
	/** Human-readable error message (on failure) */
	error?: string;
	/**
	 * "IO_ERROR"     — filesystem write failed
	 * "INVALID_DIR"  — projectDir does not exist or is not a directory
	 * "EMPTY_CREDS"  — username or token is empty
	 */
	errorCode?: "IO_ERROR" | "INVALID_DIR" | "EMPTY_CREDS";
}

// ── Git Branches IPC types ─────────────────────────────────────────────────

/** Un commit de git serializable */
export interface GitCommit {
	/** Hash corto del commit (7 chars) */
	hash: string;
	/** Hash completo */
	fullHash: string;
	/** Mensaje del commit (primera línea) */
	message: string;
	/** Autor del commit */
	author: string;
	/** Fecha ISO 8601 del commit */
	date: string;
	/** Fecha relativa legible (e.g. "2 days ago") */
	relativeDate: string;
}

/** Una rama de git */
export interface GitBranch {
	/** Nombre de la rama (sin prefijo remoto) */
	name: string;
	/** True si es la rama actualmente activa (HEAD) */
	isCurrent: boolean;
	/** True si es una rama remota */
	isRemote: boolean;
	/** Nombre del remoto (e.g. "origin"), solo para ramas remotas */
	remote?: string;
	/** True si la rama tiene un tracking remoto configurado */
	hasUpstream: boolean;
	/** Número de commits locales no pusheados al remoto */
	aheadCount?: number;
	/** Número de commits remotos no pulleados al local */
	behindCount?: number;
}

// ── Error envelope compartido ──────────────────────────────────────────────

export type GitOperationErrorCode =
	| "E_NOT_A_GIT_REPO"
	| "E_NO_REMOTE"
	| "E_GIT_NOT_FOUND"
	| "E_INIT_FAILED"
	| "E_REMOTE_ALREADY_EXISTS"
	| "E_INVALID_REMOTE_URL"
	| "E_CREDENTIALS_SAVE_FAILED"
	| "E_IDENTITY_SET_FAILED"
	| "E_MERGE_CONFLICT"
	| "E_DIRTY_WORKING_DIR"
	| "E_BRANCH_NOT_FOUND"
	| "E_BRANCH_ALREADY_EXISTS"
	| "E_INVALID_BRANCH_NAME"
	| "E_NOTHING_TO_COMMIT"
	| "E_EMPTY_COMMIT_MSG"
	| "E_PROTECTED_BRANCH"
	| "E_DIVERGENCE_SAVE_FAILED"
	| "E_TIMEOUT"
	| "E_PUSH_FAILED"
	| "E_UNKNOWN";

export interface GitOperationError {
	ok: false;
	code: GitOperationErrorCode;
	/**
	 * Mensaje legible para UI. Para E_UNKNOWN puede contener stderr real de git.
	 */
	message: string;
	/** stderr real de git sin procesar (si existe) */
	gitStderr?: string;
	/** Output raw del comando git (para debugging) */
	rawOutput?: string;
}

// ── GIT_GET_CONFIG / GIT_INIT / GIT_SET_REMOTE / GIT_SAVE_CREDENTIALS / GIT_SET_IDENTITY ──

export interface GitGetConfigRequest {
	projectDir: string;
}

export interface GitGetConfigResult {
	ok: true;
	hasGit: boolean;
	remoteUrl: string | null;
}

export type GitGetConfigResponse = GitGetConfigResult | GitOperationError;

export interface GitInitRequest {
	projectDir: string;
}

export interface GitInitResult {
	ok: true;
	output: string;
}

export type GitInitResponse = GitInitResult | GitOperationError;

export interface GitSetRemoteRequest {
	projectDir: string;
	url: string;
}

export interface GitSetRemoteResult {
	ok: true;
	remoteUrl: string;
}

export type GitSetRemoteResponse = GitSetRemoteResult | GitOperationError;

export interface GitSaveCredentialsRequest {
	projectDir: string;
	url: string;
	username: string;
	password: string;
}

export interface GitSaveCredentialsResult {
	ok: true;
}

export type GitSaveCredentialsResponse =
	| GitSaveCredentialsResult
	| GitOperationError;

export interface GitSetIdentityRequest {
	projectDir: string;
	userName: string;
	userEmail: string;
}

export interface GitSetIdentityResult {
	ok: true;
}

export type GitSetIdentityResponse = GitSetIdentityResult | GitOperationError;

export interface GitDetectMainBranchRequest {
	projectDir: string;
}

/** Response for GIT_DETECT_MAIN_BRANCH */
export type GitDetectMainBranchResponse =
	| { ok: true; branch: string | null }
	| GitOperationError;

// ── GIT_HANDLE_DIVERGENCE ──────────────────────────────────────────────────

export interface GitHandleDivergenceRequest {
	projectDir: string;
	remoteBranch: string;
}

export interface GitHandleDivergenceResult {
	ok: true;
	divergenceDetected: boolean;
	savedBranch: string | null;
	message: string | null;
}

export type GitHandleDivergenceResponse =
	| GitHandleDivergenceResult
	| GitOperationError;

// ── GIT_LIST_BRANCHES ──────────────────────────────────────────────────────

export interface GitListBranchesRequest {
	projectDir: string;
}

export interface GitListBranchesResult {
	ok: true;
	/** Nombre de la rama activa actual */
	currentBranch: string;
	/** Todas las ramas locales (incluye main/master para info de currentBranch) */
	branches: GitBranch[];
}

export type GitListBranchesResponse = GitListBranchesResult | GitOperationError;

// ── GIT_GET_REMOTE_DIFF ────────────────────────────────────────────────────

export interface GitGetRemoteDiffRequest {
	projectDir: string;
	/** Rama a comparar (por defecto la rama actual) */
	branch?: string;
}

export interface GitGetRemoteDiffResult {
	ok: true;
	/** Commits en el remoto que no están en local */
	incomingCommits: GitCommit[];
	/** Número de commits locales no pusheados */
	aheadCount: number;
	/** Número de commits remotos no pulleados */
	behindCount: number;
	/** True si no hay remoto configurado para esta rama */
	noUpstream: boolean;
}

export type GitGetRemoteDiffResponse =
	| GitGetRemoteDiffResult
	| GitOperationError;

// ── GIT_FETCH_AND_PULL ─────────────────────────────────────────────────────

export interface GitFetchAndPullRequest {
	projectDir: string;
}

export interface GitFetchAndPullResult {
	ok: true;
	/** Output del comando git pull */
	output: string;
	/** True si ya estaba up-to-date */
	alreadyUpToDate: boolean;
}

export type GitFetchAndPullResponse = GitFetchAndPullResult | GitOperationError;

// ── GIT_PULL_BRANCH ────────────────────────────────────────────────────────

export interface GitPullBranchRequest {
	projectDir: string;
	/** Nombre de la rama a pullear */
	branch: string;
}

export interface GitPullBranchResult {
	ok: true;
	output: string;
	alreadyUpToDate: boolean;
}

export type GitPullBranchResponse = GitPullBranchResult | GitOperationError;

// ── GIT_CHECKOUT_BRANCH ────────────────────────────────────────────────────

export interface GitCheckoutBranchRequest {
	projectDir: string;
	/** Nombre de la rama a la que cambiar */
	branch: string;
}

export interface GitCheckoutBranchResult {
	ok: true;
	/** Nombre de la rama a la que se cambió */
	branch: string;
	output: string;
}

export type GitCheckoutBranchResponse =
	| GitCheckoutBranchResult
	| GitOperationError;

// ── GIT_ENSURE_LOCAL_BRANCH ───────────────────────────────────────────────

export interface GitEnsureLocalBranchRequest {
	projectDir: string;
	/** Nombre de la rama principal/protegida a asegurar localmente */
	branch: string;
}

export interface GitEnsureLocalBranchResult {
	ok: true;
	/** Nombre de la rama asegurada */
	branch: string;
	/** True si se creó localmente desde origin/<branch> */
	created: boolean;
	output: string;
}

export type GitEnsureLocalBranchResponse =
	| GitEnsureLocalBranchResult
	| GitOperationError;

// ── GIT_GET_BRANCH_COMMITS ─────────────────────────────────────────────────

export interface GitGetBranchCommitsRequest {
	projectDir: string;
	/** Nombre de la rama */
	branch: string;
	/** Número máximo de commits a retornar (default: 20) */
	limit?: number;
}

export interface GitGetBranchCommitsResult {
	ok: true;
	branch: string;
	commits: GitCommit[];
}

export type GitGetBranchCommitsResponse =
	| GitGetBranchCommitsResult
	| GitOperationError;

// ── GIT_CREATE_BRANCH ───────────────────────────────────────────────────────

export interface GitCreateBranchRequest {
	projectDir: string;
	/** Nombre de la nueva rama a crear */
	newBranchName: string;
	/** Rama base desde la cual crear la nueva rama */
	sourceBranch: string;
	/** Rama protegida configurada por el usuario */
	protectedBranch?: string;
}

export interface GitCreateBranchSuccess {
	ok: true;
	/** Nombre de la rama creada */
	branch: string;
	/** Siempre true: se hace checkout automático a la rama creada */
	checkedOut: boolean;
}

export type GitCreateBranchResponse =
	| GitCreateBranchSuccess
	| GitOperationError;

// ── GIT_GET_STATUS / GIT_ADD_AND_COMMIT ───────────────────────────────────

export type GitFileStatusCode =
	| "M"
	| "A"
	| "D"
	| "R"
	| "C"
	| "U"
	| "?"
	| " ";

export interface GitChangedFile {
	path: string;
	stagedStatus: GitFileStatusCode;
	unstagedStatus: GitFileStatusCode;
	isStaged: boolean;
	isUnstaged: boolean;
	isUntracked: boolean;
	originalPath?: string;
}

export interface GitGetStatusRequest {
	projectDir: string;
}

export interface GitGetStatusResult {
	ok: true;
	currentBranch: string;
	files: GitChangedFile[];
	stagedCount: number;
	unstagedCount: number;
}

export type GitGetStatusResponse = GitGetStatusResult | GitOperationError;

export interface GitAddAndCommitRequest {
	projectDir: string;
	message: string;
	description?: string;
	/** Rama protegida configurada por el usuario */
	protectedBranch?: string;
}

export interface GitAddAndCommitResult {
	ok: true;
	commitHash: string;
	output: string;
	/** True if a push was attempted (remote was detected) */
	pushAttempted: boolean;
	/** True if the push completed successfully */
	pushOk: boolean;
	/** Error message from the push, when pushOk === false */
	pushError?: string;
	/** URL of the remote that was pushed to */
	pushRemote?: string;
	/** Branch that was pushed */
	pushBranch?: string;
}

export type GitAddAndCommitResponse = GitAddAndCommitResult | GitOperationError;

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
	openFileDialog(options?: {
		title?: string;
		filters?: { name: string; extensions: string[] }[];
	}): Promise<string | null>;

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

	/**
	 * Moves a file or directory into a target directory.
	 * Validates cycles, name conflicts, and protected paths server-side.
	 * Returns AssetMoveResult.
	 */
	assetMove(payload: AssetMovePayload): Promise<AssetMoveResult>;

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
	adataGetOpenCodeConfig(
		req: AdataGetOpenCodeConfigRequest,
	): Promise<AdataGetOpenCodeConfigResult>;

	/**
	 * Writes (creates or updates) the opencode config object in the agent's .adata file.
	 * Stored under the 'opencode' top-level key.
	 */
	adataSetOpenCodeConfig(
		req: AdataSetOpenCodeConfigRequest,
	): Promise<AdataSetOpenCodeConfigResult>;

	// ── Agent Profiling ───────────────────────────────────────────────────────

	/**
	 * Returns the full profile[] list for an agent, sorted by order.
	 * Returns an empty array when the agent has no profiles yet.
	 */
	adataListProfiles(
		req: AdataListProfilesRequest,
	): Promise<AdataListProfilesResult>;

	/**
	 * Appends a new profile entry to the agent's profile list.
	 * Returns the newly created entry and the updated full list.
	 */
	adataAddProfile(req: AdataAddProfileRequest): Promise<AdataAddProfileResult>;

	/**
	 * Updates specific fields of an existing profile entry.
	 * Returns the complete updated profile list.
	 */
	adataUpdateProfile(
		req: AdataUpdateProfileRequest,
	): Promise<AdataUpdateProfileResult>;

	/**
	 * Removes a profile entry by id.
	 * Does NOT delete the underlying .md file.
	 * Returns the complete updated profile list.
	 */
	adataRemoveProfile(
		req: AdataRemoveProfileRequest,
	): Promise<AdataRemoveProfileResult>;

	/**
	 * Reorders the profile list by supplying profile UUIDs in the new desired order.
	 * Returns the complete updated profile list.
	 */
	adataReorderProfiles(
		req: AdataReorderProfilesRequest,
	): Promise<AdataReorderProfilesResult>;

	// ── Permissions ───────────────────────────────────────────────────────────

	/**
	 * Reads the permissions object from the agent's .adata file.
	 * Returns an empty object when no permissions are set.
	 */
	adataGetPermissions(
		req: AdataGetPermissionsRequest,
	): Promise<AdataGetPermissionsResult>;

	/**
	 * Writes (replaces) the full permissions object in the agent's .adata file.
	 * Stored under the 'permissions' top-level key as a plain object.
	 */
	adataSetPermissions(
		req: AdataSetPermissionsRequest,
	): Promise<AdataSetPermissionsResult>;

	// ── Skills ────────────────────────────────────────────────────────────────

	/**
	 * Lists all skill names found under {projectDir}/skills/ recursively.
	 * Returns a sorted array of skill names (dash-joined relative paths).
	 * Returns an empty array when the skills directory does not exist.
	 */
	adataListSkills(req: AdataListSkillsRequest): Promise<AdataListSkillsResult>;

	// ── Agent rename (slug-first) ─────────────────────────────────────────────

	/**
	 * Renames the behaviors/<oldSlug> folder to behaviors/<newSlug> on disk.
	 * Updates all path references inside the agent's .adata file.
	 * Returns CONFLICT if the target folder already exists.
	 */
	renameAgentFolder(
		req: RenameAgentFolderRequest,
	): Promise<RenameAgentFolderResult>;

	// ── Export ────────────────────────────────────────────────────────────────

	/**
	 * Opens a native folder picker dialog for selecting the export destination.
	 * Returns the chosen directory path, or null if cancelled.
	 */
	selectExportDir(): Promise<SelectExportDirResult>;

	/**
	 * Writes the generated export config file to the chosen directory.
	 * Returns the final absolute path of the written file.
	 */
	writeExportFile(req: WriteExportFileRequest): Promise<WriteExportFileResult>;

	/**
	 * Lists all SKILL.md files under {projectDir}/skills/ with their content.
	 * Used by the Export modal Skills tab.
	 */
	listSkillsFull(req: ListSkillsFullRequest): Promise<ListSkillsFullResult>;

	/**
	 * Reads all profile .md files for an agent, sorted by order.
	 * Returns concatenated content and individual file contents.
	 * Used by the Export modal Agents tab.
	 */
	readAgentProfilesFull(
		req: ReadAgentProfilesFullRequest,
	): Promise<ReadAgentProfilesFullResult>;

	/**
	 * Reads the raw .adata JSON object for an agent.
	 * Used by the Export modal Agents tab properties preview.
	 */
	readAgentAdataRaw(
		req: ReadAgentAdataRawRequest,
	): Promise<ReadAgentAdataRawResult>;

	// ── Folder Explorer ───────────────────────────────────────────────────────
	//
	// Home-sandboxed in-app directory browser. The three methods here mirror
	// the three IPC channels in FOLDER_EXPLORER_CHANNELS.
	//
	// Security: every path is validated server-side (main process) before any
	// filesystem operation — the renderer never gets an unvalidated result.
	// Paths returned in responses are guaranteed to be inside $HOME.

	/**
	 * Lists the visible entries of a single directory under $HOME.
	 *
	 * On success: `{ ok: true, dirPath, entries: FolderExplorerDirEntry[] }`
	 * On failure: `{ ok: false, code: FolderExplorerErrorCode, message }`
	 */
	folderExplorerList(
		req: FolderExplorerListRequest,
	): Promise<FolderExplorerListResponse>;

	/**
	 * Returns metadata (exists, isDirectory, readable) for a single $HOME path.
	 * Unlike `folderExplorerList`, this works for both files and directories.
	 * Returns `{ ok: true, stat: { exists: false } }` for non-existent but
	 * in-home paths instead of an error, so callers can safely probe existence.
	 */
	folderExplorerStat(
		req: FolderExplorerStatRequest,
	): Promise<FolderExplorerStatResponse>;

	/**
	 * Batch-lists multiple directories in parallel. Each path in `paths` is
	 * processed independently — a single bad path does not abort the whole
	 * batch. The response always has `ok: true` at the top level; per-entry
	 * failures are surfaced in the `results` record.
	 */
	folderExplorerReadChildren(
		req: FolderExplorerReadChildrenRequest,
	): Promise<FolderExplorerReadChildrenResponse>;

	// ── Skills export ─────────────────────────────────────────────────────────

	/**
	 * Copies all active skill directories from {projectDir}/skills/ to
	 * {destDir}/skills/. When a destination file already exists, the main
	 * process sends a SKILL_CONFLICT_PROMPT event to the renderer.
	 *
	 * The renderer must have registered a conflict listener via onSkillConflict()
	 * before calling this — otherwise conflicts cannot be resolved and the
	 * export will time out.
	 *
	 * Returns ExportSkillsResult (success, aborted, copiedSkills, skippedSkills).
	 */
	exportSkills(req: ExportSkillsRequest): Promise<ExportSkillsResult>;

	/**
	 * Registers a callback that is invoked whenever the main process sends a
	 * SKILL_CONFLICT_PROMPT event (a file already exists in the destination).
	 *
	 * The callback receives the ExportSkillsConflictPrompt and must respond
	 * by calling respondSkillConflict() with the same promptId.
	 *
	 * Only one listener is active at a time — calling this again replaces the
	 * previous listener.
	 */
	onSkillConflict(callback: (prompt: ExportSkillsConflictPrompt) => void): void;

	/**
	 * Removes the SKILL_CONFLICT_PROMPT listener registered via onSkillConflict().
	 * Must be called when the component that handles conflicts unmounts or closes.
	 */
	offSkillConflict(): void;

	/**
	 * Sends the user's conflict resolution choice back to the main process.
	 * The promptId must match the one received in the ExportSkillsConflictPrompt.
	 */
	respondSkillConflict(response: ExportSkillsConflictResponse): void;

	/**
	 * Exports agent profiles from metadata/*.adata as concatenated .md files
	 * to [destDir]/prompts/[projectName]/[agentName].md.
	 *
	 * When a destination file already exists, the main process sends a
	 * PROFILE_CONFLICT_PROMPT event and waits for a response via
	 * respondProfileConflict().
	 *
	 * Returns ExportAgentProfilesResult with exported agents, skipped agents,
	 * warnings, and summary statistics.
	 */
	exportAgentProfiles(
		req: ExportAgentProfilesRequest,
	): Promise<ExportAgentProfilesResult>;

	/**
	 * Registers a callback that is invoked whenever the main process sends a
	 * PROFILE_CONFLICT_PROMPT event (a file already exists in the destination).
	 *
	 * The callback receives the ExportProfileConflictPrompt and must respond
	 * by calling respondProfileConflict() with the same promptId.
	 *
	 * Only one listener is active at a time — calling this again replaces the
	 * previous listener.
	 */
	onProfileConflict(
		callback: (prompt: ExportProfileConflictPrompt) => void,
	): void;

	/**
	 * Removes the PROFILE_CONFLICT_PROMPT listener registered via onProfileConflict().
	 * Must be called when the component that handles conflicts unmounts or closes.
	 */
	offProfileConflict(): void;

	/**
	 * Sends the user's conflict resolution choice back to the main process.
	 * The promptId must match the one received in the ExportProfileConflictPrompt.
	 */
	respondProfileConflict(response: ExportProfileConflictResponse): void;

	/**
	 * Writes `permissions.task` for each delegator agent described in the payload.
	 * Only the `task` key inside `permissions` is modified — all other .adata fields
	 * (and all other keys inside `permissions`) are preserved via partial merge.
	 *
	 * Returns SyncTasksResult: { updated, errors[] }.
	 * Errors are accumulated per-agent (non-fatal); the batch continues even if
	 * one agent fails.
	 */
	syncTasks(req: SyncTasksRequest): Promise<SyncTasksResult>;

	// ── GitHub HTTP fetch ─────────────────────────────────────────────────────

	/**
	 * Proxies an HTTPS GET request to api.github.com through the main process.
	 *
	 * The renderer cannot call fetch("https://api.github.com/...") directly
	 * because the CSP connect-src directive restricts external origins in the
	 * Chromium renderer. This method delegates the network call to the main
	 * process (Node.js), which is not subject to CSP.
	 *
	 * Only URLs starting with "https://api.github.com/" are accepted.
	 * All other origins are rejected immediately with errorCode "INVALID_URL".
	 *
	 * Always resolves — never rejects. Network and auth errors are surfaced
	 * via `success: false` and `errorCode`.
	 *
	 * @example
	 * ```ts
	 * const res = await window.agentsFlow.githubFetch({
	 *   url: "https://api.github.com/repos/owner/repo",
	 *   token: myToken,   // optional Bearer token
	 * });
	 * if (res.success && res.status === 200) {
	 *   const data = JSON.parse(res.body!);
	 * }
	 * ```
	 */
	githubFetch(req: GitHubFetchRequest): Promise<GitHubFetchResult>;

	// ── Git Clone ─────────────────────────────────────────────────────────────

	/**
	 * Clones a remote Git repository by spawning `git clone --progress` in the
	 * main process. Progress events are streamed via `onCloneProgress()`.
	 *
	 * The repository is cloned into `<req.destDir>/<repoName>` where `repoName`
	 * is derived from the URL (last path segment, `.git` stripped).
	 *
	 * Resolves with `CloneRepositoryResult` on both success and failure —
	 * never rejects (network/auth/IO errors are surfaced via `errorCode`).
	 *
	 * SECURITY: `req.auth` credentials are never logged or persisted.
	 */
	cloneRepository(req: CloneRepositoryRequest): Promise<CloneRepositoryResult>;

	/**
	 * Cancels an in-progress clone operation identified by `cloneId`.
	 * Sends SIGTERM to the child process; if it does not exit within 5s,
	 * SIGKILL is sent. Returns immediately with CloneCancelResult.
	 */
	cancelClone(req: CloneCancelRequest): Promise<CloneCancelResult>;

	/**
	 * Validates a GitHub Personal Access Token against the GitHub API
	 * (GET https://api.github.com/user).
	 *
	 * Returns CloneValidateResult with:
	 *   - valid: true  → token is valid (HTTP 200)
	 *   - valid: false → token invalid (401), no scope (403), rate-limited (429)
	 *
	 * SECURITY: token is used only for the API call — never logged or persisted.
	 */
	validateCloneToken(req: CloneValidateRequest): Promise<CloneValidateResult>;

	/**
	 * Saves Git credentials in <projectDir>/.env and ensures .env is listed in
	 * <projectDir>/.gitignore.
	 *
	 * SECURITY: the token must never be logged or persisted outside .env.
	 */
	saveGitCredentials(
		req: SaveGitCredentialsRequest,
	): Promise<SaveGitCredentialsResult>;

	/**
	 * Detects repository git config state for the given project directory.
	 * Returns whether .git exists and the current origin URL (if configured).
	 */
	gitGetConfig(req: GitGetConfigRequest): Promise<GitGetConfigResponse>;

	/**
	 * Initializes a Git repository in the project directory using `git init`.
	 */
	gitInit(req: GitInitRequest): Promise<GitInitResponse>;

	/**
	 * Adds or updates the `origin` remote URL in the repository.
	 */
	gitSetRemote(req: GitSetRemoteRequest): Promise<GitSetRemoteResponse>;

	/**
	 * Saves repository credentials for private remotes using Git credential flow.
	 */
	gitSaveCredentials(
		req: GitSaveCredentialsRequest,
	): Promise<GitSaveCredentialsResponse>;

	/**
	 * Sets local git identity for the repository (`user.name`, `user.email`).
	 */
	gitSetIdentity(req: GitSetIdentityRequest): Promise<GitSetIdentityResponse>;

	/**
	 * Detects the main/protected branch from the configured remote origin.
	 * Returns branch name when detected, or null when detection is not possible.
	 */
	gitDetectMainBranch(
		req: GitDetectMainBranchRequest,
	): Promise<GitDetectMainBranchResponse>;

	gitHandleDivergence(
		req: GitHandleDivergenceRequest,
	): Promise<GitHandleDivergenceResponse>;

	/**
	 * Registers a callback invoked whenever the main process emits a
	 * `git:clone:progress` event for any active clone.
	 *
	 * The callback receives a CloneProgressEvent with cloneId, stage, percent,
	 * and sanitized raw line. Use `cloneId` to route events to the correct UI.
	 *
	 * Only one listener is active at a time — calling this again replaces the
	 * previous listener.
	 */
	onCloneProgress(callback: (event: CloneProgressEvent) => void): void;

	/**
	 * Removes the `git:clone:progress` listener registered via onCloneProgress().
	 * Must be called when the component that handles progress unmounts or closes.
	 */
	offCloneProgress(): void;

	// ── Git remote origin detection ───────────────────────────────────────────

	/**
	 * Detects whether `projectDir` is a Git repository and returns the URL of
	 * the remote named `origin`, or `null` when:
	 *   - the directory has no `.git` entry
	 *   - there is no remote named `origin`
	 *   - `git` is not available on PATH
	 *   - any error occurs
	 *
	 * Always resolves — never rejects.
	 */
	getGitRemoteOrigin(projectDir: string): Promise<string | null>;

	gitListBranches(
		req: GitListBranchesRequest,
	): Promise<GitListBranchesResponse>;
	gitGetRemoteDiff(
		req: GitGetRemoteDiffRequest,
	): Promise<GitGetRemoteDiffResponse>;
	gitFetchAndPull(
		req: GitFetchAndPullRequest,
	): Promise<GitFetchAndPullResponse>;
	gitPullBranch(req: GitPullBranchRequest): Promise<GitPullBranchResponse>;
	gitCheckoutBranch(
		req: GitCheckoutBranchRequest,
	): Promise<GitCheckoutBranchResponse>;
	gitEnsureLocalBranch(
		req: GitEnsureLocalBranchRequest,
	): Promise<GitEnsureLocalBranchResponse>;
	gitGetBranchCommits(
		req: GitGetBranchCommitsRequest,
	): Promise<GitGetBranchCommitsResponse>;
	gitCreateBranch(req: GitCreateBranchRequest): Promise<GitCreateBranchResponse>;
	gitGetStatus(req: GitGetStatusRequest): Promise<GitGetStatusResponse>;
	gitAddAndCommit(
		req: GitAddAndCommitRequest,
	): Promise<GitAddAndCommitResponse>;
}

// ── Global type augmentation ──────────────────────────────────────────────
// Extend the Window interface so TypeScript knows about window.agentsFlow
// everywhere in the renderer without casting.

declare global {
	interface Window {
		agentsFlow: AgentsFlowBridge;
		/**
		 * Static OS paths exposed by the preload via contextBridge.
		 * Resolved once on startup in the Node/Electron context.
		 * Use window.appPaths?.home instead of hard-coding "/home/<user>/".
		 */
		appPaths?: {
			/** os.homedir() — cross-platform user home directory. */
			home: string;
		};
	}
}
