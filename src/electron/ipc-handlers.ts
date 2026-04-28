/**
 * src/electron/ipc-handlers.ts
 *
 * IPC handler registration for the AgentsFlow main process.
 *
 * Each handler maps a channel name (from IPC_CHANNELS) to a function that:
 *   1. Receives arguments from the renderer (via ipcMain.handle)
 *   2. Calls the appropriate loader/file-system operation
 *   3. Returns a plain, serializable result back to the renderer
 *
 * ALL file system access happens here in the main process — never in the
 * renderer. This enforces the security boundary and keeps the renderer
 * stateless with respect to the filesystem.
 *
 * Recent projects are stored in a lightweight JSON file at:
 *   <app.getPath('userData')>/recent-projects.json
 */

import { ipcMain, dialog, app, BrowserWindow } from "electron";
import { join, basename, dirname, extname } from "node:path";
import {
	readFile,
	writeFile,
	chmod,
	mkdir,
	rename,
	rm,
	copyFile,
	readdir,
	stat,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import * as https from "node:https";

import { ProjectLoader } from "../loader/project-loader.ts";
import { atomicWriteJson } from "../loader/lock-manager.ts";
import {
	validateNewProjectDir,
	createProject,
} from "../loader/project-factory.ts";
import type { LoadResult, ProjectModel, AgentModel } from "../loader/types.ts";

import { IPC_CHANNELS } from "./bridge.types.ts";
import { buildAdataFromExisting } from "./adata-builder.ts";
import { backupExportFileIfExists } from "./export-file-backup.ts";
import { buildSyncTaskEntries } from "../shared/syncTaskEntries.ts";
import { detectGitRemoteOrigin } from "./git-detector.ts";
import type {
	BridgeLoadResult,
	SerializableProjectModel,
	SerializableAgentModel,
	LoadProjectRequest,
	ValidateProjectRequest,
	RepairProjectRequest,
	SaveProjectRequest,
	SaveAgentGraphRequest,
	SaveAgentGraphResult,
	AgentGraphNode,
	AgentGraphEdge,
	ExportProjectRequest,
	SaveProjectResult,
	ExportProjectResult,
	RecentProject,
	CreateProjectRequest,
	CreateProjectResult,
	NewProjectDirValidation,
	AssetDirEntry,
	AssetDirContents,
	AssetFileEntry,
	AssetOpResult,
	AssetReadResult,
	AssetMovePayload,
	AssetMoveResult,
	AdataAdapterRequest,
	AdataSetAdapterRequest,
	AdataGetAdapterResult,
	AdataSetAdapterResult,
	AdataGetOpenCodeConfigRequest,
	AdataSetOpenCodeConfigRequest,
	AdataGetOpenCodeConfigResult,
	AdataSetOpenCodeConfigResult,
	AdataListProfilesRequest,
	AdataAddProfileRequest,
	AdataUpdateProfileRequest,
	AdataRemoveProfileRequest,
	AdataReorderProfilesRequest,
	AdataGetPermissionsRequest,
	AdataSetPermissionsRequest,
	AdataListSkillsRequest,
	SyncTasksRequest,
	RenameAgentFolderRequest,
	RenameAgentFolderResult,
	WriteExportFileRequest,
	WriteExportFileResult,
	ListSkillsFullRequest,
	ListSkillsFullResult,
	ReadAgentProfilesFullRequest,
	ReadAgentProfilesFullResult,
	ReadAgentAdataRawRequest,
	ReadAgentAdataRawResult,
	SelectExportDirResult,
	ExportSkillsRequest,
	ExportSkillsResult,
	ExportSkillsConflictPrompt,
	ExportSkillsConflictResponse,
	ExportAgentProfilesRequest,
	ExportAgentProfilesResult,
	ExportProfileConflictPrompt,
	ExportProfileConflictResponse,
	CloneRepositoryRequest,
	CloneRepositoryResult,
	CloneProgressEvent,
	CloneCancelRequest,
	CloneCancelResult,
	CloneValidateRequest,
	CloneValidateResult,
	SaveGitCredentialsRequest,
	SaveGitCredentialsResult,
	GitHubFetchRequest,
	GitHubFetchResult,
} from "./bridge.types.ts";

import {
	handleListProfiles,
	handleAddProfile,
	handleUpdateProfile,
	handleRemoveProfile,
	handleReorderProfiles,
} from "./profile-handlers.ts";
import { exportAgentProfiles as exportAgentProfilesLogic } from "./profile-export-handlers.ts";
import { nodeFileAdapter } from "../storage/node-file-adapter.ts";
import { migrateProjectProfiles } from "../storage/migrate-profiles.ts";
import {
	getOpenCodeConfigFromAdata,
	OPENCODE_CONFIG_TEMPERATURE_DEFAULT,
	OPENCODE_CONFIG_HIDDEN_DEFAULT,
	OPENCODE_CONFIG_STEPS_DEFAULT,
	OPENCODE_CONFIG_COLOR_DEFAULT,
} from "./opencode-config-handlers.ts";
import {
	handleGetPermissions,
	handleSetPermissions,
	handleSyncTasks,
} from "./permissions-handlers.ts";
import { handleListSkills } from "./skills-handlers.ts";
import { handleRenameAgentFolder } from "./rename-agent-folder.ts";
import { exportActiveSkills } from "./skill-export-handlers.ts";
import { registerGitBranchesHandlers } from "./git-branches.ts";

// ── Folder Explorer ────────────────────────────────────────────────────────
// The folder-explorer handlers live in the electron-main module tree because
// they depend on the homeJail and filter utilities that also live there.
// We import the registration function (not the handlers directly) to keep
// the dependency direction clean: src/electron → electron-main/src/ipc.
//
// NOTE: registerFolderExplorerHandlers() receives `ipcMain` as a parameter
// so that it remains testable without a running Electron instance.
import {
	registerFolderExplorerHandlers,
	FOLDER_EXPLORER_CHANNELS,
} from "../../electron-main/src/ipc/index.ts";

// ── Git Clone — active process registry ───────────────────────────────────
//
// Maps cloneId (UUID) → ChildProcess for in-flight clone operations.
// Used by the cancel handler to send SIGTERM/SIGKILL.
// Entries are removed when the child process exits (close/error events).
//
// Security: credentials are NEVER stored here — only the process handle.
// Concurrency: limited to MAX_CONCURRENT_CLONES to prevent DoS.

import type { ChildProcess } from "node:child_process";

const activeClones = new Map<string, ChildProcess>();

/**
 * Set of cloneIds that have been explicitly cancelled by the user via
 * GIT_CLONE_CANCEL. This lives at module scope so the cancel handler
 * (a separate ipcMain.handle invocation) can signal the close handler
 * running inside the GIT_CLONE Promise closure.
 *
 * Without this, on platforms where Node delivers signal=null on kill()
 * (e.g. Windows), the close handler would not know the exit was a
 * user-initiated cancel and would misclassify it as an error.
 *
 * Entries are removed in the close/error handler immediately after use.
 */
const cancelledCloneIds = new Set<string>();

/** Maximum number of simultaneous git clone processes allowed */
const MAX_CONCURRENT_CLONES = 3;

/**
 * Sanitizes a string that may contain embedded credentials in a URL.
 * Replaces `https://user:pass@` with `https://[REDACTED]@` before logging.
 * SECURITY: Always call this before logging any git output or URL.
 */
function sanitizeCredentials(text: string): string {
	return text.replace(/https?:\/\/[^:@\s]+:[^@\s]+@/g, "https://[REDACTED]@");
}

/**
 * Ensures that ".env" appears as its own line in the .gitignore file.
 * Creates .gitignore if it does not exist and appends ".env" if missing.
 */
async function ensureEnvInGitignore(gitignorePath: string): Promise<void> {
	let content = "";

	if (existsSync(gitignorePath)) {
		content = await readFile(gitignorePath, "utf-8");
	}

	const lines = content.split(/\r?\n/);
	const alreadyListed = lines.some((line) => line.trim() === ".env");

	if (!alreadyListed) {
		const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
		await writeFile(gitignorePath, `${content}${separator}.env\n`, {
			encoding: "utf-8",
			flag: "w",
		});
	}
}

/**
 * Writes GIT_USERNAME and GIT_TOKEN to <projectDir>/.env (overwrite)
 * and ensures .env is listed in <projectDir>/.gitignore.
 */
async function saveGitCredentialsToEnv(
	projectDir: string,
	username: string,
	token: string,
): Promise<SaveGitCredentialsResult> {
	if (!username.trim() || !token.trim()) {
		return {
			success: false,
			errorCode: "EMPTY_CREDS",
			error: "Username and token must not be empty.",
		};
	}

	if (!existsSync(projectDir)) {
		return {
			success: false,
			errorCode: "INVALID_DIR",
			error: `Project directory does not exist: ${projectDir}`,
		};
	}

	try {
		const projectDirStat = await stat(projectDir);
		if (!projectDirStat.isDirectory()) {
			return {
				success: false,
				errorCode: "INVALID_DIR",
				error: `Project path is not a directory: ${projectDir}`,
			};
		}
	} catch (err) {
		return {
			success: false,
			errorCode: "INVALID_DIR",
			error: err instanceof Error ? err.message : String(err),
		};
	}

	const envPath = join(projectDir, ".env");
	const gitignorePath = join(projectDir, ".gitignore");

	try {
		const envContent = `GIT_USERNAME=${username}\nGIT_TOKEN=${token}\n`;
		await writeFile(envPath, envContent, { encoding: "utf-8", flag: "w" });

		try {
			await chmod(envPath, 0o600);
		} catch {
			// Non-fatal on Windows
		}

		try {
			await ensureEnvInGitignore(gitignorePath);
		} catch (err) {
			console.warn(
				"[git-credentials] Could not update .gitignore —",
				err instanceof Error ? err.message : String(err),
			);
		}

		console.log(
			`[git-credentials] .env written → ${envPath} (token length: ${token.length})`,
		);
		return { success: true, envPath };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("[git-credentials] Failed to write credentials —", message);
		return { success: false, errorCode: "IO_ERROR", error: message };
	}
}

/**
 * Maps a raw git stderr string to a CloneRepositoryResult errorCode.
 * Called after git exits with a non-zero code.
 */
function mapGitStderrToErrorCode(
	stderr: string,
): CloneRepositoryResult["errorCode"] {
	const s = stderr.toLowerCase();
	if (
		s.includes("authentication failed") ||
		s.includes("could not read username") ||
		s.includes("invalid username or password") ||
		s.includes("repository not found") ||
		s.includes("access denied") ||
		s.includes("403") ||
		s.includes("401")
	) {
		return "AUTH_ERROR";
	}
	if (
		s.includes("could not resolve host") ||
		s.includes("network is unreachable") ||
		s.includes("connection timed out") ||
		s.includes("unable to connect") ||
		s.includes("failed to connect")
	) {
		return "NETWORK_ERROR";
	}
	if (s.includes("permission denied") || s.includes("read-only file system")) {
		return "IO_ERROR";
	}
	return "UNKNOWN";
}

/**
 * Maps a CloneRepositoryResult errorCode to a user-facing UX message and
 * actionable suggestion. Used by the renderer to display clear error messages.
 *
 * Note: This mapping is also documented in bridge.types.ts for reference.
 * The renderer can use this function or implement its own mapping.
 */
export function getCloneErrorMessage(
	errorCode: CloneRepositoryResult["errorCode"],
	details?: { status?: number },
): { message: string; suggestion: string } {
	switch (errorCode) {
		case "AUTH_ERROR": {
			const is401 = details?.status === 401;
			const is403 = details?.status === 403;
			return {
				message: is401
					? "Autenticación fallida: token inválido o expirado."
					: is403
						? "Autenticación fallida: token sin permisos suficientes."
						: "Autenticación fallida: token o usuario inválido o sin permisos.",
				suggestion:
					'Verifique usuario y token; asegúrese que el token tenga permiso "repo" o acceso necesario. Use "Validar token" para verificar antes de clonar.',
			};
		}
		case "DEST_EXISTS":
			return {
				message: "Directorio destino ya existe y no está vacío.",
				suggestion:
					"Elija otro directorio o mueva/borre el existente. Si desea sobreescribir, haga backup manualmente.",
			};
		case "NETWORK_ERROR":
			return {
				message: "Error de red al intentar clonar.",
				suggestion: "Verifique conexión y proxy. Intente nuevamente.",
			};
		case "GIT_NOT_FOUND":
			return {
				message: "Git no está instalado (o no encontrado en PATH).",
				suggestion: "Instale Git y reinicie la aplicación.",
			};
		case "IO_ERROR":
			return {
				message: "Error de disco/permiso al escribir en el destino.",
				suggestion:
					"Verifique permisos del directorio de destino y espacio en disco.",
			};
		case "INVALID_URL":
			return {
				message: "URL de repositorio inválida.",
				suggestion: "Verifique que la URL sea una URL Git válida.",
			};
		case "CANCELLED":
			return {
				message: "Clonado cancelado por el usuario.",
				suggestion: "Puede iniciar el clonado nuevamente cuando esté listo.",
			};
		case "CONCURRENT_LIMIT":
			return {
				message: `Límite de clones simultáneos alcanzado (máximo ${MAX_CONCURRENT_CLONES}).`,
				suggestion:
					"Espere a que finalice algún clone en curso antes de iniciar uno nuevo.",
			};
		default:
			return {
				message: "Error desconocido al clonar.",
				suggestion:
					"Revise los detalles técnicos (sanitizados) y contacte soporte si persiste.",
			};
	}
}

// ── Recents storage ────────────────────────────────────────────────────────

const MAX_RECENT_PROJECTS = 10;

function getRecentProjectsPath(): string {
	return join(app.getPath("userData"), "recent-projects.json");
}

async function readRecentProjects(): Promise<RecentProject[]> {
	const filePath = getRecentProjectsPath();
	if (!existsSync(filePath)) return [];
	try {
		const raw = await readFile(filePath, "utf-8");
		return JSON.parse(raw) as RecentProject[];
	} catch {
		return [];
	}
}

async function addToRecentProjects(
	projectDir: string,
	name: string,
): Promise<void> {
	const recents = await readRecentProjects();
	const entry: RecentProject = {
		projectDir,
		name,
		lastOpenedAt: new Date().toISOString(),
	};

	// Remove existing entry for the same dir (if any), then prepend
	const updated = [
		entry,
		...recents.filter((r) => r.projectDir !== projectDir),
	].slice(0, MAX_RECENT_PROJECTS);

	const filePath = getRecentProjectsPath();
	await mkdir(join(app.getPath("userData")), { recursive: true });
	await writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
}

// ── Serialization helpers ──────────────────────────────────────────────────

/**
 * Convert the ProjectLoader's Map-based ProjectModel into a plain object
 * safe for IPC serialization (structured clone does not support Map/Set).
 */
function serializeProjectModel(model: ProjectModel): SerializableProjectModel {
	const agents: SerializableAgentModel[] = [];

	for (const [, agentModel] of model.agents) {
		agents.push(serializeAgentModel(agentModel));
	}

	return {
		projectDir: model.projectDir,
		afprojPath: model.afprojPath,
		id: model.afproj.id,
		name: model.afproj.name,
		description: model.afproj.description,
		version: model.afproj.version,
		user: model.afproj.user
			? {
					user_id: model.afproj.user.user_id,
					position: model.afproj.user.position,
				}
			: undefined,
		agents,
		connections: model.connections.map((c) => ({
			id: c.id,
			fromAgentId: c.fromAgentId,
			toAgentId: c.toAgentId,
			label: c.label,
			type: c.type,
			metadata: c.metadata,
		})),
		properties: model.afproj.properties ?? {},
		entrypointId: model.entrypoint?.ref.id,
		loadedAt: model.loadedAt,
	};
}

function serializeAgentModel(agent: AgentModel): SerializableAgentModel {
	// Extract agentType and isOrchestrator from .adata.metadata
	const rawType = agent.adata.metadata?.agentType;
	const agentType: "Agent" | "Sub-Agent" =
		rawType === "Sub-Agent" ? "Sub-Agent" : "Agent";
	const isOrchestrator = agent.adata.metadata?.isOrchestrator === "true";
	const hidden = agent.adata.metadata?.hidden === "true";

	return {
		id: agent.ref.id,
		name: agent.ref.name,
		profilePath: agent.ref.profilePath,
		adataPath: agent.ref.adataPath,
		isEntrypoint: agent.ref.isEntrypoint,
		position: agent.ref.position,
		description: agent.adata.description,
		agentType,
		isOrchestrator,
		hidden,
		aspects: agent.adata.aspects.map((a) => ({
			id: a.id,
			name: a.name,
			filePath: a.filePath,
			order: a.order,
			enabled: a.enabled,
		})),
		skills: agent.adata.skills.map((s) => ({
			id: s.id,
			name: s.name,
			filePath: s.filePath,
			enabled: s.enabled,
		})),
		subagents: agent.subagents.map((sub) => ({
			id: sub.id,
			name: sub.name,
			description: sub.description,
			profileContent: sub.profileContent,
			aspects: sub.aspects.map((a) => ({
				id: a.id,
				name: a.name,
				filePath: a.filePath,
				order: a.order,
				enabled: a.enabled,
			})),
			skills: sub.skills.map((s) => ({
				id: s.id,
				name: s.name,
				filePath: s.filePath,
				enabled: s.enabled,
			})),
		})),
		profileContent: agent.profileContent,
	};
}

/**
 * Convert a LoadResult from the ProjectLoader into a BridgeLoadResult
 * (fully serializable, no Map/Set instances).
 */
function toBridgeLoadResult(result: LoadResult): BridgeLoadResult {
	return {
		success: result.success,
		project: result.project ? serializeProjectModel(result.project) : undefined,
		issues: result.issues.map((i) => ({
			severity: i.severity,
			code: i.code,
			message: i.message,
			source: i.source,
			repairHint: i.repairHint,
		})),
		repairActions: result.repairActions.map((a) => ({
			kind: a.kind,
			description: a.description,
			targetFile: a.targetFile,
			fieldPath: a.fieldPath,
			applied: a.applied,
		})),
		summary: { ...result.summary },
		timestamp: result.timestamp,
		durationMs: result.durationMs,
	};
}

// ── Export helpers ─────────────────────────────────────────────────────────

/**
 * Recursively scans `skillsDir` for SKILL.md files and returns each skill's
 * name, relative path, and full content.
 *
 * Returns [] if `skillsDir` does not exist.
 */
async function listSkillsFullFromDir(skillsDir: string): Promise<
	Array<{
		name: string;
		relativePath: string;
		content: string;
	}>
> {
	const results: Array<{
		name: string;
		relativePath: string;
		content: string;
	}> = [];

	// Check directory exists
	try {
		const s = await stat(skillsDir);
		if (!s.isDirectory()) return [];
	} catch {
		return [];
	}

	async function walk(dir: string): Promise<void> {
		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = join(dir, entry);
			let info;
			try {
				info = await stat(fullPath);
			} catch {
				continue;
			}

			if (info.isDirectory()) {
				const skillMdPath = join(fullPath, "SKILL.md");
				try {
					const skillStat = await stat(skillMdPath);
					if (skillStat.isFile()) {
						// Calculate name from relative path (dash-joined)
						const rel = skillMdPath.slice(skillsDir.length + 1); // e.g. "kb-search/SKILL.md"
						const dirRel = rel.slice(0, rel.length - "/SKILL.md".length);
						const name = dirRel.split("/").join("-");
						const content = await readFile(skillMdPath, "utf-8");
						results.push({ name, relativePath: rel, content });
					}
				} catch {
					// ignore
				}
				await walk(fullPath);
			}
		}
	}

	await walk(skillsDir);
	results.sort((a, b) => a.name.localeCompare(b.name));
	return results;
}

/**
 * Reads all enabled profile .md files for an agent (in order) and
 * returns their individual contents + a concatenated version.
 */
async function readAgentProfilesFull(
	projectDir: string,
	agentId: string,
): Promise<{
	success: boolean;
	concatenatedContent: string;
	profiles: Array<{
		filePath: string;
		selector: string;
		label?: string;
		content: string;
	}>;
	error?: string;
}> {
	const adataFilePath = join(projectDir, "metadata", `${agentId}.adata`);

	// Read the .adata to get the profile list
	let adataRaw: Record<string, unknown>;
	try {
		const raw = await readFile(adataFilePath, "utf-8");
		adataRaw = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return { success: true, concatenatedContent: "", profiles: [] };
	}

	// Extract profiles array
	const rawProfiles = adataRaw.profile;
	if (!Array.isArray(rawProfiles) || rawProfiles.length === 0) {
		return { success: true, concatenatedContent: "", profiles: [] };
	}

	// Sort by order, keep only enabled
	type RawProfile = {
		id?: string;
		selector?: string;
		filePath?: string;
		label?: string;
		order?: number;
		enabled?: boolean;
	};
	const sorted = (rawProfiles as RawProfile[])
		.filter((p) => p.enabled !== false && typeof p.filePath === "string")
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

	const profiles: Array<{
		filePath: string;
		selector: string;
		label?: string;
		content: string;
	}> = [];

	for (const p of sorted) {
		if (!p.filePath) continue;
		const absPath = join(projectDir, p.filePath);
		let content = "";
		try {
			content = await readFile(absPath, "utf-8");
		} catch {
			content = "";
		}
		profiles.push({
			filePath: p.filePath,
			selector: p.selector ?? "",
			label: p.label,
			content,
		});
	}

	const concatenatedContent = profiles.map((p) => p.content).join("\n\n");
	return { success: true, concatenatedContent, profiles };
}

// ── Handler registration ───────────────────────────────────────────────────

/**
 * Register all IPC handlers. Call this once from main.ts after the app
 * is ready. Safe to call multiple times — existing handlers are removed
 * before re-registering to prevent Electron's
 * "Attempted to register a second handler for '<channel>'" error, which
 * happens when the window is recreated on macOS (app.on("activate")).
 */
export function registerIpcHandlers(): void {
	// ── Remove any previously registered handlers (idempotency guard) ──────
	for (const channel of Object.values(IPC_CHANNELS)) {
		ipcMain.removeHandler(channel);
	}

	// ── Also remove folder-explorer channels ─────────────────────────────────
	// FOLDER_EXPLORER_CHANNELS is declared in electron-main/src/ipc/folder-explorer.ts
	// and NOT part of IPC_CHANNELS (bridge.types.ts). Without this loop, a second
	// call to registerIpcHandlers() (e.g. on macOS "activate") would throw:
	//   "Attempted to register a second handler for 'folder-explorer:list'"
	// Adding new channel-namespaced constants here is the correct extension point.
	for (const channel of Object.values(FOLDER_EXPLORER_CHANNELS)) {
		ipcMain.removeHandler(channel);
	}

	// ── Open folder dialog ─────────────────────────────────────────────────
	ipcMain.handle(IPC_CHANNELS.OPEN_FOLDER_DIALOG, async () => {
		console.log("[ipc] OPEN_FOLDER_DIALOG: opening native folder picker");
		const opts = {
			title: "Open AgentFlow Project",
			properties: ["openDirectory", "createDirectory"] as (
				| "openDirectory"
				| "createDirectory"
			)[],
		};
		const result = await dialog.showOpenDialog(opts);

		if (result.canceled || result.filePaths.length === 0) {
			console.log("[ipc] OPEN_FOLDER_DIALOG: user cancelled or no selection");
			return null;
		}
		const chosen = result.filePaths[0] ?? null;
		console.log("[ipc] OPEN_FOLDER_DIALOG: selected →", chosen);
		return chosen;
	});

	// ── Open file dialog ───────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.OPEN_FILE_DIALOG,
		async (
			event,
			options: {
				title?: string;
				filters?: { name: string; extensions: string[] }[];
			} = {},
		) => {
			const win = BrowserWindow.fromWebContents(event.sender);
			const opts = {
				title: options.title ?? "Open File",
				properties: ["openFile"] as "openFile"[],
				filters: options.filters ?? [{ name: "All Files", extensions: ["*"] }],
			};
			const result = win
				? await dialog.showOpenDialog(win, opts)
				: await dialog.showOpenDialog(opts);

			if (result.canceled || result.filePaths.length === 0) return null;
			return result.filePaths[0] ?? null;
		},
	);

	// ── Select directory for NEW project creation ──────────────────────────
	// Separate from OPEN_FOLDER_DIALOG so the dialog title is contextual
	// and the channel semantics are clear.
	ipcMain.handle(IPC_CHANNELS.SELECT_NEW_PROJECT_DIR, async (event) => {
		console.log(
			"[ipc] SELECT_NEW_PROJECT_DIR: opening native folder picker for new project",
		);
		const win = BrowserWindow.fromWebContents(event.sender);
		const opts = {
			title: "Select folder for new project",
			buttonLabel: "Choose Folder",
			properties: ["openDirectory", "createDirectory"] as (
				| "openDirectory"
				| "createDirectory"
			)[],
		};
		const result = win
			? await dialog.showOpenDialog(win, opts)
			: await dialog.showOpenDialog(opts);

		if (result.canceled || result.filePaths.length === 0) {
			console.log(
				"[ipc] SELECT_NEW_PROJECT_DIR: user cancelled or no selection",
			);
			return null;
		}
		const chosen = result.filePaths[0] ?? null;
		console.log("[ipc] SELECT_NEW_PROJECT_DIR: selected →", chosen);
		return chosen;
	});

	// ── Validate new-project directory ─────────────────────────────────────
	// Returns a NewProjectDirValidation — does NOT modify the filesystem.
	ipcMain.handle(
		IPC_CHANNELS.VALIDATE_NEW_PROJECT_DIR,
		async (_event, dir: string): Promise<NewProjectDirValidation> => {
			console.log("[ipc] VALIDATE_NEW_PROJECT_DIR: validating →", dir);
			const result = await validateNewProjectDir(dir);
			console.log(
				"[ipc] VALIDATE_NEW_PROJECT_DIR: result →",
				JSON.stringify(result),
			);
			return result;
		},
	);

	// ── Create new project scaffold ────────────────────────────────────────
	// Delegates to project-factory.ts which handles atomic creation + rollback.
	ipcMain.handle(
		IPC_CHANNELS.CREATE_PROJECT,
		async (_event, req: CreateProjectRequest): Promise<CreateProjectResult> => {
			console.log(
				"[ipc] CREATE_PROJECT: creating project →",
				JSON.stringify({ name: req.name, projectDir: req.projectDir }),
			);
			const result = await createProject(req);

			// On success, register in recent-projects so it appears in the browser
			if (result.success && result.projectDir) {
				console.log(
					"[ipc] CREATE_PROJECT: success, projectDir →",
					result.projectDir,
				);
				await addToRecentProjects(result.projectDir, req.name.trim());
			} else {
				console.error(
					"[ipc] CREATE_PROJECT: failed →",
					result.error,
					result.errorCode,
				);
			}

			return result;
		},
	);

	// ── Load project ───────────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.LOAD_PROJECT,
		async (_event, req: LoadProjectRequest) => {
			console.log("[ipc] LOAD_PROJECT: loading →", req.projectDir);
			const loader = new ProjectLoader(req.projectDir);
			const result = await loader.load({
				...(req.options ?? {}),
				mode: "load",
			});

			if (result.success && result.project) {
				console.log(
					"[ipc] LOAD_PROJECT: success, agents →",
					result.project.agents.size,
				);
				await addToRecentProjects(req.projectDir, result.project.afproj.name);

				// ── Profile migration (idempotent) ─────────────────────────────────
				// On every project load, ensure all .adata files have a `profile: []`
				// key. This is a no-op for already-migrated files (idempotent) and
				// silently upgrades legacy files that pre-date the profiling feature.
				try {
					const report = await migrateProjectProfiles(
						nodeFileAdapter,
						req.projectDir,
						async (dirPath) => {
							const entries = await readdir(dirPath, { withFileTypes: true });
							return entries.filter((e) => e.isFile()).map((e) => e.name);
						},
					);
					if (report.migrated > 0) {
						console.log(
							`[ipc] LOAD_PROJECT: profile migration — migrated=${report.migrated} ` +
								`skipped=${report.skipped} errors=${report.errors}`,
						);
					}
				} catch (migrateErr) {
					// Migration failures are non-fatal — log and continue loading
					console.warn(
						"[ipc] LOAD_PROJECT: profile migration failed (non-fatal) —",
						migrateErr instanceof Error
							? migrateErr.message
							: String(migrateErr),
					);
				}
			} else {
				console.error(
					"[ipc] LOAD_PROJECT: failed →",
					result.summary.errors,
					"errors",
				);
			}

			return toBridgeLoadResult(result);
		},
	);

	// ── Validate project (dry-run) ─────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.VALIDATE_PROJECT,
		async (_event, req: ValidateProjectRequest) => {
			const loader = new ProjectLoader(req.projectDir);
			const result = await loader.load({
				...(req.options ?? {}),
				mode: "dry-run",
				// For validation, skip loading markdown content for speed
				loadBehaviorFiles: false,
				loadSkillFiles: false,
			});
			return toBridgeLoadResult(result);
		},
	);

	// ── Repair project ─────────────────────────────────────────────────────
	// Applies all auto-repairable issues to disk, then reloads the project.
	ipcMain.handle(
		IPC_CHANNELS.REPAIR_PROJECT,
		async (_event, req: RepairProjectRequest) => {
			const loader = new ProjectLoader(req.projectDir);
			const result = await loader.load({
				...(req.options ?? {}),
				mode: "repair",
			});

			if (result.success && result.project) {
				await addToRecentProjects(req.projectDir, result.project.afproj.name);
			}

			return toBridgeLoadResult(result);
		},
	);

	// ── Save project ───────────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.SAVE_PROJECT,
		async (_event, req: SaveProjectRequest): Promise<SaveProjectResult> => {
			console.log(
				"[ipc] SAVE_PROJECT: saving →",
				req.projectDir,
				"updates →",
				JSON.stringify(req.updates),
			);
			try {
				// Read the current .afproj from disk so we preserve all fields
				// (e.g. id, createdAt, agents, connections) that the UI does not send.
				const loader = new ProjectLoader(req.projectDir);
				const loadResult = await loader.load({
					mode: "load",
					loadBehaviorFiles: false,
					loadSkillFiles: false,
				});

				if (!loadResult.success || !loadResult.project) {
					const errMsg = `Cannot save: project has ${loadResult.summary.errors} error(s). Validate and fix them first.`;
					console.error("[ipc] SAVE_PROJECT: load failed —", errMsg);
					return { success: false, error: errMsg };
				}

				// Merge UI updates into the existing .afproj — preserve immutable fields
				const afproj = { ...loadResult.project.afproj };
				if (req.updates.name !== undefined)
					afproj.name = req.updates.name.trim() || afproj.name;
				if (req.updates.description !== undefined)
					afproj.description = req.updates.description;
				if (req.updates.properties !== undefined)
					afproj.properties = req.updates.properties;
				afproj.updatedAt = new Date().toISOString();

				await atomicWriteJson(loadResult.project.afprojPath, afproj);
				console.log(
					"[ipc] SAVE_PROJECT: success, written →",
					loadResult.project.afprojPath,
				);
				return { success: true };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[ipc] SAVE_PROJECT: unexpected error —", message);
				return { success: false, error: message };
			}
		},
	);

	// ── Save agent graph ───────────────────────────────────────────────────
	// Persists the visual agent graph (nodes + links) produced by the flow
	// canvas editor to disk:
	//
	//   1. Reads the existing .afproj to preserve immutable fields.
	//   2. Rebuilds the `agents[]` and `connections[]` arrays from the payload.
	//   3. Writes the updated .afproj atomically.
	//   4. Creates/updates `metadata/<uuid>.adata` for every agent node.
	//   5. Deletes `.adata` files for agents that are no longer present.
	//
	// File format: pretty JSON (2-space indent), atomic write via temp+rename.
	ipcMain.handle(
		IPC_CHANNELS.SAVE_AGENT_GRAPH,
		async (
			_event,
			req: SaveAgentGraphRequest,
		): Promise<SaveAgentGraphResult> => {
			console.log(
				"[ipc] SAVE_AGENT_GRAPH: saving →",
				req.projectDir,
				`agents=${req.agents.length}`,
				`edges=${req.edges.length}`,
			);
			try {
				const metadataDir = join(req.projectDir, "metadata");
				const behaviorsDir = join(req.projectDir, "behaviors");

				// ── 1. Locate the .afproj file ───────────────────────────────────
				// Find the first .afproj in the project directory.
				let afprojPath: string | null = null;
				try {
					const entries = await readdir(req.projectDir, {
						withFileTypes: true,
					});
					for (const e of entries) {
						if (e.isFile() && e.name.endsWith(".afproj")) {
							afprojPath = join(req.projectDir, e.name);
							break;
						}
					}
				} catch (err) {
					return {
						success: false,
						error: `Cannot read project directory: ${err instanceof Error ? err.message : String(err)}`,
					};
				}

				if (!afprojPath) {
					return {
						success: false,
						error: "No .afproj file found in project directory.",
					};
				}

				// ── 2. Read and parse the existing .afproj ───────────────────────
				let existingAfproj: Record<string, unknown>;
				try {
					const raw = await readFile(afprojPath, "utf-8");
					existingAfproj = JSON.parse(raw) as Record<string, unknown>;
				} catch (err) {
					return {
						success: false,
						error: `Cannot parse .afproj: ${err instanceof Error ? err.message : String(err)}`,
					};
				}

				// ── 3. Build the updated agents[] and connections[] arrays ────────
				const now = new Date().toISOString();

				const agentRefs = req.agents.map((node: AgentGraphNode) => ({
					id: node.id,
					name: node.name,
					profilePath: `behaviors/${node.name}/profile.md`,
					adataPath: `metadata/${node.id}.adata`,
					isEntrypoint: node.type === "Agent" && node.isOrchestrator,
					position: { x: node.x, y: node.y },
				}));

				const connections = req.edges.map((edge: AgentGraphEdge) => ({
					id: edge.id,
					fromAgentId: edge.fromAgentId,
					toAgentId: edge.toAgentId,
					label:
						edge.relationType === "Delegation"
							? edge.delegationType !== "Optional"
								? edge.delegationType
								: undefined
							: edge.relationType,
					type: "default" as const,
					metadata: {
						relationType: edge.relationType,
						delegationType: edge.delegationType,
						ruleDetails: edge.ruleDetails,
					},
				}));

				// Merge into existing .afproj — preserve id, name, description,
				// version, createdAt, and any extra properties.
				// Build the new `user` object from the request's userPosition.
				// Migrate legacy flat user_id field if present.
				const userObject = req.userPosition
					? { user_id: "user-node", position: req.userPosition }
					: undefined;

				const updatedAfproj: Record<string, unknown> = {
					...existingAfproj,
					agents: agentRefs,
					connections,
					updatedAt: now,
				};

				// Write new `user` object (replaces legacy flat user_id)
				if (userObject) {
					updatedAfproj.user = userObject;
				} else {
					// Remove user if no user node is on the canvas
					delete updatedAfproj.user;
				}
				// Always remove legacy flat user_id (migration)
				delete updatedAfproj.user_id;

				// ── 4. Write updated .afproj atomically ──────────────────────────
				await atomicWriteJson(afprojPath, updatedAfproj);
				console.log("[ipc] SAVE_AGENT_GRAPH: .afproj written →", afprojPath);

				// ── 5. Create / update metadata/<uuid>.adata for each agent ──────
				await mkdir(metadataDir, { recursive: true });

				for (const node of req.agents) {
					const adataPath = join(metadataDir, `${node.id}.adata`);

					// Merge with existing .adata if it exists (preserve aspects, skills,
					// subagents, createdAt, and any other fields we don't touch here).
					let existing: Record<string, unknown> = {};
					try {
						const raw = await readFile(adataPath, "utf-8");
						existing = JSON.parse(raw) as Record<string, unknown>;
					} catch {
						// File doesn't exist yet — start fresh
					}

					const adata = buildAdataFromExisting(node, existing, now);

					await atomicWriteJson(adataPath, adata);
					console.log("[ipc] SAVE_AGENT_GRAPH: .adata written →", adataPath);

					// Ensure the behaviors/<slug>/ directory and profile.md exist
					const agentBehaviorDir = join(behaviorsDir, node.name);
					await mkdir(agentBehaviorDir, { recursive: true });
					const profilePath = join(agentBehaviorDir, "profile.md");
					// Only create profile.md if it doesn't already exist
					const profileExists = existsSync(profilePath);
					if (!profileExists) {
						const profileContent = `# ${node.name}\n\n${node.description || ""}\n`;
						await writeFile(profilePath, profileContent, {
							encoding: "utf-8",
							flag: "w",
						});
						console.log(
							"[ipc] SAVE_AGENT_GRAPH: profile.md created →",
							profilePath,
						);
					}
				}

				// ── 6. Delete .adata files for agents no longer in the graph ─────
				const currentIds = new Set(req.agents.map((n) => n.id));
				try {
					const metaEntries = await readdir(metadataDir, {
						withFileTypes: true,
					});
					for (const e of metaEntries) {
						if (!e.isFile() || !e.name.endsWith(".adata")) continue;
						const agentId = e.name.slice(0, -6); // strip ".adata"
						if (!currentIds.has(agentId)) {
							const stale = join(metadataDir, e.name);
							await rm(stale, { force: true });
							console.log(
								"[ipc] SAVE_AGENT_GRAPH: deleted stale .adata →",
								stale,
							);
						}
					}
				} catch {
					// metadata dir may not exist yet — nothing to clean up
				}

				// ── 7. Auto-sync permissions.task for every agent ────────────────
				// Must run AFTER .adata files are written/deleted (step 5+6) so that
				// handleSyncTasks reads up-to-date files and writes are not lost.
				const syncEntries = buildSyncTaskEntries(
					req.agents.map((n) => ({ id: n.id, name: n.name })),
					req.edges.map((e) => ({
						fromAgentId: e.fromAgentId,
						toAgentId: e.toAgentId,
						relationType: e.relationType,
					})),
				);
				const syncResult = await handleSyncTasks({
					projectDir: req.projectDir,
					entries: syncEntries,
				});
				if (syncResult.errors.length > 0) {
					console.warn(
						"[ipc] SAVE_AGENT_GRAPH: sync-tasks partial errors —",
						syncResult.errors,
					);
				}
				console.log(
					"[ipc] SAVE_AGENT_GRAPH: complete — sync updated=",
					syncResult.updated,
					"errors=",
					syncResult.errors.length,
				);
				return { success: true, syncResult };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[ipc] SAVE_AGENT_GRAPH: unexpected error —", message);
				return { success: false, error: message };
			}
		},
	);

	// ── Export project ─────────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.EXPORT_PROJECT,
		async (event, req: ExportProjectRequest): Promise<ExportProjectResult> => {
			try {
				const loader = new ProjectLoader(req.projectDir);
				const loadResult = await loader.load({ mode: "load" });

				if (!loadResult.success || !loadResult.project) {
					return {
						success: false,
						error: `Cannot export: project failed to load (${loadResult.summary.errors} error(s)).`,
					};
				}

				let exportPath = req.destinationPath;

				// If no path was provided, show a save dialog
				if (!exportPath) {
					const win = BrowserWindow.fromWebContents(event.sender);
					const saveOpts = {
						title: "Export AgentFlow Project",
						defaultPath: `${loadResult.project.afproj.name}.agentsflow.json`,
						filters: [{ name: "AgentFlow Export", extensions: ["json"] }],
					};
					const saveResult = win
						? await dialog.showSaveDialog(win, saveOpts)
						: await dialog.showSaveDialog(saveOpts);
					if (saveResult.canceled || !saveResult.filePath) {
						return { success: false, error: "Export cancelled by user." };
					}
					exportPath = saveResult.filePath;
				}

				// Serialize the full project to a portable JSON archive
				const archive = {
					exportVersion: 1,
					exportedAt: new Date().toISOString(),
					project: serializeProjectModel(loadResult.project),
					issues: loadResult.issues,
					summary: loadResult.summary,
				};

				await atomicWriteJson(exportPath, archive);
				return { success: true, exportedPath: exportPath };
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		},
	);

	// ── Get recent projects ─────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.GET_RECENT_PROJECTS,
		async (): Promise<RecentProject[]> => {
			return readRecentProjects();
		},
	);

	// ═══════════════════════════════════════════════════════════════════════
	// Asset panel handlers
	// All fs operations are guarded to never expose .afproj / .adata files
	// and to never navigate outside the project root (directory-jail).
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Returns only immediate child DIRECTORIES of the given path.
	 * Hidden dirs (starting with "."), .afproj, and .adata entries are excluded.
	 */
	ipcMain.handle(
		IPC_CHANNELS.ASSET_LIST_DIRS,
		async (_event, dirPath: string): Promise<AssetDirEntry[]> => {
			try {
				const entries = await readdir(dirPath, { withFileTypes: true });
				const dirs: AssetDirEntry[] = [];
				for (const e of entries) {
					if (!e.isDirectory()) continue;
					if (e.name.startsWith(".")) continue;
					dirs.push({
						name: e.name,
						path: join(dirPath, e.name),
						relativePath: e.name,
						children: undefined,
					});
				}
				return dirs.sort((a, b) => a.name.localeCompare(b.name));
			} catch (err) {
				console.error("[ipc] ASSET_LIST_DIRS error:", err);
				return [];
			}
		},
	);

	/**
	 * Returns .md files + immediate subdirectories inside dirPath.
	 * Never returns .afproj or .adata files.
	 */
	ipcMain.handle(
		IPC_CHANNELS.ASSET_LIST_DIR_CONTENTS,
		async (_event, dirPath: string): Promise<AssetDirContents> => {
			try {
				const entries = await readdir(dirPath, { withFileTypes: true });
				const files: AssetFileEntry[] = [];
				const subdirs: AssetDirEntry[] = [];

				for (const e of entries) {
					if (e.name.startsWith(".")) continue;

					if (e.isDirectory()) {
						subdirs.push({
							name: e.name,
							path: join(dirPath, e.name),
							relativePath: e.name,
						});
					} else if (e.isFile()) {
						const ext = extname(e.name).toLowerCase();
						if (ext !== ".md") continue;
						files.push({
							name: e.name,
							path: join(dirPath, e.name),
							relativePath: e.name,
							ext: "md",
						});
					}
				}

				return {
					dirPath,
					files: files.sort((a, b) => a.name.localeCompare(b.name)),
					subdirs: subdirs.sort((a, b) => a.name.localeCompare(b.name)),
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[ipc] ASSET_LIST_DIR_CONTENTS error:", message);
				return { dirPath, files: [], subdirs: [] };
			}
		},
	);

	/** Reads a .md file. Rejects any non-.md path. */
	ipcMain.handle(
		IPC_CHANNELS.ASSET_READ_FILE,
		async (_event, filePath: string): Promise<AssetReadResult> => {
			const ext = extname(filePath).toLowerCase();
			if (ext !== ".md") {
				return {
					success: false,
					error: "Only .md files can be read through the asset panel.",
				};
			}
			try {
				const content = await readFile(filePath, "utf-8");
				return { success: true, content };
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		},
	);

	/** Writes (creates or overwrites) a .md file. Rejects non-.md paths. */
	ipcMain.handle(
		IPC_CHANNELS.ASSET_WRITE_FILE,
		async (
			_event,
			filePath: string,
			content: string,
		): Promise<AssetOpResult> => {
			const ext = extname(filePath).toLowerCase();
			if (ext !== ".md") {
				return {
					success: false,
					error: "Only .md files can be written through the asset panel.",
				};
			}
			try {
				await mkdir(dirname(filePath), { recursive: true });
				await writeFile(filePath, content, "utf-8");
				return { success: true };
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		},
	);

	/** Creates a directory (recursive — parents created if needed). */
	ipcMain.handle(
		IPC_CHANNELS.ASSET_CREATE_DIR,
		async (_event, dirPath: string): Promise<AssetOpResult> => {
			try {
				await mkdir(dirPath, { recursive: true });
				return { success: true };
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		},
	);

	/** Renames a file or directory. */
	ipcMain.handle(
		IPC_CHANNELS.ASSET_RENAME,
		async (
			_event,
			oldPath: string,
			newPath: string,
		): Promise<AssetOpResult> => {
			// Guard: if renaming a file, ensure the target still has .md extension
			const oldExt = extname(oldPath).toLowerCase();
			const newExt = extname(newPath).toLowerCase();
			if (oldExt === ".md" && newExt !== ".md") {
				return {
					success: false,
					error: "Renamed file must keep the .md extension.",
				};
			}
			try {
				await rename(oldPath, newPath);
				return { success: true };
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		},
	);

	/** Deletes a file or directory (recursive). */
	ipcMain.handle(
		IPC_CHANNELS.ASSET_DELETE,
		async (_event, targetPath: string): Promise<AssetOpResult> => {
			// Guard: never delete .afproj or .adata files
			const ext = extname(targetPath).toLowerCase();
			if (ext === ".afproj" || ext === ".adata") {
				return {
					success: false,
					error:
						"Project files (.afproj, .adata) cannot be deleted through the asset panel.",
				};
			}
			try {
				const s = await stat(targetPath);
				if (s.isDirectory()) {
					await rm(targetPath, { recursive: true, force: true });
				} else {
					await rm(targetPath, { force: true });
				}
				return { success: true };
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		},
	);

	/**
	 * Imports (copies) a file into destDir.
	 * Only .md source files are accepted. The destination filename preserves the source name.
	 */
	ipcMain.handle(
		IPC_CHANNELS.ASSET_IMPORT_FILE,
		async (
			_event,
			srcPath: string,
			destDir: string,
		): Promise<AssetOpResult> => {
			const ext = extname(srcPath).toLowerCase();
			if (ext !== ".md") {
				return { success: false, error: "Only .md files can be imported." };
			}
			try {
				const destPath = join(destDir, basename(srcPath));
				await copyFile(srcPath, destPath);
				return { success: true };
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		},
	);

	/** Opens a native file picker filtered to .md files. */
	ipcMain.handle(
		IPC_CHANNELS.ASSET_OPEN_MD_DIALOG,
		async (event): Promise<string | null> => {
			const win = BrowserWindow.fromWebContents(event.sender);
			const opts = {
				title: "Import Markdown File",
				filters: [{ name: "Markdown Files", extensions: ["md"] }],
				properties: ["openFile"] as "openFile"[],
			};
			const result = win
				? await dialog.showOpenDialog(win, opts)
				: await dialog.showOpenDialog(opts);
			if (result.canceled || result.filePaths.length === 0) return null;
			return result.filePaths[0] ?? null;
		},
	);

	// ── Asset Move ─────────────────────────────────────────────────────────────
	/**
	 * Moves a file or directory (sourcePath) into a target directory (targetDirPath).
	 *
	 * Guards:
	 *   - Protected system directories (metadata, behaviors) are never moveable as source
	 *   - Cannot move to the same parent (no-op guard)
	 *   - Cannot create directory cycles (dir moved into itself or its descendant)
	 *   - Name conflicts: fails if a same-named item already exists at target
	 */
	ipcMain.handle(
		IPC_CHANNELS.ASSET_MOVE,
		async (_event, payload: AssetMovePayload): Promise<AssetMoveResult> => {
			const { sourcePath, targetDirPath, projectRoot } = payload;

			// Normalize paths
			const normalise = (p: string) =>
				p.replace(/\\/g, "/").replace(/\/+$/, "");
			const src = normalise(sourcePath);
			const tgt = normalise(targetDirPath);
			const root = normalise(projectRoot);

			const srcBasename = basename(src);

			// Guard: protected system directories at project root level
			const PROTECTED_NAMES = new Set(["metadata"]);
			const isProtectedAtRoot = (p: string) => {
				const parent = normalise(dirname(p));
				return parent === root && PROTECTED_NAMES.has(basename(p));
			};
			if (isProtectedAtRoot(src)) {
				return {
					success: false,
					error: "System directory cannot be moved.",
					errorCode: "PROTECTED",
				};
			}
			// Guard: cannot move into metadata
			if (
				tgt === join(root, "metadata") ||
				tgt.startsWith(join(root, "metadata") + "/")
			) {
				return {
					success: false,
					error: "Cannot move items into the metadata directory.",
					errorCode: "PROTECTED",
				};
			}

			// Guard: same parent — already there
			const srcParent = normalise(dirname(src));
			if (srcParent === tgt) {
				return {
					success: false,
					error: "Item is already in that folder.",
					errorCode: "SAME_PARENT",
				};
			}

			// Guard: cycle — moving a directory into itself or a descendant
			const srcWithSlash = src + "/";
			if (tgt === src || tgt.startsWith(srcWithSlash)) {
				return {
					success: false,
					error: "Cannot move a folder into itself or one of its subfolders.",
					errorCode: "CYCLE",
				};
			}

			// Guard: name conflict at destination
			const destPath = join(targetDirPath, srcBasename);
			if (existsSync(destPath)) {
				return {
					success: false,
					error: `"${srcBasename}" already exists in the destination folder.`,
					errorCode: "CONFLICT",
				};
			}

			try {
				await rename(sourcePath, destPath);
				return { success: true, newPath: destPath };
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err),
					errorCode: "IO_ERROR",
				};
			}
		},
	);

	// ── Adapter field: read from .adata ────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.ADATA_GET_ADAPTER,
		async (
			_event,
			req: AdataAdapterRequest,
		): Promise<AdataGetAdapterResult> => {
			try {
				const adataPath = join(
					req.projectDir,
					"metadata",
					`${req.agentId}.adata`,
				);
				let raw: string;
				try {
					raw = await readFile(adataPath, "utf-8");
				} catch {
					// File doesn't exist — no adapter set
					return { success: true, adapter: null };
				}
				const adata = JSON.parse(raw) as Record<string, unknown>;
				const meta = (adata.metadata as Record<string, unknown>) ?? {};
				const adapter = typeof meta.adapter === "string" ? meta.adapter : null;
				return { success: true, adapter };
			} catch (err) {
				return {
					success: false,
					adapter: null,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		},
	);

	// ── Adapter field: write to .adata ─────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.ADATA_SET_ADAPTER,
		async (
			_event,
			req: AdataSetAdapterRequest,
		): Promise<AdataSetAdapterResult> => {
			try {
				const adataPath = join(
					req.projectDir,
					"metadata",
					`${req.agentId}.adata`,
				);

				// Read existing .adata (required — must exist for an agent in the graph)
				let existing: Record<string, unknown> = {};
				try {
					const raw = await readFile(adataPath, "utf-8");
					existing = JSON.parse(raw) as Record<string, unknown>;
				} catch {
					return {
						success: false,
						error: `Agent .adata file not found: ${adataPath}`,
					};
				}

				// Update only the adapter field inside metadata — preserve everything else
				const existingMeta =
					(existing.metadata as Record<string, unknown>) ?? {};
				const updatedMeta: Record<string, unknown> = { ...existingMeta };
				if (req.adapter === null) {
					delete updatedMeta.adapter;
				} else {
					updatedMeta.adapter = req.adapter;
				}

				const updated: Record<string, unknown> = {
					...existing,
					metadata: updatedMeta,
					updatedAt: new Date().toISOString(),
				};

				await atomicWriteJson(adataPath, updated);
				console.log(
					"[ipc] ADATA_SET_ADAPTER: written →",
					adataPath,
					"adapter →",
					req.adapter,
				);
				return { success: true };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[ipc] ADATA_SET_ADAPTER: error —", message);
				return { success: false, error: message };
			}
		},
	);

	// ── OpenCode config: read from .adata ──────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.ADATA_GET_OPENCODE_CONFIG,
		async (
			_event,
			req: AdataGetOpenCodeConfigRequest,
		): Promise<AdataGetOpenCodeConfigResult> => {
			try {
				const adataPath = join(
					req.projectDir,
					"metadata",
					`${req.agentId}.adata`,
				);
				let raw: string;
				try {
					raw = await readFile(adataPath, "utf-8");
				} catch {
					// File doesn't exist — no opencode config set
					return { success: true, config: null };
				}
				const adata = JSON.parse(raw) as Record<string, unknown>;
				const config = getOpenCodeConfigFromAdata(adata);
				return { success: true, config };
			} catch (err) {
				return {
					success: false,
					config: null,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		},
	);

	// ── OpenCode config: write to .adata ───────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.ADATA_SET_OPENCODE_CONFIG,
		async (
			_event,
			req: AdataSetOpenCodeConfigRequest,
		): Promise<AdataSetOpenCodeConfigResult> => {
			try {
				const adataPath = join(
					req.projectDir,
					"metadata",
					`${req.agentId}.adata`,
				);

				// Read existing .adata (must exist — agent must have been saved first)
				let existing: Record<string, unknown> = {};
				try {
					const raw = await readFile(adataPath, "utf-8");
					existing = JSON.parse(raw) as Record<string, unknown>;
				} catch {
					return {
						success: false,
						error: `Agent .adata file not found: ${adataPath}`,
					};
				}

				// Write opencode config at the top-level 'opencode' key — preserve everything else
				// temperature is always stored; default to 0.05 if caller omits it
				const temperature =
					typeof req.config.temperature === "number" &&
					isFinite(req.config.temperature)
						? req.config.temperature
						: OPENCODE_CONFIG_TEMPERATURE_DEFAULT;

				// hidden defaults to false
				const hidden =
					typeof req.config.hidden === "boolean"
						? req.config.hidden
						: OPENCODE_CONFIG_HIDDEN_DEFAULT;

				// steps defaults to 7 (null is allowed — means unset)
				const steps =
					req.config.steps === null
						? null
						: typeof req.config.steps === "number" && isFinite(req.config.steps)
							? req.config.steps
							: OPENCODE_CONFIG_STEPS_DEFAULT;

				// color defaults to "#ffffff"
				const color =
					typeof req.config.color === "string" && req.config.color.length > 0
						? req.config.color
						: OPENCODE_CONFIG_COLOR_DEFAULT;

				const updated: Record<string, unknown> = {
					...existing,
					opencode: {
						provider: req.config.provider,
						model: req.config.model,
						temperature,
						hidden,
						steps,
						color,
					},
					updatedAt: new Date().toISOString(),
				};

				await atomicWriteJson(adataPath, updated);
				console.log(
					"[ipc] ADATA_SET_OPENCODE_CONFIG: written →",
					adataPath,
					"config →",
					JSON.stringify(req.config),
				);
				return { success: true };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[ipc] ADATA_SET_OPENCODE_CONFIG: error —", message);
				return { success: false, error: message };
			}
		},
	);

	// ══════════════════════════════════════════════════════════════════════
	// Agent Profiling handlers
	//
	// All 5 handlers delegate to pure functions in profile-handlers.ts
	// (testable without Electron). The Node-based FileAdapter is injected here.
	// ══════════════════════════════════════════════════════════════════════

	// ── List profiles ──────────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.ADATA_LIST_PROFILES,
		async (_event, req: AdataListProfilesRequest) => {
			console.log("[ipc] ADATA_LIST_PROFILES: agentId →", req.agentId);
			const result = await handleListProfiles(nodeFileAdapter, req);
			if (!result.success) {
				console.error(
					"[ipc] ADATA_LIST_PROFILES: error —",
					result.error,
					result.errorCode,
				);
			}
			return result;
		},
	);

	// ── Add profile ────────────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.ADATA_ADD_PROFILE,
		async (_event, req: AdataAddProfileRequest) => {
			console.log(
				"[ipc] ADATA_ADD_PROFILE: agentId →",
				req.agentId,
				"selector →",
				req.selector,
			);
			const result = await handleAddProfile(nodeFileAdapter, req);
			if (!result.success) {
				console.error(
					"[ipc] ADATA_ADD_PROFILE: error —",
					result.error,
					result.errorCode,
				);
			}
			return result;
		},
	);

	// ── Update profile ─────────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.ADATA_UPDATE_PROFILE,
		async (_event, req: AdataUpdateProfileRequest) => {
			console.log(
				"[ipc] ADATA_UPDATE_PROFILE: agentId →",
				req.agentId,
				"profileId →",
				req.profileId,
			);
			const result = await handleUpdateProfile(nodeFileAdapter, req);
			if (!result.success) {
				console.error(
					"[ipc] ADATA_UPDATE_PROFILE: error —",
					result.error,
					result.errorCode,
				);
			}
			return result;
		},
	);

	// ── Remove profile ─────────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.ADATA_REMOVE_PROFILE,
		async (_event, req: AdataRemoveProfileRequest) => {
			console.log(
				"[ipc] ADATA_REMOVE_PROFILE: agentId →",
				req.agentId,
				"profileId →",
				req.profileId,
			);
			const result = await handleRemoveProfile(nodeFileAdapter, req);
			if (!result.success) {
				console.error(
					"[ipc] ADATA_REMOVE_PROFILE: error —",
					result.error,
					result.errorCode,
				);
			}
			return result;
		},
	);

	// ── Reorder profiles ───────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.ADATA_REORDER_PROFILES,
		async (_event, req: AdataReorderProfilesRequest) => {
			console.log(
				"[ipc] ADATA_REORDER_PROFILES: agentId →",
				req.agentId,
				"orderedIds →",
				req.orderedIds.length,
			);
			const result = await handleReorderProfiles(nodeFileAdapter, req);
			if (!result.success) {
				console.error(
					"[ipc] ADATA_REORDER_PROFILES: error —",
					result.error,
					result.errorCode,
				);
			}
			return result;
		},
	);

	// ══════════════════════════════════════════════════════════════════════
	// Permissions handlers
	//
	// Both handlers call pure functions in permissions-handlers.ts
	// (testable without Electron).
	// ══════════════════════════════════════════════════════════════════════

	// ── Get permissions ────────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.ADATA_GET_PERMISSIONS,
		async (_event, req: AdataGetPermissionsRequest) => {
			console.log("[ipc] ADATA_GET_PERMISSIONS: agentId →", req.agentId);
			const result = await handleGetPermissions(req);
			if (!result.success) {
				console.error("[ipc] ADATA_GET_PERMISSIONS: error —", result.error);
			}
			return result;
		},
	);

	// ── Set permissions ────────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.ADATA_SET_PERMISSIONS,
		async (_event, req: AdataSetPermissionsRequest) => {
			// ── Universal delegation guard (permissions.task) ──────────────────
			// Guarantees that every permissions payload written to .adata always
			// contains a `task` key as an object (empty if no sub-agents are
			// currently delegated). This is a universal defense to ensure correct
			// runtime behaviour and exportability to OpenCode.
			// Delegations that already carry `permissions.task` as an object are
			// left untouched — no mutation occurs on valid payloads.
			const permsRaw = req.permissions as Record<string, unknown>;
			if (typeof permsRaw.task !== "object" || permsRaw.task === null) {
				permsRaw.task = {};
			}
			// ──────────────────────────────────────────────────────────────────
			console.log(
				"[ipc] ADATA_SET_PERMISSIONS: agentId →",
				req.agentId,
				"tools →",
				req.permissions.length,
			);
			const result = await handleSetPermissions(req);
			if (!result.success) {
				console.error("[ipc] ADATA_SET_PERMISSIONS: error —", result.error);
			}
			return result;
		},
	);

	// ══════════════════════════════════════════════════════════════════════
	// Skills: scan {projectDir}/skills/ for SKILL.md files
	// ══════════════════════════════════════════════════════════════════════

	// ── Sync Tasks — bulk-write permissions.task for delegator agents ──────
	//
	// Receives a list of { agentId, taskAgentIds } entries and writes ONLY the
	// `task` key inside `permissions` for each agent's .adata file. All other
	// .adata fields (and all other permission keys) are preserved via spread merge.
	// Non-fatal: errors are accumulated per agent and returned in result.errors.
	ipcMain.handle(
		IPC_CHANNELS.SYNC_TASKS,
		async (_event, req: SyncTasksRequest) => {
			console.log("[ipc] SYNC_TASKS: entries →", req.entries.length);
			const result = await handleSyncTasks(req);
			console.log(
				"[ipc] SYNC_TASKS: updated →",
				result.updated,
				"errors →",
				result.errors.length,
			);
			return result;
		},
	);

	// ── List skills ────────────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.ADATA_LIST_SKILLS,
		async (_event, req: AdataListSkillsRequest) => {
			console.log("[ipc] ADATA_LIST_SKILLS: projectDir →", req.projectDir);
			const result = await handleListSkills(req);
			if (!result.success) {
				console.error("[ipc] ADATA_LIST_SKILLS: error —", result.error);
			}
			return result;
		},
	);

	// ══════════════════════════════════════════════════════════════════════
	// Agent rename (slug-first)
	//
	// Renames behaviors/<oldSlug> → behaviors/<newSlug> on disk and
	// updates all path references inside the agent's .adata file.
	// ══════════════════════════════════════════════════════════════════════

	ipcMain.handle(
		IPC_CHANNELS.RENAME_AGENT_FOLDER,
		async (
			_event,
			req: RenameAgentFolderRequest,
		): Promise<RenameAgentFolderResult> => {
			console.log(
				`[ipc] RENAME_AGENT_FOLDER: agentId=${req.agentId} ${req.oldSlug} → ${req.newSlug}`,
			);
			const result = await handleRenameAgentFolder(req);
			if (!result.success) {
				console.error("[ipc] RENAME_AGENT_FOLDER: error —", result.error);
			} else {
				console.log(`[ipc] RENAME_AGENT_FOLDER: complete — ${req.newSlug}`);
			}
			return result;
		},
	);

	// ══════════════════════════════════════════════════════════════════════
	// Export modal IPC handlers
	//
	// These four handlers support the OpenCode export feature:
	//   - SELECT_EXPORT_DIR:         open folder picker for export destination
	//   - WRITE_EXPORT_FILE:         write the serialized config to disk
	//   - LIST_SKILLS_FULL:          list all skills with SKILL.md content
	//   - READ_AGENT_PROFILES_FULL:  read all profile .md files for an agent
	//   - READ_AGENT_ADATA_RAW:      read the raw .adata object for an agent
	// ══════════════════════════════════════════════════════════════════════

	// ── Select export directory ────────────────────────────────────────────
	//
	// NOTE (DRY): Use BrowserWindow.fromWebContents(event.sender) instead of
	// BrowserWindow.getFocusedWindow() — the focused window is unreliable when
	// a modal dialog is open or when multiple windows exist.  All other dialog
	// handlers in this file follow this same pattern (OPEN_FOLDER_DIALOG,
	// OPEN_FILE_DIALOG, SELECT_NEW_PROJECT_DIR, WRITE_EXPORT_FILE, …).
	//
	// WORKAROUND: dialog.showOpenDialog can hang indefinitely when the renderer
	// modal steals focus or the OS compositor misbehaves. We race the dialog
	// promise against a 5-second timeout. If the dialog does not resolve within
	// 5 s we abort gracefully and return { dirPath: null } so the app never
	// freezes. The whole call is wrapped in try/catch for added safety.
	ipcMain.handle(
		IPC_CHANNELS.SELECT_EXPORT_DIR,
		async (event): Promise<SelectExportDirResult> => {
			console.log("[ipc] SELECT_EXPORT_DIR: opening folder picker");
			const win = BrowserWindow.fromWebContents(event.sender);
			const opts = {
				title: "Choose export directory",
				properties: ["openDirectory", "createDirectory"] as (
					| "openDirectory"
					| "createDirectory"
				)[],
			};

			const DIALOG_TIMEOUT_MS = 5_000;
			const timeoutPromise = new Promise<never>((_resolve, reject) =>
				setTimeout(
					() =>
						reject(
							new Error(
								`SELECT_EXPORT_DIR timed out after ${DIALOG_TIMEOUT_MS}ms`,
							),
						),
					DIALOG_TIMEOUT_MS,
				),
			);
			const dialogPromise = win
				? dialog.showOpenDialog(win, opts)
				: dialog.showOpenDialog(opts);

			try {
				const result = await Promise.race([dialogPromise, timeoutPromise]);
				const dirPath =
					result.canceled || result.filePaths.length === 0
						? null
						: result.filePaths[0]!;
				console.log(
					"[ipc] SELECT_EXPORT_DIR: selected →",
					dirPath ?? "(cancelled)",
				);
				return { dirPath };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(
					"[ipc] SELECT_EXPORT_DIR: dialog failed or timed out —",
					message,
				);
				return { dirPath: null };
			}
		},
	);

	// ── Write export file ──────────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.WRITE_EXPORT_FILE,
		async (
			_event,
			req: WriteExportFileRequest,
		): Promise<WriteExportFileResult> => {
			console.log(
				"[ipc] WRITE_EXPORT_FILE: dest →",
				req.destDir,
				"file →",
				req.fileName,
			);
			try {
				await mkdir(req.destDir, { recursive: true });

				// ── Backup existing file BEFORE overwriting ─────────────────────
				const backupResult = await backupExportFileIfExists(
					req.destDir,
					req.fileName,
				);
				if (backupResult.backedUp) {
					console.log(
						"[ipc] WRITE_EXPORT_FILE: backup created →",
						backupResult.backupPath,
					);
				}

				const fullPath = join(req.destDir, req.fileName);
				await writeFile(fullPath, req.content, "utf-8");
				console.log("[ipc] WRITE_EXPORT_FILE: written to", fullPath);
				return { success: true, filePath: fullPath };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[ipc] WRITE_EXPORT_FILE: error —", message);
				return { success: false, error: message };
			}
		},
	);

	// ── List skills full (name + content) ─────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.LIST_SKILLS_FULL,
		async (
			_event,
			req: ListSkillsFullRequest,
		): Promise<ListSkillsFullResult> => {
			console.log("[ipc] LIST_SKILLS_FULL: projectDir →", req.projectDir);
			try {
				const skillsDir = join(req.projectDir, "skills");
				const skills = await listSkillsFullFromDir(skillsDir);
				return { success: true, skills };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[ipc] LIST_SKILLS_FULL: error —", message);
				return { success: false, skills: [], error: message };
			}
		},
	);

	// ── Read agent profiles full (concatenated + individual .md content) ──
	ipcMain.handle(
		IPC_CHANNELS.READ_AGENT_PROFILES_FULL,
		async (
			_event,
			req: ReadAgentProfilesFullRequest,
		): Promise<ReadAgentProfilesFullResult> => {
			console.log("[ipc] READ_AGENT_PROFILES_FULL: agentId →", req.agentId);
			try {
				const result = await readAgentProfilesFull(req.projectDir, req.agentId);
				return result;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[ipc] READ_AGENT_PROFILES_FULL: error —", message);
				return {
					success: false,
					concatenatedContent: "",
					profiles: [],
					error: message,
				};
			}
		},
	);

	// ── Read agent .adata raw ──────────────────────────────────────────────
	ipcMain.handle(
		IPC_CHANNELS.READ_AGENT_ADATA_RAW,
		async (
			_event,
			req: ReadAgentAdataRawRequest,
		): Promise<ReadAgentAdataRawResult> => {
			console.log("[ipc] READ_AGENT_ADATA_RAW: agentId →", req.agentId);
			try {
				const adataFilePath = join(
					req.projectDir,
					"metadata",
					`${req.agentId}.adata`,
				);
				if (!existsSync(adataFilePath)) {
					return { success: true, adata: null };
				}
				const raw = await readFile(adataFilePath, "utf-8");
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				return { success: true, adata: parsed };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[ipc] READ_AGENT_ADATA_RAW: error —", message);
				return { success: false, adata: null, error: message };
			}
		},
	);

	// ══════════════════════════════════════════════════════════════════════
	// Skills export handler
	//
	// Copies all active skill directories from {projectDir}/skills/ to
	// {destDir}/skills/. When a file already exists at the destination, the
	// main process sends a SKILL_CONFLICT_PROMPT event to the renderer and
	// waits for a SKILL_CONFLICT_RESPONSE reply before continuing.
	//
	// The two-way conflict correlation is done via `promptId`:
	//   1. Main generates a unique promptId and sends SKILL_CONFLICT_PROMPT.
	//   2. Main waits via ipcMain.once(SKILL_CONFLICT_RESPONSE) filtered by promptId.
	//   3. Renderer calls respondSkillConflict({ promptId, action }) via preload.
	//   4. Main receives the response and resolves the conflict callback.
	// ══════════════════════════════════════════════════════════════════════
	ipcMain.handle(
		IPC_CHANNELS.EXPORT_SKILLS,
		async (event, req: ExportSkillsRequest): Promise<ExportSkillsResult> => {
			console.log(
				"[ipc] EXPORT_SKILLS: projectDir →",
				req.projectDir,
				"destDir →",
				req.destDir,
			);

			// Counter for generating unique promptIds within this invocation
			let promptCounter = 0;

			try {
				const result = await exportActiveSkills(
					req.projectDir,
					req.destDir,
					// Conflict callback: ask the renderer what to do
					(skillName, fileName) => {
						return new Promise<"replace" | "replace-all" | "cancel">(
							(resolve) => {
								const promptId = `skill-conflict-${Date.now()}-${promptCounter++}`;

								const prompt: ExportSkillsConflictPrompt = {
									promptId,
									skillName,
									fileName,
								};

								// Listen for the renderer's reply BEFORE sending the prompt,
								// to avoid a race where the reply arrives before we start listening.
								ipcMain.once(
									IPC_CHANNELS.SKILL_CONFLICT_RESPONSE,
									(_responseEvent, response: ExportSkillsConflictResponse) => {
										if (response.promptId === promptId) {
											resolve(response.action);
										}
										// If promptId doesn't match (stale reply), we keep waiting —
										// but that would be a bug on the renderer side. Log and resolve cancel.
										else {
											console.warn(
												"[ipc] EXPORT_SKILLS: received conflict response with mismatched promptId —",
												`expected=${promptId} got=${response.promptId}`,
											);
											resolve("cancel");
										}
									},
								);

								// Send conflict prompt to the renderer
								event.sender.send(IPC_CHANNELS.SKILL_CONFLICT_PROMPT, prompt);
							},
						);
					},
				);

				console.log(
					"[ipc] EXPORT_SKILLS: complete —",
					`aborted=${result.aborted}`,
					`copied=${result.copiedSkills.length}`,
					`skipped=${result.skippedSkills.length}`,
					`warnings=${result.warnings.length}`,
				);
				if (result.warnings.length > 0) {
					console.warn(
						"[ipc] EXPORT_SKILLS: skills allowed but missing from disk:",
						result.warnings.join(", "),
					);
				}

				return {
					success: true,
					aborted: result.aborted,
					copiedSkills: result.copiedSkills,
					skippedSkills: result.skippedSkills,
					skillWarnings: result.warnings,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[ipc] EXPORT_SKILLS: error —", message);
				return { success: false, error: message };
			}
		},
	);

	// ── Agent Profile Export Handler ────────────────────────────────────────
	// Exports agent profiles from metadata/*.adata as concatenated .md files.
	// Handles file conflicts with a modal dialog on the renderer side.

	ipcMain.handle(
		IPC_CHANNELS.EXPORT_AGENT_PROFILES,
		async (
			event,
			req: ExportAgentProfilesRequest,
		): Promise<ExportAgentProfilesResult> => {
			console.log(
				"[ipc] EXPORT_AGENT_PROFILES: projectDir →",
				req.projectDir,
				"destDir →",
				req.destDir,
			);

			// Counter for generating unique promptIds within this invocation
			let promptCounter = 0;

			try {
				const result = await exportAgentProfilesLogic(
					req.projectDir,
					req.destDir,
					// Conflict callback: ask the renderer what to do
					(destinationPath, agentName) => {
						return new Promise<"replace" | "replace-all" | "cancel">(
							(resolve) => {
								const promptId = `profile-conflict-${Date.now()}-${promptCounter++}`;

								const prompt: ExportProfileConflictPrompt = {
									promptId,
									agentName,
									destinationPath,
								};

								// Listen for the renderer's reply BEFORE sending the prompt,
								// to avoid a race where the reply arrives before we start listening.
								ipcMain.once(
									IPC_CHANNELS.PROFILE_CONFLICT_RESPONSE,
									(_responseEvent, response: ExportProfileConflictResponse) => {
										if (response.promptId === promptId) {
											resolve(response.action);
										}
										// If promptId doesn't match (stale reply), we keep waiting —
										// but that would be a bug on the renderer side. Log and resolve cancel.
										else {
											console.warn(
												"[ipc] EXPORT_AGENT_PROFILES: received conflict response with mismatched promptId —",
												`expected=${promptId} got=${response.promptId}`,
											);
											resolve("cancel");
										}
									},
								);

								// Send conflict prompt to the renderer
								event.sender.send(IPC_CHANNELS.PROFILE_CONFLICT_PROMPT, prompt);
							},
						);
					},
				);

				console.log(
					"[ipc] EXPORT_AGENT_PROFILES: complete —",
					`exported=${result.summary.exportedCount}`,
					`skipped=${result.summary.skippedCount}`,
					`warnings=${result.summary.warningCount}`,
				);
				if (result.warnings.length > 0) {
					console.warn(
						"[ipc] EXPORT_AGENT_PROFILES: warnings —",
						result.warnings.join("; "),
					);
				}

				return result;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[ipc] EXPORT_AGENT_PROFILES: error —", message);
				return {
					success: false,
					exported: [],
					skipped: [],
					warnings: [message],
					summary: {
						totalAgents: 0,
						exportedCount: 0,
						skippedCount: 0,
						warningCount: 1,
					},
					error: message,
				};
			}
		},
	);

	// ══════════════════════════════════════════════════════════════════════
	// GitHub HTTP fetch handler
	//
	// Proxies HTTPS GET requests to api.github.com through the main process
	// so the renderer is never blocked by CSP connect-src restrictions.
	//
	// The renderer cannot call fetch("https://api.github.com/...") directly
	// because Chromium enforces the CSP policy set via onHeadersReceived in
	// main.ts (connect-src defaults to 'self' + localhost only).
	//
	// Security guards:
	//   • Only URLs starting with "https://api.github.com/" are accepted.
	//     Any other origin is rejected with INVALID_URL before any I/O.
	//   • The Authorization header value is never logged.
	//   • Always resolves — never rejects.
	// ══════════════════════════════════════════════════════════════════════
	ipcMain.handle(
		IPC_CHANNELS.GITHUB_FETCH,
		async (_event, req: GitHubFetchRequest): Promise<GitHubFetchResult> => {
			const ALLOWED_ORIGIN = "https://api.github.com/";

			// ── URL guard ─────────────────────────────────────────────────────
			if (typeof req.url !== "string" || !req.url.startsWith(ALLOWED_ORIGIN)) {
				console.warn(
					"[ipc] GITHUB_FETCH: rejected URL (not api.github.com) →",
					req.url,
				);
				return {
					success: false,
					errorCode: "INVALID_URL",
					error: `Only URLs starting with "${ALLOWED_ORIGIN}" are allowed.`,
				};
			}

			console.log("[ipc] GITHUB_FETCH: →", req.url);

			return new Promise<GitHubFetchResult>((resolve) => {
				const requestOptions: https.RequestOptions = {
					method: "GET",
					headers: {
						Accept: "application/vnd.github+json",
						"User-Agent": "AgentsFlow-Electron",
						"X-GitHub-Api-Version": "2022-11-28",
						...(req.token ? { Authorization: `Bearer ${req.token}` } : {}),
					},
				};

				const request = https.request(req.url, requestOptions, (res) => {
					let body = "";
					res.setEncoding("utf-8");
					res.on("data", (chunk: string) => {
						body += chunk;
					});
					res.on("end", () => {
						console.log(
							"[ipc] GITHUB_FETCH: status →",
							res.statusCode,
							"url →",
							req.url,
						);
						resolve({
							success:
								(res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
							status: res.statusCode,
							body,
						});
					});
				});

				request.on("error", (err: Error) => {
					console.error("[ipc] GITHUB_FETCH: network error —", err.message);
					resolve({
						success: false,
						errorCode: "NETWORK_ERROR",
						error: err.message,
					});
				});

				request.setTimeout(15_000, () => {
					request.destroy();
					console.error("[ipc] GITHUB_FETCH: request timed out →", req.url);
					resolve({
						success: false,
						errorCode: "NETWORK_ERROR",
						error: "Request timed out after 15 seconds.",
					});
				});

				request.end();
			});
		},
	);

	// ══════════════════════════════════════════════════════════════════════
	// Folder Explorer handlers
	//
	// The three `folder-explorer:*` channels are registered via the dedicated
	// module in electron-main/src/ipc/folder-explorer.ts.
	//
	// Design rationale:
	//   • Handler logic lives in electron-main (testable without Electron).
	//   • This call is the ONLY place that wires them into the live ipcMain.
	//   • registerFolderExplorerHandlers() follows the same "ipcMain as param"
	//     pattern used by profile-handlers, permissions-handlers, etc.
	//
	// Channels registered:
	//   • folder-explorer:list          → lists entries under $HOME
	//   • folder-explorer:stat          → metadata for a single path
	//   • folder-explorer:read-children → batch-list parallel directories
	//
	// Order note: the folder-explorer group is placed LAST in this function.
	// There is no dependency on any prior handler, but registering it last
	// ensures core project-loading channels are always available first, which
	// matches user-observable startup priority.
	// ══════════════════════════════════════════════════════════════════════
	registerFolderExplorerHandlers(ipcMain);
	registerGitBranchesHandlers(ipcMain);

	// ══════════════════════════════════════════════════════════════════════
	// Git Clone handler — full implementation
	//
	// Features:
	//   • Ephemeral authenticated URL (cleared immediately after spawn)
	//   • Real-time progress via stderr parsing + IPC git:clone:progress events
	//   • Throttled progress emission (max 1 event per 500ms per stage change)
	//   • activeClones registry for cancellation support
	//   • Concurrency limit (MAX_CONCURRENT_CLONES)
	//   • Sanitized logging — credentials NEVER appear in logs
	//   • Detailed error mapping (AUTH_ERROR, NETWORK_ERROR, DEST_EXISTS, etc.)
	//   • technicalDetails field in result for UI "Detalles técnicos" section
	//
	// Security:
	//   • GIT_TERMINAL_PROMPT=0 and GIT_ASKPASS="" prevent interactive prompts
	//   • cloneUrl cleared immediately after spawn (line: cloneUrl = "")
	//   • All stderr/logs pass through sanitizeCredentials()
	//   • auth object is never stored in activeClones or any persistent state
	// ══════════════════════════════════════════════════════════════════════

	ipcMain.handle(
		IPC_CHANNELS.GIT_CLONE,
		async (
			event,
			req: CloneRepositoryRequest,
		): Promise<CloneRepositoryResult> => {
			const { url, destDir, cloneId } = req;

			// ── Validate cloneId ─────────────────────────────────────────────
			if (!cloneId || typeof cloneId !== "string") {
				return {
					success: false,
					errorCode: "INVALID_URL",
					error: "Missing or invalid cloneId in request.",
				};
			}

			// ── Validate URL (main-process guard) ─────────────────────────────
			// The renderer validates before sending, but we re-validate here as a
			// defence-in-depth measure. An empty or non-parseable URL would cause
			// `new URL(url)` to throw silently later, leaving auth stripped.
			if (!url || typeof url !== "string" || !url.trim()) {
				return {
					success: false,
					cloneId,
					errorCode: "INVALID_URL",
					error: "Repository URL is required.",
				};
			}
			// Must be a parseable absolute URL (https/http/git/ssh) or SSH shorthand
			const looksLikeUrl =
				/^https?:\/\/.+/.test(url.trim()) ||
				/^git@.+:.+/.test(url.trim()) ||
				/^(git|ssh):\/\/.+/.test(url.trim());
			if (!looksLikeUrl) {
				return {
					success: false,
					cloneId,
					errorCode: "INVALID_URL",
					error: `Invalid repository URL: "${sanitizeCredentials(url)}"`,
				};
			}

			// ── Validate destDir ──────────────────────────────────────────────
			if (!destDir || typeof destDir !== "string" || !destDir.trim()) {
				return {
					success: false,
					cloneId,
					errorCode: "IO_ERROR",
					error: "Destination directory is required.",
				};
			}
			try {
				const destStat = await stat(destDir);
				if (!destStat.isDirectory()) {
					return {
						success: false,
						cloneId,
						errorCode: "IO_ERROR",
						error: `Destination path is not a directory: ${destDir}`,
					};
				}
			} catch {
				return {
					success: false,
					cloneId,
					errorCode: "IO_ERROR",
					error: `Destination directory does not exist or is not accessible: ${destDir}`,
				};
			}

			// ── Concurrency guard ─────────────────────────────────────────────
			if (activeClones.size >= MAX_CONCURRENT_CLONES) {
				console.warn(
					`[GIT_CLONE] Concurrent limit reached (${MAX_CONCURRENT_CLONES}) — rejecting cloneId=${cloneId}`,
				);
				return {
					success: false,
					cloneId,
					errorCode: "CONCURRENT_LIMIT",
					error: `Maximum concurrent clones (${MAX_CONCURRENT_CLONES}) reached. Wait for an active clone to finish.`,
				};
			}

			// ── Derive repo name ─────────────────────────────────────────────
			const repoName =
				req.repoName?.trim() ||
				basename(url.replace(/\/+$/, ""))
					.replace(/\.git$/i, "")
					.replace(/[/:]/g, "_") ||
				"repo";

			const clonedPath = join(destDir, repoName);

			// ── Check destination ─────────────────────────────────────────────
			if (existsSync(clonedPath)) {
				let isEmpty = true;
				try {
					const entries = await readdir(clonedPath);
					isEmpty = entries.length === 0;
				} catch {
					isEmpty = false;
				}
				if (!isEmpty) {
					return {
						success: false,
						cloneId,
						errorCode: "DEST_EXISTS",
						error: `Destination already exists and is not empty: ${clonedPath}`,
						technicalDetails: `Path: ${clonedPath}`,
					};
				}
			}

			// ── Build ephemeral authenticated URL ─────────────────────────────
			// SECURITY: cloneUrl is cleared immediately after spawn.
			// Never log cloneUrl — always log the original `url` (no credentials).
			let cloneUrl: string = url;
			if (req.auth?.username && req.auth?.token) {
				try {
					const authUrl = new URL(url);
					authUrl.username = encodeURIComponent(req.auth.username);
					authUrl.password = encodeURIComponent(req.auth.token);
					cloneUrl = authUrl.toString();
				} catch {
					// Invalid URL — continue without auth; git will fail with a clear error
					cloneUrl = url;
				}
			}

			// Log ALWAYS with clean URL (no credentials)
			console.log(
				`[GIT_CLONE] Starting clone: cloneId=${cloneId} url=${url} → ${clonedPath}`,
			);

			return new Promise<CloneRepositoryResult>((resolve) => {
				let stderrBuffer = "";

				// ── Progress throttling state ──────────────────────────────────
				// Emit at most one progress event per 500ms per unique stage change
				// to avoid flooding the renderer IPC channel.
				let lastEmittedPercent: number | undefined = undefined;
				let lastEmittedStage: string | undefined = undefined;
				let lastEmitTime = 0;
				const PROGRESS_THROTTLE_MS = 500;

				// ── Spawn git clone ────────────────────────────────────────────
				const child = spawn(
					"git",
					["clone", "--progress", "--", cloneUrl, clonedPath],
					{
						stdio: ["ignore", "pipe", "pipe"],
						env: {
							...process.env,
							// Prevent interactive auth prompts — let git fail fast
							GIT_TERMINAL_PROMPT: "0",
							GIT_ASKPASS: "",
						},
					},
				);

				// SECURITY: Clear authenticated URL reference immediately after spawn.
				// The variable goes out of scope at function exit, but we zero it now
				// to minimize the window during which it exists in memory.
				cloneUrl = "";

				// Register in activeClones BEFORE any async work
				activeClones.set(cloneId, child);

				// ── Stdout (git clone is mostly silent on stdout) ──────────────
				child.stdout?.on("data", () => {
					// Intentionally ignored — git clone progress goes to stderr
				});

				// ── Stderr: progress parsing ───────────────────────────────────
				child.stderr?.on("data", (chunk: Buffer) => {
					// Sanitize before any processing — credentials must never appear
					const raw = sanitizeCredentials(chunk.toString());
					stderrBuffer += raw;

					// Split on CR or LF to handle git's \r progress updates
					const lines = raw.split(/[\r\n]+/);

					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed) continue;

						// ── Parse progress percentage ──────────────────────────
						// Git progress lines look like:
						//   "Receiving objects:  45% (450/1000), 1.23 MiB | 500 KiB/s"
						//   "Resolving deltas:  12% (12/100)"
						//   "Counting objects: 100% (100/100), done."
						const progressMatch = trimmed.match(
							/^([A-Za-z][A-Za-z ]+?):\s+(\d{1,3})%/,
						);

						let stage: CloneProgressEvent["stage"] = "UNKNOWN_STAGE";
						let percent: number | undefined = undefined;

						if (progressMatch) {
							const stageRaw = progressMatch[1]?.trim().toLowerCase() ?? "";
							percent = Math.min(
								100,
								Math.max(0, parseInt(progressMatch[2] ?? "0", 10)),
							);

							if (stageRaw.includes("counting")) {
								stage = "COUNTING_OBJECTS";
							} else if (stageRaw.includes("compress")) {
								stage = "COMPRESSING";
							} else if (stageRaw.includes("receiving")) {
								stage = "RECEIVING_OBJECTS";
							} else if (stageRaw.includes("resolving")) {
								stage = "RESOLVING_DELTAS";
							} else if (stageRaw.includes("checking out")) {
								stage = "CHECKING_OUT";
							} else {
								stage = "UNKNOWN_STAGE";
							}
						}

						// ── Throttle emission ──────────────────────────────────
						// Emit if: stage changed OR percent changed OR 500ms elapsed
						const now = Date.now();
						const stageChanged = stage !== lastEmittedStage;
						const percentChanged = percent !== lastEmittedPercent;
						const timeElapsed = now - lastEmitTime >= PROGRESS_THROTTLE_MS;

						if (stageChanged || percentChanged || timeElapsed) {
							lastEmittedStage = stage;
							lastEmittedPercent = percent;
							lastEmitTime = now;

							const progressPayload: CloneProgressEvent = {
								cloneId,
								stage,
								percent,
								raw: trimmed,
							};

							// Guard: sender may have been destroyed if window closed
							try {
								if (!event.sender.isDestroyed()) {
									event.sender.send(
										IPC_CHANNELS.GIT_CLONE_PROGRESS,
										progressPayload,
									);
								}
							} catch {
								// Renderer gone — continue clone but stop emitting
							}
						}
					}
				});

				// ── Process error (e.g. git not found) ────────────────────────
				child.on("error", (err: NodeJS.ErrnoException) => {
					activeClones.delete(cloneId);
					cancelledCloneIds.delete(cloneId);
					if (err.code === "ENOENT") {
						console.error("[GIT_CLONE] git binary not found — ENOENT");
						resolve({
							success: false,
							cloneId,
							errorCode: "GIT_NOT_FOUND",
							error:
								"`git` binary was not found. Make sure Git is installed and on your PATH.",
							technicalDetails: err.message,
						});
					} else {
						console.error(
							"[GIT_CLONE] spawn error —",
							sanitizeCredentials(err.message),
						);
						resolve({
							success: false,
							cloneId,
							errorCode: "IO_ERROR",
							error: `Spawn error: ${sanitizeCredentials(err.message)}`,
							technicalDetails: sanitizeCredentials(err.message),
						});
					}
				});

				// ── Process close ──────────────────────────────────────────────
				child.on("close", (code: number | null, signal: string | null) => {
					activeClones.delete(cloneId);

					// Cancelled by user: check both the module-level set (cross-handler
					// communication, works on all platforms including Windows where
					// signal may be null) and the signal name as a fallback.
					const wasCancelled =
						cancelledCloneIds.has(cloneId) ||
						signal === "SIGTERM" ||
						signal === "SIGKILL";
					cancelledCloneIds.delete(cloneId);

					if (wasCancelled) {
						console.log(
							`[GIT_CLONE] Cancelled: cloneId=${cloneId} signal=${signal ?? "none (cancelled via cancelledCloneIds)"}`,
						);
						resolve({
							success: false,
							cloneId,
							errorCode: "CANCELLED",
							error: "Clone cancelled by user.",
							technicalDetails: `Signal: ${signal ?? "none"}`,
						});
						return;
					}

					if (code === 0) {
						console.log(
							`[GIT_CLONE] Success: cloneId=${cloneId} → ${clonedPath}`,
						);
						resolve({ success: true, cloneId, clonedPath });
						return;
					}

					// Map stderr to error code
					const errorCode = mapGitStderrToErrorCode(stderrBuffer);
					const sanitizedStderr = sanitizeCredentials(stderrBuffer.trim());

					console.error(
						`[GIT_CLONE] Failed: cloneId=${cloneId} code=${code} errorCode=${errorCode}`,
					);
					// SECURITY: sanitizedStderr has already had credentials removed
					console.error("[GIT_CLONE] stderr (sanitized):", sanitizedStderr);

					resolve({
						success: false,
						cloneId,
						errorCode,
						error: sanitizedStderr || `git clone exited with code ${code}`,
						technicalDetails: sanitizedStderr,
					});
				});
			});
		},
	);

	// ══════════════════════════════════════════════════════════════════════
	// Git Clone Cancel handler
	//
	// Sends SIGTERM to the child process identified by cloneId.
	// If the process does not exit within 5 seconds, sends SIGKILL.
	// ══════════════════════════════════════════════════════════════════════

	ipcMain.handle(
		IPC_CHANNELS.GIT_CLONE_CANCEL,
		async (_event, req: CloneCancelRequest): Promise<CloneCancelResult> => {
			const { cloneId } = req;
			const child = activeClones.get(cloneId);

			if (!child) {
				console.warn(
					`[GIT_CLONE_CANCEL] No active clone found for cloneId=${cloneId}`,
				);
				return {
					sent: false,
					message: `No active clone found for cloneId: ${cloneId}`,
				};
			}

			console.log(
				`[GIT_CLONE_CANCEL] Sending SIGTERM to cloneId=${cloneId} pid=${child.pid}`,
			);

			// Register cancellation BEFORE sending the signal so the close handler
			// (which runs in the GIT_CLONE Promise closure) can detect it reliably
			// on all platforms, including Windows where signal may arrive as null.
			cancelledCloneIds.add(cloneId);

			child.kill("SIGTERM");

			// Schedule SIGKILL if process does not exit within 5 seconds
			const sigkillTimeout = setTimeout(() => {
				if (activeClones.has(cloneId)) {
					console.warn(
						`[GIT_CLONE_CANCEL] Process did not exit after 5s — sending SIGKILL cloneId=${cloneId}`,
					);
					child.kill("SIGKILL");
				}
			}, 5_000);

			// Clear the SIGKILL timeout if the process exits naturally
			child.once("close", () => {
				clearTimeout(sigkillTimeout);
			});

			return {
				sent: true,
				message: `Cancellation signal sent to clone ${cloneId}.`,
			};
		},
	);

	// ══════════════════════════════════════════════════════════════════════
	// Git Clone Validate handler
	//
	// Validates a GitHub Personal Access Token against GET /user.
	// Returns CloneValidateResult with status 200/401/403/429.
	//
	// Security:
	//   • Token is used only for this request — never logged or persisted.
	//   • Authorization header value is never logged.
	//   • Rate-limit headers are inspected but never forwarded to the renderer.
	// ══════════════════════════════════════════════════════════════════════

	ipcMain.handle(
		IPC_CHANNELS.GIT_CLONE_VALIDATE,
		async (_event, req: CloneValidateRequest): Promise<CloneValidateResult> => {
			// SECURITY: Do NOT log req.token
			console.log("[GIT_CLONE_VALIDATE] Validating token against GitHub API");

			if (!req.token || typeof req.token !== "string" || !req.token.trim()) {
				return {
					valid: false,
					message: "Token vacío o inválido.",
					errorCode: "TOKEN_INVALID",
				};
			}

			return new Promise<CloneValidateResult>((resolve) => {
				const requestOptions: https.RequestOptions = {
					method: "GET",
					hostname: "api.github.com",
					path: "/user",
					headers: {
						Accept: "application/vnd.github+json",
						"User-Agent": "AgentsFlow-Electron",
						"X-GitHub-Api-Version": "2022-11-28",
						// SECURITY: token value is never logged
						Authorization: `Bearer ${req.token}`,
					},
				};

				const request = https.request(requestOptions, (res) => {
					let body = "";
					res.setEncoding("utf-8");
					res.on("data", (chunk: string) => {
						body += chunk;
					});
					res.on("end", () => {
						const status = res.statusCode ?? 0;
						// SECURITY: Do NOT log the Authorization header or token
						console.log(
							"[GIT_CLONE_VALIDATE] GitHub API response status:",
							status,
						);

						if (status === 200) {
							resolve({
								valid: true,
								status,
								message: "Token válido. Autenticación correcta.",
							});
						} else if (status === 401) {
							resolve({
								valid: false,
								status,
								message: "Token inválido o expirado (HTTP 401).",
								errorCode: "TOKEN_INVALID",
							});
						} else if (status === 403) {
							// Could be rate-limited or missing scope
							const rateLimitRemaining = res.headers["x-ratelimit-remaining"];
							const isRateLimited =
								rateLimitRemaining !== undefined &&
								parseInt(String(rateLimitRemaining), 10) === 0;
							if (isRateLimited) {
								resolve({
									valid: false,
									status,
									message:
										"Rate limit de GitHub alcanzado (HTTP 403). Intente más tarde.",
									errorCode: "RATE_LIMITED",
								});
							} else {
								resolve({
									valid: false,
									status,
									message:
										'Token sin permisos suficientes (HTTP 403). Asegúrese de que el token tenga scope "repo".',
									errorCode: "TOKEN_NO_SCOPE",
								});
							}
						} else if (status === 429) {
							resolve({
								valid: false,
								status,
								message:
									"Rate limit de GitHub alcanzado (HTTP 429). Intente más tarde.",
								errorCode: "RATE_LIMITED",
							});
						} else {
							resolve({
								valid: false,
								status,
								message: `Respuesta inesperada de GitHub API (HTTP ${status}).`,
								errorCode: "UNKNOWN",
							});
						}
					});
				});

				request.on("error", (err: Error) => {
					console.error("[GIT_CLONE_VALIDATE] Network error —", err.message);
					resolve({
						valid: false,
						message: `Error de red al validar token: ${err.message}`,
						errorCode: "NETWORK_ERROR",
					});
				});

				request.setTimeout(10_000, () => {
					request.destroy();
					console.error("[GIT_CLONE_VALIDATE] Request timed out");
					resolve({
						valid: false,
						message: "Tiempo de espera agotado al validar token.",
						errorCode: "NETWORK_ERROR",
					});
				});

				request.end();
			});
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.GIT_SAVE_CREDENTIALS,
		async (
			_event,
			req: SaveGitCredentialsRequest,
		): Promise<SaveGitCredentialsResult> => {
			// SECURITY: never log token value
			console.log(
				`[ipc] GIT_SAVE_CREDENTIALS: projectDir=${req.projectDir} username=${req.username}`,
			);

			const result = await saveGitCredentialsToEnv(
				req.projectDir,
				req.username,
				req.token,
			);

			if (!result.success) {
				console.error(
					"[ipc] GIT_SAVE_CREDENTIALS: failed —",
					result.errorCode,
					result.error,
				);
			}

			return result;
		},
	);
}

// ── registerGitHandlers ────────────────────────────────────────────────────

/**
 * Registers the GET_GIT_REMOTE_ORIGIN IPC handler.
 *
 * Returns the URL of the remote `origin` for the given project directory,
 * or null when the directory is not a Git repo, has no origin, or git is
 * unavailable. Never throws — all errors resolve to null.
 */
export function registerGitHandlers(): void {
	ipcMain.handle(
		IPC_CHANNELS.GET_GIT_REMOTE_ORIGIN,
		async (_event, projectDir: string): Promise<string | null> => {
			return detectGitRemoteOrigin(projectDir);
		},
	);
}
