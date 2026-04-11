/**
 * src/electron/rename-agent-folder.ts
 *
 * Pure handler logic for renaming an agent's behaviors folder on disk
 * and updating all path references in its .adata file.
 *
 * This module has NO Electron imports — it can be tested in bun:test
 * without the full Electron environment.
 *
 * The `registerIpcHandlers()` in ipc-handlers.ts delegates to this.
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { atomicWriteJson } from "../loader/lock-manager.ts";
import type {
  RenameAgentFolderRequest,
  RenameAgentFolderResult,
} from "./bridge.types.ts";

/**
 * Renames `behaviors/<oldSlug>` → `behaviors/<newSlug>` on disk, then
 * rewrites all path references in the agent's `.adata` file.
 *
 * Behavior:
 * - No-op (returns success) when `oldSlug === newSlug`.
 * - Returns `CONFLICT` if `behaviors/<newSlug>` already exists.
 * - Creates `behaviors/<newSlug>` fresh if `behaviors/<oldSlug>` is absent.
 * - Tolerates a missing `.adata` file (still succeeds after renaming).
 */
export async function handleRenameAgentFolder(
  req: RenameAgentFolderRequest,
): Promise<RenameAgentFolderResult> {
  const { projectDir, agentId, oldSlug, newSlug } = req;

  const behaviorsDir = join(projectDir, "behaviors");
  const oldDir       = join(behaviorsDir, oldSlug);
  const newDir       = join(behaviorsDir, newSlug);
  const adataPath    = join(projectDir, "metadata", `${agentId}.adata`);

  try {
    // 1. No-op when oldSlug === newSlug
    if (oldSlug === newSlug) {
      return { success: true };
    }

    // 2. Guard: conflict — target folder already exists
    if (existsSync(newDir)) {
      return {
        success: false,
        error: `Cannot rename: behaviors/${newSlug} already exists.`,
        errorCode: "CONFLICT",
      };
    }

    // 3. Rename behaviors/<oldSlug> → behaviors/<newSlug>
    if (existsSync(oldDir)) {
      await rename(oldDir, newDir);
    } else {
      // Old folder doesn't exist — create the new one fresh
      await mkdir(newDir, { recursive: true });
    }

    // 4. Rewrite profilePath and profile[] filePaths in .adata
    let adata: Record<string, unknown> = {};
    try {
      const raw = await readFile(adataPath, "utf-8");
      adata = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // .adata might not exist yet; that's ok — proceed without it
    }

    const oldPrefix = `behaviors/${oldSlug}/`;
    const newPrefix = `behaviors/${newSlug}/`;

    // Update top-level profilePath
    if (
      typeof adata.profilePath === "string" &&
      adata.profilePath.startsWith(oldPrefix)
    ) {
      adata.profilePath = newPrefix + adata.profilePath.slice(oldPrefix.length);
    }

    // Update agentName
    adata.agentName = newSlug;

    // Update profile[].filePath entries
    if (Array.isArray(adata.profile)) {
      adata.profile = (adata.profile as Record<string, unknown>[]).map((p) => {
        if (
          typeof p.filePath === "string" &&
          p.filePath.startsWith(oldPrefix)
        ) {
          return { ...p, filePath: newPrefix + p.filePath.slice(oldPrefix.length) };
        }
        return p;
      });
    }

    adata.updatedAt = new Date().toISOString();
    await atomicWriteJson(adataPath, adata);

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, errorCode: "IO_ERROR" };
  }
}
