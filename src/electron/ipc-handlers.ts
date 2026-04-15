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
import { buildAdataFromExisting } from "./adata-builder.ts";
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
} from "./permissions-handlers.ts";
import { handleListSkills } from "./skills-handlers.ts";
import { handleRenameAgentFolder } from "./rename-agent-folder.ts";
import { exportActiveSkills } from "./skill-export-handlers.ts";

// ── Folder Explorer ────────────────────────────────────────────────────────
// The folder-explorer handlers live in the electron-main module tree because
// they depend on the homeJail and filter utilities that also live there.
// We import the registration function (not the handlers directly) to keep
// the dependency direction clean: src/electron → electron-main/src/ipc.
//
// NOTE: registerFolderExplorerHandlers() receives `ipcMain` as a parameter
// so that it remains testable without a running Electron instance.
import { registerFolderExplorerHandlers, FOLDER_EXPLORER_CHANNELS } from "../../electron-main/src/ipc/index.ts";

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
    user: model.afproj.user
      ? { user_id: model.afproj.user.user_id, position: model.afproj.user.position }
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
async function listSkillsFullFromDir(skillsDir: string): Promise<Array<{
  name: string;
  relativePath: string;
  content: string;
}>> {
  const results: Array<{ name: string; relativePath: string; content: string }> = [];

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
  profiles: Array<{ filePath: string; selector: string; label?: string; content: string }>;
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
  type RawProfile = { id?: string; selector?: string; filePath?: string; label?: string; order?: number; enabled?: boolean };
  const sorted = (rawProfiles as RawProfile[])
    .filter((p) => p.enabled !== false && typeof p.filePath === "string")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const profiles: Array<{ filePath: string; selector: string; label?: string; content: string }> = [];

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
            return entries
              .filter((e) => e.isFile())
              .map((e) => e.name);
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
          migrateErr instanceof Error ? migrateErr.message : String(migrateErr),
        );
      }
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
    async (_event, req: SaveAgentGraphRequest): Promise<SaveAgentGraphResult> => {
      console.log(
        "[ipc] SAVE_AGENT_GRAPH: saving →",
        req.projectDir,
        `agents=${req.agents.length}`,
        `edges=${req.edges.length}`
      );
      try {
        const metadataDir = join(req.projectDir, "metadata");
        const behaviorsDir = join(req.projectDir, "behaviors");

        // ── 1. Locate the .afproj file ───────────────────────────────────
        // Find the first .afproj in the project directory.
        let afprojPath: string | null = null;
        try {
          const entries = await readdir(req.projectDir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isFile() && e.name.endsWith(".afproj")) {
              afprojPath = join(req.projectDir, e.name);
              break;
            }
          }
        } catch (err) {
          return { success: false, error: `Cannot read project directory: ${err instanceof Error ? err.message : String(err)}` };
        }

        if (!afprojPath) {
          return { success: false, error: "No .afproj file found in project directory." };
        }

        // ── 2. Read and parse the existing .afproj ───────────────────────
        let existingAfproj: Record<string, unknown>;
        try {
          const raw = await readFile(afprojPath, "utf-8");
          existingAfproj = JSON.parse(raw) as Record<string, unknown>;
        } catch (err) {
          return { success: false, error: `Cannot parse .afproj: ${err instanceof Error ? err.message : String(err)}` };
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
          label: edge.relationType === "Delegation"
            ? (edge.delegationType !== "Optional" ? edge.delegationType : undefined)
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
            await writeFile(profilePath, profileContent, { encoding: "utf-8", flag: "w" });
            console.log("[ipc] SAVE_AGENT_GRAPH: profile.md created →", profilePath);
          }
        }

        // ── 6. Delete .adata files for agents no longer in the graph ─────
        const currentIds = new Set(req.agents.map((n) => n.id));
        try {
          const metaEntries = await readdir(metadataDir, { withFileTypes: true });
          for (const e of metaEntries) {
            if (!e.isFile() || !e.name.endsWith(".adata")) continue;
            const agentId = e.name.slice(0, -6); // strip ".adata"
            if (!currentIds.has(agentId)) {
              const stale = join(metadataDir, e.name);
              await rm(stale, { force: true });
              console.log("[ipc] SAVE_AGENT_GRAPH: deleted stale .adata →", stale);
            }
          }
        } catch {
          // metadata dir may not exist yet — nothing to clean up
        }

        console.log("[ipc] SAVE_AGENT_GRAPH: complete");
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[ipc] SAVE_AGENT_GRAPH: unexpected error —", message);
        return { success: false, error: message };
      }
    }
  );

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

  // ── Adapter field: read from .adata ────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ADATA_GET_ADAPTER,
    async (_event, req: AdataAdapterRequest): Promise<AdataGetAdapterResult> => {
      try {
        const adataPath = join(req.projectDir, "metadata", `${req.agentId}.adata`);
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
        return { success: false, adapter: null, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // ── Adapter field: write to .adata ─────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ADATA_SET_ADAPTER,
    async (_event, req: AdataSetAdapterRequest): Promise<AdataSetAdapterResult> => {
      try {
        const adataPath = join(req.projectDir, "metadata", `${req.agentId}.adata`);

        // Read existing .adata (required — must exist for an agent in the graph)
        let existing: Record<string, unknown> = {};
        try {
          const raw = await readFile(adataPath, "utf-8");
          existing = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return { success: false, error: `Agent .adata file not found: ${adataPath}` };
        }

        // Update only the adapter field inside metadata — preserve everything else
        const existingMeta = (existing.metadata as Record<string, unknown>) ?? {};
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
        console.log("[ipc] ADATA_SET_ADAPTER: written →", adataPath, "adapter →", req.adapter);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[ipc] ADATA_SET_ADAPTER: error —", message);
        return { success: false, error: message };
      }
    }
  );

  // ── OpenCode config: read from .adata ──────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ADATA_GET_OPENCODE_CONFIG,
    async (_event, req: AdataGetOpenCodeConfigRequest): Promise<AdataGetOpenCodeConfigResult> => {
      try {
        const adataPath = join(req.projectDir, "metadata", `${req.agentId}.adata`);
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
        return { success: false, config: null, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // ── OpenCode config: write to .adata ───────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ADATA_SET_OPENCODE_CONFIG,
    async (_event, req: AdataSetOpenCodeConfigRequest): Promise<AdataSetOpenCodeConfigResult> => {
      try {
        const adataPath = join(req.projectDir, "metadata", `${req.agentId}.adata`);

        // Read existing .adata (must exist — agent must have been saved first)
        let existing: Record<string, unknown> = {};
        try {
          const raw = await readFile(adataPath, "utf-8");
          existing = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return { success: false, error: `Agent .adata file not found: ${adataPath}` };
        }

        // Write opencode config at the top-level 'opencode' key — preserve everything else
        // temperature is always stored; default to 0.05 if caller omits it
        const temperature =
          typeof req.config.temperature === "number" && isFinite(req.config.temperature)
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
        console.log("[ipc] ADATA_SET_OPENCODE_CONFIG: written →", adataPath, "config →", JSON.stringify(req.config));
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[ipc] ADATA_SET_OPENCODE_CONFIG: error —", message);
        return { success: false, error: message };
      }
    }
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
        console.error("[ipc] ADATA_LIST_PROFILES: error —", result.error, result.errorCode);
      }
      return result;
    }
  );

  // ── Add profile ────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ADATA_ADD_PROFILE,
    async (_event, req: AdataAddProfileRequest) => {
      console.log("[ipc] ADATA_ADD_PROFILE: agentId →", req.agentId, "selector →", req.selector);
      const result = await handleAddProfile(nodeFileAdapter, req);
      if (!result.success) {
        console.error("[ipc] ADATA_ADD_PROFILE: error —", result.error, result.errorCode);
      }
      return result;
    }
  );

  // ── Update profile ─────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ADATA_UPDATE_PROFILE,
    async (_event, req: AdataUpdateProfileRequest) => {
      console.log("[ipc] ADATA_UPDATE_PROFILE: agentId →", req.agentId, "profileId →", req.profileId);
      const result = await handleUpdateProfile(nodeFileAdapter, req);
      if (!result.success) {
        console.error("[ipc] ADATA_UPDATE_PROFILE: error —", result.error, result.errorCode);
      }
      return result;
    }
  );

  // ── Remove profile ─────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ADATA_REMOVE_PROFILE,
    async (_event, req: AdataRemoveProfileRequest) => {
      console.log("[ipc] ADATA_REMOVE_PROFILE: agentId →", req.agentId, "profileId →", req.profileId);
      const result = await handleRemoveProfile(nodeFileAdapter, req);
      if (!result.success) {
        console.error("[ipc] ADATA_REMOVE_PROFILE: error —", result.error, result.errorCode);
      }
      return result;
    }
  );

  // ── Reorder profiles ───────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ADATA_REORDER_PROFILES,
    async (_event, req: AdataReorderProfilesRequest) => {
      console.log("[ipc] ADATA_REORDER_PROFILES: agentId →", req.agentId, "orderedIds →", req.orderedIds.length);
      const result = await handleReorderProfiles(nodeFileAdapter, req);
      if (!result.success) {
        console.error("[ipc] ADATA_REORDER_PROFILES: error —", result.error, result.errorCode);
      }
      return result;
    }
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
    }
  );

  // ── Set permissions ────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ADATA_SET_PERMISSIONS,
    async (_event, req: AdataSetPermissionsRequest) => {
      console.log("[ipc] ADATA_SET_PERMISSIONS: agentId →", req.agentId, "tools →", req.permissions.length);
      const result = await handleSetPermissions(req);
      if (!result.success) {
        console.error("[ipc] ADATA_SET_PERMISSIONS: error —", result.error);
      }
      return result;
    }
  );

  // ══════════════════════════════════════════════════════════════════════
  // Skills: scan {projectDir}/skills/ for SKILL.md files
  // ══════════════════════════════════════════════════════════════════════

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
    }
  );

  // ══════════════════════════════════════════════════════════════════════
  // Agent rename (slug-first)
  //
  // Renames behaviors/<oldSlug> → behaviors/<newSlug> on disk and
  // updates all path references inside the agent's .adata file.
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle(
    IPC_CHANNELS.RENAME_AGENT_FOLDER,
    async (_event, req: RenameAgentFolderRequest): Promise<RenameAgentFolderResult> => {
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
    }
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
        properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[],
      };

      const DIALOG_TIMEOUT_MS = 5_000;
      const timeoutPromise = new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error(`SELECT_EXPORT_DIR timed out after ${DIALOG_TIMEOUT_MS}ms`)), DIALOG_TIMEOUT_MS)
      );
      const dialogPromise = win
        ? dialog.showOpenDialog(win, opts)
        : dialog.showOpenDialog(opts);

      try {
        const result = await Promise.race([dialogPromise, timeoutPromise]);
        const dirPath = result.canceled || result.filePaths.length === 0
          ? null
          : result.filePaths[0]!;
        console.log("[ipc] SELECT_EXPORT_DIR: selected →", dirPath ?? "(cancelled)");
        return { dirPath };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[ipc] SELECT_EXPORT_DIR: dialog failed or timed out —", message);
        return { dirPath: null };
      }
    }
  );

  // ── Write export file ──────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.WRITE_EXPORT_FILE,
    async (_event, req: WriteExportFileRequest): Promise<WriteExportFileResult> => {
      console.log("[ipc] WRITE_EXPORT_FILE: dest →", req.destDir, "file →", req.fileName);
      try {
        const fullPath = join(req.destDir, req.fileName);
        await mkdir(req.destDir, { recursive: true });
        await writeFile(fullPath, req.content, "utf-8");
        console.log("[ipc] WRITE_EXPORT_FILE: written to", fullPath);
        return { success: true, filePath: fullPath };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[ipc] WRITE_EXPORT_FILE: error —", message);
        return { success: false, error: message };
      }
    }
  );

  // ── List skills full (name + content) ─────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.LIST_SKILLS_FULL,
    async (_event, req: ListSkillsFullRequest): Promise<ListSkillsFullResult> => {
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
    }
  );

  // ── Read agent profiles full (concatenated + individual .md content) ──
  ipcMain.handle(
    IPC_CHANNELS.READ_AGENT_PROFILES_FULL,
    async (_event, req: ReadAgentProfilesFullRequest): Promise<ReadAgentProfilesFullResult> => {
      console.log("[ipc] READ_AGENT_PROFILES_FULL: agentId →", req.agentId);
      try {
        const result = await readAgentProfilesFull(req.projectDir, req.agentId);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[ipc] READ_AGENT_PROFILES_FULL: error —", message);
        return { success: false, concatenatedContent: "", profiles: [], error: message };
      }
    }
  );

  // ── Read agent .adata raw ──────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.READ_AGENT_ADATA_RAW,
    async (_event, req: ReadAgentAdataRawRequest): Promise<ReadAgentAdataRawResult> => {
      console.log("[ipc] READ_AGENT_ADATA_RAW: agentId →", req.agentId);
      try {
        const adataFilePath = join(req.projectDir, "metadata", `${req.agentId}.adata`);
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
    }
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
      console.log("[ipc] EXPORT_SKILLS: projectDir →", req.projectDir, "destDir →", req.destDir);

      // Counter for generating unique promptIds within this invocation
      let promptCounter = 0;

      try {
        const result = await exportActiveSkills(
          req.projectDir,
          req.destDir,
          // Conflict callback: ask the renderer what to do
          (skillName, fileName) => {
            return new Promise<"replace" | "replace-all" | "cancel">((resolve) => {
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
            });
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
    async (event, req: ExportAgentProfilesRequest): Promise<ExportAgentProfilesResult> => {
      console.log("[ipc] EXPORT_AGENT_PROFILES: projectDir →", req.projectDir, "destDir →", req.destDir);

      // Counter for generating unique promptIds within this invocation
      let promptCounter = 0;

      try {
        const result = await exportAgentProfilesLogic(
          req.projectDir,
          req.destDir,
          // Conflict callback: ask the renderer what to do
          (destinationPath, agentName) => {
            return new Promise<"replace" | "replace-all" | "cancel">((resolve) => {
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
            });
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
}
