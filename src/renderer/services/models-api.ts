/**
 * src/renderer/services/models-api.ts
 *
 * IPC Service — Models API wrapper for the React renderer
 * ─────────────────────────────────────────────────────────
 * Typed, Promise-based wrapper around `window.modelsApi`.
 *
 * Responsibilities:
 *   · Wraps the raw IPC call with a 30-second timeout (download can be slow).
 *   · Normalises all outcomes to `ModelsApiServiceResult`.
 *   · Returns `unavailable` if the bridge is not available (non-Electron env).
 *   · Never exposes `window.modelsApi` or `ipcRenderer` outside this module.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Describes the outcome of the cache/download operation.
 * Mirrors `ModelsApiStatus` from the main process — kept as a local type
 * so the renderer does NOT import from the main-process layer.
 */
export type ModelsApiStatus =
  | "fresh"       // File was fresh; returned without downloading
  | "downloaded"  // Download succeeded; new data returned
  | "fallback"    // Download failed; old cache returned
  | "unavailable"; // Download failed and no cache exists

/** The normalised result returned by `getModels()`. */
export interface ModelsApiServiceResult {
  ok: boolean;
  status: ModelsApiStatus;
  data: unknown | null;
  error?: string;
}

// ── Internal constants ────────────────────────────────────────────────────────

/** Timeout for the IPC call — longer than fs ops because it may trigger a download. */
const TIMEOUT_MS = 30_000;

const TIMEOUT_SENTINEL = Symbol("models_api_timeout");

// ── Internal helpers ──────────────────────────────────────────────────────────

function getBridge(): { getModels(): Promise<ModelsApiServiceResult> } | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { modelsApi?: { getModels(): Promise<ModelsApiServiceResult> } }).modelsApi;
}

async function callWithTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(TIMEOUT_SENTINEL);
    }, TIMEOUT_MS);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err)   => { clearTimeout(timer); reject(err); },
    );
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Invokes the `models-api:get-models` IPC channel and returns the result.
 *
 * Returns `{ ok: false, status: "unavailable" }` if:
 *   - The bridge is not available (non-Electron environment).
 *   - The IPC call times out after 30 seconds.
 *   - The IPC call throws unexpectedly.
 */
export async function getModels(): Promise<ModelsApiServiceResult> {
  const bridge = getBridge();

  if (!bridge) {
    console.error("[models-api] window.modelsApi is NOT available — preload may not have loaded correctly.");
    return {
      ok: false,
      status: "unavailable",
      data: null,
      error: "window.modelsApi is not available. Ensure the preload script is loaded.",
    };
  }

  console.log("[models-api] invoking models-api:get-models via window.modelsApi.getModels()...");

  try {
    const result = await callWithTimeout(bridge.getModels());
    console.log("[models-api] result received — status:", (result as ModelsApiServiceResult).status, "ok:", (result as ModelsApiServiceResult).ok);
    return result as ModelsApiServiceResult;
  } catch (err) {
    if (err === TIMEOUT_SENTINEL) {
      return {
        ok: false,
        status: "unavailable",
        data: null,
        error: `Models API IPC call timed out after ${TIMEOUT_MS}ms.`,
      };
    }
    return {
      ok: false,
      status: "unavailable",
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
