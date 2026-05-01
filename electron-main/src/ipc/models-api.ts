/**
 * electron-main/src/ipc/models-api.ts
 *
 * IPC Handler — Models API (models.dev/api.json)
 * ───────────────────────────────────────────────
 * Registers the `models-api:get-models` channel that lets the renderer
 * request the models.dev API data with automatic caching and fallback.
 *
 * ┌────────────────────────────────────────────────────────────────────┐
 * │  Channel                    │  Purpose                            │
 * ├────────────────────────────────────────────────────────────────────┤
 * │  models-api:get-models      │  Returns models.dev/api.json data   │
 * │                             │  with status: fresh | downloaded |  │
 * │                             │  fallback | unavailable             │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * CACHE LOGIC
 * ───────────
 * 1. Check if <projectRoot>/models/api/models.dev.json exists and is < 5 days old.
 * 2. If fresh → return cached data with status "fresh".
 * 3. If stale → attempt download:
 *    - Success → save, return data with status "downloaded".
 *    - Failure + old cache exists → return old data with status "fallback".
 *    - Failure + no cache → return null data with status "unavailable".
 *
 * DESIGN NOTES
 * ─────────────
 * - `ipcMain` is passed as a parameter for testability (no Electron import).
 * - A module-level in-progress flag prevents concurrent downloads.
 * - All errors are caught; the handler never throws to the renderer.
 */

import type { IpcMain } from "electron";
import {
  getCacheFilePath as _getCacheFilePath,
  isCacheStale as _isCacheStale,
  downloadAndSave as _downloadAndSave,
  readCacheFile as _readCacheFile,
  MODELS_DEV_URL,
} from "../fs/models-api-cache.ts";

// ── Injectable deps (for testability) ────────────────────────────────────────

export interface ModelsApiDeps {
  getCacheFilePath: () => string;
  isCacheStale: (p: string) => Promise<boolean>;
  downloadAndSave: (p: string) => Promise<void>;
  readCacheFile: (p: string) => Promise<unknown | null>;
}

const defaultDeps: ModelsApiDeps = {
  getCacheFilePath: _getCacheFilePath,
  isCacheStale: _isCacheStale,
  downloadAndSave: _downloadAndSave,
  readCacheFile: _readCacheFile,
};

// ── Channel names ─────────────────────────────────────────────────────────────

export const MODELS_API_CHANNELS = {
  GET_MODELS: "models-api:get-models",
} as const;

// ── Response types ────────────────────────────────────────────────────────────

/**
 * Describes the outcome of the cache/download operation.
 *
 * - "fresh"      — File existed and was not stale; returned without downloading.
 * - "downloaded" — File was stale (or missing); download succeeded.
 * - "fallback"   — Download failed; returned the previously cached version.
 * - "unavailable"— Download failed and no cache exists; data is null.
 */
export type ModelsApiStatus =
  | "fresh"
  | "downloaded"
  | "fallback"
  | "unavailable";

/** The result envelope returned by the IPC handler to the renderer. */
export interface ModelsApiResult {
  /** True unless status is "unavailable". */
  ok: boolean;
  /** Describes what happened during the cache/download cycle. */
  status: ModelsApiStatus;
  /** The parsed models.dev JSON, or null if unavailable. */
  data: unknown | null;
  /** Error message if status is "fallback" or "unavailable". */
  error?: string;
}

// ── Concurrency guard ─────────────────────────────────────────────────────────

/**
 * Prevents multiple simultaneous downloads when several windows call
 * `get-models` at the same time (e.g. on macOS "activate").
 *
 * If a download is already in progress, subsequent calls wait for the
 * same promise to resolve rather than starting a new fetch.
 */
let _downloadInProgress: Promise<void> | null = null;

// ── Handler implementation ────────────────────────────────────────────────────

/**
 * Handles `models-api:get-models`.
 *
 * Orchestrates the cache check → download → fallback logic and returns
 * a `ModelsApiResult` to the renderer. Never throws.
 */
export async function handleGetModels(
  _event: Electron.IpcMainInvokeEvent,
  deps: ModelsApiDeps = defaultDeps,
): Promise<ModelsApiResult> {
  const { getCacheFilePath, isCacheStale, downloadAndSave, readCacheFile } = deps;
  const filePath = getCacheFilePath();
  console.log("[models-api] handleGetModels invoked — cache path:", filePath);

  try {
    const stale = await isCacheStale(filePath);

    if (!stale) {
      // Cache is fresh — return without downloading
      const data = await readCacheFile(filePath);
      return { ok: true, status: "fresh", data };
    }

    // Cache is stale — attempt download (with concurrency guard)
    try {
      if (_downloadInProgress) {
        await _downloadInProgress;
      } else {
        _downloadInProgress = downloadAndSave(filePath);
        await _downloadInProgress;
        _downloadInProgress = null;
      }

      const data = await readCacheFile(filePath);
      return { ok: true, status: "downloaded", data };
    } catch (downloadErr) {
      _downloadInProgress = null;
      const errorMsg =
        downloadErr instanceof Error ? downloadErr.message : String(downloadErr);

      // ── Explicit error log for download failure ──
      console.error(
        "[models-api] Download failed for",
        MODELS_DEV_URL,
        "→",
        errorMsg,
      );

      // Download failed — try to use old cache
      const fallbackData = await readCacheFile(filePath);
      if (fallbackData !== null) {
        console.warn("[models-api] Using fallback cache from:", filePath);
        return {
          ok: true,
          status: "fallback",
          data: fallbackData,
          error: errorMsg,
        };
      }

      // No cache at all
      console.error("[models-api] No cache available — returning unavailable");
      return {
        ok: false,
        status: "unavailable",
        data: null,
        error: errorMsg,
      };
    }
  } catch (unexpectedErr) {
    const errorMsg =
      unexpectedErr instanceof Error
        ? unexpectedErr.message
        : String(unexpectedErr);

    // ── Explicit log for unexpected errors ──
    console.error("[models-api] Unexpected error in handleGetModels:", errorMsg);

    return {
      ok: false,
      status: "unavailable",
      data: null,
      error: errorMsg,
    };
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Registers the `models-api:*` IPC handlers on the provided `ipcMain`.
 *
 * Call this once during Electron main-process startup, after the app is ready.
 *
 * @param ipcMain - The Electron `ipcMain` object (or a compatible mock for tests).
 */
export function registerModelsApiHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(MODELS_API_CHANNELS.GET_MODELS, handleGetModels);
}
