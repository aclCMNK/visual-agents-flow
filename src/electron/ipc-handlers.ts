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
} from "./bridge.types.ts";

import {
  handleListProfiles,
  handleAddProfile,
  handleUpdateProfile,
  handleRemoveProfile,
  handleReorderProfiles,
} from "./profile-handlers.ts";
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

          const adata: Record<string, unknown> = {
            version: 1,
            agentId: node.id,
            agentName: node.name,
            description: node.description,
            aspects: (existing.aspects as unknown[]) ?? [],
            skills: (existing.skills as unknown[]) ?? [],
            subagents: (existing.subagents as unknown[]) ?? [],
            // Use existing profilePath if set (RENAME_AGENT_FOLDER may have updated it),
            // otherwise fall back to the slug-based default.
            profilePath: (typeof existing.profilePath === "string" && existing.profilePath.length > 0)
              ? existing.profilePath
              : `behaviors/${node.name}/profile.md`,
            // Preserve existing profile[] entries (managed by RENAME_AGENT_FOLDER / profile handlers)
            profile: (existing.profile as unknown[]) ?? [],
            metadata: {
              ...((existing.metadata as Record<string, unknown>) ?? {}),
              agentType: node.type,
              isOrchestrator: String(node.isOrchestrator),
              // hidden is only meaningful for Sub-Agent; always false for other types
              hidden: node.type === "Sub-Agent" ? String(node.hidden) : "false",
            },
            createdAt: (existing.createdAt as string) ?? now,
            updatedAt: now,
          };

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
}
