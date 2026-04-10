/**
 * src/electron/permissions-handlers.ts
 *
 * Pure handler functions for the Permissions IPC channels.
 *
 * These functions are separated from ipc-handlers.ts so they can be:
 *   1. Tested in isolation (no Electron IPC dependency, no real filesystem)
 *   2. Called directly from ipc-handlers.ts
 *
 * The permissions object is stored at the top level of each agent's .adata file:
 *
 * ```json
 * {
 *   "permissions": {
 *     "read": "allow",
 *     "execute": "ask",
 *     "Bash": {
 *       "run-scripts": "allow",
 *       "write-files": "deny"
 *     }
 *   }
 * }
 * ```
 *
 * - Top-level string values → ungrouped permissions (key → value)
 * - Top-level object values → grouped permissions (groupName → { perm: value, ... })
 * - `value` is one of: "allow" | "deny" | "ask"
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { atomicWriteJson } from "../loader/lock-manager.ts";
import type {
  AdataGetPermissionsRequest,
  AdataGetPermissionsResult,
  AdataSetPermissionsRequest,
  AdataSetPermissionsResult,
  PermissionsObject,
  PermissionValue,
} from "./bridge.types.ts";

// ── Normalisation ─────────────────────────────────────────────────────────

/**
 * Valid permission values.
 */
const VALID_PERMISSION_VALUES = new Set<string>(["allow", "deny", "ask"]);

function isValidPermissionValue(v: unknown): v is PermissionValue {
  return typeof v === "string" && VALID_PERMISSION_VALUES.has(v);
}

/**
 * Normalise a raw `permissions` value from a .adata object.
 *
 * Expected shape:
 *   {
 *     "perm": "value",            ← ungrouped (string value)
 *     "group": {                  ← grouped (object value)
 *       "perm": "value",
 *       ...
 *     }
 *   }
 *
 * - Missing or non-object → returns {}
 * - Keys with invalid values (not "allow"|"deny"|"ask" strings or group objects) are skipped
 * - Within groups, keys with invalid values are skipped
 */
export function normalisePermissions(raw: unknown): PermissionsObject {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};

  const obj = raw as Record<string, unknown>;
  const result: PermissionsObject = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isValidPermissionValue(value)) {
      // Ungrouped permission
      result[key] = value;
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      // Group of permissions
      const group = value as Record<string, unknown>;
      const normalisedGroup: Record<string, PermissionValue> = {};
      for (const [groupKey, groupValue] of Object.entries(group)) {
        if (isValidPermissionValue(groupValue)) {
          normalisedGroup[groupKey] = groupValue;
        }
        // silently skip invalid group entries
      }
      result[key] = normalisedGroup;
    }
    // silently skip invalid top-level entries (numbers, booleans, arrays, null, etc.)
  }

  return result;
}

// ── Disk helpers ──────────────────────────────────────────────────────────

/**
 * Reads the permissions object from disk (metadata/<agentId>.adata).
 * Returns an empty object if the file does not exist or has no permissions key.
 */
export async function readPermissionsFromDisk(
  projectDir: string,
  agentId: string,
): Promise<PermissionsObject> {
  const adataPath = join(projectDir, "metadata", `${agentId}.adata`);
  let raw: string;
  try {
    raw = await readFile(adataPath, "utf-8");
  } catch {
    return {};
  }
  const adata = JSON.parse(raw) as Record<string, unknown>;
  return normalisePermissions(adata.permissions);
}

/**
 * Writes the permissions object to disk (metadata/<agentId>.adata).
 * Preserves all existing .adata fields.
 *
 * @throws if the .adata file does not exist
 */
export async function writePermissionsToDisk(
  projectDir: string,
  agentId: string,
  permissions: PermissionsObject,
): Promise<void> {
  const adataPath = join(projectDir, "metadata", `${agentId}.adata`);
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(adataPath, "utf-8");
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Agent .adata file not found: ${adataPath}`);
  }

  const updated: Record<string, unknown> = {
    ...existing,
    permissions,
    updatedAt: new Date().toISOString(),
  };

  await atomicWriteJson(adataPath, updated);
}

// ── IPC handlers ──────────────────────────────────────────────────────────

/**
 * Reads the permissions object from the agent's .adata file.
 */
export async function handleGetPermissions(
  req: AdataGetPermissionsRequest,
): Promise<AdataGetPermissionsResult> {
  try {
    const permissions = await readPermissionsFromDisk(req.projectDir, req.agentId);
    return { success: true, permissions };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, permissions: {}, error: message };
  }
}

/**
 * Writes (replaces) the full permissions object in the agent's .adata file.
 */
export async function handleSetPermissions(
  req: AdataSetPermissionsRequest,
): Promise<AdataSetPermissionsResult> {
  try {
    await writePermissionsToDisk(req.projectDir, req.agentId, req.permissions);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
