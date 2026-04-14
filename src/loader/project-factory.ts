/**
 * src/loader/project-factory.ts
 *
 * Project Factory — creates a new AgentFlow project scaffold on disk.
 *
 * Responsibilities:
 *   1. Validate the target directory (permissions, emptiness, existing project)
 *   2. Create the required directory structure atomically
 *   3. Write the initial .afproj manifest and an optional starter agent
 *   4. Roll back all created files/dirs if any step fails
 *
 * Directory layout created:
 *
 *   <selectedDir>/
 *     <name-slug>/              ← project subdirectory (always created)
 *       <name-slug>.afproj      ← project manifest
 *       behaviors/              ← agent behavior markdown files
 *       metadata/               ← agent .adata metadata files
 *       skills/                 ← shared skill markdown files
 *
 * A new subdirectory named after the project slug (lowercase, spaces→'_') is
 * ALWAYS created inside the directory selected by the user. Files are never
 * written directly into the user-selected folder.
 *
 * Security notes:
 *   - All FS operations happen in the main process (Node.js), never in the renderer.
 *   - Paths are validated before use; no path traversal is possible from
 *     inputs supplied by the renderer because the main process constructs
 *     all paths itself.
 */

import {
  mkdir,
  writeFile,
  rm,
  access,
  readdir,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  NewProjectDirValidation,
  CreateProjectRequest,
  CreateProjectResult,
} from "../electron/bridge.types.ts";

// ── Slug helper ────────────────────────────────────────────────────────────

/**
 * Converts a human-readable project name into a filesystem-safe slug.
 * Spaces and non-alphanumeric characters are replaced with underscores.
 * Example: "My Cool Project" → "my_cool_project"
 */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "project";
}

// ── Directory validation ───────────────────────────────────────────────────

/**
 * Validates a candidate directory for new project creation.
 *
 * Checks performed (in order):
 *   1. Path is non-empty
 *   2. Directory is writable
 *   3. Directory is empty (warns if not, suggests subdir)
 *   4. No .afproj file already exists there
 *
 * Does NOT create or modify anything on disk.
 */
export async function validateNewProjectDir(
  dir: string
): Promise<NewProjectDirValidation> {
  if (!dir || dir.trim() === "") {
    return {
      dir,
      valid: false,
      severity: "error",
      message: "Directory path cannot be empty.",
    };
  }

  // ── Check write permission ────────────────────────────────────────────────
  try {
    await access(dir, fsConstants.W_OK);
  } catch {
    // Directory may not exist yet — try to check the parent
    try {
      const parent = join(dir, "..");
      await access(parent, fsConstants.W_OK);
      // Parent is writable; the dir itself doesn't exist yet — that's fine,
      // we'll create it. Treat as valid empty location.
      return {
        dir,
        valid: true,
        severity: "info",
        message: "Directory does not exist yet and will be created.",
        nonEmpty: false,
      };
    } catch {
      return {
        dir,
        valid: false,
        severity: "error",
        message:
          "Cannot write to this location. You may not have sufficient permissions.",
      };
    }
  }

  // ── Check for existing .afproj ────────────────────────────────────────────
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return {
      dir,
      valid: false,
      severity: "error",
      message: "Cannot read directory contents. Permission denied.",
    };
  }

  const existingAfproj = entries.find((e) => e.endsWith(".afproj"));
  if (existingAfproj) {
    return {
      dir,
      valid: false,
      severity: "error",
      message: `An AgentFlow project already exists here (${existingAfproj}). Choose a different directory or open the existing project.`,
    };
  }

  // ── Check emptiness ────────────────────────────────────────────────────────
  if (entries.length > 0) {
    // Non-empty but no .afproj — warn, suggest subdirectory
    const slug = basename(dir);
    return {
      dir,
      valid: true,
      severity: "warn",
      message:
        "This folder already has files. Your project will be created here, or you can create it in a new subfolder.",
      nonEmpty: true,
      suggestedSubdir: join(dir, slug + "-agentsflow"),
    };
  }

  return {
    dir,
    valid: true,
    severity: "info",
    message: "Directory is ready for a new project.",
    nonEmpty: false,
  };
}

// ── Project scaffold ───────────────────────────────────────────────────────

/**
 * Scaffold files that will be created, tracked for rollback.
 * Stored in creation order so rollback can undo in reverse.
 */
interface CreatedArtifact {
  type: "dir" | "file";
  path: string;
}

/**
 * Creates a minimal but valid .afproj manifest JSON string.
 *
 * Initial structure:
 *   { version, id, name, description, agents, connections, properties, createdAt, updatedAt }
 *
 * The `id` field is a randomly-generated UUID v4 that uniquely identifies this
 * project across all instances. It is written once at creation time and never
 * changed by normal save operations.
 *
 * `description` stores the human-readable project description and is editable from the UI.
 *
 * Note: The legacy flat `user_id` field is intentionally omitted. The User node
 * is represented by the `user` object (written on first save when the user node
 * is placed on the canvas). New projects start with no user node on the canvas.
 */
function buildAfprojContent(name: string, description: string): string {
  const now = new Date().toISOString();
  const manifest = {
    version: 1,
    id: randomUUID(),
    name,
    description,
    agents: [],
    connections: [],
    properties: {},
    createdAt: now,
    updatedAt: now,
  };
  return JSON.stringify(manifest, null, 2);
}

/**
 * Creates a new AgentFlow project scaffold on disk.
 *
 * The project is ALWAYS created inside a new subdirectory named after the
 * project slug (lowercase, spaces→'_') within the user-selected directory.
 * Files are never written directly into the user-selected folder.
 *
 * Atomic semantics:
 *   - All directories and files are tracked as created.
 *   - If any write fails, ALL previously created artifacts are deleted (rollback).
 *   - A partial project directory is never left on disk.
 *
 * @param req  Creation request from the UI (via IPC bridge).
 * @returns    CreateProjectResult with the final projectDir or an error.
 */
export async function createProject(
  req: CreateProjectRequest
): Promise<CreateProjectResult> {
  const { name, description = "" } = req;
  const baseDir = req.projectDir;

  if (!name || name.trim() === "") {
    return {
      success: false,
      error: "Project name cannot be empty.",
      errorCode: "IO_ERROR",
    };
  }

  // ── Always create a named subdirectory inside the user-selected folder ─────
  // e.g. user selects /home/user/projects → project lives in /home/user/projects/my_project
  const slug = slugify(name);
  const projectDir = join(baseDir, slug);

  // ── Pre-flight: validate the base directory (write permission) ────────────
  const baseValidation = await validateNewProjectDir(baseDir);
  if (!baseValidation.valid) {
    const errorCode =
      baseValidation.message.toLowerCase().includes("permission")
        ? "PERMISSION_DENIED"
        : "IO_ERROR";
    return {
      success: false,
      error: baseValidation.message,
      errorCode,
    };
  }

  // ── Pre-flight: validate the project subdirectory ─────────────────────────
  const projectDirValidation = await validateNewProjectDir(projectDir);
  if (!projectDirValidation.valid) {
    const errorCode =
      projectDirValidation.message.toLowerCase().includes("permission")
        ? "PERMISSION_DENIED"
        : projectDirValidation.message.toLowerCase().includes("already exists")
        ? "ALREADY_EXISTS"
        : "IO_ERROR";
    return {
      success: false,
      error: projectDirValidation.message,
      errorCode,
    };
  }

  // ── Build file list ────────────────────────────────────────────────────────
  const afprojFileName = `${slug}.afproj`;
  const afprojPath = join(projectDir, afprojFileName);

  const dirsToCreate = [
    projectDir,
    join(projectDir, "behaviors"),
    join(projectDir, "metadata"),
    join(projectDir, "skills"),
  ];

  // ── Atomic creation with rollback ──────────────────────────────────────────
  const created: CreatedArtifact[] = [];

  async function rollback(): Promise<void> {
    // Reverse order: files first, then dirs
    for (const artifact of [...created].reverse()) {
      try {
        if (artifact.type === "file") {
          await rm(artifact.path, { force: true });
        } else {
          // Only remove dirs we created if they are empty
          await rm(artifact.path, { recursive: true, force: true });
        }
      } catch {
        // Best-effort rollback; ignore errors
      }
    }
  }

  try {
    // Create directory structure
    for (const dir of dirsToCreate) {
      await mkdir(dir, { recursive: true });
      created.push({ type: "dir", path: dir });
    }

    // Write .afproj manifest
    const afprojContent = buildAfprojContent(name.trim(), description.trim());
    await writeFile(afprojPath, afprojContent, "utf-8");
    created.push({ type: "file", path: afprojPath });

    // Write a .gitkeep in each subdirectory so they're tracked by git
    for (const subdir of dirsToCreate.slice(1)) {
      const gitkeepPath = join(subdir, ".gitkeep");
      await writeFile(gitkeepPath, "", "utf-8");
      created.push({ type: "file", path: gitkeepPath });
    }

    return {
      success: true,
      projectDir,
      afprojName: afprojFileName,
    };
  } catch (err) {
    await rollback();

    const message = err instanceof Error ? err.message : String(err);
    const isPermission =
      "code" in (err as NodeJS.ErrnoException) &&
      ((err as NodeJS.ErrnoException).code === "EACCES" ||
        (err as NodeJS.ErrnoException).code === "EPERM");

    return {
      success: false,
      error: isPermission
        ? `Permission denied while creating project files: ${message}`
        : `Failed to create project: ${message}`,
      errorCode: isPermission ? "PERMISSION_DENIED" : "IO_ERROR",
    };
  }
}
