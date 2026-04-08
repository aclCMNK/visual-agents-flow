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
import { readFile, writeFile, mkdir, rename, rm, copyFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";

import { ProjectLoader } from "../loader/project-loader.ts";
import { atomicWriteJson } from "../loader/lock-manager.ts";
import { validateNewProjectDir, createProject } from "../loader/project-factory.ts";
import type { LoadResult, ProjectModel, AgentModel } from "../loader/types.ts";

import { IPC_CHANNELS } from "./bridge.types.ts";
import type {
  BridgeLoadResult,
  SerializableProjectModel,
  SerializableAgentModel,
  LoadProjectRequest,
  ValidateProjectRequest,
  RepairProjectRequest,
  SaveProjectRequest,
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
} from "./bridge.types.ts";

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

async function addToRecentProjects(projectDir: string, name: string): Promise<void> {
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
    agents,
    connections: model.connections.map((c) => ({
      id: c.id,
      fromAgentId: c.fromAgentId,
      toAgentId: c.toAgentId,
      label: c.label,
      type: c.type,
    })),
    properties: model.afproj.properties ?? {},
    entrypointId: model.entrypoint?.ref.id,
    loadedAt: model.loadedAt,
  };
}

function serializeAgentModel(agent: AgentModel): SerializableAgentModel {
  return {
    id: agent.ref.id,
    name: agent.ref.name,
    profilePath: agent.ref.profilePath,
    adataPath: agent.ref.adataPath,
    isEntrypoint: agent.ref.isEntrypoint,
    position: agent.ref.position,
    description: agent.adata.description,
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

  // ── Open folder dialog ─────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.OPEN_FOLDER_DIALOG, async (event) => {
    console.log("[ipc] OPEN_FOLDER_DIALOG: opening native folder picker");
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      title: "Open AgentFlow Project",
      properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[],
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);

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
    async (event, options: { title?: string; filters?: { name: string; extensions: string[] }[] } = {}) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts = {
        title: options.title ?? "Open File",
        properties: ["openFile"] as ("openFile")[],
        filters: options.filters ?? [{ name: "All Files", extensions: ["*"] }],
      };
      const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);

      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0] ?? null;
    }
  );

  // ── Select directory for NEW project creation ──────────────────────────
  // Separate from OPEN_FOLDER_DIALOG so the dialog title is contextual
  // and the channel semantics are clear.
  ipcMain.handle(IPC_CHANNELS.SELECT_NEW_PROJECT_DIR, async (event) => {
    console.log("[ipc] SELECT_NEW_PROJECT_DIR: opening native folder picker for new project");
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      title: "Select folder for new project",
      buttonLabel: "Choose Folder",
      properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);

    if (result.canceled || result.filePaths.length === 0) {
      console.log("[ipc] SELECT_NEW_PROJECT_DIR: user cancelled or no selection");
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
      console.log("[ipc] VALIDATE_NEW_PROJECT_DIR: result →", JSON.stringify(result));
      return result;
    }
  );

  // ── Create new project scaffold ────────────────────────────────────────
  // Delegates to project-factory.ts which handles atomic creation + rollback.
  ipcMain.handle(
    IPC_CHANNELS.CREATE_PROJECT,
    async (_event, req: CreateProjectRequest): Promise<CreateProjectResult> => {
      console.log("[ipc] CREATE_PROJECT: creating project →", JSON.stringify({ name: req.name, projectDir: req.projectDir }));
      const result = await createProject(req);

      // On success, register in recent-projects so it appears in the browser
      if (result.success && result.projectDir) {
        console.log("[ipc] CREATE_PROJECT: success, projectDir →", result.projectDir);
        await addToRecentProjects(result.projectDir, req.name.trim());
      } else {
        console.error("[ipc] CREATE_PROJECT: failed →", result.error, result.errorCode);
      }

      return result;
    }
  );

  // ── Load project ───────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.LOAD_PROJECT, async (_event, req: LoadProjectRequest) => {
    console.log("[ipc] LOAD_PROJECT: loading →", req.projectDir);
    const loader = new ProjectLoader(req.projectDir);
    const result = await loader.load({ ...(req.options ?? {}), mode: "load" });

    if (result.success && result.project) {
      console.log("[ipc] LOAD_PROJECT: success, agents →", result.project.agents.size);
      await addToRecentProjects(req.projectDir, result.project.afproj.name);
    } else {
      console.error("[ipc] LOAD_PROJECT: failed →", result.summary.errors, "errors");
    }

    return toBridgeLoadResult(result);
  });

  // ── Validate project (dry-run) ─────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.VALIDATE_PROJECT, async (_event, req: ValidateProjectRequest) => {
    const loader = new ProjectLoader(req.projectDir);
    const result = await loader.load({
      ...(req.options ?? {}),
      mode: "dry-run",
      // For validation, skip loading markdown content for speed
      loadBehaviorFiles: false,
      loadSkillFiles: false,
    });
    return toBridgeLoadResult(result);
  });

  // ── Repair project ─────────────────────────────────────────────────────
  // Applies all auto-repairable issues to disk, then reloads the project.
  ipcMain.handle(IPC_CHANNELS.REPAIR_PROJECT, async (_event, req: RepairProjectRequest) => {
    const loader = new ProjectLoader(req.projectDir);
    const result = await loader.load({
      ...(req.options ?? {}),
      mode: "repair",
    });

    if (result.success && result.project) {
      await addToRecentProjects(req.projectDir, result.project.afproj.name);
    }

    return toBridgeLoadResult(result);
  });

  // ── Save project ───────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SAVE_PROJECT, async (_event, req: SaveProjectRequest): Promise<SaveProjectResult> => {
    console.log("[ipc] SAVE_PROJECT: saving →", req.projectDir, "updates →", JSON.stringify(req.updates));
    try {
      // Read the current .afproj from disk so we preserve all fields
      // (e.g. id, createdAt, agents, connections) that the UI does not send.
      const loader = new ProjectLoader(req.projectDir);
      const loadResult = await loader.load({ mode: "load", loadBehaviorFiles: false, loadSkillFiles: false });

      if (!loadResult.success || !loadResult.project) {
        const errMsg = `Cannot save: project has ${loadResult.summary.errors} error(s). Validate and fix them first.`;
        console.error("[ipc] SAVE_PROJECT: load failed —", errMsg);
        return { success: false, error: errMsg };
      }

      // Merge UI updates into the existing .afproj — preserve immutable fields
      const afproj = { ...loadResult.project.afproj };
      if (req.updates.name !== undefined) afproj.name = req.updates.name.trim() || afproj.name;
      if (req.updates.description !== undefined) afproj.description = req.updates.description;
      if (req.updates.properties !== undefined) afproj.properties = req.updates.properties;
      afproj.updatedAt = new Date().toISOString();

      await atomicWriteJson(loadResult.project.afprojPath, afproj);
      console.log("[ipc] SAVE_PROJECT: success, written →", loadResult.project.afprojPath);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ipc] SAVE_PROJECT: unexpected error —", message);
      return { success: false, error: message };
    }
  });

  // ── Export project ─────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.EXPORT_PROJECT, async (event, req: ExportProjectRequest): Promise<ExportProjectResult> => {
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
  });

  // ── Get recent projects ─────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.GET_RECENT_PROJECTS, async (): Promise<RecentProject[]> => {
    return readRecentProjects();
  });

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
    }
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
    }
  );

  /** Reads a .md file. Rejects any non-.md path. */
  ipcMain.handle(
    IPC_CHANNELS.ASSET_READ_FILE,
    async (_event, filePath: string): Promise<AssetReadResult> => {
      const ext = extname(filePath).toLowerCase();
      if (ext !== ".md") {
        return { success: false, error: "Only .md files can be read through the asset panel." };
      }
      try {
        const content = await readFile(filePath, "utf-8");
        return { success: true, content };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  /** Writes (creates or overwrites) a .md file. Rejects non-.md paths. */
  ipcMain.handle(
    IPC_CHANNELS.ASSET_WRITE_FILE,
    async (_event, filePath: string, content: string): Promise<AssetOpResult> => {
      const ext = extname(filePath).toLowerCase();
      if (ext !== ".md") {
        return { success: false, error: "Only .md files can be written through the asset panel." };
      }
      try {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  /** Creates a directory (recursive — parents created if needed). */
  ipcMain.handle(
    IPC_CHANNELS.ASSET_CREATE_DIR,
    async (_event, dirPath: string): Promise<AssetOpResult> => {
      try {
        await mkdir(dirPath, { recursive: true });
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  /** Renames a file or directory. */
  ipcMain.handle(
    IPC_CHANNELS.ASSET_RENAME,
    async (_event, oldPath: string, newPath: string): Promise<AssetOpResult> => {
      // Guard: if renaming a file, ensure the target still has .md extension
      const oldExt = extname(oldPath).toLowerCase();
      const newExt = extname(newPath).toLowerCase();
      if (oldExt === ".md" && newExt !== ".md") {
        return { success: false, error: "Renamed file must keep the .md extension." };
      }
      try {
        await rename(oldPath, newPath);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  /** Deletes a file or directory (recursive). */
  ipcMain.handle(
    IPC_CHANNELS.ASSET_DELETE,
    async (_event, targetPath: string): Promise<AssetOpResult> => {
      // Guard: never delete .afproj or .adata files
      const ext = extname(targetPath).toLowerCase();
      if (ext === ".afproj" || ext === ".adata") {
        return { success: false, error: "Project files (.afproj, .adata) cannot be deleted through the asset panel." };
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
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  /**
   * Imports (copies) a file into destDir.
   * Only .md source files are accepted. The destination filename preserves the source name.
   */
  ipcMain.handle(
    IPC_CHANNELS.ASSET_IMPORT_FILE,
    async (_event, srcPath: string, destDir: string): Promise<AssetOpResult> => {
      const ext = extname(srcPath).toLowerCase();
      if (ext !== ".md") {
        return { success: false, error: "Only .md files can be imported." };
      }
      try {
        const destPath = join(destDir, basename(srcPath));
        await copyFile(srcPath, destPath);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  /** Opens a native file picker filtered to .md files. */
  ipcMain.handle(
    IPC_CHANNELS.ASSET_OPEN_MD_DIALOG,
    async (event): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts = {
        title: "Import Markdown File",
        filters: [{ name: "Markdown Files", extensions: ["md"] }],
        properties: ["openFile"] as ("openFile")[],
      };
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0] ?? null;
    }
  );
}
