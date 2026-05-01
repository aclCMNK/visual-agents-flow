/**
 * electron-main/src/fs/models-api-cache.ts
 *
 * Cache module for models.dev/api.json
 * ──────────────────────────────────────
 * Manages download, storage and staleness checks for the models.dev API JSON.
 *
 * Storage path: <projectRoot>/models/api/models.dev.json
 * Staleness threshold: 5 days from last modification (mtime)
 *
 * All functions are pure async — no side effects beyond the file system.
 * Designed to be called from the IPC handler (models-api.ts).
 */

import { stat, mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { app } from "electron";

// ── Constants ─────────────────────────────────────────────────────────────────

export const MODELS_DEV_URL = "https://models.dev/api.json";

/** 5 days in milliseconds */
const STALE_THRESHOLD_MS = 5 * 24 * 60 * 60 * 1000;

// ── Path resolution ───────────────────────────────────────────────────────────

/**
 * Returns the absolute path to the cached models.dev JSON file.
 *
 * Resolution strategy (in order):
 *   1. AGENTS_HOME env var (set in development and some production configs)
 *   2. app.getPath('userData') — always writable, survives app updates,
 *      never inside the .asar (which is read-only in production).
 *      → ~/.config/AgentsFlow/models/api/models.dev.json (Linux)
 *      → ~/Library/Application Support/AgentsFlow/... (macOS)
 *      → %APPDATA%\AgentsFlow\... (Windows)
 *   3. __dirname-relative fallback (for unit tests without a running Electron).
 */
export function getCacheFilePath(): string {
  const agentsHome = process.env["AGENTS_HOME"];
  if (agentsHome) {
    const p = join(agentsHome, "models", "api", "models.dev.json");
    console.log("[models-api-cache] getCacheFilePath (AGENTS_HOME) →", p);
    return p;
  }

  // app.getPath('userData') is only available after app.ready.
  // The try/catch handles unit-test environments where Electron is not running.
  try {
    const p = join(app.getPath("userData"), "models", "api", "models.dev.json");
    console.log("[models-api-cache] getCacheFilePath (userData) →", p);
    return p;
  } catch {
    // Fallback for unit tests without a running Electron instance
    const p = join(import.meta.dirname, "..", "..", "..", "..", "models", "api", "models.dev.json");
    console.log("[models-api-cache] getCacheFilePath (fallback/__dirname) →", p);
    return p;
  }
}

// ── Staleness check ───────────────────────────────────────────────────────────

/**
 * Returns `true` if the cache file is stale or does not exist.
 *
 * Stale means: the file's `mtime` is older than STALE_THRESHOLD_MS (5 days).
 * If the file does not exist, returns `true` (must download).
 *
 * @param filePath - Absolute path to the cache file.
 */
export async function isCacheStale(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    const ageMs = Date.now() - s.mtime.getTime();
    return ageMs >= STALE_THRESHOLD_MS;
  } catch (err) {
    // ENOENT → file does not exist → stale
    const nodeCode = (err as NodeJS.ErrnoException).code ?? "";
    if (nodeCode === "ENOENT") {
      return true;
    }
    // Any other stat error → treat as stale (will attempt download)
    return true;
  }
}

// ── Download and save ─────────────────────────────────────────────────────────

/**
 * Downloads the models.dev API JSON and writes it to `filePath`.
 *
 * Steps:
 *   1. Fetch MODELS_DEV_URL (native fetch, Node 18+).
 *   2. Validate the response is OK (status 200–299).
 *   3. Parse the body as JSON to validate it is well-formed.
 *   4. Create the parent directory if it does not exist.
 *   5. Write the JSON string to disk (utf-8).
 *
 * Throws if:
 *   - The HTTP response is not OK (status >= 400).
 *   - The response body is not valid JSON.
 *   - The file write fails.
 *
 * @param filePath - Absolute path where the JSON should be saved.
 */
export async function downloadAndSave(filePath: string): Promise<void> {
  const response = await fetch(MODELS_DEV_URL);

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} fetching ${MODELS_DEV_URL}`,
    );
  }

  const text = await response.text();

  // Validate JSON before writing — avoids storing an HTML error page
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Response from ${MODELS_DEV_URL} is not valid JSON (got ${text.slice(0, 80)}…)`,
    );
  }

  // Re-stringify with consistent formatting
  const jsonText = JSON.stringify(parsed, null, 2);

  // Ensure parent directory exists
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  await writeFile(filePath, jsonText, "utf-8");
}

// ── Read cache ────────────────────────────────────────────────────────────────

/**
 * Reads and parses the cache file.
 *
 * Returns:
 *   - The parsed JSON object if the file exists and is valid JSON.
 *   - `null` if the file does not exist or contains invalid JSON.
 *
 * Never throws — all errors are swallowed and result in `null`.
 *
 * @param filePath - Absolute path to the cache file.
 */
export async function readCacheFile(filePath: string): Promise<unknown | null> {
  try {
    const text = await readFile(filePath, "utf-8");
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
