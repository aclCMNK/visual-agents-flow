/**
 * src/renderer/services/ipc.ts
 *
 * IPC Service — FolderExplorer wrapper for the React renderer
 * ─────────────────────────────────────────────────────────────
 * Typed, Promise-based wrapper around `window.folderExplorer`.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  WHAT THIS MODULE DOES                                                 │
 * ├────────────────────────────────────────────────────────────────────────┤
 * │  · Wraps the three raw IPC methods with a 4-second timeout             │
 * │  · Normalises ALL outcomes to { ok, ... } discriminated unions         │
 * │  · Normalises ALL errors (IPC, timeout, bridge unavailable) to a       │
 * │    flat { kind, code, message } shape — easy for UI to pattern-match  │
 * │  · Never exposes window.folderExplorer, ipcRenderer, or Node APIs      │
 * │    outside this module                                                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * PUBLIC SURFACE
 * ──────────────
 *   listFolder(path, options?)   → Promise<ListFolderResult>
 *   statPath(path)               → Promise<StatPathResult>
 *   readChildren(paths, options?) → Promise<ReadChildrenResult>
 *
 * EXPORTED TYPES
 * ──────────────
 *   Entry          — a single directory entry (name, isDirectory, path)
 *   PathMeta       — lightweight stat result for a single path
 *   ErrorKind      — discriminant for IpcError ("ipc" | "timeout" | "bridge")
 *   IpcError       — normalised flat error shape for UI consumption
 *   FilterOptions  — pass-through options (showHidden, directoriesOnly, …)
 *   ListFolderResult, StatPathResult, ReadChildrenResult — return types
 *
 * USAGE
 * ─────
 * ```ts
 * import { listFolder, statPath, readChildren } from "@/renderer/services/ipc";
 *
 * // List a directory
 * const result = await listFolder("/home/user/projects");
 * if (!result.ok) {
 *   // result.error.kind  → "ipc" | "timeout" | "bridge"
 *   // result.error.code  → "E_NOT_FOUND" | "E_ACCESS_DENIED" | ... | "E_TIMEOUT" | "E_BRIDGE"
 *   // result.error.message → human-readable string
 *   console.error(result.error.code, result.error.message);
 *   return;
 * }
 * // result.dirPath → resolved path that was listed
 * // result.entries → Entry[]
 * for (const e of result.entries) {
 *   console.log(e.name, e.isDirectory, e.path);
 * }
 *
 * // Stat a path
 * const s = await statPath("/home/user/.config");
 * if (s.ok && s.stat.exists) { ... }
 *
 * // Batch prefetch for virtualised tree
 * const batch = await readChildren(["/home/user/docs", "/home/user/src"]);
 * if (batch.ok) {
 *   for (const [p, r] of Object.entries(batch.results)) {
 *     if (r.ok) console.log(p, r.entries);
 *     else      console.warn(p, r.error.code);
 *   }
 * }
 * ```
 */

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Filter options forwarded verbatim to the main process IPC handler.
 *
 * Mirrors `FilterOptions` from `electron-main/src/fs/filter.ts` — kept as a
 * local type here so the renderer does NOT import from the main-process layer.
 * All fields are optional; defaults are applied on the main-process side.
 */
export interface FilterOptions {
  /**
   * If `true`, entries whose names start with `.` are included.
   * Default: `false`.
   */
  showHidden?: boolean;

  /**
   * If `true`, only directories are shown (files excluded).
   * Default: `true` — FolderExplorer is a directory picker.
   */
  directoriesOnly?: boolean;

  /**
   * Additional exact basenames (lowercase) to block on top of the default list.
   * E.g. `["node_modules", "dist"]`.
   */
  extraBlocklist?: string[];

  /**
   * If provided, REPLACES the default allowed-extensions list.
   * Only applied when `directoriesOnly` is `false`.
   * An empty array means "allow all extensions".
   */
  allowedExtensions?: string[];
}

/**
 * A single directory entry as surfaced by FolderExplorer.
 * Safe to render directly in a tree / list component.
 */
export interface Entry {
  /** Basename of the entry (never contains path separators). */
  name: string;
  /** True if this entry is a directory. */
  isDirectory: boolean;
  /**
   * Resolved absolute path (validated inside HOME_ROOT by the main process).
   * Safe to pass back to `listFolder` / `statPath` directly.
   */
  path: string;
}

/**
 * Lightweight metadata about a single path.
 * Returned by `statPath`.
 */
export interface PathMeta {
  /** Resolved absolute path. */
  path: string;
  /** Whether the path exists on disk at the time of the call. */
  exists: boolean;
  /** True if the path is a directory. */
  isDirectory: boolean;
  /** True if the process has read access to the path. */
  readable: boolean;
}

/**
 * Discriminant that classifies where an IpcError originated.
 *
 * - "ipc"     → The main process returned an error response (e.g. E_NOT_FOUND).
 * - "timeout" → The IPC call did not resolve within the timeout window (4 s).
 * - "bridge"  → window.folderExplorer is not available (preload not loaded).
 */
export type ErrorKind = "ipc" | "timeout" | "bridge";

/**
 * All error codes that can appear in an IpcError.
 *
 * The first five come from the main process (FolderExplorerErrorCode).
 * The last two are synthetic codes generated by this wrapper.
 */
export type IpcErrorCode =
  | "E_NOT_IN_HOME"   // Path outside HOME (traversal / jail break)
  | "E_NOT_FOUND"     // Path does not exist on disk
  | "E_NOT_A_DIR"     // Path exists but is a file, not a directory
  | "E_ACCESS_DENIED" // EACCES / EPERM
  | "E_ALREADY_EXISTS" // Target directory already exists
  | "E_INVALID_NAME"   // Invalid directory name for mkdir
  | "E_UNKNOWN"       // Unexpected error from main process
  | "E_TIMEOUT"       // IPC call timed out after TIMEOUT_MS
  | "E_BRIDGE";       // window.folderExplorer not available

/**
 * Normalised, flat error shape used throughout the renderer.
 *
 * No raw Node error objects, no stacks, no circular refs —
 * safe to render, log, or store in React state.
 */
export interface IpcError {
  /** Where the error originated. */
  kind: ErrorKind;
  /** Machine-readable code for pattern-matching in UI. */
  code: IpcErrorCode;
  /** Human-readable message (safe to show in dev tools; not raw OS messages). */
  message: string;
}

// ── Return types ──────────────────────────────────────────────────────────────

/** Successful result from `listFolder`. */
export interface ListFolderOk {
  ok: true;
  /** The resolved, validated path that was listed. */
  dirPath: string;
  /** Visible entries after applying filter options. */
  entries: Entry[];
}

/** Failure result from `listFolder`. */
export interface ListFolderErr {
  ok: false;
  error: IpcError;
}

/** Return type of `listFolder`. */
export type ListFolderResult = ListFolderOk | ListFolderErr;

/** Successful result from `statPath`. */
export interface StatPathOk {
  ok: true;
  stat: PathMeta;
}

/** Failure result from `statPath`. */
export interface StatPathErr {
  ok: false;
  error: IpcError;
}

/** Return type of `statPath`. */
export type StatPathResult = StatPathOk | StatPathErr;

/**
 * Per-entry result in a `readChildren` batch.
 * Each path can independently succeed or fail.
 */
export type ChildResult =
  | { ok: true; dirPath: string; entries: Entry[] }
  | { ok: false; error: IpcError };

/** Successful result from `readChildren`. */
export interface ReadChildrenOk {
  ok: true;
  /** Results keyed by the original path passed in by the caller. */
  results: Record<string, ChildResult>;
}

/** Failure result from `readChildren` (top-level payload error). */
export interface ReadChildrenErr {
  ok: false;
  error: IpcError;
}

/** Return type of `readChildren`. */
export type ReadChildrenResult = ReadChildrenOk | ReadChildrenErr;

/** Successful result from `createDirectory`. */
export interface CreateDirectoryOk {
  ok: true;
  /** Absolute path of the newly created directory. */
  createdPath: string;
}

/** Failure result from `createDirectory`. */
export interface CreateDirectoryErr {
  ok: false;
  error: IpcError;
}

/** Return type of `createDirectory`. */
export type CreateDirectoryResult = CreateDirectoryOk | CreateDirectoryErr;

// ── Internal bridge types ─────────────────────────────────────────────────────
// These types mirror the shapes returned by the main-process IPC handlers
// (electron-main/src/ipc/folder-explorer.ts). They are declared here as private
// types so the renderer NEVER imports from the main-process layer.
// If the main-process types change, update these in sync.

/** Raw entry as returned by the bridge (same shape as DirEntry in main). */
interface _BridgeDirEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

/** Raw PathStat as returned by the bridge. */
interface _BridgePathStat {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
}

/** Successful raw list result from the bridge. */
interface _BridgeListOk {
  ok: true;
  dirPath: string;
  entries: _BridgeDirEntry[];
}

/** Successful raw stat result from the bridge. */
interface _BridgeStatOk {
  ok: true;
  stat: _BridgePathStat;
}

/** Successful raw readChildren result from the bridge. */
interface _BridgeReadChildrenOk {
  ok: true;
  results: Record<string, _BridgeListOk | { ok: false; code: string; message: string }>;
}

/** Raw error shape from the bridge. */
interface _BridgeErr {
  ok: false;
  code: string;
  message: string;
}

type _BridgeListResponse        = _BridgeListOk        | _BridgeErr;
type _BridgeStatResponse        = _BridgeStatOk        | _BridgeErr;
type _BridgeReadChildrenResponse = _BridgeReadChildrenOk | _BridgeErr;
type _BridgeMkdirResponse = { ok: true; createdPath: string } | _BridgeErr;

/** Minimal typed view of window.folderExplorer as seen by the renderer. */
interface _FolderExplorerBridge {
  list(path: string, options?: FilterOptions): Promise<_BridgeListResponse>;
  stat(path: string): Promise<_BridgeStatResponse>;
  readChildren(paths: string[], options?: FilterOptions): Promise<_BridgeReadChildrenResponse>;
  mkdir(parentPath: string, name: string): Promise<_BridgeMkdirResponse>;
  /**
   * Lists all available Windows drive units (A:\ to Z:\).
   * On Linux/macOS the main process returns E_UNKNOWN.
   * Only call this when window.appPaths.platform === "win32".
   */
  listDrives(): Promise<{ ok: true; drives: Array<{ letter: string; path: string }> } | _BridgeErr>;
}

// Augment Window so TypeScript resolves window.folderExplorer inside this module.
// We use a local interface extension rather than redeclaring the preload's type,
// to avoid conflicts if the preload's global declaration is visible in this context.

// ── Internal constants ────────────────────────────────────────────────────────

/** Hard-coded IPC timeout in milliseconds. 4 seconds is enough for any local fs op. */
const TIMEOUT_MS = 4_000;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns the typed bridge object if available, or `undefined`.
 * Using a typed cast here avoids conflicts with the preload's global
 * Window augmentation while still giving us full type safety locally.
 */
function getBridge(): _FolderExplorerBridge | undefined {
  const w = typeof window !== "undefined"
    ? (window as Window & { folderExplorer?: _FolderExplorerBridge })
    : undefined;
  return w?.folderExplorer;
}

/**
 * Returns true if `window.folderExplorer` is available at call time.
 * Inline function (not cached) so it is re-evaluated on every call —
 * avoids false negatives in environments where the preload loads late.
 */
function hasBridge(): boolean {
  return getBridge() !== undefined;
}

/** Synthetic error returned when the bridge is unavailable. */
function bridgeError(): IpcError {
  return {
    kind: "bridge",
    code: "E_BRIDGE",
    message:
      "window.folderExplorer is not available. " +
      "Ensure the FolderExplorer preload is loaded and contextIsolation is enabled.",
  };
}

/** Synthetic error returned when the IPC call exceeds TIMEOUT_MS. */
function timeoutError(): IpcError {
  return {
    kind: "timeout",
    code: "E_TIMEOUT",
    message: `FolderExplorer IPC call timed out after ${TIMEOUT_MS} ms.`,
  };
}

/**
 * Normalises a raw `{ ok: false, code, message }` response from the bridge
 * into an `IpcError` with kind="ipc".
 *
 * If the incoming shape is unexpected (e.g. the bridge returned something
 * completely malformed), we fall back to E_UNKNOWN.
 */
function normaliseBridgeError(raw: unknown): IpcError {
  if (
    raw !== null &&
    typeof raw === "object" &&
    "code" in raw &&
    "message" in raw &&
    typeof (raw as Record<string, unknown>).code === "string" &&
    typeof (raw as Record<string, unknown>).message === "string"
  ) {
    return {
      kind: "ipc",
      code: (raw as { code: IpcErrorCode }).code,
      message: (raw as { message: string }).message,
    };
  }

  return {
    kind: "ipc",
    code: "E_UNKNOWN",
    message: `Unexpected error shape from IPC bridge: ${String(raw)}`,
  };
}

/**
 * Awaits a bridge call with timeout semantics.
 *
 * Returns the resolved value, or throws either:
 *   - `{ __timeout: true }` — a sentinel object when the call times out
 *   - the original rejection — when the promise rejects before the timeout
 *
 * Callers check for the sentinel to distinguish timeout from IPC errors.
 */
const TIMEOUT_SENTINEL = Symbol("ipc_timeout");

async function callWithTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(TIMEOUT_SENTINEL);
    }, TIMEOUT_MS);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err)   => { clearTimeout(timer); reject(err);   },
    );
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Lists the visible entries of a directory within $HOME.
 *
 * Applies `options` for filtering (showHidden, directoriesOnly, extraBlocklist, …).
 * The main process validates the path — path traversal / jail escapes are blocked.
 *
 * @param path    - Absolute path within $HOME.
 * @param options - Optional FilterOptions to pass to the IPC handler.
 * @returns       A discriminated union: `{ ok: true, dirPath, entries }` or
 *                `{ ok: false, error: IpcError }`.
 */
export async function listFolder(
  path: string,
  options?: FilterOptions,
): Promise<ListFolderResult> {
  if (!hasBridge()) {
    return { ok: false, error: bridgeError() };
  }

  try {
    const raw = await callWithTimeout(
      getBridge()!.list(path, options),
    );

    if (raw.ok) {
      return {
        ok: true,
        dirPath: raw.dirPath,
        // Map DirEntry → Entry (same shape; re-typed for renderer independence)
        entries: raw.entries.map((e) => ({
          name:        e.name,
          isDirectory: e.isDirectory,
          path:        e.path,
        })),
      };
    }

    return { ok: false, error: normaliseBridgeError(raw) };
  } catch (err) {
    if (err === TIMEOUT_SENTINEL) {
      return { ok: false, error: timeoutError() };
    }
    return {
      ok: false,
      error: {
        kind:    "ipc",
        code:    "E_UNKNOWN",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Returns lightweight metadata for a single path within $HOME.
 *
 * Unlike `listFolder`, `statPath` accepts both files and directories.
 * For non-existent paths that are inside $HOME it returns
 * `{ ok: true, stat: { exists: false } }` instead of an error —
 * useful for "does this path exist?" checks in the UI.
 *
 * @param path - Absolute path within $HOME.
 * @returns    A discriminated union: `{ ok: true, stat: PathMeta }` or
 *             `{ ok: false, error: IpcError }`.
 */
export async function statPath(path: string): Promise<StatPathResult> {
  if (!hasBridge()) {
    return { ok: false, error: bridgeError() };
  }

  try {
    const raw = await callWithTimeout(
      getBridge()!.stat(path),
    );

    if (raw.ok) {
      return {
        ok: true,
        stat: {
          path:        raw.stat.path,
          exists:      raw.stat.exists,
          isDirectory: raw.stat.isDirectory,
          readable:    raw.stat.readable,
        },
      };
    }

    return { ok: false, error: normaliseBridgeError(raw) };
  } catch (err) {
    if (err === TIMEOUT_SENTINEL) {
      return { ok: false, error: timeoutError() };
    }
    return {
      ok: false,
      error: {
        kind:    "ipc",
        code:    "E_UNKNOWN",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Lists multiple directories in parallel (batch prefetch).
 *
 * Designed for virtualised tree components that need to pre-fetch children
 * of several nodes simultaneously. Each path is processed independently —
 * a single failed path does NOT fail the whole batch.
 *
 * Top-level timeout wraps the entire batch call (the main process runs all
 * paths in parallel; 4 s should be more than enough for any local fs batch).
 *
 * @param paths   - Array of absolute paths within $HOME to list.
 * @param options - FilterOptions applied to ALL paths in the batch.
 * @returns       A discriminated union:
 *                  `{ ok: true, results: Record<path, ChildResult> }` or
 *                  `{ ok: false, error: IpcError }` (top-level payload error only).
 */
export async function readChildren(
  paths: string[],
  options?: FilterOptions,
): Promise<ReadChildrenResult> {
  if (!hasBridge()) {
    return { ok: false, error: bridgeError() };
  }

  try {
    const raw = await callWithTimeout(
      getBridge()!.readChildren(paths, options),
    );

    if (!raw.ok) {
      return { ok: false, error: normaliseBridgeError(raw) };
    }

    // Normalise per-entry results
    const results: Record<string, ChildResult> = {};
    for (const [p, entry] of Object.entries(raw.results)) {
      if (entry.ok) {
        results[p] = {
          ok:      true,
          dirPath: entry.dirPath,
          entries: entry.entries.map((e) => ({
            name:        e.name,
            isDirectory: e.isDirectory,
            path:        e.path,
          })),
        };
      } else {
        results[p] = {
          ok:    false,
          error: normaliseBridgeError(entry),
        };
      }
    }

    return { ok: true, results };
  } catch (err) {
    if (err === TIMEOUT_SENTINEL) {
      return { ok: false, error: timeoutError() };
    }
    return {
      ok: false,
      error: {
        kind:    "ipc",
        code:    "E_UNKNOWN",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Creates a new directory named `name` inside `parentPath`.
 *
 * The main process validates sandbox and name rules.
 */
export async function createDirectory(
  parentPath: string,
  name: string,
): Promise<CreateDirectoryResult> {
  if (!hasBridge()) {
    return { ok: false, error: bridgeError() };
  }

  try {
    const raw = await callWithTimeout(
      getBridge()!.mkdir(parentPath, name),
    );

    if (raw.ok) {
      return { ok: true, createdPath: raw.createdPath };
    }

    return { ok: false, error: normaliseBridgeError(raw) };
  } catch (err) {
    if (err === TIMEOUT_SENTINEL) {
      return { ok: false, error: timeoutError() };
    }
    return {
      ok: false,
      error: {
        kind: "ipc",
        code: "E_UNKNOWN",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
