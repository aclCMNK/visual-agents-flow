/**
 * src/renderer/services/opencode-models.ts
 *
 * IPC Service — opencode CLI models wrapper for the React renderer.
 * Typed, Promise-based wrapper around `window.opencodeModels`.
 */

export interface OpencodeModelsServiceResult {
  ok: boolean;
  models: Record<string, string[]>;
  error?: string;
}

const TIMEOUT_MS = 20_000;
const TIMEOUT_SENTINEL = Symbol("opencode_models_timeout");

function getBridge(): { listModels(): Promise<OpencodeModelsServiceResult> } | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & {
    opencodeModels?: { listModels(): Promise<OpencodeModelsServiceResult> }
  }).opencodeModels;
}

async function callWithTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(TIMEOUT_SENTINEL), TIMEOUT_MS);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function listModels(): Promise<OpencodeModelsServiceResult> {
  const bridge = getBridge();
  if (!bridge) {
    return { ok: false, models: {}, error: "window.opencodeModels is not available." };
  }
  try {
    return await callWithTimeout(bridge.listModels());
  } catch (err) {
    if (err === TIMEOUT_SENTINEL) {
      return { ok: false, models: {}, error: `opencode models timed out after ${TIMEOUT_MS}ms.` };
    }
    return { ok: false, models: {}, error: err instanceof Error ? err.message : String(err) };
  }
}
