/**
 * electron-main/src/ipc/opencode-models.ts
 *
 * IPC Handler — opencode CLI models lister
 * ─────────────────────────────────────────
 * Executes `opencode models` as a child process, parses the output into a
 * structured map of { provider: string[] }, and exposes it via IPC.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  Channel                    │  Purpose                               │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │  opencode-models:list       │  Returns { ok, models, error? }        │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * DESIGN NOTES
 * ─────────────
 * - `ipcMain` is passed as a parameter for testability (no Electron import).
 * - Cross-platform: `opencode.exe` on Windows, `opencode` on Linux/macOS.
 * - Timeout: 15 seconds — if the process hangs, it is killed.
 * - Parser is tolerant: ignores lines without `/`, empty lines, headers.
 * - ENOENT is caught and returned as a user-friendly error.
 */

import type { IpcMain } from "electron";
import { spawn as _spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

// ── Channel names ─────────────────────────────────────────────────────────────

export const OPENCODE_MODELS_CHANNELS = {
  LIST_MODELS: "opencode-models:list",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OpencodeModelsResult {
  ok: boolean;
  /** Mapa proveedor → lista de modelos. Vacío si ok=false. */
  models: Record<string, string[]>;
  /** Mensaje de error si ok=false. */
  error?: string;
}

export interface OpencodeModelsDeps {
  spawnProcess: (cmd: string, args: string[]) => ChildProcess;
  platform: NodeJS.Platform;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parses the stdout of `opencode models` into a provider → models map.
 *
 * Rules:
 * - Split by newline (handles \r\n on Windows).
 * - Trim each line; skip empty lines and lines without `/`.
 * - Split on first `/` only: `provider = parts[0]`, `model = rest.join("/")`.
 * - Skip if provider or model is empty after trim.
 */
export function parseOpencodeModelsOutput(
  stdout: string,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes("/")) continue;

    const slashIdx = line.indexOf("/");
    const provider = line.slice(0, slashIdx).trim();
    const model = line.slice(slashIdx + 1).trim();

    if (!provider || !model) continue;

    result[provider] = result[provider] ?? [];
    result[provider].push(model);
  }

  return result;
}

// ── Main function ─────────────────────────────────────────────────────────────

const TIMEOUT_MS = 15_000;

/**
 * Runs `opencode models` as a child process and returns the parsed result.
 *
 * Injectable `deps` allow mocking in tests.
 */
export async function runOpencodeModels(
  deps?: Partial<OpencodeModelsDeps>,
): Promise<OpencodeModelsResult> {
  const spawnProcess = deps?.spawnProcess ?? _spawn;
  const platform = deps?.platform ?? process.platform;

  // ── Determine command ──────────────────────────────────────────────────────
  const cmd = platform === "win32" ? "opencode.exe" : "opencode";

  return new Promise<OpencodeModelsResult>((resolve) => {
    let child: ChildProcess;

    try {
      child = spawnProcess(cmd, ["models"]);
    } catch (spawnErr) {
      // Synchronous spawn failure (e.g. ENOENT on some platforms)
      resolve({
        ok: false,
        models: {},
        error: "opencode CLI not found in PATH",
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    function settle(result: OpencodeModelsResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    // ── Timeout guard ──────────────────────────────────────────────────────
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      settle({
        ok: false,
        models: {},
        error: "opencode models timed out after 15s",
      });
    }, TIMEOUT_MS);

    // ── ENOENT / spawn error ───────────────────────────────────────────────
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        settle({ ok: false, models: {}, error: "opencode CLI not found in PATH" });
      } else {
        settle({ ok: false, models: {}, error: err.message });
      }
    });

    // ── Accumulate stdout ──────────────────────────────────────────────────
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    // ── Process exit ───────────────────────────────────────────────────────
    child.on("close", (exitCode: number | null) => {
      if (exitCode !== 0 && exitCode !== null) {
        settle({
          ok: false,
          models: {},
          error: `opencode models exited with code ${exitCode}: ${stderr.trim()}`,
        });
        return;
      }

      const models = parseOpencodeModelsOutput(stdout);
      settle({ ok: true, models });
    });
  });
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Registers the `opencode-models:*` IPC handlers on the provided `ipcMain`.
 *
 * @param ipcMain - The Electron `ipcMain` object (or a compatible mock for tests).
 */
export function registerOpencodeModelsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    OPENCODE_MODELS_CHANNELS.LIST_MODELS,
    async (_event): Promise<OpencodeModelsResult> => {
      return runOpencodeModels();
    },
  );
}
