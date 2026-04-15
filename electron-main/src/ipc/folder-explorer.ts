/**
 * electron-main/src/ipc/folder-explorer.ts
 *
 * IPC Handlers — Folder Explorer
 * ───────────────────────────────
 * Registers the three `folder-explorer:*` channels that let the renderer
 * browse directories safely under the user's HOME directory.
 *
 * ┌────────────────────────────────────────────────────────────────────┐
 * │  Channel                    │  Purpose                            │
 * ├────────────────────────────────────────────────────────────────────┤
 * │  folder-explorer:list       │  List visible entries of a single   │
 * │                             │  directory (validated under HOME)   │
 * │  folder-explorer:stat       │  Return metadata for a single path  │
 * │                             │  (exists, isDir, readable)          │
 * │  folder-explorer:read-children │  Batch-stat a set of sub-dirs in │
 * │                             │  parallel (for virtualised trees)   │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * SECURITY CONTRACT
 * ─────────────────
 * Every path argument received from the renderer is validated through
 * `resolveWithinHome` (from homeJail.ts) BEFORE any filesystem operation:
 *
 *   1. The path is resolved to an absolute, normalised form.
 *   2. All symbolic links are followed (realpath).
 *   3. The resolved path must be equal to, or a subdirectory of, HOME_ROOT.
 *
 * If any of those checks fail, the handler returns a typed error response
 * (never throws to the renderer). This means:
 *   - Path traversal attacks (../../../etc)    → E_NOT_IN_HOME
 *   - Symlink escape (~/evil-link → /etc)      → E_NOT_IN_HOME
 *   - Non-existent paths                       → E_NOT_FOUND
 *   - Paths that are files, not directories    → E_NOT_A_DIR
 *   - Unreadable directories (EACCES)          → E_ACCESS_DENIED
 *
 * ERROR CODES (all normalised — never raw Node error messages in prod)
 * ────────────────────────────────────────────────────────────────────
 * E_NOT_IN_HOME    — path resolves outside HOME_ROOT (traversal / jail break)
 * E_NOT_FOUND      — path does not exist on disk
 * E_NOT_A_DIR      — path exists but is a file, not a directory
 * E_ACCESS_DENIED  — readdir / stat returned EACCES or EPERM
 * E_UNKNOWN        — unexpected error (message included for debugging)
 *
 * DESIGN NOTES
 * ─────────────
 * - All handlers are registered with `ipcMain.handle` (async, invoke/handle
 *   pattern). The renderer calls them via `ipcRenderer.invoke`.
 * - No Electron module is imported here — `ipcMain` is passed as a parameter
 *   so this module is trivially testable without a running Electron instance.
 * - The filter logic (hidden entries, blocklist, etc.) lives in filter.ts.
 *   This file only orchestrates: validate → I/O → filter → respond.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { IpcMain } from "electron";

import {
  resolveWithinHome,
  HOME_ROOT,
} from "../fs/homeJail.ts";
import { filterEntries } from "../fs/filter.ts";
import type { FilterOptions } from "../fs/filter.ts";

// ── Response Types ─────────────────────────────────────────────────────────

/**
 * A single directory entry as surfaced to the renderer.
 * Intentionally minimal — only the fields needed for tree navigation.
 */
export interface DirEntry {
  /** Basename of the entry (never a full path). */
  name: string;
  /** True if the entry is a directory. */
  isDirectory: boolean;
  /**
   * Resolved absolute path (guaranteed to be inside HOME_ROOT).
   * The renderer can pass this back directly to subsequent IPC calls.
   */
  path: string;
}

/**
 * Lightweight metadata about a single path.
 * Returned by `folder-explorer:stat`.
 */
export interface PathStat {
  /** Resolved absolute path (validated inside HOME_ROOT). */
  path: string;
  /** True if the path exists on disk. */
  exists: boolean;
  /** True if the path is a directory (false for files). */
  isDirectory: boolean;
  /**
   * True if the process can read the directory/file.
   * Derived from a stat call — if stat itself succeeded, this is `true`.
   * If we get EACCES during stat it flips to `false` and we return
   * E_ACCESS_DENIED instead.
   */
  readable: boolean;
}

// ── Discriminated-union response shapes ───────────────────────────────────

/** All normalised error codes the IPC handlers can return. */
export type FolderExplorerErrorCode =
  | "E_NOT_IN_HOME"    // Path resolves outside HOME_ROOT
  | "E_NOT_FOUND"      // Path does not exist
  | "E_NOT_A_DIR"      // Path exists but is a file, not a directory
  | "E_ACCESS_DENIED"  // EACCES / EPERM when accessing the path
  | "E_UNKNOWN";       // Unexpected error (message included)

/** Envelope for IPC errors — always serialisable. */
export interface FolderExplorerError {
  ok: false;
  code: FolderExplorerErrorCode;
  /** Human-readable detail (safe to show in dev-tools; not raw OS messages). */
  message: string;
}

/** Successful response from `folder-explorer:list`. */
export interface ListResult {
  ok: true;
  /** The resolved, validated directory path that was listed. */
  dirPath: string;
  /** Filtered, visible entries — ready for the renderer to render. */
  entries: DirEntry[];
}

/** Successful response from `folder-explorer:stat`. */
export interface StatResult {
  ok: true;
  stat: PathStat;
}

/**
 * Successful response from `folder-explorer:read-children`.
 *
 * Each requested sub-path maps to either a `ListResult` or a
 * `FolderExplorerError` — the renderer can decide per-entry how to handle
 * partial failures without throwing away the entire batch.
 */
export interface ReadChildrenResult {
  ok: true;
  /** Results keyed by the ORIGINAL (unresolved) path passed in by the caller. */
  results: Record<string, ListResult | FolderExplorerError>;
}

/** Union of all possible responses from `folder-explorer:list`. */
export type ListResponse = ListResult | FolderExplorerError;

/** Union of all possible responses from `folder-explorer:stat`. */
export type StatResponse = StatResult | FolderExplorerError;

/** Union of all possible responses from `folder-explorer:read-children`. */
export type ReadChildrenResponse = ReadChildrenResult | FolderExplorerError;

// ── IPC Channel Names ──────────────────────────────────────────────────────

/**
 * Channel constants — single source of truth shared with the preload bridge.
 *
 * Usage in preload:
 * ```ts
 * import { FOLDER_EXPLORER_CHANNELS } from "../electron-main/src/ipc/folder-explorer.ts";
 * // expose via contextBridge
 * ```
 */
export const FOLDER_EXPLORER_CHANNELS = {
  LIST:          "folder-explorer:list",
  STAT:          "folder-explorer:stat",
  READ_CHILDREN: "folder-explorer:read-children",
} as const;

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Classifies a raw Node.js error into one of our normalised error codes.
 *
 * Edge cases handled:
 *   - `homeJail:` prefix in the message → E_NOT_IN_HOME
 *   - ENOENT / ENOTDIR from realpath → E_NOT_FOUND
 *   - EACCES / EPERM from readdir/stat → E_ACCESS_DENIED
 *   - Everything else → E_UNKNOWN (with the original message preserved for
 *     developer inspection in non-production builds)
 */
function classifyError(err: unknown): FolderExplorerError {
  if (err instanceof Error) {
    const msg = err.message;

    // homeJail throws errors with the "homeJail:" prefix for all jail
    // violations (traversal, symlink escape, empty path).
    if (msg.startsWith("homeJail:")) {
      return {
        ok: false,
        code: "E_NOT_IN_HOME",
        message: `Path is outside the home directory. (${msg})`,
      };
    }

    // ENOENT can come from realpath (path doesn't exist) or readdir.
    // ENOTDIR can come from readdir when the path is actually a file.
    const nodeCode = (err as NodeJS.ErrnoException).code ?? "";
    if (nodeCode === "ENOENT") {
      return {
        ok: false,
        code: "E_NOT_FOUND",
        message: `Path does not exist on disk.`,
      };
    }
    if (nodeCode === "ENOTDIR") {
      return {
        ok: false,
        code: "E_NOT_A_DIR",
        message: `Path exists but is not a directory.`,
      };
    }
    if (nodeCode === "EACCES" || nodeCode === "EPERM") {
      return {
        ok: false,
        code: "E_ACCESS_DENIED",
        message: `Permission denied reading the path.`,
      };
    }

    return {
      ok: false,
      code: "E_UNKNOWN",
      // Include the original message so developers can debug unexpected issues
      // without exposing it to end-users in a finalised build.
      message: `Unexpected error: ${msg}`,
    };
  }

  return {
    ok: false,
    code: "E_UNKNOWN",
    message: `Unexpected non-Error thrown: ${String(err)}`,
  };
}

/**
 * Core listing logic shared by `list` and `read-children`.
 *
 * Steps:
 *   1. Validate the path with resolveWithinHome (throws on any violation).
 *   2. Stat the resolved path to confirm it's a directory before readdir.
 *   3. readdir with { withFileTypes: true } to get Dirent objects.
 *   4. Map Dirent to FsEntry and apply filterEntries.
 *   5. Return a ListResult with fully resolved entry paths.
 *
 * @param rawPath   - Path as received from the renderer (untrusted).
 * @param options   - Optional filter overrides (showHidden, directoriesOnly, …).
 * @returns Promise<ListResult | FolderExplorerError>
 */
async function listDirectory(
  rawPath: string,
  options?: FilterOptions,
): Promise<ListResult | FolderExplorerError> {
  // ── Step 1: Jail check ─────────────────────────────────────────────────
  // resolveWithinHome throws if the path is outside HOME_ROOT, doesn't exist,
  // or is otherwise invalid (empty string, traversal, symlink escape).
  let safePath: string;
  try {
    safePath = await resolveWithinHome(rawPath);
  } catch (err) {
    return classifyError(err);
  }

  // ── Step 2: Confirm it's a directory ──────────────────────────────────
  // We stat AFTER resolveWithinHome so we're operating on the resolved,
  // validated path — not the raw input.
  let statResult: Awaited<ReturnType<typeof stat>>;
  try {
    statResult = await stat(safePath);
  } catch (err) {
    return classifyError(err);
  }

  if (!statResult.isDirectory()) {
    // Path exists but it's a file, socket, etc.
    return {
      ok: false,
      code: "E_NOT_A_DIR",
      message: `"${safePath}" is not a directory.`,
    };
  }

  // ── Step 3: Read directory entries ────────────────────────────────────
  let dirents: import("node:fs").Dirent<string>[];
  try {
    // withFileTypes:true + encoding:"utf-8" gives us Dirent<string> objects
    // with isDirectory() method and string names.
    // Explicit "utf-8" encoding is required so that @types/node resolves the
    // overload to Dirent<string> rather than Dirent<Buffer> (the default in
    // @types/node v25 when only { withFileTypes: true } is provided).
    dirents = await readdir(safePath, { withFileTypes: true, encoding: "utf-8" });
  } catch (err) {
    // EACCES (permission denied) is common here for protected dirs.
    return classifyError(err);
  }

  // ── Step 4: Filter entries ────────────────────────────────────────────
  // Map Dirent → FsEntry (the minimal interface expected by filterEntries).
  // We intentionally don't pass the full Dirent to avoid coupling.
  const fsEntries = dirents.map((d) => ({
    name: d.name,
    isDirectory: d.isDirectory(),
  }));

  const visible = filterEntries(fsEntries, options);

  // ── Step 5: Build result ──────────────────────────────────────────────
  // Attach the full validated path to each entry so the renderer can use
  // it directly in subsequent IPC calls without string concatenation.
  //
  // Edge case: an entry name could technically contain control characters
  // that survived the filter (the filter blocks them, but belt-and-suspenders
  // — we build the path from the FILTERED entries only).
  const entries: DirEntry[] = visible.map((e) => ({
    name:        e.name,
    isDirectory: e.isDirectory,
    path:        join(safePath, e.name),
  }));

  return {
    ok: true,
    dirPath: safePath,
    entries,
  };
}

// ── Handler Implementations ────────────────────────────────────────────────

/**
 * `folder-explorer:list`
 *
 * Lists the visible entries of a single directory that is under HOME_ROOT.
 *
 * Request shape (from renderer):
 * ```ts
 * const result = await window.api.folderExplorer.list({
 *   path: "/home/user/projects",
 *   options: { showHidden: false },  // optional
 * });
 * ```
 *
 * Response: `ListResponse` (ListResult | FolderExplorerError)
 *
 * Error cases:
 *   - Empty path                     → E_NOT_IN_HOME (via homeJail)
 *   - Path outside HOME              → E_NOT_IN_HOME
 *   - Non-existent path              → E_NOT_FOUND
 *   - Path is a file, not a dir      → E_NOT_A_DIR
 *   - EACCES / EPERM on readdir      → E_ACCESS_DENIED
 */
async function handleList(
  _event: Electron.IpcMainInvokeEvent,
  payload: { path: string; options?: FilterOptions },
): Promise<ListResponse> {
  // Validate that the caller passed a non-null payload with a path string.
  // This guards against renderer bugs sending malformed invocations.
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.path !== "string"
  ) {
    return {
      ok: false,
      code: "E_UNKNOWN",
      message: "Invalid payload: expected { path: string }.",
    };
  }

  return listDirectory(payload.path, payload.options);
}

/**
 * `folder-explorer:stat`
 *
 * Returns lightweight metadata about a single path.
 *
 * Unlike `list`, this handler does NOT require the path to be a directory —
 * it will stat files as well. It always returns `ok: true` with `exists: false`
 * for non-existent paths (instead of E_NOT_FOUND), because the renderer often
 * uses stat to CHECK existence before deciding what to render.
 *
 * The one case that returns `ok: false` is when the path resolves OUTSIDE
 * HOME_ROOT — that is always an error, even for "does it exist?" checks.
 *
 * Request shape:
 * ```ts
 * const result = await window.api.folderExplorer.stat({ path: "/home/user/.config" });
 * ```
 *
 * Response: `StatResponse` (StatResult | FolderExplorerError)
 *
 * Error cases:
 *   - Path outside HOME_ROOT          → E_NOT_IN_HOME  (ok: false)
 *   - EACCES during stat              → E_ACCESS_DENIED (ok: false)
 *   - Non-existent path inside HOME   → ok: true, exists: false
 */
async function handleStat(
  _event: Electron.IpcMainInvokeEvent,
  payload: { path: string },
): Promise<StatResponse> {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.path !== "string"
  ) {
    return {
      ok: false,
      code: "E_UNKNOWN",
      message: "Invalid payload: expected { path: string }.",
    };
  }

  const rawPath = payload.path;

  // ── Jail check ──────────────────────────────────────────────────────────
  // For stat we need to handle the "non-existent path" case ourselves,
  // because resolveWithinHome calls realpath() which rejects non-existent paths.
  //
  // Strategy:
  //   a) Try resolveWithinHome — succeeds if the path exists AND is inside HOME.
  //   b) If it throws with homeJail: prefix → E_NOT_IN_HOME (hard error).
  //   c) If it throws with ENOENT → perform a lexical containment check using
  //      the normalised (non-realpath) path. If the lexical path is inside HOME,
  //      return ok:true / exists:false. Otherwise return E_NOT_IN_HOME.
  //
  // This way:
  //   - A truly non-existent path like ~/ghost returns {ok:true, exists:false}.
  //   - A traversal to a non-existent path like ../../ghost returns E_NOT_IN_HOME.

  let safePath: string | null = null;

  try {
    safePath = await resolveWithinHome(rawPath);
  } catch (err) {
    if (err instanceof Error) {
      // homeJail jail-violation errors always start with "homeJail:"
      if (err.message.startsWith("homeJail:")) {
        // Check whether this is a "cannot resolve" (ENOENT) or a true jail violation.
        // homeJail wraps ENOENT as: `homeJail: cannot resolve path "..." ...`
        const isCannotResolve = err.message.includes("cannot resolve path");
        if (isCannotResolve) {
          // The path MIGHT be inside HOME but just doesn't exist.
          // Do a lexical (no-realpath) check to distinguish:
          //   ~/non-existent      → inside HOME lexically → ok:true, exists:false
          //   ../../non-existent  → outside HOME lexically → E_NOT_IN_HOME
          const { resolve: pathResolve, normalize: pathNorm, sep: pathSep } = await import("node:path");
          const lexical = pathNorm(pathResolve(rawPath));
          const insideHome =
            lexical === HOME_ROOT ||
            lexical.startsWith(HOME_ROOT + pathSep);

          if (insideHome) {
            return {
              ok: true,
              stat: {
                path:        lexical,
                exists:      false,
                isDirectory: false,
                readable:    false,
              },
            };
          } else {
            return {
              ok: false,
              code: "E_NOT_IN_HOME",
              message: `Path "${rawPath}" is outside the home directory.`,
            };
          }
        }

        // True jail violation (symlink escape, traversal to existing outside path)
        return {
          ok: false,
          code: "E_NOT_IN_HOME",
          message: `Path is outside the home directory. (${err.message})`,
        };
      }

      // Any other error from resolveWithinHome → classify normally
      return classifyError(err);
    }

    return classifyError(err);
  }

  // ── Stat the resolved path ─────────────────────────────────────────────
  let statResult: Awaited<ReturnType<typeof stat>>;
  try {
    statResult = await stat(safePath);
  } catch (err) {
    const nodeCode = (err as NodeJS.ErrnoException).code ?? "";
    if (nodeCode === "ENOENT") {
      // Path disappeared between resolveWithinHome and stat (rare race).
      // Treat as non-existent.
      return {
        ok: true,
        stat: {
          path:        safePath,
          exists:      false,
          isDirectory: false,
          readable:    false,
        },
      };
    }
    if (nodeCode === "EACCES" || nodeCode === "EPERM") {
      return {
        ok: false,
        code: "E_ACCESS_DENIED",
        message: `Permission denied reading stat for "${safePath}".`,
      };
    }
    return classifyError(err);
  }

  return {
    ok: true,
    stat: {
      path:        safePath,
      exists:      true,
      isDirectory: statResult.isDirectory(),
      readable:    true, // stat succeeded → we have at least read access to metadata
    },
  };
}

/**
 * `folder-explorer:read-children`
 *
 * Lists multiple sub-directories in parallel. Designed for virtualised tree
 * components that need to pre-fetch children of several nodes simultaneously.
 *
 * Each path in the `paths` array is treated independently:
 *   - Success  → stored as `ListResult` under that path's key.
 *   - Failure  → stored as `FolderExplorerError` under that path's key.
 *
 * The overall response is always `ok: true` (unless the payload itself is
 * malformed) — partial failures are surfaced per-entry, not as a top-level
 * error, so the renderer can show a partial tree rather than a blank state.
 *
 * Request shape:
 * ```ts
 * const result = await window.api.folderExplorer.readChildren({
 *   paths: ["/home/user/docs", "/home/user/projects"],
 *   options: { showHidden: false },  // applied to ALL paths
 * });
 * if (result.ok) {
 *   for (const [p, r] of Object.entries(result.results)) {
 *     if (r.ok) console.log(p, r.entries);
 *     else      console.warn(p, r.code, r.message);
 *   }
 * }
 * ```
 *
 * Response: `ReadChildrenResponse`
 *
 * Top-level error cases:
 *   - Malformed payload            → E_UNKNOWN
 *   - paths is not an array        → E_UNKNOWN
 *
 * Per-entry error cases: same as `folder-explorer:list`.
 *
 * Edge cases:
 *   - Empty `paths` array          → ok: true, results: {}
 *   - Duplicate paths in `paths`   → each is processed independently (last
 *     write wins in the results map — duplicates are idempotent for reads)
 *   - Very large `paths` array     → all processed in parallel via Promise.all
 *     (no artificial concurrency limit here; OS handles I/O scheduling)
 */
async function handleReadChildren(
  _event: Electron.IpcMainInvokeEvent,
  payload: { paths: string[]; options?: FilterOptions },
): Promise<ReadChildrenResponse> {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray(payload.paths)
  ) {
    return {
      ok: false,
      code: "E_UNKNOWN",
      message: "Invalid payload: expected { paths: string[] }.",
    };
  }

  const { paths, options } = payload;

  // Empty array → valid, no-op
  if (paths.length === 0) {
    return { ok: true, results: {} };
  }

  // Process all paths in parallel.
  // Each entry is [originalPath, result] so we can key by the original value.
  const settled = await Promise.all(
    paths.map(async (p): Promise<[string, ListResult | FolderExplorerError]> => {
      const result = await listDirectory(p, options);
      return [p, result];
    }),
  );

  // Build the results map. Duplicate paths in the input will produce duplicate
  // keys; the last occurrence wins (idempotent for reads — same path, same fs).
  const results: Record<string, ListResult | FolderExplorerError> =
    Object.fromEntries(settled);

  return { ok: true, results };
}

// ── Registration ───────────────────────────────────────────────────────────

/**
 * Registers all `folder-explorer:*` IPC handlers on the provided `ipcMain`.
 *
 * Call this once during Electron main-process startup, after the app is ready.
 *
 * ```ts
 * // In your Electron main entry-point (e.g. electron/main.ts):
 * import { ipcMain } from "electron";
 * import { registerFolderExplorerHandlers } from "./electron-main/src/ipc/folder-explorer.ts";
 *
 * app.whenReady().then(() => {
 *   registerFolderExplorerHandlers(ipcMain);
 *   // … create window, etc.
 * });
 * ```
 *
 * Why accept `ipcMain` as a parameter instead of importing it directly?
 *   - Testability: tests can pass a mock `ipcMain` without spawning Electron.
 *   - Decoupling: this module doesn't import from `electron`, so it can be
 *     analysed by TypeScript in non-Electron contexts (e.g. type-checking only).
 *
 * @param ipcMain - The Electron `ipcMain` object (or a compatible mock for tests).
 */
export function registerFolderExplorerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.LIST,          handleList);
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.STAT,          handleStat);
  ipcMain.handle(FOLDER_EXPLORER_CHANNELS.READ_CHILDREN, handleReadChildren);
}

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN ERRORS BLOCKED BY THESE HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
//
// The following classes of errors are explicitly prevented by the design:
//
// [SECURITY]
//  ✗ Path traversal (../../etc/passwd)
//    → Blocked by resolveWithinHome step 1 (resolve) + step 4 (containment check)
//
//  ✗ Symlink escape (~/evil-link → /etc)
//    → Blocked by resolveWithinHome step 3 (realpath follows all symlinks)
//
//  ✗ Protocol-relative or null-byte paths ("\0/etc/passwd")
//    → homeJail rejects empty/whitespace; Node path.resolve normalises away NUL
//    → filterEntries blocks names with control chars (defensive depth)
//
//  ✗ Unicode homoglyph in path ("../ℯtc" normalised to "../etc")
//    → path.normalize collapses Unicode-confusable segments via OS normalisation
//
//  ✗ Renderer injecting an arbitrary fs path after compromised preload
//    → Every handler re-validates; there is no "trusted" flag from renderer
//
// [API / SHAPE]
//  ✗ Renderer crashing on undefined response (handler throws instead of returning)
//    → All handlers catch every error and return a FolderExplorerError; never throw
//
//  ✗ Raw Node.js error messages leaking stack traces to the renderer
//    → classifyError() maps to normalised codes; "E_UNKNOWN" includes only .message
//
//  ✗ Non-serialisable responses crashing the IPC bridge (Circular refs, BigInt, etc.)
//    → Response types use only plain strings, booleans, arrays, and plain objects
//
//  ✗ "Exists" check failing silently for non-existent-but-valid-HOME paths
//    → handleStat performs a lexical fallback for ENOENT inside HOME, returning
//       ok:true / exists:false instead of E_NOT_FOUND
//
//  ✗ `folder-explorer:read-children` returning top-level error on single bad path
//    → Per-entry results: one bad path does not fail the whole batch
//
//  ✗ Duplicate paths in read-children causing duplicated I/O
//    → Promise.all is purely parallel; no special deduplication needed for reads
//       (both calls read the same directory; idempotent)
//
// [FILTER]
//  ✗ Entries with newlines / control characters in names injecting fake rows
//    → filterEntries Rule 1 (UNSAFE_NAME_RE) rejects them unconditionally
//
//  ✗ ".." or "." appearing as navigable children
//    → filterEntries Rule 3 always blocks them
//
//  ✗ System clutter (snap, .DS_Store, Thumbs.db) flooding the listing
//    → filterEntries DEFAULT_BLOCKLIST covers common cases across macOS/Win/Linux
//
// [EDGE CASES]
//  ✗ Race between resolveWithinHome and readdir (path deleted in between)
//    → classifyError maps the resulting ENOENT to E_NOT_FOUND gracefully
//
//  ✗ Home directory is itself a symlink (macOS /home → /private/home)
//    → HOME_ROOT is resolved with realpathSync at module load time
//
//  ✗ AGENTS_HOME env var pointing outside the real home
//    → HOME_ROOT is set once; any path passed in must still be inside it
//       (AGENTS_HOME IS the jail, not an escape from it)
//
// ─────────────────────────────────────────────────────────────────────────────
// USAGE EXAMPLE (preload + renderer)
// ─────────────────────────────────────────────────────────────────────────────
//
// ① preload.ts — expose via contextBridge
// ───────────────────────────────────────
//   import { contextBridge, ipcRenderer } from "electron";
//   import { FOLDER_EXPLORER_CHANNELS } from "../electron-main/src/ipc/folder-explorer.ts";
//   import type {
//     ListResponse, StatResponse, ReadChildrenResponse, FilterOptions
//   } from "../electron-main/src/ipc/folder-explorer.ts";
//
//   contextBridge.exposeInMainWorld("folderExplorer", {
//     list: (path: string, options?: FilterOptions): Promise<ListResponse> =>
//       ipcRenderer.invoke(FOLDER_EXPLORER_CHANNELS.LIST, { path, options }),
//
//     stat: (path: string): Promise<StatResponse> =>
//       ipcRenderer.invoke(FOLDER_EXPLORER_CHANNELS.STAT, { path }),
//
//     readChildren: (paths: string[], options?: FilterOptions): Promise<ReadChildrenResponse> =>
//       ipcRenderer.invoke(FOLDER_EXPLORER_CHANNELS.READ_CHILDREN, { paths, options }),
//   });
//
// ② renderer component (React)
// ─────────────────────────────
//   const result = await window.folderExplorer.list("/home/user/projects");
//   if (!result.ok) {
//     // result.code: "E_NOT_IN_HOME" | "E_NOT_FOUND" | "E_NOT_A_DIR" | ...
//     console.error(result.code, result.message);
//     return;
//   }
//   // result.entries: DirEntry[]
//   for (const entry of result.entries) {
//     console.log(entry.name, entry.isDirectory, entry.path);
//   }
//
// ─────────────────────────────────────────────────────────────────────────────
// RECOMMENDED TESTS  (tests/electron/ipc/folder-explorer.test.ts)
// ─────────────────────────────────────────────────────────────────────────────
//
// ┌─ handleList ────────────────────────────────────────────────────────────┐
// │ ✓ Lists real subdirectory inside HOME (happy path)                      │
// │ ✓ Returns E_NOT_IN_HOME for path outside HOME (/tmp, /etc)              │
// │ ✓ Returns E_NOT_IN_HOME for traversal (HOME + "/../../etc")             │
// │ ✓ Returns E_NOT_FOUND for a non-existent path inside HOME               │
// │ ✓ Returns E_NOT_A_DIR when path is a file                               │
// │ ✓ Returns E_ACCESS_DENIED for a chmod 000 directory (if test runner     │
// │   has permission to create such directories)                            │
// │ ✓ Filters hidden dirs by default (showHidden defaults to false)         │
// │ ✓ Shows hidden dirs when options.showHidden = true                      │
// │ ✓ Applies extraBlocklist correctly                                      │
// │ ✓ Returns E_UNKNOWN for malformed payload (null, missing path field)    │
// │ ✓ Entry .path is a valid absolute path inside HOME                      │
// │ ✓ Entry names do not contain control characters or path separators      │
// └─────────────────────────────────────────────────────────────────────────┘
//
// ┌─ handleStat ────────────────────────────────────────────────────────────┐
// │ ✓ Returns ok:true / exists:true / isDirectory:true for a real dir       │
// │ ✓ Returns ok:true / exists:true / isDirectory:false for a file          │
// │ ✓ Returns ok:true / exists:false for a non-existent path INSIDE HOME    │
// │ ✓ Returns E_NOT_IN_HOME for a non-existent path OUTSIDE HOME            │
// │ ✓ Returns E_NOT_IN_HOME for an existing path outside HOME               │
// │ ✓ Returns E_ACCESS_DENIED for a path with EACCES during stat            │
// │ ✓ Returns E_NOT_IN_HOME for empty string payload                        │
// │ ✓ Returns E_UNKNOWN for malformed payload                               │
// └─────────────────────────────────────────────────────────────────────────┘
//
// ┌─ handleReadChildren ────────────────────────────────────────────────────┐
// │ ✓ Returns ok:true / results:{} for empty paths array                   │
// │ ✓ Returns per-entry ListResult for valid paths                         │
// │ ✓ Per-entry FolderExplorerError for invalid paths (not top-level fail)  │
// │ ✓ Mixed: some paths valid, some invalid → partial results map          │
// │ ✓ Duplicate paths produce duplicate keys (last result wins, idempotent) │
// │ ✓ All paths validated independently (one jail violation doesn't abort)  │
// │ ✓ Returns E_UNKNOWN for malformed payload (paths not an array)          │
// └─────────────────────────────────────────────────────────────────────────┘
//
// ┌─ registerFolderExplorerHandlers ───────────────────────────────────────┐
// │ ✓ Calls ipcMain.handle exactly 3 times with the correct channel names  │
// │ ✓ Mock ipcMain can be used (no Electron required for unit tests)       │
// └─────────────────────────────────────────────────────────────────────────┘
